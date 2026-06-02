import type { Task } from '../types';
import { normalizeTaskStatus } from './taskStatus';

export function getTaskGovernance(task: Task): NonNullable<Task['taskGovernance']> {
  if (task.taskGovernance) return task.taskGovernance;
  if (normalizeTaskStatus(task.status) === 'done') return 'done_proven';
  return 'open';
}

/** Aligné fiche projet : clôture auto des périodes dépassées (gouvernance). */
export function applyProjectTasksAutoClose(tasks: Task[]): Task[] {
  const today = new Date().toISOString().slice(0, 10);
  return tasks.map((t) => {
    const g = getTaskGovernance(t);
    if (g === 'not_realized' || g === 'closed_out') return t;
    const end = t.periodEnd || t.dueDate;
    if (!end) return t;
    if (today > String(end).slice(0, 10) && normalizeTaskStatus(t.status) !== 'done') {
      return {
        ...t,
        taskGovernance: 'not_realized' as const,
        isFrozen: true,
        productivityPenalty: Math.min(1, Number(t.productivityPenalty ?? 0) + 0.2),
      };
    }
    return t;
  });
}

export function isTaskScheduledFrozen(task: Task): boolean {
  if (normalizeTaskStatus(task.status) === 'done') return false;
  if (task.isFrozen) return true;
  if (!task.scheduledDate) return false;
  const scheduled = new Date(task.scheduledDate);
  if (task.scheduledTime) {
    const [h, m] = task.scheduledTime.split(':').map(Number);
    scheduled.setHours(h, m || 0, 0, 0);
  }
  const end = task.scheduledDurationMinutes
    ? new Date(scheduled.getTime() + task.scheduledDurationMinutes * 60 * 1000)
    : scheduled;
  return new Date() > end;
}
