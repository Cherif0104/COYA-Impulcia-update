import type { Task } from '../../../types';
import { newDomainEventId, type DomainEventEnvelope, DOMAIN_EVENT_SCHEMA_VERSION } from '../envelope';
import {
  taskUiStatusToCanon,
  type ProjectDomainEvent,
  type TaskStatusChangedPayload,
} from '../events/projectDomainEvents';
import { isAllowedTaskStatusTransition } from '../../../utils/taskStatus';
export { isAllowedTaskStatusTransition } from '../../../utils/taskStatus';

export type CollectTaskStatusEventsInput = {
  organizationId: string | null;
  projectId: string;
  task: Task;
  previous: Task;
  actorId?: string | null;
  source?: DomainEventEnvelope['source'];
};

export type CollectTaskStatusEventsResult =
  | { ok: true; events: DomainEventEnvelope<ProjectDomainEvent['type'], TaskStatusChangedPayload>[] }
  | { ok: false; errorFr: string; errorEn: string };

/**
 * Si le statut UI a changé : valide la transition et produit `Task.StatusChanged`.
 */
export function collectTaskStatusDomainEvents(input: CollectTaskStatusEventsInput): CollectTaskStatusEventsResult {
  const prev = input.previous.status;
  const next = input.task.status;
  const prevCanon = taskUiStatusToCanon(prev);
  const nextCanon = taskUiStatusToCanon(next);
  if (prevCanon === nextCanon) {
    return { ok: true, events: [] };
  }
  if (!isAllowedTaskStatusTransition(prev, next)) {
    return {
      ok: false,
      errorFr: `Transition de statut interdite : ${prev} → ${next}.`,
      errorEn: `Invalid status transition: ${prev} → ${next}.`,
    };
  }
  const occurredAt = new Date().toISOString();
  const payload: TaskStatusChangedPayload = {
    projectId: String(input.projectId),
    taskId: String(input.task.id),
    from: taskUiStatusToCanon(prev),
    to: taskUiStatusToCanon(next),
    taskTitle: input.task.text,
  };
  const envelope: DomainEventEnvelope<'Task.StatusChanged', TaskStatusChangedPayload> = {
    eventId: newDomainEventId('evt.task.status'),
    type: 'Task.StatusChanged',
    occurredAt,
    schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
    organizationId: input.organizationId,
    actorId: input.actorId ?? null,
    source: input.source ?? 'ui',
    payload,
  };
  return { ok: true, events: [envelope] };
}
