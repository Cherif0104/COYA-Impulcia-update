-- Demande d'accès ("Devenir utilisateur") depuis la page de connexion.
-- À APPLIQUER côté Supabase (SQL Editor ou `supabase db push`).
--
-- Ce script :
--   1. Ajoute deux colonnes optionnelles à `profiles` pour transporter le choix du
--      demandeur (pilier = département souhaité, et poste/fonction souhaité en texte libre)
--      jusqu'à l'écran d'approbation admin.
--   2. Autorise la lecture publique (anon) des départements ACTIFS, indispensable pour la
--      cascade Organisation -> Pilier sur la page de login (l'utilisateur n'est pas encore
--      authentifié à ce moment). Les politiques d'écriture restent réservées aux admins.

-- 1. Colonnes "demande d'accès" sur profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS requested_department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS requested_poste text;

-- 2. Lecture publique des départements actifs (cascade pilier sur écran de connexion)
--    On ajoute une policy supplémentaire SANS retirer la policy existante
--    "departments_select_own_org" (les membres continuent de voir leurs départements).
DROP POLICY IF EXISTS "departments_select_public_active" ON public.departments;
CREATE POLICY "departments_select_public_active" ON public.departments
  FOR SELECT
  USING (is_active = true);
