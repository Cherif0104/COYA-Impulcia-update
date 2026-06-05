// Edge Function: ai-proxy
// Route les appels IA (Gemini, EdenAI, Replicate, Stability AI) depuis le front COYA.
// Les clés API vivent dans les Supabase Secrets — jamais exposées au navigateur.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCorsPreFlight, jsonResponse } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';

type Provider = 'gemini' | 'edenai' | 'replicate' | 'stability';

interface ProxyRequest {
  provider: Provider;
  action: string;
  payload: Record<string, unknown>;
}

// ---------- Gemini ----------
async function callGemini(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY non configurée');

  const model = (payload.model as string) || 'gemini-1.5-flash';
  const base = 'https://generativelanguage.googleapis.com/v1beta';

  if (action === 'generateContent') {
    const url = `${base}/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload.body ?? payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Gemini ${res.status}: ${err}`);
    }
    return res.json();
  }

  throw new Error(`Action Gemini non supportée : ${action}`);
}

// ---------- EdenAI ----------
async function callEdenAI(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const apiKey = Deno.env.get('EDENAI_API_KEY');
  if (!apiKey) throw new Error('EDENAI_API_KEY non configurée');

  const base = ((payload.base as string) || 'https://api.edenai.run/v3').replace(/\/$/, '');
  const endpoint = action === 'chat' ? `${base}/chat/completions` : `${base}/${action}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload.body ?? payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`EdenAI ${res.status}: ${err}`);
  }
  return res.json();
}

// ---------- Replicate ----------
async function callReplicate(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const token = Deno.env.get('REPLICATE_API_TOKEN');
  if (!token) throw new Error('REPLICATE_API_TOKEN non configuré');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Token ${token}`,
  };

  if (action === 'create_prediction') {
    const res = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Replicate ${res.status}: ${err}`);
    }
    return res.json();
  }

  if (action === 'get_prediction') {
    const id = payload.id as string;
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, { headers });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`Replicate ${res.status}: ${err}`);
    }
    return res.json();
  }

  throw new Error(`Action Replicate non supportée : ${action}`);
}

// ---------- Stability AI ----------
async function callStabilityAI(action: string, payload: Record<string, unknown>): Promise<unknown> {
  const apiKey = Deno.env.get('STABILITY_AI_API_KEY');
  if (!apiKey) throw new Error('STABILITY_AI_API_KEY non configurée');

  const endpoint =
    (payload.endpoint as string) ||
    'https://api.stability.ai/v2beta/stable-image/generate/sd3';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload.body ?? payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Stability AI ${res.status}: ${err}`);
  }
  // La réponse peut être JSON ou binaire selon l'endpoint
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return res.json();
  // Retourner les données binaires en base64
  const buf = await res.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  return { base64: b64, contentType };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return handleCorsPreFlight();

  try {
    await verifyJWT(req);
  } catch (authErr) {
    if (authErr instanceof Response) return authErr;
    return jsonResponse({ error: 'Erreur d\'authentification' }, 401);
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Méthode non autorisée' }, 405);
  }

  let body: ProxyRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Corps de la requête JSON invalide' }, 400);
  }

  const { provider, action, payload } = body;
  if (!provider || !action || !payload) {
    return jsonResponse({ error: 'Champs requis : provider, action, payload' }, 400);
  }

  try {
    let result: unknown;
    switch (provider) {
      case 'gemini':
        result = await callGemini(action, payload);
        break;
      case 'edenai':
        result = await callEdenAI(action, payload);
        break;
      case 'replicate':
        result = await callReplicate(action, payload);
        break;
      case 'stability':
        result = await callStabilityAI(action, payload);
        break;
      default:
        return jsonResponse({ error: `Provider non supporté : ${provider}` }, 400);
    }
    return jsonResponse({ ok: true, data: result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ai-proxy] Erreur provider=${provider} action=${action}: ${msg}`);
    return jsonResponse({ ok: false, error: msg }, 502);
  }
});
