import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createMeetingRoom, joinMeeting } from '../../services/videoService';

interface VideoMeetingWidgetProps {
  roomName?: string;
  title?: string;
  onClose?: () => void;
}

type MeetingState = 'idle' | 'loading' | 'active' | 'error';

/**
 * Widget vidéo embarqué Daily.co pour COYA.
 * Installe l'iframe Daily.co dans un panneau modal.
 * Utilise l'Edge Function `daily-room` pour obtenir l'URL et le token sécurisés.
 */
const VideoMeetingWidget: React.FC<VideoMeetingWidgetProps> = ({
  roomName,
  title = 'Réunion vidéo',
  onClose,
}) => {
  const [state, setState] = useState<MeetingState>('idle');
  const [meetingUrl, setMeetingUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const startMeeting = useCallback(async () => {
    setState('loading');
    setErrorMsg(null);
    try {
      const result = roomName
        ? await joinMeeting(roomName)
        : await createMeetingRoom();

      // Ajouter le token comme paramètre URL pour l'authentification Daily
      const url = new URL(result.url);
      if (result.token) url.searchParams.set('t', result.token);
      setMeetingUrl(url.toString());
      setState('active');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erreur lors de la connexion à la salle vidéo';
      setErrorMsg(msg);
      setState('error');
    }
  }, [roomName]);

  const handleClose = useCallback(() => {
    setState('idle');
    setMeetingUrl(null);
    setErrorMsg(null);
    onClose?.();
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && state === 'active') handleClose();
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [state, handleClose]);

  if (state === 'idle' || state === 'error') {
    return (
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={startMeeting}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <i className="fas fa-video" />
          {roomName ? 'Rejoindre la réunion' : 'Démarrer une réunion'}
        </button>
        {state === 'error' && errorMsg && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <i className="fas fa-exclamation-circle" />
            {errorMsg}
          </p>
        )}
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <i className="fas fa-spinner fa-spin" />
        Connexion à la salle vidéo…
      </div>
    );
  }

  // État active : panneau modal avec iframe
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="relative bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden w-full max-w-5xl mx-4" style={{ height: '85vh' }}>
        {/* En-tête */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            <span className="font-medium text-gray-800 text-sm">{title}</span>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-500 transition-colors"
            aria-label="Fermer la réunion"
          >
            <i className="fas fa-times" />
          </button>
        </div>

        {/* Iframe Daily.co */}
        {meetingUrl && (
          <iframe
            ref={iframeRef}
            src={meetingUrl}
            allow="camera; microphone; fullscreen; display-capture; autoplay"
            className="flex-1 border-0"
            title={title}
          />
        )}
      </div>
    </div>
  );
};

export default VideoMeetingWidget;
