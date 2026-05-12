import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import {
  DataCollection,
  DataCollectionAssignment,
  DataCollectionSubmission,
  Language,
  Course,
  Project,
  Programme,
  ProjectActivity,
} from '../types';
import OrganizationService from '../services/organizationService';
import DataAdapter from '../services/dataAdapter';
import * as programmeService from '../services/programmeService';
import * as dataCollectionService from '../services/dataCollectionService';
import {
  addCustomEntity,
  defaultCollecteCategoryKey,
  deleteCustomEntity,
  isCustomAssignmentCategory,
  listCollecteCategories,
  listCustomEntities,
  registerCollecteCategory,
  unregisterCollecteCategory,
} from '../modules/collecte-rattachement';
import {
  useAppNavigation,
  NAV_SESSION_OPEN_PROGRAMME_ID,
  NAV_SESSION_OPEN_PROGRAMME_DETAIL_TAB,
  NAV_SESSION_COLLECTE_PRESET_PROGRAMME_ID,
  NAV_SESSION_COLLECTE_PRESET_FORMATION_ID,
  NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID,
  NAV_SESSION_CRM_FILTER_SOURCE_COLLECTION_ID,
} from '../contexts/AppNavigationContext';
import { dispatchCrmOutboundEvent } from '../services/crmIntegrationHub';
import {
  COLLECTE_PARTICIPANT_FIELD_DEFS,
  CollecteParticipantFieldDef,
  CollecteParticipantFieldGroup,
  collecteGroupLabel,
  emptyParticipantPayload,
} from '../utils/collecteParticipantFields';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { Input } from './ui/Input';
import { cn } from './ui/cn';
import ModuleRichHub from './common/ModuleRichHub';

function makeId(): string {
  try {
    // randomUUID n'existe pas partout (selon navigateur / contexte).
    const anyCrypto = (globalThis as any).crypto;
    if (anyCrypto?.randomUUID) return anyCrypto.randomUUID();
  } catch {
    /* ignore */
  }
  return `dc_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const CollecteModule: React.FC<{ embeddedInCrm?: boolean; onAfterCrmBulkSync?: () => void }> = ({
  embeddedInCrm = false,
  onAfterCrmBulkSync,
}) => {
  const { language, t } = useLocalization();
  const isFr = language === Language.FR;
  const [orgId, setOrgId] = useState<string | null>(null);
  const [collections, setCollections] = useState<DataCollection[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [categoryKey, setCategoryKey] = useState<string>(() => defaultCollecteCategoryKey());
  const [assignTargetId, setAssignTargetId] = useState('');
  const [collectActivityId, setCollectActivityId] = useState('');
  const [projectActivitiesForCollect, setProjectActivitiesForCollect] = useState<ProjectActivity[]>([]);
  const [filterKind, setFilterKind] = useState<'all' | string>('all');
  const [categoriesTick, setCategoriesTick] = useState(0);
  const [newCategoryKey, setNewCategoryKey] = useState('');
  const [newCategoryLabelFr, setNewCategoryLabelFr] = useState('');
  const [newCategoryLabelEn, setNewCategoryLabelEn] = useState('');
  const [quickCreateName, setQuickCreateName] = useState('');
  const [subCollectionId, setSubCollectionId] = useState('');
  const [participantPayload, setParticipantPayload] = useState<Record<string, string>>(() =>
    emptyParticipantPayload(),
  );
  const [crmBulkMsg, setCrmBulkMsg] = useState<string | null>(null);
  const [crmBulkLoading, setCrmBulkLoading] = useState(false);
  const [submissionsTick, setSubmissionsTick] = useState(0);
  const [activeTab, setActiveTab] = useState<'campaigns' | 'create' | 'submissions'>('campaigns');
  const [listQuery, setListQuery] = useState('');
  const [showAdvancedCatPanel, setShowAdvancedCatPanel] = useState(false);
  const [participantGroupOpen, setParticipantGroupOpen] = useState<Record<CollecteParticipantFieldGroup, boolean>>({
    identity: true,
    contact: true,
    location: false,
    socio: false,
    enterprise: false,
    other: false,
  });
  const [submissionFormError, setSubmissionFormError] = useState<string | null>(null);
  const nav = useAppNavigation();

  const categoryMetas = useMemo(() => {
    void categoriesTick;
    return listCollecteCategories(orgId);
  }, [orgId, categoriesTick]);

  const refresh = useCallback(() => {
    setCollections(dataCollectionService.listDataCollections(orgId));
  }, [orgId]);

  useEffect(() => {
    OrganizationService.getCurrentUserOrganizationId()
      .then(setOrgId)
      .catch(() => setOrgId(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Navigation depuis Programme → onglet Collecte : préremplir rattachement « programme ». */
  useEffect(() => {
    if (!orgId) return;
    try {
      const raw = sessionStorage.getItem(NAV_SESSION_COLLECTE_PRESET_PROGRAMME_ID);
      if (!raw) return;
      sessionStorage.removeItem(NAV_SESSION_COLLECTE_PRESET_PROGRAMME_ID);
      setCategoryKey('programme');
      setAssignTargetId(raw);
      setCollectActivityId('');
      setFilterKind('programme');
      setActiveTab('create');
    } catch {
      /* ignore */
    }
  }, [orgId]);

  /** Navigation depuis Studio formation / CRM : rattachement « cours » présélectionné. */
  useEffect(() => {
    if (!orgId) return;
    try {
      const raw = sessionStorage.getItem(NAV_SESSION_COLLECTE_PRESET_FORMATION_ID);
      if (!raw) return;
      sessionStorage.removeItem(NAV_SESSION_COLLECTE_PRESET_FORMATION_ID);
      setCategoryKey('formation');
      setAssignTargetId(raw);
      setCollectActivityId('');
      setFilterKind('formation');
      setActiveTab('create');
    } catch {
      /* ignore */
    }
  }, [orgId]);

  /** Navigation depuis CRM : préremplir la campagne dans la zone soumissions → CRM. */
  useEffect(() => {
    if (!orgId) return;
    try {
      const raw = sessionStorage.getItem(NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID);
      if (!raw) return;
      sessionStorage.removeItem(NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID);
      setSubCollectionId(raw);
      setActiveTab('submissions');
    } catch {
      /* ignore */
    }
  }, [orgId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [pList, prList, cList] = await Promise.all([
        DataAdapter.getProjects(),
        programmeService.listProgrammes(orgId ?? undefined),
        DataAdapter.getCourses(),
      ]);
      if (!cancelled) {
        setProjects(pList);
        setProgrammes(prList);
        setCourses(cList);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (projects.length === 0) return;
    const updated = dataCollectionService.backfillProgrammeIdsFromProjects(
      projects.map((p) => ({ id: String(p.id), programmeId: p.programmeId ?? null })),
    );
    if (updated > 0) refresh();
  }, [projects, refresh]);

  useEffect(() => {
    if (categoryKey !== 'project' || !assignTargetId) {
      setProjectActivitiesForCollect([]);
      setCollectActivityId('');
      return;
    }
    let cancelled = false;
    programmeService.listProjectActivities(assignTargetId).then((list) => {
      if (!cancelled) setProjectActivitiesForCollect(list);
    });
    return () => {
      cancelled = true;
    };
  }, [assignTargetId, categoryKey]);

  const submissionCounts = useMemo(() => {
    const subs = dataCollectionService.listSubmissionsForOrg(orgId);
    const m: Record<string, number> = {};
    subs.forEach((s) => {
      m[s.collectionId] = (m[s.collectionId] || 0) + 1;
    });
    return m;
  }, [orgId, submissionsTick]);

  const submissionsCrmStats = useMemo(() => {
    const m: Record<string, { total: number; synced: number }> = {};
    collections.forEach((c) => {
      const subs = dataCollectionService.listSubmissionsForCollection(c.id);
      m[c.id] = {
        total: subs.length,
        synced: subs.filter((s) => s.syncedToCrm).length,
      };
    });
    return m;
  }, [collections, submissionsTick]);

  const totalSubmissionsCount = useMemo(() => {
    return dataCollectionService.listSubmissionsForOrg(orgId).length;
  }, [orgId, submissionsTick]);

  const pendingCrmSyncCount = useMemo(() => {
    return dataCollectionService.listSubmissionsForOrg(orgId).filter((s) => !s.syncedToCrm).length;
  }, [orgId, submissionsTick]);

  const filteredList = useMemo(() => {
    if (filterKind === 'all') return collections;
    return collections.filter((c) => {
      const key = c.assignment?.categoryKey;
      if (key) return key === filterKind;
      if (filterKind === 'project') return !!c.projectId;
      if (filterKind === 'programme') return !!c.programmeId;
      if (filterKind === 'formation') return !!c.formationId;
      return false;
    });
  }, [collections, filterKind]);

  const customEntitiesForCategory = useMemo(
    () => (isCustomAssignmentCategory(categoryKey) ? listCustomEntities(orgId, categoryKey) : []),
    [orgId, categoryKey, categoriesTick],
  );

  const fieldsByGroup = useMemo(() => {
    const m = new Map<CollecteParticipantFieldGroup, CollecteParticipantFieldDef[]>();
    COLLECTE_PARTICIPANT_FIELD_DEFS.forEach((d) => {
      const list = m.get(d.group) || [];
      list.push(d);
      m.set(d.group, list);
    });
    return m;
  }, []);

  const setParticipantField = (key: string, value: string) => {
    setParticipantPayload((prev) => ({ ...prev, [key]: value }));
  };

  const renderParticipantControl = (d: CollecteParticipantFieldDef): React.ReactNode => {
    const label = isFr ? d.labelFr : d.labelEn;
    const value = participantPayload[d.key] ?? '';
    const spanClass =
      d.gridSpan === 3 ? 'md:col-span-2 lg:col-span-3' : d.gridSpan === 2 ? 'md:col-span-2' : '';
    const id = `collecte-field-${d.key}`;

    const wrap = (inner: React.ReactNode) => (
      <div key={d.key} className={spanClass || undefined}>
        <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1">
          {label}
        </label>
        {inner}
      </div>
    );

    if (d.type === 'select') {
      const opts = isFr ? d.optionsFr ?? [] : d.optionsEn ?? [];
      return wrap(
        <select
          id={id}
          className="coya-select w-full"
          value={value}
          onChange={(e) => setParticipantField(d.key, e.target.value)}
        >
          {opts.map((opt, i) => (
            <option key={`${d.key}-opt-${i}`} value={opt}>
              {opt || (isFr ? '—' : '—')}
            </option>
          ))}
        </select>,
      );
    }

    if (d.type === 'textarea') {
      return wrap(
        <textarea
          id={id}
          rows={4}
          className="coya-input w-full min-h-[100px] resize-y"
          value={value}
          onChange={(e) => setParticipantField(d.key, e.target.value)}
        />,
      );
    }

    const inputType =
      d.type === 'number'
        ? 'number'
        : d.type === 'email'
          ? 'email'
          : d.type === 'tel'
            ? 'tel'
            : d.type === 'date'
              ? 'date'
              : 'text';

    return wrap(
      <input
        id={id}
        type={inputType}
        className="coya-input w-full"
        value={value}
        onChange={(e) => setParticipantField(d.key, e.target.value)}
      />,
    );
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setCategoryKey(defaultCollecteCategoryKey());
    setAssignTargetId('');
    setCollectActivityId('');
    setQuickCreateName('');
  };

  const resolveTargetLabel = (): string | undefined => {
    if (!assignTargetId) return undefined;
    if (categoryKey === 'project') {
      return projects.find((p) => String(p.id) === String(assignTargetId))?.title;
    }
    if (categoryKey === 'programme') {
      return programmes.find((p) => p.id === assignTargetId)?.name;
    }
    if (categoryKey === 'formation') {
      return courses.find((c) => c.id === assignTargetId)?.title;
    }
    return listCustomEntities(orgId, categoryKey).find((e) => e.id === assignTargetId)?.name;
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!assignTargetId) return;
    const tid = makeId();
    const now = new Date().toISOString();
    const assignment: DataCollectionAssignment = {
      categoryKey,
      targetId: assignTargetId,
      targetLabel: resolveTargetLabel(),
      activityId: categoryKey === 'project' ? collectActivityId || null : null,
    };
    const proj =
      categoryKey === 'project' ? projects.find((p) => String(p.id) === String(assignTargetId)) : undefined;
    const base: DataCollection = {
      id: tid,
      organizationId: orgId,
      name: name.trim(),
      description: description.trim() || undefined,
      status: 'active',
      linkedToCrm: false,
      reusedFromCollecteId: null,
      createdAt: now,
      updatedAt: now,
      assignment,
      projectId: null,
      programmeId: categoryKey === 'project' ? proj?.programmeId ?? null : null,
      formationId: null,
      activityId: categoryKey === 'project' ? collectActivityId || null : null,
    };
    dataCollectionService.upsertDataCollection(base);
    refresh();
    resetForm();
    setActiveTab('campaigns');
  };

  const duplicateForReuse = (src: DataCollection) => {
    const tid = makeId();
    const now = new Date().toISOString();
    let programmeIdCopy = src.programmeId ?? null;
    if (src.projectId) {
      const p = projects.find((x) => String(x.id) === String(src.projectId));
      programmeIdCopy = p?.programmeId ?? programmeIdCopy;
    }
    const assignmentCopy = src.assignment
      ? { ...src.assignment }
      : src.projectId
        ? { categoryKey: 'project' as const, targetId: String(src.projectId), activityId: src.activityId ?? null }
        : src.programmeId
          ? { categoryKey: 'programme' as const, targetId: String(src.programmeId) }
          : src.formationId
            ? { categoryKey: 'formation' as const, targetId: String(src.formationId) }
            : null;
    const copy: DataCollection = {
      ...src,
      id: tid,
      name: `${src.name} (${isFr ? 'copie' : 'copy'})`,
      linkedToCrm: false,
      reusedFromCollecteId: src.id,
      createdAt: now,
      updatedAt: now,
      programmeId: programmeIdCopy,
      assignment: assignmentCopy,
    };
    dataCollectionService.upsertDataCollection(copy);
    refresh();
  };

  const markCrm = (id: string) => {
    dataCollectionService.markDataCollectionLinkedToCrm(id);
    refresh();
  };

  const remove = (id: string) => {
    if (!confirm(t('collecte_delete_collection_confirm'))) return;
    dataCollectionService.deleteDataCollection(id);
    refresh();
  };

  const labelForCollection = (c: DataCollection) => {
    const ak = c.assignment?.categoryKey;
    if (ak && c.assignment?.targetId) {
      const meta = categoryMetas.find((m) => m.key === ak);
      const cat = isFr ? meta?.labelFr ?? ak : meta?.labelEn ?? ak;
      const label =
        c.assignment.targetLabel ||
        (ak === 'project'
          ? projects.find((x) => String(x.id) === String(c.assignment!.targetId))?.title
          : ak === 'programme'
            ? programmes.find((x) => x.id === c.assignment!.targetId)?.name
            : ak === 'formation'
              ? courses.find((x) => x.id === c.assignment!.targetId)?.title
              : listCustomEntities(c.organizationId, ak).find((e) => e.id === c.assignment!.targetId)?.name);
      const base = `${cat} : ${label ?? c.assignment.targetId}`;
      if (ak === 'project' && c.activityId) {
        const act =
          String(c.projectId) === String(c.assignment.targetId)
            ? projectActivitiesForCollect.find((a) => a.id === c.activityId)?.title
            : null;
        const actLabel = act || `#${String(c.activityId).slice(0, 8)}`;
        return isFr ? `${base} · Activité : ${actLabel}` : `${base} · Activity: ${actLabel}`;
      }
      return base;
    }
    if (c.projectId) {
      const p = projects.find((x) => String(x.id) === String(c.projectId));
      const base = isFr ? `Projet : ${p?.title ?? c.projectId}` : `Project: ${p?.title ?? c.projectId}`;
      let withProg = base;
      if (c.programmeId) {
        const pr = programmes.find((x) => x.id === c.programmeId);
        const pn = pr?.name ?? String(c.programmeId).slice(0, 8);
        withProg = isFr ? `${base} · Programme : ${pn}` : `${base} · Programme: ${pn}`;
      }
      if (c.activityId) {
        const title =
          String(c.projectId) === String(assignTargetId) && categoryKey === 'project'
            ? projectActivitiesForCollect.find((a) => a.id === c.activityId)?.title
            : null;
        const act = title || `#${String(c.activityId).slice(0, 8)}`;
        return isFr ? `${withProg} · Activité : ${act}` : `${withProg} · Activity: ${act}`;
      }
      return withProg;
    }
    if (c.programmeId) {
      const pr = programmes.find((x) => x.id === c.programmeId);
      return isFr ? `Programme : ${pr?.name ?? c.programmeId}` : `Programme: ${pr?.name ?? c.programmeId}`;
    }
    if (c.formationId) {
      const cr = courses.find((x) => x.id === c.formationId);
      return isFr ? `Formation (cours) : ${cr?.title ?? c.formationId}` : `Course: ${cr?.title ?? c.formationId}`;
    }
    return isFr ? 'Non rattachée' : 'Unassigned';
  };

  const handleRegisterCategory = () => {
    const row = registerCollecteCategory(
      orgId,
      newCategoryKey || newCategoryLabelFr,
      newCategoryLabelFr,
      newCategoryLabelEn || newCategoryLabelFr,
    );
    if (!row) return;
    setCategoryKey(row.key);
    setAssignTargetId('');
    setNewCategoryKey('');
    setNewCategoryLabelFr('');
    setNewCategoryLabelEn('');
    setCategoriesTick((x) => x + 1);
  };

  const handleQuickCreateBuiltin = async () => {
    const n = quickCreateName.trim();
    if (!n) return;
    try {
      if (categoryKey === 'project') {
        const created = await DataAdapter.createProject({ title: n, description: '', status: 'Not Started' });
        if (created?.id) {
          setProjects(await DataAdapter.getProjects());
          setAssignTargetId(String(created.id));
          setQuickCreateName('');
        }
      } else if (categoryKey === 'programme') {
        const created = await programmeService.createProgramme({
          organizationId: orgId ?? null,
          name: n,
        });
        if (created?.id) {
          setProgrammes(await programmeService.listProgrammes(orgId ?? undefined));
          setAssignTargetId(created.id);
          setQuickCreateName('');
        }
      } else if (categoryKey === 'formation') {
        const created = await DataAdapter.createCourse({ title: n, description: '', status: 'draft' });
        if (created?.id) {
          setCourses(await DataAdapter.getCourses());
          setAssignTargetId(created.id);
          setQuickCreateName('');
        }
      }
    } catch (err) {
      console.warn('Collecte quick-create', err);
    }
  };

  const handleQuickCreateCustom = () => {
    const row = addCustomEntity(orgId, categoryKey, quickCreateName);
    if (!row) return;
    setAssignTargetId(row.id);
    setQuickCreateName('');
    setCategoriesTick((x) => x + 1);
  };
  const listQueryNorm = listQuery.trim().toLowerCase();
  const displayCampaigns = !listQueryNorm
    ? filteredList
    : filteredList.filter((c) =>
        `${c.name} ${labelForCollection(c)}`.toLowerCase().includes(listQueryNorm),
      );

  const tabBtn = (id: 'campaigns' | 'create' | 'submissions', label: string) => (
    <button
      type="button"
      key={id}
      className={id === activeTab ? 'coya-tabs-pill-item-active' : 'coya-tabs-pill-item'}
      onClick={() => setActiveTab(id)}
    >
      {label}
    </button>
  );

  return (
    <div
      className={cn(
        embeddedInCrm ? 'max-w-none' : 'max-w-6xl mx-auto',
        'px-4 py-6 sm:py-8 text-gray-900',
      )}
    >
      <header className="mb-6 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-50 border border-gray-100 text-gray-600">
                <i className="fas fa-clipboard-list" aria-hidden />
              </span>
              {t('collecte_page_title')}
            </h1>
            <p className="text-sm text-gray-600 mt-2 max-w-3xl leading-relaxed">{t('collecte_page_subtitle')}</p>
          </div>
        </div>
        {embeddedInCrm ? (
          <p className="text-xs font-medium text-emerald-900 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2 inline-flex items-center gap-2 max-w-full">
            <i className="fas fa-link text-emerald-700 shrink-0" aria-hidden />
            {t('collecte_embed_note')}
          </p>
        ) : null}
        {nav?.setView && categoryKey === 'programme' && assignTargetId ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              leftIcon={<i className="fas fa-table text-gray-500" aria-hidden />}
              onClick={() => {
                try {
                  sessionStorage.setItem(NAV_SESSION_OPEN_PROGRAMME_ID, assignTargetId);
                  sessionStorage.setItem(NAV_SESSION_OPEN_PROGRAMME_DETAIL_TAB, 'collecte');
                } catch {
                  /* ignore */
                }
                nav.setView('programme');
              }}
            >
              {t('collecte_programme_grid_btn')}
            </Button>
          </div>
        ) : null}
      </header>

      {!embeddedInCrm ? (
        <div className="mb-6">
          <ModuleRichHub
            isFr={isFr}
            metrics={[
              {
                labelFr: 'Campagnes',
                labelEn: 'Campaigns',
                value: String(collections.length),
                hintFr: 'Collectes actives',
                hintEn: 'Active collections',
              },
              {
                labelFr: 'Soumissions (total)',
                labelEn: 'Submissions (total)',
                value: String(totalSubmissionsCount),
                hintFr: 'Toutes campagnes',
                hintEn: 'All campaigns',
              },
              {
                labelFr: 'Catégories',
                labelEn: 'Categories',
                value: String(categoryMetas.length),
                hintFr: 'Rattachements configurés',
                hintEn: 'Configured attachments',
              },
              {
                labelFr: 'Programmes visibles',
                labelEn: 'Visible programmes',
                value: String(programmes.length),
                hintFr: 'Pour rattachement campagne',
                hintEn: 'For campaign linkage',
              },
            ]}
            sections={[
              {
                key: 'coll',
                titleFr: 'Collecte dans le parcours COYA',
                titleEn: 'Collecte in the COYA journey',
                icon: 'fas fa-poll-h',
                bulletsFr: [
                  'CRM : onglet Collecte et enrichissement des contacts.',
                  'APEX : campagnes liées aux formations pour qualifier les apprenants.',
                  'Programme : grille programme ↔ collectes synchronisées.',
                ],
                bulletsEn: [
                  'CRM: Collecte tab and contact enrichment.',
                  'APEX: campaigns tied to courses to qualify learners.',
                  'Programme: programme grid synced with collections.',
                ],
              },
            ]}
          />
        </div>
      ) : null}

      <div className={cn('coya-tabs-pill mb-6 w-full max-w-full flex-wrap sm:w-fit')}>
        {tabBtn('campaigns', t('collecte_tab_campaigns'))}
        {tabBtn('create', t('collecte_tab_create'))}
        {tabBtn('submissions', t('collecte_tab_submissions'))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0d1b2a] text-white text-sm font-bold">
              {collections.length}
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('collecte_kpi_campaigns')}</p>
              <p className="text-sm font-semibold text-gray-900">{t('collecte_kpi_campaigns_detail')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-coya-green text-white text-sm font-bold">
              {totalSubmissionsCount}
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('collecte_kpi_submissions')}</p>
              <p className="text-sm font-semibold text-gray-900">{t('collecte_kpi_submissions_detail')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-sm font-bold">
              {pendingCrmSyncCount}
            </div>
            <div>
              <p className="text-xs text-gray-500">{t('collecte_kpi_pending')}</p>
              <p className="text-sm font-semibold text-gray-900">{t('collecte_kpi_pending_detail')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {activeTab === 'campaigns' ? (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-5 sm:p-6 space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold text-gray-900">{t('collecte_list_title')}</h2>
                <div className="coya-search-bar w-full sm:max-w-xs">
                  <i className="fas fa-search text-gray-400 text-sm" aria-hidden />
                  <input
                    type="search"
                    value={listQuery}
                    onChange={(e) => setListQuery(e.target.value)}
                    placeholder={t('collecte_search_placeholder')}
                    className="bg-transparent text-sm text-gray-700 placeholder-gray-400 outline-none w-full border-0 p-0 focus:ring-0"
                  />
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">{t('collecte_filter_label')}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={filterKind === 'all' ? 'coya-chip-active' : 'coya-chip'}
                    onClick={() => setFilterKind('all')}
                  >
                    {isFr ? 'Toutes' : 'All'}
                  </button>
                  {categoryMetas.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      className={filterKind === m.key ? 'coya-chip-active' : 'coya-chip'}
                      onClick={() => setFilterKind(m.key)}
                    >
                      {isFr ? m.labelFr : m.labelEn}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {displayCampaigns.length === 0 ? (
            <EmptyState
              title={
                filteredList.length === 0
                  ? t('collecte_empty_list_title')
                  : t('collecte_empty_filter_title')
              }
              description={
                filteredList.length === 0 ? t('collecte_empty_list_desc') : t('collecte_empty_filter_desc')
              }
              icon={<i className="fas fa-folder-open" aria-hidden />}
              action={
                filteredList.length === 0
                  ? { label: t('collecte_empty_cta'), onClick: () => setActiveTab('create') }
                  : { label: t('collecte_clear_search'), variant: 'secondary', onClick: () => setListQuery('') }
              }
            />
          ) : (
            <div className="space-y-3">
              {displayCampaigns.map((c) => (
                <Card key={c.id} className="coya-card-hover">
                  <CardContent className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-gray-900 truncate">{c.name}</h3>
                      <p className="text-xs text-gray-500 mt-1 line-clamp-2">{labelForCollection(c)}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {(submissionCounts[c.id] || 0) > 0 ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                            {isFr ? 'Soumissions : ' : 'Submissions: '}
                            {submissionCounts[c.id]}
                          </span>
                        ) : null}
                        {(submissionsCrmStats[c.id]?.total ?? 0) > 0 ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-900 font-medium border border-sky-100">
                            {t('collecte_submissions_synced_ratio')}: {submissionsCrmStats[c.id]?.synced ?? 0}/
                            {submissionsCrmStats[c.id]?.total ?? 0}
                          </span>
                        ) : null}
                        {c.linkedToCrm ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-medium">
                            CRM
                          </span>
                        ) : null}
                        {c.reusedFromCollecteId ? (
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
                            {isFr ? 'Réutilisation' : 'Reused'}
                          </span>
                        ) : null}
                      </div>
                      {c.description ? <p className="text-sm text-gray-600 mt-2 line-clamp-3">{c.description}</p> : null}
                    </div>
                    <div className="flex flex-wrap gap-2 shrink-0">
                      {nav ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            try {
                              sessionStorage.setItem(NAV_SESSION_CRM_FILTER_SOURCE_COLLECTION_ID, c.id);
                            } catch {
                              /* ignore */
                            }
                            nav.setView('crm_sales');
                          }}
                        >
                          {t('collecte_open_in_crm')}
                        </Button>
                      ) : null}
                      <Button type="button" variant="secondary" size="sm" onClick={() => duplicateForReuse(c)}>
                        {isFr ? 'Dupliquer' : 'Duplicate'}
                      </Button>
                      {!c.linkedToCrm ? (
                        <Button type="button" variant="secondary" size="sm" onClick={() => markCrm(c.id)}>
                          {isFr ? 'Marquer lien CRM' : 'Mark CRM link'}
                        </Button>
                      ) : null}
                      <Button type="button" variant="danger" size="sm" onClick={() => remove(c.id)}>
                        {isFr ? 'Supprimer' : 'Delete'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {activeTab === 'create' ? (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 space-y-6">
            <Card>
              <CardContent className="p-5 sm:p-6">
                <h2 className="text-base font-semibold text-gray-900 mb-4">{t('collecte_create_title')}</h2>
                <form onSubmit={handleCreate} className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="md:col-span-2 space-y-1">
                      <label className="block text-sm font-medium text-gray-700">{isFr ? 'Nom' : 'Name'}</label>
                      <Input value={name} onChange={(e) => setName(e.target.value)} required className="w-full" />
                    </div>
                    <div className="md:col-span-2 space-y-1">
                      <label className="block text-sm font-medium text-gray-700">{isFr ? 'Description' : 'Description'}</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={3}
                        className="coya-input w-full resize-y min-h-[88px]"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 space-y-3">
                    <span className="block text-sm font-medium text-gray-800">{isFr ? 'Rattachement' : 'Assignment'}</span>
                    {categoryMetas.length > 5 ? (
                      <select
                        className="coya-select w-full"
                        value={categoryKey}
                        onChange={(e) => {
                          setCategoryKey(e.target.value);
                          setAssignTargetId('');
                          setCollectActivityId('');
                        }}
                      >
                        {categoryMetas.map((m) => (
                          <option key={m.key} value={m.key}>
                            {isFr ? m.labelFr : m.labelEn}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        {categoryMetas.map((m) => (
                          <label key={m.key} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                            <input
                              type="radio"
                              name="collecte-cat"
                              checked={categoryKey === m.key}
                              onChange={() => {
                                setCategoryKey(m.key);
                                setAssignTargetId('');
                                setCollectActivityId('');
                              }}
                              className="rounded-full border-gray-300 text-coya-green focus:ring-coya-green/30"
                            />
                            {isFr ? m.labelFr : m.labelEn}
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {categoryKey === 'project' ? (
                    <>
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700">{isFr ? 'Projet' : 'Project'}</label>
                        <select
                          value={assignTargetId}
                          onChange={(e) => setAssignTargetId(e.target.value)}
                          className="coya-select w-full"
                          required
                        >
                          <option value="">{isFr ? '— Choisir —' : '— Choose —'}</option>
                          {projects.map((p) => (
                            <option key={p.id} value={String(p.id)}>
                              {p.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                        <div className="flex-1 space-y-1">
                          <label className="block text-xs font-medium text-gray-600">
                            {isFr ? 'Créer un projet et le sélectionner' : 'Create project & select'}
                          </label>
                          <input
                            value={quickCreateName}
                            onChange={(e) => setQuickCreateName(e.target.value)}
                            className="coya-input w-full text-sm"
                            placeholder={isFr ? 'Nom du projet' : 'Project name'}
                          />
                        </div>
                        <Button type="button" variant="secondary" size="md" onClick={() => void handleQuickCreateBuiltin()}>
                          {isFr ? 'Créer & sélectionner' : 'Create & select'}
                        </Button>
                      </div>
                      {assignTargetId ? (
                        <div className="space-y-1">
                          <label className="block text-sm font-medium text-gray-700">
                            {isFr ? 'Activité de terrain (optionnel)' : 'Field activity (optional)'}
                          </label>
                          <select
                            value={collectActivityId}
                            onChange={(e) => setCollectActivityId(e.target.value)}
                            className="coya-select w-full"
                          >
                            <option value="">{isFr ? '— Tout le projet —' : '— Whole project —'}</option>
                            {projectActivitiesForCollect.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.title}
                              </option>
                            ))}
                          </select>
                          <p className="text-xs text-gray-500">
                            {isFr
                              ? 'Rattache la collecte au module Programme (Terrain) pour enrichir le suivi et le CRM.'
                              : 'Links the campaign to Programme (Field) for tracking and CRM enrichment.'}
                          </p>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {categoryKey === 'programme' ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700">{isFr ? 'Programme' : 'Programme'}</label>
                        <select
                          value={assignTargetId}
                          onChange={(e) => setAssignTargetId(e.target.value)}
                          className="coya-select w-full"
                          required
                        >
                          <option value="">{isFr ? '— Choisir —' : '— Choose —'}</option>
                          {programmes.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                        <div className="flex-1 space-y-1">
                          <label className="block text-xs font-medium text-gray-600">
                            {isFr ? 'Créer un programme et le sélectionner' : 'Create programme & select'}
                          </label>
                          <input
                            value={quickCreateName}
                            onChange={(e) => setQuickCreateName(e.target.value)}
                            className="coya-input w-full text-sm"
                            placeholder={isFr ? 'Nom du programme' : 'Programme name'}
                          />
                        </div>
                        <Button type="button" variant="secondary" size="md" onClick={() => void handleQuickCreateBuiltin()}>
                          {isFr ? 'Créer & sélectionner' : 'Create & select'}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {categoryKey === 'formation' ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700">
                          {isFr ? 'Cours / formation globale' : 'Global course'}
                        </label>
                        <select
                          value={assignTargetId}
                          onChange={(e) => setAssignTargetId(e.target.value)}
                          className="coya-select w-full"
                          required
                        >
                          <option value="">{isFr ? '— Choisir —' : '— Choose —'}</option>
                          {courses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                        <div className="flex-1 space-y-1">
                          <label className="block text-xs font-medium text-gray-600">
                            {isFr ? 'Créer un cours et le sélectionner' : 'Create course & select'}
                          </label>
                          <input
                            value={quickCreateName}
                            onChange={(e) => setQuickCreateName(e.target.value)}
                            className="coya-input w-full text-sm"
                            placeholder={isFr ? 'Titre du cours' : 'Course title'}
                          />
                        </div>
                        <Button type="button" variant="secondary" size="md" onClick={() => void handleQuickCreateBuiltin()}>
                          {isFr ? 'Créer & sélectionner' : 'Create & select'}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {isCustomAssignmentCategory(categoryKey) ? (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="block text-sm font-medium text-gray-700">{isFr ? 'Élément' : 'Record'}</label>
                        <select
                          value={assignTargetId}
                          onChange={(e) => setAssignTargetId(e.target.value)}
                          className="coya-select w-full"
                          required
                        >
                          <option value="">{isFr ? '— Choisir —' : '— Choose —'}</option>
                          {customEntitiesForCategory.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
                        <div className="flex-1 space-y-1">
                          <label className="block text-xs font-medium text-gray-600">
                            {isFr ? 'Créer et sélectionner' : 'Create & select'}
                          </label>
                          <input
                            value={quickCreateName}
                            onChange={(e) => setQuickCreateName(e.target.value)}
                            className="coya-input w-full text-sm"
                            placeholder={isFr ? 'Libellé' : 'Label'}
                          />
                        </div>
                        <Button type="button" variant="secondary" size="md" onClick={handleQuickCreateCustom}>
                          {isFr ? 'Créer & sélectionner' : 'Create & select'}
                        </Button>
                      </div>
                      {customEntitiesForCategory.length > 0 ? (
                        <div className="rounded-xl border border-gray-100 bg-white p-3">
                          <p className="text-xs font-semibold text-gray-800 mb-2">{isFr ? 'Gérer les éléments' : 'Manage records'}</p>
                          <div className="space-y-1.5">
                            {customEntitiesForCategory.map((e) => (
                              <div
                                key={e.id}
                                className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="text-sm text-gray-900 truncate">{e.name}</p>
                                  <p className="text-[11px] text-gray-500 font-mono">{e.id}</p>
                                </div>
                                <Button
                                  type="button"
                                  variant="danger"
                                  size="sm"
                                  onClick={() => {
                                    if (!window.confirm(isFr ? `Supprimer "${e.name}" ?` : `Delete "${e.name}"?`)) return;
                                    const ok = deleteCustomEntity(orgId, categoryKey, e.id);
                                    if (ok) {
                                      if (assignTargetId === e.id) setAssignTargetId('');
                                      setCategoriesTick((x) => x + 1);
                                    }
                                  }}
                                >
                                  {isFr ? 'Supprimer' : 'Delete'}
                                </Button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="border-t border-gray-100 pt-4">
                    <button
                      type="button"
                      className="text-sm font-medium text-coya-green hover:underline flex items-center gap-2"
                      onClick={() => setShowAdvancedCatPanel((v) => !v)}
                    >
                      <i className={cn('fas fa-chevron-right transition-transform', showAdvancedCatPanel && 'rotate-90')} aria-hidden />
                      {t('collecte_advanced_panel_title')}
                    </button>
                    <p className="text-xs text-gray-500 mt-1">{t('collecte_advanced_panel_hint')}</p>
                    {showAdvancedCatPanel ? (
                      <div className="mt-4 space-y-4">
                        <div className="rounded-xl border border-dashed border-gray-200 p-4 bg-gray-50/80 space-y-3">
                          <p className="text-xs font-semibold text-gray-800">
                            {isFr ? 'Nouvelle catégorie (extensible)' : 'New category (extensible)'}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div className="sm:col-span-2 space-y-1">
                              <label className="block text-xs text-gray-500">
                                {isFr ? 'Clé technique (optionnel)' : 'Technical key (optional)'}
                              </label>
                              <input
                                value={newCategoryKey}
                                onChange={(e) => setNewCategoryKey(e.target.value)}
                                placeholder={isFr ? 'ex. emission' : 'e.g. show'}
                                className="coya-input w-full text-sm"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs text-gray-500">Libellé FR</label>
                              <input
                                value={newCategoryLabelFr}
                                onChange={(e) => setNewCategoryLabelFr(e.target.value)}
                                className="coya-input w-full text-sm"
                                placeholder="Émission"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="block text-xs text-gray-500">Label EN</label>
                              <input
                                value={newCategoryLabelEn}
                                onChange={(e) => setNewCategoryLabelEn(e.target.value)}
                                className="coya-input w-full text-sm"
                                placeholder="Show"
                              />
                            </div>
                            <Button type="button" variant="secondary" className="sm:col-span-2 w-full sm:w-auto" onClick={handleRegisterCategory}>
                              {isFr ? 'Ajouter la catégorie' : 'Add category'}
                            </Button>
                          </div>
                        </div>

                        {listCollecteCategories(orgId).some((c) => !c.builtin) ? (
                          <div className="rounded-xl border border-gray-100 bg-white p-4">
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-sm font-semibold text-gray-900">
                                {isFr ? 'Catégories personnalisées' : 'Custom categories'}
                              </p>
                              <p className="text-xs text-gray-500">
                                {isFr ? 'Suppression = retire le référentiel local + ses éléments' : 'Delete removes local registry + entities'}
                              </p>
                            </div>
                            <div className="mt-3 space-y-2">
                              {listCollecteCategories(orgId)
                                .filter((c) => !c.builtin)
                                .map((c) => (
                                  <div
                                    key={c.key}
                                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2"
                                  >
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-gray-900 truncate">{isFr ? c.labelFr : c.labelEn}</p>
                                      <p className="text-xs text-gray-500 font-mono">{c.key}</p>
                                    </div>
                                    <Button
                                      type="button"
                                      variant="danger"
                                      size="sm"
                                      onClick={() => {
                                        if (!window.confirm(isFr ? `Supprimer la catégorie "${c.labelFr}" ?` : `Delete "${c.labelEn}" category?`))
                                          return;
                                        const ok = unregisterCollecteCategory(orgId, c.key);
                                        if (ok) {
                                          if (categoryKey === c.key) {
                                            setCategoryKey(defaultCollecteCategoryKey());
                                            setAssignTargetId('');
                                            setCollectActivityId('');
                                          }
                                          setCategoriesTick((x) => x + 1);
                                        }
                                      }}
                                    >
                                      {isFr ? 'Supprimer' : 'Delete'}
                                    </Button>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="pt-2">
                    <Button type="submit" className="w-full sm:w-auto">
                      {isFr ? 'Enregistrer la collecte' : 'Save collection'}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <details className="coya-card group">
              <summary className="cursor-pointer list-none p-5 font-semibold text-gray-900 flex items-center justify-between gap-2">
                <span>{t('collecte_strategy_title')}</span>
                <i className="fas fa-chevron-down text-gray-400 text-sm group-open:rotate-180 transition-transform" aria-hidden />
              </summary>
              <div className="px-5 pb-5 pt-0 border-t border-gray-100">
                <ul className="text-sm text-gray-600 space-y-2 list-disc list-inside pt-3">
                  <li>
                    {isFr
                      ? 'Catégories natives (projet / programme / cours) : création rapide côté Supabase quand la ligne n’existe pas encore. Catégories métier (ex. émission) : référentiel local par organisation, extensible à tout moment.'
                      : 'Built-in categories sync to Supabase when you quick-create. Custom categories (e.g. show) use a per-organization local registry.'}
                  </li>
                  <li>
                    {isFr
                      ? 'Une collecte est versionnée localement (navigateur) jusqu’à branchement API / Supabase.'
                      : 'Collections are stored in the browser until API / Supabase is wired.'}
                  </li>
                  <li>
                    {isFr
                      ? 'Réutiliser : duplique la campagne pour un autre rattachement ou enrichis le CRM depuis le module CRM.'
                      : 'Reuse: duplicate the campaign or enrich CRM from the CRM module.'}
                  </li>
                  <li>
                    {isFr
                      ? 'Lier au CRM : marque la collecte ou crée un contact depuis l’onglet « Liste » du CRM (« Enrichir depuis une collecte »).'
                      : 'CRM link: flag the campaign or create a placeholder from the CRM list tab (“Enrich from collection”).'}
                  </li>
                </ul>
              </div>
            </details>
          </div>
        </div>
      ) : null}

      {activeTab === 'submissions' ? (
        <Card>
          <CardContent className="p-5 sm:p-6 space-y-6">
            <div>
              <h2 className="text-base font-semibold text-gray-900">{t('collecte_submissions_title')}</h2>
              <p className="text-sm text-gray-600 mt-1 max-w-3xl leading-relaxed">{t('collecte_submissions_intro')}</p>
            </div>

            <div className="space-y-1 max-w-xl">
              <label className="block text-sm font-medium text-gray-700">{t('collecte_submissions_pick_campaign')}</label>
              <select
                value={subCollectionId}
                onChange={(e) => {
                  setSubCollectionId(e.target.value);
                  setSubmissionFormError(null);
                }}
                className="coya-select w-full"
              >
                <option value="">{isFr ? '— Choisir une collecte —' : '— Pick a collection —'}</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {(['identity', 'location', 'contact', 'socio', 'enterprise', 'other'] as CollecteParticipantFieldGroup[]).map((g) => {
              const defs = fieldsByGroup.get(g);
              if (!defs?.length) return null;
              const open = participantGroupOpen[g];
              return (
                <div key={g} className="rounded-xl border border-gray-100 overflow-hidden">
                  <button
                    type="button"
                    className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-gray-50/80 text-left text-sm font-semibold text-gray-900 hover:bg-gray-50"
                    onClick={() =>
                      setParticipantGroupOpen((prev) => ({
                        ...prev,
                        [g]: !prev[g],
                      }))
                    }
                  >
                    <span>{collecteGroupLabel(g, isFr)}</span>
                    <span className="text-xs font-medium text-gray-500">
                      {open ? t('collecte_group_collapse') : t('collecte_group_expand')}
                    </span>
                  </button>
                  {open ? (
                    <div className="p-4 border-t border-gray-100">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{defs.map((d) => renderParticipantControl(d))}</div>
                    </div>
                  ) : null}
                </div>
              );
            })}

            {submissionFormError ? <p className="text-sm text-red-600">{submissionFormError}</p> : null}

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2">
              <Button
                type="button"
                disabled={!subCollectionId}
                onClick={() => {
                  const trimmed: Record<string, string> = {};
                  Object.entries(participantPayload).forEach(([k, val]) => {
                    trimmed[k] = String(val ?? '').trim();
                  });
                  const em = trimmed.email;
                  if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
                    setSubmissionFormError(t('collecte_validation_email'));
                    return;
                  }
                  setSubmissionFormError(null);
                  const sub: DataCollectionSubmission = {
                    id: makeId(),
                    collectionId: subCollectionId,
                    organizationId: orgId,
                    submittedAt: new Date().toISOString(),
                    payload: trimmed,
                    syncedToCrm: false,
                  };
                  dataCollectionService.recordDataCollectionSubmission(sub);
                  setParticipantPayload(emptyParticipantPayload());
                  setSubmissionsTick((t) => t + 1);
                  refresh();
                }}
              >
                {t('collecte_record_submission')}
              </Button>
            </div>

            <div className="border-t border-gray-100 pt-5 space-y-3">
              <Button
                type="button"
                variant="secondary"
                disabled={crmBulkLoading}
                onClick={async () => {
                  setCrmBulkLoading(true);
                  setCrmBulkMsg(null);
                  try {
                    const r = await dataCollectionService.bulkSyncPendingSubmissionsToCrm();
                    setCrmBulkMsg(
                      t('collecte_bulk_sync_result').replace('{ok}', String(r.ok)).replace('{fail}', String(r.fail)),
                    );
                    dispatchCrmOutboundEvent({
                      kind: 'collecte.submissions_synced',
                      ok: r.ok,
                      fail: r.fail,
                      organizationId: orgId,
                    });
                    void onAfterCrmBulkSync?.();
                    refresh();
                    setSubmissionsTick((t) => t + 1);
                  } catch (e: any) {
                    setCrmBulkMsg(String(e?.message || 'Error'));
                  } finally {
                    setCrmBulkLoading(false);
                  }
                }}
              >
                {crmBulkLoading ? '…' : t('collecte_bulk_sync_btn')}
              </Button>
              {crmBulkMsg ? <p className="text-sm text-gray-700">{crmBulkMsg}</p> : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );

};

export default CollecteModule;
