import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.0';

export interface AuthUser {
  userId: string;
}

/**
 * Vérifie le JWT Supabase présent dans l'en-tête Authorization.
 * Lance une Response 401 si invalide ou absent.
 */
export async function verifyJWT(req: Request): Promise<AuthUser> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Response(
      JSON.stringify({ error: 'Authorization header manquant ou invalide' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Response(
      JSON.stringify({ error: 'Configuration Supabase manquante' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    throw new Response(
      JSON.stringify({ error: 'Non autorisé' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  return { userId: user.id };
}
