// Edge Function: daily-room
// Gère la création de salles vidéo et la génération de tokens Daily.co.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCorsPreFlight, jsonResponse } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';

interface DailyRequest {
  action: 'create' | 'get-token';
  roomName?: string;
  userId: string;
  /** Durée de vie du token en secondes (défaut 3600) */
  tokenExpiry?: number;
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

  const dailyApiKey = Deno.env.get('DAILY_API_KEY');
  if (!dailyApiKey) {
    return jsonResponse({ error: 'DAILY_API_KEY non configurée' }, 500);
  }

  let body: DailyRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400);
  }

  const { action, userId, tokenExpiry = 3600 } = body;
  let { roomName } = body;

  if (!action || !userId) {
    return jsonResponse({ error: 'Champs requis : action, userId' }, 400);
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${dailyApiKey}`,
  };

  try {
    if (action === 'create') {
      // Générer un nom de salle si non fourni
      if (!roomName) {
        roomName = `coya-${Date.now().toString(36)}`;
      }

      const res = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          name: roomName,
          properties: {
            exp: Math.floor(Date.now() / 1000) + 24 * 3600,
            enable_chat: true,
            enable_screenshare: true,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        return jsonResponse({ ok: false, error: `Daily.co create ${res.status}: ${err}` }, 502);
      }

      const room = await res.json();

      // Générer le token immédiatement après la création
      const tokenRes = await fetch('https://api.daily.co/v1/meeting-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            room_name: room.name,
            user_id: userId,
            exp: Math.floor(Date.now() / 1000) + tokenExpiry,
            is_owner: true,
          },
        }),
      });

      const tokenData = tokenRes.ok ? await tokenRes.json() : { token: null };
      return jsonResponse({
        ok: true,
        url: room.url,
        roomName: room.name,
        token: tokenData.token,
      });
    }

    if (action === 'get-token') {
      if (!roomName) {
        return jsonResponse({ error: 'roomName requis pour get-token' }, 400);
      }

      const res = await fetch('https://api.daily.co/v1/meeting-tokens', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          properties: {
            room_name: roomName,
            user_id: userId,
            exp: Math.floor(Date.now() / 1000) + tokenExpiry,
          },
        }),
      });

      if (!res.ok) {
        const err = await res.text().catch(() => res.statusText);
        return jsonResponse({ ok: false, error: `Daily.co token ${res.status}: ${err}` }, 502);
      }

      const data = await res.json();
      const domain = Deno.env.get('DAILY_DOMAIN') || '';
      const url = domain ? `https://${domain}/${roomName}` : `https://daily.co/${roomName}`;
      return jsonResponse({ ok: true, url, roomName, token: data.token });
    }

    return jsonResponse({ error: `Action non supportée : ${action}` }, 400);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[daily-room] Erreur: ${msg}`);
    return jsonResponse({ ok: false, error: msg }, 502);
  }
});
