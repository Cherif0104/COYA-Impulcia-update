import { getDomainEventBus } from './bus';
import type { DomainEventEnvelope } from './envelope';
import { applyTaskStatusChangedPolicy } from './policies/projectPolicies';
import type { TaskStatusChangedPayload, ProjectNotificationSuggestedPayload } from './events/projectDomainEvents';
import type { Project, TimeLog, Objective, User } from '../../types';
import NotificationService from '../notificationService';

let wired = false;

export type OrchestratorContext = {
  /** Projet courant après mutation (pour recalcul read model) */
  project: Project;
  timeLogs: TimeLog[];
  objectives: Objective[];
};

function projectRecipientIds(project: Project): string[] {
  const ids = new Set<string>();
  (project.team || []).forEach((member: User) => {
    if (member?.id != null) ids.add(String(member.id));
    if ((member as any)?.profileId) ids.add(String((member as any).profileId));
  });
  (project.teamMemberIds || []).forEach((id) => {
    if (id) ids.add(String(id));
  });
  if (project.createdById) ids.add(String(project.createdById));
  return Array.from(ids).filter(Boolean);
}

function projectNotifSeverityToType(severity: ProjectNotificationSuggestedPayload['severity']): 'info' | 'success' | 'warning' | 'error' {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

/**
 * Branche les politiques par défaut sur le bus (idempotent).
 */
export function ensureDomainOrchestratorWired(): void {
  if (wired) return;
  const bus = getDomainEventBus();
  if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
    bus.subscribeAll((e) => {
      // eslint-disable-next-line no-console -- instrumentation développement
      console.debug('[COYA domain]', e.type, e.eventId);
    });
  }
  bus.subscribe('Task.StatusChanged', (event) => {
    const env = event as DomainEventEnvelope<'Task.StatusChanged', TaskStatusChangedPayload>;
    const ctx = orchestratorContextRef.current;
    if (!ctx) return;
    const { derivedEvents } = applyTaskStatusChangedPolicy(env, {
      project: ctx.project,
      timeLogs: ctx.timeLogs,
      objectives: ctx.objectives,
    });
    derivedEvents.forEach((e) => bus.publish(e as DomainEventEnvelope));
  });
  bus.subscribe('Project.NotificationSuggested', (event) => {
    const env = event as DomainEventEnvelope<'Project.NotificationSuggested', ProjectNotificationSuggestedPayload>;
    const ctx = orchestratorContextRef.current;
    if (!ctx) return;
    const recipients = projectRecipientIds(ctx.project);
    if (recipients.length === 0) return;
    const type = projectNotifSeverityToType(env.payload.severity);
    const reason = env.payload.reason || 'Alerte projet';
    const title = ctx.project.title ? `Projet : ${ctx.project.title}` : 'Projet';
    // Fire and forget; ne bloque pas l’orchestrateur
    void NotificationService.notifyUsers(
      recipients,
      type,
      'project',
      'updated',
      title,
      reason,
      {
        entityType: 'project',
        entityId: String(env.payload.projectId),
        entityTitle: ctx.project.title,
        metadata: {
          taskId: env.payload.taskId,
          correlationId: env.correlationId ?? null,
          eventId: env.eventId,
        },
      },
    );
  });
  wired = true;
}

/** Contexte volatil pour la transaction UI courante (pas de global state métier persistant). */
const orchestratorContextRef: { current: OrchestratorContext | null } = { current: null };

export function withOrchestratorContext<T>(ctx: OrchestratorContext, fn: () => T): T {
  const prev = orchestratorContextRef.current;
  orchestratorContextRef.current = ctx;
  try {
    return fn();
  } finally {
    orchestratorContextRef.current = prev;
  }
}

/**
 * Publie un lot d’événements (et dérivés synchrones) après mutation projet.
 */
export function dispatchProjectDomainEvents(
  events: DomainEventEnvelope[],
  ctx: OrchestratorContext,
): void {
  if (events.length === 0) return;
  ensureDomainOrchestratorWired();
  const bus = getDomainEventBus();
  const batchCorrelation =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `corr-${Date.now()}`;
  const stamped = events.map((e) => ({
    ...e,
    correlationId: e.correlationId ?? batchCorrelation,
  }));
  withOrchestratorContext(ctx, () => {
    stamped.forEach((e) => bus.publish(e));
  });
}
