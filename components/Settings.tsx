import React, { useEffect, useMemo, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { Language, User, ModuleName } from '../types';
import UserProfileEdit from './UserProfileEdit';
import OrganizationManagement from './OrganizationManagement';
import DepartmentManagement from './DepartmentManagement';
import UserManagement from './UserManagement';
import CourseManagement from './CourseManagement';
import JobManagement from './JobManagement';
import LeaveManagementAdmin from './LeaveManagementAdmin';
import PostesManagement from './PostesManagement';
import ModuleLabelsEditor from './ModuleLabelsEditor';
import DashboardSettingsEditor from './DashboardSettingsEditor';
import ProjectModuleSettingsEditor from './ProjectModuleSettingsEditor';
import HrEvaluation from './HrEvaluation';
import { LeaveRequest, Course, Job } from '../types';
import AuthService from '../services/authService';
import { isSingleOrganizationTenantMode } from '../constants/platformTenant';
import {
  NAV_SESSION_COLLECTE_PRESET_FORMATION_ID,
  NAV_SESSION_CRM_OPEN_COLLECTE_TAB,
} from '../contexts/AppNavigationContext';
import ModuleRichHub from './common/ModuleRichHub';

interface SettingsProps {
  reminderDays: number;
  onSetReminderDays: (days: number) => void;
  users?: User[];
  /** Recharge la liste utilisateurs (ex. après création depuis Paramètres). */
  onRefreshUsers?: () => Promise<void>;
  setView?: (view: string) => void;
  leaveRequests?: LeaveRequest[];
  courses?: Course[];
  jobs?: Job[];
  onUpdateLeaveRequest?: (id: string, status: 'approved' | 'rejected', reason?: string) => Promise<void>;
  onUpdateLeaveDates?: (id: string, startDate: string, endDate: string, reason: string) => Promise<void>;
  onDeleteLeaveRequest?: (id: string) => Promise<void>;
  onAddCourse?: (course: Partial<Course>) => Promise<void>;
  onUpdateCourse?: (id: string, updates: Partial<Course>) => Promise<void>;
  onDeleteCourse?: (id: string) => Promise<void>;
  onAddJob?: (job: Partial<Job>) => Promise<void>;
  onUpdateJob?: (id: string, updates: Partial<Job>) => Promise<void>;
  onDeleteJob?: (id: number) => Promise<void>;
  isLoading?: boolean;
  loadingOperation?: string | null;
  automationKpis?: {
    cycleAt: string;
    scanned: {
      projects: number;
      tasks: number;
      objectives: number;
      leaves: number;
      invoices: number;
      meetings: number;
    };
    actions: {
      total: number;
      notifications: number;
      projectUpdates: number;
      objectiveUpdates: number;
      invoiceUpdates: number;
    };
    bySeverity: {
      info: number;
      warning: number;
      critical: number;
    };
  } | null;
}

type SettingsTab = 'personal' | 'admin';

type PersonalPageId = 'profile' | 'preferences' | 'activity' | 'skills';

type AdminPageId =
  | 'platform_labels'
  | 'platform_dashboard'
  | 'platform_projects'
  | 'platform_automation'
  | 'organization_management'
  | 'department_management'
  | 'postes_management'
  | 'user_management'
  | 'course_management'
  | 'job_management'
  | 'leave_management_admin'
  | 'hr_evaluation';

const ADMIN_MODULE_BY_PAGE: Partial<Record<AdminPageId, ModuleName>> = {
  organization_management: 'organization_management',
  department_management: 'department_management',
  postes_management: 'postes_management',
  user_management: 'user_management',
  course_management: 'course_management',
  job_management: 'job_management',
  leave_management_admin: 'leave_management_admin',
  hr_evaluation: 'rh',
};

const Settings: React.FC<SettingsProps> = ({
  reminderDays,
  onSetReminderDays,
  users = [],
  onRefreshUsers,
  setView,
  leaveRequests = [],
  courses = [],
  jobs = [],
  onUpdateLeaveRequest,
  onUpdateLeaveDates,
  onDeleteLeaveRequest,
  onAddCourse,
  onUpdateCourse,
  onDeleteCourse,
  onAddJob,
  onUpdateJob,
  onDeleteJob,
  isLoading,
  loadingOperation,
  automationKpis,
}) => {
  const { t, language, setLanguage } = useLocalization();
  const { user } = useAuth();
  const { canAccessModule } = useModulePermissions();
  const isFr = language === Language.FR;

  const [skills, setSkills] = useState<string[]>(user?.skills || []);
  const [newSkill, setNewSkill] = useState('');
  const [isProfileModalOpen, setProfileModalOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('personal');
  const [personalPage, setPersonalPage] = useState<PersonalPageId>('profile');
  const [adminPage, setAdminPage] = useState<AdminPageId | null>(null);
  const [profileAvatarFailed, setProfileAvatarFailed] = useState(false);
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    setSkills(user?.skills || []);
  }, [user?.id, user?.skills]);

  useEffect(() => {
    setProfileAvatarFailed(false);
  }, [user?.avatar]);

  const isSuperAdmin = user?.role === 'super_administrator';
  const isAdminOrSuper = user?.role === 'super_administrator' || user?.role === 'administrator';

  const adminNavItems = useMemo(() => {
    const items: { id: AdminPageId; labelFr: string; labelEn: string; icon: string; groupFr: string; groupEn: string }[] = [];

    if (isSuperAdmin) {
      items.push(
        { id: 'platform_labels', labelFr: 'Libellés des modules', labelEn: 'Module labels', icon: 'fas fa-tags', groupFr: 'Plateforme', groupEn: 'Platform' },
        { id: 'platform_dashboard', labelFr: 'Widgets tableau de bord', labelEn: 'Dashboard widgets', icon: 'fas fa-th-large', groupFr: 'Plateforme', groupEn: 'Platform' },
        { id: 'platform_projects', labelFr: 'Module Projets', labelEn: 'Projects module', icon: 'fas fa-project-diagram', groupFr: 'Plateforme', groupEn: 'Platform' },
        { id: 'platform_automation', labelFr: 'Automatisation & observabilité', labelEn: 'Automation & observability', icon: 'fas fa-robot', groupFr: 'Plateforme', groupEn: 'Platform' },
      );
    }

    const pushIf = (id: AdminPageId, labelFr: string, labelEn: string, icon: string, groupFr: string, groupEn: string, allowed: boolean) => {
      if (allowed) items.push({ id, labelFr, labelEn, icon, groupFr, groupEn });
    };

    pushIf(
      'organization_management',
      'Organisations',
      'Organizations',
      'fas fa-building',
      'Structure',
      'Structure',
      canAccessModule('organization_management'),
    );
    pushIf('department_management', 'Départements', 'Departments', 'fas fa-sitemap', 'Structure', 'Structure', canAccessModule('department_management'));
    pushIf('postes_management', 'Postes & fiches de poste', 'Job positions', 'fas fa-user-tag', 'Accès & RH', 'Access & HR', isAdminOrSuper);
    pushIf('user_management', 'Utilisateurs & droits', 'Users & permissions', 'fas fa-user-cog', 'Accès & RH', 'Access & HR', canAccessModule('user_management'));
    pushIf('course_management', 'APEX (catalogue)', 'APEX catalog', 'fas fa-chalkboard-teacher', 'Contenus', 'Content', canAccessModule('course_management'));
    pushIf('job_management', 'Offres d’emploi', 'Job offers', 'fas fa-briefcase', 'Contenus', 'Content', canAccessModule('job_management'));
    pushIf(
      'leave_management_admin',
      'Congés (validation)',
      'Leave requests',
      'fas fa-calendar-check',
      'RH',
      'HR',
      canAccessModule('leave_management_admin'),
    );
    pushIf('hr_evaluation', 'Évaluation', 'Evaluation', 'fas fa-clipboard-list', 'RH', 'HR', canAccessModule('rh'));

    return items;
  }, [isSuperAdmin, isAdminOrSuper, canAccessModule]);

  const showAdminTab = isSuperAdmin || adminNavItems.some((i) => !['platform_labels', 'platform_dashboard', 'platform_projects', 'platform_automation'].includes(i.id));

  useEffect(() => {
    if (settingsTab !== 'admin' || adminNavItems.length === 0) return;
    if (!adminPage || !adminNavItems.some((i) => i.id === adminPage)) {
      setAdminPage(adminNavItems[0].id);
    }
  }, [settingsTab, adminNavItems, adminPage]);

  const handleAddSkill = (e: React.FormEvent) => {
    e.preventDefault();
    if (newSkill.trim() && !skills.includes(newSkill.trim())) {
      setSkills([...skills, newSkill.trim()]);
      setNewSkill('');
    }
  };

  const handleRemoveSkill = (skillToRemove: string) => {
    setSkills(skills.filter((skill) => skill !== skillToRemove));
  };

  const handleSaveProfile = async (updatedUser: Partial<User>) => {
    console.log('Profil mis à jour:', updatedUser);
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdMsg(null);
    if (newPwd.length < 8) {
      setPwdMsg(isFr ? 'Au moins 8 caractères.' : 'At least 8 characters.');
      return;
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg(isFr ? 'Les mots de passe ne correspondent pas.' : 'Passwords do not match.');
      return;
    }
    setPwdLoading(true);
    try {
      const { error } = await AuthService.updatePassword(newPwd);
      if (error) throw error;
      setPwdMsg(isFr ? 'Mot de passe mis à jour.' : 'Password updated.');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : isFr ? 'Échec de la mise à jour.' : 'Update failed.';
      setPwdMsg(msg);
    } finally {
      setPwdLoading(false);
    }
  };

  const getInitials = (name: string): string => {
    const parts = name.split(' ');
    const firstInitial = parts[0]?.charAt(0)?.toUpperCase() || '';
    const lastInitial = parts[parts.length - 1]?.charAt(0)?.toUpperCase() || '';
    return `${firstInitial}${lastInitial}` || 'U';
  };

  const personalNav: { id: PersonalPageId; labelFr: string; labelEn: string; icon: string }[] = [
    { id: 'profile', labelFr: 'Profil', labelEn: 'Profile', icon: 'fas fa-user' },
    { id: 'preferences', labelFr: 'Préférences', labelEn: 'Preferences', icon: 'fas fa-sliders-h' },
    { id: 'activity', labelFr: 'Notifications & activité', labelEn: 'Notifications & activity', icon: 'fas fa-bell' },
    { id: 'skills', labelFr: 'Compétences', labelEn: 'Skills', icon: 'fas fa-award' },
  ];

  const NavButton: React.FC<{
    active: boolean;
    icon: string;
    label: string;
    onClick: () => void;
  }> = ({ active, icon, label, onClick }) => (
          <button
            type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        active ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <i className={`${icon} w-5 text-center opacity-90`} aria-hidden />
      <span className="truncate">{label}</span>
          </button>
  );

  const renderAdminContent = () => {
    if (!adminPage) {
      return <p className="text-sm text-slate-500">{isFr ? 'Sélectionnez une rubrique à gauche.' : 'Pick a section on the left.'}</p>;
    }
    switch (adminPage) {
      case 'platform_labels':
        return (
          <div className="space-y-4">
            <ModuleLabelsEditor />
          </div>
        );
      case 'platform_dashboard':
        return (
          <div className="space-y-4">
            <DashboardSettingsEditor />
          </div>
        );
      case 'platform_projects':
        return (
          <div className="space-y-4">
            <ProjectModuleSettingsEditor />
        </div>
        );
      case 'platform_automation':
        return (
          <div className="space-y-4">
            {automationKpis ? (
              <>
                <p className="text-xs text-slate-500">{isFr ? 'Dernier cycle : ' : 'Last run: '}{new Date(automationKpis.cycleAt).toLocaleString(isFr ? 'fr-FR' : 'en-US')}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/80">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{isFr ? 'Actions' : 'Actions'}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{automationKpis.actions.total}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/80">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{isFr ? 'Notifications' : 'Notifications'}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">{automationKpis.actions.notifications}</p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/80">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{isFr ? 'Mises à jour auto' : 'Auto updates'}</p>
                    <p className="text-2xl font-bold text-slate-900 mt-1">
                      {automationKpis.actions.projectUpdates + automationKpis.actions.objectiveUpdates + automationKpis.actions.invoiceUpdates}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                    <p className="text-xs font-semibold text-sky-800">Info</p>
                    <p className="text-xl font-bold text-sky-950">{automationKpis.bySeverity.info}</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-xs font-semibold text-amber-900">Warning</p>
                    <p className="text-xl font-bold text-amber-950">{automationKpis.bySeverity.warning}</p>
                  </div>
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <p className="text-xs font-semibold text-rose-900">Critical</p>
                    <p className="text-xl font-bold text-rose-950">{automationKpis.bySeverity.critical}</p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">{isFr ? 'Aucun cycle d’automatisation disponible pour le moment.' : 'No automation cycle data yet.'}</p>
            )}
          </div>
        );
      case 'organization_management':
        return <OrganizationManagement />;
      case 'department_management':
        return <DepartmentManagement embedded />;
      case 'postes_management':
        return <PostesManagement />;
      case 'user_management':
        return (
          <UserManagement
            users={users}
            embedded
            onRefreshUsers={onRefreshUsers}
            // Mode autonome : si le parent ne fournit pas de callbacks,
            // le composant maintient une liste locale et applique les actions via DataService.
          />
        );
      case 'course_management':
        return onAddCourse && onUpdateCourse && onDeleteCourse ? (
          <CourseManagement
            courses={courses}
            users={users}
            onAddCourse={onAddCourse}
            onUpdateCourse={onUpdateCourse}
            onDeleteCourse={onDeleteCourse}
            embedded
            onOpenCrmCollecteForCourse={
              setView
                ? (courseId) => {
                    try {
                      sessionStorage.setItem(NAV_SESSION_COLLECTE_PRESET_FORMATION_ID, courseId);
                      sessionStorage.setItem(NAV_SESSION_CRM_OPEN_COLLECTE_TAB, '1');
                    } catch {
                      /* ignore */
                    }
                    setView('crm_sales');
                  }
                : undefined
            }
          />
        ) : (
          <p className="text-sm text-amber-700">{isFr ? 'Actions catalogue non disponibles.' : 'Catalog actions unavailable.'}</p>
        );
      case 'job_management':
        return onAddJob && onUpdateJob && onDeleteJob ? (
          <JobManagement
            jobs={jobs}
            onAddJob={onAddJob}
            onUpdateJob={onUpdateJob}
            onDeleteJob={onDeleteJob}
            onNavigate={setView}
            embedded
          />
        ) : (
          <p className="text-sm text-amber-700">{isFr ? 'Actions emploi non disponibles.' : 'Job actions unavailable.'}</p>
        );
      case 'leave_management_admin':
        return onUpdateLeaveRequest ? (
          <LeaveManagementAdmin
            leaveRequests={leaveRequests}
            users={users}
            onUpdateLeaveRequest={onUpdateLeaveRequest}
            onUpdateLeaveDates={onUpdateLeaveDates}
            onDeleteLeaveRequest={onDeleteLeaveRequest}
          />
        ) : (
          <p className="text-sm text-amber-700">{isFr ? 'Validation congés non disponible.' : 'Leave validation unavailable.'}</p>
        );
      case 'hr_evaluation':
        return <HrEvaluation embedded />;
      default:
        return null;
    }
  };

  const renderPersonalContent = () => {
    switch (personalPage) {
      case 'profile':
        return (
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {user?.avatar && !profileAvatarFailed ? (
              <img 
                src={user.avatar} 
                alt={user?.name} 
                  className="w-20 h-20 rounded-full border-2 border-emerald-500 object-cover shrink-0"
                onError={() => setProfileAvatarFailed(true)}
              />
              ) : (
                <div className="w-20 h-20 rounded-full border-2 border-emerald-500 bg-gradient-to-br from-emerald-500 via-green-500 to-blue-500 flex items-center justify-center text-white text-2xl font-bold shrink-0">
              {user ? getInitials(user.name) : 'U'}
            </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-xl text-slate-900 truncate">{user?.name}</p>
                <p className="text-slate-500 truncate">{user?.email}</p>
                {user?.role && <p className="text-sm capitalize text-emerald-600 font-semibold mt-1">{t(user.role)}</p>}
              {user?.phone && <p className="text-slate-500 text-sm mt-1">{user.phone}</p>}
              {user?.location && <p className="text-slate-500 text-sm mt-1">{user.location}</p>}
            </div>
              <button type="button" onClick={() => setProfileModalOpen(true)} className="btn-3d-primary shrink-0 self-start">
                <i className="fas fa-user-edit mr-2" />
                {isFr ? 'Modifier le profil' : 'Edit profile'}
              </button>
            </div>
            <form
              onSubmit={(e) => void handlePasswordChange(e)}
              className="mt-8 max-w-md space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-4"
            >
              <h3 className="text-sm font-semibold text-slate-800">
                <i className="fas fa-lock mr-2 text-emerald-600" aria-hidden />
                {isFr ? 'Sécurité — mot de passe' : 'Security — password'}
              </h3>
              <p className="text-xs text-slate-600">
                {isFr
                  ? 'Changez votre mot de passe à tout moment (par exemple après une première connexion avec un mot de passe provisoire). Au moins 8 caractères.'
                  : 'Change your password at any time (e.g. after signing in with a temporary password). At least 8 characters.'}
              </p>
              {pwdMsg && (
                <p className={`text-xs ${pwdMsg.includes('mis à jour') || pwdMsg.toLowerCase().includes('updated') ? 'text-emerald-700' : 'text-red-600'}`}>
                  {pwdMsg}
                </p>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700">{isFr ? 'Nouveau mot de passe' : 'New password'}</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
          </div>
              <div>
                <label className="block text-xs font-medium text-slate-700">{isFr ? 'Confirmer' : 'Confirm'}</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900"
                />
          </div>
              <button
                type="submit"
                disabled={pwdLoading}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {pwdLoading ? (isFr ? 'Enregistrement…' : 'Saving…') : isFr ? 'Mettre à jour le mot de passe' : 'Update password'}
              </button>
            </form>
          </div>
        );
      case 'preferences':
        return (
          <div className="space-y-8">
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('language')}</h3>
              <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50">
            <button
              type="button"
                  onClick={() => setLanguage(Language.EN)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${language === Language.EN ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}
            >
                  {t('english')}
            </button>
            <button
              type="button"
                  onClick={() => setLanguage(Language.FR)}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${language === Language.FR ? 'bg-white shadow text-slate-900' : 'text-slate-600'}`}
                >
                  {t('french')}
                </button>
          </div>
          </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-800 mb-3">{t('reminder_settings')}</h3>
              <div className="flex items-center gap-4 max-w-md">
                <label htmlFor="reminder-days" className="text-sm text-slate-600 shrink-0">
                  {t('remind_days_before')}
                </label>
            <input
              id="reminder-days"
              type="number"
              value={reminderDays}
              onChange={(e) => onSetReminderDays(Math.max(0, Number(e.target.value)))}
                  className="w-24 p-2 border border-slate-300 rounded-lg text-center text-slate-900"
                  min={0}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2">{isFr ? 'Utilisé pour les rappels d’échéances dans l’interface.' : 'Used for due-date reminders in the UI.'}</p>
            </div>
          </div>
        );
      case 'activity':
        return (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {isFr ? 'Accédez au centre de notifications et à l’historique d’activité (audit léger).' : 'Open the notification center and activity history.'}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={() => setView?.('notifications_center')}
              >
                <i className="fas fa-bell text-amber-600" aria-hidden />
                {isFr ? 'Centre de notifications' : 'Notification center'}
              </button>
            <button
              type="button"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium text-slate-800 hover:bg-slate-50"
                onClick={() => setView?.('activity_logs')}
            >
                <i className="fas fa-history text-slate-600" aria-hidden />
                {isFr ? 'Historique des activités' : 'Activity log'}
            </button>
              </div>
          </div>
        );
      case 'skills':
        return (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">{t('skill_passport_subtitle')}</p>
            <div className="flex flex-wrap gap-2">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="bg-emerald-50 text-emerald-900 text-sm font-medium px-3 py-1.5 rounded-full border border-emerald-100 flex items-center gap-2"
                >
                  {skill}
                  <button type="button" onClick={() => handleRemoveSkill(skill)} className="text-emerald-700 hover:text-emerald-900" aria-label={isFr ? 'Retirer' : 'Remove'}>
                    <i className="fas fa-times-circle text-xs" />
            </button>
                </span>
              ))}
              </div>
            <form onSubmit={handleAddSkill} className="flex flex-col sm:flex-row gap-2 max-w-lg">
              <input
                type="text"
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                placeholder={t('enter_skill')}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-slate-900"
              />
              <button type="submit" className="btn-3d-primary px-4 py-2 rounded-lg whitespace-nowrap">
                {t('add_skill')}
              </button>
            </form>
          </div>
        );
      default:
        return null;
    }
  };

  const groupedAdminNav = useMemo(() => {
    const m = new Map<string, typeof adminNavItems>();
    adminNavItems.forEach((item) => {
      const g = isFr ? item.groupFr : item.groupEn;
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(item);
    });
    return Array.from(m.entries());
  }, [adminNavItems, isFr]);

  const currentPersonalTitle = personalNav.find((p) => p.id === personalPage)?.[isFr ? 'labelFr' : 'labelEn'] ?? '';
  const currentAdminTitle = adminNavItems.find((p) => p.id === adminPage)?.[isFr ? 'labelFr' : 'labelEn'] ?? '';

  const adminPageHelp = useMemo((): { fr: string; en: string } | null => {
    if (!adminPage) return null;
    const map: Record<AdminPageId, { fr: string; en: string }> = {
      platform_labels: {
        fr: 'Personnalisez les noms des modules (barre latérale, écrans de droits).',
        en: 'Customize module display names (sidebar, permissions screens).',
      },
      platform_dashboard: {
        fr: 'Activez ou masquez les blocs du tableau de bord pour l’organisation.',
        en: 'Show or hide dashboard blocks for the organization.',
      },
      platform_projects: {
        fr: 'Paramètres transverses du module Projets (types, statuts, alertes).',
        en: 'Cross-cutting Projects module settings (types, statuses, alerts).',
      },
      platform_automation: {
        fr: 'Indicateurs du dernier cycle d’automatisation (workflows, notifications).',
        en: 'Metrics from the last automation cycle (workflows, notifications).',
      },
      organization_management: isSingleOrganizationTenantMode()
        ? {
            fr: 'Mode maintenance : une seule organisation listée. Désactivez VITE_SINGLE_ORGANIZATION_MODE pour les tenants hébergés.',
            en: 'Maintenance mode: only one organization listed. Disable VITE_SINGLE_ORGANIZATION_MODE for hosted tenants.',
          }
        : {
            fr: 'Organisation plateforme (mère) + tenants hébergés : fiches, nom ; restrictions modules et droits via Utilisateurs & droits.',
            en: 'Platform org plus hosted tenants: details and naming; module restrictions via Users & permissions.',
          },
      department_management: {
        fr: 'CRUD départements : fiche, équipe (superviseur / managers), édition, activer-désactiver, suppression.',
        en: 'Department CRUD: roster, supervisor/managers, edit, toggle active, delete.',
      },
      postes_management: {
        fr: 'Référentiel des postes et fiches de poste (organigramme).',
        en: 'Job positions and role descriptions (org chart).',
      },
      user_management: {
        fr: 'Comptes, rôles, suspension et permissions fines par module.',
        en: 'Accounts, roles, suspension and fine-grained module permissions.',
      },
      course_management: {
        fr: 'Catalogue des formations : création, publication et suivi.',
        en: 'Training catalog: create, publish and track.',
      },
      job_management: {
        fr: 'Offres d’emploi et candidatures (lien vers création détaillée).',
        en: 'Job postings and applicants (links to full create flow).',
      },
      leave_management_admin: {
        fr: 'Validation des demandes de congés et ajustements de dates.',
        en: 'Leave request validation and date adjustments.',
      },
      hr_evaluation: {
        fr: 'Matrices KPI et agrégation des signaux RH (feuille de route).',
        en: 'KPI matrices and aggregated HR signals (roadmap).',
      },
    };
    return map[adminPage] ?? null;
  }, [adminPage]);

  const personalPageHelp = useMemo((): { fr: string; en: string } | null => {
    const map: Record<PersonalPageId, { fr: string; en: string }> = {
      profile: {
        fr: 'Identité, coordonnées et photo affichées dans l’application.',
        en: 'Identity, contact details and profile photo.',
      },
      preferences: {
        fr: 'Langue, thème et rappels liés à votre expérience.',
        en: 'Language, theme and reminders for your experience.',
      },
      activity: {
        fr: 'Historique des notifications et événements récents.',
        en: 'Notification history and recent events.',
      },
      skills: {
        fr: 'Compétences affichées sur votre profil et utilisées pour le matching.',
        en: 'Skills shown on your profile and used for matching.',
      },
    };
    return map[personalPage];
  }, [personalPage]);

  return (
    <div className="p-6 space-y-6 text-gray-900">
      <header className="border-b border-gray-200 pb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('settings_title')}</h1>
        <p className="text-sm text-slate-500 mt-2 max-w-2xl">
          {showAdminTab
            ? isFr
              ? 'Structure type « Paramètres Odoo » : rubriques à gauche, contenu à droite. Votre compte d’abord, l’administration ensuite.'
              : 'Odoo-style settings: sections on the left, content on the right. Account first, then administration.'
            : isFr
              ? 'Paramètres de votre compte et de votre expérience dans l’application.'
              : 'Your account and application preferences.'}
        </p>
      </header>

      <ModuleRichHub
          isFr={isFr}
          metrics={[
            {
              labelFr: 'Automatisations (scan)',
              labelEn: 'Automation (scan)',
              value: automationKpis ? String(automationKpis.scanned.projects) : '—',
              hintFr: 'Projets scannés dernier cycle',
              hintEn: 'Projects scanned last cycle',
            },
            {
              labelFr: 'Actions auto',
              labelEn: 'Auto actions',
              value: automationKpis ? String(automationKpis.actions.total) : '—',
              hintFr: 'Notifications & mises à jour',
              hintEn: 'Notifications & updates',
            },
            {
              labelFr: 'Sévérité critique',
              labelEn: 'Critical severity',
              value: automationKpis ? String(automationKpis.bySeverity.critical) : '—',
              hintFr: 'Observabilité plateforme',
              hintEn: 'Platform observability',
            },
            {
              labelFr: 'Utilisateurs',
              labelEn: 'Users',
              value: users?.length != null ? String(users.length) : '—',
              hintFr: 'Annuaire chargé',
              hintEn: 'Directory loaded',
            },
          ]}
          sections={[
            {
              key: 'settings-nav',
              titleFr: 'Paramètres comme hub d’administration',
              titleEn: 'Settings as an admin hub',
              icon: 'fas fa-sliders-h',
              bulletsFr: [
                'Rubriques plateforme (super-admin) : libellés, widgets dashboard, automatisation.',
                'Rubriques organisation : utilisateurs, postes, formations, congés.',
                'Les modules métier restent accessibles via la barre latérale.',
              ],
              bulletsEn: [
                'Platform sections (super-admin): labels, dashboard widgets, automation.',
                'Organization sections: users, positions, courses, leave.',
                'Business modules stay reachable from the sidebar.',
              ],
            },
          ]}
        />

      {showAdminTab ? (
        <div className="flex p-1 mb-8 bg-slate-100 rounded-xl border border-slate-200 max-w-md">
            <button
              type="button"
            onClick={() => {
              setSettingsTab('personal');
              setPersonalPage('profile');
            }}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              settingsTab === 'personal' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fas fa-user mr-2 text-emerald-600" aria-hidden />
            {isFr ? 'Mon compte' : 'My account'}
            </button>
                  <button
                    type="button"
            onClick={() => {
              setSettingsTab('admin');
              if (adminNavItems.length && !adminPage) setAdminPage(adminNavItems[0].id);
            }}
            className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
              settingsTab === 'admin' ? 'bg-white text-slate-900 shadow-sm border border-slate-200/80' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <i className="fas fa-cog mr-2 text-slate-700" aria-hidden />
            {isFr ? 'Administration' : 'Administration'}
                  </button>
        </div>
      ) : null}

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Navigation latérale */}
        <aside className="w-full lg:w-60 shrink-0 lg:sticky lg:top-4 space-y-6">
          {(!showAdminTab || settingsTab === 'personal') && (
            <nav className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm" aria-label={isFr ? 'Paramètres personnels' : 'Personal settings'}>
              <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{isFr ? 'Mon espace' : 'My workspace'}</p>
              <div className="space-y-0.5 pb-2">
                {personalNav.map((item) => (
                  <NavButton
                    key={item.id}
                    active={personalPage === item.id}
                    icon={item.icon}
                    label={isFr ? item.labelFr : item.labelEn}
                    onClick={() => setPersonalPage(item.id)}
                  />
                ))}
              </div>
            </nav>
          )}

          {showAdminTab && settingsTab === 'admin' && (
            <nav className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm" aria-label={isFr ? 'Administration' : 'Administration'}>
              {adminNavItems.length === 0 ? (
                <p className="text-sm text-slate-500 px-3 py-4">{isFr ? 'Aucune rubrique admin accessible.' : 'No admin sections available.'}</p>
              ) : (
                groupedAdminNav.map(([group, items]) => (
                  <div key={group} className="mb-2 last:mb-0">
                    <p className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">{group}</p>
                    <div className="space-y-0.5 pb-2">
                      {items.map((item) => (
                        <NavButton
                          key={item.id}
                          active={adminPage === item.id}
                          icon={item.icon}
                          label={isFr ? item.labelFr : item.labelEn}
                          onClick={() => setAdminPage(item.id)}
                        />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </nav>
          )}
        </aside>

        {/* Contenu principal */}
        <main className="flex-1 min-w-0 w-full">
          {(!showAdminTab || settingsTab === 'personal') && (
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80">
                <h2 className="text-lg font-semibold text-slate-900">{currentPersonalTitle}</h2>
                {personalPageHelp ? (
                  <p className="text-sm text-slate-600 mt-1.5 max-w-3xl">{isFr ? personalPageHelp.fr : personalPageHelp.en}</p>
                ) : null}
              </div>
              <div className="p-5">{renderPersonalContent()}</div>
            </section>
          )}

          {showAdminTab && settingsTab === 'admin' && (
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden min-h-[320px]">
              <div className="px-5 py-4 border-b border-slate-100 bg-slate-50/80 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold text-slate-900">{currentAdminTitle}</h2>
                  {adminPageHelp ? (
                    <p className="text-sm text-slate-600 mt-1.5 max-w-3xl">{isFr ? adminPageHelp.fr : adminPageHelp.en}</p>
                  ) : null}
                </div>
                {adminPage && ADMIN_MODULE_BY_PAGE[adminPage] && (
                  <span className="shrink-0 text-xs font-mono text-slate-400">{ADMIN_MODULE_BY_PAGE[adminPage]}</span>
              )}
              </div>
              <div className="p-5">{renderAdminContent()}</div>
            </section>
        )}
        </main>
      </div>

      {isProfileModalOpen && user && (
        <UserProfileEdit user={user} onClose={() => setProfileModalOpen(false)} onSave={handleSaveProfile} />
      )}
    </div>
  );
};

export default Settings;
