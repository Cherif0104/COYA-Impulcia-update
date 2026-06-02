import { Budget, Expense, Invoice, LeaveRequest, Meeting, Objective, Project, ProjectModuleSettings, User } from '../types';

/** Cycle transverse (KPI / actions). Évolution prévue : enrichir en bus d’événements métier + membership projet / RLS côté consommateurs. */

export type WorkflowSeverity = 'info' | 'warning' | 'critical';
export type WorkflowModule = 'projects' | 'planning' | 'rh' | 'comptabilite' | 'programme' | 'objectives';
export type WorkflowActionType = 'notify' | 'project_update' | 'objective_update' | 'invoice_update';

export interface WorkflowAction {
  eventId: string;
  type: WorkflowActionType;
  module: WorkflowModule;
  severity: WorkflowSeverity;
  message: string;
  entityType: string;
  entityId: string;
  targetUserIds: string[];
  metadata?: Record<string, unknown>;
}

export interface WorkflowKpiSnapshot {
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
  bySeverity: Record<WorkflowSeverity, number>;
}

export interface WorkflowCycleInput {
  projects: Project[];
  objectives: Objective[];
  leaveRequests: LeaveRequest[];
  invoices: Invoice[];
  expenses: Expense[];
  budgets: Budget[];
  meetings: Meeting[];
  users: User[];
  settings: ProjectModuleSettings | null;
  currentUserId?: string;
  now?: Date;
}

export interface WorkflowCycleOutput {
  actions: WorkflowAction[];
  updatedProjects: Project[];
  updatedObjectives: Objective[];
  updatedInvoices: Invoice[];
  kpis: WorkflowKpiSnapshot;
}

const IDEMPOTENCE_KEY = 'coya.workflow.idempotence.v1';
const IDEMPOTENCE_TTL_MS = 24 * 60 * 60 * 1000;

const safeDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const startOfDay = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const dayDiff = (from: Date, to: Date): number => {
  return Math.ceil((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
};

const getUserIdsFromProject = (project: Project): string[] => {
  const ids = new Set<string>();
  (project.team || []).forEach((member) => {
    if (member?.id !== undefined && member?.id !== null) ids.add(String(member.id));
    if ((member as any)?.profileId) ids.add(String((member as any).profileId));
  });
  (project.teamMemberIds || []).forEach((id) => {
    if (id) ids.add(String(id));
  });
  if (project.createdById) ids.add(String(project.createdById));
  return Array.from(ids);
};

const getManagerIds = (users: User[]): string[] => {
  const roles = new Set(['super_administrator', 'administrator', 'manager', 'supervisor']);
  return users
    .filter((u) => roles.has(String(u.role || '')))
    .map((u) => String((u as any).profileId || u.id))
    .filter(Boolean);
};

const readIdempotenceStore = (): Record<string, number> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(IDEMPOTENCE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeIdempotenceStore = (store: Record<string, number>): void => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(IDEMPOTENCE_KEY, JSON.stringify(store));
  } catch {
    // ignore storage errors
  }
};

const keepOnlyFreshEntries = (store: Record<string, number>, nowTs: number): Record<string, number> => {
  const fresh: Record<string, number> = {};
  Object.entries(store).forEach(([key, ts]) => {
    if (typeof ts === 'number' && nowTs - ts < IDEMPOTENCE_TTL_MS) {
      fresh[key] = ts;
    }
  });
  return fresh;
};

const dedupeByEventId = (actions: WorkflowAction[], now: Date): WorkflowAction[] => {
  const nowTs = now.getTime();
  const existing = keepOnlyFreshEntries(readIdempotenceStore(), nowTs);
  const freshActions: WorkflowAction[] = [];
  actions.forEach((action) => {
    if (existing[action.eventId]) return;
    existing[action.eventId] = nowTs;
    freshActions.push(action);
  });
  writeIdempotenceStore(existing);
  return freshActions;
};

const buildKpis = (
  input: WorkflowCycleInput,
  actions: WorkflowAction[],
  updatedProjects: Project[],
  updatedObjectives: Objective[],
  updatedInvoices: Invoice[],
  cycleAt: Date
): WorkflowKpiSnapshot => {
  const bySeverity: Record<WorkflowSeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  };
  actions.forEach((a) => {
    bySeverity[a.severity] += 1;
  });

  return {
    cycleAt: cycleAt.toISOString(),
    scanned: {
      projects: input.projects.length,
      tasks: input.projects.reduce((sum, p) => sum + (p.tasks?.length || 0), 0),
      objectives: input.objectives.length,
      leaves: input.leaveRequests.length,
      invoices: input.invoices.length,
      meetings: input.meetings.length,
    },
    actions: {
      total: actions.length,
      notifications: actions.filter((a) => a.type === 'notify').length,
      projectUpdates: updatedProjects.length,
      objectiveUpdates: updatedObjectives.length,
      invoiceUpdates: updatedInvoices.length,
    },
    bySeverity,
  };
};

export const runWorkflowCycle = (input: WorkflowCycleInput): WorkflowCycleOutput => {
  const now = startOfDay(input.now || new Date());
  const alertDelayDays = Math.max(1, Number(input.settings?.alertDelayDays ?? 3));
  // Par défaut, les tâches dépassées gèlent le projet ; désactivable explicitement.
  const autoFreezeOverdueTasks = input.settings?.autoFreezeOverdueTasks !== false;
  const leavePendingSlaDays = Math.max(1, Number(input.settings?.leavePendingSlaDays ?? 2));
  const budgetWarningPercent = Math.max(1, Number(input.settings?.budgetWarningPercent ?? 10));
  const budgetCriticalPercent = Math.max(budgetWarningPercent + 1, Number(input.settings?.budgetCriticalPercent ?? 20));
  const objectiveOffTrackGapPercent = Math.max(1, Number(input.settings?.objectiveOffTrackGapPercent ?? 10));

  const actions: WorkflowAction[] = [];
  const updatedProjectsMap = new Map<string, Project>();
  const updatedObjectivesMap = new Map<string, Objective>();
  const updatedInvoicesMap = new Map<string, Invoice>();
  const managerIds = getManagerIds(input.users);

  input.projects.forEach((project) => {
    const teamUserIds = getUserIdsFromProject(project);
    const nextTasks = (project.tasks || []).map((task) => {
      const due = safeDate(task.dueDate);
      if (!due || task.status === 'Completed') return task;
      const dueDay = startOfDay(due);
      const delta = dayDiff(now, dueDay);
      const baseTargetIds = task.assigneeIds?.length ? task.assigneeIds.map(String) : teamUserIds;
      const targetIds = Array.from(new Set([...baseTargetIds, ...managerIds]));

      if ((task.assigneeIds || []).length === 0) {
        actions.push({
          eventId: `task_unassigned:${project.id}:${task.id}`,
          type: 'notify',
          module: 'projects',
          severity: 'warning',
          message: `Tâche sans responsable: "${task.text}" (${project.title})`,
          entityType: 'task',
          entityId: String(task.id),
          targetUserIds: targetIds,
          metadata: { projectId: project.id, taskId: task.id },
        });
      }

      if (delta < 0) {
        actions.push({
          eventId: `task_overdue:${project.id}:${task.id}:${task.dueDate}`,
          type: 'notify',
          module: 'projects',
          severity: 'critical',
          message: `Tâche en retard: "${task.text}" (${project.title})`,
          entityType: 'task',
          entityId: String(task.id),
          targetUserIds: targetIds,
          metadata: { projectId: project.id, taskId: task.id, dueDate: task.dueDate },
        });
      } else if (delta <= alertDelayDays) {
        actions.push({
          eventId: `task_due_soon:${project.id}:${task.id}:${task.dueDate}:${delta}`,
          type: 'notify',
          module: 'projects',
          severity: delta === 0 ? 'critical' : 'warning',
          message: `Échéance tâche ${delta === 0 ? 'aujourd’hui' : `dans ${delta} jour(s)`}: "${task.text}"`,
          entityType: 'task',
          entityId: String(task.id),
          targetUserIds: targetIds,
          metadata: { projectId: project.id, taskId: task.id, dueDate: task.dueDate, deltaDays: delta },
        });
      }
      return task;
    });

    // Neutralisé : pas de mutation projet/tâche dans workflowEngine (alerting only).

    const budgetLines = project.budgetLines || [];
    if (budgetLines.length > 0) {
      const planned = budgetLines.reduce((sum, line) => sum + (Number(line.plannedAmount) || 0), 0);
      const real = budgetLines.reduce((sum, line) => sum + (Number(line.realAmount) || 0), 0);
      if (planned > 0) {
        const variancePct = ((real - planned) / planned) * 100;
        if (variancePct >= budgetWarningPercent) {
          const severity: WorkflowSeverity = variancePct >= budgetCriticalPercent ? 'critical' : 'warning';
          actions.push({
            eventId: `project_budget_threshold:${project.id}:${severity}:${Math.floor(variancePct)}`,
            type: 'notify',
            module: 'comptabilite',
            severity,
            message: `Alerte budget projet "${project.title}": variance ${variancePct.toFixed(1)}%`,
            entityType: 'project',
            entityId: String(project.id),
            targetUserIds: Array.from(new Set([...teamUserIds, ...managerIds])),
            metadata: { projectId: project.id, planned, real, variancePct },
          });
        }
      }
    }
  });

  input.objectives.forEach((objective) => {
    const start = safeDate(objective.startDate);
    const end = safeDate(objective.endDate);
    const progress = Number(objective.progress ?? 0);
    if (!start || !end || end <= start) return;
    const elapsed = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
    const expected = elapsed * 100;
    const isOffTrack = progress + objectiveOffTrackGapPercent < expected;
    const statusStr = String(objective.status || '').toLowerCase();
    if (!isOffTrack || statusStr === 'completed' || statusStr === 'done') return;

    const ownerId = objective.ownerId ? String(objective.ownerId) : input.currentUserId ? String(input.currentUserId) : '';
    const targetUserIds = ownerId ? [ownerId, ...managerIds] : managerIds;
    actions.push({
      eventId: `objective_offtrack:${objective.id}:${Math.floor(expected)}:${Math.floor(progress)}`,
      type: 'notify',
      module: 'objectives',
      severity: 'warning',
      message: `Objectif hors trajectoire: "${objective.title}" (${progress}% vs attendu ${Math.round(expected)}%)`,
      entityType: 'objective',
      entityId: String(objective.id),
      targetUserIds: Array.from(new Set(targetUserIds)),
      metadata: { objectiveId: objective.id, progress, expected },
    });

    if (statusStr !== 'off-track') {
      const updated = { ...objective, status: 'off-track' };
      updatedObjectivesMap.set(String(objective.id), updated);
      actions.push({
        eventId: `objective_status_update:${objective.id}:off-track`,
        type: 'objective_update',
        module: 'objectives',
        severity: 'info',
        message: `Statut objectif mis à jour automatiquement vers off-track`,
        entityType: 'objective',
        entityId: String(objective.id),
        targetUserIds: Array.from(new Set(targetUserIds)),
        metadata: { objectiveId: objective.id, status: 'off-track' },
      });
    }
  });

  input.leaveRequests.forEach((leave) => {
    if (leave.status !== 'pending') return;
    const created = safeDate(leave.createdAt);
    if (!created) return;
    const delta = dayDiff(created, now);
    if (delta < leavePendingSlaDays) return;
    const targets = Array.from(new Set([
      leave.managerId ? String(leave.managerId) : '',
      ...managerIds,
    ].filter(Boolean)));
    actions.push({
      eventId: `leave_pending_sla:${leave.id}:${delta}`,
      type: 'notify',
      module: 'rh',
      severity: delta >= leavePendingSlaDays + 3 ? 'critical' : 'warning',
      message: `Demande de congé en attente depuis ${delta} jour(s)`,
      entityType: 'leave_request',
      entityId: String(leave.id),
      targetUserIds: targets,
      metadata: { leaveRequestId: leave.id, pendingDays: delta },
    });
  });

  input.invoices.forEach((invoice) => {
    if (invoice.status === 'Paid') return;
    const due = safeDate(invoice.dueDate);
    if (!due) return;
    const delta = dayDiff(now, startOfDay(due));
    if (delta < 0 && invoice.status !== 'Overdue') {
      const updated = { ...invoice, status: 'Overdue' as const };
      updatedInvoicesMap.set(String(invoice.id), updated);
      actions.push({
        eventId: `invoice_overdue_status:${invoice.id}`,
        type: 'invoice_update',
        module: 'comptabilite',
        severity: 'critical',
        message: `Facture ${invoice.invoiceNumber} passée en Overdue automatiquement`,
        entityType: 'invoice',
        entityId: String(invoice.id),
        targetUserIds: managerIds,
        metadata: { invoiceId: invoice.id, dueDate: invoice.dueDate },
      });
    } else if (delta >= 0 && delta <= alertDelayDays) {
      actions.push({
        eventId: `invoice_due_soon:${invoice.id}:${delta}`,
        type: 'notify',
        module: 'comptabilite',
        severity: delta === 0 ? 'critical' : 'warning',
        message: `Facture ${invoice.invoiceNumber} due ${delta === 0 ? 'aujourd’hui' : `dans ${delta} jour(s)`}`,
        entityType: 'invoice',
        entityId: String(invoice.id),
        targetUserIds: managerIds,
        metadata: { invoiceId: invoice.id, dueDate: invoice.dueDate, deltaDays: delta },
      });
    }
  });

  const meetingsByUserDay = new Map<string, Array<{ start: Date; end: Date; meetingId: string }>>();
  input.meetings.forEach((meeting) => {
    const start = safeDate(meeting.startTime);
    const end = safeDate(meeting.endTime);
    if (!start || !end || end <= start) return;
    const day = start.toISOString().slice(0, 10);
    const users = new Set<string>();
    if (meeting.organizerId !== undefined && meeting.organizerId !== null) users.add(String(meeting.organizerId));
    (meeting.attendees || []).forEach((a) => {
      if (a?.id !== undefined && a?.id !== null) users.add(String(a.id));
      if ((a as any)?.profileId) users.add(String((a as any).profileId));
    });
    users.forEach((uid) => {
      const key = `${uid}:${day}`;
      if (!meetingsByUserDay.has(key)) meetingsByUserDay.set(key, []);
      meetingsByUserDay.get(key)!.push({ start, end, meetingId: String(meeting.id) });
    });
  });

  meetingsByUserDay.forEach((list, key) => {
    const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const cur = sorted[i];
      if (cur.start < prev.end) {
        const [userId] = key.split(':');
        actions.push({
          eventId: `planning_conflict:${key}:${prev.meetingId}:${cur.meetingId}`,
          type: 'notify',
          module: 'planning',
          severity: 'warning',
          message: 'Conflit de planification détecté (réunions chevauchées)',
          entityType: 'meeting',
          entityId: cur.meetingId,
          targetUserIds: [userId],
          metadata: { meetingA: prev.meetingId, meetingB: cur.meetingId },
        });
      }
    }
  });

  const projectsByProgramme = new Map<string, Project[]>();
  input.projects.forEach((project) => {
    if (!project.programmeId) return;
    const key = String(project.programmeId);
    if (!projectsByProgramme.has(key)) projectsByProgramme.set(key, []);
    projectsByProgramme.get(key)!.push(project);
  });
  projectsByProgramme.forEach((programmeProjects, programmeId) => {
    let planned = 0;
    let real = 0;
    programmeProjects.forEach((p) => {
      (p.budgetLines || []).forEach((line) => {
        planned += Number(line.plannedAmount) || 0;
        real += Number(line.realAmount) || 0;
      });
    });
    if (planned <= 0) return;
    const variancePct = ((real - planned) / planned) * 100;
    if (variancePct >= budgetWarningPercent) {
      actions.push({
        eventId: `programme_budget_threshold:${programmeId}:${Math.floor(variancePct)}`,
        type: 'notify',
        module: 'programme',
        severity: variancePct >= budgetCriticalPercent ? 'critical' : 'warning',
        message: `Programme ${programmeId}: variance budgétaire ${variancePct.toFixed(1)}%`,
        entityType: 'programme',
        entityId: programmeId,
        targetUserIds: managerIds,
        metadata: { programmeId, planned, real, variancePct },
      });
    }
  });

  const freshActions = dedupeByEventId(actions, now);
  const updatedProjects = Array.from(updatedProjectsMap.values());
  const updatedObjectives = Array.from(updatedObjectivesMap.values());
  const updatedInvoices = Array.from(updatedInvoicesMap.values());
  const kpis = buildKpis(input, freshActions, updatedProjects, updatedObjectives, updatedInvoices, now);

  return {
    actions: freshActions,
    updatedProjects,
    updatedObjectives,
    updatedInvoices,
    kpis,
  };
};

