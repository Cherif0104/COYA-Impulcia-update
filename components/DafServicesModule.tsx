import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { Language } from '../types';
import {
  DafService,
  DafRequestCategory,
  DafServiceRequest,
  DafRequestKind,
  DafRequestStatus,
} from '../services/dafService';
import DafRequestDetailModal from './DafRequestDetailModal';
import ModuleRichHub from './common/ModuleRichHub';

const CATEGORIES: { id: DafRequestCategory; labelFr: string }[] = [
  { id: 'supplies', labelFr: 'Fournitures' },
  { id: 'logistics', labelFr: 'Logistique' },
  { id: 'it_misc', labelFr: 'IT / divers' },
  { id: 'vehicle', labelFr: 'Véhicule / parc' },
  { id: 'furniture', labelFr: 'Mobilier / locaux' },
  { id: 'travel', labelFr: 'Déplacement / mission' },
  { id: 'other', labelFr: 'Autre' },
];

const KINDS: { id: DafRequestKind; labelKey: string }[] = [
  { id: 'general', labelKey: 'daf_kind_general' },
  { id: 'document_delivery', labelKey: 'daf_kind_document_delivery' },
  { id: 'information', labelKey: 'daf_kind_information' },
  { id: 'signature_workflow', labelKey: 'daf_kind_signature_workflow' },
];

const DafServicesModule: React.FC = () => {
  const { t, language } = useLocalization();
  const [requests, setRequests] = useState<DafServiceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<DafRequestCategory>('other');
  const [requestKind, setRequestKind] = useState<DafRequestKind>('general');
  const [saving, setSaving] = useState(false);
  const [isReviewer, setIsReviewer] = useState(false);
  const [myProfileId, setMyProfileId] = useState('');
  const [detail, setDetail] = useState<DafServiceRequest | null>(null);
  const [tab, setTab] = useState<'equipements' | 'sites' | 'interventions'>('interventions');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const ctx = await DafService.getProfileContext();
    if (ctx.error) setErrorMsg(String((ctx.error as any)?.message ?? ctx.error));
    else if (ctx.data) {
      setIsReviewer(ctx.data.isReviewer);
      setMyProfileId(ctx.data.profileId);
    }
    const res = await DafService.listMyRequests();
    if (res.error) setErrorMsg(String((res.error as any)?.message ?? res.error));
    else {
      setRequests(res.data);
      setDetail((d) => {
        if (!d) return d;
        const f = res.data!.find((x) => x.id === d.id);
        return f ?? d;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusLabel = (s: DafRequestStatus) => t(`daf_status_${s}`) || s;
  const kindLabel = (k: DafRequestKind) => t(`daf_kind_${k}`) || k;
  const assignmentLabel = (r: DafServiceRequest) => {
    if (!isReviewer) return null;
    if (!r.assignee_profile_id) return t('daf_assign_unassigned');
    if (r.assignee_profile_id === myProfileId) return t('daf_assign_me');
    return t('daf_assign_other');
  };

  const onSave = async (status: 'draft' | 'submitted') => {
    if (!title.trim()) {
      setErrorMsg(language === 'fr' ? 'Le titre est obligatoire.' : 'Title is required.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    const res = await DafService.createRequest({
      title: title.trim(),
      description: description.trim() || null,
      category,
      request_kind: requestKind,
      status,
    });
    if (res.error) setErrorMsg(String((res.error as any)?.message ?? res.error));
    else {
      setTitle('');
      setDescription('');
      setCategory('other');
      setRequestKind('general');
      await load();
    }
    setSaving(false);
  };

  const onDeleteDraft = async (id: string) => {
    if (!confirm(language === 'fr' ? 'Supprimer ce brouillon ?' : 'Delete this draft?')) return;
    const { error } = await DafService.deleteDraft(id);
    if (error) setErrorMsg(String((error as any)?.message ?? error));
    else await load();
  };

  const submitDraft = async (id: string) => {
    const { error } = await DafService.updateRequest(id, { status: 'submitted' });
    if (error) setErrorMsg(String((error as any)?.message ?? error));
    else await load();
  };

  const visibleRequests = useMemo(() => {
    const base = isReviewer ? requests.filter((r) => !r.assignee_profile_id || r.assignee_profile_id === myProfileId) : requests;
    return base;
  }, [isReviewer, myProfileId, requests]);

  const kpis = useMemo(() => {
    const total = visibleRequests.length;
    const inProgress = visibleRequests.filter((r) => r.status === 'in_review').length;
    const pending = visibleRequests.filter((r) => r.status === 'submitted').length;
    const rejected = visibleRequests.filter((r) => r.status === 'rejected').length;
    return [
      { label: t('daf_kpi_total') || 'Demandes', value: total, icon: 'fa-wrench', color: 'bg-lime-500' },
      { label: t('daf_kpi_queue') || 'En attente', value: pending, icon: 'fa-clock', color: 'bg-amber-500' },
      { label: t('daf_kpi_in_progress') || 'En cours', value: inProgress, icon: 'fa-spinner', color: 'bg-blue-500' },
      { label: t('daf_kpi_rejected') || 'Rejetées', value: rejected, icon: 'fa-triangle-exclamation', color: 'bg-red-500' },
    ];
  }, [t, visibleRequests]);

  const statusBadge = (s: DafRequestStatus) => {
    const label = statusLabel(s);
    const cls =
      s === 'approved'
        ? 'bg-green-100 text-green-700'
        : s === 'in_review'
          ? 'bg-blue-100 text-blue-700'
          : s === 'submitted'
            ? 'bg-amber-100 text-amber-700'
            : s === 'rejected'
              ? 'bg-red-100 text-red-700'
              : 'bg-gray-100 text-gray-600';
    return <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{label}</span>;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-gray-900">{t('daf_services') || 'Moyens Généraux'}</h2>
          <p className="text-gray-500 text-sm">{t('daf_services_subtitle') || 'Gestion des installations et équipements'}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreateOpen((v) => !v)}
          className="flex items-center gap-2 bg-[#0d1b2a] text-white px-4 py-2.5 rounded-xl hover:bg-[#1a3a5c] transition-colors text-sm"
        >
          <i className="fas fa-plus w-4 h-4" />
          {t('daf_new_request') || 'Nouvelle Intervention'}
        </button>
      </div>

      <ModuleRichHub
        isFr={language === Language.FR}
        metrics={kpis.map((k) => ({
          labelFr: k.label,
          labelEn: k.label,
          value: String(k.value),
          hintFr: 'Indicateur interventions',
          hintEn: 'Interventions KPI',
        }))}
        sections={[
          {
            key: 'daf',
            titleFr: 'Moyens généraux & chaîne de service',
            titleEn: 'General services & service chain',
            icon: 'fas fa-clipboard-check',
            bulletsFr: [
              'Logistique pour le stock matériel détaillé ; DAF pour les demandes transverses.',
              'Parc Auto pour les déplacements ; Ticket IT pour le numérique.',
              'Collecte pour les besoins terrain remontés vers le CRM.',
            ],
            bulletsEn: [
              'Logistics for detailed stock; DAF for cross-cutting requests.',
              'Fleet for travel; IT tickets for digital issues.',
              'Collecte for field needs surfaced to CRM.',
            ],
          },
        ]}
      />

      {errorMsg && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMsg}</div>
      )}

      {createOpen && (
        <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-gray-900">{t('daf_new_request') || 'Nouvelle Intervention'}</h3>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="text-gray-400 hover:text-gray-700 transition-colors"
              aria-label={t('close') || 'Fermer'}
            >
              <i className="fas fa-xmark" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('daf_title_field')}</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0d1b2a]/10"
                disabled={saving}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('daf_request_kind')}</label>
              <select
                value={requestKind}
                onChange={(e) => setRequestKind(e.target.value as DafRequestKind)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-gray-50"
                disabled={saving}
              >
                {KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {t(k.labelKey)}
                  </option>
                ))}
              </select>
              <p className="text-[10px] text-gray-400 mt-1 leading-snug">{t('daf_request_kind_help')}</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('daf_category')}</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as DafRequestCategory)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-gray-50"
                disabled={saving}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.labelFr}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">{t('daf_description')}</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm bg-gray-50"
                disabled={saving}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onSave('draft')}
              disabled={saving}
              className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              {t('daf_save_draft')}
            </button>
            <button
              type="button"
              onClick={() => void onSave('submitted')}
              disabled={saving}
              className="rounded-xl bg-[#0d1b2a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3a5c] disabled:opacity-50"
            >
              {t('daf_submit')}
            </button>
          </div>
        </section>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
            <div className={`w-10 h-10 ${k.color} rounded-xl flex items-center justify-center mb-4`}>
              <i className={`fas ${k.icon} text-white`} />
            </div>
            <p className="text-gray-900 text-2xl font-bold">{k.value}</p>
            <p className="text-gray-500 text-xs mt-1">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {(['equipements', 'sites', 'interventions'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              tab === id ? 'bg-white text-gray-900 shadow-sm font-medium' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {id === 'equipements' ? 'Équipements' : id === 'sites' ? 'Sites & Locaux' : 'Interventions'}
          </button>
        ))}
      </div>

      {tab !== 'interventions' && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-100 text-sm text-gray-500">
          {t('coming_soon') || 'À venir.'}
        </div>
      )}

      {tab === 'interventions' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-gray-900">{isReviewer ? t('daf_queue_org') : t('daf_my_requests')}</h3>
            <span className="text-xs text-gray-400">{loading ? '…' : `${visibleRequests.length}`}</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-gray-500 text-sm">…</div>
          ) : visibleRequests.length === 0 ? (
            <div className="p-8 text-center text-gray-500 text-sm">{t('daf_empty_list')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    {['Référence', 'Objet', 'Type', 'Date', 'Affectation', 'Statut'].map((h) => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRequests.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-gray-50 hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setDetail(r)}
                    >
                      <td className="px-5 py-4 text-xs text-gray-500 font-mono">
                        {String(r.id).slice(0, 8).toUpperCase()}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-800">{r.title}</td>
                      <td className="px-5 py-4 text-sm text-gray-600">
                        {kindLabel(r.request_kind)} · {CATEGORIES.find((c) => c.id === r.category)?.labelFr ?? r.category}
                      </td>
                      <td className="px-5 py-4 text-xs text-gray-500">
                        {new Date(r.created_at).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-GB')}
                      </td>
                      <td className="px-5 py-4 text-sm text-gray-600">{assignmentLabel(r) ?? '—'}</td>
                      <td className="px-5 py-4">{statusBadge(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <DafRequestDetailModal
        request={detail}
        open={!!detail}
        onClose={() => setDetail(null)}
        onUpdated={() => void load()}
        language={language === Language.EN ? 'en' : 'fr'}
        t={t}
        isReviewer={isReviewer}
        myProfileId={myProfileId}
      />
    </div>
  );
};

export default DafServicesModule;
