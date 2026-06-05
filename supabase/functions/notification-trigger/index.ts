// Edge Function: notification-trigger
// Déclenche des notifications via Novu Cloud.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCorsPreFlight, jsonResponse } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';

interface TriggerRequest {
  event: string;
  userId: string;
  payload?: Record<string, unknown>;
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

  const novuApiKey = Deno.env.get('NOVU_API_KEY');
  if (!novuApiKey) {
    return jsonResponse({ error: 'NOVU_API_KEY non configurée' }, 500);
  }

  let body: TriggerRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400);
  }

  const { event, userId, payload = {} } = body;
  if (!event || !userId) {
    return jsonResponse({ error: 'Champs requis : event, userId' }, 400);
  }

  try {
    const res = await fetch('https://api.novu.co/v1/events/trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${novuApiKey}`,
      },
      body: JSON.stringify({
        name: event,
        to: { subscriberId: userId },
        payload,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      console.error(`[notification-trigger] Novu ${res.status}: ${err}`);
      return jsonResponse({ ok: false, error: `Novu ${res.status}: ${err}` }, 502);
    }

    const data = await res.json();
    return jsonResponse({ ok: true, data });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[notification-trigger] Erreur: ${msg}`);
    return jsonResponse({ ok: false, error: msg }, 502);
  }
});
