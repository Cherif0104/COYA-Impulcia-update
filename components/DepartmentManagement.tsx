import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { Department, ModuleName } from '../types';
import OrganizationService from '../services/organizationService';
import DepartmentService, {
  validateDepartmentMemberDraft,
  validateDepartmentMemberRoster,
} from '../services/departmentService';
import { DataService } from '../services/dataService';
import AccessDenied from './common/AccessDenied';
import ConfirmationModal from './common/ConfirmationModal';
import { moduleDisplayNames } from './UserModulePermissions';
import { ALL_MODULE_NAMES } from '../utils/modulePermissionDefaults';

interface DepartmentManagementProps {
  /** Layout compact (Paramètres admin ou onglet Utilisateurs & droits). */
  embedded?: boolean;
  embeddedInUserManagement?: boolean;
  canRead?: boolean;
  canWrite?: boolean;
}

const DepartmentManagement: React.FC<DepartmentManagementProps> = ({
  embedded,
  embeddedInUserManagement,
  canRead,
  canWrite,
}) => {
  const { canAccessModule, hasPermission } = useModulePermissions();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDept, setEditingDept] = useState<Department | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [membersModalDept, setMembersModalDept] = useState<Department | null>(null);
  const [orgProfileOptions, setOrgProfileOptions] = useState<Array<{ userId: string; profileId: string; label: string }>>([]);
  const [memberIdsInDept, setMemberIdsInDept] = useState<string[]>([]);
  const [memberSelection, setMemberSelection] = useState<string[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersSaving, setMembersSaving] = useState(false);
  const [supervisorUserId, setSupervisorUserId] = useState('');
  const [managerUserIds, setManagerUserIds] = useState<string[]>([]);
  /** null = équipe conforme ; sinon message d’erreur (pour badge / tooltip). */
  const [rosterIssueByDeptId, setRosterIssueByDeptId] = useState<Record<string, string | null>>({});
  const [memberCountByDeptId, setMemberCountByDeptId] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [detailDept, setDetailDept] = useState<Department | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    sequence: 0,
    isActive: true,
    moduleSlugs: [] as ModuleName[]
  });

  const isEmbedded = Boolean(embedded || embeddedInUserManagement);
  const canReadModule = embeddedInUserManagement ? (canRead ?? true) : canAccessModule('department_management');
  const canWriteModule = embeddedInUserManagement ? (canWrite ?? false) : hasPermission('department_management', 'write');

  useEffect(() => {
    if (canReadModule) {
      loadOrganizationAndDepartments();
    }
  }, [canReadModule]);

  const MIN_DEPT_MODULE_COUNT = 1;

  const loadOrganizationAndDepartments = async () => {
    try {
      setLoading(true);
      const orgId = await OrganizationService.getCurrentUserOrganizationId();
      setOrganizationId(orgId || null);
      if (orgId) {
        const list = await DepartmentService.getDepartmentsByOrganizationId(orgId);
        setDepartments(list);
        const roster: Record<string, string | null> = {};
        const counts: Record<string, number> = {};
        await Promise.all(
          list.map(async (d) => {
            const links = await DepartmentService.getDepartmentMemberLinks(d.id);
            roster[d.id] = validateDepartmentMemberRoster(links);
            counts[d.id] = links.length;
          }),
        );
        setRosterIssueByDeptId(roster);
        setMemberCountByDeptId(counts);
      } else {
        setDepartments([]);
        setRosterIssueByDeptId({});
        setMemberCountByDeptId({});
      }
    } catch (error) {
      console.error('Erreur chargement départements:', error);
      alert('Erreur lors du chargement des départements');
    } finally {
      setLoading(false);
    }
  };

  const validateModuleSlugs = (): boolean => {
    if (formData.moduleSlugs.length < MIN_DEPT_MODULE_COUNT) {
      alert(
        `Chaque département doit avoir au moins ${MIN_DEPT_MODULE_COUNT} module actif. Sélectionnez au moins une case.`
      );
      return false;
    }
    return true;
  };

  const openMembersModal = useCallback(
    async (dept: Department) => {
      if (!canWriteModule || !organizationId) return;
      setMembersModalDept(dept);
      setMembersLoading(true);
      try {
        const [{ data: profiles }, links] = await Promise.all([
          DataService.getProfiles(),
          DepartmentService.getDepartmentMemberLinks(dept.id),
        ]);
        const ids = links.map((l) => l.userId);
        const inOrg = (profiles || []).filter((p: any) => String(p.organization_id || '') === String(organizationId));
        setOrgProfileOptions(
          inOrg.map((p: any) => ({
            userId: String(p.user_id || ''),
            profileId: String(p.id || ''),
            label: String(p.full_name || p.email || p.user_id || ''),
          })).filter((o) => o.userId),
        );
        setMemberIdsInDept(ids);
        setMemberSelection([...ids]);
        const sup = links.find((l) => (l.roleInDepartment || 'member') === 'supervisor');
        setSupervisorUserId(sup?.userId || '');
        setManagerUserIds(links.filter((l) => (l.roleInDepartment || 'member') === 'manager').map((l) => l.userId));
      } catch (e) {
        console.error(e);
        alert('Erreur chargement des membres');
      } finally {
        setMembersLoading(false);
      }
    },
    [canWriteModule, organizationId],
  );

  const saveMembersModal = async () => {
    if (!membersModalDept || !canWriteModule) return;
    const draftErr = validateDepartmentMemberDraft(memberSelection, supervisorUserId, managerUserIds);
    if (draftErr) {
      alert(draftErr);
      return;
    }
    setMembersSaving(true);
    try {
      const before = new Set(memberIdsInDept);
      const after = new Set(memberSelection);
      const toRemove = memberIdsInDept.filter((uid) => !after.has(uid));
      for (const uid of toRemove) {
        await DepartmentService.removeUserFromDepartment(uid, membersModalDept.id);
      }
      for (const uid of memberSelection) {
        let role: 'member' | 'supervisor' | 'manager' = 'member';
        if (uid === supervisorUserId) role = 'supervisor';
        else if (managerUserIds.includes(uid)) role = 'manager';
        await DepartmentService.assignUserToDepartment(uid, membersModalDept.id, role);
      }
      const nextLinks = await DepartmentService.getDepartmentMemberLinks(membersModalDept.id);
      const nextIds = nextLinks.map((l) => l.userId);
      setMemberIdsInDept(nextIds);
      setMemberCountByDeptId((prev) => ({
        ...prev,
        [membersModalDept.id]: nextLinks.length,
      }));
      setRosterIssueByDeptId((prev) => ({
        ...prev,
        [membersModalDept.id]: validateDepartmentMemberRoster(nextLinks),
      }));
      setMembersModalDept(null);
      try {
        window.dispatchEvent(new Event('permissions-reload'));
      } catch {
        /* ignore */
      }
    } catch (e) {
      console.error(e);
      alert('Erreur enregistrement des membres');
    } finally {
      setMembersSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!canWriteModule || !organizationId) return;
    try {
      if (!formData.name || !formData.slug) {
        alert('Le nom et le slug sont obligatoires');
        return;
      }
      if (!validateModuleSlugs()) return;
      const created = await DepartmentService.createDepartment(organizationId, {
        name: formData.name,
        slug: formData.slug,
        moduleSlugs: formData.moduleSlugs,
        sequence: formData.sequence
      });
      if (!created) {
        alert('La création a échoué.');
        return;
      }
      alert('Département créé. Définissez maintenant les membres : au moins deux personnes, un superviseur et un ou plusieurs managers.');
      setShowCreateModal(false);
      resetForm();
      await loadOrganizationAndDepartments();
      await openMembersModal(created);
    } catch (error: any) {
      console.error('Erreur création département:', error);
      alert(error?.message || 'Erreur lors de la création');
    }
  };

  const handleUpdate = async () => {
    if (!canWriteModule || !editingDept) return;
    try {
      const rosterLinks = await DepartmentService.getDepartmentMemberLinks(editingDept.id);
      const rosterErr = validateDepartmentMemberRoster(rosterLinks);
      if (rosterErr) {
        alert(
          `Équipe du département incomplète : ${rosterErr}\n\nOuvrez « Membres », ajoutez au moins deux personnes, désignez exactement un superviseur et au moins un manager, puis enregistrez avant de modifier le département.`,
        );
        return;
      }
      if (!validateModuleSlugs()) return;
      await DepartmentService.updateDepartment(editingDept.id, {
        name: formData.name,
        slug: formData.slug,
        sequence: formData.sequence,
        isActive: formData.isActive,
        moduleSlugs: formData.moduleSlugs
      });
      alert('Département mis à jour');
      setEditingDept(null);
      resetForm();
      loadOrganizationAndDepartments();
    } catch (error: any) {
      console.error('Erreur mise à jour département:', error);
      alert(error?.message || 'Erreur lors de la mise à jour');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!canWriteModule || !deleteConfirm) return;
    setDeleteLoading(true);
    try {
      const ok = await DepartmentService.deleteDepartment(deleteConfirm);
      if (!ok) throw new Error('Suppression refusée');
      setDeleteConfirm(null);
      await loadOrganizationAndDepartments();
    } catch (error: any) {
      console.error('Erreur suppression département:', error);
      alert(error?.message || 'Erreur lors de la suppression');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleToggleActive = async (dept: Department) => {
    if (!canWriteModule) return;
    try {
      await DepartmentService.updateDepartment(dept.id, { isActive: !(dept.isActive ?? true) });
      await loadOrganizationAndDepartments();
    } catch (error: any) {
      console.error('Erreur statut département:', error);
      alert(error?.message || 'Erreur lors de la mise à jour du statut');
    }
  };

  const filteredDepartments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        d.slug.toLowerCase().includes(q) ||
        (d.moduleSlugs || []).some((s) => (moduleDisplayNames[s] || String(s)).toLowerCase().includes(q)),
    );
  }, [departments, searchQuery]);

  const deptStats = useMemo(() => {
    const total = departments.length;
    const active = departments.filter((d) => d.isActive).length;
    const rosterOk = departments.filter((d) => rosterIssueByDeptId[d.id] == null).length;
    return { total, active, rosterOk };
  }, [departments, rosterIssueByDeptId]);

  const resetForm = () => {
    setFormData({
      name: '',
      slug: '',
      sequence: 0,
      isActive: true,
      moduleSlugs: []
    });
  };

  const openEditModal = (dept: Department) => {
    if (!canWriteModule) return;
    setEditingDept(dept);
    setFormData({
      name: dept.name,
      slug: dept.slug,
      sequence: dept.sequence ?? 0,
      isActive: dept.isActive ?? true,
      moduleSlugs: dept.moduleSlugs ? [...dept.moduleSlugs] : []
    });
  };

  const toggleModuleSlug = (slug: ModuleName) => {
    setFormData(prev => ({
      ...prev,
      moduleSlugs: prev.moduleSlugs.includes(slug)
        ? prev.moduleSlugs.filter(m => m !== slug)
        : [...prev.moduleSlugs, slug]
    }));
  };

  if (!canReadModule) {
    return (
      <AccessDenied description="Vous n'avez pas les permissions nécessaires pour gérer les départements." />
    );
  }

  return (
    <div className={isEmbedded ? 'space-y-3' : 'space-y-5'}>
      {!isEmbedded && (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
              <i className="fas fa-sitemap text-lg" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight">Départements</h2>
              <p className="text-xs text-white/80">Structure, modules autorisés et équipe (superviseur / managers).</p>
            </div>
          </div>
        </div>
      )}

      <div
        className={`rounded-xl border border-slate-200 bg-slate-50/80 ${isEmbedded ? 'p-3' : 'p-4'}`}
      >
        <p className={`text-slate-600 ${isEmbedded ? 'text-xs leading-relaxed' : 'text-sm'}`}>
          <strong className="text-slate-800">CRUD :</strong> consulter la fiche, créer, modifier, activer/désactiver, supprimer. Chaque département a{' '}
          <strong>au moins un module</strong> actif et une <strong>équipe</strong> (≥ 2 personnes, 1 superviseur, ≥ 1 manager) via « Équipe ».
        </p>
      </div>

      {organizationId && !loading && departments.length > 0 && (
        <div className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${isEmbedded ? '' : 'gap-3'}`}>
          <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
            <p className="text-2xl font-bold text-slate-900">{deptStats.total}</p>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-3 shadow-sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actifs</p>
            <p className="text-2xl font-bold text-slate-900">{deptStats.active}</p>
          </div>
          <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-3 shadow-sm col-span-2 sm:col-span-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Équipe OK</p>
            <p className="text-2xl font-bold text-slate-900">{deptStats.rosterOk}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-md flex-1">
          <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm" aria-hidden />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Rechercher par nom, slug ou module…"
            className={`w-full rounded-lg border border-slate-200 bg-white pl-9 text-slate-900 shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 ${
              isEmbedded ? 'py-2 text-xs' : 'py-2.5 text-sm'
            }`}
            disabled={!organizationId || loading}
          />
            </div>
            <button
          type="button"
              onClick={() => {
                if (!canWriteModule) return;
                setEditingDept(null);
                resetForm();
                setShowCreateModal(true);
              }}
              disabled={!canWriteModule || !organizationId}
          className={`inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${
            isEmbedded ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'
              }`}
            >
          <i className="fas fa-plus" aria-hidden />
          Créer un département
            </button>
      </div>

      <div>
        {!organizationId ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
            <i className="fas fa-building text-amber-600 text-3xl mb-2" aria-hidden />
            <p className="text-sm font-medium text-amber-900">Aucune organisation associée à votre compte.</p>
          </div>
        ) : loading ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-12 text-center shadow-sm">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
            <p className="mt-3 text-sm text-slate-600">Chargement des départements…</p>
          </div>
        ) : departments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center shadow-sm">
            <i className="fas fa-sitemap text-5xl text-slate-200 mb-3" aria-hidden />
            <h3 className="text-lg font-semibold text-slate-800">Aucun département</h3>
            <p className="mt-1 text-sm text-slate-500">Créez un département puis ouvrez « Équipe » pour assigner superviseur et managers.</p>
          </div>
        ) : filteredDepartments.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600">
            Aucun résultat pour « {searchQuery} ».
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Département</th>
                    <th className="hidden sm:table-cell px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Slug</th>
                    <th className="hidden md:table-cell px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-slate-500">Ordre</th>
                    <th className="hidden lg:table-cell px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Modules</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Statut</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Équipe</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                </tr>
              </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredDepartments.map((dept) => (
                    <tr key={dept.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3">
                        <p className="text-sm font-semibold text-slate-900">{dept.name}</p>
                        <p className="text-xs text-slate-500 sm:hidden font-mono">{dept.slug}</p>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-sm text-slate-600 font-mono">{dept.slug}</td>
                      <td className="hidden md:table-cell px-4 py-3 text-center text-sm text-slate-600">{dept.sequence ?? 0}</td>
                      <td className="hidden lg:table-cell px-4 py-3 text-xs text-slate-600 max-w-[220px] truncate" title={(dept.moduleSlugs ?? []).map((s) => moduleDisplayNames[s] || s).join(', ')}>
                      {(dept.moduleSlugs?.length ?? 0) > 0
                          ? (dept.moduleSlugs ?? []).map((s) => moduleDisplayNames[s] || s).join(', ')
                        : '—'}
                    </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            dept.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                        {dept.isActive ? 'Actif' : 'Inactif'}
                      </span>
                    </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex flex-col gap-1">
                          <span className="text-xs text-slate-500">{memberCountByDeptId[dept.id] ?? 0} membre(s)</span>
                          {rosterIssueByDeptId[dept.id] == null ? (
                            <span className="inline-flex w-fit rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
                              Conforme
                            </span>
                          ) : (
                            <span
                              className="inline-flex w-fit cursor-help rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                              title={rosterIssueByDeptId[dept.id] || ''}
                            >
                              À compléter
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            title="Consulter (lecture)"
                            onClick={() => setDetailDept(dept)}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          >
                            <i className="fas fa-eye text-xs" aria-hidden />
                          </button>
                    {canWriteModule && (
                            <>
                              <button
                                type="button"
                                title="Équipe — superviseur & managers"
                                onClick={() => void openMembersModal(dept)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                              >
                                <i className="fas fa-users text-xs" aria-hidden />
                              </button>
                              <button
                                type="button"
                                title="Modifier"
                                onClick={() => openEditModal(dept)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                              >
                                <i className="fas fa-pen text-xs" aria-hidden />
                              </button>
                              <button
                                type="button"
                                title={dept.isActive ? 'Désactiver' : 'Activer'}
                                onClick={() => void handleToggleActive(dept)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                              >
                                <i className={`fas ${dept.isActive ? 'fa-toggle-on text-emerald-600' : 'fa-toggle-off text-slate-400'} text-sm`} aria-hidden />
                              </button>
                              <button
                                type="button"
                                title="Supprimer"
                                onClick={() => setDeleteConfirm(dept.id)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-100 bg-red-50 text-red-700 hover:bg-red-100"
                              >
                                <i className="fas fa-trash-alt text-xs" aria-hidden />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal création / édition */}
      {(showCreateModal || editingDept) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white">
                <i className={`fas ${editingDept ? 'fa-pen' : 'fa-plus'}`} aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">{editingDept ? 'Modifier le département' : 'Nouveau département'}</h2>
                <p className="text-xs text-slate-500">Données, modules et statut (CRUD — mise à jour).</p>
              </div>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Nom <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  placeholder="Ex. RH, Commercial"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Slug <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData({ ...formData, slug: e.target.value.toLowerCase().trim().replace(/\s+/g, '-') })
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  placeholder="ex. rh"
                  disabled={!!editingDept}
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Ordre d&apos;affichage</label>
                  <input
                    type="number"
                    min={0}
                    value={formData.sequence}
                    onChange={(e) => setFormData({ ...formData, sequence: parseInt(e.target.value, 10) || 0 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-900 shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                {editingDept && (
                  <div className="flex items-end pb-1">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={formData.isActive}
                        onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm font-medium text-slate-700">Département actif</span>
                    </label>
                  </div>
                )}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Modules autorisés (au moins un)
                </label>
                <p className="mb-2 text-xs text-amber-800">Cochez ou décochez librement les modules : au moins un module doit rester actif.</p>
                <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:grid-cols-2">
                  {ALL_MODULE_NAMES.map((slug) => (
                    <label key={slug} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-2 py-1.5 shadow-sm">
                      <input
                        type="checkbox"
                        checked={formData.moduleSlugs.includes(slug)}
                        onChange={() => toggleModuleSlug(slug)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-sm text-slate-700">{moduleDisplayNames[slug] ?? slug}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingDept(null);
                  resetForm();
                }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={editingDept ? handleUpdate : handleCreate}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
              >
                {editingDept ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <ConfirmationModal
          title="Supprimer le département ?"
          message="Les affectations utilisateurs et rôles locaux (superviseur / managers) seront supprimés. Cette action est irréversible."
          onConfirm={() => void handleDeleteConfirm()}
          onCancel={() => !deleteLoading && setDeleteConfirm(null)}
          isLoading={deleteLoading}
          confirmLabel="Supprimer"
          cancelLabel="Annuler"
        />
      )}

      {detailDept && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lecture seule</p>
                <h3 className="text-lg font-bold text-slate-900">{detailDept.name}</h3>
                <p className="font-mono text-xs text-slate-500">{detailDept.slug}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailDept(null)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                aria-label="Fermer"
              >
                <i className="fas fa-times" />
              </button>
            </div>
            <div className="space-y-3 p-5 text-sm text-slate-700">
              <div className="flex flex-wrap gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    detailDept.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {detailDept.isActive ? 'Actif' : 'Inactif'}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                  Ordre {detailDept.sequence ?? 0}
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Membres</p>
                <p className="mt-0.5">{memberCountByDeptId[detailDept.id] ?? 0} personne(s) rattachée(s)</p>
                {rosterIssueByDeptId[detailDept.id] == null ? (
                  <p className="mt-1 text-xs text-emerald-700">Équipe conforme (superviseur + manager(s)).</p>
                ) : (
                  <p className="mt-1 text-xs text-amber-800">{rosterIssueByDeptId[detailDept.id]}</p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">Modules ({detailDept.moduleSlugs?.length ?? 0})</p>
                <ul className="mt-1 list-inside list-disc text-xs text-slate-600">
                  {(detailDept.moduleSlugs ?? []).length === 0 ? (
                    <li>—</li>
                  ) : (
                    (detailDept.moduleSlugs ?? []).map((s) => (
                      <li key={s}>{moduleDisplayNames[s] || s}</li>
                    ))
                  )}
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
              {canWriteModule && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailDept(null);
                      void openMembersModal(detailDept);
                    }}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    <i className="fas fa-users mr-2" />
                    Équipe
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDetailDept(null);
                      openEditModal(detailDept);
                    }}
                    className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                  >
                    <i className="fas fa-pen mr-2" />
                    Modifier
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setDetailDept(null)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {membersModalDept && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 className="text-base font-bold text-slate-900">Équipe — {membersModalDept.name}</h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Cochez au moins <strong>deux</strong> comptes de l’organisation. Désignez <strong>exactement un superviseur</strong> (bouton radio) et{' '}
                <strong>au moins un manager</strong> (cases à cocher). Le superviseur ne peut pas être manager. Sans affectation, l’utilisateur ne reçoit pas les modules de ce département.
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {membersLoading ? (
                <p className="text-sm text-slate-500">Chargement…</p>
              ) : (
                <ul className="max-h-[50vh] space-y-2 overflow-y-auto">
                  {orgProfileOptions.map((o) => {
                    const checked = memberSelection.includes(o.userId);
                    const inDept = checked;
                    return (
                      <li key={o.userId} className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm">
                        <div className="flex flex-wrap items-center gap-2 gap-y-2">
                          <label className="flex items-center gap-2 text-sm cursor-pointer min-w-0 flex-1">
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-emerald-600 shrink-0"
                              checked={checked}
                              onChange={() => {
                                setMemberSelection((prev) => {
                                  if (checked) {
                                    const next = prev.filter((id) => id !== o.userId);
                                    if (supervisorUserId === o.userId) setSupervisorUserId('');
                                    setManagerUserIds((m) => m.filter((id) => id !== o.userId));
                                    return next;
                                  }
                                  return [...prev, o.userId];
                                });
                              }}
                            />
                            <span className="truncate font-medium text-slate-900">{o.label}</span>
                            <span className="shrink-0 font-mono text-xs text-slate-400">{o.userId.slice(0, 8)}…</span>
                          </label>
                          <label
                            className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${
                              inDept ? 'cursor-pointer text-slate-800' : 'cursor-not-allowed text-slate-400'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`dept-supervisor-${membersModalDept.id}`}
                              className="text-emerald-600 border-gray-300"
                              checked={supervisorUserId === o.userId}
                              disabled={!inDept}
                              onChange={() => {
                                setSupervisorUserId(o.userId);
                                setManagerUserIds((m) => m.filter((id) => id !== o.userId));
                              }}
                            />
                            Superviseur
                          </label>
                          <label
                            className={`flex items-center gap-1.5 text-xs whitespace-nowrap ${
                              inDept && o.userId !== supervisorUserId
                                ? 'cursor-pointer text-slate-800'
                                : 'cursor-not-allowed text-slate-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="rounded border-gray-300 text-slate-700"
                              checked={managerUserIds.includes(o.userId)}
                              disabled={!inDept || o.userId === supervisorUserId}
                              onChange={() => {
                                setManagerUserIds((prev) =>
                                  prev.includes(o.userId)
                                    ? prev.filter((id) => id !== o.userId)
                                    : [...prev, o.userId],
                                );
                              }}
                            />
                            Manager
                          </label>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
              <button
                type="button"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                onClick={() => setMembersModalDept(null)}
                disabled={membersSaving}
              >
                Annuler
              </button>
              <button
                type="button"
                className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                onClick={() => void saveMembersModal()}
                disabled={membersSaving || membersLoading}
              >
                {membersSaving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DepartmentManagement;
