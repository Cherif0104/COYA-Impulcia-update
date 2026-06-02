import { ModuleName, Role } from '../types';
import { PermissionState } from './modulePermissionDefaults';

export const NO_ACCESS: PermissionState = {
  canRead: false,
  canWrite: false,
  canDelete: false,
  canApprove: false,
};

/** Accès minimal si aucun département : structure / affectations (admin & manager). */
export const BOOTSTRAP_MODULES_NO_DEPT: ModuleName[] = [
  'organization_management',
  'department_management',
  'user_management',
  'settings',
];

/**
 * Modules "plateforme" qui ne doivent pas disparaître à cause du scope départements.
 * Objectif : éviter les UX bloquantes (ex. sidebar → Tableau de bord qui n'arrive jamais).
 */
export const GLOBAL_UNSCOPED_MODULES: ModuleName[] = [
  'dashboard',
  'settings',
];

export const BOOTSTRAP_STATE: PermissionState = {
  canRead: true,
  canWrite: true,
  canDelete: false,
  canApprove: false,
};

export function buildExplicitReadDenyFromRows(rows: unknown[] | null | undefined): Set<ModuleName> {
  const s = new Set<ModuleName>();
  if (!Array.isArray(rows)) return s;
  for (const row of rows) {
    const r = row as { module_name?: string; can_read?: boolean | null };
    if (r && r.can_read === false && r.module_name) {
      const raw = String(r.module_name);
      s.add((raw === 'knowledge_base' ? 'coya_drive' : raw) as ModuleName);
    }
  }
  return s;
}

/**
 * Périmètre départements : hors périmètre = refusé.
 *
 * Règle métier : l'appartenance à un département EST autoritaire pour les modules de ce département.
 * Autrement dit, dès qu'un module fait partie des `moduleSlugs` du/des département(s) de l'utilisateur,
 * la lecture est accordée — même si une ligne `user_module_permissions` (souvent écrite par défaut pour
 * les cases décochées) porte `can_read = false`. Cela évite le faux « Accès refusé » pour un membre
 * d'un département. Le paramètre `explicitReadDeny` ne s'applique donc plus aux modules du département.
 */
export function applyDepartmentScopeToPermissions(
  effective: Record<ModuleName, PermissionState>,
  allowedSlugs: ModuleName[],
  role: Role,
  explicitReadDeny?: Set<ModuleName>,
): void {
  if (role === 'super_administrator') return;

  if (allowedSlugs.length > 0) {
    const allowedSet = new Set(allowedSlugs);
    (Object.keys(effective) as ModuleName[]).forEach((m) => {
      if (GLOBAL_UNSCOPED_MODULES.includes(m)) return;
      if (!allowedSet.has(m)) {
        effective[m] = { ...NO_ACCESS };
      }
    });
    for (const m of allowedSlugs) {
      const p = effective[m];
      if (!p) continue;
      if (p.canRead) continue;
      // L'appartenance au département accorde la lecture, sans tenir compte d'un refus explicite.
      effective[m] = { ...p, canRead: true };
    }
    // Garantir l'accès minimal à la plateforme (si pas explicitement refusé).
    for (const m of GLOBAL_UNSCOPED_MODULES) {
      const p = effective[m];
      if (!p) continue;
      if (p.canRead) continue;
      if (explicitReadDeny?.has(m)) continue;
      effective[m] = { ...p, canRead: true };
    }
    return;
  }

  const canBootstrap = role === 'administrator' || role === 'manager';
  (Object.keys(effective) as ModuleName[]).forEach((m) => {
    effective[m] = { ...NO_ACCESS };
  });
  // Même sans départements, laisser un minimum d’accès non bloquant (plateforme).
  GLOBAL_UNSCOPED_MODULES.forEach((m) => {
    effective[m] = { ...BOOTSTRAP_STATE, canWrite: false };
  });
  if (canBootstrap) {
    BOOTSTRAP_MODULES_NO_DEPT.forEach((m) => {
      effective[m] = { ...BOOTSTRAP_STATE };
    });
  }
}

/** `null` = pas de filtre (cible super-administrateur). */
export function getSavableModuleFilter(allowedSlugs: ModuleName[], role: Role): Set<ModuleName> | null {
  if (role === 'super_administrator') return null;
  if (allowedSlugs.length > 0) return new Set(allowedSlugs);
  const canBootstrap = role === 'administrator' || role === 'manager';
  if (canBootstrap) return new Set(BOOTSTRAP_MODULES_NO_DEPT);
  return new Set();
}

export function filterPermissionRowsForDepartmentScope<
  T extends {
    moduleName: string;
    canRead: boolean;
    canWrite: boolean;
    canDelete: boolean;
    canApprove: boolean;
  },
>(rows: T[], savable: Set<ModuleName> | null): T[] {
  if (savable === null) return rows;
  return rows.filter((r) => savable.has(r.moduleName as ModuleName));
}
