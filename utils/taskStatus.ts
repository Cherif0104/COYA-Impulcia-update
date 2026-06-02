import type {
  ProjectStatus,
  ProjectStatusCanonical,
  ProjectStatusLegacy,
  Task,
  TaskStatus,
  TaskStatusCanonical,
  TaskStatusLegacy,
} from '../types';

export const TASK_STATUS_CANONICAL: TaskStatusCanonical[] = [
  'draft',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'blocked',
  'on_hold',
  'cancelled',
];

const LEGACY_TASK_TO_CANON: Record<TaskStatusLegacy, TaskStatusCanonical> = {
  'To Do': 'todo',
  'In Progress': 'in_progress',
  Completed: 'done',
};

const TASK_TRANSITIONS: Record<TaskStatusCanonical, TaskStatusCanonical[]> = {
  draft: ['todo', 'cancelled'],
  todo: ['in_progress', 'on_hold', 'cancelled'],
  in_progress: ['in_review', 'blocked', 'on_hold', 'cancelled', 'done'],
  in_review: ['done', 'in_progress', 'cancelled'],
  done: [],
  blocked: ['in_progress', 'on_hold', 'cancelled'],
  on_hold: ['todo', 'in_progress', 'cancelled'],
  cancelled: [],
};

export function normalizeTaskStatus(status: TaskStatus | undefined): TaskStatusCanonical {
  if (!status) return 'todo';
  const s = String(status).toLowerCase();
  if (TASK_STATUS_CANONICAL.includes(status as TaskStatusCanonical)) {
    return status as TaskStatusCanonical;
  }
  if (s === 'to do' || s === 'todo') return 'todo';
  if (s === 'in progress' || s === 'in_progress') return 'in_progress';
  if (s === 'completed' || s === 'done') return 'done';
  if (s === 'blocked') return 'blocked';
  if (s === 'on hold' || s === 'on_hold' || s === 'paused') return 'on_hold';
  if (s === 'in review' || s === 'in_review') return 'in_review';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  if (s === 'draft') return 'draft';
  return 'todo';
}

export function isAllowedTaskStatusTransition(from: TaskStatus, to: TaskStatus): boolean {
  const f = normalizeTaskStatus(from);
  const t = normalizeTaskStatus(to);
  return TASK_TRANSITIONS[f]?.includes(t) ?? false;
}

export function taskStatusCanonToLabel(status: TaskStatusCanonical): string {
  switch (status) {
    case 'draft':
      return 'Brouillon';
    case 'todo':
      return 'À faire';
    case 'in_progress':
      return 'En cours';
    case 'in_review':
      return 'En validation';
    case 'done':
      return 'Réalisé';
    case 'blocked':
      return 'Bloqué';
    case 'on_hold':
      return 'En pause';
    case 'cancelled':
      return 'Annulé';
    default:
      return status;
  }
}

export function mapDbStatusToTaskStatus(status: string | undefined | null): Task['status'] {
  if (!status) return 'todo';
  const s = String(status).toLowerCase();
  if (s === 'completed' || s === 'done') return 'done';
  if (s === 'to_do' || s === 'todo') return 'todo';
  if (s === 'in_progress') return 'in_progress';
  if (s === 'in_review') return 'in_review';
  if (s === 'blocked') return 'blocked';
  if (s === 'on_hold') return 'on_hold';
  if (s === 'draft') return 'draft';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return 'todo';
}

export function mapTaskStatusToDb(status: Task['status'] | undefined): string {
  const s = normalizeTaskStatus(status);
  switch (s) {
    case 'todo':
      return 'to_do';
    case 'in_progress':
      return 'in_progress';
    case 'in_review':
      return 'in_review';
    case 'done':
      return 'completed';
    case 'blocked':
      return 'blocked';
    case 'on_hold':
      return 'on_hold';
    case 'cancelled':
      return 'cancelled';
    case 'draft':
      return 'draft';
    default:
      return 'to_do';
  }
}

export const PROJECT_STATUS_CANONICAL: ProjectStatusCanonical[] = ['proposed', 'active', 'closing', 'closed', 'cancelled'];

const LEGACY_PROJECT_TO_CANON: Record<ProjectStatusLegacy, ProjectStatusCanonical> = {
  'Not Started': 'proposed',
  'In Progress': 'active',
  Completed: 'closed',
  'On Hold': 'closing',
  Cancelled: 'cancelled',
};

export function normalizeProjectStatus(status: ProjectStatus | undefined): ProjectStatusCanonical {
  if (!status) return 'proposed';
  const s = String(status).toLowerCase();
  if (PROJECT_STATUS_CANONICAL.includes(status as ProjectStatusCanonical)) {
    return status as ProjectStatusCanonical;
  }
  const legacy = LEGACY_PROJECT_TO_CANON[status as ProjectStatusLegacy];
  if (legacy) return legacy;
  if (s === 'proposed') return 'proposed';
  if (s === 'active' || s === 'in progress') return 'active';
  if (s === 'closing' || s === 'on hold') return 'closing';
  if (s === 'closed' || s === 'completed') return 'closed';
  if (s === 'cancelled' || s === 'canceled') return 'cancelled';
  return 'proposed';
}
