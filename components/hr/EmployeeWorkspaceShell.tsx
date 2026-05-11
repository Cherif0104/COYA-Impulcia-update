import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ObjectWorkspaceFloorplan,
  KPIStrip,
  PillTabs,
  WorkspaceRouteShell,
  WorkspaceTopBar,
  WorkspaceBackButton,
  WorkspaceBreadcrumbs,
  WorkspaceSection,
  TimelineEmptyState,
  type KPIStripItem,
  type WorkspaceBreadcrumbItem,
} from '../../ui-runtime';
import { useLocalization } from '../../contexts/LocalizationContext';
import { useAuth } from '../../contexts/AuthContextSupabase';
import { Language, User, type LeaveRequest, type Employee, type Objective } from '../../types';
import WorkJournalTab from '../WorkJournalTab';
import DataAdapter from '../../services/dataAdapter';
import OrganizationService from '../../services/organizationService';
import * as hrAnalyticsService from '../../services/hrAnalyticsService';
import * as payrollService from '../../services/payrollService';
import type { PaySlip } from '../../services/payrollService';
import * as payrollEngine from '../../services/payrollEngine';
import { DataService } from '../../services/dataService';
import * as workJournalService from '../../services/workJournalService';
import { downloadPaySlipPdf } from '../../services/paySlipPdfExport';
import HrDocumentRequestsPanel from './HrDocumentRequestsPanel';
import type { PaySlipWithLines } from '../../types';

export type EmployeeWorkspaceTab =
  | 'overview'
  | 'attendance'
  | 'work_journal'
  | 'payroll'
  | 'performance'
  | 'leave'
  | 'documents'
  | 'career'
  | 'training'
  | 'access'
  | 'timeline';

export type EmployeePayrollShellTab =
  | 'overview'
  | 'variables'
  | 'overtime'
  | 'adjustments'
  | 'approvals'
  | 'payslips'
  | 'history'
  | 'exports';

export type EmployeeWorkspaceShellProps = {
  /** Identifiant route = `Employee.profileId` (profil Supabase). */
  profileId: string;
  users: User[];
  /** Congés globaux (App) — filtrés par salarié ; rechargés au focus onglet si absent */
  leaveRequests?: LeaveRequest[];
  /** Navigation App (`handleSetView`) — liens vers modules (Objectifs, Formations, RH…). */
  onNavigateView?: (view: string) => void;
  onClose: () => void;
};

const MANAGER_DOC_ROLES: Set<string> = new Set([
  'super_administrator',
  'administrator',
  'manager',
  'hr_officer',
  'hr_business_partner',
]);

/** Objectifs visibles pour ce profil : `owner_id` = profil (ou auth user si données legacy), `entity` user, ou `team_members`. */
function objectiveAppliesToWorkspaceProfile(
  o: Objective,
  profileId: string,
  rosterUserAuthId: string | null | undefined,
): boolean {
  const pid = String(profileId);
  const auth = rosterUserAuthId != null ? String(rosterUserAuthId) : '';
  const owner = o.ownerId != null ? String(o.ownerId) : '';
  if (owner && (owner === pid || (!!auth && owner === auth))) return true;
  if (o.entityType === 'user' && o.entityId != null && String(o.entityId) === pid) return true;
  const team = Array.isArray(o.teamMembers) ? o.teamMembers : [];
  for (const m of team) {
    const mid =
      typeof m === 'string' || typeof m === 'number'
        ? String(m)
        : String((m as { id?: string }).id ?? (m as { profileId?: string }).profileId ?? '');
    if (mid && (mid === pid || (!!auth && mid === auth))) return true;
  }
  return false;
}

const EmployeeWorkspaceShell: React.FC<EmployeeWorkspaceShellProps> = ({
  profileId,
  users,
  leaveRequests: leaveRequestsProp,
  onNavigateView,
  onClose,
}) => {
  const { language } = useLocalization();
  const { user: authUser } = useAuth();
  const isFr = language === Language.FR;
  const [tab, setTab] = useState<EmployeeWorkspaceTab>('overview');
  const [payrollShellTab, setPayrollShellTab] = useState<EmployeePayrollShellTab>('overview');

  const [orgId, setOrgId] = useState<string | null>(null);
  const [organizationName, setOrganizationName] = useState<string>('');
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [policyDay, setPolicyDay] = useState(1);
  const [summaries, setSummaries] = useState<workJournalService.WorkDaySummary[]>([]);
  const [proofs, setProofs] = useState<workJournalService.WorkProof[]>([]);
  const [presenceEvents, setPresenceEvents] = useState<Awaited<ReturnType<typeof DataAdapter.listPresenceStatusEvents>>>([]);
  const [leaveRows, setLeaveRows] = useState<LeaveRequest[]>([]);
  const [slipsPeriod, setSlipsPeriod] = useState<PaySlipWithLines[]>([]);
  const [payrollPeriodLabel, setPayrollPeriodLabel] = useState('');
  const [payrollStart, setPayrollStart] = useState('');
  const [payrollEnd, setPayrollEnd] = useState('');
  const [tabBusy, setTabBusy] = useState(false);
  const [tabError, setTabError] = useState<string | null>(null);
  const [coreError, setCoreError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [payrollComputation, setPayrollComputation] = useState<payrollEngine.PayrollComputationForProfile | null>(null);
  const [payrollSimulate, setPayrollSimulate] = useState<Awaited<
    ReturnType<typeof payrollService.simulatePaySlipFromAttendance>
  > | null>(null);
  const [payrollHistorySlips, setPayrollHistorySlips] = useState<PaySlip[]>([]);
  const [payrollStubAck, setPayrollStubAck] = useState<string | null>(null);
  const [perfObjectives, setPerfObjectives] = useState<Objective[]>([]);
  const [trainingRows, setTrainingRows] = useState<
    { courseId: string; title: string; progress: number | null; enrolled: boolean }[]
  >([]);

  /** Évite les setState hors séquence quand l’utilisateur change d’onglet pendant un fetch (réduit erreurs DOM React). */
  const workspaceRefreshGenRef = useRef(0);

  const rosterUser = useMemo(
    () => users.find((u) => u.profileId != null && String(u.profileId) === String(profileId)),
    [users, profileId],
  );

  const authProfileId = authUser?.profileId != null ? String(authUser.profileId) : null;
  const isSelfWorkspace = authProfileId != null && authProfileId === String(profileId);
  const canManageDocRequests =
    !isSelfWorkspace && authUser?.role != null && MANAGER_DOC_ROLES.has(String(authUser.role));

  const displayName =
    rosterUser?.fullName || rosterUser?.name || rosterUser?.email || `${profileId.slice(0, 8)}…`;

  const presenceUserId = rosterUser?.id != null ? String(rosterUser.id) : null;

  const displayNameForProfile = useCallback(
    (pid: string | null | undefined) => {
      if (!pid) return '—';
      const u = users.find((x) => String(x.profileId || '') === String(pid));
      return u?.fullName || u?.name || u?.email || String(pid).slice(0, 8);
    },
    [users],
  );

  const loadCore = useCallback(async (): Promise<string | null> => {
    let oid: string | null = null;
    setCoreError(null);
    try {
      oid = await OrganizationService.getCurrentUserOrganizationId();
      setOrgId(oid);
      if (oid) {
        const org = await OrganizationService.getCurrentUserOrganization();
        setOrganizationName(org?.name || '');
      } else {
        setOrganizationName('');
      }
      const [emp, pol] = await Promise.all([
        DataAdapter.getEmployeeByProfileId(profileId),
        oid ? DataAdapter.getHrAttendancePolicy(oid) : Promise.resolve(null),
      ]);
      setEmployee(emp);
      setPolicyDay(pol?.payrollPeriodStartDay ?? 1);
    } catch (e: any) {
      setCoreError(e?.message || String(e));
      setOrgId(null);
      oid = null;
    } finally {
      setRefreshedAt(new Date().toISOString());
    }
    return oid;
  }, [profileId]);

  useEffect(() => {
    void loadCore();
  }, [loadCore]);

  const refreshWorkspaceData = useCallback(
    async (activeOrgId: string) => {
      const gen = ++workspaceRefreshGenRef.current;
      const isStale = () => gen !== workspaceRefreshGenRef.current;

      setTabBusy(true);
      setTabError(null);
      try {
        const bounds = hrAnalyticsService.getPayrollPeriodBounds(new Date(), policyDay);
        const ps = bounds.start.toISOString().slice(0, 10);
        const pe = bounds.end.toISOString().slice(0, 10);
        setPayrollStart(ps);
        setPayrollEnd(pe);
        setPayrollPeriodLabel(bounds.label);

        const from = new Date();
        from.setDate(from.getDate() - 30);
        const fromStr = from.toISOString().slice(0, 10);

        const lr = leaveRequestsProp ?? (await DataAdapter.getLeaveRequests());
        if (isStale()) return;
        setLeaveRows(lr.filter((x) => String(x.userId) === String(profileId)));

        if (tab === 'overview' || tab === 'work_journal' || tab === 'timeline') {
          const [s, p] = await Promise.all([
            workJournalService.listWorkDaySummaries({ organizationId: activeOrgId, profileId, from: fromStr }),
            workJournalService.listWorkProofs({ organizationId: activeOrgId, profileId }),
          ]);
          if (isStale()) return;
          setSummaries(s);
          setProofs(p);
        }

        if (tab === 'attendance' || tab === 'timeline') {
          if (presenceUserId) {
            const from14 = new Date();
            from14.setDate(from14.getDate() - 14);
            const ev = await DataAdapter.listPresenceStatusEvents({
              organizationId: activeOrgId,
              userId: presenceUserId,
              from: from14.toISOString(),
              to: new Date().toISOString(),
            });
            if (isStale()) return;
            setPresenceEvents(ev);
          } else {
            if (isStale()) return;
            setPresenceEvents([]);
          }
        }

        if (tab !== 'payroll') {
          if (isStale()) return;
          setPayrollComputation(null);
          setPayrollSimulate(null);
          setPayrollHistorySlips([]);
          setSlipsPeriod([]);
        } else {
          const [comp, sim, hist, swl] = await Promise.all([
            payrollService.computePayrollForProfilePeriod(profileId, ps, pe),
            payrollService.simulatePaySlipFromAttendance(profileId, ps, pe),
            payrollService.listPaySlipsForProfile(profileId, activeOrgId),
            payrollService.listPaySlipsWithLinesForPeriod(ps, pe, activeOrgId),
          ]);
          if (isStale()) return;
          setPayrollComputation(comp);
          setPayrollSimulate(sim);
          setPayrollHistorySlips(hist);
          setSlipsPeriod(swl.filter((s) => String(s.profileId) === String(profileId)));
        }

        if (tab === 'performance') {
          const objs = await DataAdapter.getObjectives();
          if (isStale()) return;
          setPerfObjectives(
            (objs || [])
              .filter((o) => objectiveAppliesToWorkspaceProfile(o, profileId, rosterUser?.id))
              .slice(0, 40),
          );
        } else {
          if (isStale()) return;
          setPerfObjectives([]);
        }

        if (tab === 'training' || tab === 'overview') {
          const uid = rosterUser?.id != null ? String(rosterUser.id) : '';
          const all = await DataAdapter.getCourses();
          if (isStale()) return;
          const pubs = (all || [])
            .filter((c) => String(c.status || '').toLowerCase() === 'published')
            .slice(0, 12);
          if (!uid) {
            if (isStale()) return;
            setTrainingRows(
              pubs.map((c) => ({
                courseId: String(c.id),
                title: c.title,
                progress: null,
                enrolled: false,
              })),
            );
          } else {
            const rows = await Promise.all(
              pubs.map(async (c) => {
                try {
                  const { data } = await DataService.getCourseEnrollment(String(c.id), uid);
                  const progress = data?.progress != null ? Math.round(Number(data.progress)) : null;
                  return {
                    courseId: String(c.id),
                    title: c.title,
                    progress,
                    enrolled: !!data,
                  };
                } catch {
                  return { courseId: String(c.id), title: c.title, progress: null, enrolled: false };
                }
              }),
            );
            if (isStale()) return;
            setTrainingRows(rows);
          }
        }
      } catch (e: any) {
        if (!isStale()) setTabError(e?.message || String(e));
      } finally {
        if (!isStale()) {
          setTabBusy(false);
          setRefreshedAt(new Date().toISOString());
        }
      }
    },
    [policyDay, profileId, tab, presenceUserId, leaveRequestsProp, rosterUser?.id],
  );

  const loadTabPayload = useCallback(() => {
    if (!orgId) return;
    void refreshWorkspaceData(orgId);
  }, [orgId, refreshWorkspaceData]);

  const handleRefresh = useCallback(async () => {
    setTabError(null);
    setCoreError(null);
    setPayrollStubAck(null);
    const oid = await loadCore();
    if (oid) await refreshWorkspaceData(oid);
  }, [loadCore, refreshWorkspaceData]);

  useEffect(() => {
    void loadTabPayload();
  }, [loadTabPayload]);

  useEffect(() => {
    const refetchIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void loadTabPayload();
    };
    const onFocus = () => {
      void loadTabPayload();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void loadTabPayload();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    const intervalId = window.setInterval(refetchIfVisible, 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(intervalId);
    };
  }, [loadTabPayload]);

  const pendingLeaveCount = useMemo(
    () => leaveRows.filter((l) => l.status === 'pending').length,
    [leaveRows],
  );

  const subtitleBits = useMemo(() => {
    const poste = employee?.position || rosterUser?.posteName;
    return [
      rosterUser?.role ? String(rosterUser.role).replace(/_/g, ' ') : isFr ? 'Rôle —' : 'Role —',
      poste ? `${isFr ? 'Poste' : 'Role title'} : ${poste}` : isFr ? 'Poste : —' : 'Title: —',
      employee?.tenureDate
        ? `${isFr ? 'Réf. ancienneté' : 'Tenure ref.'} : ${String(employee.tenureDate).slice(0, 10)}`
        : isFr
          ? 'Ancienneté : —'
          : 'Tenure: —',
    ];
  }, [employee, isFr, rosterUser?.role, rosterUser?.posteName]);

  const kpiItems = useMemo((): KPIStripItem[] => {
    const completed = summaries.filter((s) => s.journeyCompleted).length;
    const total = summaries.length || 1;
    const presenceRate = summaries.length ? Math.round((completed / total) * 100) : null;
    const projMin = summaries.reduce((a, s) => a + (s.minutesProjectWork || 0), 0);
    const enrolledCourses = trainingRows.filter((r) => r.enrolled).length;
    const pubSample = trainingRows.length;
    return [
      {
        id: 'presence',
        label: isFr ? 'Synthèse journal (30 j.)' : 'Journal summary (30d)',
        value: presenceRate != null ? `${presenceRate}` : '—',
        unit: isFr ? '% parcours' : '% journey',
      },
      {
        id: 'proj',
        label: isFr ? 'Min. projet (agrég.)' : 'Proj. min (agg.)',
        value: String(Math.round(projMin / 60)),
        unit: 'h',
      },
      {
        id: 'leave',
        label: isFr ? 'Congés en attente' : 'Leave pending',
        value: String(pendingLeaveCount),
        unit: isFr ? 'demandes' : 'req.',
      },
      {
        id: 'formation',
        label: isFr ? 'Formations (catalogue publié)' : 'Training (published sample)',
        value: pubSample ? `${enrolledCourses}/${pubSample}` : '—',
        unit: isFr ? 'inscrits / cours (aperçu)' : 'enrolled / courses (sample)',
      },
      {
        id: 'proofs',
        label: isFr ? 'Preuves (30 j.)' : 'Proofs (30d)',
        value: String(proofs.length),
        unit: '',
      },
    ];
  }, [isFr, pendingLeaveCount, proofs.length, summaries, trainingRows]);

  const breadcrumbItems = useMemo((): WorkspaceBreadcrumbItem[] => {
    return [
      {
        id: 'rh',
        label: isFr ? 'Ressources humaines' : 'Human resources',
        onClick: onClose,
      },
      { id: 'emp', label: displayName },
    ];
  }, [displayName, isFr, onClose]);

  /** Ordre aligné sur `docs/RH-MODULE-AUDIT-INVENTAIRE.md` §4 */
  const tabItems = useMemo(
    () =>
      [
        { id: 'overview' as const, label: isFr ? 'Vue d’ensemble' : 'Overview' },
        { id: 'attendance' as const, label: isFr ? 'Présence' : 'Attendance' },
        { id: 'work_journal' as const, label: isFr ? 'Journal d’activité' : 'Work journal' },
        { id: 'payroll' as const, label: isFr ? 'Paie' : 'Payroll' },
        { id: 'performance' as const, label: isFr ? 'Performance' : 'Performance' },
        { id: 'leave' as const, label: isFr ? 'Congés' : 'Leave' },
        { id: 'documents' as const, label: isFr ? 'Documents' : 'Documents' },
        { id: 'career' as const, label: isFr ? 'Parcours' : 'Career' },
        { id: 'training' as const, label: isFr ? 'Formation' : 'Training' },
        { id: 'access' as const, label: isFr ? 'Accès' : 'Access' },
        { id: 'timeline' as const, label: isFr ? 'Chronologie' : 'Timeline' },
      ] satisfies { id: EmployeeWorkspaceTab; label: string }[],
    [isFr],
  );

  const payrollPipelineTabs = useMemo(
    () =>
      [
        { id: 'overview' as const, label: isFr ? 'Vue pipeline' : 'Pipeline overview' },
        { id: 'variables' as const, label: isFr ? 'Variables' : 'Variables' },
        { id: 'overtime' as const, label: isFr ? 'Heures sup.' : 'Overtime' },
        { id: 'adjustments' as const, label: isFr ? 'Ajustements' : 'Adjustments' },
        { id: 'approvals' as const, label: isFr ? 'Validations' : 'Approvals' },
        { id: 'payslips' as const, label: isFr ? 'Bulletins' : 'Payslips' },
        { id: 'history' as const, label: isFr ? 'Historique' : 'History' },
        { id: 'exports' as const, label: isFr ? 'Exports' : 'Exports' },
      ] satisfies { id: EmployeePayrollShellTab; label: string }[],
    [isFr],
  );

  const initials = useMemo(() => {
    const n = displayName.trim();
    if (!n) return '?';
    const parts = n.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return n.slice(0, 2).toUpperCase();
  }, [displayName]);

  const sectionHint = (key: string) =>
    isFr
      ? `Données Supabase / services — actualisées à l’onglet ou au retour sur la fenêtre. (${key})`
      : `Supabase-backed — refreshed on tab or window focus. (${key})`;

  const handleDownloadSlip = async (slip: PaySlipWithLines) => {
    const org = await OrganizationService.getCurrentUserOrganization();
    await downloadPaySlipPdf({
      slip,
      employeeDisplayName: displayName,
      orgName: org?.name,
      orgLogoUrl: org?.logoUrl ?? null,
      fr: isFr,
    });
  };

  const exportPayrollHistoryCsv = useCallback(() => {
    const header = 'period_start,period_end,status,gross,net,currency\n';
    const body = payrollHistorySlips
      .map(
        (s) =>
          `${s.periodStart},${s.periodEnd},${s.status},${s.grossAmount},${s.netAmount},${s.currencyCode || 'XOF'}`,
      )
      .join('\n');
    const blob = new Blob([`${header}${body}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payroll-history-${String(profileId).slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [payrollHistorySlips, profileId]);

  const handlePayrollStubRpc = useCallback(async () => {
    if (!payrollStart || !payrollEnd) return;
    setPayrollStubAck(null);
    const res = await payrollService.rhPayrollClosePeriodStubAck(payrollStart, payrollEnd);
    if (!res.ok) {
      setPayrollStubAck(res.error || 'RPC error');
      return;
    }
    setPayrollStubAck(JSON.stringify(res.payload ?? {}, null, 2));
  }, [payrollEnd, payrollStart]);

  const renderPayrollShellBody = () => {
    const curSlips = payrollHistorySlips.filter((s) => s.periodStart === payrollStart && s.periodEnd === payrollEnd);
    const variableCodes = new Set(['PAID_HOURS', 'TAXABLE_BASE', 'GROSS_ATTENDANCE']);
    const variableLines =
      payrollComputation?.lines.filter((l) => variableCodes.has(String(l.rubriqueCode))) ?? [];
    const adjustmentLines =
      payrollComputation?.lines.filter((l) => l.side === 'deduction' && String(l.rubriqueCode) !== 'NET_PAYABLE') ?? [];

    if (tabBusy && tab === 'payroll') {
      return (
        <div className="flex items-center gap-2 py-8 text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          {isFr ? 'Chargement paie…' : 'Loading payroll…'}
        </div>
      );
    }

    switch (payrollShellTab) {
      case 'overview':
        return (
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 sm:col-span-2">
              <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Période' : 'Period'}</p>
              <p className="mt-0.5 font-medium text-slate-900">{payrollPeriodLabel || `${payrollStart} → ${payrollEnd}`}</p>
            </div>
            {payrollComputation ? (
              <>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Brut (moteur)' : 'Gross (engine)'}</p>
                  <p className="mt-0.5 text-lg font-semibold text-slate-900">{payrollComputation.grossAmount.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Net (moteur)' : 'Net (engine)'}</p>
                  <p className="mt-0.5 text-lg font-semibold text-emerald-800">{payrollComputation.netAmount.toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 sm:col-span-2">
                  <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Heures payantes' : 'Paid hours'}</p>
                  <p className="mt-0.5 text-slate-800">{payrollComputation.paidHours} h</p>
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-amber-100 bg-amber-50/80 px-3 py-3 text-sm text-amber-900 sm:col-span-2">
                {isFr
                  ? 'Pas de calcul moteur pour ce profil sur la période (fiche `employees` ou données présence insuffisantes). Les totaux simulation présence peuvent rester disponibles ci-dessous.'
                  : 'No engine payroll row for this profile (missing `employees` row or insufficient attendance data). Presence simulation may still apply below.'}
              </div>
            )}
            {payrollSimulate ? (
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 sm:col-span-2">
                <p className="text-xs font-semibold uppercase text-slate-500">{isFr ? 'Simulation présence' : 'Attendance simulation'}</p>
                <p className="mt-1 text-sm text-slate-700">
                  {isFr ? 'Net indicatif' : 'Indicative net'} : {payrollSimulate.netAmount.toLocaleString()} ·{' '}
                  {isFr ? 'Heures payables' : 'Payable hours'} : {payrollSimulate.payableHours.toFixed(2)} h
                </p>
              </div>
            ) : null}
          </div>
        );
      case 'variables':
        return variableLines.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {variableLines.map((l) => (
              <li key={`${l.rubriqueCode}-${l.orderIndex}`} className="flex justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-slate-700">{l.label}</span>
                <span className="font-mono text-slate-900">{l.amount}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            {isFr ? 'Aucune rubrique « variables » pour cette période.' : 'No variable rubrics for this period.'}
          </p>
        );
      case 'overtime':
        return payrollSimulate ? (
          <div className="space-y-3">
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Minutes retard' : 'Delay minutes'}</p>
                <p className="mt-0.5 font-medium text-slate-900">{payrollSimulate.delayMinutes}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Abs. non autorisées (min)' : 'Unauthorized absence (min)'}</p>
                <p className="mt-0.5 font-medium text-slate-900">{payrollSimulate.unauthorizedAbsenceMinutes}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Déconnexions' : 'Disconnects'}</p>
                <p className="mt-0.5 font-medium text-slate-900">{payrollSimulate.disconnectCount}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                <p className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Taux horaire' : 'Hourly rate'}</p>
                <p className="mt-0.5 font-medium text-slate-900">{payrollSimulate.hourlyRate}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {isFr
                ? 'Les heures supplémentaires détaillées sont consolidées côté matrice paie RH ; ici : indicateurs issus de la conformité présence.'
                : 'Overtime detail is consolidated in the HR payroll matrix; this view shows attendance compliance indicators.'}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">{isFr ? 'Simulation indisponible.' : 'Simulation unavailable.'}</p>
        );
      case 'adjustments':
        return adjustmentLines.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {adjustmentLines.map((l) => (
              <li key={`${l.rubriqueCode}-${l.orderIndex}`} className="flex justify-between gap-2 px-3 py-2 text-sm">
                <span className="text-slate-700">{l.label}</span>
                <span className="font-mono text-red-800">−{l.amount}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">{isFr ? 'Aucun ajustement calculé.' : 'No computed adjustments.'}</p>
        );
      case 'approvals':
        return curSlips.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-100">
            {curSlips.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="font-medium text-slate-900">
                  {s.periodStart} → {s.periodEnd}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    s.status === 'paid'
                      ? 'bg-emerald-100 text-emerald-900'
                      : s.status === 'validated'
                        ? 'bg-sky-100 text-sky-900'
                        : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {s.status}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            {isFr ? 'Aucun bulletin pour cette période (brouillon à générer depuis la matrice paie).' : 'No slip for this period (generate draft from payroll matrix).'}
          </p>
        );
      case 'payslips':
        return (
          <div className="space-y-3">
            <p className="font-medium text-slate-800">{isFr ? 'Bulletins (lignes détaillées)' : 'Pay slips (line detail)'}</p>
            {slipsPeriod.length === 0 ? (
              <p className="text-slate-500">{isFr ? 'Aucun bulletin pour cette période.' : 'No pay slips for this period.'}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {slipsPeriod.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div>
                      <span className="font-medium text-slate-900">
                        {s.periodStart} → {s.periodEnd}
                      </span>
                      <span className="ml-2 text-xs text-slate-500">
                        {isFr ? 'Brut' : 'Gross'} {s.grossAmount.toLocaleString()} · {isFr ? 'Net' : 'Net'} {s.netAmount.toLocaleString()}{' '}
                        {s.currencyCode || 'XOF'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDownloadSlip(s)}
                      className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100"
                    >
                      {isFr ? 'Télécharger PDF' : 'Download PDF'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      case 'history':
        return payrollHistorySlips.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">{isFr ? 'Début' : 'Start'}</th>
                  <th className="px-3 py-2">{isFr ? 'Fin' : 'End'}</th>
                  <th className="px-3 py-2">{isFr ? 'Statut' : 'Status'}</th>
                  <th className="px-3 py-2">{isFr ? 'Brut' : 'Gross'}</th>
                  <th className="px-3 py-2">{isFr ? 'Net' : 'Net'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {payrollHistorySlips.slice(0, 40).map((s) => (
                  <tr key={s.id}>
                    <td className="px-3 py-2">{s.periodStart}</td>
                    <td className="px-3 py-2">{s.periodEnd}</td>
                    <td className="px-3 py-2">{s.status}</td>
                    <td className="px-3 py-2">{s.grossAmount.toLocaleString()}</td>
                    <td className="px-3 py-2">{s.netAmount.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">{isFr ? 'Aucun historique de bulletins.' : 'No pay slip history.'}</p>
        );
      case 'exports':
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              {isFr
                ? 'Export CSV basé sur l’historique chargé ; le RPC serveur confirme le point d’extension de clôture (même logique que la matrice paie).'
                : 'CSV export from loaded history; server RPC acknowledges the month-end extension point (same as payroll matrix).'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={exportPayrollHistoryCsv}
                disabled={payrollHistorySlips.length === 0}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
              >
                {isFr ? 'Télécharger CSV (historique)' : 'Download CSV (history)'}
              </button>
              <button
                type="button"
                onClick={() => void handlePayrollStubRpc()}
                className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
              >
                {isFr ? 'Accusé RPC clôture (stub)' : 'RPC close stub ack'}
              </button>
            </div>
            {payrollStubAck ? (
              <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">{payrollStubAck}</pre>
            ) : null}
          </div>
        );
      default:
        return null;
    }
  };

  const renderMainTab = () => {
    const blockUi =
      tabBusy &&
      tab !== 'work_journal' &&
      tab !== 'documents' &&
      tab !== 'payroll';
    if (blockUi) {
      return (
        <div className="flex items-center gap-2 py-12 text-slate-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
          {isFr ? 'Chargement…' : 'Loading…'}
        </div>
      );
    }

    switch (tab) {
      case 'overview':
        return (
          <div className="space-y-4">
            <WorkspaceSection
              title={isFr ? '1. Synthèse' : '1. Summary'}
              description={sectionHint('overview')}
            >
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Organisation' : 'Organization'}</dt>
                  <dd className="font-medium text-slate-900">{organizationName || '—'}</dd>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Congés (ce salarié)' : 'Leave (this employee)'}</dt>
                  <dd className="font-medium text-slate-900">
                    {leaveRows.length} {isFr ? 'demandes' : 'requests'} · {pendingLeaveCount}{' '}
                    {isFr ? 'en attente' : 'pending'}
                  </dd>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Journal (30 j.)' : 'Journal (30d)'}</dt>
                  <dd className="text-slate-800">
                    {summaries.length} {isFr ? 'jours synthétisés' : 'summary days'} · {proofs.length}{' '}
                    {isFr ? 'preuves récentes' : 'recent proofs'}
                  </dd>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Formations (LMS)' : 'Training (LMS)'}</dt>
                  <dd className="flex flex-col gap-2 text-slate-800 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      {trainingRows.length === 0
                        ? isFr
                          ? 'Chargement ou aucun cours publié dans l’aperçu.'
                          : 'Loading or no published courses in sample.'
                        : isFr
                          ? `${trainingRows.filter((r) => r.enrolled).length} inscription(s) sur ${trainingRows.length} cours publiés (aperçu).`
                          : `${trainingRows.filter((r) => r.enrolled).length} enrollment(s) on ${trainingRows.length} published courses (sample).`}
                    </span>
                    {onNavigateView ? (
                      <button
                        type="button"
                        onClick={() => onNavigateView('formation')}
                        className="shrink-0 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                      >
                        {isFr ? 'Ouvrir le module Formations' : 'Open Training module'}
                      </button>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </WorkspaceSection>
          </div>
        );
      case 'attendance':
        return (
          <WorkspaceSection
            title={isFr ? '2. Présence & segments' : '2. Attendance'}
            description={
              presenceUserId
                ? isFr
                  ? 'Événements de statut sur 14 jours (presence_status_events).'
                  : 'Status events over 14 days (presence_status_events).'
                : isFr
                  ? 'Aucun compte utilisateur lié à ce profil : événements de présence indisponibles.'
                  : 'No user account linked to this profile: presence events unavailable.'
            }
          >
            {presenceEvents.length === 0 ? (
              <TimelineEmptyState
                title={isFr ? 'Aucun événement récent' : 'No recent events'}
                description={isFr ? 'Les pointages apparaîtront ici.' : 'Clock events will appear here.'}
              />
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto">
                {presenceEvents.slice(0, 40).map((ev) => (
                  <li
                    key={ev.id}
                    className="flex gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
                  >
                    <span className="shrink-0 font-mono text-xs text-slate-400">
                      {ev.startedAt?.slice(11, 16) ?? '—'}
                    </span>
                    <span>
                      {ev.status} {ev.durationMinutes != null ? `· ${ev.durationMinutes} min` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </WorkspaceSection>
        );
      case 'work_journal':
        return (
          <WorkspaceSection
            title={isFr ? '3. Journal du jour & preuves' : '3. Daily journal & proofs'}
            description={
              isFr
                ? 'Tables `coya_work_day_summaries`, `coya_work_proofs` — même logique que l’onglet RH.'
                : 'Tables `coya_work_day_summaries`, `coya_work_proofs` — same logic as HR tab.'
            }
          >
            <WorkJournalTab profileId={profileId} />
          </WorkspaceSection>
        );
      case 'payroll':
        return (
          <div className="space-y-4">
            <WorkspaceSection
              title={isFr ? '4. Paie (projection période)' : '4. Payroll (period projection)'}
              description={
                isFr
                  ? `Période : ${payrollPeriodLabel || `${payrollStart} → ${payrollEnd}`}. Données : moteur paie (présence), bulletins Supabase, RPC stub d’extension.`
                  : `Period: ${payrollPeriodLabel || `${payrollStart} → ${payrollEnd}`}. Data: attendance payroll engine, Supabase slips, stub RPC.`
              }
            >
              <PillTabs<EmployeePayrollShellTab>
                className="max-w-full"
                items={payrollPipelineTabs}
                value={payrollShellTab}
                onChange={setPayrollShellTab}
              />
              <div className="mt-4 rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600 shadow-sm">
                {renderPayrollShellBody()}
              </div>
            </WorkspaceSection>
          </div>
        );
      case 'performance':
        return (
          <WorkspaceSection
            title={isFr ? '5. Performance & objectifs' : '5. Performance & goals'}
            description={
              isFr
                ? 'Objectifs vous concernant : propriétaire (`owner_id` = ce profil ou compte si ancienne donnée), cible utilisateur SMART (`entity_type` = user), ou membre d’équipe. Entretiens structurés : module Trinité.'
                : 'Goals that apply to you: owner (`owner_id` = this profile or legacy auth id), SMART user target (`entity_type` = user), or team member. Formal reviews: Trinité module.'
            }
          >
            {perfObjectives.length === 0 ? (
              <div className="space-y-3">
                <TimelineEmptyState
                  title={isFr ? 'Aucun objectif listé' : 'No objectives listed'}
                  description={
                    isFr
                      ? 'Créez des objectifs dans le module Objectifs & OKR ou vérifiez le champ propriétaire.'
                      : 'Create objectives in Goals & OKRs or check the owner field.'
                  }
                />
                {onNavigateView ? (
                  <button
                    type="button"
                    onClick={() => onNavigateView('goals_okrs')}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100"
                  >
                    {isFr ? 'Ouvrir Objectifs & OKR' : 'Open Goals & OKRs'}
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="max-h-[480px] space-y-2 overflow-y-auto">
                {perfObjectives.map((o) => (
                  <li
                    key={o.id}
                    className="rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm"
                  >
                    <p className="font-medium text-slate-900">{o.title}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {o.status ?? '—'} · {o.progress != null ? `${Math.round(o.progress)}%` : '—'}{' '}
                      {o.keyResults?.length
                        ? isFr
                          ? `· ${o.keyResults.length} résultat(s) clé`
                          : `· ${o.keyResults.length} key result(s)`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </WorkspaceSection>
        );
      case 'leave':
        return (
          <WorkspaceSection
            title={isFr ? '6. Congés & absences' : '6. Leave'}
            description={sectionHint('leave_requests')}
          >
            {leaveRows.length === 0 ? (
              <p className="text-sm text-slate-500">{isFr ? 'Aucune demande.' : 'No requests.'}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-100">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">{isFr ? 'Début' : 'Start'}</th>
                      <th className="px-3 py-2">{isFr ? 'Fin' : 'End'}</th>
                      <th className="px-3 py-2">{isFr ? 'Statut' : 'Status'}</th>
                      <th className="px-3 py-2">{isFr ? 'Type' : 'Type'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leaveRows.map((r) => (
                      <tr key={r.id}>
                        <td className="px-3 py-2">{r.startDate}</td>
                        <td className="px-3 py-2">{r.endDate}</td>
                        <td className="px-3 py-2">{r.status}</td>
                        <td className="px-3 py-2">{r.leaveTypeName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </WorkspaceSection>
        );
      case 'documents':
        return orgId ? (
          <WorkspaceSection
            title={isFr ? '7. Documents administratifs' : '7. Administrative documents'}
            description={
              isFr
                ? 'Demandes stockées dans `hr_document_requests` (RLS : salarié / managers).'
                : 'Requests in `hr_document_requests` (RLS: employee / managers).'
            }
          >
            <HrDocumentRequestsPanel
              organizationId={orgId}
              profileId={profileId}
              fr={isFr}
              allowEmployeeCreate={isSelfWorkspace}
              allowManagerUpdate={canManageDocRequests}
            />
          </WorkspaceSection>
        ) : (
          <WorkspaceSection title={isFr ? '7. Documents' : '7. Documents'}>
            <p className="text-sm text-slate-500">{isFr ? 'Organisation non chargée.' : 'Organization not loaded.'}</p>
          </WorkspaceSection>
        );
      case 'career':
        return (
          <WorkspaceSection
            title={isFr ? '8. Parcours & contrat' : '8. Career & contract'}
            description={
              isFr
                ? 'Données issues de la fiche `employees` et du roster (`users`). Sans fiche RH, complétez l’association depuis le module Employés.'
                : 'From `employees` and roster (`users`). Without an HR record, complete the link from the Employees tab.'
            }
          >
            {!employee ? (
              <div className="space-y-3">
                <TimelineEmptyState
                  title={isFr ? 'Pas de fiche salarié RH' : 'No HR employee record'}
                  description={
                    isFr
                      ? 'Les champs contrat / hiérarchie détaillés sont sur la fiche `employees`.'
                      : 'Contract / hierarchy fields live on the `employees` row.'
                  }
                />
                {onNavigateView ? (
                  <button
                    type="button"
                    onClick={() => onNavigateView('rh')}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    {isFr ? 'Aller au module RH (Employés)' : 'Open HR module (Employees)'}
                  </button>
                ) : null}
              </div>
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Intitulé / poste' : 'Title / position'}</dt>
                  <dd className="font-medium text-slate-900">{employee.position || rosterUser?.posteName || '—'}</dd>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Mode de travail' : 'Work mode'}</dt>
                  <dd className="text-slate-800">{employee.workMode || '—'}</dd>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Ancienneté (réf.)' : 'Tenure (ref.)'}</dt>
                  <dd className="text-slate-800">{employee.tenureDate ? String(employee.tenureDate).slice(0, 10) : '—'}</dd>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Manager' : 'Manager'}</dt>
                  <dd className="text-slate-800">{displayNameForProfile(employee.managerId)}</dd>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                  <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Mentor / référent' : 'Mentor'}</dt>
                  <dd className="text-slate-800">{displayNameForProfile(employee.mentorId)}</dd>
                </div>
              </dl>
            )}
          </WorkspaceSection>
        );
      case 'training':
        return (
          <WorkspaceSection
            title={isFr ? '9. Formation (catalogue & inscriptions)' : '9. Training (catalog & enrollments)'}
            description={
              isFr
                ? 'Cours publiés visibles + progression `course_enrollments` pour votre compte (`user_id`). RLS : seules les lignes autorisées sont retournées.'
                : 'Published courses plus `course_enrollments` progress for your account (`user_id`). RLS applies.'
            }
          >
            {trainingRows.length === 0 ? (
              <div className="space-y-3">
                <TimelineEmptyState
                  title={isFr ? 'Aucun cours publié chargé' : 'No published courses loaded'}
                  description={isFr ? 'Vérifiez le module Formations ou les droits d’accès.' : 'Check the Courses module or access rights.'}
                />
                {onNavigateView ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onNavigateView('formation')}
                      className="rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-[0_8px_30px_rgba(15,23,42,0.06)] hover:bg-slate-50"
                    >
                      {isFr ? 'Ouvrir les formations' : 'Open courses'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onNavigateView('trinite')}
                      className="rounded-2xl border border-slate-200/80 bg-white px-3 py-2 text-xs font-semibold text-slate-800 shadow-[0_8px_30px_rgba(15,23,42,0.06)] hover:bg-slate-50"
                    >
                      {isFr ? 'Trinité' : 'Trinité'}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <ul className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                {trainingRows.map((row) => (
                  <li key={row.courseId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-900">{row.title}</span>
                    <span className="text-xs text-slate-600">
                      {row.enrolled
                        ? isFr
                          ? `Inscrit · ${row.progress ?? 0} %`
                          : `Enrolled · ${row.progress ?? 0}%`
                        : isFr
                          ? 'Non inscrit'
                          : 'Not enrolled'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {onNavigateView ? (
              <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <button
                  type="button"
                  onClick={() => onNavigateView('formation')}
                  className="font-semibold text-emerald-800 underline-offset-2 hover:underline"
                >
                  {isFr ? 'Catalogue complet' : 'Full catalog'}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateView('trinite')}
                  className="font-semibold text-emerald-800 underline-offset-2 hover:underline"
                >
                  {isFr ? 'Trinité (entretiens & scores)' : 'Trinité (reviews & scores)'}
                </button>
              </p>
            ) : null}
          </WorkspaceSection>
        );
      case 'access':
        return (
          <WorkspaceSection
            title={isFr ? '10. Accès & compte' : '10. Access & account'}
            description={
              isFr
                ? 'Résumé du compte plateforme (rôle, e-mail). Les habilitations fines par module sont gérées par l’administrateur (RLS + rôles).'
                : 'Platform account summary (role, email). Fine module permissions are admin-managed (RLS + roles).'
            }
          >
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2 sm:col-span-2">
                <dt className="text-xs font-medium uppercase text-slate-500">E-mail</dt>
                <dd className="font-medium text-slate-900">{rosterUser?.email || '—'}</dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Rôle' : 'Role'}</dt>
                <dd className="text-slate-800">{rosterUser?.role ? String(rosterUser.role).replace(/_/g, ' ') : '—'}</dd>
              </div>
              <div className="rounded-lg border border-slate-100 bg-white px-3 py-2">
                <dt className="text-xs font-medium uppercase text-slate-500">{isFr ? 'Statut profil' : 'Profile status'}</dt>
                <dd className="text-slate-800">{rosterUser?.status || '—'}</dd>
              </div>
            </dl>
            {onNavigateView ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onNavigateView('settings')}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  {isFr ? 'Paramètres' : 'Settings'}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateView('goals_okrs')}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  {isFr ? 'Objectifs & OKR' : 'Goals & OKRs'}
                </button>
                <button
                  type="button"
                  onClick={() => onNavigateView('formation')}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                >
                  {isFr ? 'Formations' : 'Courses'}
                </button>
                {canManageDocRequests ? (
                  <button
                    type="button"
                    onClick={() => onNavigateView('user_management')}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                  >
                    {isFr ? 'Utilisateurs (admin)' : 'Users (admin)'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </WorkspaceSection>
        );
      case 'timeline':
        return (
          <WorkspaceSection
            title={isFr ? '11. Chronologie' : '11. Timeline'}
            description={isFr ? 'Présence (14 j.) et preuves récentes.' : 'Presence (14d) and recent proofs.'}
          >
            <ul className="max-h-[480px] space-y-2 overflow-y-auto">
              {[
                ...presenceEvents.slice(0, 12).map((ev) => ({
                  key: `p-${ev.id}`,
                  sortTs: ev.startedAt || '',
                  t: ev.startedAt?.slice(11, 16) ?? '—',
                  day: ev.startedAt?.slice(0, 10) ?? '',
                  msg: `${isFr ? 'Présence' : 'Presence'}: ${ev.status}`,
                })),
                ...proofs.slice(0, 8).map((pr) => ({
                  key: `w-${pr.id}`,
                  sortTs: pr.createdAt || `${pr.workDate}T00:00:00`,
                  t: pr.createdAt?.slice(11, 16) ?? '—',
                  day: pr.workDate || '',
                  msg: `${isFr ? 'Preuve' : 'Proof'} (${pr.workDate})`,
                })),
              ]
                .sort((a, b) => String(b.sortTs).localeCompare(String(a.sortTs)))
                .map((row) => (
                  <li
                    key={row.key}
                    className="flex gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm"
                  >
                    <span className="shrink-0 font-mono text-xs text-slate-400">
                      {row.day ? `${row.day} ` : ''}
                      {row.t}
                    </span>
                    <span>{row.msg}</span>
                  </li>
                ))}
              {presenceEvents.length === 0 && proofs.length === 0 && (
                <TimelineEmptyState
                  title={isFr ? 'Flux vide' : 'Empty stream'}
                  description={isFr ? 'Aucune donnée sur la fenêtre chargée.' : 'No data in the loaded window.'}
                />
              )}
            </ul>
          </WorkspaceSection>
        );
      default:
        return null;
    }
  };

  return (
    <WorkspaceRouteShell
      langProtect
      className="bg-slate-50"
      top={
        <WorkspaceTopBar
          leading={<WorkspaceBackButton onClick={onClose} label={isFr ? 'RH' : 'HR'} />}
          breadcrumbs={<WorkspaceBreadcrumbs items={breadcrumbItems} />}
        />
      }
    >
      <ObjectWorkspaceFloorplan
        useWorkspaceShell={false}
        className="flex min-h-0 flex-1 flex-col border-b border-slate-200 bg-white px-4 pb-4 pt-3 lg:px-6"
        hero={
          <div className="rounded-2xl border border-slate-100 bg-white px-4 py-4 shadow-sm lg:px-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="flex min-w-0 flex-1 gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-600 text-lg font-semibold text-white">
                  {initials}
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">{displayName}</h1>
                  <p className="mt-1 text-sm text-slate-500">{subtitleBits.join(' · ')}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                      {isFr ? 'Fiche workspace salarié' : 'Employee workspace'}
                    </span>
                    {employee?.workMode && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {isFr ? 'Mode' : 'Mode'} : {employee.workMode}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <span className="inline-flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600">
                  ID profil : <span className="ml-1 font-mono text-slate-800">{profileId.slice(0, 8)}…</span>
                </span>
              </div>
            </div>
          </div>
        }
        kpi={<KPIStrip items={kpiItems} max={6} />}
        tabs={
          <div className="space-y-2">
            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs text-slate-600">
                <span className="font-semibold text-slate-700">{isFr ? 'Synchro' : 'Sync'}</span>{' '}
                {tabBusy ? (
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                    {isFr ? 'mise à jour…' : 'updating…'}
                  </span>
                ) : refreshedAt ? (
                  <span>
                    {isFr ? 'Dernière synchro' : 'Last sync'}{' '}
                    <span className="tabular-nums" title={refreshedAt}>
                      {new Date(refreshedAt).toLocaleString(isFr ? 'fr-FR' : 'en-GB')}
                    </span>
                  </span>
                ) : isFr ? (
                  'en attente'
                ) : (
                  'pending'
                )}
                {pendingLeaveCount > 0
                  ? ` · ${pendingLeaveCount} ${isFr ? 'congé(s) en attente' : 'leave(s) pending'}`
                  : ''}
              </div>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={tabBusy}
                className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isFr ? 'Actualiser' : 'Refresh'}
              </button>
            </div>
            {(coreError || tabError) && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
              >
                {coreError || tabError}
              </div>
            )}
            <PillTabs<EmployeeWorkspaceTab> className="max-w-full" items={tabItems} value={tab} onChange={setTab} />
          </div>
        }
      >
        <div
          key={`emp-body-${tab}-${payrollShellTab}`}
          className="mt-2 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]"
        >
          <div className="min-h-0 min-w-0 space-y-4">{renderMainTab()}</div>
          <aside className="hidden min-h-0 flex-col gap-3 lg:flex">
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {isFr ? 'Inspecteur' : 'Inspector'}
              </p>
              <p className="mt-1 text-sm font-semibold text-slate-900">{isFr ? 'Contexte' : 'Context'}</p>
              <dl className="mt-3 space-y-2 text-xs text-slate-600">
                <div className="flex justify-between gap-2">
                  <dt>{isFr ? 'Profil' : 'Profile'}</dt>
                  <dd className="font-mono text-slate-800">{profileId.slice(0, 10)}…</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>{isFr ? 'Onglet' : 'Tab'}</dt>
                  <dd className="text-slate-800">{tab}</dd>
                </div>
              </dl>
            </div>
            <div className="flex min-h-0 flex-1 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-xs font-semibold text-slate-700">{isFr ? 'Aperçu congés' : 'Leave preview'}</p>
              <div className="mt-2 min-h-0 flex-1 overflow-y-auto text-xs text-slate-600">
                {leaveRows.slice(0, 6).map((r) => (
                  <div key={r.id} className="mb-2 rounded border border-slate-100 px-2 py-1">
                    {r.startDate} → {r.endDate} ({r.status})
                  </div>
                ))}
                {leaveRows.length === 0 && (
                  <TimelineEmptyState
                    title={isFr ? 'Aucun congé' : 'No leave'}
                    description={isFr ? 'Les demandes apparaissent ici.' : 'Requests appear here.'}
                  />
                )}
              </div>
            </div>
          </aside>
        </div>
      </ObjectWorkspaceFloorplan>
    </WorkspaceRouteShell>
  );
};

export default EmployeeWorkspaceShell;
