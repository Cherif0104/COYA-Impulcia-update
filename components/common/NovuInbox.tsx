import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContextSupabase';
import { getIntegration } from '../../services/integrationsService';

/**
 * Wrapper autour du composant <Inbox> de Novu (@novu/react).
 * Charge dynamiquement le package Novu pour éviter d'alourdir le bundle initial.
 * L'applicationIdentifier est lu depuis l'intégration `novu` active dans coya_external_integrations.
 */
const NovuInbox: React.FC = () => {
  const { user } = useAuth();
  const [appId, setAppId] = useState<string | null>(null);
  const [NovuComponent, setNovuComponent] = useState<React.ComponentType<{
    applicationIdentifier: string;
    subscriberId: string;
    appearance?: Record<string, unknown>;
  }> | null>(null);
  const [loadError, setLoadError] = useState(false);

  const orgId = user?.organizationId ?? '';
  const userId = user?.id ?? '';

  useEffect(() => {
    if (!orgId) return;
    getIntegration(orgId, 'novu')
      .then((integration) => {
        const id = integration?.config?.application_identifier as string | undefined;
        if (id && integration?.status === 'active') setAppId(id);
      })
      .catch(() => setLoadError(true));
  }, [orgId]);

  useEffect(() => {
    if (!appId) return;
    import('@novu/react')
      .then((mod) => {
        // Le composant peut s'appeler Inbox ou NovuInbox selon la version du package
        const Comp = (mod as Record<string, unknown>).Inbox as React.ComponentType<{
          applicationIdentifier: string;
          subscriberId: string;
          appearance?: Record<string, unknown>;
        }> | undefined;
        if (Comp) setNovuComponent(() => Comp);
        else setLoadError(true);
      })
      .catch(() => setLoadError(true));
  }, [appId]);

  if (!appId || !userId) return null;
  if (loadError) return null;
  if (!NovuComponent) return null;

  return (
    <NovuComponent
      applicationIdentifier={appId}
      subscriberId={userId}
      appearance={{
        variables: {
          colorPrimary: '#4f46e5',
          colorPrimaryForeground: '#ffffff',
          colorBackground: '#ffffff',
          colorForeground: '#111827',
          colorCounter: '#ef4444',
          colorCounterForeground: '#ffffff',
          borderRadius: '0.75rem',
          fontSize: '14px',
        },
      }}
    />
  );
};

export default NovuInbox;
