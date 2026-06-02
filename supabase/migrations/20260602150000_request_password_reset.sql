-- PB5 : « Mot de passe oublié » sans e-mail de reset Supabase.
--
-- À la place du lien de réinitialisation par e-mail, l'utilisateur (NON authentifié, sur la
-- page de connexion) soumet son e-mail. Cette RPC SECURITY DEFINER crée une NOTIFICATION
-- pour les administrateurs / super-administrateurs concernés, les invitant à générer un
-- nouveau mot de passe générique (cf. Edge Function `admin-reset-password`).
--
-- Anti-énumération : la fonction renvoie toujours sans erreur, que l'e-mail existe ou non
-- (aucune divulgation de l'existence du compte). Aucune donnée sensible n'est exposée.
--
-- `notifications.user_id` référence `profiles.id` (et NON auth.users.id).

CREATE OR REPLACE FUNCTION public.request_password_reset(p_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
declare
  v_email  text := lower(trim(p_email));
  v_target record;
begin
  if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    -- Format invalide : on sort silencieusement (pas de divulgation).
    return;
  end if;

  -- Cible : un compte réel (profil rattaché à un user_id) pour cet e-mail.
  select p.id, p.full_name, p.email, p.organization_id
    into v_target
  from public.profiles p
  where p.email = v_email
    and p.user_id is not null
    and coalesce(p.status, '') <> 'rejected'
  order by p.created_at asc
  limit 1;

  if not found then
    -- E-mail inconnu : on ne révèle rien.
    return;
  end if;

  -- Notifier les admins / super-admins (même organisation) + tous les super-admins.
  insert into public.notifications (
    user_id, type, module, action, title, message, entity_type, entity_id, metadata, read, created_at
  )
  select
    admin.id,
    'warning',
    'user',
    'reminder',
    'Réinitialisation de mot de passe demandée',
    format(
      '%s (%s) a demandé une réinitialisation de mot de passe. Générez un nouveau mot de passe générique depuis Gestion des utilisateurs, puis transmettez-le.',
      coalesce(v_target.full_name, v_target.email),
      v_target.email
    ),
    'profile',
    v_target.id,
    jsonb_build_object(
      'kind', 'password_reset_request',
      'target_profile_id', v_target.id,
      'target_email', v_target.email
    ),
    false,
    now()
  from public.profiles admin
  where admin.role in ('administrator', 'super_administrator')
    and (
      admin.role = 'super_administrator'
      or admin.organization_id is not distinct from v_target.organization_id
    );
end;
$$;

REVOKE ALL ON FUNCTION public.request_password_reset(text) FROM public;
GRANT EXECUTE ON FUNCTION public.request_password_reset(text) TO anon, authenticated;

COMMENT ON FUNCTION public.request_password_reset(text) IS
  'PB5 : demande de réinitialisation self-service. Notifie les admins (sans e-mail Supabase). Anti-énumération : renvoie toujours sans erreur.';
