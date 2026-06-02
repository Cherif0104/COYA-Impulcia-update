import type { DomainEventRow } from '../domainEventQueries';
import type { TaskStatusChangedPayload } from '../events/projectDomainEvents';

function canonToLabel(code: string, lang: 'fr' | 'en'): string {
  const m: Record<string, { fr: string; en: string }> = {
    draft: { fr: 'Brouillon', en: 'Draft' },
    todo: { fr: 'À faire', en: 'To do' },
    in_progress: { fr: 'En cours', en: 'In progress' },
    in_review: { fr: 'En validation', en: 'In review' },
    done: { fr: 'Réalisé', en: 'Completed' },
    blocked: { fr: 'Bloqué', en: 'Blocked' },
    on_hold: { fr: 'En pause', en: 'On hold' },
    cancelled: { fr: 'Annulé', en: 'Cancelled' },
  };
  return m[code]?.[lang] ?? code;
}

export type DomainEventViewModel = {
  primary: string;
  secondary?: string;
  isFollowUp: boolean;
};

/**
 * Projection UX : libellés métier (pas les noms techniques d’événements seuls).
 */
export function formatProjectDomainEventViewModel(row: DomainEventRow, lang: 'fr' | 'en'): DomainEventViewModel {
  const isFollowUp = Boolean(row.causation_id);

  if (row.event_type === 'Task.StatusChanged') {
    const p = row.payload as TaskStatusChangedPayload;
    const title = (p.taskTitle || p.taskId || '').trim();
    const fromL = canonToLabel(String(p.from), lang);
    const toL = canonToLabel(String(p.to), lang);
    if (lang === 'fr') {
      return {
        primary: title ? `Tâche « ${title} » : ${fromL} → ${toL}` : `Tâche ${p.taskId} : ${fromL} → ${toL}`,
        secondary: undefined,
        isFollowUp,
      };
    }
    return {
      primary: title ? `Task "${title}": ${fromL} → ${toL}` : `Task ${p.taskId}: ${fromL} → ${toL}`,
      isFollowUp,
    };
  }

  if (row.event_type === 'Project.HealthRecalculated') {
    const reason = (row.payload as { reason?: string })?.reason;
    if (lang === 'fr') {
      return {
        primary: 'Santé du projet recalculée (cockpit)',
        secondary: reason ? `Motif : ${reason}` : undefined,
        isFollowUp,
      };
    }
    return {
      primary: 'Project health recalculated (cockpit)',
      secondary: reason ? `Reason: ${reason}` : undefined,
      isFollowUp,
    };
  }

  if (row.event_type === 'Project.NotificationSuggested') {
    const payload = row.payload as { reason?: string; severity?: string; taskId?: string };
    const titleFr = payload.taskId ? `Alerte tâche ${payload.taskId}` : 'Alerte projet';
    const titleEn = payload.taskId ? `Task alert ${payload.taskId}` : 'Project alert';
    if (lang === 'fr') {
      return {
        primary: `${titleFr} (${payload.severity || 'info'})`,
        secondary: payload.reason,
        isFollowUp,
      };
    }
    return {
      primary: `${titleEn} (${payload.severity || 'info'})`,
      secondary: payload.reason,
      isFollowUp,
    };
  }

  return {
    primary: row.event_type,
    secondary: row.client_event_id,
    isFollowUp,
  };
}
