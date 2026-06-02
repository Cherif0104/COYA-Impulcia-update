// Edge Function: provision-access-account
//
// À la VALIDATION d'une demande d'accès ("Devenir utilisateur"), crée le compte auth
// correspondant à un profil `pending` qui n'en a pas encore (user_id NULL), avec un
// mot de passe par défaut autogénéré et l'e-mail confirmé, puis rattache `profiles.user_id`.
//
// Sécurité :
//   - `verify_jwt = true` au déploiement : un JWT valide est exigé par la plateforme.
//   - On revérifie l'appelant et son rôle (administrator / super_administrator) via le
//     client service_role. Un utilisateur non-admin reçoit 403.
//   - Le mot de passe est renvoyé à l'admin appelant ET stocké dans
//     `user_provisional_passwords` (lecture admin only, RLS) pour consultation ultérieure
//     jusqu'à ce que l'utilisateur le change.
//   - Aucune escalade : le rôle effectif appliqué reste celui décidé par le flux d'approbation
//     côté client (cette fonction ne fait QUE provisionner le compte auth + lier user_id).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';

const ADMIN_ROLES = new Set(['administrator', 'super_administrator']);

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** Mot de passe par défaut autogénéré (>= 16 caractères, jeux de caractères variés). */
function generateDefaultPassword(): string {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '@#$%&*?';
  const all = upper + lower + digits + symbols;
  const buf = new Uint32Array(20);
  crypto.getRandomValues(buf);
  const pick = (set: string, i: number) => set[buf[i] % set.length];
  const chars = [pick(upper, 0), pick(lower, 1), pick(digits, 2), pick(symbols, 3)];
  for (let i = 4; i < 20; i += 1) chars.push(pick(all, i));
  // Mélange (Fisher-Yates) à partir d'octets aléatoires
  const shuffleBuf = new Uint32Array(chars.length);
  crypto.getRandomValues(shuffleBuf);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = shuffleBuf[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return json({ error: 'Configuration serveur manquante.' }, 500);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Authentifier l'appelant
  const authHeader = req.headers.get('Authorization') || '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return json({ error: 'Authentification requise.' }, 401);
  }
  const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
  if (callerErr || !caller?.user) {
    return json({ error: 'Session invalide.' }, 401);
  }

  // 2. Vérifier que l'appelant est administrateur
  const { data: callerProfile } = await admin
    .from('profiles')
    .select('role')
    .eq('user_id', caller.user.id)
    .maybeSingle();
  if (!callerProfile || !ADMIN_ROLES.has(String(callerProfile.role))) {
    return json({ error: 'Action réservée aux administrateurs.' }, 403);
  }

  // 3. Lire la demande
  let profileId = '';
  try {
    const body = await req.json();
    profileId = String(body?.profileId || '').trim();
  } catch {
    return json({ error: 'Corps de requête invalide.' }, 400);
  }
  if (!profileId) {
    return json({ error: 'profileId manquant.' }, 400);
  }

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('id, user_id, email, full_name, phone_number, role, pending_role, organization_id')
    .eq('id', profileId)
    .maybeSingle();
  if (profileErr || !profile) {
    return json({ error: 'Profil introuvable.' }, 404);
  }

  // 4. Si un compte auth existe déjà (flux historique signUp), rien à provisionner.
  if (profile.user_id) {
    return json({ provisioned: false, userId: profile.user_id });
  }

  const email = String(profile.email || '').trim().toLowerCase();
  if (!email) {
    return json({ error: 'E-mail du profil manquant.' }, 422);
  }

  // 5. Créer le compte auth avec mot de passe par défaut + e-mail confirmé
  const password = generateDefaultPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: profile.full_name || email,
      phone_number: profile.phone_number || null,
      role: 'student',
      organization_id: profile.organization_id || null,
    },
  });

  if (createErr || !created?.user) {
    const message = createErr?.message || 'Création du compte impossible.';
    const already = /registered|already/i.test(message);
    return json(
      {
        error: already
          ? "Un compte auth existe déjà pour cet e-mail. Liez-le manuellement ou utilisez « Reset MDP »."
          : message,
        code: already ? 'EMAIL_EXISTS' : 'CREATE_FAILED',
      },
      already ? 409 : 400,
    );
  }

  // 6. Lier le profil au compte auth créé + marquer le mot de passe comme non changé
  const { error: linkErr } = await admin
    .from('profiles')
    .update({
      user_id: created.user.id,
      password_changed: false,
      password_changed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', profileId);

  if (linkErr) {
    // Rollback best-effort du compte auth pour éviter un orphelin
    await admin.auth.admin.deleteUser(created.user.id).catch(() => {});
    return json({ error: `Liaison du profil échouée : ${linkErr.message}` }, 500);
  }

  // 7. Stocker le mot de passe provisoire (consultable par l'admin tant que non changé).
  //    Table protégée par RLS (lecture admin uniquement) — écrite ici via service_role.
  const { error: storeErr } = await admin
    .from('user_provisional_passwords')
    .upsert(
      {
        profile_id: profileId,
        user_id: created.user.id,
        email,
        provisional_password: password,
        created_by: caller.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' },
    );
  if (storeErr) {
    // Non bloquant : le compte est créé, le mot de passe est renvoyé à l'admin appelant.
    console.error('Stockage du mot de passe provisoire échoué (non bloquant):', storeErr.message);
  }

  return json({
    provisioned: true,
    userId: created.user.id,
    email,
    password,
  });
});
