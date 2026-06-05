import { supabase } from './supabaseService';

interface MeetingResult {
  url: string;
  token: string;
  roomName: string;
}

interface DailyResponse {
  ok: boolean;
  url?: string;
  roomName?: string;
  token?: string;
  error?: string;
}

async function callDailyRoom(
  action: 'create' | 'get-token',
  roomName?: string,
): Promise<MeetingResult> {
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? 'anonymous';

  const { data, error } = await supabase.functions.invoke<DailyResponse>('daily-room', {
    body: { action, roomName, userId },
  });

  if (error) throw new Error(`videoService réseau: ${error.message}`);
  if (!data?.ok) throw new Error(`videoService erreur: ${data?.error ?? 'inconnue'}`);

  return {
    url: data.url ?? '',
    token: data.token ?? '',
    roomName: data.roomName ?? roomName ?? '',
  };
}

/**
 * Crée une nouvelle salle vidéo Daily.co et retourne l'URL et le token d'accès.
 */
export async function createMeetingRoom(name?: string): Promise<MeetingResult> {
  return callDailyRoom('create', name);
}

/**
 * Rejoint une salle vidéo Daily.co existante et retourne le token d'accès.
 */
export async function joinMeeting(roomName: string): Promise<MeetingResult> {
  return callDailyRoom('get-token', roomName);
}
