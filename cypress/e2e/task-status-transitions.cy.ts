import { isAllowedTaskStatusTransition } from '../../services/domain/commands/taskStatus';
import { normalizeTaskStatus } from '../../utils/taskStatus';

describe('Domain :: task status transitions (canonical)', () => {
  it('maps legacy statuses to canonical codes', () => {
    expect(normalizeTaskStatus('To Do')).to.eq('todo');
    expect(normalizeTaskStatus('In Progress')).to.eq('in_progress');
    expect(normalizeTaskStatus('Completed')).to.eq('done');
  });

  it('allows main forward path', () => {
    expect(isAllowedTaskStatusTransition('todo', 'in_progress')).to.eq(true);
    expect(isAllowedTaskStatusTransition('in_progress', 'in_review')).to.eq(true);
    expect(isAllowedTaskStatusTransition('in_review', 'done')).to.eq(true);
  });

  it('blocks illegal regressions to done', () => {
    expect(isAllowedTaskStatusTransition('done', 'in_progress')).to.eq(false);
    expect(isAllowedTaskStatusTransition('done', 'todo')).to.eq(false);
  });

  it('allows unblock and resume', () => {
    expect(isAllowedTaskStatusTransition('blocked', 'in_progress')).to.eq(true);
    expect(isAllowedTaskStatusTransition('on_hold', 'in_progress')).to.eq(true);
  });

  it.skip('enforces RLS scopes on project/task mutations (needs Supabase test env)', () => {
    // Prévoir : appeler une mutation protégée avec un profil hors scope et vérifier refus.
  });
});
