import { ModuleName, Role } from '../types';

export type PermissionState = {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canApprove: boolean;
};

const createState = (
  read = false,
  write = false,
  del = false,
  approve = false
): PermissionState => ({
  canRead: read,
  canWrite: write,
  canDelete: del,
  canApprove: approve,
});

const clone = (state: PermissionState): PermissionState => ({ ...state });

const STANDARD_ALLOW = createState(true, true, true, true);
const DISABLED = createState(false, false, false, false);

/** Modules métier : accès possible selon département / droits */
const STANDARD_MODULES: ModuleName[] = [
  'dashboard',
  'projects',
  'goals_okrs',
  'planning',
  'leave_management',
  'comptabilite',
  'coya_drive',
  'daf_services',
  'courses',
  'jobs',
  'crm_sales',
  'rh',
  'postes_management',
  'trinite',
  'programme',
  'settings',
  'logistique',
  'studio',
  'parc_auto',
  'ticket_it',
  'messagerie',
  'qualite',
  'collecte',
];

/** Administration : paramétrage / droits (Paramètres) ; désactivé par défaut */
export const MANAGEMENT_MODULES: ModuleName[] = [
  'organization_management',
  'department_management',
  'course_management',
  'job_management',
  'leave_management_admin',
  'user_management',
];

/** Liste canonique pour Paramètres / éditeur de libellés : métier puis administration, sans doublon. */
export const ALL_MODULE_NAMES: ModuleName[] = (() => {
  const seen = new Set<ModuleName>();
  const out: ModuleName[] = [];
  for (const m of STANDARD_MODULES) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  for (const m of MANAGEMENT_MODULES) {
    if (!seen.has(m)) {
      seen.add(m);
      out.push(m);
    }
  }
  return out;
})();

const applyState = (
  target: Record<ModuleName, PermissionState>,
  modules: ModuleName[],
  state: PermissionState
) => {
  modules.forEach((module) => {
    target[module] = clone(state);
  });
};

const createBasePermissions = (): Record<ModuleName, PermissionState> => {
  const base: Partial<Record<ModuleName, PermissionState>> = {};
  const all = [...STANDARD_MODULES, ...MANAGEMENT_MODULES] as ModuleName[];
  applyState(base as Record<ModuleName, PermissionState>, all, DISABLED);
  return base as Record<ModuleName, PermissionState>;
};

/**
 * Droits « théoriques » avant surcharges Supabase (`user_module_permissions`) et filtre départements.
 * Hors super-admin : tout refusé par défaut — l’accès ne vient que des droits configurés + départements.
 */
export const getDefaultPermissionsForRole = (
  role: Role
): Record<ModuleName, PermissionState> => {
  const permissions = createBasePermissions();

  if (role === 'super_administrator') {
    applyState(permissions, STANDARD_MODULES, STANDARD_ALLOW);
    applyState(permissions, MANAGEMENT_MODULES, STANDARD_ALLOW);
  }

  return permissions;
};
