-- Mots de passe provisoires consultables par l'admin (PB2 + PB4).
--
-- CONTEXTE / COMPROMIS DE SÉCURITÉ (demandé explicitement par le métier) :
--   Tant qu'un nouvel utilisateur n'a PAS changé son mot de passe par défaut auto-généré,
--   un administrateur/super-administrateur doit pouvoir le CONSULTER (pour le transmettre)
--   et en GÉNÉRER un nouveau (récupération de mot de passe).
--   -> On stocke donc le mot de passe en clair, MAIS dans une table dédiée dont la lecture
--      est STRICTEMENT réservée aux admins via RLS. Il n'est JAMAIS lisible par l'utilisateur
--      concerné ni en anonyme. La table `profiles` (lisible par tout authentifié via la policy
--      « ALL true ») ne contient donc PAS le mot de passe — uniquement un drapeau non sensible.
--
--   La définition effective du mot de passe sur le compte auth (auth.users) nécessite le
--   service_role : elle est réalisée par les Edge Functions `provision-access-account`
--   (création) et `admin-reset-password` (régénération).

-- 1. Drapeaux non sensibles sur profiles (lisibles par tous, OK)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_changed boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

-- 2. Table dédiée (clair) — lecture admin uniquement
CREATE TABLE IF NOT EXISTS public.user_provisional_passwords (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_id uuid,
  email text,
  provisional_password text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_provisional_passwords_user_id
  ON public.user_provisional_passwords (user_id);

ALTER TABLE public.user_provisional_passwords ENABLE ROW LEVEL SECURITY;

-- Lecture réservée aux admins / super-admins. Aucune policy INSERT/UPDATE/DELETE :
-- seules les fonctions SECURITY DEFINER et le service_role (Edge Functions) écrivent.
DROP POLICY IF EXISTS "upp_select_admins" ON public.user_provisional_passwords;
CREATE POLICY "upp_select_admins" ON public.user_provisional_passwords
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.role IN ('administrator', 'super_administrator')
    )
  );

REVOKE ALL ON public.user_provisional_passwords FROM anon;
GRANT SELECT ON public.user_provisional_passwords TO authenticated;

-- 3. RPC appelée par l'utilisateur APRÈS avoir changé son mot de passe :
--    marque password_changed = true et EFFACE le mot de passe stocké (plus consultable).
CREATE OR REPLACE FUNCTION public.clear_provisional_password()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_profile_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentification requise.' using errcode = '28000';
  end if;

  update public.profiles
    set password_changed = true,
        password_changed_at = now(),
        updated_at = now()
  where user_id = auth.uid()
  returning id into v_profile_id;

  if v_profile_id is not null then
    delete from public.user_provisional_passwords where profile_id = v_profile_id;
  end if;

  delete from public.user_provisional_passwords where user_id = auth.uid();
end;
$$;

REVOKE ALL ON FUNCTION public.clear_provisional_password() FROM public;
GRANT EXECUTE ON FUNCTION public.clear_provisional_password() TO authenticated;

-- 4. RPC réservée aux admins : enregistre un mot de passe provisoire (cas où le compte est
--    créé côté client avec un mot de passe connu de l'admin — ex. CreateUserModal).
--    Ne définit PAS le mot de passe auth (déjà fait par le client). Réserve l'écriture
--    dans la table protégée à un appelant admin.
CREATE OR REPLACE FUNCTION public.store_provisional_password(
  p_profile_id uuid,
  p_password text,
  p_user_id uuid DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_is_admin boolean;
begin
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role in ('administrator', 'super_administrator')
  ) into v_is_admin;

  if not v_is_admin then
    raise exception 'Action réservée aux administrateurs.' using errcode = '42501';
  end if;

  if p_password is null or length(trim(p_password)) = 0 then
    raise exception 'Mot de passe vide.' using errcode = '22023';
  end if;

  insert into public.user_provisional_passwords as upp
    (profile_id, user_id, email, provisional_password, created_by, created_at, updated_at)
  values
    (p_profile_id, p_user_id, lower(nullif(trim(p_email), '')), p_password, auth.uid(), now(), now())
  on conflict (profile_id) do update
    set provisional_password = excluded.provisional_password,
        user_id = coalesce(excluded.user_id, upp.user_id),
        email   = coalesce(excluded.email, upp.email),
        created_by = auth.uid(),
        updated_at = now();

  update public.profiles
    set password_changed = false,
        password_changed_at = null,
        updated_at = now()
  where id = p_profile_id;
end;
$$;

REVOKE ALL ON FUNCTION public.store_provisional_password(uuid, text, uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.store_provisional_password(uuid, text, uuid, text) TO authenticated;

COMMENT ON TABLE public.user_provisional_passwords IS
  'Mots de passe provisoires (clair) consultables UNIQUEMENT par les admins (RLS). Effacés quand l''utilisateur change son mot de passe. Compromis de sécurité assumé.';
