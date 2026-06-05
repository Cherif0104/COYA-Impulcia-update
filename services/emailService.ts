import { supabase } from './supabaseService';

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

/**
 * Envoie un email via Resend en passant par l'Edge Function `send-email`.
 * La clé RESEND_API_KEY vit dans les Supabase Secrets — jamais côté client.
 */
export async function sendEmail(params: SendEmailParams): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; id?: string; error?: string }>(
    'send-email',
    { body: params },
  );
  if (error) throw new Error(`emailService réseau: ${error.message}`);
  if (!data?.ok) throw new Error(`emailService erreur: ${data?.error ?? 'inconnue'}`);
}
