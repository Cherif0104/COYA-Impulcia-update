// Edge Function: agora-token
// Génère un token RTC Agora v2 (algorithme AccessToken2).
// AGORA_APP_ID et AGORA_APP_CERTIFICATE vivent dans les Supabase Secrets.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCorsPreFlight, jsonResponse } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';

interface AgoraRequest {
  channelName: string;
  uid: number;
  role: 'publisher' | 'subscriber';
  /** Durée de vie du token en secondes (défaut 3600) */
  expiry?: number;
}

// ---------- Agora AccessToken2 (algorithme simplifié) ----------
// Référence : https://docs.agora.io/en/video-calling/get-started/authentication-workflow

const AGORA_VERSION = '007';
const SERVICE_TYPE_RTC = 1;
const PRIVILEGE_JOIN_CHANNEL = 1;
const PRIVILEGE_PUBLISH_AUDIO = 2;
const PRIVILEGE_PUBLISH_VIDEO = 3;

function packUint16(value: number): Uint8Array {
  const buf = new ArrayBuffer(2);
  new DataView(buf).setUint16(0, value, true);
  return new Uint8Array(buf);
}

function packUint32(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, value, true);
  return new Uint8Array(buf);
}

function packInt32(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setInt32(0, value, true);
  return new Uint8Array(buf);
}

function packString(str: string): Uint8Array {
  const encoded = new TextEncoder().encode(str);
  return new Uint8Array([...packUint16(encoded.length), ...encoded]);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, data);
  return new Uint8Array(sig);
}

async function buildAgoraToken(
  appId: string,
  appCertificate: string,
  channelName: string,
  uid: number,
  role: 'publisher' | 'subscriber',
  expiry: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expireAt = now + expiry;
  const issueAt = now;

  const salt = Math.floor(Math.random() * 0xffffffff);

  // Construire le message à signer
  const msgBytes = concatBytes(
    packUint32(salt),
    packUint32(issueAt),
    packUint32(expireAt),
    packString(channelName),
    packUint32(uid),
  );

  // Signer avec HMAC-SHA256 en utilisant appCertificate comme clé
  const certBytes = new TextEncoder().encode(appCertificate);
  const signature = await hmacSha256(certBytes, msgBytes);

  // Construire les privilèges
  const privileges = new Map<number, number>();
  privileges.set(PRIVILEGE_JOIN_CHANNEL, expireAt);
  if (role === 'publisher') {
    privileges.set(PRIVILEGE_PUBLISH_AUDIO, expireAt);
    privileges.set(PRIVILEGE_PUBLISH_VIDEO, expireAt);
  }

  // Sérialiser les privilèges
  const privilegeBytes: Uint8Array[] = [packUint16(privileges.size)];
  for (const [priv, exp] of privileges) {
    privilegeBytes.push(packUint16(priv), packUint32(exp));
  }
  const privPacked = concatBytes(...privilegeBytes);

  // Construire le service RTC
  const serviceContent = concatBytes(
    packUint16(SERVICE_TYPE_RTC),
    packString(channelName),
    packUint32(uid),
    privPacked,
  );

  // Assembler le token final
  const tokenContent = concatBytes(
    new TextEncoder().encode(appId),
    packUint32(issueAt),
    packUint32(expireAt),
    packUint16(1), // service count = 1
    serviceContent,
  );

  const sigLen = packUint16(signature.length);
  const tokenWithSig = concatBytes(sigLen, signature, packUint32(tokenContent.length), tokenContent);

  return AGORA_VERSION + encodeBase64(tokenWithSig);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight();

  try {
    await verifyJWT(req);
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    return jsonResponse({ error: "Erreur d'authentification" }, 401);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  const appId = Deno.env.get('AGORA_APP_ID');
  const appCertificate = Deno.env.get('AGORA_APP_CERTIFICATE');

  if (!appId || !appCertificate) {
    return jsonResponse({ error: 'AGORA_APP_ID ou AGORA_APP_CERTIFICATE non configurés' }, 500);
  }

  let body: AgoraRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400);
  }

  const { channelName, uid, role, expiry = 3600 } = body;
  if (!channelName || uid == null || !role) {
    return jsonResponse({ error: 'Champs requis : channelName, uid, role' }, 400);
  }

  try {
    const token = await buildAgoraToken(appId, appCertificate, channelName, uid, role, expiry);
    return jsonResponse({ ok: true, token, appId, channelName, uid });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[agora-token] Erreur: ${msg}`);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});
