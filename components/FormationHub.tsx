import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useModulePermissions } from '../hooks/useModulePermissions';
import {
  NAV_SESSION_CRM_OPEN_COLLECTE_TAB,
  NAV_SESSION_COLLECTE_PRESET_FORMATION_ID,
  NAV_SESSION_FORMATION_SECTION,
} from '../contexts/AppNavigationContext';
import type {
  Course,
  CourseSession,
  CourseSessionEnrollment,
  CohortParticipantRole,
  Programme,
  ProgrammeAction,
  Project,
  User,
} from '../types';
import Courses from './Courses';
import CourseManagement from './CourseManagement';
import DataAdapter from '../services/dataAdapter';
import OrganizationService from '../services/organizationService';
import * as programmeService from '../services/programmeService';
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Film,
  Globe,
  GraduationCap,
  ImageIcon,
  Layers,
  LineChart,
  Play,
  Plus,
  School,
  Users,
} from 'lucide-react';
import { Button } from './ui/Button';
import {
  isFormationHubSection,
  parseFormationSectionFromHash,
  pushFormationSectionToUrl,
  type FormationHubSection,
} from '../utils/formationNav';

const COHORT_ROLE_LABELS_FR: Record<CohortParticipantRole, string> = {
  learner: 'Apprenant',
  coach: 'Coach',
  mentor: 'Mentor',
  trainer: 'Formateur',
  facilitator: 'Facilitateur',
};

function resolveInitialFormationSection(): FormationHubSection {
  if (typeof window !== 'undefined') {
    const fromHash = parseFormationSectionFromHash();
    if (fromHash) {
      try {
        sessionStorage.removeItem(NAV_SESSION_FORMATION_SECTION);
      } catch {
        /* ignore */
      }
      return fromHash;
    }
    try {
      const preset = sessionStorage.getItem(NAV_SESSION_FORMATION_SECTION);
      if (preset && isFormationHubSection(preset)) {
        sessionStorage.removeItem(NAV_SESSION_FORMATION_SECTION);
        return preset;
      }
    } catch {
      /* ignore */
    }
  }
  return 'overview';
}

/** Placeholder visuel uniquement (pas de données LMS de progression par cohorte). */
function placeholderProgressPct(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return 42 + (h % 48);
}

function CircularProgressRing({ pct, size = 52 }: { pct: number; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  const offset = c - (clamped / 100) * c;
  const cx = size / 2;
  return (
    <div className="flex flex-col items-center gap-0.5 shrink-0">
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          className="stroke-slate-100"
          strokeWidth={stroke}
        />
        <circle
          cx={cx}
          cy={cx}
          r={r}
          fill="none"
          className="stroke-blue-600 transition-all"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="text-[10px] font-semibold text-slate-600">{Math.round(clamped)}%</span>
      <span className="text-[9px] text-slate-400 text-center leading-tight">Indice visuel (non mesuré)</span>
    </div>
  );
}

function SuccessSparklineStub() {
  return (
    <svg width="56" height="28" className="text-emerald-500" aria-hidden>
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points="4,22 12,18 20,20 28,12 36,14 44,8 52,10"
      />
    </svg>
  );
}

export interface FormationHubProps {
  courses: Course[];
  users: User[];
  onSelectCourse: (id: string) => void;
  onAddCourse: (courseData: Omit<Course, 'id' | 'progress'>) => void;
  onUpdateCourse: (course: Course) => void;
  onDeleteCourse: (courseId: string) => void;
  isLoading?: boolean;
  loadingOperation?: string | null;
  setView: (view: string) => void;
}

type DashboardSessionRow = CourseSession & {
  courseTitle: string;
  thumbnailUrl?: string;
  learnerCount: number;
  progressPct: number;
};

const FormationHub: React.FC<FormationHubProps> = ({
  courses,
  users,
  onSelectCourse,
  onAddCourse,
  onUpdateCourse,
  onDeleteCourse,
  isLoading,
  loadingOperation,
  setView,
}) => {
  const { canAccessModule, hasPermission } = useModulePermissions();
  const canStudio = canAccessModule('course_management') && hasPermission('course_management', 'read');

  const [section, setSectionState] = useState<FormationHubSection>(resolveInitialFormationSection);

  const setSection = useCallback((next: FormationHubSection) => {
    setSectionState(next);
  }, []);

  useEffect(() => {
    const syncFromUrl = () => {
      const parsed = parseFormationSectionFromHash();
      if (parsed) setSectionState(parsed);
    };
    window.addEventListener('hashchange', syncFromUrl);
    window.addEventListener('coya-formation-section', syncFromUrl as EventListener);
    return () => {
      window.removeEventListener('hashchange', syncFromUrl);
      window.removeEventListener('coya-formation-section', syncFromUrl as EventListener);
    };
  }, []);

  useEffect(() => {
    pushFormationSectionToUrl(section);
  }, [section]);

  const [sessionCourseId, setSessionCourseId] = useState<string>(() => courses[0]?.id ?? '');
  const [sessions, setSessions] = useState<CourseSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionEnrollments, setSessionEnrollments] = useState<CourseSessionEnrollment[]>([]);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionProgrammeId, setNewSessionProgrammeId] = useState('');
  const [newSessionProjectId, setNewSessionProjectId] = useState('');
  const [programmes, setProgrammes] = useState<Programme[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [filterProgrammeId, setFilterProgrammeId] = useState('');
  const [filterProjectId, setFilterProjectId] = useState('');
  const [orgId, setOrgId] = useState<string | null>(null);
  const [newSessionProgrammeActionId, setNewSessionProgrammeActionId] = useState('');
  const [programmeActionsPicklist, setProgrammeActionsPicklist] = useState<ProgrammeAction[]>([]);
  const [actionTitleById, setActionTitleById] = useState<Record<string, string>>({});
  const [cohortEnrollmentTotal, setCohortEnrollmentTotal] = useState<number | null>(null);

  const [dashboardSessions, setDashboardSessions] = useState<DashboardSessionRow[]>([]);
  const [dashboardSessionsLoading, setDashboardSessionsLoading] = useState(false);
  /** Total sessions ouvertes/planifiées (tous cours), pas seulement les 4–8 lignes affichées. */
  const [overviewOpenSessionsTotal, setOverviewOpenSessionsTotal] = useState(0);
  /** Projets distincts sur l’ensemble des sessions ouvertes/planifiées (même requête que le total). */
  const [overviewDistinctProjectTotal, setOverviewDistinctProjectTotal] = useState(0);

  useEffect(() => {
    OrganizationService.getCurrentUserOrganizationId()
      .then(setOrgId)
      .catch(() => setOrgId(null));
  }, []);

  useEffect(() => {
    if (!orgId) {
      setProgrammes([]);
      setProjects([]);
      return;
    }
    let cancelled = false;
    void programmeService.listProgrammes(orgId).then((list) => {
      if (!cancelled) setProgrammes(list);
    });
    void DataAdapter.getProjects().then((list) => {
      if (!cancelled) setProjects(list);
    });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  useEffect(() => {
    if (sessionCourseId) return;
    if (courses[0]?.id) setSessionCourseId(courses[0].id);
  }, [courses, sessionCourseId]);

  const projectsForNewSession = useMemo(() => {
    if (!newSessionProgrammeId) return projects;
    return projects.filter((p) => p.programmeId === newSessionProgrammeId);
  }, [projects, newSessionProgrammeId]);

  const projectsForFilter = useMemo(() => {
    if (!filterProgrammeId) return projects;
    return projects.filter((p) => p.programmeId === filterProgrammeId);
  }, [projects, filterProgrammeId]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (filterProgrammeId && s.programmeId !== filterProgrammeId) return false;
      if (filterProjectId && s.projectId !== filterProjectId) return false;
      return true;
    });
  }, [sessions, filterProgrammeId, filterProjectId]);

  const sessionAttachmentLabel = useCallback(
    (s: CourseSession) => {
      const pn = s.programmeId ? programmes.find((x) => x.id === s.programmeId)?.name : undefined;
      const tn = s.projectId ? projects.find((x) => x.id === s.projectId)?.title : undefined;
      if (!pn && !tn) return '—';
      if (pn && tn) return `${pn} · ${tn}`;
      return pn || tn || '—';
    },
    [programmes, projects],
  );

  useEffect(() => {
    if (!newSessionProgrammeId) {
      setProgrammeActionsPicklist([]);
      setNewSessionProgrammeActionId('');
      return;
    }
    let cancelled = false;
    void programmeService.listProgrammeActions(newSessionProgrammeId).then((list) => {
      if (!cancelled) setProgrammeActionsPicklist(list);
    });
    return () => {
      cancelled = true;
    };
  }, [newSessionProgrammeId]);

  useEffect(() => {
    if (section !== 'cohortes' || sessions.length === 0) {
      setActionTitleById({});
      return;
    }
    let cancelled = false;
    const progIds = [...new Set(sessions.map((s) => s.programmeId).filter(Boolean))] as string[];
    if (progIds.length === 0) {
      setActionTitleById({});
      return;
    }
    void Promise.all(progIds.map((pid) => programmeService.listProgrammeActions(pid))).then((lists) => {
      if (cancelled) return;
      const m: Record<string, string> = {};
      lists.flat().forEach((a) => {
        m[a.id] = a.title;
      });
      setActionTitleById(m);
    });
    return () => {
      cancelled = true;
    };
  }, [section, sessions]);

  useEffect(() => {
    if (section !== 'cohortes') {
      setCohortEnrollmentTotal(null);
      return;
    }
    const cid = sessionCourseId || courses[0]?.id;
    if (!cid) {
      setCohortEnrollmentTotal(null);
      return;
    }
    let cancelled = false;
    void DataAdapter.countCourseSessionEnrollmentsForCourse(cid).then((n) => {
      if (!cancelled) setCohortEnrollmentTotal(n);
    });
    return () => {
      cancelled = true;
    };
  }, [section, sessionCourseId, courses, sessions]);

  const loadSessions = useCallback(async () => {
    const cid = sessionCourseId || courses[0]?.id;
    if (!cid) {
      setSessions([]);
      return;
    }
    setSessionsLoading(true);
    try {
      const list = await DataAdapter.listCourseSessionsForCourse(cid);
      setSessions(list);
      setSelectedSessionId(null);
      setSessionEnrollments([]);
    } finally {
      setSessionsLoading(false);
    }
  }, [sessionCourseId, courses]);

  useEffect(() => {
    if (section === 'cohortes') void loadSessions();
  }, [section, loadSessions]);

  useEffect(() => {
    if (section !== 'overview') return;
    let cancelled = false;
    setDashboardSessionsLoading(true);
    void (async () => {
      try {
        const sessionLists = await Promise.all(
          courses.map((c) =>
            DataAdapter.listCourseSessionsForCourse(c.id).then((list) => ({ course: c, list })),
          ),
        );
        if (cancelled) return;
        const acc: DashboardSessionRow[] = [];
        for (const { course, list } of sessionLists) {
          for (const s of list) {
            if (s.status !== 'open' && s.status !== 'planned') continue;
            acc.push({
              ...s,
              courseTitle: course.title,
              thumbnailUrl: course.thumbnailUrl,
              learnerCount: 0,
              progressPct: placeholderProgressPct(s.id),
            });
          }
        }
        acc.sort((a, b) => {
          const ta = a.startsAt ? new Date(a.startsAt).getTime() : 0;
          const tb = b.startsAt ? new Date(b.startsAt).getTime() : 0;
          return tb - ta;
        });
        if (!cancelled) {
          setOverviewOpenSessionsTotal(acc.length);
          setOverviewDistinctProjectTotal(
            new Set(acc.map((s) => s.projectId).filter(Boolean) as string[]).size,
          );
        }
        const top = acc.slice(0, 8);
        const withCounts = await Promise.all(
          top.map(async (row) => {
            const enrollments = await DataAdapter.listCourseSessionEnrollmentsForSession(row.id);
            const learnerCount = enrollments.filter((e) => e.cohortRole === 'learner' || !e.cohortRole).length;
            const lc = learnerCount || enrollments.length;
            return { ...row, learnerCount: lc };
          }),
        );
        if (!cancelled) {
          setDashboardSessions(withCounts);
          setDashboardSessionsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setDashboardSessions([]);
          setOverviewOpenSessionsTotal(0);
          setOverviewDistinctProjectTotal(0);
          setDashboardSessionsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [section, courses]);

  const loadEnrollments = useCallback(async (sessionId: string) => {
    const rows = await DataAdapter.listCourseSessionEnrollmentsForSession(sessionId);
    setSessionEnrollments(rows);
  }, []);

  const handleCreateSession = async () => {
    const cid = sessionCourseId || courses[0]?.id;
    if (!cid || !orgId || !newSessionTitle.trim()) return;
    const proj = newSessionProjectId ? projects.find((p) => p.id === newSessionProjectId) : undefined;
    const programmeId = newSessionProgrammeId || (proj?.programmeId ? String(proj.programmeId) : null);
    const projectId = newSessionProjectId || null;
    const created = await DataAdapter.createCourseSessionForCourse({
      organizationId: orgId,
      courseId: cid,
      title: newSessionTitle.trim(),
      programmeId,
      projectId,
      programmeActionId: newSessionProgrammeActionId || null,
    });
    if (created) {
      setNewSessionTitle('');
      setNewSessionProgrammeActionId('');
      await loadSessions();
    }
  };

  const courseOptions = useMemo(
    () =>
      courses.map((c) => (
        <option key={c.id} value={c.id}>
          {c.title}
        </option>
      )),
    [courses],
  );

  const publishedCourses = useMemo(() => courses.filter((c) => c.status === 'published'), [courses]);
  const activeCoursesCount = publishedCourses.length;
  const totalFormationsCount = courses.length;

  const learnerCountEstimate = useMemo(() => {
    const fromCourses = courses.reduce((sum, c) => sum + (c.studentsCount || 0), 0);
    if (fromCourses > 0) return fromCourses;
    return users.filter((u) => u.role === 'student' || u.role === 'partner_facilitator').length || users.length;
  }, [courses, users]);

  const activeSessionsCount = overviewOpenSessionsTotal;

  const distinctProjectCount = overviewDistinctProjectTotal;

  const continueCourse = useMemo(() => {
    const started = publishedCourses.find((c) => (c.progress ?? 0) > 0 && (c.progress ?? 0) < 100);
    return started ?? publishedCourses[0];
  }, [publishedCourses]);

  const heroProgress = continueCourse?.progress ?? 35;
  const heroLessonsTotal =
    continueCourse?.modules?.reduce((n, m) => n + (m.lessons?.length ?? 0), 0) ||
    continueCourse?.lessonsCount ||
    12;
  const heroLessonIndex = Math.max(1, Math.ceil((heroLessonsTotal * heroProgress) / 100));

  const shellCard = 'rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]';

  const renderStub = (title: string, description: string) => (
    <div className={`mx-auto max-w-3xl ${shellCard} p-10 text-center`}>
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
        <Layers className="h-7 w-7" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-600">{description}</p>
      <p className="mt-4 text-xs text-slate-400">
        Streaming VOD, quiz builder, certificats dématérialisés et mode hors-ligne restent hors périmètre de cette coquille.
      </p>
    </div>
  );

  const cohortesPanel = (
    <div className={`space-y-6 ${shellCard} p-6`}>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 flex flex-wrap gap-6">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Progression cohortes (aperçu)</p>
          <p className="mt-1 font-medium text-slate-900">
            {cohortEnrollmentTotal === null ? '…' : cohortEnrollmentTotal} inscription(s) cohorte sur ce cours
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            Complétion détaillée : parcours <code className="text-[10px]">course_enrollments</code> ; places par
            promotion : <code className="text-[10px]">course_session_enrollments</code>.
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Cohortes affichées</p>
          <p className="mt-1 font-medium text-slate-900">{filteredSessions.length}</p>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Cours</label>
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={sessionCourseId || courses[0]?.id || ''}
            onChange={(e) => setSessionCourseId(e.target.value)}
          >
            {courseOptions.length ? courseOptions : <option value="">— Aucun cours —</option>}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Filtrer · Programme</label>
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={filterProgrammeId}
            onChange={(e) => {
              setFilterProgrammeId(e.target.value);
              setFilterProjectId('');
            }}
          >
            <option value="">Tous les programmes</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[180px]">
          <label className="block text-xs font-medium text-slate-600 mb-1">Filtrer · Projet</label>
          <select
            className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={filterProjectId}
            onChange={(e) => setFilterProjectId(e.target.value)}
          >
            <option value="">Tous les projets</option>
            {projectsForFilter.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => void loadSessions()}
          disabled={sessionsLoading}
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {sessionsLoading ? 'Chargement…' : 'Rafraîchir'}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase text-slate-500">Nouvelle cohorte (promotion)</p>
        <p className="text-xs text-slate-600">
          Optionnel : rattacher au programme portefeuille, au projet terrain et à une action du programme (activité).
          Laissez vide pour une cohorte générale à l’organisation.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row flex-wrap">
          <input
            className="flex-1 min-w-[200px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
            placeholder="Nom de la cohorte (ex. Promotion mars 2026)"
            value={newSessionTitle}
            onChange={(e) => setNewSessionTitle(e.target.value)}
          />
          <select
            className="min-w-[160px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={newSessionProgrammeId}
            onChange={(e) => {
              setNewSessionProgrammeId(e.target.value);
              setNewSessionProjectId('');
              setNewSessionProgrammeActionId('');
            }}
          >
            <option value="">Programme (optionnel)</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            className="min-w-[160px] rounded-xl border border-slate-300 px-3 py-2 text-sm"
            value={newSessionProjectId}
            onChange={(e) => setNewSessionProjectId(e.target.value)}
          >
            <option value="">Projet (optionnel)</option>
            {projectsForNewSession.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <select
            className="min-w-[200px] rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
            disabled={!newSessionProgrammeId}
            value={newSessionProgrammeActionId}
            onChange={(e) => setNewSessionProgrammeActionId(e.target.value)}
            title={!newSessionProgrammeId ? 'Choisissez d’abord un programme pour lister les actions' : undefined}
          >
            <option value="">Activité programme (optionnel)</option>
            {programmeActionsPicklist.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
                {a.actionType ? ` (${a.actionType})` : ''}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handleCreateSession()}
            disabled={!orgId || !newSessionTitle.trim() || !(sessionCourseId || courses[0]?.id)}
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Créer la cohorte
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-slate-500">
              <th className="py-2 pr-4">Cohorte</th>
              <th className="py-2 pr-4">Rattachement</th>
              <th className="py-2 pr-4">Activité</th>
              <th className="py-2 pr-4">Début</th>
              <th className="py-2 pr-4">Fin</th>
              <th className="py-2 pr-4">Cap.</th>
              <th className="py-2 pr-4">Statut</th>
              <th className="py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredSessions.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-slate-500">
                  {sessions.length === 0
                    ? 'Aucune cohorte pour ce cours. Créez-en une ou appliquez les migrations LMS Supabase.'
                    : 'Aucune cohorte ne correspond aux filtres programme / projet.'}
                </td>
              </tr>
            ) : (
              filteredSessions.map((s) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-medium text-slate-900">{s.title}</td>
                  <td className="py-2 pr-4 text-slate-600 text-xs max-w-[240px]">{sessionAttachmentLabel(s)}</td>
                  <td className="py-2 pr-4 text-slate-600 text-xs max-w-[180px]">
                    {s.programmeActionId
                      ? actionTitleById[s.programmeActionId] || `…${s.programmeActionId.slice(0, 8)}`
                      : '—'}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    {s.startsAt ? new Date(s.startsAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">
                    {s.endsAt ? new Date(s.endsAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="py-2 pr-4">{s.capacity ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{s.status}</span>
                  </td>
                  <td className="py-2">
                    <button
                      type="button"
                      className="text-sm text-coya-primary hover:underline"
                      onClick={() => {
                        setSelectedSessionId(s.id);
                        void loadEnrollments(s.id);
                      }}
                    >
                      Inscrits
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedSessionId && (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-800 mb-2">
            Inscriptions sur cette cohorte — {sessionEnrollments.length} ligne(s)
          </p>
          {sessionEnrollments.length === 0 ? (
            <p className="text-sm text-slate-500">
              Aucune inscription sur cette cohorte. Prochaine étape : flux d’inscription, synchro avec le parcours cours et
              export CRM.
            </p>
          ) : (
            <ul className="max-h-40 overflow-y-auto text-sm text-slate-700 space-y-1">
              {sessionEnrollments.map((e) => (
                <li key={e.id}>
                  Utilisateur <code className="text-xs bg-white px-1 rounded">{e.userId.slice(0, 8)}…</code> — {e.status}
                  {e.cohortRole ? (
                    <span className="ml-2 rounded-full bg-white border border-slate-200 px-2 py-0.5 text-[11px]">
                      {COHORT_ROLE_LABELS_FR[e.cohortRole] || e.cohortRole}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );

  const overviewDashboard = (
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-sky-100 text-sky-600">
            <GraduationCap className="h-8 w-8" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Formation</h1>
            <p className="mt-1 text-sm text-slate-600">Développez les compétences. Changez des vies.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="md"
            leftIcon={<Globe className="h-4 w-4 text-slate-500" aria-hidden />}
            className="border-slate-200 bg-white shadow-sm"
            onClick={() => setSection('cours')}
          >
            Catalogue public
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            leftIcon={<Plus className="h-4 w-4" aria-hidden />}
            className="bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500/30"
            onClick={() => {
              if (canStudio) setSection('formations');
            }}
            disabled={!canStudio}
            title={!canStudio ? 'Accès studio (gestion des formations) requis' : undefined}
          >
            + Nouvelle formation
          </Button>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className={`${shellCard} p-5`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Formations</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{totalFormationsCount}</p>
              <p className="mt-1 text-sm text-slate-600">{activeCoursesCount} actives</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <BookOpen className="h-5 w-5" aria-hidden />
            </span>
          </div>
        </div>
        <div className={`${shellCard} p-5`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Apprenants</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{learnerCountEstimate.toLocaleString('fr-FR')}</p>
              <p className="mt-1 text-sm font-medium text-emerald-600">+ 156 ce mois</p>
              <p className="text-[11px] text-slate-400">Variation indicative — agrégation temps réel à brancher</p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
              <Users className="h-5 w-5" aria-hidden />
            </span>
          </div>
        </div>
        <div className={`${shellCard} p-5`}>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cohortes actives</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">{dashboardSessionsLoading ? '…' : activeSessionsCount}</p>
              <p className="mt-1 text-sm text-slate-600">
                {distinctProjectCount === 0
                  ? 'Aucun rattachement projet sur les sessions ouvertes / planifiées'
                  : `Dans ${distinctProjectCount} projet${distinctProjectCount > 1 ? 's' : ''}`}
              </p>
            </div>
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <School className="h-5 w-5" aria-hidden />
            </span>
          </div>
        </div>
        <div className={`${shellCard} p-5`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Taux de réussite global</p>
              <p className="mt-2 text-3xl font-bold text-slate-900">78%</p>
              <p className="mt-1 text-sm font-medium text-emerald-600">+ 8% ce mois</p>
              <p className="text-[11px] text-slate-400">Analytics LMS à connecter</p>
            </div>
            <SuccessSparklineStub />
            <p className="sr-only">Graphique décoratif sans données réelles</p>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Mes cohortes actives</h2>
            <span className="text-[10px] font-medium text-slate-400">Aperçu (8 max.)</span>
          </div>
          <div className="space-y-3">
            {dashboardSessionsLoading ? (
              <div className={`${shellCard} p-8 text-center text-sm text-slate-500`}>Chargement des cohortes…</div>
            ) : dashboardSessions.length === 0 ? (
              <div className={`${shellCard} p-8 text-center text-sm text-slate-500`}>
                Aucune cohorte ouverte ou planifiée. Créez une cohorte depuis la section « Cohortes ».
              </div>
            ) : (
              dashboardSessions.slice(0, 4).map((row) => (
                <div
                  key={row.id}
                  className={`flex flex-wrap items-center gap-4 ${shellCard} p-4`}
                >
                  <div
                    className="h-14 w-14 shrink-0 rounded-xl bg-cover bg-center bg-slate-100"
                    style={
                      row.thumbnailUrl
                        ? { backgroundImage: `url(${row.thumbnailUrl})` }
                        : undefined
                    }
                  >
                    {!row.thumbnailUrl ? (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <ImageIcon className="h-6 w-6" aria-hidden />
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 line-clamp-1">{row.courseTitle}</p>
                    <p className="text-xs text-slate-500 line-clamp-1">{sessionAttachmentLabel(row)}</p>
                    <p className="mt-1 text-xs text-slate-600">
                      Cohorte {row.title.length > 24 ? `${row.title.slice(0, 22)}…` : row.title} ·{' '}
                      {row.learnerCount} apprenant{row.learnerCount > 1 ? 's' : ''}
                    </p>
                  </div>
                  <CircularProgressRing pct={row.progressPct} />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="shrink-0 border-slate-200"
                    onClick={() => setSection('cohortes')}
                  >
                    Continuer
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-4">
          <h2 className="text-sm font-semibold text-slate-900">Continuer ma formation</h2>
          <div className={`overflow-hidden ${shellCard}`}>
            {continueCourse ? (
              <>
                <div className="relative h-44 bg-slate-900">
                  {continueCourse.thumbnailUrl ? (
                    <div
                      className="absolute inset-0 bg-cover bg-center opacity-90"
                      style={{ backgroundImage: `url(${continueCourse.thumbnailUrl})` }}
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-slate-800 to-blue-900 opacity-95" />
                  )}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      type="button"
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-white/95 text-blue-600 shadow-md transition hover:scale-105"
                      aria-label="Lire la vidéo"
                      onClick={() => onSelectCourse(continueCourse.id)}
                    >
                      <Play className="ml-0.5 h-7 w-7 fill-current" aria-hidden />
                    </button>
                  </div>
                  <span className="absolute left-3 top-3 rounded-full bg-blue-600 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                    Vidéo en cours
                  </span>
                </div>
                <div className="space-y-3 p-5">
                  <h3 className="text-lg font-bold text-slate-900 line-clamp-2">{continueCourse.title}</h3>
                  <p className="text-sm text-slate-600">
                    Leçon {heroLessonIndex} sur {heroLessonsTotal} : progression du parcours
                  </p>
                  <p className="text-[11px] text-slate-400">Métadonnées durée / type : à brancher sur le contenu réel</p>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600 transition-all"
                      style={{ width: `${heroProgress}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      Durée (exemple) : 32 min
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Film className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      Type (exemple) : Vidéo
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <LineChart className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      Progression : {heroProgress}%
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="w-full bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500/30"
                    onClick={() => onSelectCourse(continueCourse.id)}
                  >
                    Reprendre
                  </Button>
                </div>
              </>
            ) : (
              <div className="p-10 text-center text-sm text-slate-500">
                Aucun parcours publié pour reprendre. Consultez le catalogue.
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4 xl:col-span-3">
          <div className={`${shellCard} p-4`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Mon calendrier</h3>
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Exemple</span>
            </div>
            <ul className="mt-3 space-y-3">
              {[
                { day: '24', month: 'MAI', title: 'Atelier : Pitch efficace', meta: '09:00 · Dakar' },
                { day: '02', month: 'JUIN', title: 'Clôture cohorte EGE-08', meta: 'En ligne' },
                { day: '10', month: 'JUIN', title: 'Évaluation module 3', meta: '14:00 · Salle B' },
              ].map((ev) => (
                <li key={ev.title} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                  <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-white text-center shadow-sm">
                    <span className="text-[10px] font-bold text-blue-600">{ev.month}</span>
                    <span className="text-lg font-bold leading-none text-slate-900">{ev.day}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900">{ev.title}</p>
                    <p className="text-xs text-slate-500">{ev.meta}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className={`${shellCard} p-4`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Exemple</span>
            </div>
            <ul className="mt-3 space-y-3">
              {[
                { icon: 'book' as const, color: 'text-blue-500', bg: 'bg-blue-50', text: 'Nouvelle leçon disponible', time: 'Il y a 2 h' },
                { icon: 'check' as const, color: 'text-emerald-500', bg: 'bg-emerald-50', text: 'Votre évaluation a été notée', time: 'Hier' },
                { icon: 'users' as const, color: 'text-violet-500', bg: 'bg-violet-50', text: 'Nouvel apprenant inscrit à votre cohorte', time: 'Il y a 3 j' },
              ].map((n) => (
                <li key={n.text} className="flex gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${n.bg}`}>
                    {n.icon === 'book' ? (
                      <BookOpen className={`h-4 w-4 ${n.color}`} aria-hidden />
                    ) : n.icon === 'check' ? (
                      <CheckCircle2 className={`h-4 w-4 ${n.color}`} aria-hidden />
                    ) : (
                      <Users className={`h-4 w-4 ${n.color}`} aria-hidden />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-slate-800">{n.text}</p>
                    <p className="text-xs text-slate-400">{n.time}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-10">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Catalogue des formations</h2>
            <p className="text-sm text-slate-500">Parcours publiés — badges promotionnels heuristiques</p>
          </div>
          <button
            type="button"
            className="text-sm font-medium text-blue-600 hover:underline"
            onClick={() => setSection('cours')}
          >
            Voir tout le catalogue →
          </button>
        </div>
        <div className={`${shellCard} overflow-hidden p-4 sm:p-6`}>
          <Courses
            courses={courses}
            users={users}
            onSelectCourse={onSelectCourse}
            formationHubEmbed
          />
        </div>
      </div>
    </>
  );

  const sectionTitle: Record<FormationHubSection, string> = {
    overview: 'Vue d\u2019ensemble',
    programmes: 'Programmes de formation',
    cohortes: 'Cohortes',
    formations: 'Studio formations',
    cours: 'Catalogue',
    formateurs: 'Formateurs / mentors',
    apprenants: 'Apprenants',
    evaluations: '\u00c9valuations',
    certificats: 'Certificats',
    rapports: 'Rapports',
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
          {section !== 'overview' ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Formation</p>
                <h1 className="text-xl font-bold text-slate-900">{sectionTitle[section]}</h1>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSection('overview')}>
                ← Vue d&apos;ensemble
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {section === 'overview' && overviewDashboard}

        {section === 'programmes' && (
          <div className="space-y-6">
            {renderStub(
              'Programmes de formation',
              'Liez vos parcours aux programmes et projets depuis le module Programmes & Projets.',
            )}
            <div className="flex justify-center gap-3">
              <Button type="button" variant="primary" onClick={() => setView('programmes_projects')}>
                Ouvrir Programmes & Projets
              </Button>
              <Button type="button" variant="secondary" onClick={() => setView('programme')}>
                Module Programme
              </Button>
            </div>
          </div>
        )}

        {section === 'cohortes' && cohortesPanel}

        {section === 'formations' &&
          (canStudio ? (
            <div className={`${shellCard} overflow-hidden p-4 sm:p-6`}>
              <CourseManagement
                courses={courses}
                users={users}
                onAddCourse={onAddCourse}
                onUpdateCourse={onUpdateCourse}
                onDeleteCourse={onDeleteCourse}
                embedded
                isLoading={isLoading}
                loadingOperation={loadingOperation}
                onOpenCrmCollecteForCourse={(courseId) => {
                  try {
                    sessionStorage.setItem(NAV_SESSION_COLLECTE_PRESET_FORMATION_ID, courseId);
                    sessionStorage.setItem(NAV_SESSION_CRM_OPEN_COLLECTE_TAB, '1');
                  } catch {
                    /* ignore */
                  }
                  setView('crm_sales');
                }}
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
              Vous n&apos;avez pas accès au studio (gestion des cours). Demandez l&apos;accès au module « Gestion des
              formations ».
            </div>
          ))}

        {section === 'cours' && (
          <div className={`${shellCard} overflow-hidden p-4 sm:p-6`}>
            <Courses courses={courses} users={users} onSelectCourse={onSelectCourse} />
          </div>
        )}

        {section === 'formateurs' &&
          renderStub(
            'Formateurs & mentors',
            'Annuaire pédagogique, affectations et charge — à brancher sur les rôles cohorte et le RH.',
          )}

        {section === 'apprenants' &&
          renderStub(
            'Apprenants',
            `Vue consolidée des ${users.length} profils — filtres par cohorte et progression à intégrer.`,
          )}

        {section === 'evaluations' &&
          renderStub('Évaluations', 'Banques de questions, corrections et résultats — builder non implémenté dans cette version.')}

        {section === 'certificats' &&
          renderStub(
            'Certificats',
            'Émission depuis learning_certificates — parcours certification déjà signalé sur les cours compatibles.',
          )}

        {section === 'rapports' &&
          renderStub(
            'Rapports',
            'Exports et tableaux de bord pédagogiques — connecter aux entrepôts analytics LMS.',
          )}
      </div>
    </div>
  );
};

export default FormationHub;
