-- Event store minimal pour commandes projet/tâche
create table if not exists domain_events (
  event_id uuid primary key,
  command_id uuid,
  correlation_id uuid,
  organization_id text,
  actor_id text,
  event_type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_domain_events_corr on domain_events(correlation_id);
create index if not exists idx_domain_events_cmd on domain_events(command_id);
create index if not exists idx_domain_events_org on domain_events(organization_id);
