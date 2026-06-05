import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getVoiceCallToken } from '../../services/voipService';

interface VoiceCallWidgetProps {
  targetUserId: string;
  targetName: string;
}

type CallState = 'idle' | 'calling' | 'in-call' | 'ended' | 'error';

/**
 * Widget d'appel vocal interne via Agora RTC.
 * Installe dynamiquement `agora-rtc-sdk-ng` pour ne pas alourdir le bundle initial.
 */
const VoiceCallWidget: React.FC<VoiceCallWidgetProps> = ({ targetUserId, targetName }) => {
  const [callState, setCallState] = useState<CallState>('idle');
  const [duration, setDuration] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const clientRef = useRef<{
    join: (appId: string, channel: string, token: string, uid: number) => Promise<number>;
    leave: () => Promise<void>;
    publish: (track: unknown) => Promise<void>;
    unpublish: (track?: unknown) => Promise<void>;
    on: (event: string, cb: (...args: unknown[]) => void) => void;
  } | null>(null);
  const audioTrackRef = useRef<{ close: () => void; play: () => void } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Nettoyage en sortie
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      audioTrackRef.current?.close();
      clientRef.current?.leave().catch(() => {});
    };
  }, []);

  const startCall = useCallback(async () => {
    setCallState('calling');
    setErrorMsg(null);
    try {
      // Charger Agora dynamiquement
      const AgoraRTC = await import('agora-rtc-sdk-ng').then(
        (m) => (m as { default?: unknown }).default ?? m,
      ) as {
        createClient: (config: { mode: string; codec: string }) => typeof clientRef.current;
        createMicrophoneAudioTrack: () => Promise<typeof audioTrackRef.current>;
      };

      const channelName = [targetUserId, Date.now()].join('-');
      const { token, appId, uid } = await getVoiceCallToken(channelName, 'publisher');

      const client = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' });
      clientRef.current = client;

      await client.join(appId, channelName, token, uid);

      const audioTrack = await AgoraRTC.createMicrophoneAudioTrack();
      audioTrackRef.current = audioTrack;
      await client.publish(audioTrack);

      setCallState('in-call');
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);

      client.on('user-left', () => {
        endCall();
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Erreur lors de l'initialisation de l'appel";
      setErrorMsg(msg);
      setCallState('error');
    }
  }, [targetUserId]);

  const endCall = useCallback(async () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    try {
      audioTrackRef.current?.close();
      audioTrackRef.current = null;
      if (clientRef.current) {
        await clientRef.current.unpublish();
        await clientRef.current.leave();
        clientRef.current = null;
      }
    } catch {
      // Ignorer les erreurs de fin d'appel
    }
    setCallState('ended');
    setTimeout(() => {
      setCallState('idle');
      setDuration(0);
    }, 2000);
  }, []);

  function formatDuration(s: number): string {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  }

  if (callState === 'idle' || callState === 'error') {
    return (
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          onClick={startCall}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
          title={`Appeler ${targetName}`}
        >
          <i className="fas fa-phone" />
          Appeler
        </button>
        {callState === 'error' && errorMsg && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <i className="fas fa-exclamation-circle" />
            {errorMsg}
          </p>
        )}
      </div>
    );
  }

  if (callState === 'calling') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
        <i className="fas fa-phone fa-pulse" />
        <span>Appel de {targetName}…</span>
        <button
          type="button"
          onClick={endCall}
          className="ml-auto text-red-600 hover:text-red-700"
          title="Annuler"
        >
          <i className="fas fa-phone-slash" />
        </button>
      </div>
    );
  }

  if (callState === 'in-call') {
    return (
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-green-50 border border-green-200">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-sm font-medium text-green-800">{targetName}</span>
          <span className="text-xs text-green-600 font-mono">{formatDuration(duration)}</span>
        </div>
        <button
          type="button"
          onClick={endCall}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors"
        >
          <i className="fas fa-phone-slash" />
          Raccrocher
        </button>
      </div>
    );
  }

  if (callState === 'ended') {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-500 text-sm">
        <i className="fas fa-phone-slash" />
        <span>Appel terminé</span>
      </div>
    );
  }

  return null;
};

export default VoiceCallWidget;
