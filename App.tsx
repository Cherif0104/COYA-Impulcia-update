import React, { useState, useEffect, useMemo, useCallback, useRef, startTransition } from 'react';
import { useAuth } from './contexts/AuthContextSupabase';
import { authGuard } from './middleware/authGuard';
import { mockProjects, mockGoals } from './constants/data';
import { Course, Job, Project, Objective, Contact, Document, User, Role, TimeLog, LeaveRequest, Invoice, Expense, AppNotification, RecurringInvoice, RecurringExpense, RecurrenceFrequency, Budget, Meeting, ProjectModuleSettings, Language } from './types';
import { useLocalization } from './contexts/LocalizationContext';
import DataAdapter from './services/dataAdapter';
import { dispatchCrmOutboundEvent } from './services/crmIntegrationHub';
import { logContactDossierFromCrm } from './services/contactDossierService';
import DataService from './services/dataService';
import { logger } from './services/loggerService';
import { verboseLogs } from './services/verboseLog';
import NotificationHelper from './services/notificationHelper';
import AuditLogService from './services/auditLogService';
import { emitTimeLogImputationEvent } from './services/workforce/timeLogActivityBridge';
import { Notification } from './services/notificationService';
import { postCoyaDebugIngest } from './utils/coyaDebugIngest';

import Login from './components/Login';
// Inscription désactivée : seuls les super admins créent les utilisateurs et organisations depuis la plateforme.
import StatusSelectorModal from './components/StatusSelectorModal';
import { getSkipStatusSelector } from './components/StatusSelector';
import Header from './components/Header';
import {
  AppNavigationContext,
  NAV_SESSION_COLLECTE_PRESET_FORMATION_ID,
  NAV_SESSION_CRM_OPEN_COLLECTE_TAB,
} from './contexts/AppNavigationContext';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import Courses from './components/Courses';
import Jobs from './components/Jobs';
import Settings from './components/Settings';
import Projects from './components/Projects';
import ProjectObjectWorkspace from './components/project/workspace/ProjectObjectWorkspace';
import ProgrammeModule from './components/ProgrammeModule';
import ProgrammesProjectsShell from './components/ProgrammesProjectsShell';
import CourseDetail from './components/CourseDetail';
import CourseManagement from './components/CourseManagement';
import ApexModuleShell from './components/apex/ApexModuleShell';
import ApexAccessLanding from './components/apex/ApexAccessLanding';
import JobManagement from './components/JobManagement';
import LeaveManagementAdmin from './components/LeaveManagementAdmin';
import StrategyGovernanceHub from './components/StrategyGovernanceHub';
import CRM from './components/CRM';
import Drive from './components/Drive';
import DafServicesModule from './components/DafServicesModule';
import CreateJob from './components/CreateJob';
import UserManagement from './components/UserManagement';
import AIAgent from './components/AIAgent';
import LeaveManagement from './components/LeaveManagement';
import RealtimeService from './services/realtimeService';
import OrganizationService from './services/organizationService';
import { publishAccountingEvent, registerDefaultAccountingHandlers } from './services/accountingEvents';
import { supabase } from './services/supabaseService';
import OrganizationManagement from './components/OrganizationManagement';
import DepartmentManagement from './components/DepartmentManagement';
import { useModulePermissions } from './hooks/useModulePermissions';
import { viewNameToModuleName, getFirstAccessibleView } from './utils/viewModuleMap';
import { projectsHomeView } from './utils/programmesProjectsNav';
import {
  getProjectIdFromUrl,
  navigateToProjectWorkspace,
  navigateToProjectsListPath,
  clearProjectPathSegmentIfPresent,
} from './utils/projectWorkspaceUrl';
import {
  getEmployeeProfileIdFromUrl,
  navigateToEmployeeWorkspace,
  clearHrEmployeePathSegmentIfPresent,
} from './utils/hrEmployeeWorkspaceUrl';
import EmployeeWorkspaceShell from './components/hr/EmployeeWorkspaceShell';
import NotificationsPage from './components/NotificationsPage';
import ActivityLogsPage from './components/ActivityLogsPage';
import RhModule from './components/RhModule';
import { AttendanceStatusDock, MobileAttendanceDock } from './components/hr/workforce-live';
import ComptabiliteModule from './components/ComptabiliteModule';
import Planning from './components/Planning';
import LoadingOverlay from './components/common/LoadingOverlay';
import PasswordRecoveryScreen from './components/PasswordRecoveryScreen';
import QualiteModule from './components/QualiteModule';
import CollecteModule from './components/CollecteModule';
import PostesManagement from './components/PostesManagement';
import { Button } from './components/ui/Button';
// FigmaModuleShell est désormais transparent (pas de hero global) — alignement Figma.
import { getModuleViewComponent } from './viewRegistry';
import { runWorkflowCycle, WorkflowKpiSnapshot } from './services/workflowEngine';
import { isAuthRecoveryPathname } from './constants/coyaSite';

/** Vues modules retirées — bookmarks / notifications basculent vers le tableau de bord. */
const REMOVED_APP_VIEWS = new Set<string>([
  'time_tracking',
  'analytics',
  'talent_analytics',
  'tech',
  'conseil',
  'finance',
]);

const App: React.FC = () => {
  const { user, signIn, signOut, loading: authLoading } = useAuth();
  const { t, language } = useLocalization();
  const permissionsContext = useModulePermissions();
  const { canAccessModule, loading: permissionsLoading } = permissionsContext;
  const [authView, setAuthView] = useState<'login' | 'signup'>('login');
  const formatRoleLabel = useCallback((roleValue?: Role | null) => {
    if (!roleValue) return undefined;
    const translation = t(roleValue);
    if (translation && translation.trim() && translation !== roleValue) {
      return translation;
    }
    return roleValue.replace(/_/g, ' ');
  }, [t]);

  // Enregistre les handlers comptables par défaut (pont factures → écritures, etc.).
  useEffect(() => {
    registerDefaultAccountingHandlers();
  }, []);

  const emitInvoiceAccountingEvent = useCallback((invoice: Invoice) => {
    // Ne déclenche le pont comptable que pour les factures effectivement engagées
    // (émises / payées) ; le handler applique en plus une idempotence côté écritures.
    const engagedStatuses: Invoice['status'][] = ['Sent', 'Paid', 'Overdue', 'Partially Paid'];
    if (!engagedStatuses.includes(invoice.status)) return;
    void (async () => {
      try {
        const organizationId = await OrganizationService.getCurrentUserOrganizationId();
        if (!organizationId) return;
        await publishAccountingEvent({
          type: 'accounting.invoice_issued',
          organizationId,
          invoice,
        });
      } catch (err) {
        console.error('⚠️ emitInvoiceAccountingEvent failed:', err);
      }
    })();
  }, []);

  const emitExpenseAccountingEvent = useCallback((expense: Expense) => {
    // Pont uniquement pour les dépenses effectivement payées.
    if (expense.status !== 'Paid') return;
    void (async () => {
      try {
        const organizationId = await OrganizationService.getCurrentUserOrganizationId();
        if (!organizationId) return;
        await publishAccountingEvent({
          type: 'accounting.expense_recorded',
          organizationId,
          expense,
        });
      } catch (err) {
        console.error('⚠️ emitExpenseAccountingEvent failed:', err);
      }
    })();
  }, []);
  const handlePendingLogout = useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('❌ Erreur déconnexion (pending) :', error);
    } finally {
      setAuthView('login');
      setCurrentView('login');
      try {
        localStorage.setItem('lastView', 'login');
      } catch {
        /* ignore */
      }
    }
  }, [signOut]);
  
  // Récupérer la vue précédente depuis localStorage (pour éviter le flash au refresh)
  const rawSavedView = typeof window !== 'undefined' ? localStorage.getItem('lastView') : null;
  let savedView =
    rawSavedView === 'courses' || rawSavedView === 'formation'
      ? 'apex'
      : rawSavedView === 'knowledge_base'
        ? 'coya_drive'
        : rawSavedView;
  if (savedView && REMOVED_APP_VIEWS.has(savedView)) {
    savedView = 'dashboard';
  }
  const hrEmployeeProfileIdFromUrlHydrate =
    typeof window !== 'undefined' ? getEmployeeProfileIdFromUrl() : null;
  const projectIdFromUrlHydrate = typeof window !== 'undefined' ? getProjectIdFromUrl() : null;
  const authRecoveryFromUrl =
    typeof window !== 'undefined' && isAuthRecoveryPathname(window.location.pathname);
  const apexAccessFromUrl =
    typeof window !== 'undefined' && window.location.pathname.startsWith('/apex/access');
  // Lien direct `/hr/employees/:id` → workspace salarié ; sinon `?projectId=` / `/projects/:id` → projet.
  // `/auth/recovery` (lien e-mail Supabase) → vue connexion pour éviter un flash tableau de bord.
  const validInitialView = authRecoveryFromUrl
    ? 'login'
    : apexAccessFromUrl
    ? 'apex_access'
    : hrEmployeeProfileIdFromUrlHydrate
    ? 'employee_workspace'
    : projectIdFromUrlHydrate
      ? 'project_workspace'
      : savedView &&
          savedView !== 'login' &&
          savedView !== 'signup' &&
          savedView !== 'no_access' &&
          savedView !== 'status_selector' &&
          savedView !== 'employee_workspace'
        ? savedView
        : 'dashboard';
  const [currentView, setCurrentView] = useState(validInitialView);
  
  const [isSidebarOpen, setSidebarOpen] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingOperation, setLoadingOperation] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 15, loaded: [] as string[] });
  
  // Lifted State
  const [courses, setCourses] = useState<Course[]>([]); // Plus de données mockées - uniquement Supabase
  const [jobs, setJobs] = useState<Job[]>([]); // Plus de données mockées - uniquement Supabase
  const [projects, setProjects] = useState<Project[]>([]); // Plus de données mockées - uniquement Supabase
  const [accessibleProjectIds, setAccessibleProjectIds] = useState<string[]>([]);
  const [objectives, setObjectives] = useState<Objective[]>(mockGoals);
  const [contacts, setContacts] = useState<Contact[]>([]); // Plus de données mockées - uniquement Supabase
  const [documents, setDocuments] = useState<Document[]>([]); // Plus de données mockées - uniquement Supabase
  const [users, setUsers] = useState<User[]>([]); // Plus de données mockées - uniquement Supabase
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]); // Plus de données mockées - uniquement Supabase
  const [expenses, setExpenses] = useState<Expense[]>([]); // Plus de données mockées - uniquement Supabase
  const [recurringInvoices, setRecurringInvoices] = useState<RecurringInvoice[]>([]); // Plus de données mockées - uniquement Supabase
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]); // Plus de données mockées - uniquement Supabase
  const [budgets, setBudgets] = useState<Budget[]>([]); // Plus de données mockées - uniquement Supabase
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [reminderDays, setReminderDays] = useState<number>(3);
  const [projectModuleSettings, setProjectModuleSettings] = useState<ProjectModuleSettings | null>(null);
  const [workflowKpis, setWorkflowKpis] = useState<WorkflowKpiSnapshot | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [pendingNotification, setPendingNotification] = useState<{ entityType: string; entityId?: string; metadata?: Record<string, any> } | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    projectIdFromUrlHydrate && !hrEmployeeProfileIdFromUrlHydrate ? projectIdFromUrlHydrate : null,
  );
  const [selectedEmployeeWorkspaceProfileId, setSelectedEmployeeWorkspaceProfileId] = useState<string | null>(
    hrEmployeeProfileIdFromUrlHydrate,
  );
  const [showNewPasswordModal, setShowNewPasswordModal] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const mainScrollRef = useRef<HTMLElement>(null);
  const automationCycleRunningRef = useRef(false);
  const automationLastRunAtRef = useRef<number>(0);
  const automationSentActionRef = useRef<Map<string, number>>(new Map());

  const handleMainScroll = useCallback(() => {
    const el = mainScrollRef.current;
    setShowBackToTop(!!el && el.scrollTop > 400);
  }, []);

  const scrollToTop = useCallback(() => {
    mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const isPartnerFacilitator = user?.role === 'partner_facilitator';

  const partnerIdentifiers = useMemo(() => {
    const identifiers = new Set<string>();
    if (user?.id) {
      identifiers.add(String(user.id));
    }
    if (user?.profileId) {
      identifiers.add(String(user.profileId));
    }
    return identifiers;
  }, [user?.id, user?.profileId]);

  const filterTimeLogsForUser = useCallback((logs: TimeLog[] = [], allowedProjectIdsOverride?: Set<string>) => {
    if (!isPartnerFacilitator) {
      return logs;
    }
    const allowedProjects = allowedProjectIdsOverride ?? new Set(accessibleProjectIds);
    const filteredLogs = (logs || []).filter(log => {
      if (!log) return false;
      const logUserId = log.userId ? String(log.userId) : '';
      if (partnerIdentifiers.has(logUserId)) {
        return true;
      }
      if (log.entityType === 'project') {
        const entityId = log.entityId !== undefined && log.entityId !== null ? String(log.entityId) : '';
        return allowedProjects.has(entityId);
      }
      return false;
    });
    return filteredLogs;
  }, [accessibleProjectIds, isPartnerFacilitator, partnerIdentifiers]);

  const filterObjectivesForUser = useCallback((objectivesList: Objective[] = [], allowedProjectIdsOverride?: Set<string>) => {
    if (!isPartnerFacilitator) {
      return objectivesList;
    }
    const allowedProjects = allowedProjectIdsOverride ?? new Set(accessibleProjectIds);
    if (allowedProjects.size === 0) {
      return [];
    }
    return (objectivesList || []).filter(objective => {
      if (!objective?.projectId) return false;
      return allowedProjects.has(String(objective.projectId));
    });
  }, [accessibleProjectIds, isPartnerFacilitator]);

  const filterMeetingsForUser = useCallback((meetingsList: Meeting[] = []) => {
    if (!isPartnerFacilitator) {
      return meetingsList;
    }
    return (meetingsList || []).filter(meeting => {
      if (!meeting) return false;
      if (meeting.organizerId && partnerIdentifiers.has(String(meeting.organizerId))) {
        return true;
      }
      const attendees = Array.isArray(meeting.attendees) ? meeting.attendees : [];
      return attendees.some(attendee => {
        const candidateIds = [attendee?.id, (attendee as any)?.profileId, (attendee as any)?.userId]
          .filter(Boolean)
          .map(val => String(val));
        return candidateIds.some(id => partnerIdentifiers.has(id));
      });
    });
  }, [isPartnerFacilitator, partnerIdentifiers]);

  const computeProjectAccess = useCallback((projectsList: Project[] = []) => {
    const allowedProjectIds = new Set<string>();

    if (!isPartnerFacilitator) {
      (projectsList || []).forEach(project => {
        if (project?.id) {
          allowedProjectIds.add(String(project.id));
        }
      });
      return { filteredProjects: projectsList, allowedProjectIds };
    }

    const filteredProjects = (projectsList || []).filter(project => {
      if (!project) return false;
      const candidateIds: string[] = [];

      if (Array.isArray(project.teamMemberIds)) {
        project.teamMemberIds.forEach(id => {
          if (id) {
            candidateIds.push(String(id));
          }
        });
      }

      if (Array.isArray(project.team)) {
        project.team.forEach(member => {
          if (!member) return;
          const possibleIds = [member.id, (member as any)?.profileId, (member as any)?.userId];
          possibleIds.forEach(val => {
            if (val) {
              candidateIds.push(String(val));
            }
          });
        });
      }

      const hasAccess = candidateIds.some(id => partnerIdentifiers.has(id));
      if (hasAccess && project.id) {
        allowedProjectIds.add(String(project.id));
      }
      return hasAccess;
    });

    return { filteredProjects, allowedProjectIds };
  }, [isPartnerFacilitator, partnerIdentifiers]);

  const updateProjects = useCallback((projectsList: Project[] = []) => {
    const { filteredProjects, allowedProjectIds } = computeProjectAccess(projectsList);
    setAccessibleProjectIds(Array.from(allowedProjectIds));
    setProjects(filteredProjects);

    if (isPartnerFacilitator) {
      setTimeLogs(prev => filterTimeLogsForUser(prev, allowedProjectIds));
      setObjectives(prev => filterObjectivesForUser(prev, allowedProjectIds));
      setMeetings(prev => filterMeetingsForUser(prev));
    }

    return allowedProjectIds;
  }, [computeProjectAccess, filterMeetingsForUser, filterObjectivesForUser, filterTimeLogsForUser, isPartnerFacilitator]);

  const updateProjectsWithProducer = useCallback((producer: (prev: Project[]) => Project[]) => {
    let resultingIds = new Set<string>();
    setProjects(prevProjects => {
      const nextProjects = producer(prevProjects);
      const { filteredProjects, allowedProjectIds } = computeProjectAccess(nextProjects);
      resultingIds = allowedProjectIds;
      setAccessibleProjectIds(Array.from(allowedProjectIds));
      if (isPartnerFacilitator) {
        setTimeLogs(prev => filterTimeLogsForUser(prev, allowedProjectIds));
        setObjectives(prev => filterObjectivesForUser(prev, allowedProjectIds));
        setMeetings(prev => filterMeetingsForUser(prev));
      }
      return filteredProjects;
    });
    return resultingIds;
  }, [computeProjectAccess, filterMeetingsForUser, filterObjectivesForUser, filterTimeLogsForUser, isPartnerFacilitator]);

  const updateTimeLogs = useCallback((logs: TimeLog[] = [], allowedProjectIdsOverride?: Set<string>) => {
    setTimeLogs(filterTimeLogsForUser(logs, allowedProjectIdsOverride));
  }, [filterTimeLogsForUser]);

  const updateTimeLogsWithProducer = useCallback((producer: (prev: TimeLog[]) => TimeLog[]) => {
    setTimeLogs(prev => filterTimeLogsForUser(producer(prev)));
  }, [filterTimeLogsForUser]);

  const updateMeetings = useCallback((meetingsList: Meeting[] = []) => {
    setMeetings(filterMeetingsForUser(meetingsList));
  }, [filterMeetingsForUser]);

  const updateMeetingsWithProducer = useCallback((producer: (prev: Meeting[]) => Meeting[]) => {
    setMeetings(prev => filterMeetingsForUser(producer(prev)));
  }, [filterMeetingsForUser]);

  const updateObjectives = useCallback((list: Objective[] = [], allowedProjectIdsOverride?: Set<string>) => {
    setObjectives(filterObjectivesForUser(list, allowedProjectIdsOverride));
  }, [filterObjectivesForUser]);

  // --- FINANCE REALTIME SYNC ---
  useEffect(() => {
    let invoicesCh: any; let expensesCh: any; let budgetsCh: any;
    const subscribe = async () => {
      try {
        const orgId = await OrganizationService.getCurrentUserOrganizationId();
        const filter = orgId ? `organization_id=eq.${orgId}` : undefined;

        const refreshFinance = async () => {
          try {
            const [invRes, expRes, budRes] = await Promise.all([
              DataAdapter.getInvoices?.() || DataService.getInvoices?.(),
              DataAdapter.getExpenses?.() || DataService.getExpenses?.(),
              DataAdapter.getBudgets?.() || DataService.getBudgets?.(),
            ] as any);
            // DataAdapter retourne directement les tableaux; DataService retourne {data}
            if (invRes) setInvoices(Array.isArray(invRes) ? invRes as any : (invRes.data || []));
            if (expRes) setExpenses(Array.isArray(expRes) ? expRes as any : (expRes.data || []));
            if (budRes) setBudgets(Array.isArray(budRes) ? budRes as any : (budRes.data || []));
          } catch (e) {
            console.warn('⚠️ refreshFinance failed:', e);
          }
        };

        invoicesCh = RealtimeService.subscribeToTable('invoices', () => { refreshFinance(); }, filter);
        expensesCh = RealtimeService.subscribeToTable('expenses', () => { refreshFinance(); }, filter);
        budgetsCh  = RealtimeService.subscribeToTable('budgets',  () => { refreshFinance(); }, filter);
      } catch (e) {
        console.warn('⚠️ Realtime Finance subscription failed:', e);
      }
    };
    subscribe();
    return () => {
      if (invoicesCh) RealtimeService.unsubscribe(invoicesCh);
      if (expensesCh) RealtimeService.unsubscribe(expensesCh);
      if (budgetsCh) RealtimeService.unsubscribe(budgetsCh);
    };
  }, []);

  // Password recovery flow (Supabase)
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setShowNewPasswordModal(true);
      }
    });
    return () => { sub.subscription?.unsubscribe(); };
  }, []);

  // Lien e-mail → `/auth/recovery` : éviter que lastView (ex. dashboard) prenne le dessus au prochain chargement.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!isAuthRecoveryPathname(window.location.pathname)) return;
    try {
      localStorage.setItem('lastView', 'login');
    } catch {
      /* ignore */
    }
  }, []);

  const clearAuthRecoveryUrlIfPresent = useCallback(() => {
    if (typeof window !== 'undefined' && isAuthRecoveryPathname(window.location.pathname)) {
      window.history.replaceState({}, '', `${window.location.origin}/`);
    }
  }, []);

  const handleRecoveryCompleted = useCallback(() => {
    setShowNewPasswordModal(false);
    clearAuthRecoveryUrlIfPresent();
  }, [clearAuthRecoveryUrlIfPresent]);

  const handleRecoveryAbort = useCallback(async () => {
    try {
      await signOut();
    } catch (e) {
      console.warn('Déconnexion (recovery) :', e);
    }
    setShowNewPasswordModal(false);
    setCurrentView('login');
    clearAuthRecoveryUrlIfPresent();
    try {
      localStorage.setItem('lastView', 'login');
    } catch {
      /* ignore */
    }
  }, [signOut, clearAuthRecoveryUrlIfPresent]);

  // Handler pour setView qui persiste dans localStorage
  const handleSetView = useCallback((view: string) => {
    const normalized =
      view === 'courses' || view === 'formation' ? 'apex' : view === 'knowledge_base' ? 'coya_drive' : view;
    const nextView = REMOVED_APP_VIEWS.has(normalized) ? 'dashboard' : normalized;
    // #region agent log
    postCoyaDebugIngest({
      sessionId: '5fe008',
      hypothesisId: 'H4',
      location: 'App.tsx:handleSetView',
      message: 'view_change',
      data: { from: currentView, to: nextView },
      timestamp: Date.now(),
    });
    // #endregion
    logger.logNavigation(currentView, nextView, 'handleSetView');
    logger.debug('state', `Setting currentView: ${currentView} → ${nextView}`);
    setCurrentView(nextView);
    
    // Persister la vue sauf pour login/signup
    if (nextView !== 'login' && nextView !== 'signup') {
      localStorage.setItem('lastView', nextView);
      logger.debug('session', `Persisted view to localStorage: ${nextView}`);
    }
    
    // Gérer le selectedCourseId
    if (nextView !== 'course_detail') {
      setSelectedCourseId(null);
    }
    if (nextView !== 'project_workspace') {
      setSelectedProjectId(null);
      if (nextView === 'projects') {
        navigateToProjectsListPath();
      } else {
        clearProjectPathSegmentIfPresent();
      }
    }
    if (nextView !== 'employee_workspace') {
      setSelectedEmployeeWorkspaceProfileId(null);
      clearHrEmployeePathSegmentIfPresent();
    }

    // Fermer la sidebar sur mobile
    if (window.innerWidth < 1024) {
      setSidebarOpen(false);
    }

    if (nextView === 'dashboard') {
      requestAnimationFrame(() => {
        try {
          mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        } catch {
          /* ignore */
        }
      });
    }
  }, [currentView]);

  const handleNotificationNavigate = useCallback((notification: Notification) => {
    const type = (notification.entityType || notification.module || '').toLowerCase();
    const normalizedId = notification.entityId ? String(notification.entityId) : undefined;
    const metadata = notification.metadata || {};
    const route = metadata.route as string | undefined;
    const autoOpenId = (metadata.autoOpenEntityId ?? normalizedId) as string | undefined;

    const navigateFromRoute = (targetRoute: string, meta?: Record<string, any>) => {
      try {
        const url = new URL(targetRoute, window.location.origin);
        const path = url.pathname.replace(/^\//, '');
        const tab = url.searchParams.get('tab') || meta?.tab;

        switch (path) {
          case '':
          case 'dashboard':
            setPendingNotification(null);
            handleSetView('dashboard');
            return true;
          case 'time-tracking':
            setPendingNotification(null);
            handleSetView('planning');
            return true;
          case 'planning':
            setPendingNotification(null);
            handleSetView('planning');
            return true;
          case 'projects':
            setPendingNotification({
              entityType: 'project',
              entityId: autoOpenId
            });
            handleSetView(projectsHomeView(canAccessModule));
            return true;
          case 'finance':
            setPendingNotification(null);
            handleSetView('comptabilite');
            return true;
          case 'goals-okrs':
          case 'goals':
            setPendingNotification({
              entityType: 'goal',
              metadata: { section: tab || meta?.section }
            });
            handleSetView('goals_okrs');
            return true;
          case 'knowledge':
            setPendingNotification(null);
            handleSetView('coya_drive');
            return true;
          default:
            return false;
        }
      } catch (error) {
        console.warn('Navigation notification route invalide:', targetRoute, error);
        return false;
      }
    };

    if (route && navigateFromRoute(route, metadata)) {
      return;
    }

    if (type === 'project' || type === 'projects') {
      setPendingNotification({ entityType: 'project', entityId: autoOpenId });
      handleSetView(projectsHomeView(canAccessModule));
      return;
    }

    if (type === 'course' || type === 'courses') {
      setPendingNotification({ entityType: 'course', entityId: autoOpenId });
      handleSetView('apex');
      return;
    }

    if (type === 'time_log' || type === 'time_tracking') {
      setPendingNotification(null);
      handleSetView('planning');
      return;
    }

    if (type === 'leave_request' || type === 'leave' || type === 'leave_management') {
      setPendingNotification(null);
      handleSetView('leave_management');
      return;
    }

    if (type === 'invoice' || type === 'expense' || type === 'finance') {
      setPendingNotification(null);
      handleSetView('comptabilite');
      return;
    }

    if (type === 'goal' || type === 'objective') {
      setPendingNotification({ entityType: 'goal', metadata });
      handleSetView('goals_okrs');
      return;
    }

    if (type === 'knowledge' || type === 'document') {
      setPendingNotification(null);
      handleSetView('coya_drive');
      return;
    }

    if (type === 'messaging' || type === 'messagerie') {
      const meta = (metadata || {}) as Record<string, unknown>;
      try {
        sessionStorage.setItem(
          'coya.messaging.deeplink',
          JSON.stringify({
            v: 1,
            ts: Date.now(),
            tab: meta.channelId ? 'channels' : 'direct',
            channelId: meta.channelId ? String(meta.channelId) : undefined,
            threadId: meta.threadId ? String(meta.threadId) : undefined,
          }),
        );
      } catch {
        /* ignore */
      }
      setPendingNotification(null);
      handleSetView('messagerie');
      return;
    }

    setPendingNotification(null);
    handleSetView('dashboard');
  }, [handleSetView, canAccessModule]);

  const buildDiff = (previous: any | undefined, next: any | undefined, fields: string[]) => {
    if (!previous || !next) return undefined;
    const diff: Record<string, { old: any; new: any }> = {};
    fields.forEach(field => {
      const oldValue = previous[field];
      const newValue = next[field];
      if (oldValue !== newValue) {
        diff[field] = { old: oldValue, new: newValue };
      }
    });
    return Object.keys(diff).length > 0 ? diff : undefined;
  };

  const handleNotificationHandled = useCallback(() => {
    setPendingNotification(null);
  }, []);

  const handleActivityLogNavigate = useCallback((entityType: string, entityId?: string, metadata?: Record<string, any>) => {
    const type = entityType.toLowerCase();
    const normalizedId = entityId ? String(entityId) : undefined;
    const meta = metadata || {};
    const route = meta.route as string | undefined;
    const autoOpenId = (meta.autoOpenEntityId ?? normalizedId) as string | undefined;

    const navigateFromRoute = (targetRoute: string, routeMeta?: Record<string, any>) => {
      try {
        const url = new URL(targetRoute, window.location.origin);
        const path = url.pathname.replace(/^\//, '');
        const tab = url.searchParams.get('tab') || routeMeta?.tab;

        switch (path) {
          case '':
          case 'dashboard':
            setPendingNotification(null);
            handleSetView('dashboard');
            return true;
          case 'time-tracking':
            setPendingNotification(null);
            handleSetView('planning');
            return true;
          case 'planning':
            setPendingNotification(null);
            handleSetView('planning');
            return true;
          case 'projects':
            setPendingNotification({
              entityType: 'project',
              entityId: autoOpenId
            });
            handleSetView(projectsHomeView(canAccessModule));
            return true;
          case 'finance':
            setPendingNotification(null);
            handleSetView('comptabilite');
            return true;
          case 'goals-okrs':
          case 'goals':
            setPendingNotification({
              entityType: 'goal',
              metadata: { section: tab || routeMeta?.section }
            });
            handleSetView('goals_okrs');
            return true;
          case 'knowledge':
            setPendingNotification(null);
            handleSetView('coya_drive');
            return true;
          default:
            return false;
        }
      } catch (error) {
        console.warn('Navigation activity log route invalide:', targetRoute, error);
        return false;
      }
    };

    if (route && navigateFromRoute(route, meta)) {
      return;
    }

    if (type === 'project' || type === 'projects') {
      setPendingNotification({ entityType: 'project', entityId: autoOpenId });
      handleSetView(projectsHomeView(canAccessModule));
      return;
    }

    if (type === 'course' || type === 'courses') {
      setPendingNotification({ entityType: 'course', entityId: autoOpenId });
      handleSetView('apex');
      return;
    }

    if (type === 'time_log' || type === 'time_tracking') {
      setPendingNotification(null);
      handleSetView('planning');
      return;
    }

    if (type === 'leave_request' || type === 'leave' || type === 'leave_management') {
      setPendingNotification(null);
      handleSetView('leave_management');
      return;
    }

    if (type === 'invoice' || type === 'expense' || type === 'budget' || type === 'finance') {
      setPendingNotification(null);
      handleSetView('comptabilite');
      return;
    }

    if (type === 'goal' || type === 'objective') {
      setPendingNotification({ entityType: 'goal', metadata: meta });
      handleSetView('goals_okrs');
      return;
    }

    if (type === 'knowledge' || type === 'document') {
      setPendingNotification(null);
      handleSetView('coya_drive');
      return;
    }

    setPendingNotification(null);
    handleSetView('dashboard');
  }, [handleSetView, canAccessModule]);

  const handleSelectCourse = useCallback((id: string) => {
    setSelectedCourseId(id);
    handleSetView('course_detail');
  }, [handleSetView]);

  const handleOpenProjectWorkspace = useCallback(
    (projectId: string) => {
      const id = String(projectId);
      setSelectedProjectId(id);
      navigateToProjectWorkspace(id);
      handleSetView('project_workspace');
    },
    [handleSetView],
  );

  const handleCloseProjectWorkspace = useCallback(() => {
    handleSetView(projectsHomeView(canAccessModule));
  }, [handleSetView, canAccessModule]);

  const handleOpenEmployeeWorkspace = useCallback(
    (profileId: string) => {
      const id = String(profileId);
      setSelectedEmployeeWorkspaceProfileId(id);
      navigateToEmployeeWorkspace(id);
      handleSetView('employee_workspace');
      requestAnimationFrame(() => {
        try {
          mainScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' });
        } catch {
          /* ignore */
        }
      });
    },
    [handleSetView],
  );

  const handleCloseEmployeeWorkspace = useCallback(() => {
    handleSetView('rh');
  }, [handleSetView]);

  useEffect(() => {
    const onPopState = () => {
      const eid = getEmployeeProfileIdFromUrl();
      if (eid) {
        setSelectedEmployeeWorkspaceProfileId(eid);
        setSelectedProjectId(null);
        setCurrentView('employee_workspace');
        return;
      }
      const pid = getProjectIdFromUrl();
      if (pid) {
        setSelectedProjectId(pid);
        setSelectedEmployeeWorkspaceProfileId(null);
        setCurrentView('project_workspace');
        return;
      }
      setSelectedProjectId(null);
      setSelectedEmployeeWorkspaceProfileId(null);
      setCurrentView((prev) => {
        if (prev === 'project_workspace') return projectsHomeView(canAccessModule);
        if (prev === 'employee_workspace') return 'rh';
        return prev;
      });
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [canAccessModule]);

  useEffect(() => {
    if (!pendingNotification) return;
    if (pendingNotification.entityType !== 'course') return;
    if (!pendingNotification.entityId) return;

    const targetId = String(pendingNotification.entityId);
    const courseExists = courses.some(course => String(course.id) === targetId);

    if (courseExists) {
      handleSelectCourse(targetId);
      handleNotificationHandled();
    }
  }, [pendingNotification, courses, handleSelectCourse, handleNotificationHandled]);

  // Initialisation simple
  useEffect(() => {
    const startTime = Date.now();
    logger.info('auth', '🔄 Initialisation de l\'application');
    logger.debug('session', `Initial view from localStorage: ${savedView}, using: ${validInitialView}`);
    
    setIsInitialized(true);
    logger.logPerformance('App initialization', Date.now() - startTime);
  }, []);

  // Charger les données après initialisation - Logique robuste avec parallélisation
  useEffect(() => {
    if (!isInitialized) return; // Attendre l'initialisation seulement
    
    const loadData = async () => {
      // Réinitialiser isDataLoaded à false au début du chargement (important pour le refresh)
      setIsDataLoaded(false);
      // Réinitialiser la progression
      setLoadingProgress({ current: 0, total: 15, loaded: [] });
      
      try {
        if (user) {
          console.log('🔄 Chargement optimisé en deux phases depuis Supabase...');
          const startTime = Date.now();
          
          // Réinitialiser la progression
          setLoadingProgress({ current: 0, total: 15, loaded: [] });
          
          // Fonction helper pour mettre à jour la progression
          const updateProgress = (label: string, success: boolean, duration?: number) => {
            if (duration !== undefined) {
              const rounded = Math.round(duration);
              const message = `${label} ${success ? 'chargé' : 'en échec'} en ${rounded}ms`;
              if (success) {
                if (duration > 2500) {
                  console.warn(`⚠️ [PERF] ${message}`);
                } else {
                  console.log(`⏱️ [PERF] ${message}`);
                }
              } else {
                console.error(`❌ [PERF] ${message}`);
              }
              try {
                logger.logPerformance(label, duration);
              } catch (perfError) {
                console.warn('⚠️ Impossible de logger la performance:', perfError);
              }
            }

            setLoadingProgress(prev => ({
              current: prev.current + 1,
              total: prev.total,
              loaded: [...prev.loaded, label]
            }));
          };

          const fetchWithMetrics = async <T,>(label: string, type: string, fetcher: () => Promise<T>) => {
            const start = performance.now();
            try {
              const data = await fetcher();
              const duration = performance.now() - start;
              updateProgress(label, true, duration);
              return { type, data };
            } catch (error) {
              const duration = performance.now() - start;
              updateProgress(label, false, duration);
              throw error;
            }
          };
          
          // PHASE 1 : Charger les données ESSENTIELLES pour le dashboard (priorité haute)
          // Ces données sont nécessaires pour afficher le dashboard rapidement
          console.log('⚡ Phase 1 : Chargement des données essentielles...');
          const essentialResults = await Promise.allSettled([
            fetchWithMetrics('Utilisateurs', 'users', () => DataAdapter.getUsers()),
            fetchWithMetrics('Projets', 'projects', () => DataAdapter.getProjects()),
            fetchWithMetrics('Time Logs', 'timeLogs', () => DataAdapter.getTimeLogs()),
            fetchWithMetrics('Demandes de congé', 'leaveRequests', () => DataAdapter.getLeaveRequests()),
            fetchWithMetrics('Factures', 'invoices', () => DataAdapter.getInvoices()),
            fetchWithMetrics('Dépenses', 'expenses', () => DataAdapter.getExpenses())
          ]);
          
          const essentialTypes = ['users', 'projects', 'timeLogs', 'leaveRequests', 'invoices', 'expenses'];
          const essentialDataMap: Record<string, any> = {};
          const essentialErrors: Array<{ type: string; error: any }> = [];

          essentialResults.forEach((result, index) => {
            const type = essentialTypes[index];
            if (result.status === 'fulfilled') {
              essentialDataMap[type] = result.value.data;
        } else {
              essentialDataMap[type] = null;
              const error = result.reason;
              essentialErrors.push({ type, error });
              console.error(`❌ Erreur chargement ${type}:`, error);
              if (error?.name === 'AbortError' || error?.message?.includes('timeout') || error?.message?.includes('aborted')) {
                console.warn(`⏱️ Timeout sur ${type} - Continuation avec tableau vide`);
              }
            }
          });

          const projectData = Array.isArray(essentialDataMap['projects']) ? essentialDataMap['projects'] : [];
          const currentAllowedProjectIds = updateProjects(projectData);

          const usersData = Array.isArray(essentialDataMap['users']) ? essentialDataMap['users'] : [];
          setUsers(usersData);

          const timeLogsData = Array.isArray(essentialDataMap['timeLogs']) ? essentialDataMap['timeLogs'] : [];
          updateTimeLogs(timeLogsData, currentAllowedProjectIds);

          const leaveRequestsData = Array.isArray(essentialDataMap['leaveRequests']) ? essentialDataMap['leaveRequests'] : [];
          setLeaveRequests(leaveRequestsData);

          const invoicesData = Array.isArray(essentialDataMap['invoices']) ? essentialDataMap['invoices'] : [];
          console.log('📥 App.loadData - Factures chargées depuis Supabase:', {
            count: invoicesData.length,
            statuses: [...new Set(invoicesData.map((inv: any) => inv.status))],
            partiallyPaidCount: invoicesData.filter((inv: any) => inv.status === 'Partially Paid').length,
            sample: invoicesData.slice(0, 3).map((inv: any) => ({ id: inv.id, status: inv.status, invoiceNumber: inv.invoiceNumber, paidAmount: inv.paidAmount }))
          });
          setInvoices(invoicesData);

          if (essentialErrors.some(err => err.type === 'invoices')) {
            console.warn('⚠️ Les factures n\'ont pas pu être chargées depuis Supabase. Utilisation d\'un tableau vide.');
          }

          const expensesData = Array.isArray(essentialDataMap['expenses']) ? essentialDataMap['expenses'] : [];
          setExpenses(expensesData);

          // Autoriser l'affichage du dashboard dès que les données essentielles sont chargées
          const essentialDuration = Date.now() - startTime;
          const essentialSuccessCount = essentialResults.filter(r => r.status === 'fulfilled').length;
          const essentialErrorCount = essentialResults.filter(r => r.status === 'rejected').length;
          
          setIsDataLoaded(true);
          logger.logPerformance('Data loading (essential)', essentialDuration);
          console.log(`✅ Phase 1 terminée en ${essentialDuration}ms: ${essentialSuccessCount} succès, ${essentialErrorCount} erreurs - Dashboard disponible`);
          
          // PHASE 2 : Charger les données secondaires en arrière-plan (non bloquant)
          // Ces données sont moins critiques et peuvent être chargées après l'affichage du dashboard
          // Capturer essentialDuration dans une constante pour le callback
          const capturedEssentialDuration = essentialDuration;
          console.log('🔄 Phase 2 : Chargement des données secondaires en arrière-plan...');
          Promise.allSettled([
            fetchWithMetrics('Objectifs', 'objectives', () => DataAdapter.getObjectives()),
            fetchWithMetrics('Meetings', 'meetings', () => DataAdapter.getMeetings()),
            fetchWithMetrics('Factures récurrentes', 'recurringInvoices', () => DataAdapter.getRecurringInvoices()),
            fetchWithMetrics('Dépenses récurrentes', 'recurringExpenses', () => DataAdapter.getRecurringExpenses()),
            fetchWithMetrics('Budgets', 'budgets', () => DataAdapter.getBudgets()),
            fetchWithMetrics('Documents', 'documents', () => DataAdapter.getDocuments()),
            fetchWithMetrics('Contacts', 'contacts', () => DataAdapter.getContacts()),
            fetchWithMetrics('Formations', 'courses', () => DataAdapter.getCourses()),
            fetchWithMetrics('Emplois', 'jobs', () => DataAdapter.getJobs())
          ]).then(secondaryResults => {
            // Traiter les résultats secondaires
            secondaryResults.forEach((result) => {
              if (result.status === 'fulfilled') {
                const { type, data } = result.value;
                switch (type) {
                  case 'objectives': updateObjectives(Array.isArray(data) ? data : [], currentAllowedProjectIds); break;
                  case 'meetings': updateMeetings(Array.isArray(data) ? data : []); break;
                  case 'recurringInvoices': setRecurringInvoices(Array.isArray(data) ? data : []); break;
                  case 'recurringExpenses': setRecurringExpenses(Array.isArray(data) ? data : []); break;
                  case 'budgets': setBudgets(Array.isArray(data) ? data : []); break;
                  case 'documents': setDocuments(Array.isArray(data) ? data : []); break;
                  case 'contacts': setContacts(Array.isArray(data) ? data : []); break;
                  case 'courses': setCourses(Array.isArray(data) ? data : []); break;
                  case 'jobs': setJobs(Array.isArray(data) ? data : []); break;
                }
              } else {
                // En cas d'erreur, initialiser avec tableau vide
                const types = ['objectives', 'meetings', 'recurringInvoices', 'recurringExpenses', 'budgets', 'documents', 'contacts', 'courses', 'jobs'];
                const index = secondaryResults.indexOf(result);
                const type = types[index];
                switch (type) {
                  case 'objectives': updateObjectives([], currentAllowedProjectIds); break;
                  case 'meetings': updateMeetings([]); break;
                  case 'recurringInvoices': setRecurringInvoices([]); break;
                  case 'recurringExpenses': setRecurringExpenses([]); break;
                  case 'budgets': setBudgets([]); break;
                  case 'documents': setDocuments([]); break;
                  case 'contacts': setContacts([]); break;
                  case 'courses': setCourses([]); break;
                  case 'jobs': setJobs([]); break;
                }
              }
            });
            
            const totalDuration = Date.now() - startTime;
            const secondarySuccessCount = secondaryResults.filter(r => r.status === 'fulfilled').length;
            const secondaryErrorCount = secondaryResults.filter(r => r.status === 'rejected').length;
            logger.logPerformance('Data loading (total)', totalDuration);
            console.log(`✅ Phase 2 terminée: ${secondarySuccessCount} succès, ${secondaryErrorCount} erreurs`);
            console.log(`✅ Toutes les données chargées en ${totalDuration}ms (essentiel: ${capturedEssentialDuration}ms)`);
          });
        } else {
          console.log('🔄 Utilisateur non connecté - réinitialisation des données');
          setLoadingProgress({ current: 0, total: 15, loaded: [] });
          updateProjects([]);
          setObjectives([]);
          setUsers([]);
          setTimeLogs([]);
          setMeetings([]);
          setLeaveRequests([]);
          setInvoices([]);
          setExpenses([]);
          setRecurringInvoices([]);
          setRecurringExpenses([]);
          setBudgets([]);
          setDocuments([]);
          setCourses([]);
          setJobs([]);
          setContacts([]);
        }
        
        setIsDataLoaded(true);
      } catch (error) {
        console.error('❌ Erreur globale chargement données:', error);
        // En cas d'erreur globale, initialiser tous les états avec des tableaux vides
        setLoadingProgress({ current: 0, total: 15, loaded: [] });
        updateProjects([]);
        setObjectives([]);
        setUsers([]);
        setTimeLogs([]);
        setMeetings([]);
        setLeaveRequests([]);
        setInvoices([]);
        setExpenses([]);
        setRecurringInvoices([]);
        setRecurringExpenses([]);
        setBudgets([]);
        setDocuments([]);
        setCourses([]);
        setJobs([]);
        setContacts([]);
        setIsDataLoaded(true);
      }
    };

    // Recharger les données quand user change
    loadData();
  }, [isInitialized, user]); // Retirer isDataLoaded des dépendances

  // Redirection après authentification : première vue autorisée (sinon écran d’attente)
  useEffect(() => {
    if (!isInitialized || !user || authLoading) return;
    if (!(currentView === 'login' || currentView === 'signup')) return;
    if (permissionsLoading) return;

    const landing =
      user.role === 'super_administrator' ? 'dashboard' : getFirstAccessibleView(canAccessModule);
    logger.logNavigation(currentView, landing, 'User authenticated');
    logger.info('auth', `Redirigé vers ${landing} après authentification`);
    handleSetView(landing);
  }, [user, isInitialized, currentView, handleSetView, permissionsLoading, canAccessModule, authLoading]);

  // Garde : vue courante non autorisée → première vue accessible
  useEffect(() => {
    if (!isInitialized || !user || authLoading) return;
    if (permissionsLoading) return;
    if (currentView === 'login' || currentView === 'signup' || currentView === 'pending_access') return;
    if (user.role === 'super_administrator') return;

    if (currentView === 'programmes_projects') {
      const ok = canAccessModule('programme') || canAccessModule('projects');
      if (!ok) {
        const landing = getFirstAccessibleView(canAccessModule);
        logger.logNavigation(currentView, landing, 'Programmes projects shell access denied — redirect');
        handleSetView(landing);
      }
      return;
    }

    if (currentView === 'demande_mobilite') {
      const ok = canAccessModule('parc_auto') || canAccessModule('logistique');
      if (!ok) {
        const landing = getFirstAccessibleView(canAccessModule);
        logger.logNavigation(currentView, landing, 'Mobility hub access denied — redirect');
        handleSetView(landing);
      }
      return;
    }

    const mod = viewNameToModuleName(currentView);
    if (mod && !canAccessModule(mod)) {
      const landing = getFirstAccessibleView(canAccessModule);
      logger.logNavigation(currentView, landing, 'Module access denied — redirect');
      handleSetView(landing);
    }
  }, [user, isInitialized, authLoading, permissionsLoading, currentView, canAccessModule, handleSetView]);

  // Protection de routes - rediriger vers login si non authentifié
  useEffect(() => {
    if (!isInitialized) return;
    if (authLoading) return; // Attendre que l'authentification soit chargée
    
    // Rediriger vers login seulement si l'utilisateur n'est pas connecté ET qu'on n'est pas déjà sur login/signup
    if (!user && currentView !== 'login' && currentView !== 'signup') {
        if (verboseLogs()) console.log('🔒 Protection route - redirection vers login');
      logger.logNavigation(currentView, 'login', 'Not authenticated - route protection');
        setCurrentView('login');
      setIsDataLoaded(false);
      }
  }, [user, isInitialized, currentView, authLoading]);

  // Ancien useEffect supprimé - maintenant géré par le useEffect unifié ci-dessus
  
    // --- Recurring Item Generation ---
    useEffect(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const newInvoices: Invoice[] = [];
        const updatedRecurringInvoices = recurringInvoices.map(ri => {
            const lastGen = new Date(ri.lastGeneratedDate);
            const nextGen = new Date(lastGen);
            if (ri.frequency === 'Monthly') nextGen.setMonth(nextGen.getMonth() + 1);
            else if (ri.frequency === 'Quarterly') nextGen.setMonth(nextGen.getMonth() + 3);
            else if (ri.frequency === 'Annually') nextGen.setFullYear(nextGen.getFullYear() + 1);

            if (today >= nextGen && (!ri.endDate || today <= new Date(ri.endDate))) {
                newInvoices.push({
                    id: `${Date.now()}-${Math.random()}`,
                    invoiceNumber: `INV-${Date.now().toString().slice(-5)}`,
                    clientName: ri.clientName,
                    amount: ri.amount,
                    dueDate: nextGen.toISOString().split('T')[0],
                    status: 'Sent',
                    recurringSourceId: ri.id,
                });
                return { ...ri, lastGeneratedDate: today.toISOString().split('T')[0] };
            }
            return ri;
        });

        if (newInvoices.length > 0) {
            setInvoices(prev => [...prev, ...newInvoices]);
            setRecurringInvoices(updatedRecurringInvoices);
        }

        const newExpenses: Expense[] = [];
        const updatedRecurringExpenses = recurringExpenses.map(re => {
            const lastGen = new Date(re.lastGeneratedDate);
            const nextGen = new Date(lastGen);
            if (re.frequency === 'Monthly') nextGen.setMonth(nextGen.getMonth() + 1);
            else if (re.frequency === 'Quarterly') nextGen.setMonth(nextGen.getMonth() + 3);
            else if (re.frequency === 'Annually') nextGen.setFullYear(nextGen.getFullYear() + 1);

            if (today >= nextGen && (!re.endDate || today <= new Date(re.endDate))) {
                 newExpenses.push({
                    id: `${Date.now()}-${Math.random()}`,
                    category: re.category,
                    description: re.description,
                    amount: re.amount,
                    date: today.toISOString().split('T')[0],
                    dueDate: nextGen.toISOString().split('T')[0],
                    status: 'Unpaid',
                    recurringSourceId: re.id,
                });
                return { ...re, lastGeneratedDate: today.toISOString().split('T')[0] };
            }
            return re;
        });

        if (newExpenses.length > 0) {
            setExpenses(prev => [...prev, ...newExpenses]);
            setRecurringExpenses(updatedRecurringExpenses);
        }

    }, []); // Run only on app load


  // --- Notification Generation ---
  useEffect(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newNotifications: AppNotification[] = [];

    invoices.forEach(inv => {
        if (inv.status === 'Paid') return;
        const dueDate = new Date(inv.dueDate);
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= reminderDays) {
            newNotifications.push({
                id: `inv-${inv.id}`,
                message: t('invoice_due_reminder').replace('{invoiceNumber}', inv.invoiceNumber).replace('{dueDate}', inv.dueDate),
                date: inv.dueDate,
                entityType: 'invoice',
                entityId: inv.id,
                isRead: false
            });
        }
    });

    expenses.forEach(exp => {
        if (!exp.dueDate) return;
        const dueDate = new Date(exp.dueDate);
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays >= 0 && diffDays <= reminderDays) {
            newNotifications.push({
                id: `exp-${exp.id}`,
                message: t('expense_due_reminder').replace('{description}', exp.description).replace('{dueDate}', exp.dueDate),
                date: exp.dueDate,
                entityType: 'expense',
                entityId: exp.id,
                isRead: false
            });
        }
    });

    setNotifications(newNotifications.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime()));

  }, [invoices, expenses, reminderDays, t]);

  // Charger la configuration du module projet (seuils d'alertes, gel auto, etc.)
  useEffect(() => {
    if (!user?.id) return;
    let isCancelled = false;
    const loadProjectSettings = async () => {
      try {
        const settings = await DataAdapter.getProjectModuleSettings();
        if (!isCancelled) {
          setProjectModuleSettings(settings);
        }
      } catch (error) {
        console.error('Erreur chargement settings projet:', error);
      }
    };
    loadProjectSettings();
    return () => {
      isCancelled = true;
    };
  }, [user?.id]);

  // Cycle d'automatisation transverse (Projets / Planification / RH / Finance / Programme)
  useEffect(() => {
    if (!isDataLoaded || !user?.id) return;
    if (automationCycleRunningRef.current) return;

    let isCancelled = false;
    const timer = window.setTimeout(async () => {
      if (isCancelled || automationCycleRunningRef.current) return;
      const now = Date.now();
      // Anti-boucle: ce cycle modifie l'état (projects/objectives/...) et peut se relancer immédiatement.
      // On limite volontairement la fréquence pour éviter une tempête de notifications.
      const MIN_AUTOMATION_INTERVAL_MS =
        (typeof import.meta !== 'undefined' && Number((import.meta as any).env?.VITE_WORKFLOW_AUTOMATION_INTERVAL_MS)) ||
        6 * 60 * 60_000; // 6h
      if (now - automationLastRunAtRef.current < MIN_AUTOMATION_INTERVAL_MS) return;
      automationLastRunAtRef.current = now;
      automationCycleRunningRef.current = true;
      try {
        const cycle = runWorkflowCycle({
          projects,
          objectives,
          leaveRequests,
          invoices,
          expenses,
          budgets,
          meetings,
          users,
          settings: projectModuleSettings,
          currentUserId: String(user.profileId || user.id),
        });

        setWorkflowKpis(cycle.kpis);

        if (cycle.updatedProjects.length > 0) {
          updateProjectsWithProducer((prev) => prev.map((project) => {
            const updated = cycle.updatedProjects.find((item) => String(item.id) === String(project.id));
            return updated || project;
          }));
          await Promise.all(
            cycle.updatedProjects.map(async (project) => {
              try {
                await DataAdapter.updateProject(project);
              } catch (error) {
                console.error('Erreur persistance auto projet:', error);
              }
            })
          );
        }

        if (cycle.updatedObjectives.length > 0) {
          setObjectives((prev) => prev.map((objective) => {
            const updated = cycle.updatedObjectives.find((item) => String(item.id) === String(objective.id));
            return updated || objective;
          }));
          await Promise.all(
            cycle.updatedObjectives.map(async (objective) => {
              try {
                await DataAdapter.updateObjective(String(objective.id), objective);
              } catch (error) {
                console.error('Erreur persistance auto objectif:', error);
              }
            })
          );
        }

        if (cycle.updatedInvoices.length > 0) {
          setInvoices((prev) => prev.map((invoice) => {
            const updated = cycle.updatedInvoices.find((item) => String(item.id) === String(invoice.id));
            return updated || invoice;
          }));
          await Promise.all(
            cycle.updatedInvoices.map(async (invoice) => {
              try {
                await DataAdapter.updateInvoice(String(invoice.id), invoice);
              } catch (error) {
                console.error('Erreur persistance auto facture:', error);
              }
            })
          );
        }

        if (cycle.actions.length > 0) {
          const defaultRecipient = String(user.profileId || user.id);
          const deliveries = cycle.actions.flatMap((action) => {
            const recipients = action.targetUserIds.length > 0 ? action.targetUserIds : [defaultRecipient];
            return recipients.map((recipientId) => ({
              userId: recipientId,
              action,
            }));
          });
          // Limite de concurrence : évite des centaines de requêtes profiles/notifications en parallèle (net::ERR_INSUFFICIENT_RESOURCES).
          const notifyConcurrency = 6;
          const DEDUPE_WINDOW_MIN =
            (typeof import.meta !== 'undefined' && Number((import.meta as any).env?.VITE_WORKFLOW_NOTIFICATION_DEDUPE_MINUTES)) ||
            10;
          const DEDUPE_WINDOW_MS = Math.max(1, DEDUPE_WINDOW_MIN) * 60_000;
          // Nettoyage du cache de déduplication (taille bornée)
          for (const [k, ts] of automationSentActionRef.current.entries()) {
            if (now - ts > DEDUPE_WINDOW_MS) automationSentActionRef.current.delete(k);
          }
          for (let i = 0; i < deliveries.length; i += notifyConcurrency) {
            const chunk = deliveries.slice(i, i + notifyConcurrency);
            await Promise.all(
              chunk.map(async ({ userId: recipientId, action }) => {
                try {
                  const persistWorkflowNotifications =
                    typeof import.meta !== 'undefined' &&
                    String((import.meta as any).env?.VITE_PERSIST_WORKFLOW_NOTIFICATIONS || 'false').toLowerCase() === 'true';
                  if (!persistWorkflowNotifications) return;
                  // Dédup forte : même événement workflow + même destinataire (aligné sur workflowEngine.eventId).
                  const actionKey = `${String(recipientId)}::${String(action.eventId)}`;
                  const lastSentAt = automationSentActionRef.current.get(actionKey) ?? 0;
                  if (now - lastSentAt < DEDUPE_WINDOW_MS) return;
                  automationSentActionRef.current.set(actionKey, now);
                  await DataService.createNotification({
                    userId: recipientId,
                    message: action.message,
                    type: action.severity,
                    module: 'workflow',
                    action: 'automate',
                    title: 'Workflow',
                    entityType: action.entityType,
                    entityId: action.entityId,
                    metadata: {
                      source: 'workflow_engine',
                      eventId: action.eventId,
                      workflowModule: action.module,
                      workflowActionType: action.type,
                      ...(action.metadata && typeof action.metadata === 'object' ? action.metadata : {}),
                    },
                    read: false,
                  });
                } catch (error) {
                  console.error('Erreur notification auto workflow:', error);
                }
              })
            );
          }

          try {
            AuditLogService.logAction({
              action: 'automate',
              module: 'workflow',
              entityType: 'workflow_cycle',
              entityId: cycle.kpis.cycleAt,
              actor: user as any,
              metadata: {
                summary: `Cycle automation: ${cycle.actions.length} action(s), ${cycle.updatedProjects.length} projet(s), ${cycle.updatedObjectives.length} objectif(s), ${cycle.updatedInvoices.length} facture(s).`,
                kpis: cycle.kpis,
              },
            });
          } catch (error) {
            console.error('Erreur audit cycle workflow:', error);
          }
        }
      } finally {
        automationCycleRunningRef.current = false;
      }
    }, 350);

    return () => {
      isCancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    isDataLoaded,
    user?.id,
    user?.profileId,
    projects,
    objectives,
    leaveRequests,
    invoices,
    expenses,
    budgets,
    meetings,
    users,
    projectModuleSettings,
    updateProjectsWithProducer,
  ]);

  /** Toujours déclaré ici (avant tout return) pour respecter l’ordre des Hooks. */
  const refreshContactsFromServer = useCallback(async () => {
    try {
      const list = await DataAdapter.getContacts();
      setContacts(Array.isArray(list) ? list : []);
    } catch (e) {
      console.error('refreshContactsFromServer', e);
    }
  }, []);

  const handleRefreshUsers = useCallback(async () => {
    try {
      const fresh = await DataAdapter.getUsers();
      setUsers(fresh);
    } catch (e) {
      console.error('Erreur rechargement utilisateurs:', e);
    }
  }, []);

  // Overlay de chargement unique : initialisation et vérification auth
  if (!isInitialized || (authLoading && !user)) {
    return (
      <LoadingOverlay
        message={t('loading')}
        variant="gradient"
      />
    );
  }

  if (!user) {
    return <Login onLoginSuccess={() => {
      logger.debug('state', 'onLoginSuccess called - status selector or dashboard');
      if (getSkipStatusSelector()) {
        logger.logNavigation('login', 'dashboard', 'Login success (skip status)');
        handleSetView('dashboard');
      } else {
        logger.logNavigation('login', 'status_selector', 'Login success');
        handleSetView('status_selector');
      }
    }} />;
  }

  const userStatus = user?.status || 'active';
  const requestedRole = (user?.pendingRole || user?.role || null) as Role | null;
  const isSuperAdminRequested = requestedRole === 'super_administrator';
  const needsApproval = userStatus === 'pending';
  const requestedRoleLabel = formatRoleLabel(requestedRole);

  if (needsApproval) {
    return (
      <div className="fixed inset-0 z-[100] overflow-hidden font-coya">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(1200px 800px at 20% 20%, rgba(13,122,43,0.22), transparent 55%), radial-gradient(900px 700px at 80% 60%, rgba(244,196,48,0.10), transparent 55%), linear-gradient(180deg, #071018 0%, #0F172A 55%, #071018 100%)',
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(255,255,255,0.45) 1px, transparent 0)',
            backgroundSize: '26px 26px',
          }}
          aria-hidden
        />
        <div className="relative flex min-h-full items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-white/95 p-10 text-center shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-[rgba(13,122,43,0.12)] text-[#0d7a2b] text-3xl">
              <i className="fas fa-hourglass-half" aria-hidden />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Compte en attente de validation</h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              Merci d’avoir rejoint COYA. Votre demande d’accès
              {requestedRoleLabel ? <> au rôle <strong>{requestedRoleLabel}</strong></> : null} est en cours
              d’examen par un administrateur de votre organisation
              {isSuperAdminRequested ? ' (validation réservée à un Super Administrateur)' : ''}. Vous serez notifié(e) dès activation.
            </p>
            <div className="rounded-xl border border-[rgba(13,122,43,0.2)] bg-[rgba(13,122,43,0.06)] p-4 text-left text-sm text-gray-800 space-y-2">
              <div className="flex items-start gap-3">
                <i className="fas fa-user-shield mt-1 text-[#0d7a2b]" aria-hidden />
                <div>
                  <p className="font-semibold">Étapes suivantes</p>
                  <p>
                    Vous pouvez fermer cette page et revenir plus tard. En cas d’urgence, contactez un administrateur
                    {isSuperAdminRequested ? ' ou un Super Administrateur' : ''}.
                  </p>
                </div>
              </div>
            </div>
            <Button type="button" variant="primary" className="w-full sm:w-auto" onClick={handlePendingLogout}>
              Retourner à la page de connexion
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (userStatus === 'rejected') {
    return (
      <div className="fixed inset-0 z-[100] overflow-hidden font-coya">
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(1200px 800px at 20% 20%, rgba(220,38,38,0.12), transparent 55%), linear-gradient(180deg, #071018 0%, #0F172A 55%, #071018 100%)',
          }}
          aria-hidden
        />
        <div className="relative flex min-h-full items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-white/95 p-10 text-center shadow-[0_30px_90px_rgba(0,0,0,0.35)] backdrop-blur-xl space-y-6">
            <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-600 text-3xl">
              <i className="fas fa-user-lock" aria-hidden />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Accès non autorisé</h1>
            <p className="text-sm text-gray-600 leading-relaxed">
              Votre demande d’accès
              {requestedRoleLabel ? <> au rôle <strong>{requestedRoleLabel}</strong></> : null} n’a pas pu être approuvée.
              {user.reviewComment ? <> Motif communiqué : <strong>{user.reviewComment}</strong>.</> : null}
              Veuillez contacter un administrateur pour plus d’informations.
            </p>
            <Button type="button" variant="primary" className="w-full sm:w-auto" onClick={handlePendingLogout}>
              Retour à l’écran de connexion
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Overlay de chargement : données en cours de chargement après login
  if (user && !isDataLoaded) {
    return (
      <LoadingOverlay
        message={t('loading')}
        subMessage={
          loadingProgress.total > 0
            ? `${loadingProgress.current} / ${loadingProgress.total}${loadingProgress.loaded?.length ? ` — ${loadingProgress.loaded[loadingProgress.loaded.length - 1]}` : ''}`
            : undefined
        }
        progress={loadingProgress.total > 0 ? { current: loadingProgress.current, total: loadingProgress.total } : undefined}
        variant="gradient"
      />
    );
  }

  // --- CRUD & State Handlers ---
  
    // NOTIFICATIONS - Gérées par NotificationCenter en temps réel

    // RECURRING INVOICES
  const handleAddRecurringInvoice = async (data: Omit<RecurringInvoice, 'id'>) => {
      try {
        const newRecurringInvoice = await DataAdapter.createRecurringInvoice(data);
        if (newRecurringInvoice) {
          setRecurringInvoices(prev => [newRecurringInvoice, ...prev]);
        if (user) {
          AuditLogService.logAction({
            action: 'create',
            module: 'comptabilite',
            entityType: 'recurring_invoice',
            entityId: newRecurringInvoice.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a créé une facture récurrente (${newRecurringInvoice.clientName || newRecurringInvoice.id})`,
              amount: newRecurringInvoice.amount,
              currency: newRecurringInvoice.currencyCode,
              frequency: newRecurringInvoice.frequency
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur création facture récurrente:', error);
      }
    };
  const handleUpdateRecurringInvoice = async (updated: RecurringInvoice) => {
    const previous = recurringInvoices.find(i => i.id === updated.id);
      try {
        const result = await DataAdapter.updateRecurringInvoice(updated.id, updated);
        if (result) {
          setRecurringInvoices(prev => prev.map(i => i.id === updated.id ? result : i));
        if (user) {
          const diff = previous
            ? buildDiff(previous, result, ['clientName', 'amount', 'currencyCode', 'frequency', 'lastGeneratedDate'])
            : undefined;
          AuditLogService.logAction({
            action: 'update',
            module: 'comptabilite',
            entityType: 'recurring_invoice',
            entityId: result.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a modifié une facture récurrente (${result.clientName || result.id})`,
              diff
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur mise à jour facture récurrente:', error);
      }
    };
  const handleDeleteRecurringInvoice = async (id: string) => {
    const invoiceToDelete = recurringInvoices.find(i => i.id === id);
      try {
        const success = await DataAdapter.deleteRecurringInvoice(id);
        if (success) {
          setRecurringInvoices(prev => prev.filter(i => i.id !== id));
        if (user && invoiceToDelete) {
          AuditLogService.logAction({
            action: 'delete',
            module: 'comptabilite',
            entityType: 'recurring_invoice',
            entityId: id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a supprimé une facture récurrente (${invoiceToDelete.clientName || invoiceToDelete.id})`,
              amount: invoiceToDelete.amount,
              currency: invoiceToDelete.currencyCode
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur suppression facture récurrente:', error);
      }
    };

    // RECURRING EXPENSES
  const handleAddRecurringExpense = async (data: Omit<RecurringExpense, 'id'>) => {
      try {
        const newRecurringExpense = await DataAdapter.createRecurringExpense(data);
        if (newRecurringExpense) {
          setRecurringExpenses(prev => [newRecurringExpense, ...prev]);
        if (user) {
          AuditLogService.logAction({
            action: 'create',
            module: 'comptabilite',
            entityType: 'recurring_expense',
            entityId: newRecurringExpense.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a créé une dépense récurrente (${newRecurringExpense.description || newRecurringExpense.id})`,
              amount: newRecurringExpense.amount,
              currency: newRecurringExpense.currencyCode,
              frequency: newRecurringExpense.frequency
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur création dépense récurrente:', error);
      }
    };
  const handleUpdateRecurringExpense = async (updated: RecurringExpense) => {
    const previous = recurringExpenses.find(e => e.id === updated.id);
      try {
        const result = await DataAdapter.updateRecurringExpense(updated.id, updated);
        if (result) {
          setRecurringExpenses(prev => prev.map(e => e.id === updated.id ? result : e));
        if (user) {
          const diff = previous
            ? buildDiff(previous, result, ['description', 'amount', 'currencyCode', 'frequency', 'lastGeneratedDate'])
            : undefined;
          AuditLogService.logAction({
            action: 'update',
            module: 'comptabilite',
            entityType: 'recurring_expense',
            entityId: result.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a modifié une dépense récurrente (${result.description || result.id})`,
              diff
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur mise à jour dépense récurrente:', error);
      }
    };
  const handleDeleteRecurringExpense = async (id: string) => {
    const expenseToDelete = recurringExpenses.find(e => e.id === id);
      try {
        const success = await DataAdapter.deleteRecurringExpense(id);
        if (success) {
          setRecurringExpenses(prev => prev.filter(e => e.id !== id));
        if (user && expenseToDelete) {
          AuditLogService.logAction({
            action: 'delete',
            module: 'comptabilite',
            entityType: 'recurring_expense',
            entityId: id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a supprimé une dépense récurrente (${expenseToDelete.description || expenseToDelete.id})`,
              amount: expenseToDelete.amount,
              currency: expenseToDelete.currencyCode
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur suppression dépense récurrente:', error);
      }
    };


  // INVOICES
  const handleAddInvoice = async (invoiceData: Omit<Invoice, 'id'>) => {
    try {
      console.log('🔄 App.handleAddInvoice - Création facture:', {
        status: invoiceData.status,
        paidAmount: invoiceData.paidAmount,
        amount: invoiceData.amount,
        invoiceNumber: invoiceData.invoiceNumber
      });
      
      const newInvoice = await DataAdapter.createInvoice(invoiceData);
      
      console.log('📊 App.handleAddInvoice - Facture créée (retour DataAdapter):', {
        invoice: newInvoice,
        status: newInvoice?.status,
        paidAmount: newInvoice?.paidAmount,
        id: newInvoice?.id
      });
      
      if (newInvoice) {
        console.log('✅ App.handleAddInvoice - Ajout à l\'état local');
        setInvoices(prev => {
          const updated = [newInvoice, ...prev];
          console.log('📋 App.handleAddInvoice - État invoices après ajout:', {
            total: updated.length,
            newInvoiceIncluded: updated.find(inv => inv.id === newInvoice.id),
            allStatuses: updated.map(inv => inv.status),
            partiallyPaidCount: updated.filter(inv => inv.status === 'Partially Paid').length
          });
          return updated;
        });
        
        // Notifier la création de la facture
        if (user) {
          NotificationHelper.notifyInvoiceCreated(newInvoice, user as any).catch(err => {
            console.error('Erreur notification facture créée:', err);
          });
          AuditLogService.logAction({
            action: 'create',
            module: 'comptabilite',
            entityType: 'invoice',
            entityId: newInvoice.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a créé la facture ${newInvoice.invoiceNumber || newInvoice.id}`,
              amount: newInvoice.amount,
              currency: newInvoice.currencyCode,
              transactionDate: newInvoice.transactionDate
            }
          });
        }

        // Pont factures → comptabilité (émission immédiate si statut déjà engagé).
        emitInvoiceAccountingEvent(newInvoice);
      } else {
        console.error('❌ App.handleAddInvoice - newInvoice est null');
        // Recharger depuis Supabase au cas où
        const allInvoices = await DataAdapter.getInvoices();
        setInvoices(allInvoices);
        console.log('🔄 App.handleAddInvoice - Factures rechargées depuis Supabase:', allInvoices.length);
      }
    } catch (error: any) {
      console.error('❌ Erreur création facture:', error);
      
      // Détecter l'erreur de contrainte CHECK et relancer pour affichage à l'utilisateur
      if (error?.code === '23514' || error?.message?.includes('check constraint') || error?.message?.includes('invoices_status_check')) {
        // Erreur de contrainte CHECK côté base (statut / paiement partiel)
        throw error;
      }
      
      // Recharger depuis Supabase en cas d'erreur autre
      try {
        const allInvoices = await DataAdapter.getInvoices();
        setInvoices(allInvoices);
      } catch (reloadError) {
        console.error('❌ Erreur rechargement factures:', reloadError);
      }
    }
  };
    const handleUpdateInvoice = async (updatedInvoice: Invoice) => {
      try {
        const oldInvoice = invoices.find(i => i.id === updatedInvoice.id);
        const result = await DataAdapter.updateInvoice(updatedInvoice.id, updatedInvoice);
        if (result) {
          setInvoices(prev => prev.map(i => i.id === updatedInvoice.id ? result : i));
          
          // Notifier si la facture est passée à "Payé"
          if (oldInvoice && oldInvoice.status !== 'Paid' && result.status === 'Paid' && user) {
            NotificationHelper.notifyInvoicePaid(result, user as any).catch(err => {
              console.error('Erreur notification facture payée:', err);
            });
          }

          // Pont factures → comptabilité sur transition vers un statut engagé.
          if (!oldInvoice || oldInvoice.status !== result.status) {
            emitInvoiceAccountingEvent(result);
          }

          if (user) {
            const diff = oldInvoice
              ? buildDiff(oldInvoice, result, ['status', 'amount', 'currencyCode', 'paidAmount', 'dueDate', 'transactionDate'])
              : undefined;
            AuditLogService.logAction({
              action: 'update',
              module: 'comptabilite',
              entityType: 'invoice',
              entityId: result.id,
              actor: user as any,
              metadata: {
                summary: `${user.name} a mis à jour la facture ${result.invoiceNumber || result.id}`,
                diff
              }
            });
          }
        }
      } catch (error) {
        console.error('Erreur mise à jour facture:', error);
      }
    };
    const handleDeleteInvoice = async (invoiceId: string) => {
      const invoiceToDelete = invoices.find(i => i.id === invoiceId);
      try {
        const success = await DataAdapter.deleteInvoice(invoiceId);
        if (success) {
        setInvoices(prev => prev.filter(i => i.id !== invoiceId));
        if (user && invoiceToDelete) {
          AuditLogService.logAction({
            action: 'delete',
            module: 'comptabilite',
            entityType: 'invoice',
            entityId: invoiceId,
            actor: user as any,
            metadata: {
              summary: `${user.name} a supprimé la facture ${invoiceToDelete.invoiceNumber || invoiceToDelete.id}`,
              amount: invoiceToDelete.amount,
              currency: invoiceToDelete.currencyCode
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur suppression facture:', error);
      }
    };

  // EXPENSES
  const handleAddExpense = async (expenseData: Omit<Expense, 'id'>) => {
    try {
      const newExpense = await DataAdapter.createExpense(expenseData);
      if (newExpense) {
        setExpenses(prev => [newExpense, ...prev]);
        // Pont dépenses → comptabilité (uniquement si déjà payée).
        emitExpenseAccountingEvent(newExpense);
        if (user) {
          AuditLogService.logAction({
            action: 'create',
            module: 'comptabilite',
            entityType: 'expense',
            entityId: newExpense.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a enregistré une dépense ${newExpense.description || newExpense.category || newExpense.id}`,
              amount: newExpense.amount,
              currency: newExpense.currencyCode,
              transactionDate: newExpense.transactionDate
            }
          });
        }
      }
    } catch (error) {
      console.error('Erreur création dépense:', error);
      // Pas de fallback mocké - uniquement Supabase
    }
  };
    const handleUpdateExpense = async (updatedExpense: Expense) => {
      const previousExpense = expenses.find(e => e.id === updatedExpense.id);
      try {
        const result = await DataAdapter.updateExpense(updatedExpense.id, updatedExpense);
        if (result) {
          setExpenses(prev => prev.map(e => e.id === updatedExpense.id ? result : e));
          // Pont dépenses → comptabilité sur transition vers "Payé".
          if (previousExpense && previousExpense.status !== 'Paid' && result.status === 'Paid') {
            emitExpenseAccountingEvent(result);
          }
          if (user) {
            const diff = previousExpense
              ? buildDiff(previousExpense, result, ['amount', 'currencyCode', 'category', 'transactionDate', 'status'])
              : undefined;
            AuditLogService.logAction({
              action: 'update',
              module: 'comptabilite',
              entityType: 'expense',
              entityId: result.id,
              actor: user as any,
              metadata: {
                summary: `${user.name} a modifié une dépense ${result.description || result.category || result.id}`,
                diff
              }
            });
          }
        }
      } catch (error) {
        console.error('Erreur mise à jour dépense:', error);
      }
    };
    const handleDeleteExpense = async (expenseId: string) => {
      const expenseToDelete = expenses.find(e => e.id === expenseId);
      try {
        const success = await DataAdapter.deleteExpense(expenseId);
        if (success) {
        setExpenses(prev => prev.filter(e => e.id !== expenseId));
        if (user && expenseToDelete) {
          AuditLogService.logAction({
            action: 'delete',
            module: 'comptabilite',
            entityType: 'expense',
            entityId: expenseId,
            actor: user as any,
            metadata: {
              summary: `${user.name} a supprimé une dépense ${expenseToDelete.vendor || expenseToDelete.id}`,
              amount: expenseToDelete.amount,
              currency: expenseToDelete.currencyCode
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur suppression dépense:', error);
      }
    };
    
    // BUDGETS
    const handleAddBudget = async (budgetData: Omit<Budget, 'id'>) => {
      try {
        const newBudget = await DataAdapter.createBudget(budgetData);
        if (newBudget) {
        setBudgets(prev => [newBudget, ...prev]);
        if (user) {
          AuditLogService.logAction({
            action: 'create',
            module: 'comptabilite',
            entityType: 'budget',
            entityId: newBudget.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a créé le budget "${newBudget.title}"`,
              amount: newBudget.amount,
              currency: newBudget.currencyCode
            }
          });
        }
        }
      } catch (error) {
        console.error('Erreur création budget:', error);
      }
    };
    const handleUpdateBudget = async (updatedBudget: Budget) => {
      const previousBudget = budgets.find(b => b.id === updatedBudget.id);
      try {
        const result = await DataAdapter.updateBudget(updatedBudget.id, updatedBudget);
        if (result) {
          setBudgets(prev => prev.map(b => b.id === updatedBudget.id ? result : b));
          if (user) {
            const diff = previousBudget
              ? buildDiff(previousBudget, updatedBudget, ['title', 'type', 'amount', 'startDate', 'endDate'])
              : undefined;
            AuditLogService.logAction({
              action: 'update',
              module: 'comptabilite',
              entityType: 'budget',
              entityId: updatedBudget.id,
              actor: user as any,
              metadata: {
                summary: `${user.name} a modifié le budget "${updatedBudget.title}"`,
                diff
              }
            });
          }
        }
      } catch (error) {
        console.error('Erreur mise à jour budget:', error);
      }
    };
    const handleDeleteBudget = async (budgetId: string) => {
      const budgetToDelete = budgets.find(b => b.id === budgetId);
      try {
        const success = await DataAdapter.deleteBudget(budgetId);
        if (success) {
          setBudgets(prev => prev.filter(b => b.id !== budgetId));
          // Unlink expenses from deleted budget items
          if (budgetToDelete) {
            const itemIdsToDelete = new Set<string>();
            budgetToDelete.budgetLines.forEach(line => {
              line.items.forEach(item => {
                itemIdsToDelete.add(item.id);
              });
            });

            // Unlink expenses from the deleted budget items
            setExpenses(prev => prev.map(e => 
              e.budgetItemId && itemIdsToDelete.has(e.budgetItemId) 
                ? { ...e, budgetItemId: undefined } 
                : e
            ));

            if (user) {
              AuditLogService.logAction({
                action: 'delete',
                module: 'comptabilite',
                entityType: 'budget',
                entityId: budgetId,
                actor: user as any,
                metadata: {
                  summary: `${user.name} a supprimé le budget "${budgetToDelete.title}"`,
                  amount: budgetToDelete.amount,
                  currency: budgetToDelete.currencyCode
                }
              });
            }
          }
        }
      } catch (error) {
        console.error('Erreur suppression budget:', error);
      }
    };

  // MEETINGS
  const handleAddMeeting = async (meetingData: Omit<Meeting, 'id'>) => {
    try {
      console.log('🔄 Création meeting avec données:', meetingData);
      const newMeeting = await DataAdapter.createMeeting(meetingData);
      updateMeetingsWithProducer(prev => {
        const updated = [newMeeting, ...prev];
        return updated.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      });
      console.log('✅ Meeting créé:', newMeeting.id);
      NotificationHelper.notifyMeetingScheduled(newMeeting, user as any).catch(err => {
        console.warn('Notification meeting', err);
      });
      AuditLogService.logAction({
        action: 'create',
        module: 'planning',
        entityType: 'meeting',
        entityId: newMeeting.id as string,
        actor: user as any,
        metadata: {
          summary: `${user?.name || 'Utilisateur'} a planifié "${newMeeting.title}"`
        }
      });
    } catch (error) {
      console.error('Erreur création meeting:', error);
    }
  };
  
  const handleUpdateMeeting = async (updatedMeeting: Meeting) => {
    try {
      console.log('🔄 Mise à jour meeting avec données:', updatedMeeting);
      const updated = await DataAdapter.updateMeeting(updatedMeeting);
      updateMeetingsWithProducer(prev => {
        const mapped = prev.map(m => m.id === updated.id ? updated : m);
        return mapped.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      });
      console.log('✅ Meeting mis à jour avec succès');
      if (user) {
        AuditLogService.logAction({
          action: 'update',
          module: 'planning',
          entityType: 'meeting',
          entityId: updated.id as string,
          actor: user as any,
          metadata: {
            summary: `${user.name} a modifié la réunion "${updated.title}"`,
            newDate: updated.startTime
          }
        });
      }
    } catch (error) {
      console.error('Erreur mise à jour meeting:', error);
    }
  };
  
  const handleDeleteMeeting = async (meetingId: string | number) => {
    try {
      console.log('🔄 Suppression meeting ID:', meetingId);
      await DataAdapter.deleteMeeting(String(meetingId));
      updateMeetingsWithProducer(prev => prev.filter(m => String(m.id) !== String(meetingId)));
      console.log('✅ Meeting supprimé avec succès');
      if (user) {
        AuditLogService.logAction({
          action: 'delete',
          module: 'planning',
          entityType: 'meeting',
          entityId: String(meetingId),
          actor: user as any,
          metadata: {
            summary: `${user.name} a supprimé une réunion`
          }
        });
      }
    } catch (error) {
      console.error('Erreur suppression meeting:', error);
    }
  };


  // LEAVE REQUESTS
  const handleAddLeaveRequest = async (requestData: Omit<LeaveRequest, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'>) => {
    if (!user) return;
    try {
      console.log('🔄 Création demande de congé avec données:', requestData);
      const newRequest = await DataAdapter.createLeaveRequest(requestData);
    setLeaveRequests(prev => [newRequest, ...prev]);
      console.log('✅ Demande de congé créée:', newRequest.id);
      AuditLogService.logAction({
        action: 'create',
        module: 'leave',
        entityType: 'leave_request',
        entityId: newRequest.id,
        actor: user as any,
        metadata: {
          summary: `${user.name} a soumis une demande de congé du ${newRequest.startDate} au ${newRequest.endDate}`,
          status: newRequest.status
        }
      });
    } catch (error) {
      console.error('❌ Erreur création demande de congé:', error);
      throw error;
    }
  };

  const handleUpdateLeaveRequest = async (id: string, status: 'approved' | 'rejected', reason?: string) => {
    try {
      console.log('🔄 Mise à jour demande de congé ID:', id, 'Statut:', status, 'Motif:', reason);
      const oldRequest = leaveRequests.find(r => r.id === id);
      const updates: any = { status };
      if (status === 'approved' && reason) {
        updates.approvalReason = reason;
      } else if (status === 'rejected' && reason) {
        updates.rejectionReason = reason;
      }
      const updatedRequest = await DataAdapter.updateLeaveRequest(id, updates);
      setLeaveRequests(prev => prev.map(req => req.id === id ? updatedRequest : req));
      console.log('✅ Demande de congé mise à jour');
      
      // Notifier le demandeur de l'approbation/rejet
      if (oldRequest && oldRequest.status !== status && user) {
        NotificationHelper.notifyLeaveRequestStatus(updatedRequest, status, user as any).catch(err => {
          console.error('Erreur notification demande congé:', err);
        });
      }
      if (user) {
        const diff = oldRequest ? buildDiff(oldRequest, updatedRequest, ['status', 'approvalReason', 'rejectionReason']) : undefined;
        AuditLogService.logAction({
          action: 'update',
          module: 'leave',
          entityType: 'leave_request',
          entityId: id,
          actor: user as any,
          metadata: {
            summary: `${user.name} a ${status === 'approved' ? 'approuvé' : 'rejeté'} une demande de congé`,
            diff
          }
        });
      }
    } catch (error) {
      console.error('❌ Erreur mise à jour demande de congé:', error);
      throw error;
    }
  };

  const handleDeleteLeaveRequest = async (id: string) => {
    const requestToDelete = leaveRequests.find(req => req.id === id);
    try {
      console.log('🔄 Suppression demande de congé ID:', id);
      await DataAdapter.deleteLeaveRequest(id);
      setLeaveRequests(prev => prev.filter(req => req.id !== id));
      console.log('✅ Demande de congé supprimée');
      if (user && requestToDelete) {
        AuditLogService.logAction({
          action: 'delete',
          module: 'leave',
          entityType: 'leave_request',
          entityId: id,
          actor: user as any,
          metadata: {
            summary: `${user.name} a supprimé une demande de congé`,
            dates: `${requestToDelete.startDate} → ${requestToDelete.endDate}`
          }
        });
      }
    } catch (error) {
      console.error('❌ Erreur suppression demande de congé:', error);
      throw error;
    }
  };

  const handleUpdateLeaveDates = async (id: string, startDate: string, endDate: string, reason: string) => {
    try {
      console.log('🔄 Modification dates demande de congé ID:', id, 'Nouvelles dates:', startDate, 'au', endDate);
      const updates = {
        startDate,
        endDate,
        approvalReason: reason,
        updatedReason: reason // Sauvegarder la raison de modification
      };
      const updatedRequest = await DataAdapter.updateLeaveRequest(id, updates);
      setLeaveRequests(prev => prev.map(req => req.id === id ? updatedRequest : req));
      console.log('✅ Dates de congé modifiées');
      if (user) {
        AuditLogService.logAction({
          action: 'update',
          module: 'leave',
          entityType: 'leave_request',
          entityId: id,
          actor: user as any,
          metadata: {
            summary: `${user.name} a modifié les dates d'une demande de congé`,
            newDates: `${startDate} → ${endDate}`
          }
        });
      }
    } catch (error) {
      console.error('❌ Erreur modification dates:', error);
      throw error;
    }
  };


  // TIME LOGS
  const handleAddTimeLog = async (logData: Omit<TimeLog, 'id' | 'userId'>) => {
    if (!user) return;
    try {
      console.log('🔄 Création time log avec données:', logData);
      const newLog = await DataAdapter.createTimeLog(logData);
      updateTimeLogsWithProducer(prev => [newLog, ...prev]);
      emitTimeLogImputationEvent(newLog);
      console.log('✅ Time log créé:', newLog.id);
      NotificationHelper.notifyTimeLogCreated(newLog, user as any).catch(err => {
        console.warn('Notification time log', err);
      });
      AuditLogService.logAction({
        action: 'create',
        module: 'planning',
        entityType: 'time_log',
        entityId: newLog.id,
        actor: user as any,
        metadata: {
          summary: `${user.name} a enregistré ${newLog.duration} minutes sur ${newLog.entityTitle}`
        }
      });
    } catch (error) {
      console.error('Erreur création time log:', error);
    }
  };

  const handleDeleteTimeLog = async (logId: string) => {
    try {
      console.log('🔄 Suppression time log ID:', logId);
      await DataAdapter.deleteTimeLog(logId);
      updateTimeLogsWithProducer(prev => prev.filter(log => log.id !== logId));
      console.log('✅ Time log supprimé avec succès');
      AuditLogService.logAction({
        action: 'delete',
        module: 'planning',
        entityType: 'time_log',
        entityId: logId,
        actor: user as any,
        metadata: {
          summary: `${user?.name || 'Utilisateur'} a supprimé un time log`
        }
      });
    } catch (error) {
      console.error('Erreur suppression time log:', error);
    }
  };


  // USERS
  const handleUpdateUser = async (updatedUser: User) => {
    try {
      console.log('🔄 handleUpdateUser appelé:', { userId: updatedUser.id, updatedUser });
      const currentUser = users.find(u => u.id === updatedUser.id);
      
      if (!currentUser) {
        console.error('❌ Utilisateur non trouvé:', updatedUser.id);
        throw new Error('Utilisateur non trouvé');
      }
      
      console.log('📋 Utilisateur actuel:', { currentUser });
      
      // Si le rôle a changé, mettre à jour dans Supabase
      if (currentUser.role !== updatedUser.role) {
        console.log('🔄 Rôle modifié, mise à jour dans Supabase:', { userId: updatedUser.id, oldRole: currentUser.role, newRole: updatedUser.role });
        await DataService.updateUserRole(String(updatedUser.id), updatedUser.role);
      }
      
      // Mettre à jour les autres champs du profil si modifiés
      const profileUpdates: any = {};
      let hasProfileChanges = false;
      
      if (currentUser.name !== updatedUser.name) {
        profileUpdates.full_name = updatedUser.name;
        hasProfileChanges = true;
        console.log('📋 Nom modifié:', { old: currentUser.name, new: updatedUser.name });
      }
      if (currentUser.email !== updatedUser.email) {
        profileUpdates.email = updatedUser.email;
        hasProfileChanges = true;
        console.log('📋 Email modifié:', { old: currentUser.email, new: updatedUser.email });
      }
      if (currentUser.phone !== updatedUser.phone) {
        profileUpdates.phone_number = updatedUser.phone;
        hasProfileChanges = true;
        console.log('📋 Téléphone modifié:', { old: currentUser.phone, new: updatedUser.phone });
      }
      if (currentUser.location !== updatedUser.location) {
        profileUpdates.location = updatedUser.location;
        hasProfileChanges = true;
        console.log('📋 Localisation modifiée:', { old: currentUser.location, new: updatedUser.location });
      }
      if (currentUser.avatar !== updatedUser.avatar) {
        profileUpdates.avatar_url = updatedUser.avatar;
        hasProfileChanges = true;
        console.log('📋 Avatar modifié:', { old: currentUser.avatar, new: updatedUser.avatar });
      }
      if (currentUser.posteId !== updatedUser.posteId) {
        profileUpdates.poste_id = updatedUser.posteId || null;
        hasProfileChanges = true;
        console.log('📋 Poste modifié:', { old: currentUser.posteId, new: updatedUser.posteId });
      }
      
      if (hasProfileChanges) {
        console.log('🔄 Profil modifié, mise à jour dans Supabase:', { userId: updatedUser.id, updates: profileUpdates });
        const { error } = await DataService.updateProfile(String(updatedUser.id), profileUpdates);
        if (error) {
          console.error('❌ Erreur Supabase updateProfile:', error);
          throw error;
        }
        console.log('✅ Profil mis à jour avec succès dans Supabase');
      } else {
        console.log('ℹ️ Aucun changement de profil détecté');
      }
      
      // Mise à jour locale
    setUsers(prev => prev.map(u => u.id === updatedUser.id ? updatedUser : u));
      
    // Also update user in project teams if they are part of any
    updateProjectsWithProducer(prevProjects => prevProjects.map(p => ({
        ...p,
        team: p.team.map(member => member.id === updatedUser.id ? updatedUser : member)
    })));
      
      console.log('✅ handleUpdateUser terminé avec succès');
    } catch (error) {
      console.error('❌ Erreur mise à jour utilisateur:', error);
      alert('Erreur lors de la mise à jour de l\'utilisateur');
      throw error; // Propager l'erreur pour que le composant puisse la gérer
    }
  };

  const handleToggleActive = async (userId: string | number, isActive: boolean) => {
    try {
      console.log('🔄 Activation/désactivation utilisateur ID:', userId, 'Nouveau statut:', isActive);
      
      // Appel à Supabase via DataAdapter
      const success = await DataAdapter.toggleUserActive(userId, isActive);
      
      if (success) {
        // Mise à jour locale seulement si Supabase réussit
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, isActive } : u));
        console.log('✅ Utilisateur mis à jour dans Supabase et localement');
      } else {
        throw new Error('Échec de la mise à jour dans Supabase');
      }
    } catch (error) {
      console.error('❌ Erreur activation/désactivation utilisateur:', error);
      alert('Erreur lors de la modification du statut de l\'utilisateur');
    }
  };

  const handleDeleteUser = async (userId: string | number) => {
    try {
      console.log('🔄 Suppression utilisateur ID:', userId);
      
      // Appel à Supabase via DataAdapter
      const success = await DataAdapter.deleteUser(userId);
      
      if (success) {
        // Mise à jour locale seulement si Supabase réussit
        setUsers(prev => prev.filter(u => u.id !== userId));
        console.log('✅ Utilisateur supprimé de Supabase et localement');
      } else {
        throw new Error('Échec de la suppression dans Supabase');
      }
    } catch (error) {
      console.error('❌ Erreur suppression utilisateur:', error);
      throw error;
    }
  };

  // JOBS
  const handleAddJob = async (newJob: Omit<Job, 'id' | 'applicants'>) => {
    setLoadingOperation('create_job');
    setIsLoading(true);
    try {
      console.log('🔄 Création job avec données:', newJob);
      const createdJob = await DataAdapter.createJob(newJob);
      setJobs(prev => [createdJob, ...prev]);
      console.log('✅ Job créé:', createdJob.id);
    handleSetView('jobs');
      if (user) {
        AuditLogService.logAction({
          action: 'create',
          module: 'jobs',
          entityType: 'job',
          entityId: createdJob.id,
          actor: user as any,
          metadata: {
            summary: `${user.name} a publié l'offre "${createdJob.title}"`,
            location: createdJob.location
          }
        });
      }
    } catch (error) {
      console.error('❌ Erreur création job:', error);
      alert('Erreur lors de la création de l\'offre d\'emploi. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };

  const handleUpdateJob = async (updatedJob: Job) => {
    setLoadingOperation('update_job');
    setIsLoading(true);
    const previousJob = jobs.find(job => job.id === updatedJob.id);
    try {
      console.log('🔄 Mise à jour job ID:', updatedJob.id);
      const updated = await DataAdapter.updateJob(updatedJob);
      setJobs(prev => prev.map(job => job.id === updated.id ? updated : job));
      console.log('✅ Job mis à jour');
      if (user) {
        const diff = previousJob ? buildDiff(previousJob, updated, ['title', 'status', 'location', 'salaryRange']) : undefined;
        AuditLogService.logAction({
          action: 'update',
          module: 'jobs',
          entityType: 'job',
          entityId: updated.id,
          actor: user as any,
          metadata: {
            summary: `${user.name} a modifié l'offre "${updated.title}"`,
            diff
          }
        });
      }
    } catch (error) {
      console.error('❌ Erreur mise à jour job:', error);
      alert('Erreur lors de la mise à jour de l\'offre d\'emploi. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };

  const handleDeleteJob = async (jobId: number) => {
    setLoadingOperation('delete_job');
    setIsLoading(true);
    const jobToDelete = jobs.find(job => job.id === jobId);
    try {
      console.log('🔄 Suppression job ID:', jobId);
      await DataAdapter.deleteJob(jobId);
      setJobs(prev => prev.filter(job => job.id !== jobId));
      console.log('✅ Job supprimé');
      if (user && jobToDelete) {
        AuditLogService.logAction({
          action: 'delete',
          module: 'jobs',
          entityType: 'job',
          entityId: jobId,
          actor: user as any,
          metadata: {
            summary: `${user.name} a supprimé l'offre "${jobToDelete.title}"`
          }
        });
      }
    } catch (error) {
      console.error('❌ Erreur suppression job:', error);
      alert('Erreur lors de la suppression de l\'offre d\'emploi. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  
  // PROJECTS
  const handleAddProject = async (projectData: Omit<Project, 'id' | 'tasks' | 'risks'>) => {
    setLoadingOperation('create');
    setIsLoading(true);
    
    try {
      console.log('🔄 Création projet avec données:', projectData);
      const newProject = await DataAdapter.createProject({
        ...projectData,
        tasks: [],
        risks: [],
      });
      
      console.log('📊 Projet créé:', newProject);
      
      if (newProject) {
        startTransition(() => {
          updateProjectsWithProducer(prev => {
            const updated = [newProject, ...prev];
            console.log('✅ Projets mis à jour:', updated.length);
            return updated;
          });
        });
        
        // Notifier l'équipe de la création du projet
        if (user) {
          NotificationHelper.notifyProjectCreated(newProject, user as any).catch(err => {
            console.error('Erreur notification projet créé:', err);
          });
          AuditLogService.logAction({
            action: 'create',
            module: 'project',
            entityType: 'project',
            entityId: newProject.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a créé le projet "${newProject.title}"`
            }
          });
        }
        
        // Recharger les projets pour s'assurer que les données sont à jour
        setTimeout(async () => {
          try {
            console.log('🔄 Rechargement des projets après création...');
            const projects = await DataAdapter.getProjects();
            updateProjects(projects);
            console.log('✅ Projets rechargés:', projects.length);
          } catch (error) {
            console.error('❌ Erreur rechargement projets:', error);
          }
        }, 1000);
      } else {
        console.error('❌ Aucun projet retourné par DataAdapter');
        throw new Error('Aucun projet retourné par le serveur');
      }
    } catch (error) {
      console.error('Erreur création projet:', error);
      // TODO: Remplacer par une notification toast
      alert('Erreur lors de la création du projet. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  
  const handleUpdateProject = async (updatedProject: Project) => {
    setLoadingOperation('update');
    setIsLoading(true);
    const previousProject = projects.find(p => p.id === updatedProject.id);
    
    try {
      if (verboseLogs()) console.log('🔄 Mise à jour projet avec données:', updatedProject);
      const result = await DataAdapter.updateProject(updatedProject);
      
      if (result) {
        startTransition(() => {
          updateProjectsWithProducer(prev => prev.map(p => p.id === updatedProject.id ? updatedProject : p));
        });
        if (verboseLogs()) console.log('✅ Projet mis à jour avec succès');
        
        // Notifier l'équipe de la modification du projet
        if (user) {
          NotificationHelper.notifyProjectUpdated(updatedProject, user as any).catch(err => {
            console.error('Erreur notification projet modifié:', err);
          });
          const diff = previousProject
            ? buildDiff(previousProject, updatedProject, ['title', 'status', 'dueDate', 'budget', 'description'])
            : undefined;
          AuditLogService.logAction({
            action: 'update',
            module: 'project',
            entityType: 'project',
            entityId: updatedProject.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a modifié le projet "${updatedProject.title}"`,
              diff
            }
          });
        }
      } else {
        console.error('❌ Échec de la mise à jour du projet');
        throw new Error('Échec de la mise à jour du projet');
      }
    } catch (error) {
      console.error('Erreur mise à jour projet:', error);
      // TODO: Remplacer par une notification toast
      alert('Erreur lors de la mise à jour du projet. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  
  const handleDeleteProject = async (projectId: string | number) => {
    setLoadingOperation('delete');
    setIsLoading(true);
    
    try {
      console.log('🔄 Suppression projet ID:', projectId);
      const result = await DataAdapter.deleteProject(projectId);
      
      if (result) {
        const projectIdStr = String(projectId);
        const allowedIdsAfterDeletion = updateProjectsWithProducer(prev => prev.filter(p => String(p.id) !== projectIdStr));
        // Also delete related OKRs
        setObjectives(prev => filterObjectivesForUser(prev.filter(o => String(o.projectId) !== projectIdStr), allowedIdsAfterDeletion));
        updateTimeLogsWithProducer(prev => prev.filter(log => !(log.entityType === 'project' && String(log.entityId) === projectIdStr)));
        console.log('✅ Projet supprimé avec succès');
        AuditLogService.logAction({
          action: 'delete',
          module: 'project',
          entityType: 'project',
          entityId: projectId,
          actor: user as any,
          metadata: {
            summary: `${user?.name || 'Utilisateur'} a supprimé un projet`
          }
        });
      } else {
        console.error('❌ Échec de la suppression du projet');
        throw new Error('Échec de la suppression du projet');
      }
    } catch (error) {
      console.error('Erreur suppression projet:', error);
      // TODO: Remplacer par une notification toast
      alert('Erreur lors de la suppression du projet. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };

  // OBJECTIVES (OKRs)
  const handleSetObjectives = (newObjectives: Objective[]) => {
      updateObjectives(newObjectives, new Set(accessibleProjectIds.map(id => String(id))));
  };
  
  const handleAddObjective = async (objectiveData: Omit<Objective, 'id'>) => {
    setLoadingOperation('create_objective');
    setIsLoading(true);
    
    try {
      console.log('🔄 Création objectif avec données:', objectiveData);
      
      const newObjective = await DataAdapter.createObjective(objectiveData);
      
      if (newObjective) {
        setObjectives(prev => filterObjectivesForUser([newObjective, ...prev], new Set(accessibleProjectIds.map(id => String(id)))));
        console.log('✅ Objectif créé:', newObjective.id);
        
        // Notifier la création de l'objectif
        if (user) {
          NotificationHelper.notifyObjectiveCreated(newObjective, user as any).catch(err => {
            console.error('Erreur notification objectif créé:', err);
          });
          AuditLogService.logAction({
            action: 'create',
            module: 'goal',
            entityType: 'goal',
            entityId: newObjective.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a créé l'objectif "${newObjective.title}"`
            }
          });
        }
      } else {
        throw new Error('Aucun objectif retourné par le serveur');
      }
    } catch (error) {
      console.error('Erreur création objectif:', error);
      alert('Erreur lors de la création de l\'objectif. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  
  const handleUpdateObjective = async (updatedObjective: Objective) => {
    setLoadingOperation('update_objective');
    setIsLoading(true);
    
    try {
      console.log('🔄 Mise à jour objectif avec données:', updatedObjective);
      
      const updated = await DataAdapter.updateObjective(updatedObjective.id, updatedObjective);
      
      if (updated) {
        setObjectives(prev => filterObjectivesForUser(prev.map(o => o.id === updated.id ? updated : o), new Set(accessibleProjectIds.map(id => String(id)))));
        console.log('✅ Objectif mis à jour avec succès');
        if (user) {
          AuditLogService.logAction({
            action: 'update',
            module: 'goal',
            entityType: 'goal',
            entityId: updated.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a mis à jour l'objectif "${updated.title}"`
            }
          });
        }
      } else {
        throw new Error('Aucun objectif retourné par le serveur');
      }
    } catch (error) {
      console.error('Erreur mise à jour objectif:', error);
      alert('Erreur lors de la mise à jour de l\'objectif. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  
  const handleDeleteObjective = async (objectiveId: string) => {
    setLoadingOperation('delete_objective');
    setIsLoading(true);
    
    try {
      console.log('🔄 Suppression objectif ID:', objectiveId);
      
      const success = await DataAdapter.deleteObjective(objectiveId);
      
      if (success) {
        setObjectives(prev => filterObjectivesForUser(prev.filter(o => o.id !== objectiveId), new Set(accessibleProjectIds.map(id => String(id)))));
        console.log('✅ Objectif supprimé avec succès');
        if (user) {
          AuditLogService.logAction({
            action: 'delete',
            module: 'goal',
            entityType: 'goal',
            entityId: objectiveId,
            actor: user as any,
            metadata: {
              summary: `${user.name} a supprimé un objectif`
            }
          });
        }
      } else {
        throw new Error('Échec de la suppression');
      }
    } catch (error) {
      console.error('Erreur suppression objectif:', error);
      alert('Erreur lors de la suppression de l\'objectif. Veuillez réessayer.');
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };


  // COURSES
  const handleAddCourse = async (courseData: Omit<Course, 'id'>) => {
    setLoadingOperation('create_course');
    setIsLoading(true);
    try {
      const newCourse = await DataAdapter.createCourse(courseData);
      if (newCourse) {
      setCourses(prev => [newCourse, ...prev]);
      
      // Notifier les étudiants ciblés de la création du cours
      if (user && newCourse.targetStudents && newCourse.targetStudents.length > 0) {
        NotificationHelper.notifyCourseCreated(
          newCourse, 
          user as any,
          newCourse.targetStudents
        ).catch(err => {
          console.error('Erreur notification cours créé:', err);
        });
      }
      }
      if (user) {
        AuditLogService.logAction({
          action: 'create',
          module: 'knowledge',
          entityType: 'course',
          entityId: newCourse.id,
          actor: user as any,
          metadata: {
            summary: `${user.name} a créé le cours "${newCourse.title}"`,
            target: newCourse.targetStudents?.length || 0
          }
        });
      }
    } catch (error) {
      console.error('Erreur création cours:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  
  const handleUpdateCourse = async (updatedCourse: Course) => {
    setLoadingOperation('update_course');
    setIsLoading(true);
    const previousCourse = courses.find(c => c.id === updatedCourse.id);
    try {
      const updated = await DataAdapter.updateCourse(updatedCourse.id, updatedCourse);
      if (updated) {
        setCourses(prev => prev.map(c => c.id === updatedCourse.id ? updatedCourse : c));
        if (user) {
          const diff = previousCourse ? buildDiff(previousCourse, updatedCourse, ['title', 'duration', 'level', 'status']) : undefined;
          AuditLogService.logAction({
            action: 'update',
            module: 'knowledge',
            entityType: 'course',
            entityId: updatedCourse.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a mis à jour le cours "${updatedCourse.title}"`,
              diff
            }
          });
        }
      }
    } catch (error) {
      console.error('Erreur mise à jour cours:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  
  const handleDeleteCourse = async (courseId: string) => {
    setLoadingOperation('delete_course');
    setIsLoading(true);
    const courseToDelete = courses.find(c => c.id === courseId);
    try {
      const success = await DataAdapter.deleteCourse(courseId);
      if (success) {
      setCourses(prev => prev.filter(c => c.id !== courseId));
      if (user && courseToDelete) {
        AuditLogService.logAction({
          action: 'delete',
          module: 'knowledge',
          entityType: 'course',
          entityId: courseId,
          actor: user as any,
          metadata: {
            summary: `${user.name} a supprimé le cours "${courseToDelete.title}"`
          }
        });
      }
      }
    } catch (error) {
      console.error('Erreur suppression cours:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };

  const handleAddContact = async (
    contactData: Omit<Contact, 'id'>
  ): Promise<{ contact: Contact; persisted: boolean } | null> => {
    setLoadingOperation('create_contact');
    setIsLoading(true);
    try {
      const newContact = await DataAdapter.createContact(contactData);
      if (newContact) {
        setContacts(prev => [newContact, ...prev]);
        dispatchCrmOutboundEvent({ kind: 'contact.created', contact: newContact });
        if (user) {
          AuditLogService.logAction({
            action: 'create',
            module: 'crm',
            entityType: 'contact',
            entityId: newContact.id as string,
            actor: user as any,
            metadata: {
              summary: `${user.name} a ajouté le contact ${newContact.name}`,
              status: newContact.status
            }
          });
        }
        void logContactDossierFromCrm(newContact, 'created', user?.id != null ? String(user.id) : undefined);
        return { contact: newContact, persisted: true };
      }
      return null;
    } catch (error) {
      console.error('Erreur création contact:', error);
      const fallbackContact: Contact = { ...contactData, id: Date.now() };
      setContacts(prev => [fallbackContact, ...prev]);
      return { contact: fallbackContact, persisted: false };
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  const handleUpdateContact = async (updatedContact: Contact) => {
    setLoadingOperation('update_contact');
    setIsLoading(true);
    const previousContact = contacts.find(c => String(c.id) === String(updatedContact.id));
    try {
      const saved = await DataAdapter.updateContact(updatedContact.id, updatedContact);
      if (!saved) {
        console.error('Échec mise à jour contact (API)');
        return;
      }
      setContacts(prev => prev.map(c => (String(c.id) === String(saved.id) ? saved : c)));
      dispatchCrmOutboundEvent({
        kind: 'contact.updated',
        contact: saved,
        previous: previousContact ?? undefined,
      });
      if (user) {
        const diff = previousContact
          ? buildDiff(previousContact, saved, [
              'name',
              'workEmail',
              'personalEmail',
              'status',
              'company',
              'categoryId',
              'officePhone',
              'mobilePhone',
              'whatsappNumber'
            ])
          : undefined;
        AuditLogService.logAction({
          action: 'update',
          module: 'crm',
          entityType: 'contact',
          entityId: String(saved.id),
          actor: user as any,
          metadata: {
            summary: `${user.name} a mis à jour le contact ${saved.name}`,
            diff
          }
        });
      }
      void logContactDossierFromCrm(saved, 'updated', user?.id != null ? String(user.id) : undefined, previousContact ?? null);
    } catch (error) {
      console.error('Erreur mise à jour contact:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };
  const handleDeleteContact = async (contactId: number | string) => {
    setLoadingOperation('delete_contact');
    setIsLoading(true);
    const contactToDelete = contacts.find(c => String(c.id) === String(contactId));
    try {
      const ok = await DataAdapter.deleteContact(contactId);
      if (!ok) {
        console.error('Échec suppression contact (API)');
        return;
      }
      setContacts(prev => prev.filter(c => String(c.id) !== String(contactId)));
      if (user && contactToDelete) {
        AuditLogService.logAction({
          action: 'delete',
          module: 'crm',
          entityType: 'contact',
          entityId: String(contactId),
          actor: user as any,
          metadata: {
            summary: `${user.name} a supprimé le contact ${contactToDelete.name}`
          }
        });
      }
    } catch (error) {
      console.error('Erreur suppression contact:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  };

  
  // COYA Drive (archives / GED intégrée)
  const handleAddDocument = async (documentData: Omit<Document, 'id'>) => {
    setLoadingOperation('create_document');
    setIsLoading(true);
    try {
      const newDocument = await DataAdapter.createDocument(documentData);
      if (newDocument) {
      setDocuments(prev => [newDocument, ...prev]);
      if (user) {
        AuditLogService.logAction({
          action: 'create',
          module: 'knowledge',
          entityType: 'document',
          entityId: newDocument.id,
          actor: user as any,
          metadata: {
            summary: `${user.name} a publié le document "${newDocument.title}"`
          }
        });
      }
      }
    } catch (error) {
      console.error('Erreur création document:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  }

  const handleUpdateDocument = async (updatedDocument: Partial<Document> & { id: string }) => {
    setLoadingOperation('update_document');
    setIsLoading(true);
    try {
      const result = await DataAdapter.updateDocument(updatedDocument.id, updatedDocument);
      if (result) {
        setDocuments(prev => prev.map(d => (d.id === updatedDocument.id ? result : d)));
        if (user && (updatedDocument.title !== undefined || updatedDocument.content !== undefined)) {
          AuditLogService.logAction({
            action: 'update',
            module: 'knowledge',
            entityType: 'document',
            entityId: updatedDocument.id,
            actor: user as any,
            metadata: {
              summary: `${user.name} a mis à jour le document « ${updatedDocument.title ?? result.title} »`
            }
          });
        }
      }
    } catch (error) {
      console.error('Erreur mise à jour document:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  }

  const handleDeleteDocument = async (documentId: string) => {
    setLoadingOperation('delete_document');
    setIsLoading(true);
    const docToDelete = documents.find(d => d.id === documentId);
    try {
      const success = await DataAdapter.deleteDocument(documentId);
      if (success) {
        setDocuments(prev => prev.filter(d => d.id !== documentId));
        if (user && docToDelete) {
          AuditLogService.logAction({
            action: 'delete',
            module: 'knowledge',
            entityType: 'document',
            entityId: documentId,
            actor: user as any,
            metadata: {
              summary: `${user.name} a supprimé le document "${docToDelete.title}"`
            }
          });
        }
      }
    } catch (error) {
      console.error('Erreur suppression document:', error);
    } finally {
      setLoadingOperation(null);
      setIsLoading(false);
    }
  }

  // --- View Management ---

  // handleSetView est déjà défini en haut du composant

  const renderView = () => {
    const ModuleComponent = getModuleViewComponent(currentView);
    if (ModuleComponent) return <ModuleComponent key={currentView} />;

    switch (currentView) {
      case 'status_selector':
        return (
          <>
            <Dashboard setView={handleSetView} projects={projects} courses={courses} jobs={jobs} timeLogs={timeLogs} leaveRequests={leaveRequests} invoices={invoices} expenses={expenses} objectives={objectives} canAccessModule={canAccessModule} isDataLoaded={isDataLoaded} />
            <StatusSelectorModal onConfirm={() => handleSetView('dashboard')} />
          </>
        );
      case 'dashboard':
        return <Dashboard setView={handleSetView} projects={projects} courses={courses} jobs={jobs} timeLogs={timeLogs} leaveRequests={leaveRequests} invoices={invoices} expenses={expenses} objectives={objectives} canAccessModule={canAccessModule} isDataLoaded={isDataLoaded} />;
      case 'programmes_projects':
        return (
          <ProgrammesProjectsShell
            canAccessProgramme={canAccessModule('programme')}
            canAccessProjects={canAccessModule('projects')}
            isFr={language === Language.FR}
            programmePane={<ProgrammeModule />}
            projectsPane={
              <Projects
                projects={projects}
                users={users}
                timeLogs={timeLogs}
                onUpdateProject={handleUpdateProject}
                onAddProject={handleAddProject}
                onDeleteProject={handleDeleteProject}
                onAddTimeLog={handleAddTimeLog}
                objectives={objectives}
                setView={handleSetView}
                isLoading={isLoading}
                loadingOperation={loadingOperation}
                isDataLoaded={isDataLoaded}
                autoOpenProjectId={
                  pendingNotification?.entityType === 'project' && pendingNotification.entityId
                    ? String(pendingNotification.entityId)
                    : null
                }
                onNotificationHandled={handleNotificationHandled}
                onOpenProjectWorkspace={handleOpenProjectWorkspace}
              />
            }
          />
        );
      case 'projects':
        return <Projects 
                    projects={projects} 
                    users={users}
                    timeLogs={timeLogs}
                    onUpdateProject={handleUpdateProject} 
                    onAddProject={handleAddProject}
                    onDeleteProject={handleDeleteProject}
                    onAddTimeLog={handleAddTimeLog}
                    objectives={objectives}
                    setView={handleSetView}
                    isLoading={isLoading}
                    loadingOperation={loadingOperation}
                    isDataLoaded={isDataLoaded}
                    autoOpenProjectId={
                      pendingNotification?.entityType === 'project' && pendingNotification.entityId
                        ? String(pendingNotification.entityId)
                        : null
                    }
                    onNotificationHandled={handleNotificationHandled}
                    onOpenProjectWorkspace={handleOpenProjectWorkspace}
                />;
      case 'project_workspace': {
        if (!canAccessModule('projects')) {
          return (
            <Dashboard
              setView={handleSetView}
              projects={projects}
              courses={courses}
              jobs={jobs}
              timeLogs={timeLogs}
              leaveRequests={leaveRequests}
              invoices={invoices}
              expenses={expenses}
              objectives={objectives}
              canAccessModule={canAccessModule}
              isDataLoaded={isDataLoaded}
            />
          );
        }
        const pid = selectedProjectId;
        const activeProject = pid ? projects.find((p) => String(p.id) === String(pid)) : undefined;
        if (!activeProject) {
          return (
            <div className="mx-auto max-w-md px-4 py-16 text-center">
              <p className="text-sm text-slate-600">
                {language === Language.FR
                  ? 'Projet introuvable, retiré ou sans accès.'
                  : 'Project not found, removed, or no access.'}
              </p>
              <button
                type="button"
                onClick={handleCloseProjectWorkspace}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#0d1b2a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3a5c]"
              >
                {language === Language.FR ? 'Retour aux projets' : 'Back to projects'}
              </button>
            </div>
          );
        }
        return (
          <ProjectObjectWorkspace
            project={activeProject}
            onClose={handleCloseProjectWorkspace}
            onUpdateProject={handleUpdateProject}
            onDeleteProject={handleDeleteProject}
            onAddTimeLog={handleAddTimeLog}
            timeLogs={timeLogs}
            objectives={objectives}
            setView={handleSetView}
            users={users}
          />
        );
      }
      case 'employee_workspace': {
        if (!canAccessModule('rh')) {
          return (
            <Dashboard
              setView={handleSetView}
              projects={projects}
              courses={courses}
              jobs={jobs}
              timeLogs={timeLogs}
              leaveRequests={leaveRequests}
              invoices={invoices}
              expenses={expenses}
              objectives={objectives}
              canAccessModule={canAccessModule}
              isDataLoaded={isDataLoaded}
            />
          );
        }
        const eid = selectedEmployeeWorkspaceProfileId;
        if (!eid) {
          return (
            <div className="mx-auto max-w-md px-4 py-16 text-center">
              <p className="text-sm text-slate-600">
                {language === Language.FR
                  ? 'Salarié introuvable ou identifiant manquant. Retournez au module RH.'
                  : 'Employee not found or missing id. Return to the HR module.'}
              </p>
              <button
                type="button"
                onClick={handleCloseEmployeeWorkspace}
                className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#0d1b2a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3a5c]"
              >
                {language === Language.FR ? 'Retour au RH' : 'Back to HR'}
              </button>
            </div>
          );
        }
        return (
          <EmployeeWorkspaceShell
            profileId={eid}
            users={users}
            leaveRequests={leaveRequests}
            onNavigateView={handleSetView}
            onClose={handleCloseEmployeeWorkspace}
          />
        );
      }
      case 'goals_okrs':
        return (
          <StrategyGovernanceHub
            projects={projects}
            objectives={objectives}
            setObjectives={handleSetObjectives}
            onAddObjective={handleAddObjective}
            onUpdateObjective={handleUpdateObjective}
            onDeleteObjective={handleDeleteObjective}
            isLoading={isLoading}
            loadingOperation={loadingOperation}
            isDataLoaded={isDataLoaded}
          />
        );
      case 'apex':
      case 'formation':
      case 'courses':
        return (
          <ApexModuleShell
            courses={courses}
            users={users}
            onSelectCourse={handleSelectCourse}
            onAddCourse={handleAddCourse}
            onUpdateCourse={handleUpdateCourse}
            onDeleteCourse={handleDeleteCourse}
            isLoading={isLoading}
            loadingOperation={loadingOperation}
            setView={handleSetView}
          />
        );
      case 'apex_access':
        return <ApexAccessLanding setView={handleSetView} />;
      case 'course_detail':
        const course = courses.find(c => c.id === selectedCourseId);
        return course ? (
          <CourseDetail
            course={course}
            onBack={() => handleSetView('apex')}
            timeLogs={timeLogs}
            onAddTimeLog={handleAddTimeLog}
            projects={projects}
            onCourseChange={handleCourseStateChange}
          />
        ) : (
          <Courses courses={courses} onSelectCourse={handleSelectCourse} />
        );
      case 'course_management':
          return <CourseManagement 
                    courses={courses} 
                    users={users}
                    onAddCourse={handleAddCourse}
                    onUpdateCourse={handleUpdateCourse}
                    onDeleteCourse={handleDeleteCourse}
                    isLoading={isLoading}
                    loadingOperation={loadingOperation}
                    onOpenCrmCollecteForCourse={(courseId) => {
                      try {
                        sessionStorage.setItem(NAV_SESSION_COLLECTE_PRESET_FORMATION_ID, courseId);
                        sessionStorage.setItem(NAV_SESSION_CRM_OPEN_COLLECTE_TAB, '1');
                      } catch {
                        /* ignore */
                      }
                      handleSetView('crm_sales');
                    }}
                  />;
      case 'jobs':
        return <Jobs jobs={jobs} setJobs={setJobs} setView={handleSetView} isLoading={isLoading} loadingOperation={loadingOperation}/>;
      case 'create_job':
        return <CreateJob onAddJob={handleAddJob} onBack={() => handleSetView('jobs')} />;
      case 'job_management':
        return <JobManagement
                  jobs={jobs}
                  onAddJob={handleAddJob}
                  onUpdateJob={handleUpdateJob}
                  onDeleteJob={handleDeleteJob}
                  onNavigate={handleSetView}
                  isLoading={isLoading}
                  loadingOperation={loadingOperation}
                />;
      case 'leave_management_admin':
        return <LeaveManagementAdmin
                  leaveRequests={leaveRequests}
                  users={users}
                  onUpdateLeaveRequest={handleUpdateLeaveRequest}
                  onUpdateLeaveDates={handleUpdateLeaveDates}
                  onDeleteLeaveRequest={handleDeleteLeaveRequest}
                />;
      case 'user_management':
        return (
          <UserManagement
            users={users}
            onUpdateUser={handleUpdateUser}
            onToggleActive={handleToggleActive}
            onDeleteUser={handleDeleteUser}
            onRefreshUsers={handleRefreshUsers}
          />
        );
      case 'organization_management':
        return <OrganizationManagement />;
      case 'department_management':
        return <DepartmentManagement />;
      case 'crm_sales':
        return <CRM 
                    contacts={contacts} 
                    onAddContact={handleAddContact}
                    onUpdateContact={handleUpdateContact}
                    onDeleteContact={handleDeleteContact}
                    isLoading={isLoading}
                    loadingOperation={loadingOperation}
                    setView={handleSetView}
                    onRefreshContacts={refreshContactsFromServer}
                />;
      case 'coya_drive':
      case 'knowledge_base':
        return <Drive />;
      case 'daf_services':
        return <DafServicesModule />;
      case 'notifications_center':
        return (
          <NotificationsPage
            onNavigateToEntity={handleNotificationNavigate}
          />
        );
      case 'activity_logs':
        return <ActivityLogsPage onNavigate={handleActivityLogNavigate} />;
      case 'leave_management':
        return <LeaveManagement 
                    leaveRequests={leaveRequests}
                    users={users}
                    onAddLeaveRequest={handleAddLeaveRequest}
                    onUpdateLeaveRequest={handleUpdateLeaveRequest}
                    onDeleteLeaveRequest={handleDeleteLeaveRequest}
                    isLoading={isLoading}
                    loadingOperation={loadingOperation}
                />;
      case 'comptabilite':
        return <ComptabiliteModule />;
      case 'rh':
        return (
          <RhModule
            leaveRequests={leaveRequests}
            users={users}
            jobs={jobs}
            setJobs={setJobs}
            setView={handleSetView}
            onAddLeaveRequest={handleAddLeaveRequest}
            onUpdateLeaveRequest={handleUpdateLeaveRequest}
            onUpdateLeaveDates={handleUpdateLeaveDates}
            onDeleteLeaveRequest={handleDeleteLeaveRequest}
            isLoading={isLoading}
            loadingOperation={loadingOperation}
            onOpenEmployeeWorkspace={handleOpenEmployeeWorkspace}
          />
        );
      case 'planning':
        return (
          <Planning
            meetings={meetings}
            setView={handleSetView}
            rh={{
              leaveRequests,
              users,
              jobs,
              setJobs,
              onAddLeaveRequest: handleAddLeaveRequest,
              onUpdateLeaveRequest: handleUpdateLeaveRequest,
              onUpdateLeaveDates: handleUpdateLeaveDates,
              onDeleteLeaveRequest: handleDeleteLeaveRequest,
              isLoading,
              loadingOperation,
            }}
          />
        );
      case 'qualite':
        if (!canAccessModule('qualite')) {
          return (
            <Dashboard
              setView={handleSetView}
              projects={projects}
              courses={courses}
              jobs={jobs}
              timeLogs={timeLogs}
              leaveRequests={leaveRequests}
              invoices={invoices}
              expenses={expenses}
              objectives={objectives}
              canAccessModule={canAccessModule}
              isDataLoaded={isDataLoaded}
            />
          );
        }
        return <QualiteModule />;
      case 'collecte':
        if (!canAccessModule('collecte')) {
          return (
            <Dashboard
              setView={handleSetView}
              projects={projects}
              courses={courses}
              jobs={jobs}
              timeLogs={timeLogs}
              leaveRequests={leaveRequests}
              invoices={invoices}
              expenses={expenses}
              objectives={objectives}
              canAccessModule={canAccessModule}
              isDataLoaded={isDataLoaded}
            />
          );
        }
        return <CollecteModule />;
      case 'postes_management':
        if (!canAccessModule('postes_management')) {
          return (
            <Dashboard
              setView={handleSetView}
              projects={projects}
              courses={courses}
              jobs={jobs}
              timeLogs={timeLogs}
              leaveRequests={leaveRequests}
              invoices={invoices}
              expenses={expenses}
              objectives={objectives}
              canAccessModule={canAccessModule}
              isDataLoaded={isDataLoaded}
            />
          );
        }
        return <PostesManagement />;
      case 'pending_access':
        return (
          <div className="max-w-lg mx-auto mt-12 rounded-xl border border-amber-200 bg-amber-50/95 px-6 py-8 text-center shadow-sm">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-800">
              <i className="fas fa-user-clock text-lg" aria-hidden />
            </div>
            <h1 className="text-base font-bold text-slate-900">{t('pending_access_title')}</h1>
            <p className="mt-2 text-sm text-slate-700 leading-relaxed">{t('pending_access_body')}</p>
          </div>
        );
      case 'settings':
        return (
          <Settings
            reminderDays={reminderDays}
            onSetReminderDays={setReminderDays}
            users={users}
            onRefreshUsers={handleRefreshUsers}
            setView={handleSetView}
            leaveRequests={leaveRequests}
            courses={courses}
            jobs={jobs}
            onUpdateLeaveRequest={handleUpdateLeaveRequest}
            onUpdateLeaveDates={handleUpdateLeaveDates}
            onDeleteLeaveRequest={handleDeleteLeaveRequest}
            onAddCourse={handleAddCourse}
            onUpdateCourse={handleUpdateCourse}
            onDeleteCourse={handleDeleteCourse}
            onAddJob={handleAddJob}
            onUpdateJob={handleUpdateJob}
            onDeleteJob={handleDeleteJob}
            isLoading={isLoading}
            loadingOperation={loadingOperation}
            automationKpis={workflowKpis}
          />
        );
      default:
        return <Dashboard setView={handleSetView} projects={projects} courses={courses} jobs={jobs} timeLogs={timeLogs} leaveRequests={leaveRequests} invoices={invoices} expenses={expenses} objectives={objectives} canAccessModule={canAccessModule} />;
    }
  };
  
  const handleCourseStateChange = (updatedCourse: Course) => {
    setCourses(prev => prev.map(c => (c.id === updatedCourse.id ? updatedCourse : c)));
  };
  
  return (
    <AppNavigationContext.Provider value={{ setView: handleSetView }}>
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar
        currentView={currentView}
        setView={handleSetView}
        isOpen={isSidebarOpen}
        canAccessModule={canAccessModule}
        permissionsLoading={permissionsLoading}
        onCloseMobile={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header 
            toggleSidebar={() => setSidebarOpen(!isSidebarOpen)} 
            setView={handleSetView}
            onNotificationNavigate={handleNotificationNavigate}
            onShowAllNotifications={() => handleSetView('notifications_center')}
            onShowActivityLogs={() => handleSetView('activity_logs')}
            currentView={currentView}
            workforceDock={
              currentView === 'login' ||
              currentView === 'signup' ||
              currentView === 'dashboard'
                ? undefined
                : <AttendanceStatusDock />
            }
        />
        <main
          ref={mainScrollRef}
          onScroll={handleMainScroll}
          className={`flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 ${
            currentView === 'login' || currentView === 'signup' ? '' : 'pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:pb-0'
          }`}
        >
          {renderView()}
        </main>
        {currentView !== 'login' && currentView !== 'signup' ? <MobileAttendanceDock /> : null}
      </div>
      {isSidebarOpen && <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 bg-black opacity-50 z-40 lg:hidden"></div>}
      {showBackToTop && (
        <button
          type="button"
          onClick={scrollToTop}
          className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] right-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-coya-primary text-white shadow-lg hover:bg-coya-primary-light focus:outline-none focus:ring-2 focus:ring-coya-primary focus:ring-offset-2 md:bottom-6 md:right-6"
          aria-label="Retour en haut"
        >
          <i className="fas fa-arrow-up" />
        </button>
      )}
      <AIAgent
        currentView={currentView}
        onOpenMessaging={(target) => {
          try {
            localStorage.setItem('coya_messaging_default_tab', target === 'direct' ? 'direct' : 'channels');
          } catch {
            // ignore
          }
          handleSetView('messagerie');
        }}
        onOpenTicketIT={() => handleSetView('ticket_it')}
      />
      <PasswordRecoveryScreen
        open={showNewPasswordModal}
        onCompleted={handleRecoveryCompleted}
        onAbort={handleRecoveryAbort}
      />
    </div>
    </AppNavigationContext.Provider>
  );
};

export default App;
