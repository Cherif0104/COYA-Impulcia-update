-- RLS policies pour projects / tasks / read models (adapter aux colonnes réelles).
-- Hypothèses : colonnes organization_id sur projects/tasks, project_id sur read models.

alter table if exists projects enable row level security;
alter table if exists tasks enable row level security;
alter table if exists project_tasks_read_model enable row level security;
alter table if exists project_risks_read_model enable row level security;

-- Policy lecture projets (membres org)
create policy if not exists projects_select_org on projects
for select
using (organization_id::text = auth.jwt() ->> 'organization_id');

-- Policy mutation projets (membres org)
create policy if not exists projects_write_org on projects
for all
using (organization_id::text = auth.jwt() ->> 'organization_id')
with check (organization_id::text = auth.jwt() ->> 'organization_id');

-- Policy lecture tâches (membres org)
create policy if not exists tasks_select_org on tasks
for select
using (organization_id::text = auth.jwt() ->> 'organization_id');

-- Policy write tâches (membres org)
create policy if not exists tasks_write_org on tasks
for all
using (organization_id::text = auth.jwt() ->> 'organization_id')
with check (organization_id::text = auth.jwt() ->> 'organization_id');

-- Read models : lecture uniquement
create policy if not exists project_tasks_rm_select_org on project_tasks_read_model
for select
using (project_id in (select id from projects where organization_id::text = auth.jwt() ->> 'organization_id'));

create policy if not exists project_risks_rm_select_org on project_risks_read_model
for select
using (project_id in (select id from projects where organization_id::text = auth.jwt() ->> 'organization_id'));
