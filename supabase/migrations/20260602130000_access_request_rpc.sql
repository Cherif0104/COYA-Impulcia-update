-- Demande d'accès "Devenir utilisateur" (page de connexion).
--
-- PROBLÈME corrigé : l'ancien flux applicatif tentait d'INSÉRER directement dans
-- `public.profiles` depuis un contexte anonyme (via un client éphémère + signUp), ce qui
-- viole la RLS de `profiles` (seul le rôle `authenticated` peut écrire) -> 401.
--
-- SOLUTION : utiliser une fonction RPC `SECURITY DEFINER` appelable par `anon`, qui
-- enregistre une DEMANDE (profil `status = 'pending'`, SANS compte d'authentification ni
-- mot de passe) de façon contrôlée et validée. On n'ouvre AUCUN INSERT anonyme direct sur
-- `profiles` : la RLS reste verrouillée (aucune nouvelle policy permissive).
--
-- Une RPC `request_access` (retour jsonb) existait déjà ; on la durcit ici :
--   * validation de l'organisation (si fournie) et du pilier/département (cohérence org) ;
--   * détection d'un compte existant via `user_id IS NOT NULL` (et pas seulement status) ;
--   * idempotence : une demande pending sans compte est mise à jour plutôt que dupliquée.
--
-- L'approbation par un administrateur (côté application) crée ensuite le compte auth réel
-- avec un mot de passe par défaut auto-généré, puis rattache le profil au pilier.

create or replace function public.request_access(
  p_full_name text,
  p_email text,
  p_phone text default null,
  p_organization_id uuid default null,
  p_requested_department_id uuid default null,
  p_requested_poste text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_phone     text := nullif(trim(coalesce(p_phone, '')), '');
  v_poste     text := nullif(trim(coalesce(p_requested_poste, '')), '');
  v_org       uuid := p_organization_id;
  v_existing_id uuid;
  v_id        uuid;
begin
  -- Validations de base (garde-fous : la fonction force des valeurs sûres)
  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  if v_full_name = '' then
    v_full_name := v_email;
  end if;

  -- Organisation : valider l'existence si fournie
  if v_org is not null and not exists (
    select 1 from public.organizations o where o.id = v_org
  ) then
    raise exception 'INVALID_ORGANIZATION' using errcode = '22023';
  end if;

  -- Pilier (département) : doit appartenir à l'organisation si les deux sont fournis
  if p_requested_department_id is not null and not exists (
    select 1 from public.departments d
    where d.id = p_requested_department_id
      and (v_org is null or d.organization_id = v_org)
  ) then
    raise exception 'INVALID_DEPARTMENT' using errcode = '22023';
  end if;

  -- Un compte rattaché à un utilisateur (auth) existe déjà pour cet e-mail ?
  if exists (
    select 1 from public.profiles p
    where lower(p.email) = v_email
      and p.user_id is not null
      and coalesce(p.status, '') <> 'rejected'
  ) then
    raise exception 'EMAIL_ALREADY_ACTIVE' using errcode = '23505';
  end if;

  -- Demande "pending" déjà existante (sans compte) -> idempotent : on met à jour
  select p.id into v_existing_id
  from public.profiles p
  where lower(p.email) = v_email
    and p.status = 'pending'
    and p.user_id is null
  order by p.created_at asc
  limit 1;

  if v_existing_id is not null then
    update public.profiles
    set full_name               = v_full_name,
        phone_number            = v_phone,
        organization_id         = coalesce(v_org, organization_id),
        requested_department_id = p_requested_department_id,
        requested_poste         = v_poste,
        updated_at              = now()
    where id = v_existing_id;
    return jsonb_build_object('status', 'already_pending', 'profile_id', v_existing_id);
  end if;

  -- Nouvelle demande : profil en attente, sans compte auth, rôle minimal.
  insert into public.profiles (
    user_id, email, full_name, phone_number, role, pending_role, status,
    organization_id, requested_department_id, requested_poste, is_active
  ) values (
    null, v_email, v_full_name, v_phone, 'student', 'student', 'pending',
    v_org, p_requested_department_id, v_poste, false
  )
  returning id into v_id;

  return jsonb_build_object('status', 'pending', 'profile_id', v_id);
end;
$$;

-- Accès : retirer l'exécution publique large puis autoriser explicitement
-- les demandeurs anonymes (page de login) et les utilisateurs authentifiés.
revoke all on function public.request_access(text, text, text, uuid, uuid, text) from public;
grant execute on function public.request_access(text, text, text, uuid, uuid, text) to anon, authenticated;

comment on function public.request_access(text, text, text, uuid, uuid, text) is
  'Demande d''accès self-service (« Devenir utilisateur »). Enregistre une demande (profil pending sans compte auth) de façon contrôlée, sans INSERT anonyme direct sur profiles. L''approbation admin crée ensuite le compte réel.';
