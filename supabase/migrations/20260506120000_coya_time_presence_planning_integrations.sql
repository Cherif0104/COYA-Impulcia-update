-- =============================================================================
-- COYA — Temps, présence, planification, synthèse journalière, preuves, intégrations
-- Source de vérité : Supabase (app coya-pro). Idempotent où possible.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Pointage : événements (check-in / check-out / pauses)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_attendance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event_kind text NOT NULL CHECK (event_kind = ANY (ARRAY['check_in'::text, 'check_out'::text, 'break_start'::text, 'break_end'::text])),
  source text NOT NULL DEFAULT 'web' CHECK (source = ANY (ARRAY['web'::text, 'mobile'::text, 'manual'::text, 'import'::text])),
  geo jsonb,
  client_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coya_attendance_events_org_profile_time_idx
  ON public.coya_attendance_events (organization_id, profile_id, occurred_at DESC);

COMMENT ON TABLE public.coya_attendance_events IS 'Pointage COYA : événements horodatés (équivalent hiérarchique hr.attendance check in/out).';

-- ---------------------------------------------------------------------------
-- 2) Temps projet / tâche (lignes de temps + statut de ligne)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_project_time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  project_id uuid,
  task_ref text,
  activity_type text NOT NULL DEFAULT 'production',
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_minutes int NOT NULL GENERATED ALWAYS AS (
    GREATEST(0, (EXTRACT(epoch FROM (ended_at - started_at)) / 60)::int)
  ) STORED,
  line_status text NOT NULL DEFAULT 'draft'
    CHECK (line_status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text])),
  timesheet_period_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coya_project_time_entries_time_chk CHECK (ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS coya_project_time_entries_org_profile_start_idx
  ON public.coya_project_time_entries (organization_id, profile_id, started_at DESC);
CREATE INDEX IF NOT EXISTS coya_project_time_entries_org_project_idx
  ON public.coya_project_time_entries (organization_id, project_id)
  WHERE project_id IS NOT NULL;

COMMENT ON TABLE public.coya_project_time_entries IS 'Feuille de temps COYA : durées sur projet / tâche (task_ref libre ou clé externe).';

-- FK optionnelle vers projects si la table existe
DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'coya_project_time_entries_project_id_fkey'
    ) THEN
      ALTER TABLE public.coya_project_time_entries
        ADD CONSTRAINT coya_project_time_entries_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE SET NULL;
    END IF;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 3) Périodes de timesheet (soumission / approbation N+1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_timesheet_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status = ANY (ARRAY['draft'::text, 'submitted'::text, 'approved'::text, 'rejected'::text])),
  decided_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  decided_at timestamptz,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coya_timesheet_periods_range_chk CHECK (period_end >= period_start)
);

CREATE UNIQUE INDEX IF NOT EXISTS coya_timesheet_periods_profile_range_uidx
  ON public.coya_timesheet_periods (profile_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS coya_timesheet_periods_org_status_idx
  ON public.coya_timesheet_periods (organization_id, status);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'coya_project_time_entries_timesheet_period_fkey'
  ) THEN
    ALTER TABLE public.coya_project_time_entries
      ADD CONSTRAINT coya_project_time_entries_timesheet_period_fkey
      FOREIGN KEY (timesheet_period_id) REFERENCES public.coya_timesheet_periods (id) ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END$$;

-- ---------------------------------------------------------------------------
-- 4) Planification (créneaux prévus)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_planning_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  title text NOT NULL,
  slot_type text NOT NULL DEFAULT 'bureau',
  date_start timestamptz NOT NULL,
  date_end timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'draft'
    CHECK (state = ANY (ARRAY['draft'::text, 'confirmed'::text, 'done'::text, 'cancelled'::text])),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coya_planning_slots_range_chk CHECK (date_end > date_start)
);

CREATE INDEX IF NOT EXISTS coya_planning_slots_org_profile_start_idx
  ON public.coya_planning_slots (organization_id, profile_id, date_start DESC);

-- ---------------------------------------------------------------------------
-- 5) Autorisations de saisie temps par tâche (N+1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_task_time_allowances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  project_id uuid,
  task_ref text NOT NULL,
  assigned_by_profile_id uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  valid_from date,
  valid_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coya_task_time_allowances_task_nonempty CHECK (length(trim(task_ref)) > 0)
);

CREATE INDEX IF NOT EXISTS coya_task_time_allowances_lookup_idx
  ON public.coya_task_time_allowances (organization_id, profile_id, project_id, task_ref);

DO $$
BEGIN
  IF to_regclass('public.projects') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'coya_task_time_allowances_project_id_fkey'
    ) THEN
      ALTER TABLE public.coya_task_time_allowances
        ADD CONSTRAINT coya_task_time_allowances_project_id_fkey
        FOREIGN KEY (project_id) REFERENCES public.projects (id) ON DELETE CASCADE;
    END IF;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 6) Synthèse journalière (agrégat déterministe)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_work_day_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  work_date date NOT NULL,
  minutes_project_work int NOT NULL DEFAULT 0,
  minutes_planning int NOT NULL DEFAULT 0,
  minutes_attendance_span int NOT NULL DEFAULT 0,
  presence_status text NOT NULL DEFAULT 'unknown'
    CHECK (presence_status = ANY (ARRAY[
      'unknown'::text, 'present'::text, 'partial'::text, 'absent'::text,
      'leave'::text, 'remote'::text
    ])),
  journey_completed boolean NOT NULL DEFAULT false,
  summary_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_computed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coya_work_day_summaries_uniq UNIQUE (profile_id, work_date)
);

CREATE INDEX IF NOT EXISTS coya_work_day_summaries_org_date_idx
  ON public.coya_work_day_summaries (organization_id, work_date DESC);

-- ---------------------------------------------------------------------------
-- 7) Preuves de réalisation
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_work_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  work_date date NOT NULL,
  proof_type text NOT NULL CHECK (proof_type = ANY (ARRAY['external_url'::text, 'storage_file'::text])),
  external_url text,
  storage_object_path text,
  related_time_entry_id uuid REFERENCES public.coya_project_time_entries (id) ON DELETE SET NULL,
  caption text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coya_work_proofs_payload_chk CHECK (
    (proof_type = 'external_url' AND external_url IS NOT NULL AND length(trim(external_url)) > 0)
    OR (proof_type = 'storage_file' AND storage_object_path IS NOT NULL AND length(trim(storage_object_path)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS coya_work_proofs_org_profile_date_idx
  ON public.coya_work_proofs (organization_id, profile_id, work_date DESC);

-- ---------------------------------------------------------------------------
-- 8) Connecteurs externes (stub — pas de secrets en clair ; config chiffrée côté app)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coya_external_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = ANY (ARRAY[
    'atlassian'::text, 'monday'::text, 'google_drive'::text, 'odoo_sync'::text, 'other'::text
  ])),
  status text NOT NULL DEFAULT 'inactive' CHECK (status = ANY (ARRAY['inactive'::text, 'active'::text, 'error'::text])),
  display_name text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coya_external_integrations_org_provider_uidx UNIQUE (organization_id, provider)
);

CREATE INDEX IF NOT EXISTS coya_external_integrations_org_idx
  ON public.coya_external_integrations (organization_id);

-- ---------------------------------------------------------------------------
-- 9) Rôles « pilotage » (même logique que user_departments / pay_slips)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coya_profile_can_pilot_timesheets(p_actor uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles pr
    WHERE pr.user_id = p_actor
      AND (pr.role)::text = ANY (ARRAY[
        'super_administrator'::text,
        'administrator'::text,
        'manager'::text,
        'supervisor'::text,
        'team_lead'::text,
        'hr_officer'::text,
        'hr_business_partner'::text
      ])
  );
$$;

-- ---------------------------------------------------------------------------
-- 10) RLS — politiques multi-tenant par organization_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.coya_attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coya_project_time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coya_timesheet_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coya_planning_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coya_task_time_allowances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coya_work_day_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coya_work_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coya_external_integrations ENABLE ROW LEVEL SECURITY;

-- Attendance : lecture / écriture dans son org ; insert pour soi ou si pilotage (manager saisit pour autrui — option)
DROP POLICY IF EXISTS "coya_attendance_select_org" ON public.coya_attendance_events;
CREATE POLICY "coya_attendance_select_org"
  ON public.coya_attendance_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_attendance_events.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_attendance_insert_self_or_pilot" ON public.coya_attendance_events;
CREATE POLICY "coya_attendance_insert_self_or_pilot"
  ON public.coya_attendance_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_attendance_events.organization_id
        AND (
          p.id = coya_attendance_events.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "coya_attendance_update_org" ON public.coya_attendance_events;
CREATE POLICY "coya_attendance_update_org"
  ON public.coya_attendance_events FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_attendance_events.organization_id
        AND (p.id = coya_attendance_events.profile_id OR public.coya_profile_can_pilot_timesheets(auth.uid()))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_attendance_events.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_attendance_delete_org" ON public.coya_attendance_events;
CREATE POLICY "coya_attendance_delete_org"
  ON public.coya_attendance_events FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_attendance_events.organization_id
        AND (p.id = coya_attendance_events.profile_id OR public.coya_profile_can_pilot_timesheets(auth.uid()))
    )
  );

-- Project time entries
DROP POLICY IF EXISTS "coya_pte_select_org" ON public.coya_project_time_entries;
CREATE POLICY "coya_pte_select_org"
  ON public.coya_project_time_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_project_time_entries.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_pte_insert_self_or_pilot" ON public.coya_project_time_entries;
CREATE POLICY "coya_pte_insert_self_or_pilot"
  ON public.coya_project_time_entries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_project_time_entries.organization_id
        AND (
          p.id = coya_project_time_entries.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "coya_pte_update_self_or_pilot" ON public.coya_project_time_entries;
CREATE POLICY "coya_pte_update_self_or_pilot"
  ON public.coya_project_time_entries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_project_time_entries.organization_id
        AND (
          p.id = coya_project_time_entries.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_project_time_entries.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_pte_delete_self_or_pilot" ON public.coya_project_time_entries;
CREATE POLICY "coya_pte_delete_self_or_pilot"
  ON public.coya_project_time_entries FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_project_time_entries.organization_id
        AND (
          p.id = coya_project_time_entries.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

-- Timesheet periods
DROP POLICY IF EXISTS "coya_tsp_select_org" ON public.coya_timesheet_periods;
CREATE POLICY "coya_tsp_select_org"
  ON public.coya_timesheet_periods FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_timesheet_periods.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_tsp_insert_self_or_pilot" ON public.coya_timesheet_periods;
CREATE POLICY "coya_tsp_insert_self_or_pilot"
  ON public.coya_timesheet_periods FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_timesheet_periods.organization_id
        AND (
          p.id = coya_timesheet_periods.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "coya_tsp_update_self_or_pilot" ON public.coya_timesheet_periods;
CREATE POLICY "coya_tsp_update_self_or_pilot"
  ON public.coya_timesheet_periods FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_timesheet_periods.organization_id
        AND (
          p.id = coya_timesheet_periods.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_timesheet_periods.organization_id
    )
  );

-- Planning slots
DROP POLICY IF EXISTS "coya_planning_select_org" ON public.coya_planning_slots;
CREATE POLICY "coya_planning_select_org"
  ON public.coya_planning_slots FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_planning_slots.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_planning_write_self_or_pilot" ON public.coya_planning_slots;
CREATE POLICY "coya_planning_write_self_or_pilot"
  ON public.coya_planning_slots FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_planning_slots.organization_id
        AND (
          p.id = coya_planning_slots.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "coya_planning_update_self_or_pilot" ON public.coya_planning_slots;
CREATE POLICY "coya_planning_update_self_or_pilot"
  ON public.coya_planning_slots FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_planning_slots.organization_id
        AND (
          p.id = coya_planning_slots.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_planning_slots.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_planning_delete_self_or_pilot" ON public.coya_planning_slots;
CREATE POLICY "coya_planning_delete_self_or_pilot"
  ON public.coya_planning_slots FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_planning_slots.organization_id
        AND (
          p.id = coya_planning_slots.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

-- Task allowances : lecture org ; écriture réservée aux profils pilotage
DROP POLICY IF EXISTS "coya_tta_select_org" ON public.coya_task_time_allowances;
CREATE POLICY "coya_tta_select_org"
  ON public.coya_task_time_allowances FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_task_time_allowances.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_tta_write_pilot" ON public.coya_task_time_allowances;
CREATE POLICY "coya_tta_write_pilot"
  ON public.coya_task_time_allowances FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_task_time_allowances.organization_id
        AND public.coya_profile_can_pilot_timesheets(auth.uid())
    )
  );

DROP POLICY IF EXISTS "coya_tta_update_pilot" ON public.coya_task_time_allowances;
CREATE POLICY "coya_tta_update_pilot"
  ON public.coya_task_time_allowances FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_task_time_allowances.organization_id
        AND public.coya_profile_can_pilot_timesheets(auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_task_time_allowances.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_tta_delete_pilot" ON public.coya_task_time_allowances;
CREATE POLICY "coya_tta_delete_pilot"
  ON public.coya_task_time_allowances FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_task_time_allowances.organization_id
        AND public.coya_profile_can_pilot_timesheets(auth.uid())
    )
  );

-- Work day summaries : lecture org ; écriture via fonction / trigger (service) — utilisateurs voient leur ligne
DROP POLICY IF EXISTS "coya_wds_select_org" ON public.coya_work_day_summaries;
CREATE POLICY "coya_wds_select_org"
  ON public.coya_work_day_summaries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_work_day_summaries.organization_id
    )
  );

-- Mise à jour manuelle réservée au pilotage (recalcul batch admin)
DROP POLICY IF EXISTS "coya_wds_write_pilot" ON public.coya_work_day_summaries;
CREATE POLICY "coya_wds_write_pilot"
  ON public.coya_work_day_summaries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_work_day_summaries.organization_id
        AND public.coya_profile_can_pilot_timesheets(auth.uid())
    )
  );

DROP POLICY IF EXISTS "coya_wds_update_pilot" ON public.coya_work_day_summaries;
CREATE POLICY "coya_wds_update_pilot"
  ON public.coya_work_day_summaries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_work_day_summaries.organization_id
        AND public.coya_profile_can_pilot_timesheets(auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_work_day_summaries.organization_id
    )
  );

-- Proofs : soi + pilotage lecture org
DROP POLICY IF EXISTS "coya_proofs_select_org" ON public.coya_work_proofs;
CREATE POLICY "coya_proofs_select_org"
  ON public.coya_work_proofs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_work_proofs.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_proofs_insert_self_or_pilot" ON public.coya_work_proofs;
CREATE POLICY "coya_proofs_insert_self_or_pilot"
  ON public.coya_work_proofs FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_work_proofs.organization_id
        AND (
          p.id = coya_work_proofs.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "coya_proofs_update_self_or_pilot" ON public.coya_work_proofs;
CREATE POLICY "coya_proofs_update_self_or_pilot"
  ON public.coya_work_proofs FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_work_proofs.organization_id
        AND (
          p.id = coya_work_proofs.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_work_proofs.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_proofs_delete_self_or_pilot" ON public.coya_work_proofs;
CREATE POLICY "coya_proofs_delete_self_or_pilot"
  ON public.coya_work_proofs FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_work_proofs.organization_id
        AND (
          p.id = coya_work_proofs.profile_id
          OR public.coya_profile_can_pilot_timesheets(auth.uid())
        )
    )
  );

-- External integrations : admin org
DROP POLICY IF EXISTS "coya_ext_select_org" ON public.coya_external_integrations;
CREATE POLICY "coya_ext_select_org"
  ON public.coya_external_integrations FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id IS NOT DISTINCT FROM coya_external_integrations.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_ext_write_admin" ON public.coya_external_integrations;
CREATE POLICY "coya_ext_write_admin"
  ON public.coya_external_integrations FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_external_integrations.organization_id
        AND (p.role)::text = ANY (ARRAY['super_administrator'::text, 'administrator'::text])
    )
  );

DROP POLICY IF EXISTS "coya_ext_update_admin" ON public.coya_external_integrations;
CREATE POLICY "coya_ext_update_admin"
  ON public.coya_external_integrations FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_external_integrations.organization_id
        AND (p.role)::text = ANY (ARRAY['super_administrator'::text, 'administrator'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_external_integrations.organization_id
    )
  );

DROP POLICY IF EXISTS "coya_ext_delete_admin" ON public.coya_external_integrations;
CREATE POLICY "coya_ext_delete_admin"
  ON public.coya_external_integrations FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.organization_id = coya_external_integrations.organization_id
        AND (p.role)::text = ANY (ARRAY['super_administrator'::text, 'administrator'::text])
    )
  );

-- ---------------------------------------------------------------------------
-- 11) Recalcul synthèse journalière (SECURITY DEFINER — appelée par triggers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coya_recompute_work_day_summary(p_profile_id uuid, p_work_date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_min_project int := 0;
  v_min_plan int := 0;
  v_span int := 0;
  v_presence text := 'unknown';
  v_journey boolean := false;
  v_first_in timestamptz;
  v_last_out timestamptz;
  v_meta jsonb := '{}'::jsonb;
  has_coya_pte boolean := false;
  has_time_logs boolean := false;
  has_coya_plan boolean := false;
  has_planning_slots boolean := false;
  has_coya_att boolean := false;
  has_presence_sessions boolean := false;
BEGIN
  SELECT organization_id INTO v_org FROM public.profiles WHERE id = p_profile_id;
  IF v_org IS NULL THEN
    RETURN;
  END IF;

  has_coya_pte := to_regclass('public.coya_project_time_entries') IS NOT NULL;
  has_time_logs := to_regclass('public.time_logs') IS NOT NULL;
  has_coya_plan := to_regclass('public.coya_planning_slots') IS NOT NULL;
  has_planning_slots := to_regclass('public.planning_slots') IS NOT NULL;
  has_coya_att := to_regclass('public.coya_attendance_events') IS NOT NULL;
  has_presence_sessions := to_regclass('public.presence_sessions') IS NOT NULL;

  -- Minutes projet : préférer coya_project_time_entries, sinon fallback vers time_logs (durée en minutes).
  IF has_coya_pte THEN
    SELECT coalesce(sum(duration_minutes), 0)::int INTO v_min_project
    FROM public.coya_project_time_entries
    WHERE profile_id = p_profile_id
      AND (started_at AT TIME ZONE 'UTC')::date <= p_work_date
      AND (ended_at AT TIME ZONE 'UTC')::date >= p_work_date
      AND line_status <> 'rejected';
  ELSIF has_time_logs THEN
    SELECT coalesce(sum(coalesce(duration, 0)), 0)::int INTO v_min_project
    FROM public.time_logs
    WHERE user_id = p_profile_id
      AND date = p_work_date;
  ELSE
    v_min_project := 0;
  END IF;

  -- Minutes planning : préférer coya_planning_slots, sinon planning_slots.
  IF has_coya_plan THEN
    SELECT coalesce(sum(EXTRACT(epoch FROM (LEAST(date_end, (p_work_date + 1)::timestamptz) - GREATEST(date_start, p_work_date::timestamptz))) / 60)::int, 0)
    INTO v_min_plan
    FROM public.coya_planning_slots
    WHERE profile_id = p_profile_id
      AND state <> 'cancelled'
      AND date_start < (p_work_date + 1)::timestamptz
      AND date_end > p_work_date::timestamptz;
  ELSIF has_planning_slots THEN
    SELECT coalesce(sum(EXTRACT(epoch FROM (LEAST(ended_at, (p_work_date + 1)::timestamptz) - GREATEST(started_at, p_work_date::timestamptz))) / 60)::int, 0)
    INTO v_min_plan
    FROM public.planning_slots
    WHERE profile_id = p_profile_id
      AND (coalesce(status, 'active'))::text <> 'cancelled'
      AND started_at < (p_work_date + 1)::timestamptz
      AND ended_at > p_work_date::timestamptz;
  ELSE
    v_min_plan := 0;
  END IF;

  -- Présence (span) : préférer coya_attendance_events, sinon presence_sessions.
  IF has_coya_att THEN
    SELECT min(occurred_at) FILTER (WHERE event_kind = 'check_in'),
           max(occurred_at) FILTER (WHERE event_kind = 'check_out')
    INTO v_first_in, v_last_out
    FROM public.coya_attendance_events
    WHERE profile_id = p_profile_id
      AND (occurred_at AT TIME ZONE 'UTC')::date = p_work_date;
  ELSIF has_presence_sessions THEN
    SELECT min(started_at), max(ended_at)
    INTO v_first_in, v_last_out
    FROM public.presence_sessions
    WHERE user_id = p_profile_id
      AND (started_at AT TIME ZONE 'UTC')::date = p_work_date
      AND ended_at IS NOT NULL;
  ELSE
    v_first_in := NULL;
    v_last_out := NULL;
  END IF;

  IF v_first_in IS NOT NULL AND v_last_out IS NOT NULL AND v_last_out > v_first_in THEN
    v_span := (EXTRACT(epoch FROM (v_last_out - v_first_in)) / 60)::int;
  END IF;

  IF v_min_project > 0 OR v_span > 0 THEN
    v_presence := 'present';
  ELSIF v_min_plan > 0 AND v_min_project = 0 AND v_span = 0 THEN
    v_presence := 'partial';
  ELSE
    v_presence := 'absent';
  END IF;

  IF v_min_project >= 420 AND v_span >= 240 THEN
    v_journey := true;
  END IF;

  v_meta := jsonb_build_object(
    'minutes_project_work', v_min_project,
    'minutes_planning', v_min_plan,
    'minutes_attendance_span', v_span,
    'first_check_in', v_first_in,
    'last_check_out', v_last_out
  );

  INSERT INTO public.coya_work_day_summaries (
    organization_id, profile_id, work_date,
    minutes_project_work, minutes_planning, minutes_attendance_span,
    presence_status, journey_completed, summary_meta, last_computed_at
  )
  VALUES (
    v_org, p_profile_id, p_work_date,
    v_min_project, v_min_plan, v_span,
    v_presence, v_journey, v_meta, now()
  )
  ON CONFLICT (profile_id, work_date) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    minutes_project_work = EXCLUDED.minutes_project_work,
    minutes_planning = EXCLUDED.minutes_planning,
    minutes_attendance_span = EXCLUDED.minutes_attendance_span,
    presence_status = EXCLUDED.presence_status,
    journey_completed = EXCLUDED.journey_completed,
    summary_meta = EXCLUDED.summary_meta,
    last_computed_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.coya_recompute_work_day_summary(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.coya_recompute_work_day_summary(uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.coya_trg_recompute_summary_from_pte()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  d date;
BEGIN
  pid := COALESCE(NEW.profile_id, OLD.profile_id);
  d := COALESCE((NEW.started_at AT TIME ZONE 'UTC')::date, (OLD.started_at AT TIME ZONE 'UTC')::date);
  PERFORM public.coya_recompute_work_day_summary(pid, d);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.coya_trg_recompute_summary_from_att()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  d date;
BEGIN
  pid := COALESCE(NEW.profile_id, OLD.profile_id);
  d := COALESCE((NEW.occurred_at AT TIME ZONE 'UTC')::date, (OLD.occurred_at AT TIME ZONE 'UTC')::date);
  PERFORM public.coya_recompute_work_day_summary(pid, d);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.coya_trg_recompute_summary_from_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  d date;
BEGIN
  pid := COALESCE(NEW.profile_id, OLD.profile_id);
  d := COALESCE((NEW.date_start AT TIME ZONE 'UTC')::date, (OLD.date_start AT TIME ZONE 'UTC')::date);
  PERFORM public.coya_recompute_work_day_summary(pid, d);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS coya_pte_recompute_summary ON public.coya_project_time_entries;
CREATE TRIGGER coya_pte_recompute_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.coya_project_time_entries
  FOR EACH ROW EXECUTE FUNCTION public.coya_trg_recompute_summary_from_pte();

DROP TRIGGER IF EXISTS coya_att_recompute_summary ON public.coya_attendance_events;
CREATE TRIGGER coya_att_recompute_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.coya_attendance_events
  FOR EACH ROW EXECUTE FUNCTION public.coya_trg_recompute_summary_from_att();

DROP TRIGGER IF EXISTS coya_plan_recompute_summary ON public.coya_planning_slots;
CREATE TRIGGER coya_plan_recompute_summary
  AFTER INSERT OR UPDATE OR DELETE ON public.coya_planning_slots
  FOR EACH ROW EXECUTE FUNCTION public.coya_trg_recompute_summary_from_plan();

-- Compat : si l’app utilise les tables historiques (time_logs / presence_sessions / planning_slots),
-- on déclenche aussi le recalcul via des triggers adaptés aux colonnes de ces tables.
CREATE OR REPLACE FUNCTION public.coya_trg_recompute_summary_from_time_logs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  d date;
BEGIN
  pid := COALESCE(NEW.user_id, OLD.user_id);
  d := COALESCE(NEW.date, OLD.date, (now() AT TIME ZONE 'UTC')::date);
  PERFORM public.coya_recompute_work_day_summary(pid, d);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.coya_trg_recompute_summary_from_presence_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  d date;
BEGIN
  pid := COALESCE(NEW.user_id, OLD.user_id);
  d := COALESCE((NEW.started_at AT TIME ZONE 'UTC')::date, (OLD.started_at AT TIME ZONE 'UTC')::date);
  PERFORM public.coya_recompute_work_day_summary(pid, d);
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.coya_trg_recompute_summary_from_planning_slots()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
  d date;
BEGIN
  pid := COALESCE(NEW.profile_id, OLD.profile_id);
  d := COALESCE((NEW.started_at AT TIME ZONE 'UTC')::date, (OLD.started_at AT TIME ZONE 'UTC')::date);
  PERFORM public.coya_recompute_work_day_summary(pid, d);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.time_logs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS coya_time_logs_recompute_summary ON public.time_logs;
    CREATE TRIGGER coya_time_logs_recompute_summary
      AFTER INSERT OR UPDATE OR DELETE ON public.time_logs
      FOR EACH ROW EXECUTE FUNCTION public.coya_trg_recompute_summary_from_time_logs();
  END IF;

  IF to_regclass('public.presence_sessions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS coya_presence_sessions_recompute_summary ON public.presence_sessions;
    CREATE TRIGGER coya_presence_sessions_recompute_summary
      AFTER INSERT OR UPDATE OR DELETE ON public.presence_sessions
      FOR EACH ROW EXECUTE FUNCTION public.coya_trg_recompute_summary_from_presence_sessions();
  END IF;

  IF to_regclass('public.planning_slots') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS coya_planning_slots_recompute_summary ON public.planning_slots;
    CREATE TRIGGER coya_planning_slots_recompute_summary
      AFTER INSERT OR UPDATE OR DELETE ON public.planning_slots
      FOR EACH ROW EXECUTE FUNCTION public.coya_trg_recompute_summary_from_planning_slots();
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 12) Vue écart planification vs temps saisi (Phase 3)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.coya_v_planning_vs_time_daily AS
SELECT
  p.organization_id,
  p.profile_id,
  (p.date_start AT TIME ZONE 'UTC')::date AS work_date,
  sum(EXTRACT(epoch FROM (p.date_end - p.date_start)) / 3600.0) FILTER (WHERE p.state <> 'cancelled') AS planned_hours,
  coalesce((
    SELECT sum(e.duration_minutes) / 60.0
    FROM public.coya_project_time_entries e
    WHERE e.profile_id = p.profile_id
      AND e.organization_id = p.organization_id
      AND e.line_status <> 'rejected'
      AND (e.started_at AT TIME ZONE 'UTC')::date = (p.date_start AT TIME ZONE 'UTC')::date
  ), 0) AS logged_project_hours
FROM public.coya_planning_slots p
GROUP BY p.organization_id, p.profile_id, (p.date_start AT TIME ZONE 'UTC')::date;

COMMENT ON VIEW public.coya_v_planning_vs_time_daily IS 'Écart agrégé : heures planifiées vs heures projet saisies par jour (UTC date).';

-- ---------------------------------------------------------------------------
-- 13) updated_at automatique (léger)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coya_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS coya_pte_touch ON public.coya_project_time_entries;
CREATE TRIGGER coya_pte_touch BEFORE UPDATE ON public.coya_project_time_entries
  FOR EACH ROW EXECUTE FUNCTION public.coya_touch_updated_at();

DROP TRIGGER IF EXISTS coya_tsp_touch ON public.coya_timesheet_periods;
CREATE TRIGGER coya_tsp_touch BEFORE UPDATE ON public.coya_timesheet_periods
  FOR EACH ROW EXECUTE FUNCTION public.coya_touch_updated_at();

DROP TRIGGER IF EXISTS coya_plan_touch ON public.coya_planning_slots;
CREATE TRIGGER coya_plan_touch BEFORE UPDATE ON public.coya_planning_slots
  FOR EACH ROW EXECUTE FUNCTION public.coya_touch_updated_at();
