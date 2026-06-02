/**
 * Read model cockpit projet (agrégats UI, sans requête réseau supplémentaire).
 *
 * Roadmap (hors périmètre immédiat) : membership projet + RLS côté API, bus d’événements
 * métier (tâche créée, budget dépassé, …) pour recalculs temps réel et notifications.
 */
import type { Objective, Project, Task, TimeLog } from '../types';
import { computeProjectInsights } from '../utils/projectInsights';
import { applyProjectTasksAutoClose, getTaskGovernance, isTaskScheduledFrozen } from '../utils/projectTaskLifecycle';
import { normalizeTaskStatus } from '../utils/taskStatus';

export type CockpitAlert = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  fr: string;
  en: string;
};

export type CockpitNextTask = {
  id: string;
  title: string;
  due?: string;
  status: Task['status'];
};

export type ProjectCockpitReadModel = {
  insights: ReturnType<typeof computeProjectInsights>;
  totalTasks: number;
  completedTasks: number;
  overdueTaskCount: number;
  frozenOrGovernedCount: number;
  notRealizedCount: number;
  projectLoggedHoursFromTimeLogs: number;
  budgetPlannedTotal: number;
  budgetRealTotal: number;
  budgetAlertLevel: 'critical' | 'warning' | 'under' | 'ok';
  /** Réel − prévu (lignes budget). */
  budgetVariance: number;
  /** % d’écart vs prévision (0 si pas de prévision). */
  budgetVariancePercent: number;
  /** Tâches non terminées sous gel / gouvernance forte (proxy « bloquées » cockpit). */
  blockedTasksCount: number;
  /** Tâches encore ouvertes ÷ taille équipe (≥ 1 membre pour éviter division par zéro). */
  teamLoadOpenTasksPerMember: number;
  objectivesCount: number;
  nextTasks: CockpitNextTask[];
  alerts: CockpitAlert[];
};

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildProjectCockpitReadModel(
  project: Project,
  timeLogs: TimeLog[],
  objectives: Objective[] = [],
): ProjectCockpitReadModel {
  const tasks = applyProjectTasksAutoClose(project.tasks || []);
  const governedProject = { ...project, tasks };
  const insights = computeProjectInsights(governedProject);

  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => normalizeTaskStatus(t.status) === 'done').length;
  const ymd = todayYmd();

  let overdueTaskCount = 0;
  let frozenOrGovernedCount = 0;
  let notRealizedCount = 0;
  for (const t of tasks) {
    const g = getTaskGovernance(t);
    if (g === 'not_realized') notRealizedCount += 1;
    if (normalizeTaskStatus(t.status) !== 'done') {
      const end = t.periodEnd || t.dueDate;
      if (end && String(end).slice(0, 10) < ymd) overdueTaskCount += 1;
    }
    if (isTaskScheduledFrozen(t) || g === 'not_realized') frozenOrGovernedCount += 1;
  }

  const projectLogs = timeLogs.filter(
    (log) => log.entityType === 'project' && String(log.entityId) === String(project.id),
  );
  const projectLoggedHoursFromTimeLogs =
    projectLogs.reduce((sum, log) => sum + (Number(log.duration) || 0), 0) / 60;

  const budgetPlannedTotal = (project.budgetLines || []).reduce((s, l) => s + (l.plannedAmount || 0), 0);
  const budgetRealTotal = (project.budgetLines || []).reduce((s, l) => s + (l.realAmount || 0), 0);
  const budgetVariance = budgetRealTotal - budgetPlannedTotal;
  const budgetVariancePercent = budgetPlannedTotal > 0 ? (budgetVariance / budgetPlannedTotal) * 100 : 0;
  const budgetAlertLevel: ProjectCockpitReadModel['budgetAlertLevel'] =
    budgetVariancePercent >= 15
      ? 'critical'
      : budgetVariancePercent >= 8
        ? 'warning'
        : budgetVariancePercent <= -8
          ? 'under'
          : 'ok';

  const objectivesCount = objectives.filter((o) => String(o.projectId) === String(project.id)).length;

  const nextTasks: CockpitNextTask[] = [...tasks]
    .filter((t) => normalizeTaskStatus(t.status) !== 'done')
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return ad - bd;
    })
    .slice(0, 5)
    .map((t) => ({
      id: t.id,
      title: t.text,
      due: t.dueDate || t.periodEnd || undefined,
      status: t.status,
    }));

  const alerts: CockpitAlert[] = [];
  if (insights.dueInDays < 0) {
    alerts.push({
      id: 'project-overdue',
      severity: 'high',
      fr: 'Échéance projet dépassée : replanifier ou escalader.',
      en: 'Project due date passed: replan or escalate.',
    });
  }
  if (insights.riskLevel === 'high') {
    alerts.push({
      id: 'urgency-high',
      severity: 'high',
      fr: 'Indicateur de santé critique (score d’urgence élevé).',
      en: 'Critical health signal (high urgency score).',
    });
  }
  if (notRealizedCount > 0) {
    alerts.push({
      id: 'tasks-not-realized',
      severity: 'medium',
      fr: `${notRealizedCount} tâche(s) en non-réalisation / période dépassée.`,
      en: `${notRealizedCount} task(s) marked not realized or past period.`,
    });
  }
  if (budgetAlertLevel === 'critical') {
    alerts.push({
      id: 'budget-over',
      severity: 'high',
      fr: 'Budget : dépassement significatif vs prévision.',
      en: 'Budget: significant overrun vs plan.',
    });
  } else if (budgetAlertLevel === 'warning') {
    alerts.push({
      id: 'budget-warn',
      severity: 'medium',
      fr: 'Budget : écart notable à surveiller.',
      en: 'Budget: notable variance to watch.',
    });
  }

  const openTaskCount = tasks.filter((t) => normalizeTaskStatus(t.status) !== 'done').length;
  const teamSize = Math.max(1, (project.team || []).length);
  const teamLoadOpenTasksPerMember = openTaskCount / teamSize;

  return {
    insights,
    totalTasks,
    completedTasks,
    overdueTaskCount,
    frozenOrGovernedCount,
    notRealizedCount,
    projectLoggedHoursFromTimeLogs,
    budgetPlannedTotal,
    budgetRealTotal,
    budgetAlertLevel,
    budgetVariance,
    budgetVariancePercent,
    blockedTasksCount: frozenOrGovernedCount,
    teamLoadOpenTasksPerMember,
    objectivesCount,
    nextTasks,
    alerts,
  };
}
