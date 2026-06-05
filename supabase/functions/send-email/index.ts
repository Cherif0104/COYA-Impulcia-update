// Edge Function: send-email
// Envoie des emails via Resend. La clé RESEND_API_KEY vit dans les Supabase Secrets.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders, handleCorsPreFlight, jsonResponse } from '../_shared/cors.ts';
import { verifyJWT } from '../_shared/auth.ts';

interface SendEmailRequest {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
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

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    return jsonResponse({ error: 'RESEND_API_KEY non configurée' }, 500);
  }

  let body: SendEmailRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Corps JSON invalide' }, 400);
  }

  const { to, subject, html, from, replyTo } = body;
  if (!to || !subject || !html) {
    return jsonResponse({ error: 'Champs requis : to, subject, html' }, 400);
  }

  const fromAddress = from || Deno.env.get('RESEND_FROM_EMAIL') || 'noreply@coya.pro';

  try {
    const payload: Record<string, unknown> = { from: fromAddress, to, subject, html };
    if (replyTo) payload.reply_to = replyTo;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      console.error(`[send-email] Resend ${res.status}: ${err}`);
      return jsonResponse({ ok: false, error: `Resend ${res.status}: ${err}` }, 502);
    }

    const data = await res.json();
    return jsonResponse({ ok: true, id: data.id });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[send-email] Erreur: ${msg}`);
    return jsonResponse({ ok: false, error: msg }, 502);
  }
});
