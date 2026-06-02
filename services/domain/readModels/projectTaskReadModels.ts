import type { Project, Risk, Task } from '../../../types';
import { normalizeTaskStatus, TASK_STATUS_CANONICAL } from '../../../utils/taskStatus';

export type ProjectTaskReadModel = {
  projectId: string;
  total: number;
  byStatus: Record<string, number>;
  overdueTaskIds: string[];
  blockedTaskIds: string[];
  onHoldTaskIds: string[];
};

export type ProjectRiskReadModel = {
  projectId: string;
  open: number;
  mitigating: number;
  closed: number;
  highImpact: number;
  owners: Record<string, number>;
};

function safeTasks(project: Project): Task[] {
  return project.tasks || [];
}

function safeRisks(project: Project): Risk[] {
  return project.risks || [];
}

export function buildProjectTaskReadModel(project: Project): ProjectTaskReadModel {
  const tasks = safeTasks(project);
  const ymdNow = new Date().toISOString().slice(0, 10);
  const byStatus: Record<string, number> = {};
  TASK_STATUS_CANONICAL.forEach((s) => {
    byStatus[s] = 0;
  });

  const overdueTaskIds: string[] = [];
  const blockedTaskIds: string[] = [];
  const onHoldTaskIds: string[] = [];

  for (const t of tasks) {
    const canon = normalizeTaskStatus(t.status);
    byStatus[canon] = (byStatus[canon] || 0) + 1;
    if (canon === 'blocked') blockedTaskIds.push(String(t.id));
    if (canon === 'on_hold') onHoldTaskIds.push(String(t.id));
    const end = t.periodEnd || t.dueDate;
    if (end && String(end).slice(0, 10) < ymdNow && canon !== 'done' && canon !== 'cancelled') {
      overdueTaskIds.push(String(t.id));
    }
  }

  return {
    projectId: String(project.id),
    total: tasks.length,
    byStatus,
    overdueTaskIds,
    blockedTaskIds,
    onHoldTaskIds,
  };
}

export function buildProjectRiskReadModel(project: Project): ProjectRiskReadModel {
  const risks = safeRisks(project);
  let open = 0;
  let mitigating = 0;
  let closed = 0;
  let highImpact = 0;
  const owners: Record<string, number> = {};

  for (const r of risks) {
    const status = r.status || 'open';
    if (status === 'open') open += 1;
    else if (status === 'mitigating') mitigating += 1;
    else if (status === 'closed') closed += 1;

    if (r.impact === 'High') highImpact += 1;
    if (r.ownerId) {
      owners[String(r.ownerId)] = (owners[String(r.ownerId)] || 0) + 1;
    }
  }

  return {
    projectId: String(project.id),
    open,
    mitigating,
    closed,
    highImpact,
    owners,
  };
}
