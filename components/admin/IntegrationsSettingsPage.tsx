import React, { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContextSupabase';
import {
  ExternalIntegration,
  ExternalIntegrationProvider,
  ExternalIntegrationStatus,
  listIntegrations,
  upsertIntegration,
} from '../../services/integrationsService';

interface ProviderMeta {
  provider: ExternalIntegrationProvider;
  label: string;
  description: string;
  icon: string;
  configFields?: Array<{ key: string; label: string; type?: string; placeholder?: string }>;
}

const PROVIDER_META: ProviderMeta[] = [
  {
    provider: 'atlassian',
    label: 'Atlassian (Jira / Confluence)',
    description: 'Synchronisation tickets et documentation avec Jira / Confluence.',
    icon: 'fab fa-atlassian',
    configFields: [
      { key: 'domain', label: 'Domaine Atlassian', placeholder: 'votreentreprise.atlassian.net' },
      { key: 'email', label: 'Email du compte', placeholder: 'admin@exemple.com' },
    ],
  },
  {
    provider: 'monday',
    label: 'Monday.com',
    description: 'Synchronisation des projets et tâches avec Monday.',
    icon: 'fas fa-columns',
    configFields: [
      { key: 'board_id', label: 'ID du tableau', placeholder: '123456789' },
    ],
  },
  {
    provider: 'google_drive',
    label: 'Google Drive',
    description: 'Accès aux fichiers et documents stockés sur Google Drive.',
    icon: 'fab fa-google-drive',
    configFields: [
      { key: 'folder_id', label: 'ID du dossier racine', placeholder: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms' },
    ],
  },
  {
    provider: 'hubspot',
    label: 'HubSpot CRM',
    description: 'Synchronisation contacts et opportunités avec HubSpot.',
    icon: 'fas fa-funnel-dollar',
    configFields: [
      { key: 'portal_id', label: 'Portal ID', placeholder: '12345678' },
    ],
  },
  {
    provider: 'novu',
    label: 'Novu (notifications multi-canal)',
    description: 'Notifications email, SMS, push via Novu Cloud.',
    icon: 'fas fa-bell',
    configFields: [
      { key: 'application_identifier', label: "Application Identifier (public)", placeholder: 'novu_app_xxxxxxxx' },
    ],
  },
  {
    provider: 'resend',
    label: 'Resend (email transactionnel)',
    description: 'Envoi d\'emails transactionnels via Resend.',
    icon: 'fas fa-envelope',
    configFields: [
      { key: 'from_email', label: 'Adresse expéditeur', placeholder: 'noreply@coya.pro' },
    ],
  },
  {
    provider: 'daily_co',
    label: 'Daily.co (vidéoconférence)',
    description: 'Réunions vidéo embarquées dans COYA via Daily.co.',
    icon: 'fas fa-video',
    configFields: [
      { key: 'domain', label: 'Domaine Daily', placeholder: 'votre-domaine.daily.co' },
    ],
  },
  {
    provider: 'agora',
    label: 'Agora (VoIP interne)',
    description: 'Appels vocaux en temps réel entre collaborateurs via Agora.',
    icon: 'fas fa-phone',
    configFields: [
      { key: 'app_id', label: 'App ID Agora (public)', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    provider: 'twilio',
    label: 'Twilio (VoIP externe / SMS)',
    description: 'Appels et SMS vers l\'extérieur via Twilio.',
    icon: 'fas fa-phone-volume',
    configFields: [
      { key: 'account_sid', label: 'Account SID', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
      { key: 'from_number', label: 'Numéro expéditeur', placeholder: '+33XXXXXXXXX' },
    ],
  },
  {
    provider: 'yousign',
    label: 'Yousign (signature électronique)',
    description: 'Signature de documents en ligne avec Yousign.',
    icon: 'fas fa-file-signature',
    configFields: [
      { key: 'workspace_id', label: 'Workspace ID', placeholder: 'ws_xxxxxxxx' },
    ],
  },
  {
    provider: 'formbricks',
    label: 'Formbricks (formulaires & enquêtes)',
    description: 'Formulaires et enquêtes de satisfaction via Formbricks.',
    icon: 'fas fa-poll',
    configFields: [
      { key: 'environment_id', label: 'Environment ID', placeholder: 'clxxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    provider: 'cal_com',
    label: 'Cal.com (prise de rendez-vous)',
    description: 'Planification de réunions via Cal.com.',
    icon: 'fas fa-calendar-alt',
    configFields: [
      { key: 'username', label: 'Nom d\'utilisateur Cal.com', placeholder: 'votre-equipe' },
    ],
  },
  {
    provider: 'meta',
    label: 'Meta (WhatsApp / Facebook / Instagram)',
    description: 'Messagerie WhatsApp Business et pages Meta.',
    icon: 'fab fa-meta',
    configFields: [
      { key: 'phone_number_id', label: 'Phone Number ID (WhatsApp)', placeholder: '1234567890' },
    ],
  },
  {
    provider: 'odoo_sync',
    label: 'Odoo (synchronisation ERP)',
    description: 'Synchronisation bidirectionnelle avec un ERP Odoo.',
    icon: 'fas fa-sync',
    configFields: [
      { key: 'url', label: 'URL de l\'instance Odoo', placeholder: 'https://odoo.exemple.com' },
      { key: 'db', label: 'Nom de la base de données', placeholder: 'ma_bd_odoo' },
    ],
  },
];

const STATUS_BADGE: Record<ExternalIntegrationStatus, { label: string; className: string }> = {
  active: { label: 'Actif', className: 'bg-green-100 text-green-800' },
  inactive: { label: 'Inactif', className: 'bg-gray-100 text-gray-600' },
  error: { label: 'Erreur', className: 'bg-red-100 text-red-700' },
};

const IntegrationsSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? '';

  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ExternalIntegrationProvider | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<ExternalIntegrationProvider | null>(null);
  const [configDrafts, setConfigDrafts] = useState<Record<string, Record<string, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listIntegrations(orgId);
      setIntegrations(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur lors du chargement des intégrations');
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  function getIntegration(provider: ExternalIntegrationProvider): ExternalIntegration | undefined {
    return integrations.find((i) => i.provider === provider);
  }

  function getDraft(provider: ExternalIntegrationProvider): Record<string, string> {
    return configDrafts[provider] ?? {};
  }

  function setDraftField(provider: ExternalIntegrationProvider, key: string, value: string) {
    setConfigDrafts((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], [key]: value },
    }));
  }

  async function handleToggle(meta: ProviderMeta) {
    const existing = getIntegration(meta.provider);
    const nextStatus: ExternalIntegrationStatus =
      existing?.status === 'active' ? 'inactive' : 'active';
    setSaving(meta.provider);
    setError(null);
    try {
      const draft = getDraft(meta.provider);
      const baseConfig = existing?.config ?? {};
      const mergedConfig = { ...baseConfig, ...draft };
      const updated = await upsertIntegration({
        organizationId: orgId,
        provider: meta.provider,
        status: nextStatus,
        displayName: meta.label,
        config: mergedConfig,
      });
      setIntegrations((prev) =>
        prev.some((i) => i.provider === meta.provider)
          ? prev.map((i) => (i.provider === meta.provider ? updated : i))
          : [...prev, updated],
      );
      setSuccessMsg(`${meta.label} — ${nextStatus === 'active' ? 'activé' : 'désactivé'} avec succès.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la mise à jour');
    } finally {
      setSaving(null);
    }
  }

  async function handleSaveConfig(meta: ProviderMeta) {
    const existing = getIntegration(meta.provider);
    const draft = getDraft(meta.provider);
    if (Object.keys(draft).length === 0) return;
    setSaving(meta.provider);
    setError(null);
    try {
      const baseConfig = existing?.config ?? {};
      const updated = await upsertIntegration({
        organizationId: orgId,
        provider: meta.provider,
        status: existing?.status ?? 'inactive',
        displayName: meta.label,
        config: { ...baseConfig, ...draft },
      });
      setIntegrations((prev) =>
        prev.some((i) => i.provider === meta.provider)
          ? prev.map((i) => (i.provider === meta.provider ? updated : i))
          : [...prev, updated],
      );
      setConfigDrafts((prev) => {
        const next = { ...prev };
        delete next[meta.provider];
        return next;
      });
      setSuccessMsg(`Configuration de ${meta.label} sauvegardée.`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <i className="fas fa-spinner fa-spin text-2xl text-indigo-500 mr-3" />
        <span className="text-gray-500">Chargement des intégrations…</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-gray-900">Intégrations externes</h2>
        <p className="mt-1 text-sm text-gray-500">
          Connectez COYA aux outils de votre organisation. Les clés API sensibles sont stockées dans les Supabase Secrets, jamais ici.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
          <i className="fas fa-exclamation-circle" />
          {error}
        </div>
      )}

      {successMsg && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700 flex items-center gap-2">
          <i className="fas fa-check-circle" />
          {successMsg}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800 flex gap-2">
        <i className="fas fa-info-circle mt-0.5 flex-shrink-0" />
        <span>
          Les clés secrètes (API keys, tokens) doivent être configurées dans{' '}
          <strong>Supabase Dashboard → Edge Functions → Secrets</strong>, pas dans ce formulaire.
          Seules les valeurs publiques (IDs, domaines) sont enregistrées ici.
        </span>
      </div>

      <div className="grid gap-4">
        {PROVIDER_META.map((meta) => {
          const integration = getIntegration(meta.provider);
          const status = integration?.status ?? 'inactive';
          const badge = STATUS_BADGE[status];
          const isActive = status === 'active';
          const isSavingThis = saving === meta.provider;
          const isExpanded = expandedProvider === meta.provider;
          const draft = getDraft(meta.provider);
          const hasDraft = Object.keys(draft).some((k) => draft[k] !== '');

          return (
            <div
              key={meta.provider}
              className={`bg-white rounded-xl border transition-all ${
                isActive ? 'border-indigo-200 shadow-sm' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-4 px-5 py-4">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isActive ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <i className={`${meta.icon} text-lg`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 text-sm">{meta.label}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5 leading-snug">{meta.description}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {meta.configFields && meta.configFields.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpandedProvider(isExpanded ? null : meta.provider)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      <i className={`fas fa-${isExpanded ? 'chevron-up' : 'cog'} mr-1.5`} />
                      {isExpanded ? 'Fermer' : 'Config.'}
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isSavingThis}
                    onClick={() => handleToggle(meta)}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                      isActive ? 'bg-indigo-600' : 'bg-gray-200'
                    } ${isSavingThis ? 'opacity-60 cursor-not-allowed' : ''}`}
                    aria-label={isActive ? 'Désactiver' : 'Activer'}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition duration-200 ${
                        isActive ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {isExpanded && meta.configFields && (
                <div className="border-t border-gray-100 px-5 py-4 bg-gray-50 rounded-b-xl space-y-3">
                  {meta.configFields.map((field) => {
                    const savedVal = (integration?.config?.[field.key] as string) ?? '';
                    const draftVal = draft[field.key] ?? savedVal;
                    return (
                      <div key={field.key}>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          {field.label}
                        </label>
                        <input
                          type={field.type ?? 'text'}
                          value={draftVal}
                          placeholder={field.placeholder ?? ''}
                          onChange={(e) => setDraftField(meta.provider, field.key, e.target.value)}
                          className="block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 outline-none transition-colors"
                        />
                      </div>
                    );
                  })}

                  {hasDraft && (
                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={isSavingThis}
                        onClick={() => handleSaveConfig(meta)}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSavingThis ? (
                          <i className="fas fa-spinner fa-spin" />
                        ) : (
                          <i className="fas fa-save" />
                        )}
                        Sauvegarder la configuration
                      </button>
                    </div>
                  )}

                  {integration && Object.keys(integration.config).length > 0 && !hasDraft && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <i className="fas fa-check-circle" />
                      Configuration enregistrée.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default IntegrationsSettingsPage;
