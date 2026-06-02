import type { Project, Task } from '../../../types';
import { getTaskGovernance } from '../../../utils/projectTaskLifecycle';
import type { DomainEventEnvelope } from '../envelope';
import { collectTaskStatusDomainEvents } from './taskStatus';
import { emitTaskCompletedWorkforce } from '../../workforce/taskActivityBridge';
import { normalizeTaskStatus } from '../../../utils/taskStatus';

export type ApplyTaskStatusChangeContext = {
  organizationId: string | null;
  actorId: string | null;
  canGovernTasks: boolean;
};

export type ApplyTaskStatusChangeResult =
  | { ok: true; updatedProject: Project; statusDomainEvents: DomainEventEnvelope[] }
  | { ok: false; errorFr: string; errorEn: string; silent?: boolean };

/**
 * Commande métier : patch d’une tâche dans un projet (statut, champs associés).
 * Point d’entrée unique pour validation gouvernance, enrichissement « Réalisé », événements domaine.
 */
export function applyTaskStatusChange(
  project: Project,
  taskId: string,
  updates: Partial<Task> & Record<string, unknown>,
  ctx: ApplyTaskStatusChangeContext,
): ApplyTaskStatusChangeResult {
  const existing = (project.tasks || []).find((t) => t.id === taskId);
  if (!existing) {
    return { ok: false, errorFr: 'Tâche introuvable.', errorEn: 'Task not found.' };
  }
  const gov = getTaskGovernance(existing);
  if (
    !ctx.canGovernTasks &&
    gov === 'not_realized' &&
    updates.status !== undefined &&
    updates.status !== existing.status
  ) {
    return { ok: false, errorFr: '', errorEn: '', silent: true };
  }

  const merged: Record<string, unknown> = { ...updates };
  const nextStatusCanon = updates.status ? normalizeTaskStatus(updates.status as Task['status']) : null;
  if (nextStatusCanon === 'done') {
    merged.taskGovernance = 'done_proven';
    merged.completedAt = merged.completedAt ?? new Date().toISOString();
    merged.completedById = merged.completedById ?? ctx.actorId;
    merged.isFrozen = false;
  }

  const nextTaskRow = { ...existing, ...merged } as Task;

  let statusDomainEvents: DomainEventEnvelope[] = [];
  if (updates.status !== undefined && updates.status !== existing.status) {
    const collected = collectTaskStatusDomainEvents({
      organizationId: ctx.organizationId,
      projectId: String(project.id),
      task: nextTaskRow,
      previous: existing,
      actorId: ctx.actorId,
      source: 'ui',
    });
    if (collected.ok === false) {
      return { ok: false, errorFr: collected.errorFr, errorEn: collected.errorEn };
    }
    statusDomainEvents = collected.events;
  }

  const updatedTasks = (project.tasks || []).map((task) => (task.id === taskId ? nextTaskRow : task));
  const updatedProject: Project = { ...project, tasks: updatedTasks };

  if (updates.status !== undefined && updates.status !== existing.status) {
    emitTaskCompletedWorkforce({
      actorId: ctx.actorId,
      projectId: String(project.id),
      taskId: String(taskId),
      taskTitle: nextTaskRow.text,
      previousStatus: String(existing.status),
      nextStatus: String(nextTaskRow.status),
    });
  }

  return { ok: true, updatedProject, statusDomainEvents };
}
