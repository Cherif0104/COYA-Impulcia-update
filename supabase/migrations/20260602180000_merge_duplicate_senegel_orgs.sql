-- Fusion des deux organisations « SENEGEL » en doublon (idempotent).
--
-- SOURCE (legacy / doublon, sans piliers) : 550e8400-e29b-41d4-a716-446655440000
-- CIBLE (canonique, PILIER 1/2/3 + majorité des profils) : fb782f1a-ee3c-4665-99f2-baec16687fe1
--
-- Stratégie :
--   1. Réassigner organization_id sur toutes les tables publiques référençant l'org source.
--   2. Aucun département sur la source → pas de conflit UNIQUE (organization_id, slug).
--   3. Désactiver l'org source (soft-delete via is_active) et renommer pour éviter la confusion UI.

BEGIN;

DO $$
DECLARE
  v_source uuid := '550e8400-e29b-41d4-a716-446655440000';
  v_target uuid := 'fb782f1a-ee3c-4665-99f2-baec16687fe1';
  r RECORD;
  v_cnt bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_source) THEN
    RAISE NOTICE 'Organisation source déjà absente — migration idempotente.';
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = v_target) THEN
      RAISE EXCEPTION 'Organisation cible SENEGEL canonique introuvable: %', v_target;
    END IF;

    RAISE NOTICE 'Fusion SENEGEL: source=% target=%', v_source, v_target;
    FOR r IN
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public'
        AND c.column_name = 'organization_id'
        AND t.table_type = 'BASE TABLE'
        AND c.table_name <> 'organizations'
    LOOP
      EXECUTE format(
        'SELECT COUNT(*) FROM public.%I WHERE organization_id = $1',
        r.table_name
      ) INTO v_cnt USING v_source;
      IF v_cnt > 0 THEN
        RAISE NOTICE '  % : % ligne(s) à migrer', r.table_name, v_cnt;
        EXECUTE format(
          'UPDATE public.%I SET organization_id = $1 WHERE organization_id = $2',
          r.table_name
        ) USING v_target, v_source;
      END IF;
    END LOOP;
  END IF;
END $$;

-- Canonique : slug + actif + unicité du nom actif
UPDATE public.organizations
SET slug = COALESCE(NULLIF(trim(slug), ''), 'senegel'),
    is_active = true,
    name = 'SENEGEL'
WHERE id = 'fb782f1a-ee3c-4665-99f2-baec16687fe1';

UPDATE public.organizations
SET is_active = false,
    slug = COALESCE(NULLIF(trim(slug), ''), 'senegel-legacy-merged'),
    name = 'SENEGEL (archivé — fusionné)',
    description = COALESCE(description, '') || E'\n[Fusion 2026-06-02] Doublon fusionné vers fb782f1a-ee3c-4665-99f2-baec16687fe1.'
WHERE id = '550e8400-e29b-41d4-a716-446655440000';

COMMIT;
