// Edge Function: admin-reset-password
//
// Génère un NOUVEAU mot de passe générique pour un compte existant (récupération de mot de
// passe / PB4 + PB5) et le définit sur le compte auth (nécessite le service_role).
// Le mot de passe est stocké dans `user_provisional_passwords` (consultable par l'admin tant
// que l'utilisateur ne l'a pas changé) et `profiles.password_changed` repasse à false.
//
// Sécurité :
//   - `verify_jwt = true` : un JWT valide est exigé par la plateforme.
//   - On revérifie que l'appelant est administrator / super_administrator (service_role).
//   - Le mot de passe n'est renvoyé qu'à l'admin appelant.
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

/** Mot de passe générique (>= 16 caractères, jeux de caractères variés). */
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

  // 3. Lire la cible (profileId)
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
    .select('id, user_id, email')
    .eq('id', profileId)
    .maybeSingle();
  if (profileErr || !profile) {
    return json({ error: 'Profil introuvable.' }, 404);
  }
  if (!profile.user_id) {
    return json(
      { error: 'Ce profil n’a pas encore de compte. Approuvez d’abord la demande d’accès.' },
      409,
    );
  }

  const email = String(profile.email || '').trim().toLowerCase();
  const password = generateDefaultPassword();

  // 4. Définir le nouveau mot de passe sur le compte auth
  const { error: updErr } = await admin.auth.admin.updateUserById(profile.user_id, {
    password,
  });
  if (updErr) {
    return json({ error: `Définition du mot de passe impossible : ${updErr.message}` }, 400);
  }

  // 5. Stocker le mot de passe provisoire + repasser password_changed à false
  const { error: storeErr } = await admin
    .from('user_provisional_passwords')
    .upsert(
      {
        profile_id: profileId,
        user_id: profile.user_id,
        email,
        provisional_password: password,
        created_by: caller.user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id' },
    );
  if (storeErr) {
    console.error('Stockage du mot de passe provisoire échoué (non bloquant):', storeErr.message);
  }

  await admin
    .from('profiles')
    .update({ password_changed: false, password_changed_at: null, updated_at: new Date().toISOString() })
    .eq('id', profileId);

  return json({ reset: true, userId: profile.user_id, email, password });
});
