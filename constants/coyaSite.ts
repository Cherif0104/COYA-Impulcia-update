/**
 * Références publiques COYA (production).
 * Les builds déployés sur d’autres domaines doivent surcharger via VITE_SITE_URL / VITE_AUTH_REDIRECT_URL.
 */
export const COYA_PRO_CANONICAL_ORIGIN = 'https://www.coya.pro';

/** Chemin SPA pour le retour « mot de passe oublié » (à autoriser dans Supabase Redirect URLs). */
export const AUTH_RECOVERY_CALLBACK_PATH = '/auth/recovery';

export function buildAuthRecoveryRedirectUrl(siteOrigin: string): string {
  const base = siteOrigin.replace(/\/+$/, '');
  return `${base}${AUTH_RECOVERY_CALLBACK_PATH}`;
}

export function isAuthRecoveryPathname(pathname: string): boolean {
  const p = (pathname || '/').replace(/\/+$/, '') || '/';
  return p === AUTH_RECOVERY_CALLBACK_PATH;
}
