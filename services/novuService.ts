import { supabase } from './supabaseService';

/**
 * Déclenche une notification Novu Cloud pour un utilisateur.
 * L'appel passe par l'Edge Function `notification-trigger` — jamais directement vers Novu.
 */
export async function triggerNotification(
  event: string,
  userId: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.functions.invoke('notification-trigger', {
    body: { event, userId, payload: payload ?? {} },
  });
  if (error) {
    console.warn('[novuService] Erreur déclenchement notification Novu:', error.message);
  }
}
