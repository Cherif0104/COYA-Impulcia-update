import { supabase } from '../../supabaseService';
import type { Task } from '../../../types';

export type ProjectCommand =
  | {
      type: 'change_task_status';
      command_id?: string;
      projectId: string;
      taskId: string;
      status: Task['status'];
    }
  | {
      type: 'assign_task';
      command_id?: string;
      projectId: string;
      taskId: string;
      assigneeIds: string[];
    }
  | {
      type: 'add_dependency';
      command_id?: string;
      projectId: string;
      taskId: string;
      dependsOnTaskId: string;
    }
  | {
      type: 'create_task';
      command_id?: string;
      projectId: string;
      title: string;
      assigneeIds?: string[];
      dueDate?: string | null;
    };

export type CommandResult =
  | { ok: true; project?: any; tasks?: any[]; dependencies?: any[]; commandId: string; correlationId: string; eventIds: string[] }
  | { ok: false; error: string; code?: string; commandId: string; correlationId: string };

/**
 * Client BFF/Edge — stub : utilise un endpoint RPC ou Edge Function quand disponible.
 * Fallback : retourne une erreur explicite pour que l’UI n’exécute plus de mutation directe.
 */
export async function sendProjectCommand(
  cmd: ProjectCommand,
  opts?: { organizationId?: string | null; actorId?: string | null },
): Promise<CommandResult> {
  // Edge Function recommandée : "project-command"
  try {
    const { data, error } = await supabase.functions.invoke('project-command', {
      body: cmd,
      headers:
        opts?.organizationId || opts?.actorId
          ? {
              ...(opts?.organizationId ? { 'x-org-id': String(opts.organizationId) } : {}),
              ...(opts?.actorId ? { 'x-actor-id': String(opts.actorId) } : {}),
            }
          : undefined,
    });
    if (error) {
      return {
        ok: false,
        error: error.message || 'Invocation échouée',
        code: error.code,
        commandId: (cmd as any).command_id || 'unknown',
        correlationId: 'unknown',
      };
    }
    return {
      ok: true,
      project: data?.project,
      tasks: data?.tasks || [],
      dependencies: data?.dependencies || [],
      commandId: data?.command_id,
      correlationId: data?.correlation_id,
      eventIds: data?.event_ids || [],
    };
  } catch (e: any) {
    return {
      ok: false,
      error: e?.message || 'Edge non disponible',
      code: 'edge_unavailable',
      commandId: (cmd as any).command_id || 'unknown',
      correlationId: 'unknown',
    };
  }
}
