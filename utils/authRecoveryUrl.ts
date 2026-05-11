import { COYA_PRO_CANONICAL_ORIGIN, buildAuthRecoveryRedirectUrl } from '../constants/coyaSite';

/**
 * URL complète de callback après clic sur le lien e-mail « réinitialiser le mot de passe ».
 * Toujours sous la forme `https://…/auth/recovery` pour une route SPA stable sur coya.pro.
 *
 * Supabase Dashboard → Authentication → Redirect URLs :
 * - `https://www.coya.pro/auth/recovery`
 * - `https://coya.pro/auth/recovery` (si apex utilisé)
 * - `http://localhost:5174/auth/recovery` (dev, port Vite selon votre config)
 */
function isLocalDevOrigin(url: string): boolean {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    const h = u.hostname.toLowerCase();
    return (
      h === 'localhost' ||
      h === '127.0.0.1' ||
      h === '[::1]' ||
      h === '0.0.0.0' ||
      h.endsWith('.local')
    );
  } catch {
    return false;
  }
}

export function getPasswordRecoveryRedirectUrl(): string {
  const raw =
    typeof import.meta !== 'undefined'
      ? String(import.meta.env.VITE_AUTH_REDIRECT_URL || import.meta.env.VITE_SITE_URL || '').trim()
      : '';
  const envBase = raw.replace(/\/+$/, '');

  let originOnly = '';

  if (typeof window !== 'undefined') {
    const currentOrigin = window.location.origin;
    const currentIsLocal = isLocalDevOrigin(currentOrigin);

    if (envBase) {
      const envPointsLocal = isLocalDevOrigin(envBase);
      if (envPointsLocal && !currentIsLocal) {
        originOnly = currentOrigin;
      } else {
        originOnly = envBase;
      }
    } else {
      originOnly = currentOrigin;
    }
  } else if (envBase) {
    originOnly = envBase;
  } else if (typeof import.meta !== 'undefined' && import.meta.env.PROD) {
    originOnly = COYA_PRO_CANONICAL_ORIGIN;
  }

  if (!originOnly) {
    return buildAuthRecoveryRedirectUrl(COYA_PRO_CANONICAL_ORIGIN);
  }

  return buildAuthRecoveryRedirectUrl(originOnly);
}
