-- =============================================================================
-- COYA — Demandes de déplacement (hub mobilité, brouillon → soumis)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.mobility_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by_profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  intent_route text CHECK (intent_route IS NULL OR intent_route IN ('internal', 'external')),
  passenger_count int NOT NULL DEFAULT 1 CHECK (passenger_count >= 1 AND passenger_count <= 999),
  trip_type text NOT NULL DEFAULT 'mission' CHECK (trip_type IN ('mission', 'course', 'autre')),
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  programme_id uuid REFERENCES public.programmes(id) ON DELETE SET NULL,
  participant_profile_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  title text NOT NULL DEFAULT '',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mobility_requests_participants_array
    CHECK (jsonb_typeof(participant_profile_ids) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_mobility_requests_org_created
  ON public.mobility_requests(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mobility_requests_org_project
  ON public.mobility_requests(organization_id, project_id)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mobility_requests_org_programme
  ON public.mobility_requests(organization_id, programme_id)
  WHERE programme_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mobility_requests_org_status
  ON public.mobility_requests(organization_id, status);

ALTER TABLE public.mobility_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mobility_requests_select_org" ON public.mobility_requests;
CREATE POLICY "mobility_requests_select_org"
  ON public.mobility_requests FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "mobility_requests_insert_org" ON public.mobility_requests;
CREATE POLICY "mobility_requests_insert_org"
  ON public.mobility_requests FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND created_by_profile_id = (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );

DROP POLICY IF EXISTS "mobility_requests_update_draft_org" ON public.mobility_requests;
CREATE POLICY "mobility_requests_update_draft_org"
  ON public.mobility_requests FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND status = 'draft'
  )
  WITH CHECK (
    organization_id = (SELECT organization_id FROM public.profiles WHERE user_id = auth.uid())
    AND status IN ('draft', 'submitted')
  );

COMMENT ON TABLE public.mobility_requests IS
  'Demande de déplacement (hub mobilité) : brouillon éditable puis soumis ; intent_route oriente vers parc auto / logistique.';

-- updated_at (fonction set_updated_at déjà présente sur la plupart des stacks COYA)
DO $$
BEGIN
  IF to_regprocedure('public.set_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS mobility_requests_set_updated_at ON public.mobility_requests;
    CREATE TRIGGER mobility_requests_set_updated_at
      BEFORE UPDATE ON public.mobility_requests
      FOR EACH ROW
      EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;
