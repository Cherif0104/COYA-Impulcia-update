import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import {
  NAV_QUERY_MOBILITE_PROGRAMME_ID,
  NAV_QUERY_MOBILITE_PROJECT_ID,
  NAV_SESSION_MOBILITE_FILTER_PROGRAMME_ID,
  NAV_SESSION_MOBILITE_FILTER_PROJECT_ID,
  NAV_SESSION_MOBILITE_INTENT,
  useAppNavigation,
} from '../contexts/AppNavigationContext';
import { useModulePermissions } from '../hooks/useModulePermissions';
import {
  Language,
  type MobilityIntentRoute,
  type MobilityRequest,
  type MobilityTripType,
  type Programme,
} from '../types';
import type { OrgProjectRow, ProfileOption } from '../services/parcAutoService';
import { suggestMobilityIntentRoute } from '../utils/mobilityRoutingSuggestion';
import { useAuth } from '../contexts/AuthContextSupabase';
import { isSupabaseConfigured } from '../services/supabaseService';

function readFilterIdsFromLocation(): { projectId: string | null; programmeId: string | null } {
  let projectId: string | null = null;
  let programmeId: string | null = null;
  try {
    const u = new URL(window.location.href);
    projectId = u.searchParams.get(NAV_QUERY_MOBILITE_PROJECT_ID);
    programmeId = u.searchParams.get(NAV_QUERY_MOBILITE_PROGRAMME_ID);
  } catch {
    /* ignore */
  }
  if (!projectId) {
    try {
      projectId = sessionStorage.getItem(NAV_SESSION_MOBILITE_FILTER_PROJECT_ID);
    } catch {
      /* ignore */
    }
  }
  if (!programmeId) {
    try {
      programmeId = sessionStorage.getItem(NAV_SESSION_MOBILITE_FILTER_PROGRAMME_ID);
    } catch {
      /* ignore */
    }
  }
  try {
    sessionStorage.removeItem(NAV_SESSION_MOBILITE_FILTER_PROJECT_ID);
    sessionStorage.removeItem(NAV_SESSION_MOBILITE_FILTER_PROGRAMME_ID);
  } catch {
    /* ignore */
  }
  return { projectId, programmeId };
}

function clearMobilityQueryParams() {
  try {
    const u = new URL(window.location.href);
    u.searchParams.delete(NAV_QUERY_MOBILITE_PROJECT_ID);
    u.searchParams.delete(NAV_QUERY_MOBILITE_PROGRAMME_ID);
    window.history.replaceState({}, '', u.toString());
  } catch {
    /* ignore */
  }
}

const MobiliteRequestHub: React.FC = () => {
  const { language, t } = useLocalization();
  const nav = useAppNavigation();
  const { canAccessModule } = useModulePermissions();
  const { user } = useAuth();
  const isFr = language === Language.FR;
  const setView = nav?.setView;

  const canInternal = canAccessModule('parc_auto');
  const canExternal = canAccessModule('logistique');

  const [orgId, setOrgId] = useState<string | null>(null);
  const [list, setList] = useState<MobilityRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProjectId, setFilterProjectId] = useState<string | null>(null);
  const [filterProgrammeId, setFilterProgrammeId] = useState<string | null>(null);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [projects, setProjects] = useState<OrgProjectRow[]>([]);
  const [profileOptions, setProfileOptions] = useState<ProfileOption[]>([]);

  const [selected, setSelected] = useState<MobilityRequest | null>(null);
  const [creating, setCreating] = useState(false);

  const [formTitle, setFormTitle] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formPassengers, setFormPassengers] = useState(1);
  const [formTripType, setFormTripType] = useState<MobilityTripType>('mission');
  const [formIntent, setFormIntent] = useState<MobilityIntentRoute | null>(() =>
    suggestMobilityIntentRoute(1, 'mission'),
  );
  const [formProjectId, setFormProjectId] = useState('');
  const [formProgrammeId, setFormProgrammeId] = useState('');
  const [formParticipants, setFormParticipants] = useState<string[]>([]);

  const suggestedRoute = useMemo(
    () => suggestMobilityIntentRoute(formPassengers, formTripType),
    [formPassengers, formTripType],
  );

  const loadList = useCallback(async () => {
    const oid = await OrganizationService.getCurrentUserOrganizationId();
    setOrgId(oid);
    if (!oid || !isSupabaseConfigured) {
      setList([]);
      setLoading(false);
      return;
    }
    let rows: MobilityRequest[] = [];
    if (filterProjectId) {
      rows = await mobilityRequestService.listFilteredByProjectId(oid, filterProjectId);
    } else if (filterProgrammeId) {
      rows = await mobilityRequestService.listFilteredByProgrammeId(oid, filterProgrammeId);
    } else {
      rows = await mobilityRequestService.listByOrg(oid);
    }
    setList(rows);
    setLoading(false);
  }, [filterProjectId, filterProgrammeId]);

  useEffect(() => {
    const { projectId, programmeId } = readFilterIdsFromLocation();
    setFilterProjectId(projectId);
    setFilterProgrammeId(programmeId);
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const oid = await OrganizationService.getCurrentUserOrganizationId();
      if (!oid || cancelled) return;
      const [progs, projs, approvers] = await Promise.all([
        programmeService.listProgrammes(oid),
        parcAutoService.listOrgProjects(oid),
        parcAutoService.listApproverProfileOptions(oid),
      ]);
      if (!cancelled) {
        setProgrammes(progs);
        setProjects(projs);
        setProfileOptions(approvers);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    setFormTitle(selected.title);
    setFormNotes(selected.notes ?? '');
    setFormPassengers(selected.passengerCount);
    setFormTripType(selected.tripType);
    setFormIntent(selected.intentRoute);
    setFormProjectId(selected.projectId ?? '');
    setFormProgrammeId(selected.programmeId ?? '');
    setFormParticipants(selected.participantProfileIds ?? []);
  }, [selected]);

  const filteredProjects = useMemo(() => {
    if (!formProgrammeId) return projects;
    return projects.filter((p) => p.programmeId === formProgrammeId);
  }, [projects, formProgrammeId]);

  const goInternal = useCallback(() => {
    if (!setView || !canInternal) return;
    try {
      sessionStorage.setItem(NAV_SESSION_MOBILITE_INTENT, 'internal');
    } catch {
      /* ignore */
    }
    setView('parc_auto');
  }, [setView, canInternal]);

  const goExternal = useCallback(() => {
    if (!setView || !canExternal) return;
    try {
      sessionStorage.setItem(NAV_SESSION_MOBILITE_INTENT, 'external');
    } catch {
      /* ignore */
    }
    setView('logistique');
  }, [setView, canExternal]);

  const resetFormToNew = () => {
    setSelected(null);
    setFormTitle('');
    setFormNotes('');
    setFormPassengers(1);
    setFormTripType('mission');
    setFormIntent(suggestMobilityIntentRoute(1, 'mission'));
    setFormProjectId(filterProjectId ?? '');
    setFormProgrammeId(filterProgrammeId ?? '');
    setFormParticipants([]);
  };

  const handleCreateDraft = async () => {
    const oid = orgId;
    const pid = user?.profileId;
    if (!oid || !pid) return;
    setCreating(true);
    const row = await mobilityRequestService.createDraft(oid, pid, {
      title: formTitle.trim() || (isFr ? 'Nouvelle demande' : 'New request'),
      notes: formNotes.trim() || null,
      passengerCount: formPassengers,
      tripType: formTripType,
      intentRoute: formIntent,
      projectId: formProjectId || null,
      programmeId: formProgrammeId || null,
      participantProfileIds: formParticipants,
    });
    setCreating(false);
    if (row) {
      setList((prev) => [row, ...prev]);
      setSelected(row);
    }
  };

  const handleSaveDraft = async () => {
    if (!selected || selected.status !== 'draft') return;
    const row = await mobilityRequestService.updateDraft(selected.id, {
      title: formTitle,
      notes: formNotes,
      passengerCount: formPassengers,
      tripType: formTripType,
      intentRoute: formIntent,
      projectId: formProjectId || null,
      programmeId: formProgrammeId || null,
      participantProfileIds: formParticipants,
    });
    if (row) {
      setSelected(row);
      setList((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    }
  };

  const handleSubmit = async () => {
    if (!selected || selected.status !== 'draft') return;
    const saved = await mobilityRequestService.updateDraft(selected.id, {
      title: formTitle,
      notes: formNotes,
      passengerCount: formPassengers,
      tripType: formTripType,
      intentRoute: formIntent,
      projectId: formProjectId || null,
      programmeId: formProgrammeId || null,
      participantProfileIds: formParticipants,
    });
    if (!saved) return;
    setSelected(saved);
    setList((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    const row = await mobilityRequestService.submit(saved.id);
    if (!row) return;
    setSelected(row);
    setList((prev) => prev.map((x) => (x.id === row.id ? row : x)));
    const route = formIntent ?? row.intentRoute;
    if (route && setView) {
      try {
        sessionStorage.setItem(NAV_SESSION_MOBILITE_INTENT, route);
      } catch {
        /* ignore */
      }
      if (route === 'internal' && canInternal) setView('parc_auto');
      else if (route === 'external' && canExternal) setView('logistique');
    }
  };

  const clearFilters = () => {
    setFilterProjectId(null);
    setFilterProgrammeId(null);
    clearMobilityQueryParams();
    void loadList();
  };

  const hintHeuristic = useMemo(
    () => (isFr ? t('mobility_hub_hint_heuristic_fr') : t('mobility_hub_hint_heuristic_en')),
    [isFr, t],
  );

  const supabaseOff = !isSupabaseConfigured;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10 space-y-8">
      <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-6 shadow-sm md:p-8">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--coya-institutional)]">
          {t('mobility_hub_kicker')}
        </p>
        <h2 className="mt-2 text-xl font-semibold text-slate-900 md:text-2xl">{t('mobility_hub_title')}</h2>
        <p className="mt-3 text-sm leading-relaxed text-slate-600">{t('mobility_hub_intro')}</p>
        <p className="mt-2 text-xs text-slate-500">{hintHeuristic}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <button
            type="button"
            disabled={!canInternal || !setView}
            onClick={goInternal}
            className="flex flex-col items-start gap-2 rounded-xl border-2 border-[var(--coya-institutional)] bg-gradient-to-br from-emerald-50/80 to-white px-4 py-4 text-left shadow-sm transition hover:border-[var(--coya-institutional-secondary)] hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--coya-institutional)]">
              <i className="fas fa-car w-5 text-center text-base" aria-hidden />
              {t('mobility_hub_card_internal_title')}
            </span>
            <span className="text-xs text-slate-600">{t('mobility_hub_card_internal_body')}</span>
          </button>

          <button
            type="button"
            disabled={!canExternal || !setView}
            onClick={goExternal}
            className="flex flex-col items-start gap-2 rounded-xl border-2 border-teal-600/35 bg-gradient-to-br from-teal-50/60 to-white px-4 py-4 text-left shadow-sm transition hover:border-teal-600/55 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-teal-800">
              <i className="fas fa-boxes w-5 text-center text-base" aria-hidden />
              {t('mobility_hub_card_external_title')}
            </span>
            <span className="text-xs text-slate-600">{t('mobility_hub_card_external_body')}</span>
          </button>
        </div>

        {!setView ? (
          <p className="mt-6 text-xs text-amber-700">{t('mobility_hub_nav_unavailable')}</p>
        ) : null}
      </div>

      {(filterProjectId || filterProgrammeId) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-950">
          <span>
            {filterProjectId ? (
              <>
                {t('mobility_hub_filter_project')}: <code className="text-xs">{filterProjectId}</code>
              </>
            ) : null}
            {filterProjectId && filterProgrammeId ? ' · ' : null}
            {filterProgrammeId ? (
              <>
                {t('mobility_hub_filter_programme')}: <code className="text-xs">{filterProgrammeId}</code>
              </>
            ) : null}
          </span>
          <button type="button" className="text-xs font-semibold underline" onClick={clearFilters}>
            {t('mobility_hub_clear_filters')}
          </button>
        </div>
      )}

      {supabaseOff ? (
        <p className="text-sm text-amber-800">{t('mobility_hub_supabase_required')}</p>
      ) : null}

      <section className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-slate-900">{t('mobility_hub_list_title')}</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-3d-secondary text-sm"
              onClick={() => {
                resetFormToNew();
              }}
            >
              {t('mobility_hub_new_form')}
            </button>
            {!selected ? (
              <button
                type="button"
                className="btn-3d-primary text-sm"
                disabled={creating || !user?.profileId || !orgId}
                onClick={() => void handleCreateDraft()}
              >
                {t('mobility_hub_create_draft')}
              </button>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="mt-4 text-sm text-slate-500">{t('mobility_hub_loading')}</p>
        ) : list.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t('mobility_hub_empty_list')}</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {list.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-900">{r.title || r.id.slice(0, 8)}</div>
                  <div className="text-xs text-slate-500">
                    {r.status === 'draft' ? t('mobility_status_draft') : t('mobility_status_submitted')}
                    {r.intentRoute ? ` · ${r.intentRoute}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-sm text-emerald-700 underline"
                  onClick={() => setSelected(r)}
                >
                  {r.status === 'draft' ? t('mobility_hub_open_edit') : t('mobility_hub_open_view')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-6 shadow-sm space-y-4">
        <h3 className="text-lg font-semibold text-slate-900">{t('mobility_hub_form_section_title')}</h3>

        <div className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('mobility_field_title')}</label>
            <input
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={formTitle}
              onChange={(e) => setFormTitle(e.target.value)}
              placeholder={t('mobility_field_title_ph')}
            />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('mobility_field_notes')}</label>
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              rows={2}
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('mobility_field_passengers')}</label>
            <input
              type="number"
              min={1}
              max={999}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              value={formPassengers}
              onChange={(e) => setFormPassengers(Math.max(1, parseInt(e.target.value, 10) || 1))}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('mobility_field_trip_type')}</label>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={formTripType}
              onChange={(e) => setFormTripType(e.target.value as MobilityTripType)}
            >
              <option value="mission">{t('mobility_trip_mission')}</option>
              <option value="course">{t('mobility_trip_course')}</option>
              <option value="autre">{t('mobility_trip_other')}</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/80 p-3 text-sm">
          <div className="text-xs font-semibold text-slate-700 mb-2">{t('mobility_suggestion_title')}</div>
          <p className="text-xs text-slate-600 mb-2">{t('mobility_suggestion_body')}</p>
          <p className="text-xs text-emerald-800 font-medium">
            {t('mobility_suggestion_value')}{' '}
            {suggestedRoute === 'internal' ? t('mobility_route_internal') : t('mobility_route_external')}
          </p>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-700 mb-2">{t('mobility_route_choice')}</div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="mobility-intent"
                checked={formIntent === 'internal'}
                onChange={() => setFormIntent('internal')}
              />
              {t('mobility_route_internal')}
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="radio"
                name="mobility-intent"
                checked={formIntent === 'external'}
                onChange={() => setFormIntent('external')}
              />
              {t('mobility_route_external')}
            </label>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('mobility_field_programme')}</label>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={formProgrammeId}
              onChange={(e) => {
                setFormProgrammeId(e.target.value);
                setFormProjectId('');
              }}
            >
              <option value="">{t('mobility_field_optional')}</option>
              {programmes.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">{t('mobility_field_project')}</label>
            <select
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
              value={formProjectId}
              onChange={(e) => setFormProjectId(e.target.value)}
            >
              <option value="">{t('mobility_field_optional')}</option>
              {filteredProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">{t('mobility_field_participants')}</label>
          <select
            multiple
            className="w-full min-h-[120px] rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white"
            value={formParticipants}
            onChange={(e) => {
              const opts = Array.from(e.target.selectedOptions).map((o) => o.value);
              setFormParticipants(opts);
            }}
          >
            {profileOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {(p.fullName || p.email || p.id).slice(0, 80)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[10px] text-slate-500">{t('mobility_participants_helper')}</p>
        </div>

        <div className="flex flex-wrap gap-2 pt-2">
          {selected?.status === 'draft' ? (
            <>
              <button type="button" className="btn-3d-secondary text-sm" onClick={() => void handleSaveDraft()}>
                {t('mobility_save_draft')}
              </button>
              <button type="button" className="btn-3d-primary text-sm" onClick={() => void handleSubmit()}>
                {t('mobility_submit')}
              </button>
            </>
          ) : selected?.status === 'submitted' ? (
            <p className="text-sm text-slate-600">{t('mobility_readonly_submitted')}</p>
          ) : (
            <button
              type="button"
              className="btn-3d-primary text-sm"
              disabled={creating || !user?.profileId || !orgId}
              onClick={() => void handleCreateDraft()}
            >
              {t('mobility_hub_create_draft')}
            </button>
          )}
        </div>
      </section>
    </div>
  );
};

export default MobiliteRequestHub;
