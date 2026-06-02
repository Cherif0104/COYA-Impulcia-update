import type { DomainEventEnvelope } from '../envelope';
import type { TaskStatusChangedPayload } from '../events/projectDomainEvents';
import { newDomainEventId, DOMAIN_EVENT_SCHEMA_VERSION } from '../envelope';
import type { ProjectDomainEvent } from '../events/projectDomainEvents';
import { buildProjectCockpitReadModel } from '../../projectCockpitReadModel';
import type { Project, TimeLog, Objective } from '../../../types';
import { buildProjectRiskReadModel, buildProjectTaskReadModel } from '../readModels/projectTaskReadModels';

/**
 * Effets secondaires déterministes après événements projet (phase 1 : projection cockpit + événement dérivé).
 * Pas d’I/O réseau ici — uniquement structures pures pour enchaînements futurs (notif, persistance event store).
 */
export type ProjectPolicyResult = {
  /** Événements dérivés à publier après le traitement du lot courant */
  derivedEvents: DomainEventEnvelope<ProjectDomainEvent['type'], unknown>[];
  /** Snapshot cockpit post-changement (pour debug / futur cache read model) */
  cockpitSnapshot?: ReturnType<typeof buildProjectCockpitReadModel>;
  taskReadModel?: ReturnType<typeof buildProjectTaskReadModel>;
  riskReadModel?: ReturnType<typeof buildProjectRiskReadModel>;
};

export function applyTaskStatusChangedPolicy(
  event: DomainEventEnvelope<'Task.StatusChanged', TaskStatusChangedPayload>,
  context: { project: Project; timeLogs: TimeLog[]; objectives: Objective[] },
): ProjectPolicyResult {
  const { projectId } = event.payload;
  if (String(context.project.id) !== String(projectId)) {
    return { derivedEvents: [] };
  }
  const next = event.payload.to;
  const cockpitSnapshot = buildProjectCockpitReadModel(context.project, context.timeLogs, context.objectives);
  const taskReadModel = buildProjectTaskReadModel(context.project);
  const riskReadModel = buildProjectRiskReadModel(context.project);
  const derived: DomainEventEnvelope<ProjectDomainEvent['type'], unknown>[] = [
    {
      eventId: newDomainEventId('evt.project.health'),
      type: 'Project.HealthRecalculated',
      occurredAt: new Date().toISOString(),
      schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
      organizationId: event.organizationId,
      actorId: null,
      source: 'system',
      correlationId: event.correlationId ?? null,
      causationId: event.eventId,
      payload: {
        projectId: String(projectId),
        reason: 'Task.StatusChanged',
      },
    },
  ];
  if (next === 'blocked' || next === 'cancelled' || next === 'on_hold') {
    const severity: 'warning' | 'critical' =
      next === 'cancelled' ? 'critical' : 'warning';
    derived.push({
      eventId: newDomainEventId('evt.project.notification'),
      type: 'Project.NotificationSuggested',
      occurredAt: new Date().toISOString(),
      schemaVersion: DOMAIN_EVENT_SCHEMA_VERSION,
      organizationId: event.organizationId,
      actorId: null,
      source: 'system',
      correlationId: event.correlationId ?? null,
      causationId: event.eventId,
      payload: {
        projectId: String(projectId),
        taskId: String(event.payload.taskId),
        severity,
        reason: `Task status is ${next}`,
      },
    });
  }

  return { derivedEvents: derived, cockpitSnapshot, taskReadModel, riskReadModel };
}
