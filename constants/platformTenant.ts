/**
 * Tenant COYA / Alentum — organisation plateforme + tenants hébergés.
 *
 * - `VITE_PRIMARY_ORGANIZATION_ID` : UUID de l’organisation mère (données COYA). À aligner sur la base après
 *   la migration `20260428143000_organization_platform_root_and_merge.sql` (keeper). La protection suppression /
 *   désactivation utilise surtout `organizations.is_platform_root` si la colonne existe.
 * - `VITE_SINGLE_ORGANIZATION_MODE` : si `"true"` ou `"1"`, l’UI ne liste qu’une org et bloque la création
 *   d’autres tenants (mode maintenance / kiosque). Laissez `false` pour gérer des organisations hébergées.
 *
 * Modèle métier : une org plateforme (super admin, projets COYA) ; d’autres orgs partagent le même modèle
 * (départements, utilisateurs, modules) avec contenu isolé par `organization_id` (pas de stats agrégées côté
 * liste admin pour les tenants hébergés).
 */
export const DEFAULT_PRIMARY_ORGANIZATION_ID = 'fb782f1a-ee3c-4665-99f2-baec16687fe1';

export function getPrimaryOrganizationId(): string {
  const fromEnv = typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_PRIMARY_ORGANIZATION_ID : undefined;
  const v = (fromEnv && String(fromEnv).trim()) || DEFAULT_PRIMARY_ORGANIZATION_ID;
  return v;
}

export function isSingleOrganizationTenantMode(): boolean {
  const v = typeof import.meta.env !== 'undefined' ? import.meta.env.VITE_SINGLE_ORGANIZATION_MODE : undefined;
  return String(v || '').toLowerCase() === 'true' || String(v || '') === '1';
}
