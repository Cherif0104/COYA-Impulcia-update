import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AuthProvider } from './contexts/AuthContextSupabase';
import { LocalizationProvider } from './contexts/LocalizationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { PresenceProvider } from './contexts/PresenceContext';
import './src/index.css';
import {
  ChainedActivityEventPersistence,
  configureDefaultActivityEventPersistence,
  InMemoryActivityEventPersistence,
  subscribeActivityEvents,
  SupabaseActivityEventPersistence,
  SupabaseTimelineSegmentPersistence,
} from './services/workforce';
import { isSupabaseConfigured } from './services/supabaseService';
import { postCoyaDebugIngest } from './utils/coyaDebugIngest';

/** Workforce OS : événements + segments timeline (Supabase) ; mémoire en dev si non configuré */
if (isSupabaseConfigured) {
  configureDefaultActivityEventPersistence(
    new ChainedActivityEventPersistence([
      new SupabaseActivityEventPersistence(),
      new SupabaseTimelineSegmentPersistence(),
    ]),
  );
} else if (import.meta.env.DEV) {
  configureDefaultActivityEventPersistence(new InMemoryActivityEventPersistence());
}

if (import.meta.env.DEV) {
  subscribeActivityEvents(e => {
    console.debug('[WorkforceOS]', e.verb, e.actor_worker_id, e.object_refs, e.payload);
  });
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Erreur rendu:', error, info.componentStack);
    // #region agent log
    postCoyaDebugIngest({
      sessionId: '5fe008',
      hypothesisId: 'H_ERR',
      location: 'index.tsx:AppErrorBoundary.componentDidCatch',
      message: 'react_render_error',
      data: {
        name: error?.name,
        msg: String(error?.message || '').slice(0, 400),
        stackTop: String(error?.stack || '').split('\n').slice(0, 6).join(' | '),
        compStack: String(info?.componentStack || '').slice(0, 800),
      },
      timestamp: Date.now(),
    });
    // #endregion
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'sans-serif', maxWidth: 600 }}>
          <h1 style={{ color: '#b45309' }}>Erreur d&apos;affichage</h1>
          <pre style={{ background: '#f4f4f4', padding: 16, overflow: 'auto' }}>
            {this.state.error.message}
          </pre>
          <p>Ouvrez la console du navigateur (F12) pour plus de détails.</p>
          <button
            type="button"
            style={{ marginTop: 16, padding: '8px 16px', cursor: 'pointer' }}
            onClick={() => (this as any).setState({ error: null })}
          >
            Réessayer
          </button>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

declare global {
  interface Window {
    __COYA_APP_ROOT__?: ReactDOM.Root;
  }
}

const root = window.__COYA_APP_ROOT__ || ReactDOM.createRoot(rootElement);
window.__COYA_APP_ROOT__ = root;

// LocalizationProvider doit rester monté même si une erreur survient dans l’app :
// sinon ErrorBoundary remplace tout le sous-arbre et les hooks (useLocalization) perdent leur provider.
root.render(
  <LocalizationProvider>
    <AppErrorBoundary>
      <AuthProvider>
        <PresenceProvider>
          <ThemeProvider>
            <App />
          </ThemeProvider>
        </PresenceProvider>
      </AuthProvider>
    </AppErrorBoundary>
  </LocalizationProvider>
);