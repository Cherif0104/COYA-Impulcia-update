-- Read models matérialisés pour projets/tâches/risques (exemple minimal).
-- À adapter selon schéma réel (tables projects, tasks, risks).

create materialized view if not exists project_tasks_read_model as
select
  p.id as project_id,
  count(t.id)::int as total_tasks,
  count(*) filter (where t.status = 'in_progress')::int as in_progress,
  count(*) filter (where t.status = 'completed' or t.status = 'done')::int as done,
  count(*) filter (where t.status = 'blocked')::int as blocked,
  count(*) filter (where t.status = 'on_hold')::int as on_hold,
  count(*) filter (where t.due_date is not null and t.due_date < now() and (t.status != 'completed' and t.status != 'done'))::int as overdue
from projects p
left join tasks t on t.project_id = p.id
group by p.id;

create materialized view if not exists project_risks_read_model as
select
  p.id as project_id,
  count(r.id)::int as total_risks,
  count(*) filter (where r.status = 'open')::int as open_risks,
  count(*) filter (where r.status = 'mitigating')::int as mitigating_risks,
  count(*) filter (where r.status = 'closed')::int as closed_risks,
  count(*) filter (where r.impact = 'High' or r.likelihood = 'High')::int as high_risks
from projects p
left join risks r on r.project_id = p.id
group by p.id;

-- Index pour rafraîchissement rapide
create index if not exists idx_project_tasks_read_model_proj on project_tasks_read_model(project_id);
create index if not exists idx_project_risks_read_model_proj on project_risks_read_model(project_id);
