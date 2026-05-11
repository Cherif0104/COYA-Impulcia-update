import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useLocalization } from '../contexts/LocalizationContext';
import { Course, Job, Project, TimeLog, LeaveRequest, Invoice, Expense, Role, Language, Objective, ModuleName } from '../types';
import PresenceCountdownWidget from './PresenceCountdownWidget';
import DashboardAvatar from './dashboard/DashboardAvatar';
import { useDashboardData } from '../hooks/useDashboardData';
import { useDashboardMetrics } from '../hooks/useDashboardMetrics';
import { useModuleLabels } from '../hooks/useModuleLabels';
import { useDashboardSettings } from '../hooks/useDashboardSettings';
import { usePlanningToday } from '../hooks/usePlanningToday';
import DashboardHeaderBar from './dashboard/DashboardHeaderBar';
import KPICard from './dashboard/KPICard';
import ProjectRepartitionDonut from './dashboard/ProjectRepartitionDonut';
import HoursTrendLineChart from './dashboard/HoursTrendLineChart';
import MainBalanceStyleCard from './dashboard/MainBalanceStyleCard';
import RecentActivitiesList from './dashboard/RecentActivitiesList';
import PendingOrdersBlock from './dashboard/PendingOrdersBlock';
import PerformanceCabanes from './dashboard/PerformanceCabanes';
import AnalyticsPredictif from './dashboard/AnalyticsPredictif';
import DashboardSkeleton from './dashboard/DashboardSkeleton';
import WorkforceDayTimelineCard from './workforce/WorkforceDayTimelineCard';
import { WorkspaceShell } from '../ui-runtime';
import { projectsHomeView } from '../utils/programmesProjectsNav';
import type { DonutSlice } from './dashboard/ProjectRepartitionDonut';
import type { PerformanceCabaneItem, PerformanceLevel } from './dashboard/PerformanceCabanes';
import type { TimeSeriesPoint } from './dashboard/HoursTrendLineChart';
import type { RecentActivityItem } from './dashboard/RecentActivitiesList';
import type { PendingBlockItem } from './dashboard/PendingOrdersBlock';

interface DashboardProps {
  setView: (view: string) => void;
  projects: Project[];
  courses: Course[];
  jobs: Job[];
  timeLogs: TimeLog[];
  leaveRequests: LeaveRequest[];
  invoices: Invoice[];
  expenses: Expense[];
  objectives?: Objective[];
  canAccessModule?: (module: ModuleName) => boolean;
  isDataLoaded?: boolean;
}

const CourseCard: React.FC<{ course: Course }> = ({ course }) => {
    const { t } = useLocalization();
    return (
        <div className="coya-card coya-card-hover flex items-center gap-4 p-5 transition-shadow">
            <div className="rounded-xl bg-coya-primary/12 text-coya-primary p-3">
                <i className={`${course.icon} fa-lg`}></i>
            </div>
            <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-gray-900">{course.title}</h3>
                <p className="text-sm text-gray-500">{course.instructor}</p>
                 <div className="mt-2">
                    <div className="flex justify-between text-sm text-gray-600 mb-1">
                        <span>{t('course_progress')}</span>
                        <span>{course.progress}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                        <div className="bg-coya-green h-2 rounded-full transition-all" style={{ width: `${course.progress}%` }}></div>
                    </div>
                </div>
            </div>
        </div>
    );
}

const JobCard: React.FC<{ job: Job }> = ({ job }) => {
    return (
        <div className="coya-card coya-card-hover p-5 transition-shadow">
            <div className="flex justify-between items-start gap-2">
                <div className="min-w-0">
                    <h3 className="font-semibold text-gray-900">{job.title}</h3>
                    <p className="text-sm text-gray-600">{job.company}</p>
                </div>
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${job.type === 'Full-time' ? 'bg-coya-primary/15 text-coya-primary' : 'bg-coya-institutional-accent/25 text-amber-900'}`}>
                    {job.type}
                </span>
            </div>
            <p className="text-sm text-gray-500 mt-2"><i className="fas fa-map-marker-alt mr-2 text-coya-primary/70"></i>{job.location}</p>
        </div>
    );
};

const ProjectCard: React.FC<{ project: Project }> = ({ project }) => {
     const statusColor = {
        'In Progress': 'bg-blue-100 text-blue-800',
        'Completed': 'bg-green-100 text-green-800',
        'Not Started': 'bg-gray-100 text-gray-800',
    };
    return (
         <div className="coya-card coya-card-hover p-5 transition-shadow">
             <div className="flex justify-between items-start gap-2">
                <h3 className="font-semibold text-gray-900 min-w-0">{project.title}</h3>
                <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full ${statusColor[project.status]}`}>
                    {project.status}
                </span>
            </div>
            <p className="text-sm text-gray-500 mt-2">Due: {project.dueDate}</p>
        </div>
    );
}

const ProjectStatusPieChart: React.FC<{ projects: Project[]; onViewProjects: () => void }> = ({ projects, onViewProjects }) => {
    const { t, language } = useLocalization();
    const localize = (en: string, fr: string) => (language === Language.FR ? fr : en);

    const statusCounts = useMemo(() => {
        const counts: { [key in Project['status']]: number } = {
            'Not Started': 0,
            'In Progress': 0,
            'Completed': 0,
        };
        projects.forEach(p => counts[p.status]++);
        return counts;
    }, [projects]);

    const totalProjects = projects.length;
    if (totalProjects === 0) {
        return (
            <div className="bg-white p-6 rounded-lg shadow-md">
                <h2 className="text-xl font-bold text-gray-700 mb-4">{t('project_status_overview')}</h2>
                <div className="text-center py-8">
                    <div className="text-gray-400 mb-4">
                        <i className="fas fa-folder-open text-4xl"></i>
                    </div>
                    <p className="text-gray-600 mb-4">{localize('No projects created yet', 'Aucun projet créé pour le moment')}</p>
                    <button 
                        onClick={() => onViewProjects()}
                        className="bg-coya-primary text-white px-4 py-2 rounded-lg hover:bg-coya-primary-light transition-colors"
                    >
                        {localize('Create your first project', 'Créer votre premier projet')}
                    </button>
                </div>
            </div>
        );
    }

    const percentages = {
        completed: (statusCounts['Completed'] / totalProjects) * 100,
        inProgress: (statusCounts['In Progress'] / totalProjects) * 100,
        notStarted: (statusCounts['Not Started'] / totalProjects) * 100,
    };

    const conicGradient = `conic-gradient(
        #22c55e 0% ${percentages.completed}%,
        #3b82f6 ${percentages.completed}% ${percentages.completed + percentages.inProgress}%,
        #d1d5db ${percentages.completed + percentages.inProgress}% 100%
    )`;

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-bold text-gray-700 mb-4">{t('project_status_overview')}</h2>
            <div className="flex items-center justify-center space-x-8">
                <div className="relative w-32 h-32">
                    <div
                        className="rounded-full w-full h-full"
                        style={{ background: conicGradient }}
                    ></div>
                     <div className="absolute inset-2 bg-white rounded-full flex items-center justify-center">
                        <span className="text-2xl font-bold">{totalProjects}</span>
                    </div>
                </div>
                <div className="space-y-2 text-sm">
                    <div className="flex items-center">
                        <span className="w-3 h-3 rounded-full bg-coya-primary mr-2"></span>
                        <span>{t('completed')} ({statusCounts['Completed']})</span>
                    </div>
                    <div className="flex items-center">
                        <span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>
                        <span>{t('in_progress')} ({statusCounts['In Progress']})</span>
                    </div>
                    <div className="flex items-center">
                        <span className="w-3 h-3 rounded-full bg-gray-300 mr-2"></span>
                        <span>{t('not_started')} ({statusCounts['Not Started']})</span>
                    </div>
                </div>
            </div>
        </div>
    );
};


const TeamAvailabilityCard: React.FC<{ leaveRequests: LeaveRequest[]; setView: (view: string) => void; }> = ({ leaveRequests, setView }) => {
    const { t } = useLocalization();
    const today = new Date();
    const nextSevenDays = new Date();
    nextSevenDays.setDate(today.getDate() + 7);

    const upcomingLeaves = leaveRequests.filter(req => {
        const startDate = new Date(req.startDate);
        return req.status === 'Approved' && startDate >= today && startDate <= nextSevenDays;
    }).sort((a,b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
    
    return (
        <div className="bg-coya-card p-6 rounded-lg shadow-md">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold text-coya-text">{t('team_availability')}</h2>
                 <a href="#" onClick={(e) => { e.preventDefault(); setView('leave_management'); }} className="text-sm font-medium text-coya-primary hover:text-coya-primary-light">{t('manage_leaves')}</a>
            </div>
            <div className="space-y-3">
                <h3 className="text-sm font-semibold text-coya-text-muted uppercase">{t('upcoming_leaves')}</h3>
                {upcomingLeaves.length > 0 ? (
                    upcomingLeaves.slice(0, 3).map(req => (
                        <div key={req.id} className="flex items-center space-x-3">
                            <img src={req.userAvatar} alt={req.userName} className="w-8 h-8 rounded-full" />
                            <div>
                                <p className="font-semibold text-coya-text">{req.userName}</p>
                                <p className="text-xs text-coya-text-muted">{new Date(req.startDate).toLocaleDateString()} - {new Date(req.endDate).toLocaleDateString()}</p>
                            </div>
                        </div>
                    ))
                ) : (
                    <p className="text-sm text-coya-text-muted">{t('no_upcoming_leaves')}</p>
                )}
            </div>
        </div>
    );
};

/** Bloc récap OKR / Objectifs sur le dashboard */
const OKRSummaryCard: React.FC<{ objectives: Objective[]; setView: (view: string) => void; }> = ({ objectives, setView }) => {
  const { t, language } = useLocalization();
  const localize = (en: string, fr: string) => (language === Language.FR ? fr : en);
  const list = objectives || [];
  const completed = list.filter(obj => {
    const progress = obj.progress;
    if (progress != null) return progress >= 100;
    return obj.keyResults?.length > 0 && obj.keyResults.every(kr => kr.current >= kr.target);
  }).length;
  const inProgress = list.length - completed;

  return (
    <div className="bg-coya-card p-6 rounded-lg shadow-md">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-coya-text flex items-center gap-2">
          <i className="fas fa-bullseye text-coya-primary"></i>
          {localize('My OKRs', 'Mes OKR')}
        </h2>
        <a href="#" onClick={(e) => { e.preventDefault(); setView('goals_okrs'); }} className="text-sm font-medium text-coya-primary hover:text-coya-primary-light">
          {localize('View all', 'Voir tous')}
        </a>
      </div>
      <div className="grid grid-cols-2 gap-4 text-center">
        <div>
          <p className="text-2xl font-bold text-coya-primary">{inProgress}</p>
          <p className="text-sm text-coya-text-muted">{localize('In progress', 'En cours')}</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-coya-emeraude">{completed}</p>
          <p className="text-sm text-coya-text-muted">{localize('Completed', 'Terminés')}</p>
        </div>
      </div>
      {list.length === 0 && (
        <p className="text-sm text-coya-text-muted mt-2 text-center">{localize('No objectives yet', 'Aucun objectif pour le moment')}</p>
      )}
    </div>
  );
};

// Composant pour le message de bienvenue selon l'heure
const WelcomeMessage: React.FC<{ userName: string }> = ({ userName }) => {
  const { language } = useLocalization();
  const localize = (en: string, fr: string) => (language === Language.FR ? fr : en);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Mise à jour chaque minute
    
    return () => clearInterval(timer);
  }, []);

  const getGreeting = () => {
    const hour = currentTime.getHours();
    if (hour < 12) return localize('Good morning', 'Bonjour');
    if (hour < 18) return localize('Good afternoon', 'Bon après-midi');
    return localize('Good evening', 'Bonsoir');
  };

  const formatTime = () => {
    const locale = language === Language.FR ? 'fr-FR' : 'en-US';
    return currentTime.toLocaleTimeString(locale, { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-3">
      <h1 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
        {getGreeting()}, <span className="text-white/95">{userName}</span>!
      </h1>
      <span className="text-sm tabular-nums text-white/60">{formatTime()}</span>
    </div>
  );
};

// Badge de rôle avec couleurs
const RoleBadge: React.FC<{ role: Role }> = ({ role }) => {
  const { t } = useLocalization();
  const roleConfig: Record<string, { color: string; bgColor: string }> = {
    super_administrator: { color: 'text-[var(--coya-bg)]', bgColor: 'bg-[var(--coya-gap)]' },
    administrator: { color: 'text-purple-800', bgColor: 'bg-purple-100' },
    manager: { color: 'text-blue-800', bgColor: 'bg-blue-100' },
    supervisor: { color: 'text-indigo-800', bgColor: 'bg-indigo-100' },
    intern: { color: 'text-gray-800', bgColor: 'bg-gray-100' },
    student: { color: 'text-green-800', bgColor: 'bg-green-100' },
    entrepreneur: { color: 'text-yellow-800', bgColor: 'bg-yellow-100' },
    employer: { color: 'text-orange-800', bgColor: 'bg-orange-100' },
    trainer: { color: 'text-teal-800', bgColor: 'bg-teal-100' },
    mentor: { color: 'text-pink-800', bgColor: 'bg-pink-100' },
    coach: { color: 'text-cyan-800', bgColor: 'bg-cyan-100' },
  };

  const config = roleConfig[role] || { color: 'text-gray-800', bgColor: 'bg-gray-100' };

  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${config.color} ${config.bgColor}`}>
      <i className="fas fa-user-tag mr-1.5"></i>
      {t(role)}
    </span>
  );
};

// Types pour la synthèse par module (analyse intelligente connectée aux données)
type InsightCardId = 'projects' | 'courses' | 'comptabilite' | 'time' | 'rh' | 'predictions';
type InsightStatus = 'success' | 'warning' | 'info' | 'danger';

interface SynthesisCard {
  id: InsightCardId;
  view: string;
  icon: string;
  title: string;
  metric: string;
  summary: string;
  status: InsightStatus;
  detailTitle: string;
  detailItems: string[];
  recommendation: string;
}

// Section Analyse intelligente : synthèses par module (algorithmes + cartes cliquables + page détail)
const IntelligentInsights: React.FC<{
  setView: (view: string) => void;
  onNavigateToProjects: () => void;
  canAccessModule?: (m: ModuleName) => boolean;
  projects: Project[];
  courses: Course[];
  timeLogs: TimeLog[];
  invoices: Invoice[];
  expenses: Expense[];
  leaveRequests: LeaveRequest[];
}> = ({ setView, onNavigateToProjects, canAccessModule, projects, courses, timeLogs, invoices, expenses, leaveRequests }) => {
  const { language } = useLocalization();
  const [detailCategory, setDetailCategory] = useState<InsightCardId | null>(null);

    const localize = (en: string, fr: string) => (language === Language.FR ? fr : en);
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
  const cards = useMemo((): SynthesisCard[] => {
    const list: SynthesisCard[] = [];
    const activeProjects = projects.filter(p => p.status === 'In Progress');
    const completedProjects = projects.filter(p => p.status === 'Completed');
    const completionRate = projects.length > 0 ? (completedProjects.length / projects.length) * 100 : 0;
    const overdueProjects = projects.filter(p => {
      if (p.status === 'Completed' || p.status === 'Not Started') return false;
      return new Date(p.dueDate) < now;
    });

    if (canAccessModule === undefined || canAccessModule('projects' as ModuleName)) {
      const status: InsightStatus = overdueProjects.length > 0 ? 'danger' : completionRate >= 80 ? 'success' : completionRate < 50 ? 'warning' : 'info';
      const metric = projects.length === 0 ? localize('No projects', 'Aucun projet') : `${activeProjects.length} ${localize('in progress', 'en cours')}`;
      const summary = overdueProjects.length > 0
        ? localize(`${overdueProjects.length} overdue. Review priorities.`, `${overdueProjects.length} en retard. Revoyez les priorités.`)
        : completionRate >= 80
          ? localize('Excellent completion rate.', 'Taux de complétion excellent.')
          : localize(`${completedProjects.length}/${projects.length} completed.`, `${completedProjects.length}/${projects.length} terminés.`);
      list.push({
        id: 'projects',
        view: 'projects',
        icon: 'fas fa-project-diagram',
        title: localize('Projects', 'Projets'),
        metric,
        summary,
        status,
        detailTitle: localize('Project analysis', 'Analyse Projets'),
        detailItems: [
          localize(`Total: ${projects.length}`, `Total : ${projects.length}`),
          localize(`In progress: ${activeProjects.length}`, `En cours : ${activeProjects.length}`),
          localize(`Completed: ${completedProjects.length}`, `Terminés : ${completedProjects.length}`),
          localize(`Completion rate: ${completionRate.toFixed(0)}%`, `Taux de complétion : ${completionRate.toFixed(0)} %`),
          ...(overdueProjects.length > 0 ? [localize(`Overdue: ${overdueProjects.length}`, `En retard : ${overdueProjects.length}`)] : []),
        ],
        recommendation: localize('Prioritize by due date and impact.', 'Priorisez par échéance et impact.'),
      });
    }

    if (canAccessModule === undefined || canAccessModule('courses' as ModuleName)) {
      const avgProgress = courses.length > 0 ? courses.reduce((s, c) => s + c.progress, 0) / courses.length : 0;
      const inProgress = courses.filter(c => c.progress > 0 && c.progress < 100).length;
      const status: InsightStatus = avgProgress >= 75 ? 'success' : avgProgress < 30 && courses.length > 0 ? 'warning' : 'info';
      const metric = courses.length === 0 ? localize('No courses', 'Aucune formation') : `${courses.length} ${localize('courses', 'formations')}`;
      const summary = courses.length === 0 ? localize('Start a course.', 'Démarrez une formation.') : localize(`Avg. progress ${avgProgress.toFixed(0)}%. ${inProgress} in progress.`, `Progression moy. ${avgProgress.toFixed(0)} %. ${inProgress} en cours.`);
      list.push({
        id: 'courses',
        view: 'formation',
        icon: 'fas fa-book-open',
        title: localize('Training', 'Formations'),
        metric,
        summary,
        status,
        detailTitle: localize('Training analysis', 'Analyse Formations'),
        detailItems: [
          localize(`Courses: ${courses.length}`, `Formations : ${courses.length}`),
          localize(`Average progress: ${avgProgress.toFixed(0)}%`, `Progression moyenne : ${avgProgress.toFixed(0)} %`),
          localize(`In progress: ${inProgress}`, `En cours : ${inProgress}`),
        ],
        recommendation: localize('Set regular time for training.', 'Réservez des créneaux réguliers.'),
      });
    }

    const paidInvoices = invoices.filter(inv => inv.status === 'Paid').reduce((s, inv) => s + inv.amount, 0);
    const unpaidAmount = invoices.filter(inv => inv.status !== 'Paid' && inv.status !== 'Draft').reduce((s, inv) => s + inv.amount, 0);
    const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
    const netIncome = paidInvoices - totalExpenses;
    const margin = paidInvoices > 0 ? ((netIncome / paidInvoices) * 100).toFixed(0) : '0';

    if (canAccessModule === undefined || canAccessModule('comptabilite')) {
      const status: InsightStatus = netIncome < 0 ? 'danger' : unpaidAmount > paidInvoices * 0.5 ? 'warning' : netIncome > paidInvoices * 0.3 ? 'success' : 'info';
      const metric = localize(`Net ${netIncome >= 0 ? '+' : ''}$${netIncome.toFixed(0)}`, `Net ${netIncome >= 0 ? '+' : ''}${netIncome.toFixed(0)} $`);
      const summary = netIncome < 0
        ? localize('Expenses exceed revenue. Review budget.', 'Dépenses > revenus. Revoyez le budget.')
        : localize(`Margin ${margin}%. Revenue: $${paidInvoices.toFixed(0)}.`, `Marge ${margin} %. Revenus : ${paidInvoices.toFixed(0)} $.`);
      list.push({
        id: 'comptabilite',
        view: 'comptabilite',
        icon: 'fas fa-file-invoice-dollar',
        title: localize('Accounting', 'Comptabilité'),
        metric,
        summary,
        status,
        detailTitle: localize('Financial analysis', 'Analyse comptable'),
        detailItems: [
          localize(`Revenue (paid): $${paidInvoices.toFixed(2)}`, `Revenus (payés) : ${paidInvoices.toFixed(2)} $`),
          localize(`Expenses: $${totalExpenses.toFixed(2)}`, `Dépenses : ${totalExpenses.toFixed(2)} $`),
          localize(`Net: $${netIncome.toFixed(2)}`, `Net : ${netIncome.toFixed(2)} $`),
          localize(`Margin: ${margin}%`, `Marge : ${margin} %`),
          localize(`Pending (unpaid): $${unpaidAmount.toFixed(2)}`, `En attente : ${unpaidAmount.toFixed(2)} $`),
        ],
        recommendation: localize('Monitor cash flow and unpaid invoices.', 'Suivez la trésorerie et les factures impayées.'),
      });
    }

    const recentTimeLogs = timeLogs.filter(log => new Date(log.date) >= last7Days);
    const weeklyHours = recentTimeLogs.reduce((sum, log) => sum + log.duration, 0) / 60;
    const previousWeekLogs = timeLogs.filter(log => {
      const d = new Date(log.date);
      const prevStart = new Date(last7Days.getTime() - 7 * 24 * 60 * 60 * 1000);
      return d >= prevStart && d < last7Days;
    });
    const previousWeekHours = previousWeekLogs.reduce((sum, log) => sum + log.duration, 0) / 60;
    const changePercent = previousWeekHours > 0 ? ((weeklyHours - previousWeekHours) / previousWeekHours) * 100 : 0;

    if (canAccessModule === undefined || canAccessModule('planning')) {
      const status: InsightStatus = weeklyHours > 40 ? 'warning' : changePercent > 20 ? 'success' : changePercent < -20 ? 'warning' : 'info';
      const metric = localize(`${weeklyHours.toFixed(1)}h this week`, `${weeklyHours.toFixed(1)} h cette semaine`);
      const summary = weeklyHours > 40
        ? localize('High workload. Preserve balance.', 'Charge élevée. Préservez l\'équilibre.')
        : changePercent > 20
          ? localize(`+${changePercent.toFixed(0)}% vs last week.`, `+${changePercent.toFixed(0)} % vs semaine dernière.`)
          : localize(`${recentTimeLogs.length} entries.`, `${recentTimeLogs.length} saisie(s).`);
      list.push({
        id: 'time',
        view: 'planning',
        icon: 'fas fa-clock',
        title: localize('Time', 'Temps'),
        metric,
        summary,
        status,
        detailTitle: localize('Time & planning', 'Temps & planification'),
        detailItems: [
          localize(`This week: ${weeklyHours.toFixed(1)}h`, `Cette semaine : ${weeklyHours.toFixed(1)} h`),
          localize(`Last week: ${previousWeekHours.toFixed(1)}h`, `Semaine dernière : ${previousWeekHours.toFixed(1)} h`),
          localize(`Variation: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(0)}%`, `Variation : ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(0)} %`),
          localize(`Entries (7 days): ${recentTimeLogs.length}`, `Saisies (7 j) : ${recentTimeLogs.length}`),
        ],
        recommendation: weeklyHours > 40 ? localize('Delegate or postpone non-urgent tasks.', 'Déléguer ou reporter les tâches non urgentes.') : localize('Open planning to align your week.', 'Ouvrez la planification pour caler votre semaine.'),
      });
    }

    const pendingLeave = leaveRequests.filter(r => r.status === 'Pending').length;
    if (canAccessModule === undefined || canAccessModule('rh' as ModuleName)) {
      const status: InsightStatus = pendingLeave > 0 ? 'info' : 'success';
      const metric = pendingLeave > 0 ? `${pendingLeave} ${localize('pending', 'en attente')}` : localize('Up to date', 'À jour');
      list.push({
        id: 'rh',
        view: 'rh',
        icon: 'fas fa-users-cog',
        title: localize('HR / Leave', 'RH / Congés'),
        metric,
        summary: pendingLeave > 0 ? localize('Leave requests to process.', 'Demandes de congés à traiter.') : localize('No pending requests.', 'Aucune demande en attente.'),
        status,
        detailTitle: localize('Leave analysis', 'Analyse Congés'),
        detailItems: [
          localize(`Total requests: ${leaveRequests.length}`, `Demandes : ${leaveRequests.length}`),
          localize(`Pending: ${pendingLeave}`, `En attente : ${pendingLeave}`),
        ],
        recommendation: pendingLeave > 0 ? localize('Review leave requests in RH.', 'Consulter les demandes dans RH.') : localize('All caught up.', 'Tout est à jour.'),
      });
    }

    if (activeProjects.length > 0) {
      const estimated = Math.max(1, Math.round(activeProjects.length * 0.3));
      list.push({
        id: 'predictions',
        view: 'projects',
        icon: 'fas fa-chart-line',
        title: localize('Predictions', 'Prédictions'),
        metric: localize(`~${estimated} soon`, `~${estimated} sous peu`),
        summary: localize(`About ${estimated} project(s) could be completed in the coming weeks.`, `Environ ${estimated} projet(s) complétable(s) dans les prochaines semaines.`),
        status: 'info',
        detailTitle: localize('Projections', 'Prédictions'),
        detailItems: [
          localize(`Active projects: ${activeProjects.length}`, `Projets actifs : ${activeProjects.length}`),
          localize(`Estimated completions (weeks): ~${estimated}`, `Complétions estimées : ~${estimated}`),
        ],
        recommendation: localize('Focus on high-impact projects first.', 'Concentrez-vous d\'abord sur les projets à fort impact.'),
      });
    }

    return list;
  }, [projects, courses, timeLogs, invoices, expenses, leaveRequests, language, canAccessModule]);

  const getStatusStyles = (status: InsightStatus) => {
    switch (status) {
      case 'success': return 'border-l-coya-primary bg-coya-primary/5 hover:bg-coya-primary/10';
      case 'warning': return 'border-l-amber-500 bg-amber-50/80 hover:bg-amber-50';
      case 'danger': return 'border-l-red-500 bg-red-50/80 hover:bg-red-50';
      default: return 'border-l-blue-500 bg-blue-50/80 hover:bg-blue-50';
    }
  };

  const selectedCard = detailCategory ? cards.find(c => c.id === detailCategory) : null;

    return (
    <div className="rounded-2xl border border-coya-border bg-coya-card shadow-sm overflow-hidden">
      <div className="p-5 border-b border-coya-border bg-gradient-to-r from-coya-primary/5 to-transparent">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-lg font-semibold text-coya-text flex items-center gap-2">
            <i className="fas fa-brain text-coya-primary" aria-hidden />
            {localize('Intelligent analysis & predictions', 'Analyse intelligente et prédictions')}
        </h3>
          <span className="text-xs text-coya-text-muted bg-white/80 px-2.5 py-1 rounded-full border border-coya-border">
            <i className="fas fa-robot mr-1" aria-hidden />
            {localize('Synthesis by module', 'Synthèse par module')}
        </span>
      </div>
      </div>
      <div className="p-4">
        <p className="text-sm text-coya-text-muted mb-4">
          {localize('Algorithms analyze your modules to give you a clear overview. Click a card for full analysis or go directly to the module.', 'Les algorithmes analysent vos modules pour une synthèse claire. Cliquez sur une carte pour l\'analyse complète ou accédez au module.')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => (
            <div
              key={card.id}
              role="button"
              tabIndex={0}
              onClick={() => setDetailCategory(card.id)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDetailCategory(card.id); } }}
              className={`rounded-xl border-l-4 p-4 text-left transition-all cursor-pointer ${getStatusStyles(card.status)} focus:outline-none focus:ring-2 focus:ring-coya-primary/40`}
          >
            <div className="flex items-start gap-3">
                <div className="rounded-lg bg-white/80 p-2 shadow-sm">
                  <i className={`${card.icon} text-coya-primary text-lg`} aria-hidden />
              </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-coya-text">{card.title}</h4>
                  <p className="text-sm font-medium text-coya-text-muted mt-0.5">{card.metric}</p>
                  <p className="text-xs text-coya-text-muted mt-1 line-clamp-2">{card.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDetailCategory(card.id); }}
                      className="text-xs font-medium text-coya-primary hover:underline focus:outline-none"
                    >
                      {localize('View analysis', 'Voir l\'analyse')} →
                  </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setView(card.view); }}
                      className="text-xs font-medium text-coya-primary hover:underline focus:outline-none"
                    >
                      {localize('Go to module', 'Aller au module')} →
                    </button>
                  </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>

      {/* Modal détail : analyse complète */}
      {selectedCard && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setDetailCategory(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="insight-detail-title"
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-5 border-b border-coya-border flex items-center justify-between bg-gradient-to-r from-coya-primary/10 to-transparent">
              <h2 id="insight-detail-title" className="text-lg font-semibold text-coya-text flex items-center gap-2">
                <i className={`${selectedCard.icon} text-coya-primary`} aria-hidden />
                {selectedCard.detailTitle}
        </h2>
              <button
                type="button"
                onClick={() => setDetailCategory(null)}
                className="p-2 rounded-lg hover:bg-coya-border text-coya-text-muted focus:outline-none focus:ring-2 focus:ring-coya-primary"
                aria-label={localize('Close', 'Fermer')}
              >
                <i className="fas fa-times" aria-hidden />
              </button>
      </div>
            <div className="p-5 overflow-y-auto flex-1">
              <ul className="space-y-2 text-sm text-coya-text">
                {selectedCard.detailItems.map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <i className="fas fa-check text-coya-primary text-xs" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-4 pt-4 border-t border-coya-border text-xs text-coya-text-muted flex items-start gap-2">
                <i className="fas fa-lightbulb mt-0.5 flex-shrink-0" aria-hidden />
                {selectedCard.recommendation}
              </p>
            </div>
            <div className="p-5 border-t border-coya-border flex gap-3">
              <button
                type="button"
                onClick={() => {
                  if (selectedCard.view === 'projects') onNavigateToProjects();
                  else setView(selectedCard.view);
                  setDetailCategory(null);
                }}
                className="flex-1 py-2.5 rounded-xl bg-coya-primary text-white font-medium hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-coya-primary"
              >
                {localize('Go to module', 'Aller au module')}
              </button>
              <button
                type="button"
                onClick={() => setDetailCategory(null)}
                className="px-4 py-2.5 rounded-xl border border-coya-border text-coya-text hover:bg-coya-border/50 focus:outline-none"
              >
                {localize('Close', 'Fermer')}
              </button>
            </div>
          </div>
            </div>
      )}
    </div>
  );
};

/**
 * Tableau de bord personnalisé (Phase 1).
 * Droits : lecture selon profil – données actuellement à périmètre utilisateur (soi-même) ;
 * à étendre : équipe (manager), département (admin) selon plan.
 */
const Dashboard: React.FC<DashboardProps> = ({
  setView,
  projects = [],
  courses = [],
  jobs = [],
  timeLogs = [],
  leaveRequests = [],
  invoices = [],
  expenses = [],
  objectives = [],
  canAccessModule,
  isDataLoaded = true,
}) => {
  const { user } = useAuth();
  const { t, language } = useLocalization();
  const localize = (en: string, fr: string) => (language === Language.FR ? fr : en);
  const goProjects = useCallback(() => {
    if (canAccessModule) setView(projectsHomeView(canAccessModule));
    else setView('projects');
  }, [setView, canAccessModule]);
  const showOKR = canAccessModule ? canAccessModule('goals_okrs' as ModuleName) : false;

  const { daysWorkedThisWeek, objectivesToday, hoursThisWeek, loading: dashboardDataLoading } = useDashboardData(
    user?.id,
    objectives,
    timeLogs
  );
  const metrics = useDashboardMetrics(
    projects,
    courses,
    timeLogs,
    invoices,
    expenses,
    leaveRequests,
    user?.id
  );
  const { visibility: dashboardVisibility } = useDashboardSettings();
  const visibility = dashboardVisibility ?? {};
  const show = (key: string) => visibility[key] !== false;

  const [chartPeriod, setChartPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [activitiesPeriod, setActivitiesPeriod] = useState<'today' | 'weekly' | 'monthly'>('today');
  const [searchQuery, setSearchQuery] = useState('');

  /** Filtre texte : une section est visible si la recherche est vide ou si un des mots-clés correspond */
  const sectionMatchesSearch = (keywords: string[]) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return keywords.some((k) => k.toLowerCase().includes(q) || q.includes(k.toLowerCase()));
  };

  // Donut : répartition des projets par statut
  const donutSlices = useMemo((): DonutSlice[] => {
    const total = projects.length;
    if (total === 0) {
      return [
        { id: 'completed', label: t('completed') || 'Terminés', value: 0, percentage: 0, color: '#22c55e' },
        { id: 'in_progress', label: t('in_progress') || 'En cours', value: 0, percentage: 0, color: '#3b82f6' },
        { id: 'not_started', label: t('not_started') || 'Non démarrés', value: 0, percentage: 0, color: '#9ca3af' },
      ];
    }
    const completed = projects.filter((p) => p.status === 'Completed').length;
    const inProgress = projects.filter((p) => p.status === 'In Progress').length;
    const notStarted = projects.filter((p) => p.status === 'Not Started').length;
    return [
      { id: 'completed', label: t('completed') || 'Terminés', value: completed, percentage: Math.round((completed / total) * 100), color: 'var(--coya-emeraude)' },
      { id: 'in_progress', label: t('in_progress') || 'En cours', value: inProgress, percentage: Math.round((inProgress / total) * 100), color: '#3b82f6' },
      { id: 'not_started', label: t('not_started') || 'Non démarrés', value: notStarted, percentage: Math.round((notStarted / total) * 100), color: '#9ca3af' },
    ];
  }, [projects, t]);

  // Courbe : heures par semaine ou par mois
  const lineChartData = useMemo((): TimeSeriesPoint[] => {
    const userId = user?.id;
    const userLogs = userId ? timeLogs.filter((log) => log.userId === userId) : timeLogs;
    if (chartPeriod === 'weekly') {
      const weeks: TimeSeriesPoint[] = [];
      const now = new Date();
      for (let i = 9; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - 7 * i);
        const day = d.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        d.setDate(d.getDate() + diff);
        d.setHours(0, 0, 0, 0);
        const weekStart = new Date(d);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const hours = userLogs
          .filter((log) => {
            const date = new Date(log.date);
            return date >= weekStart && date <= weekEnd;
          })
          .reduce((sum, log) => sum + log.duration, 0) / 60;
        const weekNum = Math.ceil((weekStart.getDate() + 1) / 7) || 1;
        weeks.push({ period: `Sem. ${weekNum}`, value: Math.round(hours * 10) / 10 });
      }
      return weeks;
    }
    const months: TimeSeriesPoint[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthLabel = d.toLocaleDateString(language === Language.FR ? 'fr-FR' : 'en-US', { month: 'short', year: '2-digit' });
      const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const hours = userLogs
        .filter((log) => {
          const date = new Date(log.date);
          return date >= d && date <= monthEnd;
        })
        .reduce((sum, log) => sum + log.duration, 0) / 60;
      months.push({ period: monthLabel, value: Math.round(hours * 10) / 10 });
    }
    return months;
  }, [timeLogs, user?.id, chartPeriod, language]);

  // Activités récentes (time logs)
  const recentActivities = useMemo((): RecentActivityItem[] => {
    const userId = user?.id;
    const userLogs = userId ? timeLogs.filter((log) => log.userId === userId) : timeLogs;
    const todayStr = new Date().toISOString().split('T')[0];
    const now = new Date();
    const startOfWeek = new Date(now);
    const day = now.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    startOfWeek.setDate(now.getDate() + diff);
    startOfWeek.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let filtered = userLogs;
    if (activitiesPeriod === 'today') {
      filtered = userLogs.filter((log) => log.date === todayStr);
    } else if (activitiesPeriod === 'weekly') {
      filtered = userLogs.filter((log) => new Date(log.date) >= startOfWeek);
    } else {
      filtered = userLogs.filter((log) => new Date(log.date) >= startOfMonth);
    }
    const sorted = [...filtered].sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
    return sorted.slice(0, 8).map((log) => {
      const hours = Math.floor(log.duration / 60);
      const mins = log.duration % 60;
      const amount = `+${hours}h${mins > 0 ? ` ${mins}m` : ''}`;
      return {
        id: log.id,
        icon: 'fas fa-clock',
        iconColorClass: 'text-coya-primary bg-coya-primary/10',
        label: log.entityTitle || t('time_log') || 'Time log',
        time: log.date,
        amount,
        status: 'completed' as const,
        statusLabel: t('completed') || 'Complété',
      };
    });
  }, [timeLogs, user?.id, activitiesPeriod, t]);

  // Congés en attente
  const pendingLeavesItems = useMemo((): PendingBlockItem[] => {
    return leaveRequests
      .filter((req) => String(req.status).toLowerCase() === 'pending')
      .slice(0, 5)
      .map((req) => ({
        id: req.id,
        primary: req.userName || req.reason || 'Congé',
        secondary: `${new Date(req.startDate).toLocaleDateString()} - ${new Date(req.endDate).toLocaleDateString()}`,
        status: 'En attente',
      }));
  }, [leaveRequests]);

  // Factures en attente
  const pendingInvoicesItems = useMemo((): PendingBlockItem[] => {
    return invoices
      .filter((inv) => inv.status === 'Sent' || inv.status === 'Overdue')
      .slice(0, 5)
      .map((inv) => ({
        id: inv.id,
        primary: inv.invoiceNumber || inv.clientName,
        secondary: `$${inv.amount.toFixed(2)}`,
        status: inv.status,
      }));
  }, [invoices]);

  const formatMinutes = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const alertesCount = useMemo(() => {
    const now = new Date();
    const overdue = projects.filter((p) => p.status === 'In Progress' && new Date(p.dueDate) < now).length;
    const unpaid = invoices.filter((inv) => inv.status === 'Sent' || inv.status === 'Overdue').length;
    return overdue + unpaid;
  }, [projects, invoices]);

  /** Niveau de performance selon barème : 90%+ excellent, 70-89 bien, 50-69 moyen, <50 insuffisant. Sans objectif ni projet actif = 100%. */
  const performanceLevelFromScore = (score: number): PerformanceLevel => {
    if (score >= 90) return 'excellent';
    if (score >= 70) return 'good';
    if (score >= 50) return 'medium';
    return 'insufficient';
  };

  const performanceCabanesItems = useMemo((): PerformanceCabaneItem[] => {
    const now = new Date();
    const overdueCount = projects.filter((p) => p.status === 'In Progress' && new Date(p.dueDate) < now).length;
    const hasNoObjectivesOrTasks = objectivesToday.length === 0 && metrics.activeProjects === 0;
    const userScore = hasNoObjectivesOrTasks ? 100 : metrics.completionRate;
    const objectifsAvgProgress =
      objectivesToday.length > 0
        ? Math.round(
            objectivesToday.reduce((s, o) => s + (o.progress ?? 0), 0) / objectivesToday.length
          )
        : 100;

    return [
      {
        id: 'score',
        title: localize('Performance score', 'Score de performance'),
        value: `${userScore}%`,
        subtitle: hasNoObjectivesOrTasks
          ? localize('No objectives or tasks assigned', 'Aucun objectif ou tâche assigné')
          : `${metrics.completedProjects}/${metrics.totalProjects} ${localize('projects', 'projets')}`,
        level: performanceLevelFromScore(userScore),
        icon: 'fas fa-trophy',
        onAction: goProjects,
        actionLabel: localize('View projects', 'Voir les projets'),
      },
      {
        id: 'objectives',
        title: localize('Objectives', 'Objectifs'),
        value: objectivesToday.length,
        subtitle: localize('Today', 'Aujourd\'hui') + ` · ${objectifsAvgProgress}% ${localize('avg', 'moy')}`,
        level: performanceLevelFromScore(objectifsAvgProgress),
        icon: 'fas fa-bullseye',
        onAction: () => setView('goals_okrs'),
        actionLabel: localize('View all', 'Voir tout'),
      },
      {
        id: 'projects',
        title: localize('Project completion', 'Complétion projets'),
        value: `${metrics.completionRate}%`,
        subtitle: `${metrics.completedProjects} / ${metrics.totalProjects}`,
        level: performanceLevelFromScore(metrics.completionRate),
        icon: 'fas fa-project-diagram',
        onAction: goProjects,
        actionLabel: localize('View projects', 'Voir les projets'),
      },
      {
        id: 'risk',
        title: localize('Delay risk', 'Risque de retard'),
        value: overdueCount,
        subtitle: localize('Overdue projects', 'Projets en retard'),
        level:
          overdueCount === 0
            ? 'excellent'
            : overdueCount <= 2
              ? 'good'
              : overdueCount <= 5
                ? 'medium'
                : 'insufficient',
        icon: 'fas fa-exclamation-triangle',
        onAction: goProjects,
        actionLabel: localize('View projects', 'Voir les projets'),
      },
    ];
  }, [
    projects,
    metrics,
    objectivesToday,
    localize,
    setView,
    goProjects,
  ]);

  const dashboardDateLong = useMemo(() => {
    const locale = language === Language.FR ? 'fr-FR' : 'en-US';
    return new Date().toLocaleDateString(locale, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }, [language]);

  if (!user) return null;

  const userName = (user as any).fullName || (user as any).name || user.email || localize('User', 'Utilisateur');

  if (!isDataLoaded) {
    return <DashboardSkeleton />;
  }

  return (
    <WorkspaceShell
      data-testid="dashboard"
      className="mx-auto w-full max-w-[1600px] font-coya text-gray-900"
    >
      {/* Bannière — structure / hiérarchie type `make figma/src/app/pages/Dashboard.tsx`, palette institutionnelle COYA */}
      <div className="coya-welcome-banner">
        <div className="absolute right-0 top-0 hidden h-full w-64 opacity-10 lg:block">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full border-[40px] border-white" />
          <div className="absolute bottom-0 right-20 h-32 w-32 rounded-full border-[25px] border-white" />
        </div>
        <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex-1 min-w-0">
            <p className="mb-1 text-sm text-white/60">Bienvenue sur COYA ERP</p>
            <WelcomeMessage userName={userName} />
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">
              {localize('Consolidated dashboard — ', 'Tableau de bord consolidé — ')}
              {dashboardDateLong}
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">
                  {localize('Active projects', 'Projets actifs')}
                </p>
                <p className="text-lg font-semibold tabular-nums text-white">{metrics.activeProjects}</p>
              </div>
              <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">
                  {localize('Objectives today', 'Objectifs du jour')}
                </p>
                <p className="text-lg font-semibold tabular-nums text-white">{objectivesToday.length}</p>
              </div>
              <div className="rounded-xl border border-white/15 bg-white/10 px-4 py-2 backdrop-blur-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-white/55">
                  {localize('Alerts', 'Alertes')}
                </p>
                <p className="text-lg font-semibold tabular-nums text-white">{alertesCount}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <RoleBadge role={user.role} />
              <span className="text-sm text-white/70">
                <i className="fas fa-envelope mr-1"></i>
                {user.email}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <PresenceCountdownWidget />
            <DashboardAvatar />
          </div>
        </div>
      </div>

      <DashboardHeaderBar
        searchPlaceholder={localize('Search…', 'Rechercher…')}
        onSearch={setSearchQuery}
      />

      <header className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight text-gray-900">
          {localize('Dashboard', 'Tableau de bord')}
        </h2>
        <p className="mt-0.5 text-xs text-gray-400">
          {localize('Overview of your activity and key indicators.', 'Vue d’ensemble de votre activité et des indicateurs clés.')}
        </p>
      </header>

      <WorkforceDayTimelineCard />

      {/* KPI — grille & cartes alignées `make figma/.../Dashboard.tsx` */}
      {sectionMatchesSearch([localize('Days worked', 'Jours travaillés'), localize('Projects', 'Projets'), localize('Hours', 'Heures'), localize('Completion', 'Complétion')]) && (
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {show('days_worked') && (
          <KPICard
            label={localize('Days worked this week', 'Jours travaillés cette semaine')}
            value={dashboardDataLoading ? '…' : daysWorkedThisWeek}
            trendLabel={localize('Based on presence', 'Sur la base de la présence')}
            trendDirection="neutral"
            icon="fas fa-calendar-check"
            iconTrayClassName="bg-emerald-600"
          />
        )}
        <KPICard
          label={localize('Projects in progress', 'Projets en cours')}
          value={metrics.activeProjects}
          trendLabel={`${metrics.completedProjects} / ${metrics.totalProjects} ${localize('projects', 'projets')}`}
          trendDirection="neutral"
          icon="fas fa-project-diagram"
          iconTrayClassName="bg-violet-600"
          onAction={goProjects}
          actionLabel={localize('View all', 'Voir tout')}
        />
        <KPICard
          label={localize('Hours this week', 'Heures cette semaine')}
          value={formatMinutes(Math.round(hoursThisWeek * 60))}
          trendLabel={
            metrics.hoursTrend !== 0
              ? `${Math.abs(metrics.hoursTrend)}% ${localize('vs last week', 'vs sem. dernière')}`
              : localize('This week', 'Cette semaine')
          }
          trendDirection={metrics.hoursTrend > 0 ? 'up' : metrics.hoursTrend < 0 ? 'down' : 'neutral'}
          icon="fas fa-clock"
          iconTrayClassName="bg-blue-600"
        />
        <KPICard
          label={localize('Completion rate', 'Taux de complétion')}
          value={`${metrics.completionRate}%`}
          trendLabel={`${metrics.completedProjects} / ${metrics.totalProjects} ${localize('projects', 'projets')}`}
          trendDirection="neutral"
          icon="fas fa-check-circle"
          iconTrayClassName="bg-[var(--coya-institutional)]"
          onAction={goProjects}
          actionLabel={localize('View all', 'Voir tout')}
        />
      </div>
      )}

      {/* Donut + Courbe (style Current Statistic / Market Overview) */}
      {show('metrics') && sectionMatchesSearch([localize('Project status', 'Répartition projets'), localize('Hours', 'Heures'), localize('Trend', 'Tendance')]) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <ProjectRepartitionDonut
            slices={donutSlices}
            title={localize('Project status', 'Répartition des projets')}
            description={localize('Global breakdown', 'Répartition globale')}
            centerLabel={projects.length}
            setView={setView}
            onViewAllProjects={goProjects}
            viewAllLabel={localize('View projects', 'Voir les projets')}
          />
          <HoursTrendLineChart
            data={lineChartData}
            title={localize('Hours / Trend', 'Heures / Tendance')}
            description={localize('Worked hours over the selected period.', 'Heures travaillées sur la période sélectionnée.')}
            period={chartPeriod}
            onPeriodChange={setChartPeriod}
            setView={setView}
          />
        </div>
      )}

      {/* 4 cartes type Main Balance (dégradés) */}
      {sectionMatchesSearch([localize('My projects', 'Mes projets'), localize('Objectives', 'Objectifs'), localize('Time', 'Temps'), localize('Alerts', 'Alertes')]) && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MainBalanceStyleCard
          title={localize('My projects', 'Mes projets')}
          value={String(metrics.activeProjects)}
          subtitle={localize('Active', 'Actifs')}
          gradient="linear-gradient(135deg, var(--coya-primary) 0%, var(--coya-emeraude) 100%)"
          icon="fas fa-project-diagram"
          onClick={goProjects}
          badgeIcon="fas fa-folder"
        />
        <MainBalanceStyleCard
          title={localize('Objectives', 'Objectifs')}
          value={String(objectivesToday.length)}
          subtitle={localize('Today', 'Aujourd\'hui')}
          gradient="linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)"
          icon="fas fa-bullseye"
          onClick={() => setView('goals_okrs')}
          badgeIcon="fas fa-flag"
        />
        <MainBalanceStyleCard
          title={localize('Time', 'Temps')}
          value={formatMinutes(Math.round(hoursThisWeek * 60))}
          subtitle={localize('This week', 'Cette semaine')}
          gradient="linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)"
          icon="fas fa-clock"
          onClick={() => setView('planning')}
        />
        <MainBalanceStyleCard
          title={localize('Alerts', 'Alertes')}
          value={String(alertesCount)}
          subtitle={localize('To review', 'À traiter')}
          gradient="linear-gradient(135deg, var(--coya-ambre) 0%, #ea580c 100%)"
          icon="fas fa-bell"
          onClick={() => (alertesCount > 0 ? goProjects() : setView('dashboard'))}
        />
      </div>
      )}

      {/* Activités récentes */}
      {sectionMatchesSearch([localize('Recent activities', 'Activités récentes')]) && (
      <div className="mb-6">
        <RecentActivitiesList
          title={localize('Recent activities', 'Activités récentes')}
          subtitle={localize(
            'Latest actions on the platform.',
            'Dernières actions sur la plateforme.'
          )}
          items={recentActivities}
          period={activitiesPeriod}
          onPeriodChange={setActivitiesPeriod}
          setView={setView}
          emptyMessage={localize('No recent activity', 'Aucune activité récente')}
        />
      </div>
      )}

      {/* Deux blocs : Congés en attente + Factures en attente */}
      {sectionMatchesSearch([localize('Pending leave', 'Congés'), localize('Pending invoices', 'Factures')]) && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <PendingOrdersBlock
          title={localize('Pending leave requests', 'Congés en attente')}
          icon="fas fa-umbrella-beach"
          items={pendingLeavesItems}
          emptyMessage={localize('No pending requests', 'Aucune demande en attente')}
          onSeeAll={() => setView('leave_management')}
        />
        <PendingOrdersBlock
          title={localize('Pending invoices', 'Factures en attente')}
          icon="fas fa-file-invoice-dollar"
          items={pendingInvoicesItems}
          emptyMessage={localize('No pending invoices', 'Aucune facture en attente')}
          onSeeAll={() => setView('comptabilite')}
        />
      </div>
      )}

      {/* Bloc Power BI / Business Analytics (cabanes colorées, scoring) – plan Phase 1 */}
      {show('performance_cabanes') && sectionMatchesSearch([localize('Performance', 'Performance'), localize('scoring', 'scoring')]) && (
        <PerformanceCabanes
          title={localize('Performance indicators & scoring', 'Indicateurs de performance et scoring')}
          items={performanceCabanesItems}
          globalScoreLabel={localize(
            'Perimeter: your activity. Without objectives or tasks assigned, score is 100%. Updated automatically.',
            'Périmètre : votre activité. Sans objectif ou tâche assigné, le score est de 100 %. Mis à jour automatiquement.'
          )}
        />
      )}

      {/* Bloc Analytics prédictif (remplace Analyse intelligente) */}
      {show('analytics_predictif') && sectionMatchesSearch([localize('Analytics', 'Analytics'), localize('Predictive', 'Prédictif')]) && (
        <AnalyticsPredictif
          setView={setView}
          goProjects={goProjects}
          projects={projects}
          courses={courses}
          timeLogs={timeLogs}
          invoices={invoices}
          expenses={expenses}
          leaveRequests={leaveRequests}
          objectives={objectives}
          daysWorkedThisWeek={daysWorkedThisWeek}
          hoursThisWeek={hoursThisWeek}
          userId={user?.id}
        />
      )}
      {/* Section Analyse intelligente (legacy, optionnelle) */}
      {show('intelligent_insights') && !show('analytics_predictif') && sectionMatchesSearch([localize('Intelligent analysis', 'Analyse intelligente')]) && (
        <div className="mb-8">
          <IntelligentInsights
            setView={setView}
            onNavigateToProjects={goProjects}
            canAccessModule={canAccessModule}
            projects={projects}
            courses={courses}
            timeLogs={timeLogs}
            invoices={invoices}
            expenses={expenses}
            leaveRequests={leaveRequests}
          />
        </div>
      )}

      {sectionMatchesSearch([t('my_projects'), localize('Projects', 'Projets')]) && (
      <div className="mt-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-coya-text">{t('my_projects')}</h2>
          <a href="#" onClick={(e) => { e.preventDefault(); goProjects(); }} className="text-sm font-medium text-coya-primary hover:text-coya-primary-light">{t('view_all_projects')}</a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          {projects.filter(p => p.status !== 'Completed').slice(0, 2).map(project => <ProjectCard key={project.id} project={project} />)}
        </div>
      </div>
      )}
      
      {sectionMatchesSearch([t('my_courses'), localize('Courses', 'Formations')]) && (
      <div className="mt-10">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-coya-text">{t('my_courses')}</h2>
          <a href="#" onClick={(e) => { e.preventDefault(); setView('formation'); }} className="text-sm font-medium text-coya-primary hover:text-coya-primary-light">{t('view_all_courses')}</a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6">
          {courses.slice(0, 2).map(course => <CourseCard key={course.id} course={course} />)}
        </div>
      </div>
      )}

      {sectionMatchesSearch([t('job_openings'), localize('Jobs', 'Emplois')]) && (
      <div className="mt-10">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-coya-text">{t('job_openings')}</h2>
          <a href="#" onClick={(e) => { e.preventDefault(); setView('jobs'); }} className="text-sm font-medium text-coya-primary hover:text-coya-primary-light">{t('view_all_jobs')}</a>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {jobs.slice(0, 2).map(job => <JobCard key={job.id} job={job} />)}
        </div>
      </div>
      )}

    </WorkspaceShell>
  );
};

export default Dashboard;
