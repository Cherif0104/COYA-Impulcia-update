import { supabase } from './supabaseService';

interface VoiceCallToken {
  token: string;
  appId: string;
  channelName: string;
  uid: number;
}

interface AgoraResponse {
  ok: boolean;
  token?: string;
  appId?: string;
  channelName?: string;
  uid?: number;
  error?: string;
}

/**
 * Obtient un token RTC Agora pour rejoindre un canal vocal.
 * L'Edge Function `agora-token` génère le token côté serveur avec les secrets Agora.
 */
export async function getVoiceCallToken(
  channelName: string,
  role: 'publisher' | 'subscriber' = 'publisher',
): Promise<VoiceCallToken> {
  // UID basé sur la session utilisateur (entier 32 bits)
  const { data: { user } } = await supabase.auth.getUser();
  const uid = user?.id
    ? Math.abs(user.id.split('').reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)) % 0xffffffff
    : Math.floor(Math.random() * 0xffffffff);

  const { data, error } = await supabase.functions.invoke<AgoraResponse>('agora-token', {
    body: { channelName, uid, role, expiry: 3600 },
  });

  if (error) throw new Error(`voipService réseau: ${error.message}`);
  if (!data?.ok) throw new Error(`voipService erreur: ${data?.error ?? 'inconnue'}`);

  return {
    token: data.token!,
    appId: data.appId!,
    channelName: data.channelName!,
    uid: data.uid!,
  };
}
