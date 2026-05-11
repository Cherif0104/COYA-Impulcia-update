import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { DataService } from '../services/dataService';
import OrganizationService from '../services/organizationService';
import DepartmentService from '../services/departmentService';
import { User, ModuleName, Role, Department } from '../types';
import { getDefaultPermissionsForRole, PermissionState } from '../utils/modulePermissionDefaults';
import {
  applyDepartmentScopeToPermissions,
  buildExplicitReadDenyFromRows,
  BOOTSTRAP_MODULES_NO_DEPT,
  filterPermissionRowsForDepartmentScope,
  getSavableModuleFilter,
} from '../utils/departmentPermissionPolicy';
import AccessDenied from './common/AccessDenied';
import { useModuleLabels } from '../hooks/useModuleLabels';

interface UserModulePermissionsProps {
  users: User[];
  canEdit?: boolean;
}

export const moduleDisplayNames: Record<ModuleName, string> = {
  'dashboard': 'Tableau de Bord',
  'projects': 'Projets',
  'goals_okrs': 'Objectifs OKR',
  'planning': 'Planification',
  'leave_management': 'Demandes de Congés',
  'comptabilite': 'Comptabilité',
  'coya_drive': 'COYA Drive',
  'daf_services': 'Moyens Généraux',
  'courses': 'Formations',
  'jobs': 'Offres d\'Emploi',
  'crm_sales': 'CRM & Ventes',
  'qualite': 'Qualité',
  'rh': 'Ressources Humaines',
  'trinite': 'Trinité',
  'programme': 'Programme',
  'collecte': 'Collecte',
  'user_management': 'Droits d\'accès / Utilisateurs',
  'course_management': 'Gestion des Formations',
  'job_management': 'Gestion des Jobs',
  'leave_management_admin': 'Gestion des Congés',
  'organization_management': 'Gestion des Organisations',
  'department_management': 'Départements',
  'postes_management': 'Postes',
  'settings': 'Paramètres',
  'logistique': 'Logistique',
  'studio': 'Studio',
  'parc_auto': 'Parc Auto',
  'ticket_it': 'Ticket IT',
  'messagerie': 'Messagerie',
};

// Catégories (10 départements + administration)
const moduleCategories: Record<string, { label: string; icon: string; modules: ModuleName[] }> = {
  workspace: {
    label: 'Workspace',
    icon: 'fas fa-briefcase',
    modules: ['dashboard', 'projects', 'goals_okrs', 'planning', 'leave_management', 'coya_drive'],
  },
  rh: {
    label: 'RH',
    icon: 'fas fa-users-cog',
    modules: ['rh'],
  },
  admin_financier: {
    label: 'Administratif & Financier',
    icon: 'fas fa-file-invoice-dollar',
    modules: ['programme', 'comptabilite'],
  },
  formation: {
    label: 'Formation & Bootcamp',
    icon: 'fas fa-book-open',
    modules: ['courses'],
  },
  emploi: {
    label: 'Emploi',
    icon: 'fas fa-briefcase',
    modules: ['jobs'],
  },
  crm_ventes: {
    label: 'CRM & Ventes',
    icon: 'fas fa-handshake',
    modules: ['crm_sales'],
  },
  conseil_qualite: {
    label: 'Qualité',
    icon: 'fas fa-chart-pie',
    modules: ['qualite'],
  },
  collecte: {
    label: 'Collecte',
    icon: 'fas fa-clipboard-list',
    modules: ['collecte'],
  },
  trinite: {
    label: 'Trinité',
    icon: 'fas fa-gem',
    modules: ['trinite'],
  },
  logistique_ops: {
    label: 'Logistique & Opérations',
    icon: 'fas fa-boxes',
    modules: ['logistique', 'studio', 'parc_auto', 'ticket_it'],
  },
  communication_conformite: {
    label: 'Communication & Conformité',
    icon: 'fas fa-envelope',
    modules: ['messagerie'],
  },
  administration: {
    label: 'Administration (Paramètres)',
    icon: 'fas fa-cog',
    modules: ['organization_management', 'department_management', 'postes_management', 'user_management', 'course_management', 'job_management', 'leave_management_admin'],
  },
  settings: {
    label: 'Paramètres',
    icon: 'fas fa-cog',
    modules: ['settings'],
  },
};

const UserModulePermissions: React.FC<UserModulePermissionsProps> = ({ users, canEdit = true }) => {
  const { t } = useLocalization();
  const { user: currentUser } = useAuth();
  const { getDisplayName } = useModuleLabels();
  const [selectedUserId, setSelectedUserId] = useState<string | number>('');
  const [permissions, setPermissions] = useState<Record<ModuleName, PermissionState>>({} as Record<ModuleName, PermissionState>);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all');
  const [isSaving, setIsSaving] = useState(false);
  const saveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedUserRef = useRef<User | undefined>(undefined);
  const allowedSlugsRef = useRef<ModuleName[]>([]);
  const [allowedSlugsForSelected, setAllowedSlugsForSelected] = useState<ModuleName[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [userDepartmentIds, setUserDepartmentIds] = useState<string[]>([]);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  // Attribution en masse (Phase 0.3)
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkRefUserId, setBulkRefUserId] = useState<string | number>('');
  const [bulkDeptId, setBulkDeptId] = useState('');
  const [bulkDeptList, setBulkDeptList] = useState<Department[]>([]);
  const [bulkApplying, setBulkApplying] = useState(false);
  // Sélection multi-utilisateurs pour attribution de droits
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string | number>>(new Set());
  const [bulkApplyToSelected, setBulkApplyToSelected] = useState(false);
  /** Incrémenté après enregistrement des départements pour recharger le périmètre depuis la base. */
  const [permReloadNonce, setPermReloadNonce] = useState(0);

  const selectedUser = users.find(u => u.id === selectedUserId);

  useEffect(() => {
    selectedUserRef.current = selectedUser;
  }, [selectedUser]);

  useEffect(() => {
    allowedSlugsRef.current = allowedSlugsForSelected;
  }, [allowedSlugsForSelected]);

  const buildPayloadForTarget = useCallback(
    (sel: User, allowedSlugs: ModuleName[], perms: Record<ModuleName, PermissionState>) => {
      const full = Object.entries(perms).map(([moduleName, p]) => ({
        moduleName,
        canRead: p.canRead,
        canWrite: p.canWrite,
        canDelete: p.canDelete,
        canApprove: p.canApprove,
      }));
      return filterPermissionRowsForDepartmentScope(full, getSavableModuleFilter(allowedSlugs, sel.role as Role));
    },
    [],
  );

  const scheduleAutoSave = useCallback(
    (updatedPermissions: Record<ModuleName, PermissionState>) => {
      const sel = selectedUserRef.current;
      if (!sel?.profileId || !canEdit) return;
      if (saveDebounceRef.current) {
        clearTimeout(saveDebounceRef.current);
        saveDebounceRef.current = null;
      }
      saveDebounceRef.current = setTimeout(async () => {
        saveDebounceRef.current = null;
        const cur = selectedUserRef.current;
        if (!cur?.profileId) return;
        setIsSaving(true);
        try {
          const payload = buildPayloadForTarget(cur, allowedSlugsRef.current, updatedPermissions);
          await DataService.upsertUserModulePermissions(String(cur.profileId), payload);
          window.dispatchEvent(new Event('permissions-reload'));
        } catch (error) {
          console.error('❌ Erreur sauvegarde automatique:', error);
          alert('Erreur lors de la sauvegarde. Veuillez réessayer.');
        } finally {
          setIsSaving(false);
        }
      }, 500);
    },
    [canEdit, buildPayloadForTarget],
  );

  const isTargetSuperAdmin = selectedUser?.role === 'super_administrator';

  const isModuleInDeptScope = useCallback(
    (module: ModuleName) => {
      if (!selectedUser || isTargetSuperAdmin) return true;
      if (allowedSlugsForSelected.length > 0) {
        return allowedSlugsForSelected.includes(module);
      }
      const bootstrap = selectedUser.role === 'administrator' || selectedUser.role === 'manager';
      return bootstrap && BOOTSTRAP_MODULES_NO_DEPT.includes(module);
    },
    [selectedUser, allowedSlugsForSelected, isTargetSuperAdmin],
  );

  const deptScopeBanner = useMemo(() => {
    if (!selectedUser || isTargetSuperAdmin) return null;
    if (allowedSlugsForSelected.length > 0) {
      const labels = allowedSlugsForSelected.map(
        (s) => getDisplayName(s) || moduleDisplayNames[s] || s,
      );
      return `Périmètre départements (modules éligibles aux dérogations) : ${labels.join(', ')}.`;
    }
    if (selectedUser.role === 'administrator' || selectedUser.role === 'manager') {
      return 'Aucun département : seuls organisation, départements, utilisateurs et paramètres restent configurables jusqu’à une affectation à un département.';
    }
    return 'Aucun département : aucune dérogation sur les modules métier n’est possible tant que l’utilisateur n’est pas rattaché à un département qui expose des modules.';
  }, [selectedUser, allowedSlugsForSelected, isTargetSuperAdmin, getDisplayName]);

  // Charger départements de l'org et assignations de l'utilisateur sélectionné
  useEffect(() => {
    if (!selectedUser) {
      setDepartments([]);
      setUserDepartmentIds([]);
      return;
    }
    let cancelled = false;
    setLoadingDepartments(true);
    (async () => {
      try {
        const orgId = await OrganizationService.getCurrentUserOrganizationId();
        if (cancelled) return;
        if (!orgId) {
          setDepartments([]);
          setUserDepartmentIds([]);
          return;
        }
        const [deptList, links] = await Promise.all([
          DepartmentService.getDepartmentsByOrganizationId(orgId),
          DepartmentService.getUserDepartmentLinks(String(selectedUser.id))
        ]);
        if (cancelled) return;
        setDepartments(deptList);
        setUserDepartmentIds(links.map(l => l.departmentId));
      } catch (e) {
        if (!cancelled) {
          console.error('Erreur chargement départements:', e);
          setDepartments([]);
          setUserDepartmentIds([]);
        }
      } finally {
        if (!cancelled) setLoadingDepartments(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedUser?.id]);

  // Charger départements pour le modal d'attribution en masse
  useEffect(() => {
    if (!showBulkModal) return;
    let cancelled = false;
    (async () => {
      try {
        const orgId = await OrganizationService.getCurrentUserOrganizationId();
        if (cancelled || !orgId) return;
        const deptList = await DepartmentService.getDepartmentsByOrganizationId(orgId);
        if (!cancelled) setBulkDeptList(deptList);
      } catch (e) {
        if (!cancelled) setBulkDeptList([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showBulkModal]);

  // Filtrer les utilisateurs selon la recherche et le rôle
  const filteredUsers = useMemo(() => {
    return users.filter(user => {
      const matchesSearch = searchQuery === '' ||
        user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      
      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, roleFilter]);

  // Extraire les rôles uniques pour le filtre
  const uniqueRoles = useMemo(() => {
    const roles = new Set<Role>(users.map(u => u.role));
    return Array.from(roles).sort();
  }, [users]);

  const handleUserSelect = (userId: string | number) => {
    setSelectedUserId(userId);
  };

  useEffect(() => {
    if (saveDebounceRef.current) {
      clearTimeout(saveDebounceRef.current);
      saveDebounceRef.current = null;
    }

    if (!selectedUserId) {
      setAllowedSlugsForSelected([]);
      return;
    }

    const sel = users.find((u) => String(u.id) === String(selectedUserId));
    if (!sel) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        let effective = getDefaultPermissionsForRole(sel.role as Role);
        let rows: unknown[] = [];
        if (sel.profileId) {
          const { data } = await DataService.getUserModulePermissions(String(sel.profileId));
          rows = Array.isArray(data) ? data : [];
          rows.forEach((row: any) => {
            const m = row.module_name as ModuleName;
            effective[m] = {
              canRead: !!row.can_read,
              canWrite: !!row.can_write,
              canDelete: !!row.can_delete,
              canApprove: !!row.can_approve,
            };
          });
        }

        const explicitReadDeny = buildExplicitReadDenyFromRows(rows);
        const isSuperTarget = sel.role === 'super_administrator';
        const allowedSlugs = isSuperTarget
          ? []
          : await DepartmentService.getAllowedModuleSlugsForUser(String(sel.id));

        if (cancelled) return;
        setAllowedSlugsForSelected(isSuperTarget ? [] : allowedSlugs);

        if (!isSuperTarget) {
          applyDepartmentScopeToPermissions(effective, allowedSlugs, sel.role as Role, explicitReadDeny);
        }

        const normalized = Object.entries(effective).reduce((acc, [moduleName, perms]) => {
          const canRead = !!perms.canRead;
          acc[moduleName as ModuleName] = {
            canRead,
            canWrite: canRead ? perms.canWrite : false,
            canDelete: canRead ? perms.canDelete : false,
            canApprove: canRead ? perms.canApprove : false,
          };
          return acc;
        }, {} as Record<ModuleName, PermissionState>);

        if (!cancelled) setPermissions(normalized);
      } catch (error) {
        if (!cancelled) console.error('Erreur chargement permissions:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedUserId, users, permReloadNonce]);

  const handleSave = async () => {
    if (!canEdit) return;
    if (!selectedUser || !selectedUser.profileId) return;
    
    try {
      const payload = buildPayloadForTarget(selectedUser, allowedSlugsForSelected, permissions);
      await DataService.upsertUserModulePermissions(String(selectedUser.profileId), payload);
      
      // Déclencher le rechargement des permissions dans toute l'app
      window.dispatchEvent(new Event('permissions-reload'));
      
      alert('Permissions sauvegardées avec succès !');
    } catch (error) {
      console.error('❌ Erreur sauvegarde permissions:', error);
      alert('Erreur lors de la sauvegarde des permissions');
    }
  };

  const handleSaveDepartments = async () => {
    if (!canEdit || !selectedUser) return;
    try {
      const ok = await DepartmentService.setUserDepartments(String(selectedUser.id), userDepartmentIds);
      if (!ok) throw new Error('Échec sauvegarde');
      setPermReloadNonce((n) => n + 1);
      window.dispatchEvent(new Event('permissions-reload'));
      alert('Départements enregistrés avec succès.');
    } catch (error) {
      console.error('❌ Erreur sauvegarde départements:', error);
      alert('Erreur lors de l\'enregistrement des départements.');
    }
  };

  /** Appliquer les droits d'un utilisateur de référence à tout un département (surcharge, sans écraser les autres permissions). */
  const handleBulkApply = async () => {
    if (!canEdit || !bulkRefUserId || !bulkDeptId) return;
    const refUser = users.find(u => u.id === bulkRefUserId);
    if (!refUser || !refUser.profileId) {
      alert('Veuillez sélectionner un utilisateur de référence ayant un profil.');
      return;
    }
    setBulkApplying(true);
    try {
      let effectivePermissions = getDefaultPermissionsForRole(refUser.role as Role);
      const { data } = await DataService.getUserModulePermissions(String(refUser.profileId));
      if (Array.isArray(data) && data.length > 0) {
        data.forEach((row: any) => {
          const m = row.module_name as ModuleName;
          effectivePermissions[m] = {
            canRead: !!row.can_read,
            canWrite: !!row.can_write,
            canDelete: !!row.can_delete,
            canApprove: !!row.can_approve
          };
        });
      }
      const dept = bulkDeptList.find((d) => d.id === bulkDeptId);
      const deptSlugs = (dept?.moduleSlugs ?? []) as ModuleName[];
      const savableDept = new Set<ModuleName>(deptSlugs);
      const payload = filterPermissionRowsForDepartmentScope(
        Object.entries(effectivePermissions).map(([moduleName, perms]) => ({
          moduleName,
          canRead: perms.canRead,
          canWrite: perms.canWrite,
          canDelete: perms.canDelete,
          canApprove: perms.canApprove,
        })),
        savableDept.size > 0 ? savableDept : new Set(),
      );

      const userIds = await DepartmentService.getUserIdsInDepartment(bulkDeptId);
      const targetUsers = users.filter(u => userIds.includes(String(u.id)));
      let applied = 0;
      for (const u of targetUsers) {
        const profileId = (u as any).profileId || u.id;
        const { error } = await DataService.upsertUserModulePermissions(String(profileId), payload);
        if (!error) applied++;
      }
      window.dispatchEvent(new Event('permissions-reload'));
      alert(`Droits appliqués à ${applied} utilisateur(s) du département.`);
      setShowBulkModal(false);
      setBulkRefUserId('');
      setBulkDeptId('');
    } catch (error) {
      console.error('❌ Erreur attribution en masse:', error);
      alert('Erreur lors de l\'attribution en masse.');
    } finally {
      setBulkApplying(false);
    }
  };

  /** Appliquer les permissions actuelles (utilisateur sélectionné) aux utilisateurs cochés. */
  const handleApplyToSelectedUsers = async () => {
    if (!canEdit || !selectedUser || !selectedUser.profileId || selectedUserIds.size === 0) return;
    setBulkApplyToSelected(true);
    try {
      const templateRows = Object.entries(permissions).map(([moduleName, perms]) => ({
        moduleName,
        canRead: perms.canRead,
        canWrite: perms.canWrite,
        canDelete: perms.canDelete,
        canApprove: perms.canApprove,
      }));
      let applied = 0;
      for (const uid of selectedUserIds) {
        if (String(uid) === String(selectedUser.id)) continue;
        const u = users.find(us => us.id === uid);
        const profileId = u ? ((u as any).profileId || u.id) : null;
        if (!profileId || !u) continue;
        const allowed = await DepartmentService.getAllowedModuleSlugsForUser(String(u.id));
        const payload = filterPermissionRowsForDepartmentScope(
          templateRows,
          getSavableModuleFilter(allowed, u.role as Role),
        );
        const { error } = await DataService.upsertUserModulePermissions(String(profileId), payload);
        if (!error) applied++;
      }
      window.dispatchEvent(new Event('permissions-reload'));
      alert(`Droits appliqués à ${applied} utilisateur(s) sélectionné(s).`);
      setSelectedUserIds(new Set());
    } catch (error) {
      console.error('❌ Erreur attribution aux sélectionnés:', error);
      alert('Erreur lors de l\'attribution.');
    } finally {
      setBulkApplyToSelected(false);
    }
  };

  const toggleUserSelection = (userId: string | number) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    if (selectedUserIds.size === filteredUsers.length) {
      setSelectedUserIds(new Set());
    } else {
      setSelectedUserIds(new Set(filteredUsers.map(u => u.id)));
    }
  };

  if (!currentUser) return null;

  if (currentUser.role !== 'super_administrator') {
    return <AccessDenied description="Seuls les Super Administrateurs peuvent consulter ou modifier les permissions des modules." />;
  }

  return (
    <div className="space-y-6">
      {/* Header avec gradient */}
      <div className="bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-lg rounded-lg p-6">
        <div className="flex items-center gap-4 mb-4">
          <div className="w-16 h-16 rounded-full bg-white bg-opacity-20 flex items-center justify-center">
            <i className="fas fa-shield-alt text-3xl"></i>
          </div>
          <div>
            <h2 className="text-2xl font-bold">Gestion des Permissions Module</h2>
            <p className="text-emerald-50 text-sm">
              Configurez les accès et permissions pour chaque utilisateur
            </p>
          </div>
        </div>
        <div className="bg-white bg-opacity-20 rounded-lg p-4 backdrop-blur-sm">
            <p className="text-sm flex items-start gap-2">
            <i className="fas fa-info-circle mt-1"></i>
            <span>
              Les modules visibles pour l’utilisateur viennent d’abord des départements (union des modules des départements assignés). Ici vous définissez des dérogations par module (voir, créer/modifier, supprimer, approuver) dans ce périmètre uniquement. Sans département, aucun contenu métier n’est exposé (sauf garde-fou admin/manager pour l’organisation).
              {!canEdit && ' (lecture seule)'}
            </span>
          </p>
        </div>
        {canEdit && (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowBulkModal(true)}
              className="px-4 py-2 bg-white bg-opacity-20 hover:bg-opacity-30 rounded-lg border border-white border-opacity-40 font-medium"
            >
              <i className="fas fa-users-cog mr-2"></i>
              Appliquer en masse (département)
            </button>
          </div>
        )}
      </div>

      {/* Barre de recherche et filtres */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <i className="fas fa-user-check text-emerald-600"></i>
            Sélectionner un utilisateur
          </h3>
          {canEdit && filteredUsers.length > 0 && (
            <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600">
              <input
                type="checkbox"
                checked={filteredUsers.every(u => selectedUserIds.has(u.id))}
                onChange={selectAllFiltered}
                className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
              />
              Tout sélectionner
            </label>
          )}
        </div>
        
        {/* Recherche */}
        <div className="mb-4">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            <input
              type="text"
              placeholder="Rechercher par nom ou email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            />
          </div>
        </div>

        {/* Filtre par rôle */}
        <div className="mb-4">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as Role | 'all')}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
          >
            <option value="all">Tous les rôles</option>
            {uniqueRoles.map(role => (
              <option key={role} value={role}>
                {t(role)}
              </option>
            ))}
          </select>
        </div>

        {/* Liste des utilisateurs */}
        <div className="max-h-80 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2">
          {filteredUsers.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <i className="fas fa-users text-4xl mb-2"></i>
              <p>Aucun utilisateur trouvé</p>
            </div>
          ) : (
            filteredUsers.map(user => (
              <div
                key={user.id}
                onClick={() => handleUserSelect(user.id)}
                className={`p-4 rounded-lg border cursor-pointer transition-all flex items-start gap-3 ${
                  selectedUserId === user.id
                    ? 'bg-emerald-50 border-emerald-500 shadow-md'
                    : 'bg-white border-gray-200 hover:border-emerald-300 hover:shadow-sm'
                }`}
              >
                {canEdit && (
                  <input
                    type="checkbox"
                    checked={selectedUserIds.has(user.id)}
                    onChange={(e) => { e.stopPropagation(); toggleUserSelection(user.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className="mt-1 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                  />
                )}
                <div className="flex items-center gap-3 flex-1">
                  {user.avatar && !user.avatar.startsWith('data:image') ? (
                    <img 
                      src={user.avatar} 
                      alt={user.name || 'Utilisateur'} 
                      className="w-10 h-10 rounded-full object-cover" 
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center text-white font-bold">
                      {(user.name || 'U').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1">
                    <p className="font-semibold text-gray-900">{user.name || user.email}</p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>
                  <span className="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                    {t(user.role)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedUser && (
        <>
          {/* Bouton appliquer aux sélectionnés */}
          {canEdit && selectedUserIds.size > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-amber-800">
                  <i className="fas fa-users mr-2"></i>
                  {selectedUserIds.size} utilisateur(s) sélectionné(s). Les permissions ci-dessous seront appliquées à tous.
                </span>
                <button
                  type="button"
                  onClick={handleApplyToSelectedUsers}
                  disabled={bulkApplyToSelected}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 font-medium"
                >
                  {bulkApplyToSelected ? <><i className="fas fa-spinner fa-spin mr-2"></i>Application…</> : <>Appliquer aux {selectedUserIds.size} sélectionnés</>}
                </button>
              </div>
            </div>
          )}

          {/* En-tête avec informations utilisateur */}
          <div className="bg-gradient-to-r from-emerald-50 to-blue-50 rounded-lg shadow-sm border border-emerald-200 p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {selectedUser.avatar ? (
                  <img src={selectedUser.avatar || undefined} alt={selectedUser.name} className="w-16 h-16 rounded-full border-4 border-white shadow-md" onError={(e) => { e.currentTarget.style.display = 'none'; }}/>
                ) : (
                  <div className="w-16 h-16 rounded-full border-4 border-white shadow-md bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center text-white text-2xl font-bold">
                    {selectedUser.name?.charAt(0).toUpperCase() || 'U'}
                  </div>
                )}
                <div>
                  <h3 className="text-xl font-bold text-gray-800">{selectedUser.name || selectedUser.fullName}</h3>
                  <p className="text-gray-600">{selectedUser.email}</p>
                  <span className="inline-block mt-2 px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">
                    {t(selectedUser.role)}
                  </span>
                </div>
              </div>
              {isSaving && (
                <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm">
                  <i className="fas fa-spinner fa-spin text-emerald-600"></i>
                  <span className="text-sm font-medium text-gray-700">Sauvegarde...</span>
                </div>
              )}
            </div>
          </div>

          {/* Départements de l'utilisateur */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fas fa-sitemap text-emerald-600"></i>
              Départements de l'utilisateur
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Les modules accessibles pour cet utilisateur sont l&apos;union des modules autorisés sur les départements cochés. Cochez les départements auxquels il appartient, puis cliquez sur « Enregistrer les départements » pour mettre à jour le périmètre des permissions ci-dessous.
            </p>
            {loadingDepartments ? (
              <div className="flex items-center gap-2 py-4">
                <i className="fas fa-spinner fa-spin text-emerald-600"></i>
                <span className="text-sm text-gray-600">Chargement des départements...</span>
              </div>
            ) : departments.length === 0 ? (
              <p className="text-gray-500 py-2">Aucun département dans votre organisation. Créez-en depuis l'écran Départements (menu Management).</p>
            ) : (
              <>
                <div className="space-y-2 mb-4 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
                  {departments.map(dept => (
                    <label key={dept.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={userDepartmentIds.includes(dept.id)}
                        onChange={() => {
                          if (!canEdit) return;
                          setUserDepartmentIds(prev =>
                            prev.includes(dept.id)
                              ? prev.filter(id => id !== dept.id)
                              : [...prev, dept.id]
                          );
                        }}
                        disabled={!canEdit}
                        className="rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm font-medium text-gray-800">{dept.name}</span>
                      {dept.slug && <span className="text-xs text-gray-500">({dept.slug})</span>}
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSaveDepartments}
                  disabled={!canEdit}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  Enregistrer les départements
                </button>
              </>
            )}
          </div>

          {/* Permissions par module */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fas fa-list-check text-emerald-600"></i>
              Permissions par Module
            </h3>
            <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-6 rounded-r-lg">
              <p className="text-sm text-gray-700 flex items-start gap-2">
                <i className="fas fa-info-circle text-blue-600 mt-1"></i>
                <span><strong>Info :</strong> Les modifications sont sauvegardées automatiquement après 0.5s d&apos;inactivité (uniquement pour les modules dans le périmètre départements).</span>
              </p>
            </div>
            {deptScopeBanner && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-900 flex gap-2">
                <i className="fas fa-sitemap mt-0.5" aria-hidden />
                <span>{deptScopeBanner}</span>
              </div>
            )}
            <div className="space-y-6 max-h-[600px] overflow-y-auto">
              {Object.entries(moduleCategories).map(([categoryKey, category]) => (
                <div key={categoryKey} className="space-y-3">
                  {/* Titre de catégorie */}
                  <div className="sticky top-0 bg-gray-100 z-10 py-2 px-4 rounded-lg border border-gray-300">
                    <h4 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                      <i className={category.icon}></i>
                      {category.label}
                    </h4>
                  </div>
                  
                  {/* Modules de la catégorie */}
                  {category.modules.map(moduleName => {
                    const module = moduleName as ModuleName;
                    const displayName = getDisplayName(module) || moduleDisplayNames[module];
                    const modulePerms = permissions[module] || { canRead: false, canWrite: false, canDelete: false, canApprove: false };
                    const inDeptScope = isModuleInDeptScope(module);
                    
                    return (
                      <div
                        key={moduleName}
                        className={`border rounded-lg p-5 transition-all ${
                          !inDeptScope
                            ? 'opacity-60 border-dashed border-amber-300 bg-amber-50/40'
                            : modulePerms.canRead
                              ? 'border-emerald-200 bg-emerald-50 hover:border-emerald-300'
                              : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                    {/* En-tête du module avec toggle principal */}
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-gray-200">
                      <div className="flex-1">
                        <h4 className="font-semibold text-gray-800 text-lg">{displayName}</h4>
                        <span className="text-xs text-gray-500 uppercase font-mono">{moduleName}</span>
                        {!inDeptScope && (
                          <span className="mt-1 inline-block text-xs font-semibold text-amber-800 bg-amber-100 px-2 py-0.5 rounded">
                            Hors périmètre départements
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                          modulePerms.canRead 
                            ? 'bg-green-100 text-green-800' 
                            : 'bg-red-100 text-red-800'
                        }`}>
                          <i className={`fas fa-${modulePerms.canRead ? 'check-circle' : 'lock'} mr-1`}></i>
                          {modulePerms.canRead ? 'Activé' : 'Désactivé'}
                        </span>
                        {/* Toggle principal pour activer/désactiver le module */}
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">Activer le module</span>
                          <button
                            type="button"
                            onClick={() => {
                              if (!canEdit || !inDeptScope) return;
                              const newValue = !modulePerms.canRead;
                              const updatedPermissions = {
                                ...permissions,
                                [module]: {
                                  canRead: newValue,
                                  canWrite: newValue,
                                  canDelete: newValue,
                                  canApprove: newValue,
                                },
                              };
                              setPermissions(updatedPermissions);
                              scheduleAutoSave(updatedPermissions);
                            }}
                            disabled={!canEdit || !inDeptScope}
                            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                              modulePerms.canRead ? 'bg-emerald-600' : 'bg-gray-300'
                            } ${!canEdit || !inDeptScope ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                modulePerms.canRead ? 'translate-x-6' : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                    
                    {/* Informations d'accès */}
                    {modulePerms.canRead && (
                      <div className="bg-white rounded-lg p-4 border border-gray-200 space-y-3">
                        <div className="text-sm text-gray-700 flex items-start gap-3">
                          <i className="fas fa-sliders-h text-emerald-600 mt-1"></i>
                          <span>
                            Ajustez finement les droits pour ce module. Par défaut, un rôle peut donner un accès large ; ici vous pouvez restreindre (ex. lecture seule).
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {([
                            { k: 'canRead' as const, label: 'Voir', icon: 'fa-eye' },
                            { k: 'canWrite' as const, label: 'Créer / Modifier', icon: 'fa-pen' },
                            { k: 'canDelete' as const, label: 'Supprimer', icon: 'fa-trash' },
                            { k: 'canApprove' as const, label: 'Approuver', icon: 'fa-check' },
                          ] as const).map(({ k, label, icon }) => (
                            <label key={`${moduleName}-${k}`} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${
                              modulePerms[k] ? 'border-emerald-200 bg-emerald-50' : 'border-gray-200 bg-gray-50'
                            }`}>
                              <span className="text-sm font-medium text-gray-800 flex items-center gap-2">
                                <i className={`fas ${icon} text-gray-600`} aria-hidden />
                                {label}
                              </span>
                              <button
                                type="button"
                                disabled={!canEdit || !inDeptScope}
                                onClick={() => {
                                  if (!canEdit || !inDeptScope) return;
                                  const nextVal = !modulePerms[k];
                                  const nextPerms = { ...modulePerms, [k]: nextVal };
                                  if ((k === 'canWrite' || k === 'canDelete' || k === 'canApprove') && nextVal) {
                                    nextPerms.canRead = true;
                                  }
                                  if (k === 'canRead' && !nextVal) {
                                    nextPerms.canWrite = false;
                                    nextPerms.canDelete = false;
                                    nextPerms.canApprove = false;
                                  }
                                  const updatedPermissions = { ...permissions, [module]: nextPerms };
                                  setPermissions(updatedPermissions);
                                  scheduleAutoSave(updatedPermissions);
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 ${
                                  modulePerms[k] ? 'bg-emerald-600' : 'bg-gray-300'
                                } ${!canEdit || !inDeptScope ? 'opacity-50 cursor-not-allowed' : ''}`}
                              >
                                <span
                                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                                    modulePerms[k] ? 'translate-x-5' : 'translate-x-1'
                                  }`}
                                />
                              </button>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    {!modulePerms.canRead && (
                      <div className="bg-gray-100 rounded-lg p-4 border border-gray-200 text-center">
                        <p className="text-sm text-gray-500 italic">
                          <i className="fas fa-info-circle mr-2"></i>
                          Activez le module pour configurer les permissions CRUD
                        </p>
                      </div>
                    )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Bouton d'annulation */}
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setSelectedUserId('')}
              className="px-6 py-3 bg-gradient-to-r from-emerald-600 to-blue-600 text-white rounded-lg font-semibold hover:from-emerald-700 hover:to-blue-700 transition-all shadow-lg transform hover:scale-105"
            >
              <i className="fas fa-check mr-2"></i>
              Fermer
            </button>
          </div>
        </>
      )}

      {!selectedUserId && (
        <div className="bg-white rounded-lg shadow-lg p-12 text-center">
          <i className="fas fa-hand-pointer text-6xl text-gray-300 mb-4"></i>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">Sélectionnez un utilisateur</h3>
          <p className="text-gray-500">Choisissez un utilisateur dans la liste ci-dessus pour gérer ses permissions.</p>
        </div>
      )}

      {/* Modal attribution en masse (Phase 0.3) */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <i className="fas fa-users-cog text-emerald-600"></i>
              Appliquer les droits à un département
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              Les droits de l’utilisateur de référence seront appliqués à tous les utilisateurs du département choisi (surcharge des permissions existantes, sans les supprimer).
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Utilisateur de référence</label>
                <select
                  value={String(bulkRefUserId)}
                  onChange={(e) => setBulkRefUserId(e.target.value === '' ? '' : e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">— Choisir —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Département cible</label>
                <select
                  value={bulkDeptId}
                  onChange={(e) => setBulkDeptId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">— Choisir —</option>
                  {bulkDeptList.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowBulkModal(false); setBulkRefUserId(''); setBulkDeptId(''); }}
                disabled={bulkApplying}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleBulkApply}
                disabled={bulkApplying || !bulkRefUserId || !bulkDeptId}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulkApplying ? <><i className="fas fa-spinner fa-spin mr-2"></i>Application…</> : <>Appliquer</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserModulePermissions;


