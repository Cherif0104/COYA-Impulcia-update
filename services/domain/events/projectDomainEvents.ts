/**
 * Événements domaine « Programmes & Projets » — alignés sur domains/projects/events.md.
 * Les types UI (Task.status) sont mappés en codes canon pour la traçabilité.
 */

import type { TaskStatusCanonical, Task } from '../../../types';
import { normalizeTaskStatus } from '../../../utils/taskStatus';

/** Codes état tâche canon (doc domains/projects/states.md) */
export type TaskStatusCanon = TaskStatusCanonical;

export function taskUiStatusToCanon(status: Task['status']): TaskStatusCanon {
  return normalizeTaskStatus(status);
}

export type ProjectDomainEventType = 'Task.StatusChanged' | 'Project.HealthRecalculated' | 'Project.NotificationSuggested';

export type TaskStatusChangedPayload = {
  projectId: string;
  taskId: string;
  from: TaskStatusCanon;
  to: TaskStatusCanon;
  taskTitle?: string;
};

export type ProjectHealthRecalculatedPayload = {
  projectId: string;
  /** Résumé optionnel pour read models / logs */
  reason?: string;
};

export type ProjectNotificationSuggestedPayload = {
  projectId: string;
  taskId?: string;
  severity: 'info' | 'warning' | 'critical';
  reason: string;
};

export type ProjectDomainEvent =
  | { type: 'Task.StatusChanged'; payload: TaskStatusChangedPayload }
  | { type: 'Project.HealthRecalculated'; payload: ProjectHealthRecalculatedPayload }
  | { type: 'Project.NotificationSuggested'; payload: ProjectNotificationSuggestedPayload };
