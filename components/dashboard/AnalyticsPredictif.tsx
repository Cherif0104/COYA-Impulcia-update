import React, { useMemo } from 'react';
import { useLocalization } from '../../contexts/LocalizationContext';
import { Language } from '../../types';
import PerformanceCabanes, { type PerformanceCabaneItem, type PerformanceLevel } from './PerformanceCabanes';
import type { Project, Course, TimeLog, Invoice, Expense, LeaveRequest, Objective } from '../../types';
import { formationNgoAnalyticsTrainingSubtitle } from '../../services/formationAnalyticsBridge';

/** Barème : 100% excellent, 90%+ très bien, 80%+ bien, 70%+ à encourager, 60%+ insuffisant, 50%+ très insuffisant, <50% très faible */
function performanceLevelFromScore(score: number): PerformanceLevel {
  if (score >= 100) return 'excellent';
  if (score >= 90) return 'excellent';
  if (score >= 80) return 'good';
  if (score >= 70) return 'good';
  if (score >= 60) return 'medium';
  if (score >= 50) return 'medium';
  return 'insufficient';
}

interface AnalyticsPredictifProps {
  setView: (view: string) => void;
  /** Accueil liste / coquille projets (ex. `programmes_projects` si double module). */
  goProjects?: () => void;
  projects: Project[];
  courses: Course[];
  timeLogs: TimeLog[];
  invoices: Invoice[];
  expenses: Expense[];
  leaveRequests: LeaveRequest[];
  objectives?: Objective[];
  daysWorkedThisWeek?: number;
  hoursThisWeek?: number;
  userId?: string;
}

const AnalyticsPredictif: React.FC<AnalyticsPredictifProps> = ({
  setView,
  goProjects,
  projects,
  courses,
  timeLogs,
  invoices,
  expenses,
  leaveRequests,
  objectives = [],
  daysWorkedThisWeek = 0,
  hoursThisWeek = 0,
  userId,
}) => {
  const { language } = useLocalization();
  const isFr = language === Language.FR;
  const localize = (en: string, fr: string) => (isFr ? fr : en);

  const today = new Date().toISOString().split('T')[0];
  const objectivesToday = objectives.filter((o) => {
    const start = o.startDate ? new Date(o.startDate).toISOString().split('T')[0] : null;
    const end = o.endDate ? new Date(o.endDate).toISOString().split('T')[0] : null;
    const inPeriod = (!start || start <= today) && (!end || end >= today);
    const notDone = (o.progress ?? 0) < 100;
    return inPeriod && notDone;
  });

  const startOfWeek = useMemo(() => {
    const d = new Date();
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const userTimeLogs = userId ? timeLogs.filter((l) => l.userId === userId) : timeLogs;
  const hoursThisWeekFromLogs =
    userTimeLogs
      .filter((log) => new Date(log.date) >= startOfWeek)
      .reduce((sum, log) => sum + log.duration, 0) / 60;

  const completedProjects = projects.filter((p) => p.status === 'Completed').length;
  const totalProjects = projects.length;
  const completionRate = totalProjects > 0 ? Math.round((completedProjects / totalProjects) * 100) : 100;
  const activeProjects = projects.filter((p) => p.status === 'In Progress').length;
  const hasNoObjectivesOrTasks = objectivesToday.length === 0 && activeProjects === 0;
  const userScore = hasNoObjectivesOrTasks ? 100 : completionRate;

  const objectifsAvgProgress =
    objectivesToday.length > 0
      ? Math.round(objectivesToday.reduce((s, o) => s + (o.progress ?? 0), 0) / objectivesToday.length)
      : 100;

  const overdueCount = projects.filter(
    (p) => p.status === 'In Progress' && new Date(p.dueDate) < new Date()
  ).length;

  const paidInvoices = invoices.filter((inv) => inv.status === 'Paid').reduce((s, inv) => s + inv.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netIncome = paidInvoices - totalExpenses;
  const financeScore = paidInvoices > 0 ? Math.min(100, Math.max(0, Math.round((netIncome / paidInvoices) * 100))) : 100;

  const avgCourseProgress =
    courses.length > 0 ? Math.round(courses.reduce((s, c) => s + c.progress, 0) / courses.length) : 100;

  const pendingLeave = leaveRequests.filter((r) => r.status === 'pending' || r.status === 'Pending').length;
  const assiduiteScore = daysWorkedThisWeek >= 5 ? 100 : daysWorkedThisWeek >= 3 ? 80 : daysWorkedThisWeek >= 1 ? 60 : 40;

  const openProjects = () => (goProjects ? goProjects() : setView('projects'));

  const items = useMemo((): PerformanceCabaneItem[] => {
    const list: PerformanceCabaneItem[] = [
      {
        id: 'score',
        title: localize('Performance score', 'Score de performance'),
        value: `${userScore}%`,
        subtitle: hasNoObjectivesOrTasks
          ? localize('No objectives or tasks assigned', 'Aucun objectif ou tâche assigné')
          : `${completedProjects}/${totalProjects} ${localize('projects', 'projets')}`,
        level: performanceLevelFromScore(userScore),
        icon: 'fas fa-trophy',
        onAction: openProjects,
        actionLabel: localize('View projects', 'Voir les projets'),
      },
      {
        id: 'objectives',
        title: localize('Objectives', 'Objectifs'),
        value: objectivesToday.length,
        subtitle: localize('Today', "Aujourd'hui") + ` · ${objectifsAvgProgress}% ${localize('avg', 'moy')}`,
        level: performanceLevelFromScore(objectifsAvgProgress),
        icon: 'fas fa-bullseye',
        onAction: () => setView('goals_okrs'),
        actionLabel: localize('View all', 'Voir tout'),
      },
      {
        id: 'assiduite',
        title: localize('Attendance', 'Assiduité'),
        value: `${daysWorkedThisWeek} ${localize('days', 'j')}`,
        subtitle: `${hoursThisWeekFromLogs.toFixed(1)}h ${localize('this week', 'cette semaine')}`,
        level: performanceLevelFromScore(assiduiteScore),
        icon: 'fas fa-user-check',
        onAction: () => setView('planning'),
        actionLabel: localize('Time tracking', 'Saisie temps'),
      },
      {
        id: 'productivite',
        title: localize('Productivity', 'Productivité'),
        value: `${completionRate}%`,
        subtitle: `${completedProjects} / ${totalProjects} ${localize('projects', 'projets')}`,
        level: performanceLevelFromScore(completionRate),
        icon: 'fas fa-chart-line',
        onAction: openProjects,
        actionLabel: localize('View projects', 'Voir les projets'),
      },
      {
        id: 'risk',
        title: localize('Delay risk', 'Risque de retard'),
        value: overdueCount,
        subtitle: localize('Overdue projects', 'Projets en retard'),
        level:
          overdueCount === 0 ? 'excellent' : overdueCount <= 2 ? 'good' : overdueCount <= 5 ? 'medium' : 'insufficient',
        icon: 'fas fa-exclamation-triangle',
        onAction: openProjects,
        actionLabel: localize('View projects', 'Voir les projets'),
      },
    ];

    if (courses.length > 0) {
      list.push({
        id: 'courses',
        title: localize('Training', 'Formations'),
        value: `${avgCourseProgress}%`,
        subtitle: `${courses.length} ${localize('courses', 'formations')} · ${formationNgoAnalyticsTrainingSubtitle(isFr)}`,
        level: performanceLevelFromScore(avgCourseProgress),
        icon: 'fas fa-book-open',
        onAction: () => setView('formation'),
        actionLabel: localize('View courses', 'Voir les formations'),
      });
    }

    if (invoices.length > 0 || expenses.length > 0) {
      list.push({
        id: 'comptabilite',
        title: localize('Accounting', 'Comptabilité'),
        value: netIncome >= 0 ? `+${netIncome.toFixed(0)}` : `${netIncome.toFixed(0)}`,
        subtitle: localize('Net income', 'Résultat net'),
        level: performanceLevelFromScore(financeScore),
        icon: 'fas fa-file-invoice-dollar',
        onAction: () => setView('comptabilite'),
        actionLabel: localize('View accounting', 'Voir la comptabilité'),
      });
    }

    if (pendingLeave > 0) {
      list.push({
        id: 'rh',
        title: localize('HR / Leave', 'RH / Congés'),
        value: pendingLeave,
        subtitle: localize('Pending requests', 'Demandes en attente'),
        level: 'medium',
        icon: 'fas fa-users-cog',
        onAction: () => setView('rh'),
        actionLabel: localize('View RH', 'Voir RH'),
      });
    }

    return list;
  }, [
    userScore,
    hasNoObjectivesOrTasks,
    completedProjects,
    totalProjects,
    objectivesToday.length,
    objectifsAvgProgress,
    daysWorkedThisWeek,
    hoursThisWeekFromLogs,
    assiduiteScore,
    completionRate,
    overdueCount,
    courses.length,
    avgCourseProgress,
    netIncome,
    financeScore,
    pendingLeave,
    localize,
    setView,
    goProjects,
    isFr,
  ]);

  return (
    <PerformanceCabanes
      title={localize('Predictive analytics & scoring', 'Analytics prédictif et scoring')}
      items={items}
      globalScoreLabel={localize(
        'Perimeter: your activity. Without objectives or tasks assigned, score is 100%. Updated automatically.',
        "Périmètre : votre activité. Sans objectif ou tâche assigné, le score est de 100 %. Mis à jour automatiquement."
      )}
    />
  );
};

export default AnalyticsPredictif;
