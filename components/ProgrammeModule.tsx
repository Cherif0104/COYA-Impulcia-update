import React, { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import StructuredModulePage from './common/StructuredModulePage';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import {
  useAppNavigation,
  NAV_SESSION_OPEN_PROGRAMME_ID,
  NAV_SESSION_OPEN_PROGRAMME_DETAIL_TAB,
  NAV_SESSION_OPEN_PROJECT_ID,
  NAV_SESSION_PROGRAMMES_PROJECTS_TAB,
  NAV_SESSION_COLLECTE_PRESET_PROGRAMME_ID,
  NAV_SESSION_COURSES_PROGRAMME_ID,
  NAV_QUERY_MOBILITE_PROGRAMME_ID,
} from '../contexts/AppNavigationContext';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { projectsHomeView } from '../utils/programmesProjectsNav';
import {
  Language,
  Bailleur,
  Programme,
  ProgrammeBudgetLine,
  Beneficiaire,
  CurrencyCode,
  SUPPORTED_CURRENCIES,
  Project,
  Task,
  ExpenseRequest,
  ProgrammeStakeholder,
  ProgrammeStakeholderType,
  ProgrammeAction,
  ProgrammeDataRow,
  ProgrammeBailleurLink,
  ProjectActivity,
  BudgetCascadeLine,
  BudgetCascadeScope,
  BudgetRollupByPostRow,
  BudgetRollupByScopeRow,
  Role,
  RESOURCE_MANAGEMENT_ROLES,
} from '../types';
import * as programmeService from '../services/programmeService';
import * as programmeCockpitService from '../services/programmeCockpitService';
import { DataAdapter } from '../services/dataAdapter';
import { DataService } from '../services/dataService';
import { supabase } from '../services/supabaseService';
import OrganizationService from '../services/organizationService';
import ConfirmationModal from './common/ConfirmationModal';
import { ProgrammesEnterpriseTable, portfolioProgressPercent } from './program-projects/enterprise/ProgrammesEnterpriseTable';
import { EnterpriseDonutRing, type EnterpriseDonutSegment } from './program-projects/enterprise/EnterpriseDonutRing';
import { EnterpriseFinanceKpiStrip, type EnterpriseFinanceKpiItem } from './program-projects/enterprise/EnterpriseFinanceKpiStrip';
import type { ProgrammeCockpitReadModel } from '../services/programmeCockpitContract';
import type { ProgrammeCockpitRow } from '../services/programmeCockpitService';
import {
  COLLECTE_GRID_COLUMN_KEYS,
  collecteGridColumnKeysForRows,
  getCollecteColumnLabel,
} from '../utils/collecteParticipantFields';

/** 4 vues : alignées chaîne bailleur → budget → projets/terrain → acteurs & participants (CRM / collecte) */
export type ProgrammeDetailTab = 'resume' | 'budget' | 'projets_terrain' | 'acteurs_collecte';

function normalizeProgrammeDetailTab(raw: string | null | undefined): ProgrammeDetailTab {
  if (raw == null || String(raw).trim() === '') return 'resume';
  const n = String(raw).trim();
  if (n === 'resume' || n === 'budget' || n === 'projets_terrain' || n === 'acteurs_collecte') return n;
  const legacy: Record<string, ProgrammeDetailTab> = {
    synthese: 'resume',
    actions: 'resume',
    budget: 'budget',
    budget_cascade: 'budget',
    projets: 'projets_terrain',
    terrain: 'projets_terrain',
    stakeholders: 'acteurs_collecte',
    collecte: 'acteurs_collecte',
  };
  return legacy[n] ?? 'resume';
}

const STAKEHOLDER_TYPE_OPTIONS: { v: ProgrammeStakeholderType; fr: string; en: string }[] = [
  { v: 'facilitator', fr: 'Facilitateur / formateur', en: 'Facilitator / trainer' },
  { v: 'implementation_partner', fr: 'Partenaire de mise en œuvre', en: 'Implementation partner' },
  { v: 'executing_partner', fr: 'Partenaire exécutant', en: 'Executing partner' },
  { v: 'donor_contact', fr: 'Contact bailleur', en: 'Donor contact' },
  { v: 'technical', fr: 'Intervenant technique', en: 'Technical contributor' },
  { v: 'internal_staff', fr: 'Staff interne', en: 'Internal staff' },
  { v: 'other', fr: 'Autre', en: 'Other' },
];

function stakeholderTypeLabel(isFr: boolean, t: ProgrammeStakeholderType): string {
  const o = STAKEHOLDER_TYPE_OPTIONS.find((x) => x.v === t);
  return o ? (isFr ? o.fr : o.en) : t;
}

function programmeActionEffectiveAssignees(a: ProgrammeAction): string[] {
  if (a.assigneeProfileIds?.length) return a.assigneeProfileIds;
  if (a.executorProfileId) return [String(a.executorProfileId)];
  return [];
}

function programmeActionDeadline(a: ProgrammeAction): string | null {
  const d = a.periodEnd || a.dueDate;
  return d ? String(d).slice(0, 10) : null;
}

function programmeActionStatusLabel(isFr: boolean, s: ProgrammeAction['status']): string {
  const map: Record<ProgrammeAction['status'], [string, string]> = {
    draft: ['Brouillon', 'Draft'],
    pending_validation: ['En attente de validation', 'Pending validation'],
    validated: ['Validée', 'Validated'],
    assigned: ['Assignée (en cours)', 'Assigned'],
    done: ['Réalisée', 'Done'],
    cancelled: ['Annulée', 'Cancelled'],
    not_realized: ['Non réalisée (échue)', 'Not done (overdue)'],
  };
  const p = map[s];
  return p ? (isFr ? p[0] : p[1]) : s;
}

/** Phase 3 – Programme & Bailleur : hiérarchie terrain (projet → activité → tâche), budget cascade, CRM participants */
const ProgrammeModule: React.FC = () => {
  const { language, t } = useLocalization();
  const { user: currentUser } = useAuth();
  const nav = useAppNavigation();
  const { canAccessModule } = useModulePermissions();
  const isFr = language === Language.FR;

  const [bailleurs, setBailleurs] = useState<Bailleur[]>([]);
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [budgetLines, setBudgetLines] = useState<ProgrammeBudgetLine[]>([]);
  const [beneficiaires, setBeneficiaires] = useState<Beneficiaire[]>([]);
  /** Agrégat lignes budgétaires tous programmes — KPI liste & tableau enterprise */
  const [portfolioBudgetLines, setPortfolioBudgetLines] = useState<ProgrammeBudgetLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Liste programmes — recherche / filtre (parité module Projets). */
  const [programmeSearchQuery, setProgrammeSearchQuery] = useState('');
  const [programmeArchiveFilter, setProgrammeArchiveFilter] = useState<'all' | 'active' | 'archived'>('all');

  const [activeTab, setActiveTab] = useState<'bailleurs' | 'programmes'>('programmes');
  const [selectedProgramme, setSelectedProgramme] = useState<Programme | null>(null);
  const [selectedBailleur, setSelectedBailleur] = useState<Bailleur | null>(null);
  const [showBailleurForm, setShowBailleurForm] = useState(false);
  const [showProgrammeForm, setShowProgrammeForm] = useState(false);
  const [showBudgetLineForm, setShowBudgetLineForm] = useState(false);
  const [showBeneficiaireForm, setShowBeneficiaireForm] = useState(false);
  const [editBailleur, setEditBailleur] = useState<Bailleur | null>(null);
  const [editProgramme, setEditProgramme] = useState<Programme | null>(null);
  const [editBudgetLine, setEditBudgetLine] = useState<ProgrammeBudgetLine | null>(null);
  const [editBeneficiaire, setEditBeneficiaire] = useState<Beneficiaire | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<
    | { type: 'bailleur' | 'programme' | 'budget_line' | 'beneficiaire'; id: string }
    | { type: 'stakeholder' | 'action' | 'data_row' | 'prog_bailleur' | 'project_activity' | 'budget_cascade_line'; id: string }
    | null
  >(null);
  const [submitting, setSubmitting] = useState(false);
  const [projectsForProgramme, setProjectsForProgramme] = useState<Project[]>([]);
  const [expenseRequests, setExpenseRequests] = useState<ExpenseRequest[]>([]);
  const [isAuditorReadOnly, setIsAuditorReadOnly] = useState(false);
  const [showExpenseRequestForm, setShowExpenseRequestForm] = useState(false);
  const [resolvedOrgId, setResolvedOrgId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<ProgrammeDetailTab>('resume');
  const [terrainProjectId, setTerrainProjectId] = useState('');
  const [projectActivities, setProjectActivities] = useState<ProjectActivity[]>([]);
  const [terrainProjectSnapshot, setTerrainProjectSnapshot] = useState<Project | null>(null);
  const [taskActivityChoice, setTaskActivityChoice] = useState<Record<string, string>>({});
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [editActivity, setEditActivity] = useState<ProjectActivity | null>(null);
  const [budgetCascadeLines, setBudgetCascadeLines] = useState<BudgetCascadeLine[]>([]);
  const [budgetRollupByPost, setBudgetRollupByPost] = useState<BudgetRollupByPostRow[]>([]);
  const [budgetRollupByScope, setBudgetRollupByScope] = useState<BudgetRollupByScopeRow[]>([]);
  const [showBudgetCascadeForm, setShowBudgetCascadeForm] = useState(false);
  const [budgetFormActivities, setBudgetFormActivities] = useState<ProjectActivity[]>([]);
  const [bcForm, setBcForm] = useState<{
    scopeLevel: BudgetCascadeScope;
    label: string;
    expensePostCode: string;
    plannedAmount: string;
    actualAmount: string;
    currency: CurrencyCode;
    projectId: string;
    activityId: string;
    projectTaskId: string;
    parentLineId: string;
  }>({
    scopeLevel: 'programme',
    label: '',
    expensePostCode: '',
    plannedAmount: '',
    actualAmount: '0',
    currency: 'XOF',
    projectId: '',
    activityId: '',
    projectTaskId: '',
    parentLineId: '',
  });
  const [extraBailleurs, setExtraBailleurs] = useState<ProgrammeBailleurLink[]>([]);
  const [stakeholders, setStakeholders] = useState<ProgrammeStakeholder[]>([]);
  const [actionsList, setActionsList] = useState<ProgrammeAction[]>([]);
  const [markDoneAction, setMarkDoneAction] = useState<ProgrammeAction | null>(null);
  const [programmeActionDetailId, setProgrammeActionDetailId] = useState<string | null>(null);
  const [dataRows, setDataRows] = useState<ProgrammeDataRow[]>([]);
  const [collectSection, setCollectSection] = useState('participants');
  const [orgProfiles, setOrgProfiles] = useState<{ id: string; label: string }[]>([]);
  const [myProfileId, setMyProfileId] = useState('');
  const [extraBailleurToAdd, setExtraBailleurToAdd] = useState('');
  const [anchorOrgName, setAnchorOrgName] = useState<string | null>(null);

  const userOrgId = (currentUser as any)?.organizationId ?? null;
  const organizationId = resolvedOrgId ?? userOrgId;
  const currentUserId = (currentUser as any)?.id ?? (currentUser as any)?.user_id ?? null;
  const canValidateBudget = programmeService.isBudgetValidatorRole((currentUser as any)?.role);
  const canManageProgrammeActions =
    !!currentUser && RESOURCE_MANAGEMENT_ROLES.includes((currentUser as any)?.role as Role);

  const selfLabel = useMemo(() => {
    const u = currentUser as any;
    if (!u) return isFr ? 'Non connecté' : 'Not signed in';
    const name = String(u.full_name || u.fullName || u.name || '').trim();
    const mail = String(u.email || '').trim();
    return name || mail || (isFr ? 'Utilisateur' : 'User');
  }, [currentUser, isFr]);

  const programmeActionDetail = useMemo(
    () => (programmeActionDetailId ? actionsList.find((x) => x.id === programmeActionDetailId) ?? null : null),
    [actionsList, programmeActionDetailId],
  );

  useEffect(() => {
    if (programmeActionDetailId && !actionsList.some((a) => a.id === programmeActionDetailId)) {
      setProgrammeActionDetailId(null);
    }
  }, [actionsList, programmeActionDetailId]);

  useEffect(() => {
    OrganizationService.getCurrentUserOrganizationId().then((id) => setResolvedOrgId(id));
  }, []);

  useEffect(() => {
    OrganizationService.getCurrentUserOrganization().then((o) => {
      setAnchorOrgName(o?.name ?? null);
    });
  }, [resolvedOrgId, organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    DataService.getProfiles().then(({ data }) => {
      const rows = (data || []).filter((p: any) => !organizationId || p.organization_id === organizationId);
      setOrgProfiles(rows.map((p: any) => ({ id: String(p.id), label: p.full_name || p.email || String(p.id) })));
    });
  }, [organizationId]);

  useEffect(() => {
    if (!currentUser) return;
    const uid = String((currentUser as any).id || currentUser.id || '');
    (async () => {
      const { data } = await DataService.getProfile(uid);
      let pid = String((currentUser as any)?.profileId || data?.id || '');
      if (!pid && uid) {
        const { data: row } = await supabase.from('profiles').select('id').eq('user_id', uid).maybeSingle();
        if (row?.id) pid = String(row.id);
      }
      setMyProfileId(pid);
    })();
  }, [currentUser]);

  const loadProgrammeExtras = useCallback(async (programmeId: string) => {
    await programmeService.applyProgrammeActionAutoClose(programmeId);
    const [eb, st, ac, dr] = await Promise.all([
      programmeService.listProgrammeBailleurs(programmeId),
      programmeService.listProgrammeStakeholders(programmeId),
      programmeService.listProgrammeActions(programmeId),
      programmeService.listProgrammeDataRows(programmeId),
    ]);
    setExtraBailleurs(eb);
    setStakeholders(st);
    setActionsList(ac);
    setDataRows(dr);
  }, []);

  const loadBailleurs = useCallback(async () => {
    try {
      const list = await programmeService.listBailleurs(organizationId);
      setBailleurs(list);
    } catch (e: any) {
      setError(e?.message || 'Erreur chargement bailleurs');
    }
  }, [organizationId]);

  const loadProgrammes = useCallback(async () => {
    try {
      const list = await programmeService.listProgrammes(organizationId);
      setProgrammes(list);
    } catch (e: any) {
      setError(e?.message || 'Erreur chargement programmes');
    }
  }, [organizationId]);

  const loadBudgetLines = useCallback(async () => {
    if (!selectedProgramme?.id) {
      setBudgetLines([]);
      return;
    }
    try {
      const list = await programmeService.listProgrammeBudgetLines(selectedProgramme.id);
      setBudgetLines(list);
    } catch (e: any) {
      setError(e?.message || 'Erreur chargement lignes budgétaires');
    }
  }, [selectedProgramme?.id]);

  const loadBeneficiaires = useCallback(async () => {
    try {
      const list = await programmeService.listBeneficiaires({
        organizationId,
        programmeId: selectedProgramme?.id ?? undefined,
      });
      setBeneficiaires(list);
    } catch (e: any) {
      setError(e?.message || 'Erreur chargement bénéficiaires');
    }
  }, [organizationId, selectedProgramme?.id]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([loadBailleurs(), loadProgrammes()]).finally(() => setLoading(false));
  }, [loadBailleurs, loadProgrammes]);

  const programmeDetailTabKeys = useMemo(
    () => new Set<string>(['resume', 'budget', 'projets_terrain', 'acteurs_collecte']),
    [],
  );

  const showResume = detailTab === 'resume';
  const showBudgetPack = detailTab === 'budget';
  const showExecutionPack = detailTab === 'projets_terrain';
  const showPeoplePack = detailTab === 'acteurs_collecte';

  /** Palette d’accent cartes liste — alignée maquette Figma `make figma/Programme.tsx`. */
  const programmeAccentPalette = ['bg-blue-500', 'bg-violet-500', 'bg-emerald-500', 'bg-green-500', 'bg-amber-500', 'bg-orange-500'] as const;

  const [kpiProjects, setKpiProjects] = useState<Project[]>([]);
  const [programmeCockpitRow, setProgrammeCockpitRow] = useState<ProgrammeCockpitRow | null>(null);
  const [programmeCockpit, setProgrammeCockpit] = useState<ProgrammeCockpitReadModel | null>(null);
  const [programmeCockpitLoading, setProgrammeCockpitLoading] = useState(false);
  const [programmeCockpitError, setProgrammeCockpitError] = useState<string | null>(null);

  useEffect(() => {
    if (activeTab !== 'programmes') return;
    DataAdapter.getProjects().then(setKpiProjects).catch(() => setKpiProjects([]));
  }, [activeTab, organizationId]);

  useEffect(() => {
    if (activeTab !== 'programmes' || programmes.length === 0) {
      setPortfolioBudgetLines([]);
      return;
    }
    let cancelled = false;
    Promise.all(programmes.map((p) => programmeService.listProgrammeBudgetLines(p.id).catch(() => []))).then((chunks) => {
      if (!cancelled) setPortfolioBudgetLines(chunks.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, programmes]);

  // KPI portfolio (budget, progression tâches, etc.) : déplacés côté projections (cockpits),
  // la UI reste un consommateur read-only (projection-first).

  const programmeIdsSet = useMemo(() => new Set(programmes.map((p) => String(p.id))), [programmes]);
  const linkedProjectCount = useMemo(
    () => kpiProjects.filter((p) => p.programmeId != null && programmeIdsSet.has(String(p.programmeId))).length,
    [kpiProjects, programmeIdsSet],
  );

  const programmeTaskProgressPct = useCallback(
    (programmeId: string) => portfolioProgressPercent(programmeId, kpiProjects),
    [kpiProjects],
  );

  const activeProgrammesCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const t = today.getTime();
    return programmes.filter((p) => {
      if (p.allowProjects === false) return false;
      if (!p.endDate) return true;
      const end = new Date(p.endDate);
      end.setHours(0, 0, 0, 0);
      return end.getTime() >= t;
    }).length;
  }, [programmes]);

  const completedProgrammesCount = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const t = today.getTime();
    return programmes.filter((p) => {
      if (!p.endDate) return false;
      const end = new Date(p.endDate);
      end.setHours(0, 0, 0, 0);
      return end.getTime() < t;
    }).length;
  }, [programmes]);

  const programmesForEnterpriseTable = useMemo(() => {
    const q = programmeSearchQuery.trim().toLowerCase();
    return programmes.filter((p) => {
      if (programmeArchiveFilter === 'active' && p.allowProjects === false) return false;
      if (programmeArchiveFilter === 'archived' && p.allowProjects !== false) return false;
      if (!q) return true;
      const name = (p.name || '').toLowerCase();
      const desc = (p.description || '').toLowerCase();
      const code = (p.code || '').toLowerCase();
      return name.includes(q) || desc.includes(q) || code.includes(q);
    });
  }, [programmes, programmeSearchQuery, programmeArchiveFilter]);

  const portfolioBudgetTotalLabel = useMemo(() => {
    const sum = portfolioBudgetLines.reduce((s, l) => s + Number(l.plannedAmount || 0), 0);
    const cur = portfolioBudgetLines[0]?.currency || 'XOF';
    if (sum <= 0) return '—';
    return `${new Intl.NumberFormat(isFr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 }).format(sum)} ${cur}`;
  }, [portfolioBudgetLines, isFr]);

  const programmeDetailFinanceItems = useMemo((): EnterpriseFinanceKpiItem[] => {
    if (!selectedProgramme) return [];
    const cur = (budgetLines[0]?.currency as string) || 'XOF';
    const fmt = (x: number) =>
      `${new Intl.NumberFormat(isFr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 }).format(Math.round(x))} ${cur}`;
    const planned = budgetLines.reduce((s, l) => s + Number(l.plannedAmount || 0), 0);
    const spent = budgetLines.reduce((s, l) => s + Number(l.spentAmount || 0), 0);
    const pid = String(selectedProgramme.id);
    const validatedAmt = expenseRequests
      .filter((er) => er.status === 'validated')
      .reduce((s, er) => s + Number(er.amount || 0), 0);
    const quotedAmt = expenseRequests
      .filter((er) => er.status === 'quoted')
      .reduce((s, er) => s + Number(er.amount || 0), 0);
    const submittedAmt = expenseRequests
      .filter((er) => er.status === 'submitted')
      .reduce((s, er) => s + Number(er.amount || 0), 0);
    const engagedExpense = validatedAmt + quotedAmt + submittedAmt;
    const engagedCascade = budgetCascadeLines
      .filter((l) => String(l.programmeId) === pid)
      .filter((l) => l.workflowStatus === 'submitted' || l.workflowStatus === 'validated')
      .reduce((s, l) => s + Math.max(0, Number(l.plannedAmount || 0) - Number(l.actualAmount || 0)), 0);
    const engaged = engagedExpense + engagedCascade;
    if (planned <= 0 && spent <= 0 && engaged <= 0) return [];
    const avail = Math.max(0, planned - spent - engaged);
    const execPct = planned > 0 ? Math.round((spent / planned) * 100) : 0;
    const engPct = planned > 0 ? Math.round((Math.min(engaged, planned) / planned) * 100) : 0;
    const availPct = planned > 0 ? Math.round((avail / planned) * 100) : 0;
    const cascadePct = planned > 0 ? Math.round((Math.min(engagedCascade, planned) / planned) * 100) : 0;
    const engHint =
      planned > 0
        ? isFr
          ? `${engPct}% prévu · dem.: valid. ${Math.round((validatedAmt / planned) * 100)}% · cot. ${Math.round((quotedAmt / planned) * 100)}% · soum. ${Math.round((submittedAmt / planned) * 100)}% · cascade ${cascadePct}%`
          : `${engPct}% of plan · req.: val. ${Math.round((validatedAmt / planned) * 100)}% · quoted ${Math.round((quotedAmt / planned) * 100)}% · subm. ${Math.round((submittedAmt / planned) * 100)}% · cascade ${cascadePct}%`
        : isFr
          ? `Dem.: ${fmt(engagedExpense)} · Cascade: ${fmt(engagedCascade)}`
          : `Req.: ${fmt(engagedExpense)} · Cascade: ${fmt(engagedCascade)}`;
    return [
      { id: 'tot', label: isFr ? 'Budget total' : 'Total budget', value: fmt(planned) },
      {
        id: 'real',
        label: isFr ? 'Dépensé' : 'Spent',
        value: fmt(spent),
        hint: `${execPct}% ${isFr ? "taux d'exécution" : 'execution'}`,
      },
      {
        id: 'eng',
        label: isFr ? 'Engagé (demandes + cascade)' : 'Committed (requests + cascade)',
        value: fmt(engaged),
        hint: engHint,
      },
      {
        id: 'av',
        label: isFr ? 'Disponible' : 'Available',
        value: fmt(avail),
        hint: `${availPct}%`,
      },
    ];
  }, [selectedProgramme, budgetLines, expenseRequests, budgetCascadeLines, isFr]);

  const programmeDetailDonutSegments = useMemo((): EnterpriseDonutSegment[] => {
    if (!selectedProgramme) return [];
    const ps = projectsForProgramme;
    const n = ps.length;
    const pct = programmeTaskProgressPct(selectedProgramme.id);
    if (n === 0) {
      return [
        { name: isFr ? 'Avancement' : 'Progress', value: pct, color: '#199C45' },
        { name: isFr ? 'Reste' : 'Remaining', value: Math.max(0, 100 - pct), color: '#E2E8F0' },
      ];
    }
    const done = ps.filter((p) => p.status === 'Completed').length;
    const ip = ps.filter((p) => p.status === 'In Progress').length;
    const rest = Math.max(0, n - done - ip);
    return [
      { name: isFr ? 'Terminés' : 'Done', value: (done / n) * 100, color: '#199C45' },
      { name: isFr ? 'En cours' : 'In progress', value: (ip / n) * 100, color: '#0D7A2B' },
      { name: isFr ? 'Autres' : 'Other', value: (rest / n) * 100, color: '#F4C430' },
    ];
  }, [selectedProgramme, projectsForProgramme, programmeTaskProgressPct, isFr]);

  /** Navigation depuis la fiche projet / module Collecte : programme + onglet détail. */
  useEffect(() => {
    if (loading) return;
    const raw = sessionStorage.getItem(NAV_SESSION_OPEN_PROGRAMME_ID);
    if (!raw) return;
    const match = programmes.find((p) => String(p.id) === String(raw));
    if (!match) {
      sessionStorage.removeItem(NAV_SESSION_OPEN_PROGRAMME_ID);
      try {
        sessionStorage.removeItem(NAV_SESSION_OPEN_PROGRAMME_DETAIL_TAB);
      } catch (_) { /* ignore */ }
      return;
    }
    sessionStorage.removeItem(NAV_SESSION_OPEN_PROGRAMME_ID);
    let tabRaw: string | null = null;
    try {
      tabRaw = sessionStorage.getItem(NAV_SESSION_OPEN_PROGRAMME_DETAIL_TAB);
      if (tabRaw) sessionStorage.removeItem(NAV_SESSION_OPEN_PROGRAMME_DETAIL_TAB);
    } catch (_) { /* ignore */ }
    setActiveTab('programmes');
    setSelectedProgramme(match);
    if (tabRaw && programmeDetailTabKeys.has(tabRaw)) {
      setDetailTab(tabRaw as ProgrammeDetailTab);
    } else {
      setDetailTab(normalizeProgrammeDetailTab(tabRaw));
    }
  }, [loading, programmes, programmeDetailTabKeys]);

  useEffect(() => {
    if (selectedProgramme) {
      loadBudgetLines();
      loadBeneficiaires();
    } else {
      setBudgetLines([]);
      setBeneficiaires([]);
    }
  }, [selectedProgramme, loadBudgetLines, loadBeneficiaires]);

  useEffect(() => {
    if (!selectedProgramme?.id) {
      setProjectsForProgramme([]);
      setExpenseRequests([]);
      setIsAuditorReadOnly(false);
      setExtraBailleurs([]);
      setStakeholders([]);
      setActionsList([]);
      setDataRows([]);
      setProgrammeCockpitRow(null);
      setProgrammeCockpit(null);
      setProgrammeCockpitError(null);
      return;
    }
    let cancelled = false;
    const pid = selectedProgramme.id;
    loadProgrammeExtras(pid);
    setProgrammeCockpitLoading(true);
    setProgrammeCockpitError(null);
    Promise.all([
      DataAdapter.getProjects().then((list) => list.filter((p) => p.programmeId === pid)),
      programmeService.listExpenseRequests(pid),
      currentUserId ? programmeService.isUserAuditorForProgramme(pid, currentUserId) : Promise.resolve(false),
      programmeService.getProgramme(pid),
      programmeCockpitService.getProgrammeCockpitRow(pid),
    ]).then(([projects, requests, isAuditor, fresh, cockpitRow]) => {
      if (cancelled) return;
      setProjectsForProgramme(projects);
      setExpenseRequests(requests);
      setIsAuditorReadOnly(!!isAuditor);
      if (fresh) setSelectedProgramme(fresh);
      setProgrammeCockpitRow(cockpitRow ?? null);
      setProgrammeCockpit((cockpitRow?.model as ProgrammeCockpitReadModel) ?? null);
    }).catch((e: any) => {
      if (!cancelled) setProgrammeCockpitError(e?.message || 'Erreur cockpit');
    }).finally(() => {
      if (!cancelled) setProgrammeCockpitLoading(false);
    });
    return () => { cancelled = true; };
  }, [selectedProgramme?.id, currentUserId, loadProgrammeExtras]);

  const rebuildProgrammeCockpitNow = useCallback(async () => {
    const pid = selectedProgramme?.id;
    if (!pid) return;
    setProgrammeCockpitLoading(true);
    setProgrammeCockpitError(null);
    try {
      await programmeCockpitService.rebuildProgrammeCockpit(pid);
      const nextRow = await programmeCockpitService.getProgrammeCockpitRow(pid);
      setProgrammeCockpitRow(nextRow);
      setProgrammeCockpit((nextRow?.model as ProgrammeCockpitReadModel) ?? null);
    } catch (e: any) {
      setProgrammeCockpitError(e?.message || 'Erreur rebuild cockpit');
    } finally {
      setProgrammeCockpitLoading(false);
    }
  }, [selectedProgramme?.id]);

  const refreshBudgetCascade = useCallback(() => {
    const pid = selectedProgramme?.id;
    if (!pid) return;
    Promise.all([
      programmeService.listBudgetCascadeLines(pid),
      programmeService.listBudgetRollupByPost(pid),
      programmeService.listBudgetRollupByScope(pid),
    ]).then(([lines, byPost, byScope]) => {
      setBudgetCascadeLines(lines);
      setBudgetRollupByPost(byPost);
      setBudgetRollupByScope(byScope);
    });
  }, [selectedProgramme?.id]);

  useEffect(() => {
    setTerrainProjectId('');
    setBudgetCascadeLines([]);
    setBudgetRollupByPost([]);
    setBudgetRollupByScope([]);
    setProjectActivities([]);
    setTerrainProjectSnapshot(null);
    setTaskActivityChoice({});
  }, [selectedProgramme?.id]);

  /** Pipeline cascade (aperçu financier) : chargé avec le programme, pas seulement sur l’onglet Finances. */
  useEffect(() => {
    if (!selectedProgramme?.id) return;
    let cancelled = false;
    programmeService.listBudgetCascadeLines(selectedProgramme.id).then((lines) => {
      if (!cancelled) setBudgetCascadeLines(lines);
    }).catch(() => {
      if (!cancelled) setBudgetCascadeLines([]);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProgramme?.id]);

  useEffect(() => {
    if (!selectedProgramme?.id || detailTab !== 'budget') return;
    refreshBudgetCascade();
  }, [selectedProgramme?.id, detailTab, refreshBudgetCascade]);

  useEffect(() => {
    if (!terrainProjectId) {
      setProjectActivities([]);
      setTerrainProjectSnapshot(null);
      setTaskActivityChoice({});
      return;
    }
    programmeService.listProjectActivities(terrainProjectId).then(setProjectActivities);
    const p = projectsForProgramme.find((x) => String(x.id) === String(terrainProjectId));
    if (p) {
      setTerrainProjectSnapshot({ ...p });
      const m: Record<string, string> = {};
      (p.tasks || []).forEach((t) => {
        if (t.activityId) m[t.id] = String(t.activityId);
      });
      setTaskActivityChoice(m);
    } else {
      setTerrainProjectSnapshot(null);
      setTaskActivityChoice({});
    }
  }, [terrainProjectId, projectsForProgramme]);

  useEffect(() => {
    if (!bcForm.projectId || detailTab !== 'budget') {
      setBudgetFormActivities([]);
      return;
    }
    programmeService.listProjectActivities(bcForm.projectId).then(setBudgetFormActivities);
  }, [bcForm.projectId, detailTab]);

  const handleSaveBailleur = async (e: React.FormEvent, form: { name: string; code: string; description: string; contact: string }) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      if (editBailleur) {
        await programmeService.updateBailleur(editBailleur.id, {
          name: form.name.trim(),
          code: form.code.trim() || null,
          description: form.description.trim() || null,
          contact: form.contact.trim() || null,
        });
        await loadBailleurs();
        setEditBailleur(null);
      } else {
        await programmeService.createBailleur({
          organizationId,
          name: form.name.trim(),
          code: form.code.trim() || null,
          description: form.description.trim() || null,
          contact: form.contact.trim() || null,
        });
        await loadBailleurs();
        setShowBailleurForm(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveProgramme = async (
    e: React.FormEvent,
    form: {
      name: string;
      code: string;
      description: string;
      bailleurId: string;
      startDate: string;
      endDate: string;
      allowProjects: boolean;
    }
  ) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    try {
      if (editProgramme) {
        await programmeService.updateProgramme(editProgramme.id, {
          name: form.name.trim(),
          code: form.code.trim() || null,
          description: form.description.trim() || null,
          bailleurId: form.bailleurId || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          allowProjects: form.allowProjects,
        });
        await loadProgrammes();
        if (selectedProgramme?.id === editProgramme.id) {
          const updated = await programmeService.getProgramme(editProgramme.id);
          if (updated) setSelectedProgramme(updated);
        }
        setEditProgramme(null);
      } else {
        await programmeService.createProgramme({
          organizationId,
          name: form.name.trim(),
          code: form.code.trim() || null,
          description: form.description.trim() || null,
          bailleurId: form.bailleurId || null,
          startDate: form.startDate || null,
          endDate: form.endDate || null,
          allowProjects: form.allowProjects,
        });
        await loadProgrammes();
        setShowProgrammeForm(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveBudgetLine = async (
    e: React.FormEvent,
    form: { label: string; plannedAmount: string; spentAmount: string; currency: CurrencyCode }
  ) => {
    e.preventDefault();
    if (!selectedProgramme?.id || !form.label.trim()) return;
    const planned = parseFloat(form.plannedAmount) || 0;
    const spent = parseFloat(form.spentAmount) || 0;
    setSubmitting(true);
    try {
      if (editBudgetLine) {
        await programmeService.updateProgrammeBudgetLine(editBudgetLine.id, {
          label: form.label.trim(),
          plannedAmount: planned,
          spentAmount: spent,
          currency: form.currency,
        });
        await loadBudgetLines();
        setEditBudgetLine(null);
      } else {
        await programmeService.createProgrammeBudgetLine({
          programmeId: selectedProgramme.id,
          label: form.label.trim(),
          plannedAmount: planned,
          spentAmount: spent,
          currency: form.currency,
        });
        await loadBudgetLines();
        setShowBudgetLineForm(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveBeneficiaire = async (e: React.FormEvent, form: Partial<Beneficiaire>) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editBeneficiaire) {
        await programmeService.updateBeneficiaire(editBeneficiaire.id, {
          programmeId: form.programmeId ?? editBeneficiaire.programmeId,
          projectId: form.projectId ?? editBeneficiaire.projectId,
          theme: form.theme ?? editBeneficiaire.theme,
          target: form.target ?? editBeneficiaire.target,
          gender: form.gender ?? editBeneficiaire.gender,
          sector: form.sector ?? editBeneficiaire.sector,
          country: form.country ?? editBeneficiaire.country,
          region: form.region ?? editBeneficiaire.region,
          contact: form.contact ?? editBeneficiaire.contact,
          age: form.age ?? editBeneficiaire.age,
          education: form.education ?? editBeneficiaire.education,
          profession: form.profession ?? editBeneficiaire.profession,
        });
        await loadBeneficiaires();
        setEditBeneficiaire(null);
      } else {
        await programmeService.createBeneficiaire({
          organizationId,
          programmeId: selectedProgramme?.id ?? form.programmeId ?? null,
          projectId: form.projectId ?? null,
          theme: form.theme ?? null,
          target: form.target ?? null,
          gender: form.gender ?? null,
          sector: form.sector ?? null,
          country: form.country ?? null,
          region: form.region ?? null,
          contact: form.contact ?? null,
          age: form.age ?? null,
          education: form.education ?? null,
          profession: form.profession ?? null,
        });
        await loadBeneficiaires();
        setShowBeneficiaireForm(false);
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      if (deleteTarget.type === 'bailleur') {
        await programmeService.deleteBailleur(deleteTarget.id);
        await loadBailleurs();
      } else if (deleteTarget.type === 'programme') {
        await programmeService.deleteProgramme(deleteTarget.id);
        await loadProgrammes();
        if (selectedProgramme?.id === deleteTarget.id) setSelectedProgramme(null);
      } else if (deleteTarget.type === 'budget_line') {
        await programmeService.deleteProgrammeBudgetLine(deleteTarget.id);
        await loadBudgetLines();
      } else if (deleteTarget.type === 'beneficiaire') {
        await programmeService.deleteBeneficiaire(deleteTarget.id);
        await loadBeneficiaires();
      } else if (deleteTarget.type === 'stakeholder') {
        await programmeService.deleteProgrammeStakeholder(deleteTarget.id);
        if (selectedProgramme) await loadProgrammeExtras(selectedProgramme.id);
      } else if (deleteTarget.type === 'action') {
        await programmeService.deleteProgrammeAction(deleteTarget.id);
        if (selectedProgramme) await loadProgrammeExtras(selectedProgramme.id);
      } else if (deleteTarget.type === 'data_row') {
        await programmeService.deleteProgrammeDataRow(deleteTarget.id);
        if (selectedProgramme) await loadProgrammeExtras(selectedProgramme.id);
      } else if (deleteTarget.type === 'prog_bailleur') {
        await programmeService.removeProgrammeBailleur(deleteTarget.id);
        if (selectedProgramme) await loadProgrammeExtras(selectedProgramme.id);
      } else if (deleteTarget.type === 'project_activity') {
        await programmeService.deleteProjectActivity(deleteTarget.id);
        if (terrainProjectId) {
          const list = await programmeService.listProjectActivities(terrainProjectId);
          setProjectActivities(list);
        }
        refreshBudgetCascade();
      } else if (deleteTarget.type === 'budget_cascade_line') {
        await programmeService.deleteBudgetCascadeLine(deleteTarget.id);
        refreshBudgetCascade();
      }
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const sections = [
    {
      key: 'programmes',
      titleFr: 'Programmes',
      titleEn: 'Programmes',
      icon: 'fas fa-chart-line',
      content: (
        <p className="text-coya-text-muted text-sm">
          {isFr
            ? 'Programmes bailleurs, projets rattachés, activités de terrain et tâches. Budget global et suivi par poste de dépense.'
            : 'Donor programmes, linked projects, field activities and tasks. Overall budget and expense-line tracking.'}
        </p>
      ),
    },
    {
      key: 'budget',
      titleFr: 'Lignes budgétaires',
      titleEn: 'Budget lines',
      icon: 'fas fa-coins',
      content: (
        <p className="text-coya-text-muted text-sm">
          {isFr
            ? 'Lignes budgétaires par poste de dépense (programme), prévisionnel et dépensé.'
            : 'Budget lines by expense item, planned and spent.'}
        </p>
      ),
    },
    {
      key: 'beneficiaires',
      titleFr: 'Bénéficiaires',
      titleEn: 'Beneficiaries',
      icon: 'fas fa-users',
      content: (
        <p className="text-coya-text-muted text-sm">
          {isFr
            ? 'Thème, cible, genre, secteur, pays, région, contact, âge, niveau d\'études, profession.'
            : 'Theme, target, gender, sector, country, region, contact, age, education, profession.'}
        </p>
      ),
    },
  ];

  const programmeWorkspaceContextAsideEl = selectedProgramme ? (
    <ProgrammeWorkspaceContextAside
      isFr={isFr}
      programme={selectedProgramme}
      bailleurs={bailleurs}
      extraBailleurToAdd={extraBailleurToAdd}
      onExtraBailleurToAddChange={setExtraBailleurToAdd}
      extraBailleurs={extraBailleurs}
      isAuditorReadOnly={isAuditorReadOnly}
      navSetView={nav?.setView}
      onToggleAllowProjects={async (checked) => {
        try {
          await programmeService.updateProgramme(selectedProgramme.id, { allowProjects: checked });
          const u = await programmeService.getProgramme(selectedProgramme.id);
          if (u) setSelectedProgramme(u);
          await loadProgrammes();
        } catch (err: any) {
          setError(err?.message || 'Erreur');
        }
      }}
      onAddExtraBailleur={async () => {
        if (!extraBailleurToAdd) return;
        try {
          await programmeService.addProgrammeBailleur(selectedProgramme.id, extraBailleurToAdd);
          setExtraBailleurToAdd('');
          await loadProgrammeExtras(selectedProgramme.id);
        } catch (err: any) {
          setError(err?.message || 'Erreur');
        }
      }}
      onRemoveProgBailleurLink={(linkId) => setDeleteTarget({ type: 'prog_bailleur', id: linkId })}
    />
  ) : null;

  const programmeModuleHeaderActions =
    activeTab === 'bailleurs' ? (
      <button
        type="button"
        data-testid="bailleurs-create-btn"
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--coya-institutional)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--coya-institutional-secondary)]"
        onClick={() => {
          setShowBailleurForm(true);
          setEditBailleur(null);
        }}
      >
        <i className="fas fa-plus h-4 w-4" aria-hidden />
        {isFr ? 'Nouveau bailleur' : 'New donor'}
      </button>
    ) : activeTab === 'programmes' && !selectedProgramme ? (
      <button
        type="button"
        data-testid="programmes-create-btn"
        className="inline-flex items-center gap-2 rounded-xl bg-[var(--coya-institutional)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--coya-institutional-secondary)]"
        onClick={() => {
          setShowProgrammeForm(true);
          setEditProgramme(null);
        }}
      >
        <i className="fas fa-plus h-4 w-4" aria-hidden />
        {isFr ? 'Nouveau programme' : 'New programme'}
      </button>
    ) : null;

  return (
    <StructuredModulePage
      moduleKey="programme"
      titleFr="Programme & Bailleur"
      titleEn="Programme & Donor"
      descriptionFr="Chaîne opérationnelle Programme → Projet → Activité → Tâche, budget prévisionnel/réel en cascade, bailleurs & partenaires & staff interne, participants reliés au CRM et à la collecte."
      descriptionEn="Operational chain Programme → Project → Activity → Task, cascading planned/actual budget, donors, partners, internal staff, participants linked to CRM and data collection."
      icon="fas fa-chart-line"
      moduleHeaderActions={programmeModuleHeaderActions}
      sections={sections}
    >
      {error && (
        <div
          className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900"
          role="alert"
        >
          {error}
        </div>
      )}

      <div
        className="mb-6"
        role="tablist"
        aria-label={isFr ? 'Programmes ou Bailleurs' : 'Programmes or donors'}
      >
        <div className="coya-tabs-pill">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'programmes'}
            data-testid="programme-subtab-programmes"
            className={activeTab === 'programmes' ? 'coya-tabs-pill-item-active' : 'coya-tabs-pill-item'}
            onClick={() => setActiveTab('programmes')}
          >
            <i className="fas fa-layer-group mr-2 text-xs opacity-80" aria-hidden />
            {isFr ? 'Programmes' : 'Programmes'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'bailleurs'}
            data-testid="programme-subtab-bailleurs"
            className={activeTab === 'bailleurs' ? 'coya-tabs-pill-item-active' : 'coya-tabs-pill-item'}
            onClick={() => setActiveTab('bailleurs')}
          >
            <i className="fas fa-hand-holding-usd mr-2 text-xs opacity-80" aria-hidden />
            {isFr ? 'Bailleurs' : 'Donors'}
          </button>
        </div>
      </div>

      {activeTab === 'bailleurs' && (
        <div className="space-y-6" data-testid="bailleurs-list">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--coya-enterprise-text)]">
              {isFr ? 'Bailleurs' : 'Donors'}
            </h2>
            <p className="mt-1 text-sm text-[var(--coya-enterprise-muted)]">
              {isFr ? 'Liste des bailleurs et partenaires financeurs' : 'List of donors and funding partners'}
            </p>
          </div>
          {(showBailleurForm || editBailleur) && (
            <BailleurForm
              isFr={isFr}
              initial={editBailleur || undefined}
              onSubmit={handleSaveBailleur}
              onCancel={() => { setShowBailleurForm(false); setEditBailleur(null); }}
              submitting={submitting}
            />
          )}
          <div
            data-testid="bailleurs-enterprise-table"
            className="overflow-hidden rounded-2xl border border-[var(--coya-enterprise-border)] bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--coya-enterprise-border)] bg-[#F8FAFC] text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                    <th className="px-4 py-3">{isFr ? 'Nom' : 'Name'}</th>
                    <th className="px-4 py-3">{isFr ? 'Code' : 'Code'}</th>
                    <th className="px-4 py-3">{isFr ? 'Contact' : 'Contact'}</th>
                    <th className="w-36 px-4 py-3 text-right">{isFr ? 'Actions' : 'Actions'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--coya-enterprise-border)] text-[var(--coya-enterprise-text)]">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-[var(--coya-enterprise-muted)]">
                        {isFr ? 'Chargement…' : 'Loading…'}
                      </td>
                    </tr>
                  ) : bailleurs.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-4 py-12 text-center text-[var(--coya-enterprise-muted)]">
                        {isFr ? 'Aucun bailleur' : 'No donors'}
                      </td>
                    </tr>
                  ) : (
                    bailleurs.map((b) => (
                      <tr key={b.id} data-testid="bailleur-item" className="transition-colors hover:bg-[#F8FAFC]">
                        <td className="px-4 py-3 font-semibold">{b.name}</td>
                        <td className="px-4 py-3 tabular-nums text-[var(--coya-enterprise-muted)]">{b.code || '—'}</td>
                        <td className="px-4 py-3 text-[var(--coya-enterprise-muted)]">{b.contact || '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            className="mr-2 text-sm font-medium text-[var(--coya-institutional)] hover:underline"
                            onClick={() => setEditBailleur(b)}
                          >
                            {isFr ? 'Modifier' : 'Edit'}
                          </button>
                          <button
                            type="button"
                            className="text-sm font-medium text-red-600 hover:underline"
                            onClick={() => setDeleteTarget({ type: 'bailleur', id: b.id })}
                          >
                            {isFr ? 'Supprimer' : 'Delete'}
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'programmes' && (
        <div className="space-y-6" data-testid="programmes-list">
          <div
            id="programme-context-anchor"
            tabIndex={-1}
            className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-[var(--coya-enterprise-border)] bg-white/95 px-3 py-2 text-xs text-[var(--coya-enterprise-text)] shadow-[0_1px_3px_rgba(15,23,42,0.06)] backdrop-blur-sm sm:sticky sm:top-2 sm:z-10"
            aria-label={isFr ? 'Votre contexte dans le module Programme' : 'Your context in the Programme module'}
          >
            <span className="font-semibold uppercase tracking-wide text-[10px] text-[var(--coya-enterprise-muted)]">
              {isFr ? 'Ancrage' : 'Anchor'}
            </span>
            <span className="hidden h-3 w-px bg-[var(--coya-enterprise-border)] sm:inline" aria-hidden />
            <span>
              <span className="text-[var(--coya-enterprise-muted)]">{isFr ? 'Vous' : 'You'} · </span>
              <span className="font-medium text-[var(--coya-enterprise-text)]">{selfLabel}</span>
            </span>
            {anchorOrgName && (
              <>
                <span className="hidden text-[var(--coya-enterprise-muted)] sm:inline" aria-hidden>·</span>
                <span>
                  <span className="text-[var(--coya-enterprise-muted)]">{isFr ? 'Organisation' : 'Org'} · </span>
                  <span className="font-medium text-[var(--coya-enterprise-text)]">{anchorOrgName}</span>
                </span>
              </>
            )}
            {selectedProgramme && (
              <>
                <span className="hidden text-[var(--coya-enterprise-muted)] sm:inline" aria-hidden>·</span>
                <span>
                  <span className="text-[var(--coya-enterprise-muted)]">{isFr ? 'Programme actif' : 'Active programme'} · </span>
                  <span className="font-medium text-[var(--coya-institutional)]">{selectedProgramme.name}</span>
                </span>
              </>
            )}
            {selectedProgramme && isAuditorReadOnly && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                {isFr ? 'Lecture seule' : 'Read-only'}
              </span>
            )}
            {selectedProgramme && canValidateBudget && !isAuditorReadOnly && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
                {isFr ? 'Budget : validation' : 'Budget: can validate'}
              </span>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-[var(--coya-enterprise-text)]">
              {isFr ? 'Programmes' : 'Programmes'}
            </h2>
            <p className="mt-1 text-sm text-[var(--coya-enterprise-muted)]">
              {isFr ? 'Liste de tous les programmes' : 'List of all programmes'}
            </p>
          </div>

          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid="programmes-enterprise-kpi"
          >
            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                {isFr ? 'Total programmes' : 'Total programmes'}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">{programmes.length}</p>
              <p className="mt-1 text-xs text-[var(--coya-enterprise-muted)]">
                {linkedProjectCount} {isFr ? 'projets rattachés (portefeuille)' : 'linked projects (portfolio)'}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                {isFr ? 'Programmes actifs' : 'Active programmes'}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">{activeProgrammesCount}</p>
              <p className="mt-1 text-xs font-medium text-[var(--coya-institutional)]">
                {programmes.length > 0 ? Math.round((activeProgrammesCount / programmes.length) * 100) : 0}%{' '}
                {isFr ? 'du total' : 'of total'}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                {isFr ? 'Programmes terminés' : 'Completed programmes'}
              </p>
              <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">{completedProgrammesCount}</p>
              <p className="mt-1 text-xs font-medium text-sky-700">
                {programmes.length > 0 ? Math.round((completedProgrammesCount / programmes.length) * 100) : 0}%{' '}
                {isFr ? 'du total' : 'of total'}
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                {isFr ? 'Budget total (prév.)' : 'Total planned budget'}
              </p>
              <p className="mt-2 text-xl font-bold tabular-nums leading-snug text-[var(--coya-enterprise-text)]">{portfolioBudgetTotalLabel}</p>
              <p className="mt-1 text-xs text-[var(--coya-enterprise-muted)]">
                {isFr ? 'Somme des lignes programme (organisme)' : 'Sum of programme budget lines'}
              </p>
            </div>
          </div>

          {!selectedProgramme && (
            <div className="mb-6 rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="relative min-w-0 flex-1">
                  <input
                    type="search"
                    data-testid="programmes-search"
                    value={programmeSearchQuery}
                    onChange={(e) => setProgrammeSearchQuery(e.target.value)}
                    placeholder={
                      isFr
                        ? 'Rechercher par nom, code ou description…'
                        : 'Search by name, code or description…'
                    }
                    className="w-full rounded-xl border border-[var(--coya-enterprise-border)] py-2.5 pl-10 pr-10 text-sm transition-all focus:border-[var(--coya-institutional)] focus:ring-2 focus:ring-emerald-100"
                    autoComplete="off"
                  />
                  <i
                    className="fas fa-search pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--coya-enterprise-muted)]"
                    aria-hidden
                  />
                  {programmeSearchQuery ? (
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--coya-enterprise-muted)] hover:text-[var(--coya-enterprise-text)]"
                      onClick={() => setProgrammeSearchQuery('')}
                      aria-label={isFr ? 'Effacer la recherche' : 'Clear search'}
                    >
                      <i className="fas fa-times" aria-hidden />
                    </button>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <label className="sr-only" htmlFor="programmes-status-filter">
                    {isFr ? 'Filtrer par statut' : 'Filter by status'}
                  </label>
                  <select
                    id="programmes-status-filter"
                    data-testid="programmes-status-filter"
                    value={programmeArchiveFilter}
                    onChange={(e) => setProgrammeArchiveFilter(e.target.value as 'all' | 'active' | 'archived')}
                    className="rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2.5 text-sm focus:border-[var(--coya-institutional)] focus:ring-2 focus:ring-emerald-100"
                  >
                    <option value="all">{isFr ? 'Tous les statuts' : 'All statuses'}</option>
                    <option value="active">{isFr ? 'Actifs (non archivés)' : 'Active (not archived)'}</option>
                    <option value="archived">{isFr ? 'Archivés' : 'Archived'}</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {(showProgrammeForm || editProgramme) && (
            <Fragment key={editProgramme?.id || 'new-programme'}>
              <ProgrammeForm
                isFr={isFr}
                bailleurs={bailleurs}
                initial={editProgramme || undefined}
                onSubmit={handleSaveProgramme}
                onCancel={() => {
                  setShowProgrammeForm(false);
                  setEditProgramme(null);
                }}
                submitting={submitting}
              />
            </Fragment>
          )}

          {!selectedProgramme ? (
            <ProgrammesEnterpriseTable
              programmes={programmesForEnterpriseTable}
              budgetLines={portfolioBudgetLines}
              projects={kpiProjects}
              loading={loading}
              isFr={isFr}
              onSelect={(p) => setSelectedProgramme(p)}
              onEdit={(p) => {
                setEditProgramme(p);
                setShowProgrammeForm(true);
              }}
              onDelete={(p) => setDeleteTarget({ type: 'programme', id: p.id })}
              isAuditorReadOnly={isAuditorReadOnly}
            />
          ) : (
            <div className="space-y-5" data-testid="programme-detail">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2 text-sm font-medium text-[var(--coya-enterprise-text)] shadow-sm transition-colors hover:bg-[#F8FAFC]"
                onClick={() => setSelectedProgramme(null)}
              >
                <i className="fas fa-arrow-left text-xs" aria-hidden />
                {isFr ? 'Retour à la liste des programmes' : 'Back to programmes list'}
              </button>

              <nav
                className="flex flex-wrap items-center gap-2 text-xs text-[var(--coya-enterprise-muted)]"
                aria-label={isFr ? 'Fil d’Ariane programme' : 'Programme breadcrumbs'}
              >
                <span className="font-semibold text-[var(--coya-enterprise-text)]">
                  {isFr ? 'Programmes' : 'Programmes'}
                </span>
                <span className="opacity-40" aria-hidden>
                  /
                </span>
                <span>{isFr ? 'Détail du programme' : 'Programme detail'}</span>
              </nav>

              {programmeDetailFinanceItems.length > 0 ? (
                <EnterpriseFinanceKpiStrip
                  title={isFr ? 'Répartition budgétaire' : 'Budget breakdown'}
                  items={programmeDetailFinanceItems}
                  dataTestId="programme-detail-finance-kpi-strip"
                />
              ) : null}

              <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_minmax(260px,300px)]">
                <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                  <div className="mb-5 flex items-start gap-4">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[var(--coya-institutional)] to-[var(--coya-institutional-secondary)]`}
                    >
                      <i className="fas fa-layer-group text-xl text-white" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <h3 className="text-xl font-semibold tracking-tight text-[var(--coya-enterprise-text)]">
                            {selectedProgramme.name}
                          </h3>
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                              selectedProgramme.allowProjects !== false
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                : 'border-slate-200 bg-slate-100 text-slate-700'
                            }`}
                          >
                            {selectedProgramme.allowProjects !== false
                              ? isFr
                                ? 'Actif'
                                : 'Active'
                              : isFr
                                ? 'Archivé'
                                : 'Archived'}
                          </span>
                          {isAuditorReadOnly && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900">
                              {isFr ? 'Lecture seule' : 'Read-only'}
                            </span>
                          )}
                          {canValidateBudget && !isAuditorReadOnly && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
                              {isFr ? 'Budget : validation' : 'Budget: can validate'}
                            </span>
                          )}
                        </div>
                        {!isAuditorReadOnly && (
                          <button
                            type="button"
                            className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-[var(--coya-institutional)] px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[#157d34]"
                            onClick={() => {
                              setEditProgramme(selectedProgramme);
                              setShowProgrammeForm(true);
                            }}
                          >
                            <i className="fas fa-pen" aria-hidden />
                            {isFr ? 'Modifier le programme' : 'Edit programme'}
                          </button>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--coya-enterprise-muted)]">
                        {selectedProgramme.description || '—'}
                      </p>
                      <p className="mt-2 text-xs text-[var(--coya-enterprise-muted)]">
                        {selectedProgramme.bailleurName || '—'} · {selectedProgramme.startDate || '—'} →{' '}
                        {selectedProgramme.endDate || '—'}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[var(--coya-enterprise-border)] bg-[#F8FAFC]/80 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                        {isFr ? 'Budget (prév.)' : 'Planned budget'}
                      </p>
                      <p className="mt-1 text-sm font-bold tabular-nums text-[var(--coya-enterprise-text)]">
                        {budgetLines.reduce((s, bl) => s + Number(bl.plannedAmount || 0), 0).toLocaleString(isFr ? 'fr-FR' : 'en-US')}{' '}
                        {(budgetLines[0]?.currency as string) || 'XOF'}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--coya-enterprise-border)] bg-[#F8FAFC]/80 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                        {isFr ? 'Projets rattachés' : 'Linked projects'}
                      </p>
                      <p className="mt-1 text-sm font-bold tabular-nums text-[var(--coya-enterprise-text)]">
                        {projectsForProgramme.length}
                      </p>
                    </div>
                    <div className="rounded-xl border border-[var(--coya-enterprise-border)] bg-[#F8FAFC]/80 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                        {isFr ? 'Bailleur principal' : 'Primary donor'}
                      </p>
                      <p className="truncate text-sm font-semibold text-[var(--coya-enterprise-text)]">
                        {selectedProgramme.bailleurName || '—'}
                      </p>
                    </div>
                  </div>
                </div>

                <EnterpriseDonutRing
                  className="lg:sticky lg:top-4"
                  heading={isFr ? 'Progression globale' : 'Overall progress'}
                  centerPrimary={`${programmeTaskProgressPct(selectedProgramme.id)}%`}
                  segments={programmeDetailDonutSegments}
                />
              </div>

                  <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                    <h4 className="mb-4 font-semibold text-[var(--coya-enterprise-text)]">{isFr ? 'Jalons / actions programme' : 'Milestones / programme actions'}</h4>
                    <div className="space-y-3">
                      {actionsList.length === 0 ? (
                        <p className="py-4 text-center text-sm text-[var(--coya-enterprise-muted)]">
                          {isFr ? 'Aucune action' : 'No actions'}
                        </p>
                      ) : (
                        actionsList.map((a) => {
                          const deadline = programmeActionDeadline(a);
                          const doneAction = a.status === 'done';
                          return (
                            <div key={a.id} className="flex items-center gap-3">
                              <div
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                                  doneAction
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-[#F8FAFC] text-[var(--coya-enterprise-muted)]'
                                }`}
                              >
                                <i className={`fas ${doneAction ? 'fa-circle-check' : 'fa-clock'} text-sm`} aria-hidden />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p
                                  className={`text-sm ${
                                    doneAction
                                      ? 'text-[var(--coya-enterprise-muted)] line-through opacity-70'
                                      : 'text-[var(--coya-enterprise-text)]'
                                  }`}
                                >
                                  {a.title}
                                </p>
                                <p className="text-xs text-[var(--coya-enterprise-muted)]">{deadline || '—'}</p>
                              </div>
                              <span
                                className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${
                                  doneAction
                                    ? 'bg-emerald-50 text-emerald-900'
                                    : 'border border-[var(--coya-enterprise-border)] bg-[#F8FAFC] text-[var(--coya-enterprise-muted)]'
                                }`}
                              >
                                {programmeActionStatusLabel(isFr, a.status)}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-6 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                    {programmeWorkspaceContextAsideEl}
                  </div>

                  <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                    <nav className="scrollbar-thin overflow-x-auto pb-0.5" aria-label={isFr ? 'Onglets détail programme' : 'Programme detail tabs'}>
                      <div className="inline-flex min-w-min flex-wrap items-center gap-1 rounded-2xl border border-[var(--coya-enterprise-border)] bg-[#F8FAFC]/50 p-1.5">
                        {(
                          [
                            ['resume', isFr ? 'Aperçu' : 'Overview'],
                            ['budget', isFr ? 'Finances' : 'Finance'],
                            ['projets_terrain', isFr ? 'Projets' : 'Projects'],
                            ['acteurs_collecte', isFr ? 'Parties prenantes' : 'Stakeholders'],
                          ] as const satisfies readonly (readonly [ProgrammeDetailTab, string])[]
                        ).map(([id, label]) => (
                          <button
                            key={id}
                            type="button"
                            className={`shrink-0 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                              detailTab === id
                                ? 'bg-[var(--coya-institutional)] text-white shadow-sm'
                                : 'text-[var(--coya-enterprise-muted)] hover:bg-white hover:text-[var(--coya-enterprise-text)]'
                            }`}
                            onClick={() => setDetailTab(id)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </nav>
                    {selectedProgramme && nav?.setView ? (
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xl border border-[var(--coya-institutional)] bg-white px-3 py-2 text-xs font-semibold text-[var(--coya-institutional)] shadow-sm hover:bg-emerald-50"
                          onClick={() => {
                            try {
                              const u = new URL(window.location.href);
                              u.searchParams.set(NAV_QUERY_MOBILITE_PROGRAMME_ID, selectedProgramme.id);
                              window.history.replaceState({}, '', u.toString());
                            } catch {
                              /* ignore */
                            }
                            nav.setView('demande_mobilite');
                          }}
                        >
                          <i className="fas fa-route" aria-hidden />
                          {t('mobility_link_programme_detail')}
                        </button>
                      </div>
                    ) : null}
                    <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4 lg:p-6">
              {showBudgetPack && selectedProgramme && organizationId && (
                <div className="space-y-3 text-sm">
                  <p className="text-xs text-coya-text-muted">
                    {isFr
                      ? 'Ordre : synthèses → lignes programme → cascade (projet / activité / tâche) → demandes de dépense. Workflow ligne : brouillon → soumis → validé → verrouillé. Le terrain saisit surtout le réel ; la finance / management fait avancer le workflow.'
                      : 'Order: rollups → programme lines → cascade (project / activity / task) → expense requests. Line workflow: draft → submitted → validated → locked. Field teams mainly enter actuals; finance advances workflow.'}
                  </p>
                  {!canValidateBudget && (
                    <p className="text-[10px] text-amber-800 bg-amber-50 rounded px-2 py-1">
                      {isFr
                        ? 'Votre rôle permet de saisir le réel sur les lignes non verrouillées. La validation et les lignes nouvelles sont réservées à la finance / management.'
                        : 'Your role can enter actuals on non-locked lines. New lines and workflow steps are for finance / management.'}
                    </p>
                  )}
                  {(budgetRollupByPost.length > 0 || budgetRollupByScope.length > 0) && (
                    <div className="grid grid-cols-1 gap-2 text-[10px]">
                      {budgetRollupByPost.length > 0 && (
                        <div className="rounded-coya border border-coya-border p-2 bg-coya-card">
                          <div className="font-semibold text-coya-text mb-1">{isFr ? 'Synthèse par poste de dépense' : 'Totals by expense post'}</div>
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-coya-text-muted">
                                <th className="py-0.5">{isFr ? 'Poste' : 'Post'}</th>
                                <th className="py-0.5">{isFr ? 'Prév.' : 'Plan.'}</th>
                                <th className="py-0.5">{isFr ? 'Réel' : 'Act.'}</th>
                                <th className="py-0.5">Δ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {budgetRollupByPost.map((r) => (
                                <tr key={`${r.expensePostCode}-${r.currency}`} className="border-t border-coya-border">
                                  <td className="py-0.5 pr-1">{r.expensePostCode === '__sans_poste__' ? '—' : r.expensePostCode} <span className="text-coya-text-muted">({r.currency})</span></td>
                                  <td className="py-0.5">{r.totalPlanned}</td>
                                  <td className="py-0.5">{r.totalActual}</td>
                                  <td className="py-0.5">{r.variancePlannedMinusActual}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {budgetRollupByScope.length > 0 && (
                        <div className="rounded-coya border border-coya-border p-2 bg-coya-card">
                          <div className="font-semibold text-coya-text mb-1">{isFr ? 'Synthèse par niveau (cascade)' : 'Totals by scope level'}</div>
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-coya-text-muted">
                                <th className="py-0.5">{isFr ? 'Niveau' : 'Level'}</th>
                                <th className="py-0.5">{isFr ? 'Prév.' : 'Plan.'}</th>
                                <th className="py-0.5">{isFr ? 'Réel' : 'Act.'}</th>
                                <th className="py-0.5">Δ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {budgetRollupByScope.map((r) => (
                                <tr key={`${r.scopeLevel}-${r.currency}`} className="border-t border-coya-border">
                                  <td className="py-0.5 pr-1">{r.scopeLevel} <span className="text-coya-text-muted">({r.currency})</span></td>
                                  <td className="py-0.5">{r.totalPlanned}</td>
                                  <td className="py-0.5">{r.totalActual}</td>
                                  <td className="py-0.5">{r.variancePlannedMinusActual}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-medium text-coya-text">{isFr ? 'Lignes budgétaires (programme)' : 'Programme budget lines'}</h4>
                      {!isAuditorReadOnly && (
                        <button type="button" className="text-sm text-coya-primary" onClick={() => { setShowBudgetLineForm(true); setEditBudgetLine(null); }}>
                          + {isFr ? 'Ajouter' : 'Add'}
                        </button>
                      )}
                    </div>
                    {(showBudgetLineForm || editBudgetLine) && (
                      <BudgetLineForm
                        isFr={isFr}
                        initial={editBudgetLine || undefined}
                        onSubmit={handleSaveBudgetLine}
                        onCancel={() => { setShowBudgetLineForm(false); setEditBudgetLine(null); }}
                        submitting={submitting}
                      />
                    )}
                    <ul className="space-y-1 text-sm max-h-48 overflow-y-auto">
                      {budgetLines.map((bl) => (
                        <li key={bl.id} className="flex flex-col p-2 bg-coya-bg rounded-coya gap-0.5">
                          <span className="font-medium">{bl.label}</span>
                          <span className="text-coya-text-muted text-xs">
                            {isFr ? 'Prév.' : 'Plan.'} {bl.plannedAmount} {bl.currency || 'XOF'} · {isFr ? 'Réel' : 'Actual'} {bl.spentAmount ?? 0}
                          </span>
                          {!isAuditorReadOnly && (
                            <span>
                              <button type="button" className="text-coya-primary mr-1 text-xs" onClick={() => setEditBudgetLine(bl)}>{isFr ? 'Mod.' : 'Edit'}</button>
                              <button type="button" className="text-red-600 text-xs" onClick={() => setDeleteTarget({ type: 'budget_line', id: bl.id })}>×</button>
                            </span>
                          )}
                        </li>
                      ))}
                      {budgetLines.length === 0 && !showBudgetLineForm && (
                        <li className="text-coya-text-muted p-2">{isFr ? 'Aucune ligne' : 'No lines'}</li>
                      )}
                    </ul>
                  </div>
                  {!isAuditorReadOnly && canValidateBudget && (
                    <button
                      type="button"
                      className="text-coya-primary text-xs"
                      onClick={() => {
                        setBcForm({
                          scopeLevel: 'programme',
                          label: '',
                          expensePostCode: '',
                          plannedAmount: '',
                          actualAmount: '0',
                          currency: 'XOF',
                          projectId: projectsForProgramme[0]?.id ? String(projectsForProgramme[0].id) : '',
                          activityId: '',
                          projectTaskId: '',
                          parentLineId: '',
                        });
                        setShowBudgetCascadeForm((v) => !v);
                      }}
                    >
                      {showBudgetCascadeForm ? (isFr ? 'Fermer le formulaire' : 'Close form') : `+ ${isFr ? 'Ligne budgétaire' : 'Budget line'}`}
                    </button>
                  )}
                  {showBudgetCascadeForm && !isAuditorReadOnly && canValidateBudget && (
                    <form
                      className="rounded-coya border border-coya-border p-3 space-y-2 bg-coya-bg/50"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const planned = parseFloat(bcForm.plannedAmount) || 0;
                        const actual = parseFloat(bcForm.actualAmount) || 0;
                        if (!bcForm.label.trim()) return;
                        setSubmitting(true);
                        try {
                          await programmeService.createBudgetCascadeLine({
                            organizationId,
                            scopeLevel: bcForm.scopeLevel,
                            programmeId: selectedProgramme.id,
                            projectId: ['project', 'activity', 'task'].includes(bcForm.scopeLevel) ? bcForm.projectId || null : null,
                            activityId: ['activity', 'task'].includes(bcForm.scopeLevel) ? bcForm.activityId || null : null,
                            projectTaskId: bcForm.scopeLevel === 'task' ? bcForm.projectTaskId.trim() || null : null,
                            parentLineId: bcForm.parentLineId || null,
                            expensePostCode: bcForm.expensePostCode.trim() || null,
                            label: bcForm.label.trim(),
                            plannedAmount: planned,
                            actualAmount: actual,
                            currency: bcForm.currency,
                          });
                          setShowBudgetCascadeForm(false);
                          refreshBudgetCascade();
                        } catch (err: any) {
                          setError(err?.message || 'Erreur');
                        } finally {
                          setSubmitting(false);
                        }
                      }}
                    >
                      <select
                        className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs"
                        value={bcForm.scopeLevel}
                        onChange={(e) => setBcForm((f) => ({ ...f, scopeLevel: e.target.value as BudgetCascadeScope }))}
                      >
                        <option value="programme">{isFr ? 'Programme' : 'Programme'}</option>
                        <option value="project">{isFr ? 'Projet' : 'Project'}</option>
                        <option value="activity">{isFr ? 'Activité' : 'Activity'}</option>
                        <option value="task">{isFr ? 'Tâche (id)' : 'Task (id)'}</option>
                      </select>
                      {['project', 'activity', 'task'].includes(bcForm.scopeLevel) && (
                        <select
                          className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs"
                          value={bcForm.projectId}
                          onChange={(e) => setBcForm((f) => ({ ...f, projectId: e.target.value, activityId: '' }))}
                          required
                        >
                          <option value="">{isFr ? 'Projet' : 'Project'}</option>
                          {projectsForProgramme.map((p) => (
                            <option key={p.id} value={String(p.id)}>{p.title}</option>
                          ))}
                        </select>
                      )}
                      {['activity', 'task'].includes(bcForm.scopeLevel) && bcForm.projectId && (
                        <select
                          className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs"
                          value={bcForm.activityId}
                          onChange={(e) => setBcForm((f) => ({ ...f, activityId: e.target.value }))}
                          required
                        >
                          <option value="">{isFr ? 'Activité' : 'Activity'}</option>
                          {budgetFormActivities.map((a) => (
                            <option key={a.id} value={a.id}>{a.title}</option>
                          ))}
                        </select>
                      )}
                      {bcForm.scopeLevel === 'task' && (
                        <input
                          className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs"
                          placeholder={isFr ? 'UUID tâche (module Projets)' : 'Task UUID'}
                          value={bcForm.projectTaskId}
                          onChange={(e) => setBcForm((f) => ({ ...f, projectTaskId: e.target.value }))}
                          required
                        />
                      )}
                      <select
                        className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs"
                        value={bcForm.parentLineId}
                        onChange={(e) => setBcForm((f) => ({ ...f, parentLineId: e.target.value }))}
                      >
                        <option value="">{isFr ? 'Ligne parente (optionnel)' : 'Parent line (optional)'}</option>
                        {budgetCascadeLines.map((l) => (
                          <option key={l.id} value={l.id}>{l.scopeLevel}: {l.label}</option>
                        ))}
                      </select>
                      <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Code poste' : 'Post code'} value={bcForm.expensePostCode} onChange={(e) => setBcForm((f) => ({ ...f, expensePostCode: e.target.value }))} />
                      <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Libellé' : 'Label'} value={bcForm.label} onChange={(e) => setBcForm((f) => ({ ...f, label: e.target.value }))} required />
                      <div className="flex flex-wrap gap-2">
                        <input type="number" step="0.01" className="w-28 rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Prévu' : 'Planned'} value={bcForm.plannedAmount} onChange={(e) => setBcForm((f) => ({ ...f, plannedAmount: e.target.value }))} />
                        <input type="number" step="0.01" className="w-28 rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Réel' : 'Actual'} value={bcForm.actualAmount} onChange={(e) => setBcForm((f) => ({ ...f, actualAmount: e.target.value }))} />
                        <select className="rounded-coya border border-coya-border px-2 py-1 text-xs" value={bcForm.currency} onChange={(e) => setBcForm((f) => ({ ...f, currency: e.target.value as CurrencyCode }))}>
                          {SUPPORTED_CURRENCIES.map((c) => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      </div>
                      <button type="submit" disabled={submitting} className="rounded-coya bg-coya-primary px-3 py-1 text-xs text-white">{isFr ? 'Créer' : 'Create'}</button>
                    </form>
                  )}
                  <ul className="space-y-2 max-h-64 overflow-y-auto">
                    {budgetCascadeLines.map((line) => (
                      <li key={line.id} className="p-2 bg-coya-bg rounded-coya text-xs space-y-1">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{line.label}</span>
                          {!isAuditorReadOnly && canValidateBudget && (
                            <button type="button" className="text-red-600" onClick={() => setDeleteTarget({ type: 'budget_cascade_line', id: line.id })}>×</button>
                          )}
                        </div>
                        <p className="text-coya-text-muted">
                          {line.scopeLevel} · {line.expensePostCode || '—'} · {isFr ? 'Prév.' : 'Plan.'} {line.plannedAmount} {line.currency} / {isFr ? 'Réel' : 'Act.'} {line.actualAmount}
                        </p>
                        <p className="text-[10px] uppercase text-coya-text-muted">{isFr ? 'Workflow' : 'Workflow'}: {line.workflowStatus}</p>
                        {!isAuditorReadOnly && line.workflowStatus !== 'locked' && (
                          <form
                            className="flex flex-wrap items-center gap-1 mt-1"
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const fd = new FormData(e.currentTarget);
                              const v = parseFloat(String(fd.get('actual'))) || 0;
                              try {
                                await programmeService.updateBudgetCascadeLine(line.id, { actualAmount: v });
                                refreshBudgetCascade();
                              } catch (err: any) {
                                setError(err?.message || (isFr ? 'Mise à jour refusée (rôle ou verrou)' : 'Update denied'));
                              }
                            }}
                          >
                            <label className="text-[10px] text-coya-text-muted">{isFr ? 'Réel' : 'Actual'}</label>
                            <input name="actual" type="number" step="0.01" defaultValue={line.actualAmount} className="w-24 text-xs border border-coya-border rounded px-1 py-0.5" />
                            <button type="submit" className="text-[10px] px-2 py-0.5 rounded bg-coya-primary text-white">{isFr ? 'MAJ' : 'Save'}</button>
                          </form>
                        )}
                        {!isAuditorReadOnly && canValidateBudget && line.workflowStatus !== 'locked' && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {line.workflowStatus === 'draft' && (
                              <button type="button" className="px-2 py-0.5 rounded bg-amber-100 text-[10px]" onClick={async () => { try { await programmeService.updateBudgetCascadeLine(line.id, { workflowStatus: 'submitted' }); refreshBudgetCascade(); } catch (err: any) { setError(err?.message || 'Erreur'); } }}>{isFr ? 'Soumettre' : 'Submit'}</button>
                            )}
                            {line.workflowStatus === 'submitted' && (
                              <button type="button" className="px-2 py-0.5 rounded bg-blue-100 text-[10px]" onClick={async () => { try { await programmeService.updateBudgetCascadeLine(line.id, { workflowStatus: 'validated' }); refreshBudgetCascade(); } catch (err: any) { setError(err?.message || 'Erreur'); } }}>{isFr ? 'Valider' : 'Validate'}</button>
                            )}
                            {line.workflowStatus === 'validated' && (
                              <button type="button" className="px-2 py-0.5 rounded bg-slate-200 text-[10px]" onClick={async () => { try { await programmeService.updateBudgetCascadeLine(line.id, { workflowStatus: 'locked' }); refreshBudgetCascade(); } catch (err: any) { setError(err?.message || 'Erreur'); } }}>{isFr ? 'Verrouiller' : 'Lock'}</button>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                    {budgetCascadeLines.length === 0 && <li className="text-coya-text-muted p-2">{isFr ? 'Aucune ligne cascade' : 'No cascade lines'}</li>}
                  </ul>
                  <div className="mt-4 pt-3 border-t border-coya-border">
                    <div className="flex justify-between items-center mb-2">
                      <h4 className="font-medium text-coya-text text-sm">{isFr ? 'Demandes de dépense' : 'Expense requests'}</h4>
                      {!isAuditorReadOnly && (
                        <button type="button" className="text-sm text-coya-primary" onClick={() => setShowExpenseRequestForm(true)}>
                          + {isFr ? 'Nouvelle demande' : 'New request'}
                        </button>
                      )}
                    </div>
                    {showExpenseRequestForm && (
                      <ExpenseRequestForm
                        isFr={isFr}
                        programmeId={selectedProgramme.id}
                        organizationId={organizationId}
                        requestedById={currentUserId}
                        onSubmit={async (title, amount, currency) => {
                          await programmeService.createExpenseRequest({
                            programmeId: selectedProgramme.id,
                            organizationId,
                            title,
                            amount,
                            currency: currency || 'XOF',
                            requestedById: currentUserId,
                          });
                          const list = await programmeService.listExpenseRequests(selectedProgramme.id);
                          setExpenseRequests(list);
                          setShowExpenseRequestForm(false);
                        }}
                        onCancel={() => setShowExpenseRequestForm(false)}
                        submitting={submitting}
                      />
                    )}
                    <ul className="space-y-1 text-sm">
                      {expenseRequests.map((er) => (
                        <li key={er.id} className="flex justify-between items-center p-2 bg-coya-bg rounded-coya">
                          <span>{er.title} — {er.amount} {er.currency}</span>
                          <span className="text-coya-text-muted text-xs">{er.status}</span>
                        </li>
                      ))}
                      {expenseRequests.length === 0 && !showExpenseRequestForm && (
                        <li className="text-coya-text-muted p-2">{isFr ? 'Aucune demande' : 'No requests'}</li>
                      )}
                    </ul>
                  </div>
                </div>
              )}

              {showPeoplePack && selectedProgramme && (
                <>
                <div className="rounded-coya border border-coya-border bg-coya-card p-3 mb-3">
                  <h4 className="font-semibold text-coya-text text-sm mb-2">{isFr ? 'Bailleurs, partenaires & staff' : 'Donors, partners & staff'}</h4>
                  <p className="text-xs text-coya-text-muted mb-2">{isFr ? 'Mise en œuvre, exécutants, contacts bailleurs, techniques, staff interne.' : 'Implementation, executing, donor contacts, technical, internal staff.'}</p>
                  <ProgrammeStakeholderQuickAdd
                    isFr={isFr}
                    programmeId={selectedProgramme.id}
                    orgProfiles={orgProfiles}
                    disabled={isAuditorReadOnly}
                    onCreated={() => loadProgrammeExtras(selectedProgramme.id)}
                  />
                  <ul className="space-y-2 text-sm">
                    {stakeholders.map((s) => (
                      <li key={s.id} className="p-2 bg-coya-bg rounded flex justify-between gap-2">
                        <div>
                          <span className="font-medium text-xs text-coya-text-muted">{stakeholderTypeLabel(isFr, s.stakeholderType)}</span>
                          <p>{orgProfiles.find((p) => p.id === s.profileId)?.label || s.externalName || s.profileId || '—'}</p>
                          {(s.externalRole || s.externalContact) && (
                            <p className="text-xs text-coya-text-muted">{s.externalRole} {s.externalContact}</p>
                          )}
                        </div>
                        {!isAuditorReadOnly && (
                          <button type="button" className="text-red-600 text-xs shrink-0" onClick={() => setDeleteTarget({ type: 'stakeholder', id: s.id })}>×</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-coya border border-coya-border bg-coya-card p-3 mb-3">
                  <div className="flex justify-between items-center mb-2">
                    <h4 className="font-semibold text-coya-text text-sm">{isFr ? 'Participants (bénéficiaires)' : 'Participants (beneficiaries)'}</h4>
                    {!isAuditorReadOnly && (
                      <button type="button" className="text-sm text-coya-primary" onClick={() => { setShowBeneficiaireForm(true); setEditBeneficiaire(null); }}>
                        + {isFr ? 'Ajouter' : 'Add'}
                      </button>
                    )}
                  </div>
                  {(showBeneficiaireForm || editBeneficiaire) && (
                    <BeneficiaireForm
                      isFr={isFr}
                      initial={editBeneficiaire || undefined}
                      onSubmit={handleSaveBeneficiaire}
                      onCancel={() => { setShowBeneficiaireForm(false); setEditBeneficiaire(null); }}
                      submitting={submitting}
                    />
                  )}
                  <ul className="space-y-1 text-sm max-h-40 overflow-y-auto">
                    {beneficiaires.map((b) => (
                      <li key={b.id} className="flex justify-between items-center gap-2 p-2 bg-coya-bg rounded-coya">
                        <span className="min-w-0 truncate">
                          {b.theme || b.contact || b.id.slice(0, 8)}
                          {b.crmContactId && (
                            <span className="ml-1 text-[10px] text-emerald-700" title="CRM">CRM</span>
                          )}
                        </span>
                        {!isAuditorReadOnly && (
                          <span className="flex flex-wrap gap-1 shrink-0 justify-end">
                            {!b.crmContactId && (
                              <button
                                type="button"
                                className="text-emerald-700 text-xs"
                                title={isFr ? 'Créer fiche CRM' : 'Create CRM record'}
                                onClick={async () => {
                                  setSubmitting(true);
                                  try {
                                    await programmeService.syncBeneficiaireToCrm(b.id);
                                    await loadBeneficiaires();
                                  } catch (err: any) {
                                    setError(err?.message || 'CRM');
                                  } finally {
                                    setSubmitting(false);
                                  }
                                }}
                              >
                                {isFr ? '→ CRM' : '→ CRM'}
                              </button>
                            )}
                            <button type="button" className="text-coya-primary text-xs" onClick={() => setEditBeneficiaire(b)}>{isFr ? 'Mod.' : 'Edit'}</button>
                            <button type="button" className="text-red-600 text-xs" onClick={() => setDeleteTarget({ type: 'beneficiaire', id: b.id })}>×</button>
                          </span>
                        )}
                      </li>
                    ))}
                    {beneficiaires.length === 0 && !showBeneficiaireForm && (
                      <li className="text-coya-text-muted p-2">{isFr ? 'Aucun participant enregistré.' : 'No participants yet.'}</li>
                    )}
                  </ul>
                </div>
                <div className="space-y-3">
                  <h4 className="font-semibold text-coya-text text-sm">{isFr ? 'Collecte de données' : 'Data collection'}</h4>
                  <div className="rounded-coya border border-coya-border bg-coya-card/80 p-3 text-xs text-coya-text-muted space-y-2">
                    <p>
                      {isFr
                        ? 'Grille rapide liée au programme. Les campagnes et envois CRM détaillés se gèrent dans le module Collecte.'
                        : 'Quick grid for this programme. Campaigns and CRM push use the Data collection module.'}
                    </p>
                    {nav?.setView && (
                      <button
                        type="button"
                        className="rounded-coya bg-coya-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-95"
                        onClick={() => {
                          try {
                            sessionStorage.setItem(NAV_SESSION_COLLECTE_PRESET_PROGRAMME_ID, selectedProgramme.id);
                          } catch (_) { /* ignore */ }
                          nav.setView('collecte');
                        }}
                      >
                        {isFr ? 'Ouvrir le module Collecte →' : 'Open Data collection →'}
                      </button>
                    )}
                  </div>
                  <ProgrammeCollecteBlock
                    isFr={isFr}
                    programmeId={selectedProgramme.id}
                    section={collectSection}
                    onSectionChange={setCollectSection}
                    rows={dataRows}
                    disabled={isAuditorReadOnly}
                    onRefresh={() => loadProgrammeExtras(selectedProgramme.id)}
                    onDeleteRow={(id) => setDeleteTarget({ type: 'data_row', id })}
                  />
                </div>
                </>
              )}

              {showResume && selectedProgramme && (
                <div className="rounded-coya border border-coya-border bg-coya-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="text-xs text-coya-text-muted">
                      {isFr ? 'Cockpit programme (CQRS)' : 'Programme cockpit (CQRS)'}
                      {programmeCockpit?.generatedAt ? (
                        <span className="ml-1">
                          · {isFr ? 'généré' : 'generated'} {new Date(programmeCockpit.generatedAt).toLocaleString()}
                        </span>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      disabled={programmeCockpitLoading || isAuditorReadOnly}
                      className="rounded-coya bg-coya-primary px-3 py-1.5 text-xs font-medium text-white hover:opacity-95 disabled:opacity-50"
                      onClick={rebuildProgrammeCockpitNow}
                      title={isAuditorReadOnly ? (isFr ? 'Lecture seule' : 'Read-only') : undefined}
                    >
                      {programmeCockpitLoading
                        ? isFr ? 'Rebuild…' : 'Rebuilding…'
                        : isFr ? 'Rebuild cockpit' : 'Rebuild cockpit'}
                    </button>
                  </div>
                  {selectedProgramme && (
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="rounded-full bg-coya-bg px-2 py-1 text-coya-text-muted">
                        {isFr ? 'Statut projection' : 'Projection status'}:{' '}
                        <span className="font-medium text-coya-text">
                          {programmeCockpitRow?.projection_status || (programmeCockpitLoading ? (isFr ? 'chargement' : 'loading') : (isFr ? 'inconnu' : 'unknown'))}
                        </span>
                      </span>
                      {programmeCockpitRow?.projection_run_id ? (
                        <span className="rounded-full bg-coya-bg px-2 py-1 text-coya-text-muted">
                          run_id: <span className="font-mono text-coya-text">{programmeCockpitRow.projection_run_id.slice(0, 10)}…</span>
                        </span>
                      ) : null}
                      {programmeCockpitRow?.watermark_event_occurred_at ? (
                        <span className="rounded-full bg-coya-bg px-2 py-1 text-coya-text-muted">
                          {isFr ? 'Watermark events' : 'Events watermark'}:{' '}
                          <span className="font-medium text-coya-text">{new Date(programmeCockpitRow.watermark_event_occurred_at).toLocaleString()}</span>
                        </span>
                      ) : null}
                      {programmeCockpitRow?.watermark_source_updated_at ? (
                        <span className="rounded-full bg-coya-bg px-2 py-1 text-coya-text-muted">
                          {isFr ? 'Source data' : 'Source data'}:{' '}
                          <span className="font-medium text-coya-text">{new Date(programmeCockpitRow.watermark_source_updated_at).toLocaleString()}</span>
                        </span>
                      ) : null}
                    </div>
                  )}
                  {programmeCockpitError ? (
                    <p className="text-xs text-red-600 mb-2">{programmeCockpitError}</p>
                  ) : null}
                  {programmeCockpit ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
                      <div className="rounded bg-coya-bg p-2">
                        <div className="text-[10px] text-coya-text-muted">{isFr ? 'Risque (proxy)' : 'Risk (proxy)'}</div>
                        <div className="text-sm font-semibold">
                          {programmeCockpit.riskProxy.level.toUpperCase()} · {programmeCockpit.riskProxy.score}/100
                        </div>
                      </div>
                      <div className="rounded bg-coya-bg p-2">
                        <div className="text-[10px] text-coya-text-muted">{isFr ? 'Budget (prév. / réel)' : 'Budget (planned / actual)'}</div>
                        <div className="text-sm font-semibold">
                          {new Intl.NumberFormat(isFr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 }).format(programmeCockpit.budget.plannedTotal)}
                          {' / '}
                          {new Intl.NumberFormat(isFr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 }).format(programmeCockpit.budget.actualTotal)}
                          <span className="ml-1 text-xs text-coya-text-muted">{programmeCockpit.budget.currency}</span>
                        </div>
                        <div className="text-[10px] text-coya-text-muted">
                          Δ {programmeCockpit.budget.variancePercent.toFixed(1)}% · burn {programmeCockpit.budget.burnRatePercent.toFixed(1)}%
                        </div>
                      </div>
                      <div className="rounded bg-coya-bg p-2">
                        <div className="text-[10px] text-coya-text-muted">{isFr ? 'Alertes' : 'Alerts'}</div>
                        <div className="text-sm font-semibold">{programmeCockpit.alerts.length}</div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-coya-text-muted mb-3">
                      {isFr
                        ? 'Aucun snapshot cockpit trouvé. Cliquez sur « Rebuild cockpit » pour en générer un.'
                        : 'No cockpit snapshot found. Click “Rebuild cockpit” to generate one.'}
                    </p>
                  )}
                  <p className="text-xs text-coya-text-muted mb-2">
                    {isFr
                      ? 'Seuls les rôles autorisés (manager, superviseur, formation, admin…) peuvent créer ou supprimer une action. Les personnes assignées marquent « réalisé » avec un lien ou une capture. Après la date de fin, l’action non faite passe en non réalisée.'
                      : 'Only authorized roles can create or delete actions. Assignees mark items done with a link or screenshot. After the end date, unfinished actions become not done.'}
                  </p>
                  <ProgrammeActionQuickAdd
                    isFr={isFr}
                    programmeId={selectedProgramme.id}
                    orgProfiles={orgProfiles}
                    disabled={isAuditorReadOnly || !canManageProgrammeActions}
                    onCreated={() => loadProgrammeExtras(selectedProgramme.id)}
                  />
                  <ul className="space-y-2 text-sm">
                    {actionsList.map((a) => {
                      const assignees = programmeActionEffectiveAssignees(a);
                      const assigneeLabels = assignees
                        .map((id) => orgProfiles.find((p) => p.id === id)?.label || id)
                        .join(', ');
                      const deadline = programmeActionDeadline(a);
                      const today = new Date().toISOString().slice(0, 10);
                      const overdue = deadline ? today > deadline : false;
                      const isAssignee = !!(myProfileId && assignees.includes(myProfileId));
                      const canMarkDone =
                        !isAuditorReadOnly &&
                        !['done', 'cancelled', 'not_realized'].includes(a.status) &&
                        ['assigned', 'validated', 'pending_validation'].includes(a.status) &&
                        !overdue &&
                        (isAssignee || canManageProgrammeActions);
                      return (
                        <li key={a.id} className="p-2 bg-coya-bg rounded space-y-1">
                          <div className="flex justify-between gap-2 items-start">
                            <div
                              role="button"
                              tabIndex={0}
                              className="flex-1 min-w-0 cursor-pointer rounded-md p-1 -m-1 hover:bg-white/50 focus:outline-none focus:ring-1 focus:ring-coya-primary"
                              onClick={() => setProgrammeActionDetailId(a.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setProgrammeActionDetailId(a.id);
                                }
                              }}
                            >
                              <div className="flex justify-between gap-2 items-start">
                                <span className="font-medium">{a.title}</span>
                                <span className="text-[10px] text-coya-primary shrink-0 whitespace-nowrap">
                                  {isFr ? 'Détails →' : 'Details →'}
                                </span>
                              </div>
                              <p className="text-xs text-coya-text-muted mt-0.5">
                                {a.actionType} · {programmeActionStatusLabel(isFr, a.status)}
                                {deadline && (
                                  <span className="ml-1">
                                    · {isFr ? 'échéance' : 'due'} {deadline}
                                    {a.periodStart ? ` (${isFr ? 'du' : 'from'} ${a.periodStart})` : ''}
                                  </span>
                                )}
                              </p>
                              {assigneeLabels ? (
                                <p className="text-[10px] text-coya-text-muted">
                                  {isFr ? 'Assigné(s) : ' : 'Assignees: '}
                                  {assigneeLabels}
                                </p>
                              ) : null}
                              {a.status === 'done' && (a.proofUrl || a.proofStoragePath) && (
                                <p className="text-[10px] text-coya-primary">
                                  {isFr ? 'Preuve enregistrée — voir dans les détails' : 'Proof on file — see details'}
                                </p>
                              )}
                            </div>
                            {canManageProgrammeActions && !isAuditorReadOnly && (
                              <button
                                type="button"
                                className="text-red-600 text-xs shrink-0 pt-0.5"
                                onClick={() => setDeleteTarget({ type: 'action', id: a.id })}
                              >
                                ×
                              </button>
                            )}
                          </div>
                          {!isAuditorReadOnly && canManageProgrammeActions && (
                            <div className="flex flex-wrap gap-1">
                              {a.status === 'draft' && (
                                <button
                                  type="button"
                                  className="text-[10px] px-2 py-0.5 rounded bg-amber-100"
                                  onClick={async () => {
                                    await programmeService.updateProgrammeAction(a.id, { status: 'pending_validation' });
                                    await loadProgrammeExtras(selectedProgramme.id);
                                  }}
                                >
                                  {isFr ? 'Soumettre' : 'Submit'}
                                </button>
                              )}
                              {a.status === 'pending_validation' && myProfileId && (
                                <button
                                  type="button"
                                  className="text-[10px] px-2 py-0.5 rounded bg-blue-100"
                                  onClick={async () => {
                                    const nextStatus = programmeActionEffectiveAssignees(a).length ? 'assigned' : 'validated';
                                    await programmeService.updateProgrammeAction(a.id, {
                                      status: nextStatus,
                                      validatedByProfileId: myProfileId,
                                      validatedAt: new Date().toISOString(),
                                    });
                                    await loadProgrammeExtras(selectedProgramme.id);
                                  }}
                                >
                                  {isFr ? 'Valider' : 'Validate'}
                                </button>
                              )}
                            </div>
                          )}
                          {canMarkDone && myProfileId && (
                            <button
                              type="button"
                              className="text-[10px] px-2 py-0.5 rounded bg-emerald-100"
                              onClick={() => setMarkDoneAction(a)}
                            >
                              {isFr ? 'Marquer réalisé (lien ou capture)' : 'Mark done (link or screenshot)'}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  {markDoneAction && selectedProgramme && organizationId && (
                    <ProgrammeActionMarkDoneModal
                      isFr={isFr}
                      action={markDoneAction}
                      organizationId={organizationId}
                      myProfileId={myProfileId}
                      onClose={() => setMarkDoneAction(null)}
                      onSaved={async () => {
                        setMarkDoneAction(null);
                        await loadProgrammeExtras(selectedProgramme.id);
                      }}
                    />
                  )}
                  {programmeActionDetail && selectedProgramme && (
                    <ProgrammeActionDetailModal
                      isFr={isFr}
                      action={programmeActionDetail}
                      orgProfiles={orgProfiles}
                      myProfileId={myProfileId}
                      organizationId={organizationId}
                      canManage={canManageProgrammeActions}
                      isAuditorReadOnly={isAuditorReadOnly}
                      onClose={() => setProgrammeActionDetailId(null)}
                      onUpdated={async () => loadProgrammeExtras(selectedProgramme.id)}
                      onRequestMarkDone={(act) => {
                        setProgrammeActionDetailId(null);
                        setMarkDoneAction(act);
                      }}
                      onRequestDelete={(id) => {
                        setProgrammeActionDetailId(null);
                        setDeleteTarget({ type: 'action', id });
                      }}
                    />
                  )}
                </div>
              )}

              {showExecutionPack && selectedProgramme && (
                <div className="space-y-6 text-sm">
                  {selectedProgramme.allowProjects === false ? (
                    <p className="text-sm text-coya-text-muted">{isFr ? 'Les projets sont désactivés pour ce programme.' : 'Projects are disabled for this programme.'}</p>
                  ) : (
                    <>
                      {nav?.setView && (
                        <button
                          type="button"
                          className="mb-2 rounded-coya bg-coya-primary px-3 py-1.5 text-xs text-white"
                          onClick={() => {
                            try {
                              sessionStorage.setItem(NAV_SESSION_PROGRAMMES_PROJECTS_TAB, 'projects');
                            } catch (_) { /* ignore */ }
                            nav.setView(projectsHomeView(canAccessModule));
                          }}
                        >
                          {isFr ? 'Ouvrir le module Projets' : 'Open Projects module'}
                        </button>
                      )}
                      <h4 className="font-medium text-coya-text mb-2">{isFr ? 'Projets liés' : 'Linked projects'}</h4>
                      <ul className="space-y-1 text-sm">
                        {projectsForProgramme.map((proj) => (
                          <li key={proj.id} className="flex justify-between items-center gap-2 p-2 bg-coya-bg rounded-coya">
                            <span className="truncate min-w-0" title={proj.title}>{proj.title}</span>
                            <span className="text-coya-text-muted text-xs shrink-0">{proj.status}</span>
                            {nav?.setView && (
                              <button
                                type="button"
                                className="shrink-0 rounded-coya border border-coya-border px-2 py-1 text-[10px] font-medium text-coya-primary hover:bg-white"
                                onClick={() => {
                                  try {
                                    sessionStorage.setItem(NAV_SESSION_OPEN_PROJECT_ID, String(proj.id));
                                    sessionStorage.setItem(NAV_SESSION_PROGRAMMES_PROJECTS_TAB, 'projects');
                                  } catch (_) { /* ignore */ }
                                  nav.setView(projectsHomeView(canAccessModule));
                                }}
                              >
                                {isFr ? 'Fiche projet →' : 'Open project →'}
                              </button>
                            )}
                          </li>
                        ))}
                        {projectsForProgramme.length === 0 && (
                          <li className="text-coya-text-muted p-2">{isFr ? 'Aucun projet lié' : 'No linked projects'}</li>
                        )}
                      </ul>
                    </>
                  )}
                  {selectedProgramme.allowProjects !== false && (
                    <div className="space-y-3 pt-4 border-t border-coya-border">
                      <h4 className="font-medium text-coya-text">{isFr ? 'Activités & tâches (terrain)' : 'Activities & tasks (field)'}</h4>
                      <p className="text-xs text-coya-text-muted">
                        {isFr
                          ? 'Choisissez un projet, créez des activités de terrain, puis rattachez les tâches du module Projets à une activité.'
                          : 'Pick a project, add field activities, then link project tasks to an activity.'}
                      </p>
                      <div>
                        <label className="text-xs text-coya-text-muted block mb-1">{isFr ? 'Projet du programme' : 'Programme project'}</label>
                        <select
                          className="w-full rounded-coya border border-coya-border px-2 py-1.5 text-sm"
                          value={terrainProjectId}
                          onChange={(e) => setTerrainProjectId(e.target.value)}
                        >
                          <option value="">{isFr ? '— Choisir un projet —' : '— Select project —'}</option>
                          {projectsForProgramme.map((p) => (
                            <option key={p.id} value={String(p.id)}>{p.title}</option>
                          ))}
                        </select>
                      </div>
                      {terrainProjectId && organizationId && (
                        <>
                          <div className="flex justify-between items-center">
                            <h4 className="font-medium text-coya-text">{isFr ? 'Activités' : 'Activities'}</h4>
                            {!isAuditorReadOnly && (
                              <button
                                type="button"
                                className="text-coya-primary text-xs"
                                onClick={() => { setShowActivityForm(true); setEditActivity(null); }}
                              >
                                + {isFr ? 'Activité' : 'Activity'}
                              </button>
                            )}
                          </div>
                          {(showActivityForm || editActivity) && (
                            <Fragment key={editActivity?.id || 'new-activity'}>
                              <ActivityTerrainForm
                                isFr={isFr}
                                initial={editActivity || undefined}
                                submitting={submitting}
                                onCancel={() => { setShowActivityForm(false); setEditActivity(null); }}
                                onSubmit={async (e, form) => {
                                e.preventDefault();
                                if (!form.title.trim()) return;
                                setSubmitting(true);
                                try {
                                  if (editActivity) {
                                    await programmeService.updateProjectActivity(editActivity.id, {
                                      title: form.title.trim(),
                                      description: form.description.trim() || null,
                                      location: form.location.trim() || null,
                                      startDate: form.startDate || null,
                                      endDate: form.endDate || null,
                                      status: form.status,
                                      melTargetLabel: form.melTargetLabel.trim() || null,
                                      melTargetValue: form.melTargetValue === '' ? null : parseFloat(form.melTargetValue) || null,
                                      melResultValue: form.melResultValue === '' ? null : parseFloat(form.melResultValue) || null,
                                      melUnit: form.melUnit.trim() || null,
                                      melNotes: form.melNotes.trim() || null,
                                    });
                                    setEditActivity(null);
                                  } else {
                                    await programmeService.createProjectActivity({
                                      organizationId,
                                      programmeId: selectedProgramme.id,
                                      projectId: terrainProjectId,
                                      title: form.title.trim(),
                                      description: form.description.trim() || null,
                                      location: form.location.trim() || null,
                                      startDate: form.startDate || null,
                                      endDate: form.endDate || null,
                                      status: form.status,
                                      melTargetLabel: form.melTargetLabel.trim() || null,
                                      melTargetValue: form.melTargetValue === '' ? null : parseFloat(form.melTargetValue) || null,
                                      melResultValue: form.melResultValue === '' ? null : parseFloat(form.melResultValue) || null,
                                      melUnit: form.melUnit.trim() || null,
                                      melNotes: form.melNotes.trim() || null,
                                    });
                                    setShowActivityForm(false);
                                  }
                                  setProjectActivities(await programmeService.listProjectActivities(terrainProjectId));
                                } catch (err: any) {
                                  setError(err?.message || 'Erreur');
                                } finally {
                                  setSubmitting(false);
                                }
                              }}
                              />
                            </Fragment>
                          )}
                          <ul className="space-y-1 max-h-36 overflow-y-auto">
                            {projectActivities.map((a) => (
                              <li key={a.id} className="flex justify-between items-start p-2 bg-coya-bg rounded-coya gap-2">
                                <div>
                                  <span className="font-medium">{a.title}</span>
                                  <span className="text-coya-text-muted text-xs ml-1">({a.status})</span>
                                  {a.location && <p className="text-xs text-coya-text-muted">{a.location}</p>}
                                  {(a.melTargetLabel || a.melResultValue != null) && (
                                    <p className="text-[10px] text-emerald-800 mt-0.5">
                                      MEL: {a.melTargetLabel || '—'}
                                      {a.melTargetValue != null && ` → cible ${a.melTargetValue}${a.melUnit ? ` ${a.melUnit}` : ''}`}
                                      {a.melResultValue != null && ` · réalisé ${a.melResultValue}`}
                                    </p>
                                  )}
                                </div>
                                {!isAuditorReadOnly && (
                                  <span className="shrink-0">
                                    <button type="button" className="text-coya-primary text-xs mr-1" onClick={() => setEditActivity(a)}>{isFr ? 'Mod.' : 'Edit'}</button>
                                    <button type="button" className="text-red-600 text-xs" onClick={() => setDeleteTarget({ type: 'project_activity', id: a.id })}>×</button>
                                  </span>
                                )}
                              </li>
                            ))}
                            {projectActivities.length === 0 && <li className="text-coya-text-muted text-xs p-2">{isFr ? 'Aucune activité' : 'No activities'}</li>}
                          </ul>
                          <div className="rounded-coya border border-coya-border bg-coya-card p-3">
                            <h4 className="font-medium text-coya-text mb-2">{isFr ? 'Tâches du projet → activité' : 'Project tasks → activity'}</h4>
                            {!terrainProjectSnapshot?.tasks?.length ? (
                              <p className="text-xs text-coya-text-muted">{isFr ? 'Aucune tâche sur ce projet (module Projets).' : 'No tasks on this project (Projects module).'}</p>
                            ) : (
                              <>
                                <ul className="space-y-2 max-h-40 overflow-y-auto">
                                  {terrainProjectSnapshot.tasks.map((t) => (
                                    <li key={t.id} className="flex flex-col gap-1 p-2 bg-coya-bg rounded text-xs">
                                      <span className="font-medium truncate">{t.text}</span>
                                      <select
                                        className="rounded-coya border border-coya-border px-2 py-1"
                                        value={taskActivityChoice[t.id] || ''}
                                        onChange={(e) => setTaskActivityChoice((prev) => ({ ...prev, [t.id]: e.target.value }))}
                                        disabled={isAuditorReadOnly}
                                      >
                                        <option value="">{isFr ? '— Sans activité —' : '— No activity —'}</option>
                                        {projectActivities.map((a) => (
                                          <option key={a.id} value={a.id}>{a.title}</option>
                                        ))}
                                      </select>
                                    </li>
                                  ))}
                                </ul>
                                {!isAuditorReadOnly && (
                                  <button
                                    type="button"
                                    className="mt-2 rounded-coya bg-coya-primary px-3 py-1.5 text-xs text-white"
                                    onClick={async () => {
                                      if (!terrainProjectSnapshot) return;
                                      const tasks: Task[] = (terrainProjectSnapshot.tasks || []).map((t) => ({
                                        ...t,
                                        activityId: taskActivityChoice[t.id] || null,
                                      }));
                                      const ok = await DataAdapter.updateProject({ ...terrainProjectSnapshot, tasks });
                                      if (!ok) setError(isFr ? 'Échec enregistrement tâches' : 'Failed to save tasks');
                                      else {
                                        const list = await DataAdapter.getProjects();
                                        const refreshed = list.filter((p) => p.programmeId === selectedProgramme.id);
                                        setProjectsForProgramme(refreshed);
                                        const p = refreshed.find((x) => String(x.id) === String(terrainProjectId));
                                        if (p) setTerrainProjectSnapshot({ ...p });
                                      }
                                    }}
                                  >
                                    {isFr ? 'Enregistrer les rattachements tâches' : 'Save task–activity links'}
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
                    </div>
                  </div>
              </div>
              )}
        </div>
      )}

      {deleteTarget && (
        <ConfirmationModal
          title={isFr ? 'Confirmer la suppression' : 'Confirm delete'}
          message={isFr ? 'Cette action est irréversible.' : 'This action cannot be undone.'}
          confirmLabel={isFr ? 'Supprimer' : 'Delete'}
          cancelLabel={isFr ? 'Annuler' : 'Cancel'}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
          variant="danger"
          isLoading={submitting}
        />
      )}
    </StructuredModulePage>
  );
};

/** Méta programme + bailleurs additionnels — inspecteur desktop et empilement mobile ; gabarit cartes aligné Figma Make (Projects.tsx). */
function ProgrammeWorkspaceContextAside({
  isFr,
  programme,
  bailleurs,
  extraBailleurToAdd,
  onExtraBailleurToAddChange,
  extraBailleurs,
  isAuditorReadOnly,
  navSetView,
  onToggleAllowProjects,
  onAddExtraBailleur,
  onRemoveProgBailleurLink,
}: {
  isFr: boolean;
  programme: Programme;
  bailleurs: Bailleur[];
  extraBailleurToAdd: string;
  onExtraBailleurToAddChange: (value: string) => void;
  extraBailleurs: ProgrammeBailleurLink[];
  isAuditorReadOnly: boolean;
  navSetView?: (view: string) => void;
  onToggleAllowProjects: (checked: boolean) => void | Promise<void>;
  onAddExtraBailleur: () => void | Promise<void>;
  onRemoveProgBailleurLink: (linkId: string) => void;
}) {
  return (
    <>
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
          {isFr ? 'Options & rattachements' : 'Options & links'}
        </p>
        {!isAuditorReadOnly && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-gray-900">
            <input
              type="checkbox"
              checked={programme.allowProjects !== false}
              onChange={(e) => {
                void onToggleAllowProjects(e.target.checked);
              }}
            />
            {isFr ? 'Autoriser les projets rattachés' : 'Allow linked projects'}
          </label>
        )}
        {navSetView && (
          <div className="mt-4 border-t border-gray-100 pt-3">
            <p className="mb-2 text-xs text-gray-500">
              {isFr
                ? 'Ouvrir APEX (cours) rattachés à ce programme dans le module e-learning.'
                : 'Open trainings linked to this programme in the Courses module.'}
            </p>
            <button
              type="button"
              className="rounded-xl bg-[#0d1b2a] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1a3a5c]"
              onClick={() => {
                try {
                  sessionStorage.setItem(NAV_SESSION_COURSES_PROGRAMME_ID, programme.id);
                } catch (_) {
                  /* ignore */
                }
                navSetView('apex');
              }}
            >
              {isFr ? 'Voir les cours du programme (APEX) →' : 'View programme courses (APEX) →'}
            </button>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
        <h4 className="mb-2 text-sm font-medium text-gray-900">{isFr ? 'Bailleurs additionnels' : 'Additional donors'}</h4>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="min-w-[140px] flex-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-slate-400"
            value={extraBailleurToAdd}
            onChange={(e) => onExtraBailleurToAddChange(e.target.value)}
          >
            <option value="">—</option>
            {bailleurs
              .filter((b) => b.id !== programme.bailleurId && !extraBailleurs.some((x) => x.bailleurId === b.id))
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
          {!isAuditorReadOnly && (
            <button
              type="button"
              className="rounded-xl bg-[#0d1b2a] px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1a3a5c]"
              onClick={() => {
                void onAddExtraBailleur();
              }}
            >
              {isFr ? 'Ajouter' : 'Add'}
            </button>
          )}
        </div>
        <ul className="mt-2 space-y-1 text-sm">
          {extraBailleurs.map((l) => (
            <li key={l.id} className="flex justify-between gap-2 rounded-lg bg-gray-50 p-2 text-gray-900">
              <span className="min-w-0">{l.bailleurName || l.bailleurId}</span>
              {!isAuditorReadOnly && (
                <button type="button" className="text-red-600 text-xs shrink-0" onClick={() => onRemoveProgBailleurLink(l.id)}>
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function ProgrammeStakeholderQuickAdd({
  isFr,
  programmeId,
  orgProfiles,
  disabled,
  onCreated,
}: {
  isFr: boolean;
  programmeId: string;
  orgProfiles: { id: string; label: string }[];
  disabled?: boolean;
  onCreated: () => void;
}) {
  const [stakeholderType, setStakeholderType] = useState<ProgrammeStakeholderType>('facilitator');
  const [profileId, setProfileId] = useState('');
  const [externalName, setExternalName] = useState('');
  const [externalRole, setExternalRole] = useState('');
  const [externalContact, setExternalContact] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profileId && !externalName.trim()) return;
    setSaving(true);
    try {
      await programmeService.createProgrammeStakeholder({
        programmeId,
        stakeholderType,
        profileId: profileId || null,
        externalName: externalName.trim() || null,
        externalRole: externalRole.trim() || null,
        externalContact: externalContact.trim() || null,
      });
      setProfileId('');
      setExternalName('');
      setExternalRole('');
      setExternalContact('');
      onCreated();
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-coya border border-coya-border p-3 space-y-2 text-sm mb-3 bg-coya-bg/50">
      <select className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm" value={stakeholderType} onChange={(e) => setStakeholderType(e.target.value as ProgrammeStakeholderType)} disabled={disabled}>
        {STAKEHOLDER_TYPE_OPTIONS.map((o) => (
          <option key={o.v} value={o.v}>{isFr ? o.fr : o.en}</option>
        ))}
      </select>
      <select className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm" value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={disabled}>
        <option value="">{isFr ? 'Salarié (profil)' : 'Employee (profile)'}</option>
        {orgProfiles.map((p) => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
      <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm" placeholder={isFr ? 'Nom externe (si pas de profil)' : 'External name'} value={externalName} onChange={(e) => setExternalName(e.target.value)} disabled={disabled} />
      <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm" placeholder={isFr ? 'Rôle' : 'Role'} value={externalRole} onChange={(e) => setExternalRole(e.target.value)} disabled={disabled} />
      <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm" placeholder={isFr ? 'Contact' : 'Contact'} value={externalContact} onChange={(e) => setExternalContact(e.target.value)} disabled={disabled} />
      <button type="submit" disabled={disabled || saving} className="rounded-coya bg-coya-primary px-3 py-1 text-xs text-white disabled:opacity-50">
        {saving ? '…' : (isFr ? 'Ajouter' : 'Add')}
      </button>
    </form>
  );
}

function ProgrammeActionQuickAdd({
  isFr,
  programmeId,
  orgProfiles,
  disabled,
  onCreated,
}: {
  isFr: boolean;
  programmeId: string;
  orgProfiles: { id: string; label: string }[];
  disabled?: boolean;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [actionType, setActionType] = useState('formation');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);

  const toggleAssignee = (id: string) => {
    setAssigneeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const ids = [...assigneeIds];
    if (ids.length && !periodEnd.trim()) {
      setLocalErr(isFr ? 'Indiquez une date de fin (échéance) lorsqu’il y a des assignés.' : 'End date is required when assignees are selected.');
      return;
    }
    setLocalErr(null);
    setSaving(true);
    try {
      const status = ids.length && periodEnd ? 'assigned' : 'draft';
      await programmeService.createProgrammeAction({
        programmeId,
        title: title.trim(),
        actionType,
        periodStart: periodStart || null,
        periodEnd: periodEnd || null,
        dueDate: periodEnd || null,
        assigneeProfileIds: ids,
        executorProfileId: ids[0] ?? null,
        notes: notes.trim() || null,
        status,
      });
      setTitle('');
      setPeriodStart('');
      setPeriodEnd('');
      setAssigneeIds(new Set());
      setNotes('');
      onCreated();
    } catch (ex: any) {
      const msg = ex?.message || ex?.error_description || String(ex);
      setLocalErr(
        isFr
          ? `Impossible d’enregistrer : ${msg}. Si la base n’a pas les migrations récentes (colonnes period_*, assignés), l’app utilise un mode compatible ; sinon vérifiez les droits RLS.`
          : `Could not save: ${msg}.`,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="rounded-coya border border-coya-border p-3 space-y-2 text-sm mb-3 bg-coya-bg/50">
      <input className="w-full rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Titre de l’action' : 'Action title'} value={title} onChange={(e) => setTitle(e.target.value)} required disabled={disabled} />
      <input className="w-full rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Type (formation, collecte…)' : 'Type'} value={actionType} onChange={(e) => setActionType(e.target.value)} disabled={disabled} />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-coya-text-muted">
          {isFr ? 'Début période' : 'Period start'}
          <input type="date" className="w-full rounded-coya border border-coya-border px-2 py-1 mt-0.5" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} disabled={disabled} />
        </label>
        <label className="text-[10px] text-coya-text-muted">
          {isFr ? 'Fin / échéance' : 'End / due'}
          <input type="date" className="w-full rounded-coya border border-coya-border px-2 py-1 mt-0.5" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} disabled={disabled} />
        </label>
      </div>
      <div>
        <span className="text-[10px] text-coya-text-muted block mb-1">{isFr ? 'Assigner à (un ou plusieurs)' : 'Assign to (one or more)'}</span>
        <div className="max-h-28 overflow-y-auto rounded-coya border border-coya-border p-2 space-y-1 bg-white/50">
          {orgProfiles.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer">
              <input type="checkbox" checked={assigneeIds.has(p.id)} onChange={() => toggleAssignee(p.id)} disabled={disabled} />
              <span>{p.label}</span>
            </label>
          ))}
          {orgProfiles.length === 0 && (
            <span className="text-xs text-coya-text-muted">{isFr ? 'Aucun profil org.' : 'No org profiles.'}</span>
          )}
        </div>
      </div>
      {localErr && <p className="text-xs text-red-600">{localErr}</p>}
      <textarea className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs" rows={2} placeholder={isFr ? 'Notes' : 'Notes'} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={disabled} />
      <button type="submit" disabled={disabled || saving} className="rounded-coya bg-coya-primary px-3 py-1 text-xs text-white disabled:opacity-50">
        {saving ? '…' : (isFr ? 'Ajouter' : 'Add')}
      </button>
    </form>
  );
}

function ProgrammeActionMarkDoneModal({
  isFr,
  action,
  organizationId,
  myProfileId,
  onClose,
  onSaved,
}: {
  isFr: boolean;
  action: ProgrammeAction;
  organizationId: string;
  myProfileId: string;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [proofUrl, setProofUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = proofUrl.trim();
    if (!url && !file) {
      setErr(isFr ? 'Ajoutez un lien ou une capture d’écran.' : 'Add a link or a screenshot.');
      return;
    }
    if (!myProfileId) {
      setErr(isFr ? 'Profil utilisateur introuvable.' : 'User profile not found.');
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      let proofStoragePath: string | null = null;
      let proofUrlOut: string | null = url || null;
      if (file) {
        const up = await programmeService.uploadProgrammeActionProofFile(organizationId, action.id, file);
        proofStoragePath = up.storagePath;
        if (!proofUrlOut) proofUrlOut = null;
      }
      await programmeService.updateProgrammeAction(action.id, {
        status: 'done',
        proofUrl: proofUrlOut,
        proofStoragePath,
        completedByProfileId: myProfileId,
        completedAt: new Date().toISOString(),
      });
      await onSaved();
    } catch (ex: any) {
      setErr(ex?.message || String(ex));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-coya-card rounded-coya border border-coya-border max-w-md w-full p-4 shadow-lg space-y-3">
        <h3 className="font-semibold text-coya-text text-sm">{isFr ? 'Marquer comme réalisé' : 'Mark as done'}</h3>
        <p className="text-xs text-coya-text-muted">{action.title}</p>
        <form onSubmit={submit} className="space-y-2">
          <input
            className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm"
            placeholder={isFr ? 'Lien (URL) vers la preuve' : 'Proof URL'}
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
          />
          <label className="block text-xs text-coya-text-muted">
            {isFr ? 'Ou capture d’écran (image)' : 'Or screenshot (image)'}
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="w-full text-xs mt-1" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="rounded-coya border border-coya-border px-3 py-1 text-xs" onClick={onClose}>
              {isFr ? 'Annuler' : 'Cancel'}
            </button>
            <button type="submit" disabled={saving} className="rounded-coya bg-emerald-600 px-3 py-1 text-xs text-white disabled:opacity-50">
              {saving ? '…' : (isFr ? 'Enregistrer' : 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatIsoDateShort(isFr: boolean, iso?: string | null): string {
  if (!iso) return '—';
  const d = String(iso).slice(0, 10);
  if (d.length !== 10) return String(iso);
  try {
    const [y, m, day] = d.split('-').map(Number);
    const dt = new Date(y, m - 1, day);
    return dt.toLocaleDateString(isFr ? 'fr-FR' : 'en-GB', { dateStyle: 'medium' });
  } catch {
    return d;
  }
}

function profileLabel(orgProfiles: { id: string; label: string }[], id: string | null | undefined): string {
  if (!id) return '—';
  return orgProfiles.find((p) => p.id === id)?.label || id;
}

function ProgrammeActionDetailModal({
  isFr,
  action,
  orgProfiles,
  myProfileId,
  organizationId,
  canManage,
  isAuditorReadOnly,
  onClose,
  onUpdated,
  onRequestMarkDone,
  onRequestDelete,
}: {
  isFr: boolean;
  action: ProgrammeAction;
  orgProfiles: { id: string; label: string }[];
  myProfileId: string;
  organizationId: string | null;
  canManage: boolean;
  isAuditorReadOnly: boolean;
  onClose: () => void;
  onUpdated: () => void | Promise<void>;
  onRequestMarkDone: (a: ProgrammeAction) => void;
  onRequestDelete: (id: string) => void;
}) {
  const assignees = programmeActionEffectiveAssignees(action);
  const deadline = programmeActionDeadline(action);
  const today = new Date().toISOString().slice(0, 10);
  const overdue = deadline ? today > deadline : false;
  const isAssignee = !!(myProfileId && assignees.includes(myProfileId));
  const canMarkDone =
    !isAuditorReadOnly &&
    !['done', 'cancelled', 'not_realized'].includes(action.status) &&
    ['assigned', 'validated', 'pending_validation'].includes(action.status) &&
    !overdue &&
    (isAssignee || canManage);

  const [reassignIds, setReassignIds] = useState<Set<string>>(() => new Set(assignees));
  const [reassignSaving, setReassignSaving] = useState(false);
  const [reassignErr, setReassignErr] = useState<string | null>(null);
  const [reassignNote, setReassignNote] = useState<string | null>(null);

  useEffect(() => {
    setReassignIds(new Set(programmeActionEffectiveAssignees(action)));
    setReassignErr(null);
    setReassignNote(null);
  }, [action.id, action.assigneeProfileIds.join(','), action.executorProfileId]);

  const toggleReassign = (id: string) => {
    setReassignIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveReassign = async () => {
    setReassignErr(null);
    setReassignNote(null);
    setReassignSaving(true);
    try {
      const ids: string[] = Array.from(reassignIds);
      try {
        await programmeService.setProgrammeActionAssignees(action.id, ids);
      } catch {
        const first = ids[0] ?? null;
        await programmeService.updateProgrammeAction(action.id, { executorProfileId: first ?? undefined });
        setReassignNote(
          isFr
            ? 'Base sans table multi-assignés : seul l’exécuteur principal a été mis à jour.'
            : 'Legacy DB: only primary executor was updated.',
        );
      }
      await onUpdated();
    } catch (ex: any) {
      setReassignErr(ex?.message || String(ex));
    } finally {
      setReassignSaving(false);
    }
  };

  const proofImgUrl = action.proofStoragePath
    ? programmeService.getProgrammeActionProofPublicUrl(action.proofStoragePath)
    : null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="bg-coya-card rounded-coya border border-coya-border max-w-lg w-full max-h-[90vh] overflow-y-auto p-4 shadow-lg space-y-3">
        <div className="flex justify-between gap-2 items-start">
          <h3 className="font-semibold text-coya-text text-sm pr-2">{action.title}</h3>
          <button type="button" className="rounded-coya border border-coya-border px-2 py-1 text-xs shrink-0" onClick={onClose}>
            {isFr ? 'Fermer' : 'Close'}
          </button>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-coya-text-muted">{isFr ? 'Type' : 'Type'}</dt>
          <dd>{action.actionType}</dd>
          <dt className="text-coya-text-muted">{isFr ? 'Statut' : 'Status'}</dt>
          <dd>{programmeActionStatusLabel(isFr, action.status)}</dd>
          {action.periodStart || action.periodEnd ? (
            <>
              <dt className="text-coya-text-muted">{isFr ? 'Période' : 'Period'}</dt>
              <dd>
                {action.periodStart || '—'} → {action.periodEnd || action.dueDate || '—'}
              </dd>
            </>
          ) : null}
          {action.dueDate && !action.periodEnd ? (
            <>
              <dt className="text-coya-text-muted">{isFr ? 'Échéance' : 'Due'}</dt>
              <dd>{String(action.dueDate).slice(0, 10)}</dd>
            </>
          ) : null}
          {assignees.length ? (
            <>
              <dt className="text-coya-text-muted align-top pt-0.5">{isFr ? 'Assigné(s)' : 'Assignees'}</dt>
              <dd>
                <ul className="list-disc pl-4 space-y-0.5">
                  {assignees.map((id) => (
                    <li key={id}>{profileLabel(orgProfiles, id)}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : (
            <>
              <dt className="text-coya-text-muted">{isFr ? 'Assigné(s)' : 'Assignees'}</dt>
              <dd className="text-coya-text-muted">—</dd>
            </>
          )}
          {action.validatedByProfileId ? (
            <>
              <dt className="text-coya-text-muted">{isFr ? 'Validé par' : 'Validated by'}</dt>
              <dd>
                {profileLabel(orgProfiles, action.validatedByProfileId)}
                {action.validatedAt ? ` · ${formatIsoDateShort(isFr, action.validatedAt)}` : ''}
              </dd>
            </>
          ) : null}
          {action.status === 'done' && (action.completedByProfileId || action.completedAt) ? (
            <>
              <dt className="text-coya-text-muted">{isFr ? 'Réalisé' : 'Completed'}</dt>
              <dd>
                {profileLabel(orgProfiles, action.completedByProfileId)}
                {action.completedAt ? ` · ${formatIsoDateShort(isFr, action.completedAt)}` : ''}
              </dd>
            </>
          ) : null}
          {action.notes ? (
            <>
              <dt className="text-coya-text-muted align-top">{isFr ? 'Notes' : 'Notes'}</dt>
              <dd className="whitespace-pre-wrap">{action.notes}</dd>
            </>
          ) : null}
        </dl>

        {(action.proofUrl || proofImgUrl) && (
          <div className="rounded-coya border border-coya-border bg-coya-bg/50 p-2 space-y-2">
            <p className="text-xs font-medium text-coya-text">{isFr ? 'Preuves' : 'Proof'}</p>
            {action.proofUrl ? (
              <p className="text-xs break-all">
                <a href={action.proofUrl} target="_blank" rel="noreferrer" className="text-coya-primary underline">
                  {action.proofUrl}
                </a>
              </p>
            ) : null}
            {proofImgUrl ? (
              <a href={proofImgUrl} target="_blank" rel="noreferrer" className="block">
                <img src={proofImgUrl} alt="" className="max-h-40 rounded border border-coya-border object-contain" />
                <span className="text-[10px] text-coya-primary underline">{isFr ? 'Ouvrir la capture' : 'Open screenshot'}</span>
              </a>
            ) : null}
          </div>
        )}

        {canManage && !isAuditorReadOnly && (
          <div className="rounded-coya border border-coya-border p-2 space-y-2">
            <p className="text-xs font-medium text-coya-text">{isFr ? 'Réaffecter' : 'Reassign'}</p>
            <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto text-xs">
              {orgProfiles.map((p) => (
                <label key={p.id} className="inline-flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={reassignIds.has(p.id)} onChange={() => toggleReassign(p.id)} />
                  <span>{p.label}</span>
                </label>
              ))}
            </div>
            {reassignErr && <p className="text-xs text-red-600">{reassignErr}</p>}
            {reassignNote && <p className="text-xs text-amber-700">{reassignNote}</p>}
            <button
              type="button"
              disabled={reassignSaving}
              className="rounded-coya bg-coya-primary px-2 py-1 text-[10px] text-white disabled:opacity-50"
              onClick={() => void saveReassign()}
            >
              {reassignSaving ? '…' : isFr ? 'Enregistrer les assignations' : 'Save assignees'}
            </button>
          </div>
        )}

        {!isAuditorReadOnly && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-coya-border">
            {canManage && action.status === 'draft' && (
              <button
                type="button"
                className="text-[10px] px-2 py-1 rounded bg-amber-100"
                onClick={async () => {
                  await programmeService.updateProgrammeAction(action.id, { status: 'pending_validation' });
                  await onUpdated();
                }}
              >
                {isFr ? 'Soumettre' : 'Submit'}
              </button>
            )}
            {canManage && action.status === 'pending_validation' && myProfileId && (
              <button
                type="button"
                className="text-[10px] px-2 py-1 rounded bg-blue-100"
                onClick={async () => {
                  const nextStatus = programmeActionEffectiveAssignees(action).length ? 'assigned' : 'validated';
                  await programmeService.updateProgrammeAction(action.id, {
                    status: nextStatus,
                    validatedByProfileId: myProfileId,
                    validatedAt: new Date().toISOString(),
                  });
                  await onUpdated();
                }}
              >
                {isFr ? 'Valider' : 'Validate'}
              </button>
            )}
            {canMarkDone && myProfileId && organizationId && (
              <button
                type="button"
                className="text-[10px] px-2 py-1 rounded bg-emerald-100"
                onClick={() => onRequestMarkDone(action)}
              >
                {isFr ? 'Marquer réalisé…' : 'Mark done…'}
              </button>
            )}
            {canManage && (
              <button type="button" className="text-[10px] px-2 py-1 rounded bg-red-50 text-red-700" onClick={() => onRequestDelete(action.id)}>
                {isFr ? 'Supprimer…' : 'Delete…'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityTerrainForm({
  isFr,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  isFr: boolean;
  initial?: ProjectActivity;
  onSubmit: (
    e: React.FormEvent,
    form: {
      title: string;
      description: string;
      location: string;
      startDate: string;
      endDate: string;
      status: ProjectActivity['status'];
      melTargetLabel: string;
      melTargetValue: string;
      melResultValue: string;
      melUnit: string;
      melNotes: string;
    }
  ) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [location, setLocation] = useState(initial?.location ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate?.slice(0, 10) ?? '');
  const [status, setStatus] = useState<ProjectActivity['status']>(initial?.status ?? 'planned');
  const [melTargetLabel, setMelTargetLabel] = useState(initial?.melTargetLabel ?? '');
  const [melTargetValue, setMelTargetValue] = useState(initial?.melTargetValue != null ? String(initial.melTargetValue) : '');
  const [melResultValue, setMelResultValue] = useState(initial?.melResultValue != null ? String(initial.melResultValue) : '');
  const [melUnit, setMelUnit] = useState(initial?.melUnit ?? '');
  const [melNotes, setMelNotes] = useState(initial?.melNotes ?? '');

  return (
    <div className="rounded-coya border border-coya-border bg-coya-card p-3 mb-2">
      <form
        onSubmit={(e) =>
          onSubmit(e, {
            title,
            description,
            location,
            startDate,
            endDate,
            status,
            melTargetLabel,
            melTargetValue,
            melResultValue,
            melUnit,
            melNotes,
          })}
        className="space-y-2"
      >
        <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm" placeholder={isFr ? 'Titre activité' : 'Activity title'} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <textarea className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs min-h-[50px]" placeholder={isFr ? 'Description' : 'Description'} value={description} onChange={(e) => setDescription(e.target.value)} />
        <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-sm" placeholder={isFr ? 'Lieu' : 'Location'} value={location} onChange={(e) => setLocation(e.target.value)} />
        <div className="flex gap-2 flex-wrap">
          <input type="date" className="flex-1 min-w-[120px] rounded-coya border border-coya-border px-2 py-1 text-xs" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <input type="date" className="flex-1 min-w-[120px] rounded-coya border border-coya-border px-2 py-1 text-xs" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <select className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value as ProjectActivity['status'])}>
          <option value="planned">{isFr ? 'Planifiée' : 'Planned'}</option>
          <option value="in_progress">{isFr ? 'En cours' : 'In progress'}</option>
          <option value="completed">{isFr ? 'Terminée' : 'Completed'}</option>
          <option value="cancelled">{isFr ? 'Annulée' : 'Cancelled'}</option>
        </select>
        <div className="border-t border-coya-border pt-2 mt-1 space-y-1">
          <p className="text-[10px] font-semibold text-coya-text">{isFr ? 'Indicateurs MEL (bailleur / rapportage)' : 'MEL indicators'}</p>
          <input className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Libellé indicateur' : 'Indicator label'} value={melTargetLabel} onChange={(e) => setMelTargetLabel(e.target.value)} />
          <div className="flex flex-wrap gap-1">
            <input type="number" step="0.01" className="w-24 rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Cible' : 'Target'} value={melTargetValue} onChange={(e) => setMelTargetValue(e.target.value)} />
            <input type="number" step="0.01" className="w-24 rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Réalisé' : 'Achieved'} value={melResultValue} onChange={(e) => setMelResultValue(e.target.value)} />
            <input className="w-20 rounded-coya border border-coya-border px-2 py-1 text-xs" placeholder={isFr ? 'Unité' : 'Unit'} value={melUnit} onChange={(e) => setMelUnit(e.target.value)} />
          </div>
          <textarea className="w-full rounded-coya border border-coya-border px-2 py-1 text-xs min-h-[40px]" placeholder={isFr ? 'Notes résultats / preuves' : 'Results / evidence notes'} value={melNotes} onChange={(e) => setMelNotes(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={submitting} className="rounded-coya bg-coya-primary px-3 py-1 text-xs text-white">{isFr ? 'Enregistrer' : 'Save'}</button>
          <button type="button" className="rounded-coya border border-coya-border px-3 py-1 text-xs" onClick={onCancel}>{isFr ? 'Annuler' : 'Cancel'}</button>
        </div>
      </form>
    </div>
  );
}

function ProgrammeCollecteBlock({
  isFr,
  programmeId,
  section,
  onSectionChange,
  rows,
  disabled,
  onRefresh,
  onDeleteRow,
}: {
  isFr: boolean;
  programmeId: string;
  section: string;
  onSectionChange: (s: string) => void;
  rows: ProgrammeDataRow[];
  disabled?: boolean;
  onRefresh: () => void;
  onDeleteRow: (id: string) => void;
}) {
  const filtered = rows.filter((r) => r.section === section);
  const colKeys = useMemo(() => collecteGridColumnKeysForRows(filtered), [filtered]);

  const addRow = async () => {
    const empty: Record<string, string> = {};
    COLLECTE_GRID_COLUMN_KEYS.forEach((c) => {
      empty[c] = '';
    });
    await programmeService.createProgrammeDataRow({ programmeId, section, rowData: empty });
    onRefresh();
  };

  const saveCell = async (rowId: string, prev: Record<string, string>, col: string, value: string) => {
    await programmeService.updateProgrammeDataRow(rowId, { rowData: { ...prev, [col]: value } });
    onRefresh();
  };

  return (
    <div className="rounded-coya border border-coya-border bg-coya-card p-3 space-y-2">
      <div className="flex flex-wrap gap-2 items-center">
        <label className="text-xs text-coya-text-muted">{isFr ? 'Section' : 'Section'}</label>
        <input className="flex-1 min-w-[120px] rounded-coya border border-coya-border px-2 py-1 text-sm" value={section} onChange={(e) => onSectionChange(e.target.value)} disabled={disabled} />
        {!disabled && (
          <button type="button" className="rounded-coya bg-coya-primary px-2 py-1 text-xs text-white" onClick={addRow}>
            + {isFr ? 'Ligne' : 'Row'}
          </button>
        )}
      </div>
      <p className="text-[10px] text-coya-text-muted">
        {isFr
          ? 'Colonnes : identité, localisation, contact, profil, NINEA / formalisation (défilement horizontal si besoin). Les anciennes colonnes col1–col4 restent visibles si présentes dans les données.'
          : 'Columns: identity, location, contact, profile, tax ID / formalisation (scroll horizontally). Legacy col1–col4 still shown if present in data.'}
      </p>
      <div className="overflow-x-auto max-w-full">
        <table className="w-max min-w-full text-xs border border-coya-border">
          <thead>
            <tr className="bg-coya-bg">
              {colKeys.map((c) => (
                <th key={c} className="p-2 text-left font-medium align-bottom min-w-[132px] max-w-[240px]">
                  {getCollecteColumnLabel(c, isFr)}
                </th>
              ))}
              <th className="p-2 w-10 shrink-0" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-coya-border">
                {colKeys.map((c) => (
                  <td key={c} className="p-1 align-top">
                    <input
                      className="w-full min-w-[120px] max-w-[260px] rounded border border-coya-border px-2 py-1.5"
                      defaultValue={r.rowData[c] || ''}
                      disabled={disabled}
                      onBlur={(e) => saveCell(r.id, r.rowData, c, e.target.value)}
                    />
                  </td>
                ))}
                <td className="p-1 align-top">
                  {!disabled && (
                    <button type="button" className="text-red-600 px-1" aria-label={isFr ? 'Supprimer la ligne' : 'Delete row'} onClick={() => onDeleteRow(r.id)}>×</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length === 0 && <p className="text-xs text-coya-text-muted">{isFr ? 'Aucune ligne dans cette section.' : 'No rows in this section.'}</p>}
    </div>
  );
}

function BailleurForm({
  isFr,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  isFr: boolean;
  initial?: Bailleur;
  onSubmit: (e: React.FormEvent, form: { name: string; code: string; description: string; contact: string }) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [contact, setContact] = useState(initial?.contact ?? '');
  const [step, setStep] = useState<0 | 1 | 2 | 3>(0);

  return (
    <div className="rounded-coya border border-coya-border bg-coya-card p-4 mb-4">
      <form onSubmit={(e) => onSubmit(e, { name, code, description, contact })} className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-coya-text-muted">
            {isFr ? 'Assistant de création bailleur' : 'Donor wizard'} · {isFr ? 'Étape' : 'Step'} {step + 1}/4
          </p>
          <div className="flex gap-2">
            <button type="button" className="text-xs text-coya-primary" onClick={onCancel}>
              {isFr ? 'Fermer' : 'Close'}
            </button>
          </div>
        </div>

        {step === 0 && (
          <>
            <input type="text" className="w-full rounded-coya border border-coya-border px-3 py-2" placeholder={isFr ? 'Nom' : 'Name'} value={name} onChange={(e) => setName(e.target.value)} required />
            <input type="text" className="w-full rounded-coya border border-coya-border px-3 py-2" placeholder={isFr ? 'Code (optionnel)' : 'Code (optional)'} value={code} onChange={(e) => setCode(e.target.value)} />
          </>
        )}

        {step === 1 && (
          <>
            <input type="text" className="w-full rounded-coya border border-coya-border px-3 py-2" placeholder={isFr ? 'Contact (email / téléphone / personne)' : 'Contact'} value={contact} onChange={(e) => setContact(e.target.value)} />
          </>
        )}

        {step === 2 && (
          <>
            <textarea className="w-full rounded-coya border border-coya-border px-3 py-2 min-h-[90px]" placeholder={isFr ? 'Description / notes' : 'Description / notes'} value={description} onChange={(e) => setDescription(e.target.value)} />
          </>
        )}

        {step === 3 && (
          <div className="rounded bg-coya-bg p-3 text-sm">
            <p className="font-semibold">{name || '—'}</p>
            <p className="text-xs text-coya-text-muted mt-1">{code ? `Code: ${code}` : (isFr ? 'Code: —' : 'Code: —')}</p>
            <p className="text-xs text-coya-text-muted mt-1">{contact ? `${isFr ? 'Contact' : 'Contact'}: ${contact}` : (isFr ? 'Contact: —' : 'Contact: —')}</p>
            <p className="text-xs text-coya-text-muted mt-1">{description ? description : (isFr ? 'Description: —' : 'Description: —')}</p>
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" className="rounded-coya border border-coya-border px-4 py-2 text-sm disabled:opacity-50" disabled={submitting || step === 0} onClick={() => setStep((s) => (s > 0 ? ((s - 1) as any) : s))}>
            {isFr ? 'Précédent' : 'Back'}
          </button>
          {step < 3 ? (
            <button type="button" className="rounded-coya bg-coya-primary px-4 py-2 text-sm text-white disabled:opacity-50" disabled={submitting || (step === 0 && !name.trim())} onClick={() => setStep((s) => (s < 3 ? ((s + 1) as any) : s))}>
              {isFr ? 'Suivant' : 'Next'}
            </button>
          ) : (
            <button
              type="submit"
              className="rounded-coya bg-coya-primary px-4 py-2 text-sm text-white disabled:opacity-50"
              disabled={submitting || !name.trim()}
              aria-label={isFr ? 'Enregistrer le bailleur' : 'Save donor'}
            >
              {isFr ? 'Enregistrer' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function ProgrammeForm({
  isFr,
  bailleurs,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  isFr: boolean;
  bailleurs: Bailleur[];
  initial?: Programme;
  onSubmit: (
    e: React.FormEvent,
    form: {
      name: string;
      code: string;
      description: string;
      bailleurId: string;
      startDate: string;
      endDate: string;
      allowProjects: boolean;
    }
  ) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [code, setCode] = useState(initial?.code ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [bailleurId, setBailleurId] = useState(initial?.bailleurId ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate?.slice(0, 10) ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate?.slice(0, 10) ?? '');
  const [allowProjects, setAllowProjects] = useState(initial?.allowProjects !== false);
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);

  return (
    <div className="rounded-coya border border-coya-border bg-coya-card p-4 mb-4">
      <form onSubmit={(e) => onSubmit(e, { name, code, description, bailleurId, startDate, endDate, allowProjects })} className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-coya-text-muted">
            {isFr ? 'Assistant de création programme' : 'Programme wizard'} · {isFr ? 'Étape' : 'Step'} {step + 1}/5
          </p>
          <button type="button" className="text-xs text-coya-primary" onClick={onCancel}>
            {isFr ? 'Fermer' : 'Close'}
          </button>
        </div>

        {step === 0 && (
          <>
            <input type="text" className="w-full rounded-coya border border-coya-border px-3 py-2" placeholder={isFr ? 'Nom du programme' : 'Programme name'} value={name} onChange={(e) => setName(e.target.value)} required />
            <input type="text" className="w-full rounded-coya border border-coya-border px-3 py-2" placeholder={isFr ? 'Code (optionnel)' : 'Code (optional)'} value={code} onChange={(e) => setCode(e.target.value)} />
          </>
        )}

        {step === 1 && (
          <>
            <select className="w-full rounded-coya border border-coya-border px-3 py-2" value={bailleurId} onChange={(e) => setBailleurId(e.target.value)}>
              <option value="">— {isFr ? 'Bailleur (optionnel)' : 'Donor (optional)'} —</option>
              {bailleurs.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </>
        )}

        {step === 2 && (
          <>
            <input type="date" className="w-full rounded-coya border border-coya-border px-3 py-2" placeholder={isFr ? 'Début' : 'Start'} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <input type="date" className="w-full rounded-coya border border-coya-border px-3 py-2" placeholder={isFr ? 'Fin' : 'End'} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            {startDate && endDate && endDate < startDate ? (
              <p className="text-xs text-red-600">{isFr ? 'La date de fin doit être après la date de début.' : 'End date must be after start date.'}</p>
            ) : null}
          </>
        )}

        {step === 3 && (
          <>
            <textarea className="w-full rounded-coya border border-coya-border px-3 py-2 min-h-[90px]" placeholder={isFr ? 'Description (optionnel)' : 'Description (optional)'} value={description} onChange={(e) => setDescription(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allowProjects} onChange={(e) => setAllowProjects(e.target.checked)} />
              {isFr ? 'Autoriser les projets rattachés à ce programme' : 'Allow projects under this programme'}
            </label>
          </>
        )}

        {step === 4 && (
          <div className="rounded bg-coya-bg p-3 text-sm">
            <p className="font-semibold">{name || '—'}</p>
            <p className="text-xs text-coya-text-muted mt-1">{code ? `Code: ${code}` : 'Code: —'}</p>
            <p className="text-xs text-coya-text-muted mt-1">
              {isFr ? 'Bailleur' : 'Donor'}: {bailleurId ? (bailleurs.find((b) => b.id === bailleurId)?.name || bailleurId) : '—'}
            </p>
            <p className="text-xs text-coya-text-muted mt-1">{isFr ? 'Période' : 'Period'}: {startDate || '—'} → {endDate || '—'}</p>
            <p className="text-xs text-coya-text-muted mt-1">{isFr ? 'Projets' : 'Projects'}: {allowProjects ? (isFr ? 'autorisés' : 'allowed') : (isFr ? 'désactivés' : 'disabled')}</p>
            {description ? <p className="text-xs text-coya-text-muted mt-1">{description}</p> : null}
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" className="rounded-coya border border-coya-border px-4 py-2 text-sm disabled:opacity-50" disabled={submitting || step === 0} onClick={() => setStep((s) => (s > 0 ? ((s - 1) as any) : s))}>
            {isFr ? 'Précédent' : 'Back'}
          </button>
          {step < 4 ? (
            <button type="button" className="rounded-coya bg-coya-primary px-4 py-2 text-sm text-white disabled:opacity-50" disabled={submitting || (step === 0 && !name.trim()) || (step === 2 && !!(startDate && endDate && endDate < startDate))} onClick={() => setStep((s) => (s < 4 ? ((s + 1) as any) : s))}>
              {isFr ? 'Suivant' : 'Next'}
            </button>
          ) : (
            <button type="submit" className="rounded-coya bg-coya-primary px-4 py-2 text-sm text-white disabled:opacity-50" disabled={submitting || !name.trim() || !!(startDate && endDate && endDate < startDate)}>
              {isFr ? 'Enregistrer' : 'Save'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function BudgetLineForm({
  isFr,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  isFr: boolean;
  initial?: ProgrammeBudgetLine;
  onSubmit: (e: React.FormEvent, form: { label: string; plannedAmount: string; spentAmount: string; currency: CurrencyCode }) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [plannedAmount, setPlannedAmount] = useState(initial?.plannedAmount?.toString() ?? '');
  const [spentAmount, setSpentAmount] = useState(initial?.spentAmount?.toString() ?? '');
  const [currency, setCurrency] = useState<CurrencyCode>(initial?.currency ?? 'XOF');

  return (
    <div className="rounded-coya border border-coya-border bg-coya-bg p-3 mb-2">
      <form onSubmit={(e) => onSubmit(e, { label, plannedAmount, spentAmount, currency })} className="space-y-2 flex flex-wrap gap-2 items-end">
        <input type="text" className="flex-1 min-w-[120px] rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Libellé' : 'Label'} value={label} onChange={(e) => setLabel(e.target.value)} required />
        <input type="number" step="0.01" className="w-24 rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Prév.' : 'Planned'} value={plannedAmount} onChange={(e) => setPlannedAmount(e.target.value)} />
        <input type="number" step="0.01" className="w-24 rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Dépensé' : 'Spent'} value={spentAmount} onChange={(e) => setSpentAmount(e.target.value)} />
        <select className="rounded-coya border border-coya-border px-2 py-1" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="rounded-coya bg-coya-primary px-3 py-1 text-sm text-white disabled:opacity-50" disabled={submitting}>{isFr ? 'OK' : 'OK'}</button>
        <button type="button" className="rounded-coya border border-coya-border px-3 py-1 text-sm" onClick={onCancel}>{isFr ? 'Annuler' : 'Cancel'}</button>
      </form>
    </div>
  );
}

function BeneficiaireForm({
  isFr,
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  isFr: boolean;
  initial?: Beneficiaire;
  onSubmit: (e: React.FormEvent, form: Partial<Beneficiaire>) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [theme, setTheme] = useState(initial?.theme ?? '');
  const [target, setTarget] = useState(initial?.target ?? '');
  const [contact, setContact] = useState(initial?.contact ?? '');
  const [gender, setGender] = useState(initial?.gender ?? '');
  const [sector, setSector] = useState(initial?.sector ?? '');
  const [country, setCountry] = useState(initial?.country ?? '');
  const [region, setRegion] = useState(initial?.region ?? '');
  const [age, setAge] = useState(initial?.age ?? '');
  const [education, setEducation] = useState(initial?.education ?? '');
  const [profession, setProfession] = useState(initial?.profession ?? '');

  return (
    <div className="rounded-coya border border-coya-border bg-coya-bg p-3 mb-2">
      <form onSubmit={(e) => onSubmit(e, { theme, target, contact, gender, sector, country, region, age, education, profession })} className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Thème' : 'Theme'} value={theme} onChange={(e) => setTheme(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Cible' : 'Target'} value={target} onChange={(e) => setTarget(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Contact' : 'Contact'} value={contact} onChange={(e) => setContact(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Genre' : 'Gender'} value={gender} onChange={(e) => setGender(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Secteur' : 'Sector'} value={sector} onChange={(e) => setSector(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Pays' : 'Country'} value={country} onChange={(e) => setCountry(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Région' : 'Region'} value={region} onChange={(e) => setRegion(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Âge' : 'Age'} value={age} onChange={(e) => setAge(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Études' : 'Education'} value={education} onChange={(e) => setEducation(e.target.value)} />
          <input type="text" className="rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Profession' : 'Profession'} value={profession} onChange={(e) => setProfession(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="submit" className="rounded-coya bg-coya-primary px-3 py-1 text-sm text-white disabled:opacity-50" disabled={submitting}>{isFr ? 'Enregistrer' : 'Save'}</button>
          <button type="button" className="rounded-coya border border-coya-border px-3 py-1 text-sm" onClick={onCancel}>{isFr ? 'Annuler' : 'Cancel'}</button>
        </div>
      </form>
    </div>
  );
}

function ExpenseRequestForm({
  isFr,
  onSubmit,
  onCancel,
  submitting,
}: {
  isFr: boolean;
  programmeId: string;
  organizationId: string | null;
  requestedById: string | null;
  onSubmit: (title: string, amount: number, currency: string) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState<CurrencyCode>('XOF');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseFloat(amount);
    if (!title.trim() || isNaN(n) || n < 0) return;
    setSaving(true);
    try {
      await onSubmit(title.trim(), n, currency);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-coya border border-coya-border bg-coya-bg p-3 mb-2">
      <form onSubmit={handleSubmit} className="space-y-2 flex flex-wrap gap-2 items-end">
        <input type="text" className="flex-1 min-w-[120px] rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Objet de la demande' : 'Request title'} value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input type="number" step="0.01" min="0" className="w-28 rounded-coya border border-coya-border px-2 py-1" placeholder={isFr ? 'Montant' : 'Amount'} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <select className="rounded-coya border border-coya-border px-2 py-1" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
          {SUPPORTED_CURRENCIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button type="submit" className="rounded-coya bg-coya-primary px-3 py-1 text-sm text-white disabled:opacity-50" disabled={submitting || saving}>{saving ? (isFr ? 'Création…' : 'Creating…') : (isFr ? 'Créer' : 'Create')}</button>
        <button type="button" className="rounded-coya border border-coya-border px-3 py-1 text-sm" onClick={onCancel}>{isFr ? 'Annuler' : 'Cancel'}</button>
      </form>
    </div>
  );
}

export default ProgrammeModule;
