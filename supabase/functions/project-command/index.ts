// Edge Function: project-command
// Routes project/task commands avec corrélation command_id / event_id et logs structurés.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

type ProjectCommand =
  | { type: 'change_task_status'; command_id?: string; projectId: string; taskId: string; status: string }
  | { type: 'create_task'; command_id?: string; projectId: string; title: string; assigneeIds?: string[]; dueDate?: string | null }
  | { type: 'assign_task'; command_id?: string; projectId: string; taskId: string; assigneeIds: string[] }
  | { type: 'add_dependency'; command_id?: string; projectId: string; taskId: string; dependsOnTaskId: string };

type CommandResponse =
  | { ok: true; command_id: string; correlation_id: string; event_ids: string[]; project?: any; tasks?: any[]; dependencies?: any[] }
  | { ok: false; command_id: string; correlation_id: string; error: string; code?: string };

function uuid(): string {
  return crypto.randomUUID();
}

function log(payload: Record<string, unknown>) {
  console.log(JSON.stringify({ service: 'project-command', ...payload }));
}

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !supabaseServiceKey) {
  log({ level: 'error', message: 'Supabase env missing' });
}
const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null;

async function getProjectOrg(projectId: string): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('projects').select('organization_id').eq('id', projectId).maybeSingle();
  if (error || !data) return null;
  return (data as any).organization_id ? String((data as any).organization_id) : null;
}

async function insertDomainEvent(params: {
  eventId: string;
  commandId: string;
  correlationId: string;
  organizationId: string | null;
  actorId: string | null;
  type: string;
  payload: Record<string, unknown>;
}) {
  if (!supabase) return;
  await supabase.from('domain_events').insert({
    event_id: params.eventId,
    command_id: params.commandId,
    correlation_id: params.correlationId,
    organization_id: params.organizationId,
    actor_id: params.actorId,
    event_type: params.type,
    payload: params.payload,
  });
}

async function handleChangeTaskStatus(cmd: Extract<ProjectCommand, { type: 'change_task_status' }>, correlationId: string) {
  if (!supabase) throw new Error('Supabase client not available');
  const eventId = uuid();
  const { data, error } = await supabase
    .from('tasks')
    .update({ status: cmd.status, updated_at: new Date().toISOString() })
    .eq('project_id', cmd.projectId)
    .eq('id', cmd.taskId)
    .select('*')
    .single();
  if (error) throw error;
  return { eventIds: [eventId], updated: data };
}

async function handleAssignTask(cmd: Extract<ProjectCommand, { type: 'assign_task' }>, correlationId: string) {
  if (!supabase) throw new Error('Supabase client not available');
  const eventId = uuid();
  const { data, error } = await supabase
    .from('tasks')
    .update({ assignee_ids: cmd.assigneeIds, updated_at: new Date().toISOString() })
    .eq('project_id', cmd.projectId)
    .eq('id', cmd.taskId)
    .select('*')
    .single();
  if (error) throw error;
  return { eventIds: [eventId], updated: data };
}

async function handleCreateTask(cmd: Extract<ProjectCommand, { type: 'create_task' }>, correlationId: string) {
  if (!supabase) throw new Error('Supabase client not available');
  const eventId = uuid();
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      id: uuid(),
      project_id: cmd.projectId,
      title: cmd.title || 'Tâche',
      status: 'to_do',
      assignee_ids: cmd.assigneeIds || [],
      due_date: cmd.dueDate || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return { eventIds: [eventId], created: data };
}

async function handleAddDependency(cmd: Extract<ProjectCommand, { type: 'add_dependency' }>, organizationId: string | null, actorId: string | null) {
  if (!supabase) throw new Error('Supabase client not available');
  if (!organizationId) throw new Error('organization_id is required for add_dependency');
  const eventId = uuid();
  const { data, error } = await supabase
    .from('task_dependencies')
    .insert({
      organization_id: organizationId,
      project_id: cmd.projectId,
      task_id: cmd.taskId,
      depends_on_task_id: cmd.dependsOnTaskId,
      created_by_id: actorId,
    })
    .select('*')
    .single();
  if (error && String(error.code) !== '23505') throw error;
  return { eventIds: [eventId], dependency: data ?? null };
}

async function fetchProjectProjection(projectId: string) {
  if (!supabase) return { project: null, tasks: [], dependencies: [] };
  const [{ data: project }, { data: tasks }, { data: deps }] = await Promise.all([
    supabase.from('projects').select('*').eq('id', projectId).maybeSingle(),
    supabase.from('tasks').select('*').eq('project_id', projectId).order('created_at', { ascending: true }),
    supabase.from('task_dependencies').select('*').eq('project_id', projectId),
  ]);
  return {
    project: project ?? null,
    tasks: tasks ?? [],
    dependencies: deps ?? [],
  };
}

serve(async (req): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }
  const correlationId = uuid();
  let commandId = uuid();
  try {
    const cmd = (await req.json()) as ProjectCommand;
    if (cmd.command_id) commandId = cmd.command_id;
    log({ level: 'info', message: 'command_received', command_id: commandId, correlation_id: correlationId, type: cmd.type });

    const orgHeader = req.headers.get('x-org-id') || null;
    const actorHeader = req.headers.get('x-actor-id') || null;
    let result: { eventIds: string[]; updated?: any; created?: any } = { eventIds: [] };

    // Validation org si header présent
    if (orgHeader) {
      const projOrg = await getProjectOrg(cmd.projectId);
      if (projOrg && projOrg !== orgHeader) {
        return new Response(
          JSON.stringify({
            ok: false,
            command_id: commandId,
            correlation_id: correlationId,
            error: 'Forbidden (org mismatch)',
            code: 'forbidden',
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    if (cmd.type === 'change_task_status') {
      result = await handleChangeTaskStatus(cmd, correlationId);
    } else if (cmd.type === 'create_task') {
      result = await handleCreateTask(cmd, correlationId);
    } else if (cmd.type === 'assign_task') {
      result = await handleAssignTask(cmd, correlationId);
    } else if (cmd.type === 'add_dependency') {
      result = await handleAddDependency(cmd, orgHeader, actorHeader);
    } else {
      throw new Error(`Unsupported command type: ${cmd.type}`);
    }

    // Event store
    await insertDomainEvent({
      eventId: uuid(),
      commandId,
      correlationId,
      organizationId: orgHeader,
      actorId: actorHeader,
      type: cmd.type,
      payload: cmd as Record<string, unknown>,
    });

    const projection = await fetchProjectProjection(cmd.projectId);
    const resp: CommandResponse = {
      ok: true,
      command_id: commandId,
      correlation_id: correlationId,
      event_ids: result.eventIds,
      project: projection.project,
      tasks: projection.tasks,
      dependencies: projection.dependencies,
    };
    return new Response(JSON.stringify(resp), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    log({
      level: 'error',
      message: 'command_failed',
      error: e?.message || 'unknown',
      command_id: commandId,
      correlation_id: correlationId,
      stack: e?.stack,
    });
    const resp: CommandResponse = {
      ok: false,
      command_id: commandId,
      correlation_id: correlationId,
      error: e?.message || 'unknown',
      code: e?.code,
    };
    return new Response(JSON.stringify(resp), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
});
