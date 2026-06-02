import React, { useState, useMemo, useEffect } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { User, Role, Department, Poste, SENEGEL_RESERVED_ROLES, roleRequiresApprovalWhenCreatedByAdmin, ROLES_ADMIN_CREATE_ACTIVE_DIRECTLY } from '../types';
import OrganizationService from '../services/organizationService';
import DataAdapter from '../services/dataAdapter';
import UserModulePermissions from './UserModulePermissions';
import UserProfileEdit from './UserProfileEdit';
import DepartmentManagement from './DepartmentManagement';
import DepartmentService from '../services/departmentService';
import PostesManagement from './PostesManagement';
import ConfirmationModal from './common/ConfirmationModal';
import { RealtimeService } from '../services/realtimeService';
import { supabase } from '../services/supabaseService';
import AccessDenied from './common/AccessDenied';
import { DataService } from '../services/dataService';
import AuthService from '../services/authService';
import { getPrimaryOrganizationId, isSingleOrganizationTenantMode } from '../constants/platformTenant';
import { listPostes } from '../services/postesService';

const UserEditModal: React.FC<{
    user: User;
    onClose: () => void;
    onSave: (userId: number, newRole: Role) => void;
    isLoading?: boolean;
    allUsers?: User[];
    currentUserId?: string;
    canAssignReservedRoles: boolean;
    /** Organisation de l'admin (repli si l'utilisateur est rattaché à une org sans pilier). */
    adminOrgId?: string;
}> = ({ user, onClose, onSave, isLoading = false, allUsers = [], currentUserId, canAssignReservedRoles, adminOrgId = '' }) => {
    const { t } = useLocalization();
    const [selectedRole, setSelectedRole] = useState<Role>(user.role);
    const PROTECTED_ROLES: Role[] = ['super_administrator', 'administrator', 'manager'];

    // (Ré)affectation du département (pilier) depuis la fiche.
    const [departmentChoices, setDepartmentChoices] = useState<Department[]>([]);
    const [selectedDeptId, setSelectedDeptId] = useState<string>('');
    const [initialDeptId, setInitialDeptId] = useState<string>('');
    const [deptSaving, setDeptSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const orgId = String(user.organizationId || adminOrgId || '');
        (async () => {
            const userKey = String(user.id || '');
            const [orgDepts, fallbackDepts, links] = await Promise.all([
                orgId ? DepartmentService.getDepartmentsByOrganizationId(orgId) : Promise.resolve([]),
                adminOrgId && adminOrgId !== orgId
                    ? DepartmentService.getDepartmentsByOrganizationId(adminOrgId)
                    : Promise.resolve([]),
                userKey ? DepartmentService.getUserDepartmentLinks(userKey) : Promise.resolve([]),
            ]);
            if (cancelled) return;
            const list = (orgDepts.length ? orgDepts : fallbackDepts).filter((d) => d.isActive !== false);
            setDepartmentChoices(list);
            const current = links[0]?.departmentId ? String(links[0].departmentId) : '';
            setInitialDeptId(current);
            setSelectedDeptId(current);
        })();
        return () => {
            cancelled = true;
        };
    }, [user.id, user.organizationId, adminOrgId]);
    
    // Vérifier si l'utilisateur actuel est le dernier Super Admin
    const isLastSuperAdmin = user.role === 'super_administrator' && 
        allUsers.filter(u => u.role === 'super_administrator').length === 1;
    
    // Vérifier si on change un Super Admin vers un rôle non-protégé
    const isChangingFromAdminToNonAdmin = PROTECTED_ROLES.includes(user.role) && !PROTECTED_ROLES.includes(selectedRole);
    
    // Vérifier si c'est l'utilisateur actuellement connecté qui change de rôle
    const isChangingCurrentUser = currentUserId && String(user.id) === String(currentUserId);
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        // Protection : Ne pas permettre de retirer le dernier Super Admin
        if (isLastSuperAdmin && selectedRole !== 'super_administrator') {
            alert('Impossible de changer le rôle du dernier Super Administrateur. Il doit rester Super Admin pour maintenir la sécurité de la plateforme.');
            return;
        }
        
        // Protection : Avertir si on retire le rôle d'admin à un utilisateur
        if (isChangingFromAdminToNonAdmin) {
            const confirmed = window.confirm(
                `Attention ! Vous êtes sur le point de retirer le rôle d'administration à "${user.name}". ` +
                `Cette action supprimera son accès au Management Ecosysteia. ` +
                `Êtes-vous sûr de vouloir continuer ?`
            );
            if (!confirmed) return;
        }
        
        // Avertir si c'est l'utilisateur actuellement connecté qui change de rôle
        if (isChangingCurrentUser) {
            const confirmed = window.confirm(
                `Attention ! Vous modifiez votre propre rôle. ` +
                `Cette action pourrait affecter vos accès. ` +
                `Voulez-vous continuer ?`
            );
            if (!confirmed) return;
        }

        // (Ré)affecter le département (pilier) si modifié, avant la mise à jour du rôle.
        if (selectedDeptId && selectedDeptId !== initialDeptId && user.id) {
            setDeptSaving(true);
            const ok = await DepartmentService.setUserDepartments(String(user.id), [selectedDeptId]);
            setDeptSaving(false);
            if (!ok) {
                alert(
                    "L'affectation du département a échoué (vérifiez vos droits administrateur / RLS sur user_departments). Le rôle n'a pas été modifié.",
                );
                return;
            }
            setInitialDeptId(selectedDeptId);
        }

        onSave(user.id, selectedRole);
    }
    
    return (
        <div translate="no" className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <form onSubmit={handleSubmit}>
                    <div className="p-6 border-b">
                        <h2 className="text-xl font-bold">{t('assign_role')} pour {user.name}</h2>
                    </div>
                    <div className="p-6">
                        <label htmlFor="role-select" className="block text-sm font-medium text-gray-700">{t('user_role')}</label>
                        <select
                            id="role-select"
                            value={selectedRole}
                            onChange={e => setSelectedRole(e.target.value as Role)}
                            disabled={isLoading}
                            className={`mt-1 block w-full p-2 border border-gray-300 rounded-md ${isLoading ? 'opacity-50 cursor-not-allowed bg-gray-100' : ''}`}
                        >
                            <optgroup label={t('youth')}>
                                <option value="student">{t('student')}</option>
                                <option value="alumni">{t('alumni')}</option>
                            </optgroup>
                            <optgroup label={t('entrepreneur_category')}>
                                <option value="entrepreneur">{t('entrepreneur')}</option>
                                <option value="employer">{t('employer')}</option>
                                <option value="implementer">{t('implementer')}</option>
                                <option value="funder">{t('funder')}</option>
                            </optgroup>
                            <optgroup label={t('contributor_category')}>
                                <option value="trainer">{t('trainer')}</option>
                                <option value="coach">{t('coach')}</option>
                                <option value="facilitator">{t('facilitator')}</option>
                                <option value="mentor">{t('mentor')}</option>
                                <option value="partner_facilitator">{t('partner_facilitator')}</option>
                                <option value="publisher">{t('publisher')}</option>
                                <option value="editor">{t('editor')}</option>
                                <option value="producer">{t('producer')}</option>
                                <option value="artist">{t('artist')}</option>
                            </optgroup>
                            <optgroup label={t('hr_staff_category')}>
                                <option value="hr_business_partner">{t('hr_business_partner')}</option>
                                <option value="hr_officer">{t('hr_officer')}</option>
                                <option value="recruiter">{t('recruiter')}</option>
                                <option value="payroll_specialist">{t('payroll_specialist')}</option>
                                <option value="team_lead">{t('team_lead')}</option>
                            </optgroup>
                            <optgroup label={t('staff_category')}>
                                <option value="intern" disabled={!canAssignReservedRoles}>{`${t('intern')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}</option>
                                <option value="supervisor" disabled={!canAssignReservedRoles}>{`${t('supervisor')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}</option>
                                <option value="manager" disabled={!canAssignReservedRoles}>{`${t('manager')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}</option>
                                <option value="administrator" disabled={!canAssignReservedRoles}>{`${t('administrator')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}</option>
                            </optgroup>
                            <optgroup label={t('super_admin_category')}>
                                <option value="super_administrator" disabled={!canAssignReservedRoles}>{`${t('super_administrator')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}</option>
                            </optgroup>
                        </select>
                        
                        {isLastSuperAdmin && (
                            <p className="mt-2 text-sm text-yellow-600">
                                <i className="fas fa-exclamation-triangle mr-1"></i>
                                Cet utilisateur est le dernier Super Administrateur. Il doit rester Super Admin.
                            </p>
                        )}
                        {!canAssignReservedRoles && SENEGEL_RESERVED_ROLES.includes(selectedRole) && (
                            <p className="mt-2 text-sm text-red-600">
                                <i className="fas fa-lock mr-1"></i>
                                Ce rôle est réservé à SENEGEL et ne peut être attribué que par un administrateur SENEGEL.
                            </p>
                        )}
                        
                        {isChangingFromAdminToNonAdmin && selectedRole !== user.role && (
                            <p className="mt-2 text-sm text-orange-600">
                                <i className="fas fa-exclamation-triangle mr-1"></i>
                                Attention : Cet utilisateur perdra son accès au Management Ecosysteia.
                            </p>
                        )}
                        
                        {isChangingCurrentUser && selectedRole !== user.role && (
                            <p className="mt-2 text-sm text-blue-600">
                                <i className="fas fa-info-circle mr-1"></i>
                                Vous modifiez votre propre rôle. Cela affectera vos accès.
                            </p>
                        )}

                        <div className="mt-5">
                            <label htmlFor="dept-select" className="block text-sm font-medium text-gray-700">
                                Département (pilier)
                            </label>
                            {departmentChoices.length === 0 ? (
                                <p className="mt-1 text-xs text-amber-700">
                                    Aucun pilier disponible. Créez-en un dans l’onglet Départements.
                                </p>
                            ) : (
                                <select
                                    id="dept-select"
                                    value={selectedDeptId}
                                    onChange={(e) => setSelectedDeptId(e.target.value)}
                                    disabled={isLoading || deptSaving}
                                    className="mt-1 block w-full p-2 border border-gray-300 rounded-md"
                                >
                                    <option value="">— Aucun pilier —</option>
                                    {departmentChoices.map((d) => (
                                        <option key={d.id} value={d.id}>
                                            {d.name}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <p className="mt-1 text-xs text-gray-500">
                                Réaffecte le pilier de l’utilisateur. La modification est enregistrée à l’enregistrement.
                            </p>
                        </div>
                    </div>
                    <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                        <button 
                            type="button" 
                            onClick={onClose} 
                            disabled={isLoading}
                            className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {t('cancel')}
                        </button>
                        <button 
                            type="submit" 
                            disabled={isLoading || deptSaving || (isLastSuperAdmin && selectedRole !== 'super_administrator')}
                            className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center"
                        >
                            {(isLoading || deptSaving) && <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>}
                            {isLoading || deptSaving ? 'Enregistrement...' : t('save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const CreateUserModal: React.FC<{
    open: boolean;
    onClose: () => void;
    showToast: (message: string, type?: 'success' | 'error') => void;
    canWriteModule: boolean;
    currentRole: Role | undefined;
    currentOrganizationId: string | null | undefined;
    canAssignReservedRoles: boolean;
    /** Profil (UUID `profiles.id`) de l'administrateur courant — validateur de l'activation. */
    approverProfileId: string;
    onRefreshUsers?: () => Promise<void>;
    onLocalUsersReplace: (users: User[]) => void;
}> = ({
    open,
    onClose,
    showToast,
    canWriteModule,
    currentRole,
    currentOrganizationId,
    canAssignReservedRoles,
    approverProfileId,
    onRefreshUsers,
    onLocalUsersReplace,
}) => {
    const { t } = useLocalization();
    const [email, setEmail] = useState('');
    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [role, setRole] = useState<Role>('student');
    const [orgId, setOrgId] = useState<string>('');
    const [orgChoices, setOrgChoices] = useState<{ id: string; name: string }[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [creationSuccess, setCreationSuccess] = useState<{ password: string; email: string; flow: 'approval' | 'direct' } | null>(null);
    const [posteId, setPosteId] = useState<string>('');
    const [posteChoices, setPosteChoices] = useState<Poste[]>([]);
    const [departmentId, setDepartmentId] = useState<string>('');
    const [departmentChoices, setDepartmentChoices] = useState<Department[]>([]);

    const singleOrgMode = isSingleOrganizationTenantMode();
    const primaryOrgId = getPrimaryOrganizationId();

    const orgForPostes = singleOrgMode
        ? primaryOrgId
        : currentRole === 'super_administrator'
          ? String(orgId || currentOrganizationId || primaryOrgId)
          : currentOrganizationId
            ? String(currentOrganizationId)
            : primaryOrgId;

    useEffect(() => {
        if (!open) return;
        setEmail('');
        setFullName('');
        setPhone('');
        setRole('student');
        setPosteId('');
        setDepartmentId('');
        setSubmitting(false);
        setCreationSuccess(null);
        if (singleOrgMode) {
            setOrgId(primaryOrgId);
            setOrgChoices([]);
            return undefined;
        }
        if (currentRole === 'super_administrator') {
            let cancelled = false;
            OrganizationService.getAllOrganizations().then((orgs) => {
                if (cancelled) return;
                setOrgChoices(orgs.map((o) => ({ id: String(o.id), name: o.name })));
                const fallback = currentOrganizationId || orgs[0]?.id;
                if (fallback) setOrgId(String(fallback));
            });
            return () => {
                cancelled = true;
            };
        }
        if (currentOrganizationId) setOrgId(String(currentOrganizationId));
        return undefined;
    }, [open, currentRole, currentOrganizationId, singleOrgMode, primaryOrgId]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        void listPostes(orgForPostes).then((list) => {
            if (!cancelled) setPosteChoices(list);
        });
        return () => {
            cancelled = true;
        };
    }, [open, orgForPostes]);

    // Charger les piliers (départements) de l'organisation cible afin de pouvoir
    // affecter le collaborateur dès la création (cohérent avec l'approbation).
    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setDepartmentId('');
        void DepartmentService.getDepartmentsByOrganizationId(orgForPostes).then((list) => {
            if (!cancelled) setDepartmentChoices(list.filter((d) => d.isActive !== false));
        });
        return () => {
            cancelled = true;
        };
    }, [open, orgForPostes]);

    if (!open) return null;

    const targetOrgId = singleOrgMode
        ? primaryOrgId
        : currentRole === 'super_administrator'
          ? String(orgId || currentOrganizationId || primaryOrgId)
          : currentOrganizationId
            ? String(currentOrganizationId)
            : AuthService.getDefaultOrganizationId();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canWriteModule) return;
        const em = email.trim().toLowerCase();
        const name = fullName.trim();
        if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
            showToast('Adresse e-mail invalide.', 'error');
            return;
        }
        if (!name) {
            showToast('Le nom complet est obligatoire.', 'error');
            return;
        }
        if (role === 'super_administrator' && !canAssignReservedRoles) {
            showToast('Ce rôle est réservé SENEGEL.', 'error');
            return;
        }
        if (posteChoices.length > 0 && !posteId.trim()) {
            showToast('Veuillez sélectionner un poste pour ce collaborateur.', 'error');
            return;
        }
        if (departmentChoices.length > 0 && !departmentId.trim()) {
            showToast('Veuillez sélectionner un département (pilier) pour ce collaborateur.', 'error');
            return;
        }
        if (!approverProfileId) {
            showToast('Impossible de déterminer l’administrateur validateur. Reconnectez-vous puis réessayez.', 'error');
            return;
        }
        const needsApproval = roleRequiresApprovalWhenCreatedByAdmin(role);
        const normalizedRole = AuthService.normalizeRoleForStorage(role);
        const selectedPosteName = posteChoices.find((p) => String(p.id) === posteId.trim())?.name || null;
        const chosenDepartmentId = departmentId.trim() || null;
        setSubmitting(true);
        try {
            // 1. Créer la demande/profil (pending, sans compte auth) via la RPC SECURITY DEFINER
            //    `request_access` : aucun client Supabase éphémère (plus d'avertissement
            //    « Multiple GoTrueClient »), validation e-mail/pilier côté serveur et idempotence.
            const req = await AuthService.requestAccess({
                full_name: name,
                email: em,
                phone_number: phone.trim() || undefined,
                organization_id: targetOrgId,
                requested_department_id: chosenDepartmentId,
                requested_poste: selectedPosteName,
            });
            if (req.error) throw req.error instanceof Error ? req.error : new Error(String(req.error));
            const newProfileId = req.profileId;
            if (!newProfileId) throw new Error('Création du profil impossible (identifiant manquant).');

            // 2. Forcer le rôle choisi (la RPC enregistre un rôle minimal par défaut).
            const { error: roleErr } = await supabase
                .from('profiles')
                .update({ pending_role: normalizedRole, updated_at: new Date().toISOString() })
                .eq('id', newProfileId);
            if (roleErr) throw roleErr;

            // 3. Provisionner le compte auth (Edge Function service_role) : mot de passe par défaut
            //    généré + e-mail confirmé + stockage dans `user_provisional_passwords`.
            const provisioning = await DataService.provisionAccessAccount(newProfileId);
            const password = provisioning.password;
            if (!password) throw new Error('Le serveur n’a pas renvoyé de mot de passe.');

            // 4. Rôle à création directe : activer immédiatement avec le rôle + le pilier choisis
            //    (l'organisation du profil est alignée sur celle du pilier). Sinon le profil reste
            //    en attente et apparaît dans l'onglet « Demandes d'accès » pour validation.
            if (!needsApproval) {
                const res = await DataService.approveProfileRole({
                    profileId: newProfileId,
                    approverId: approverProfileId,
                    departmentId: chosenDepartmentId,
                });
                if (res.error) throw res.error;
                if ((res as { departmentAssignmentFailed?: boolean }).departmentAssignmentFailed) {
                    showToast(
                        'Compte créé, mais le rattachement au pilier a échoué (RLS). Réaffectez le département depuis la fiche de l’utilisateur.',
                        'error',
                    );
                }
            }

            if (onRefreshUsers) await onRefreshUsers();
            else {
                const list = await DataAdapter.getUsers();
                onLocalUsersReplace(list);
            }
            setCreationSuccess({ password, email: em, flow: needsApproval ? 'approval' : 'direct' });
        } catch (err: any) {
            console.error('Création utilisateur:', err);
            showToast(err?.message || 'Erreur lors de la création du compte.', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const finishSuccessAndClose = () => {
        setCreationSuccess(null);
        onClose();
    };

    if (creationSuccess) {
        return (
            <div translate="no" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
                <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl">
                    <div className="border-b border-slate-200 p-6">
                        <h2 className="text-xl font-bold text-slate-900">Compte créé</h2>
                        <p className="mt-2 text-sm text-slate-600">
                            Mot de passe provisoire pour <strong className="text-slate-800">{creationSuccess.email}</strong>. Transmettez-le à la
                            personne ; il reste consultable et régénérable depuis la liste tant qu’il n’a pas été modifié.
                        </p>
                        {creationSuccess.flow === 'approval' ? (
                            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                                Le rôle demandé est soumis à <strong>approbation</strong> : le profil reste en attente jusqu’à validation par un
                                administrateur (onglet approbations).
                            </p>
                        ) : (
                            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                                Le compte est <strong>actif</strong> avec le rôle et le poste choisis (pas d’étape d’approbation pour ce type de
                                profil).
                            </p>
                        )}
                    </div>
                    <div className="space-y-4 p-6">
                        <div>
                            <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Mot de passe provisoire</label>
                            <div className="mt-1 flex gap-2">
                                <input
                                    readOnly
                                    value={creationSuccess.password}
                                    className="min-w-0 flex-1 rounded-md border border-slate-300 bg-slate-50 p-2 font-mono text-sm text-slate-900"
                                    onFocus={(e) => e.target.select()}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        void navigator.clipboard.writeText(creationSuccess.password);
                                        showToast('Mot de passe copié dans le presse-papiers.', 'success');
                                    }}
                                    className="shrink-0 rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-900"
                                >
                                    Copier
                                </button>
                            </div>
                        </div>
                        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                            Après la première connexion, la personne doit ouvrir <strong>Paramètres</strong> → <strong>Profil</strong> et
                            utiliser la section <strong>Mot de passe du compte</strong> pour définir un mot de passe définitif.
                        </p>
                    </div>
                    <div className="flex justify-end border-t border-slate-200 bg-slate-50 p-4">
                        <button
                            type="button"
                            onClick={finishSuccessAndClose}
                            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                        >
                            Fermer
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div translate="no" className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-2xl">
                <form onSubmit={handleSubmit}>
                    <div className="border-b border-slate-200 p-6">
                        <h2 className="text-xl font-bold text-slate-900">Nouvel utilisateur</h2>
                        <p className="mt-1 text-sm text-slate-600">
                            Choisissez l’organisation (si applicable), le <strong>rôle</strong> et le <strong>poste</strong>. Les rôles
                            management, encadrement, formation (formateur, coach, etc.) et RH passent en <strong>approbation</strong> ; les
                            profils standard (apprenant, entrepreneur, créatif, …) sont créés <strong>actifs</strong> tout de suite. Un mot de
                            passe provisoire est affiché une fois après la création.
                        </p>
                    </div>
                    <div className="space-y-4 p-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700">E-mail (connexion)</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                                autoComplete="off"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Nom complet</label>
                            <input
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                required
                                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Téléphone (optionnel)</label>
                            <input
                                value={phone}
                                onChange={(e) => setPhone(e.target.value)}
                                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                            />
                        </div>
                        {currentRole === 'super_administrator' && !singleOrgMode && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700">Organisation</label>
                                <select
                                    value={orgId}
                                    onChange={(e) => setOrgId(e.target.value)}
                                    className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                                >
                                    {orgChoices.map((o) => (
                                        <option key={o.id} value={o.id}>
                                            {o.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {singleOrgMode && (
                            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                                Mode organisation unique : le compte est rattaché à l’organisation principale de la plateforme.
                            </p>
                        )}
                        <div
                            translate="no"
                            className={`rounded-md border p-3 text-xs ${
                                roleRequiresApprovalWhenCreatedByAdmin(role)
                                    ? 'border-amber-200 bg-amber-50 text-amber-950'
                                    : 'border-emerald-200 bg-emerald-50 text-emerald-950'
                            }`}
                        >
                            {roleRequiresApprovalWhenCreatedByAdmin(role) ? (
                                <span key="role-approval-required">
                                    <strong>Approbation requise</strong> pour ce rôle : le compte sera créé en attente jusqu’à validation dans
                                    l’onglet approbations.
                                </span>
                            ) : (
                                <span key="role-direct-create">
                                    <strong>Création directe</strong> : ce rôle fait partie des profils standard (
                                    {ROLES_ADMIN_CREATE_ACTIVE_DIRECTLY.length} types) — compte actif immédiatement après création.
                                </span>
                            )}
                        </div>
                        <div>
                            <label htmlFor="new-user-role" className="block text-sm font-medium text-slate-700">
                                Rôle
                            </label>
                            <select
                                id="new-user-role"
                                value={role}
                                onChange={(e) => setRole(e.target.value as Role)}
                                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                            >
                                <optgroup label={t('youth')}>
                                    <option value="student">{t('student')}</option>
                                    <option value="alumni">{t('alumni')}</option>
                                </optgroup>
                                <optgroup label={t('entrepreneur_category')}>
                                    <option value="entrepreneur">{t('entrepreneur')}</option>
                                    <option value="employer">{t('employer')}</option>
                                    <option value="implementer">{t('implementer')}</option>
                                    <option value="funder">{t('funder')}</option>
                                </optgroup>
                                <optgroup label={t('contributor_category')}>
                                    <option value="trainer">{t('trainer')}</option>
                                    <option value="coach">{t('coach')}</option>
                                    <option value="facilitator">{t('facilitator')}</option>
                                    <option value="mentor">{t('mentor')}</option>
                                    <option value="partner_facilitator">{t('partner_facilitator')}</option>
                                    <option value="publisher">{t('publisher')}</option>
                                    <option value="editor">{t('editor')}</option>
                                    <option value="producer">{t('producer')}</option>
                                    <option value="artist">{t('artist')}</option>
                                </optgroup>
                                <optgroup label={t('hr_staff_category')}>
                                    <option value="hr_business_partner">{t('hr_business_partner')}</option>
                                    <option value="hr_officer">{t('hr_officer')}</option>
                                    <option value="recruiter">{t('recruiter')}</option>
                                    <option value="payroll_specialist">{t('payroll_specialist')}</option>
                                    <option value="team_lead">{t('team_lead')}</option>
                                </optgroup>
                                <optgroup label={t('staff_category')}>
                                    <option value="intern" disabled={!canAssignReservedRoles}>
                                        {`${t('intern')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}
                                    </option>
                                    <option value="supervisor" disabled={!canAssignReservedRoles}>
                                        {`${t('supervisor')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}
                                    </option>
                                    <option value="manager" disabled={!canAssignReservedRoles}>
                                        {`${t('manager')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}
                                    </option>
                                    <option value="administrator" disabled={!canAssignReservedRoles}>
                                        {`${t('administrator')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}
                                    </option>
                                </optgroup>
                                <optgroup label={t('super_admin_category')}>
                                    <option value="super_administrator" disabled={!canAssignReservedRoles}>
                                        {`${t('super_administrator')}${!canAssignReservedRoles ? ' (SENEGEL)' : ''}`}
                                    </option>
                                </optgroup>
                            </select>
                        </div>
                        <div>
                            <label htmlFor="new-user-poste" className="block text-sm font-medium text-slate-700">
                                Poste {posteChoices.length > 0 ? <span className="text-red-500">*</span> : <span className="text-slate-400">(optionnel)</span>}
                            </label>
                            <select
                                id="new-user-poste"
                                value={posteId}
                                onChange={(e) => setPosteId(e.target.value)}
                                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                                disabled={posteChoices.length === 0}
                            >
                                <option value="">{posteChoices.length === 0 ? '— Aucun poste pour cette org —' : '— Sélectionner un poste —'}</option>
                                {posteChoices.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
                                    </option>
                                ))}
                            </select>
                            {posteChoices.length === 0 && (
                                <p className="mt-1 text-xs text-slate-500">
                                    Ajoutez des postes dans <strong>Paramètres → Postes</strong> pour les imposer à la création.
                                </p>
                            )}
                        </div>
                        <div>
                            <label htmlFor="new-user-department" className="block text-sm font-medium text-slate-700">
                                Département (pilier){' '}
                                {departmentChoices.length > 0 ? (
                                    <span className="text-red-500">*</span>
                                ) : (
                                    <span className="text-slate-400">(optionnel)</span>
                                )}
                            </label>
                            <select
                                id="new-user-department"
                                value={departmentId}
                                onChange={(e) => setDepartmentId(e.target.value)}
                                className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
                                disabled={departmentChoices.length === 0}
                            >
                                <option value="">
                                    {departmentChoices.length === 0
                                        ? '— Aucun pilier pour cette organisation —'
                                        : '— Sélectionner un pilier —'}
                                </option>
                                {departmentChoices.map((d) => (
                                    <option key={d.id} value={d.id}>
                                        {d.name}
                                    </option>
                                ))}
                            </select>
                            {departmentChoices.length === 0 && (
                                <p className="mt-1 text-xs text-slate-500">
                                    Créez des piliers dans <strong>Paramètres → Départements</strong> pour les affecter à la création.
                                </p>
                            )}
                        </div>
                        <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                            Un <strong>mot de passe provisoire</strong> est généré et affiché une fois après la création. Il reste consultable
                            et régénérable par un administrateur depuis la liste tant que la personne ne l’a pas modifié dans Paramètres → Profil.
                        </p>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 p-4">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-300 disabled:opacity-50"
                        >
                            {t('cancel')}
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || !canWriteModule}
                            className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                        >
                            {submitting && <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                            Créer le compte
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

interface UserManagementProps {
    users: User[];
    onUpdateUser?: (user: User) => void;
    onToggleActive?: (userId: string | number, isActive: boolean) => void;
    onDeleteUser?: (userId: string | number) => Promise<void>;
    /** Mode Paramètres : layout dense, sans page pleine écran */
    embedded?: boolean;
    /** Après création utilisateur : recharger la liste côté parent (recommandé en mode Paramètres). */
    onRefreshUsers?: () => Promise<void>;
}

const UserManagement: React.FC<UserManagementProps> = ({ users, onUpdateUser, onToggleActive, onDeleteUser, embedded = false, onRefreshUsers }) => {
    const { t } = useLocalization();
    const { user: currentUser, profile: authProfile } = useAuth();
    const { canAccessModule, hasPermission } = useModulePermissions();
    const [managedUsers, setManagedUsers] = useState<User[]>(users);
    const [isModalOpen, setModalOpen] = useState(false);
    const [selectedUser, setSelectedUser] = useState<User | null>(null);
    const [isProfileModalOpen, setProfileModalOpen] = useState(false);
    const [profileUser, setProfileUser] = useState<User | null>(null);
    /** Cible figée à l’ouverture du modal (évite find() sur liste mutée pendant la suppression async). */
    const [deleteTarget, setDeleteTarget] = useState<{ id: string | number; name: string; email: string } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [isUpdatingRole, setIsUpdatingRole] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [roleFilter, setRoleFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all'); // all, active, inactive
    const [activeTab, setActiveTab] = useState<'users' | 'approvals' | 'permissions' | 'departments' | 'postes' | 'super_admin'>('users');
    const [canAssignReservedRoles, setCanAssignReservedRoles] = useState(false);
    const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
    const [processingRequestId, setProcessingRequestId] = useState<string | null>(null);
    const [resettingUserId, setResettingUserId] = useState<string | number | null>(null);
    /** Départements par organisation (demandes multi-org côté super admin). */
    const [departmentsByOrgId, setDepartmentsByOrgId] = useState<Record<string, Department[]>>({});
    /** profileId (UUID profil) → departmentId choisi pour la validation */
    const [approvalDepartmentByProfileId, setApprovalDepartmentByProfileId] = useState<Record<string, string>>({});
    /** Toast de secours si `window.Toast` (global) n’est pas défini */
    const [inlineToast, setInlineToast] = useState<{ message: string; variant: 'success' | 'error' } | null>(null);
    const [createUserOpen, setCreateUserOpen] = useState(false);
    /** Mot de passe à transmettre (approbation, régénération ou consultation). */
    const [provisionedCredentials, setProvisionedCredentials] = useState<{ email: string; password: string; title?: string; note?: string } | null>(null);

    const canReadModule = canAccessModule('user_management');
    const canWriteModule = hasPermission('user_management', 'write');
    const canDeleteModule = hasPermission('user_management', 'delete');

    /** Organisation de l'administrateur courant : c'est elle qui possède les piliers et où la
     *  RLS autorise l'affectation. Sert de repli quand le demandeur est rattaché à une
     *  organisation sans département (ex. doublon historique d'organisation). */
    const adminOrgId = String(authProfile?.organization_id || currentUser?.organizationId || '');

    useEffect(() => {
        setManagedUsers(users);
    }, [users]);

    useEffect(() => {
        if (activeTab !== 'approvals') return;
        let cancelled = false;
        (async () => {
            const orgIds = new Set<string>();
            // Toujours inclure l'organisation de l'admin (propriétaire des piliers) comme repli.
            if (adminOrgId) orgIds.add(adminOrgId);
            managedUsers
                .filter((u) => u.status === 'pending')
                .forEach((u) => {
                    const oid = u.organizationId || authProfile?.organization_id || currentUser?.organizationId;
                    if (oid) orgIds.add(String(oid));
                });
            if (orgIds.size === 0) {
                const fallback = await OrganizationService.getCurrentUserOrganizationId();
                if (fallback) orgIds.add(String(fallback));
            }
            const entries = await Promise.all(
                Array.from(orgIds).map(async (orgId) => {
                    const list = await DepartmentService.getDepartmentsByOrganizationId(orgId);
                    return [orgId, list] as const;
                })
            );
            if (cancelled) return;
            setDepartmentsByOrgId(Object.fromEntries(entries));
        })();
        return () => {
            cancelled = true;
        };
    }, [activeTab, managedUsers, authProfile?.organization_id, currentUser?.organizationId, adminOrgId]);

    // Pré-remplir le pilier (département) demandé par le requérant lors d'une demande d'accès,
    // sans écraser un choix déjà effectué par l'administrateur.
    useEffect(() => {
        if (activeTab !== 'approvals') return;
        setApprovalDepartmentByProfileId((prev) => {
            let changed = false;
            const next = { ...prev };
            managedUsers
                .filter((u) => u.status === 'pending' && u.requestedDepartmentId && u.profileId)
                .forEach((u) => {
                    const profileId = String(u.profileId);
                    if (next[profileId]) return;
                    const orgKey = String(
                        u.organizationId || authProfile?.organization_id || currentUser?.organizationId || ''
                    );
                    const pendingOrgList = orgKey ? departmentsByOrgId[orgKey] || [] : [];
                    const deptList = pendingOrgList.length
                        ? pendingOrgList
                        : adminOrgId
                          ? departmentsByOrgId[adminOrgId] || []
                          : [];
                    const reqId = String(u.requestedDepartmentId);
                    if (deptList.some((d) => String(d.id) === reqId)) {
                        next[profileId] = reqId;
                        changed = true;
                    }
                });
            return changed ? next : prev;
        });
    }, [activeTab, managedUsers, departmentsByOrgId, authProfile?.organization_id, currentUser?.organizationId, adminOrgId]);

    // Déterminer si l'assignation des rôles réservés SENEGEL est autorisée
    useEffect(() => {
        const checkPermission = async () => {
            try {
                const org = await OrganizationService.getCurrentUserOrganization();
                const isSenegel = (org?.slug || '').toLowerCase() === 'senegel' || (org?.name || '').toLowerCase() === 'senegel';
                const isAdmin = currentUser?.role === 'super_administrator';
                setCanAssignReservedRoles(Boolean(isSenegel && isAdmin));
            } catch (e) {
                setCanAssignReservedRoles(false);
            }
        };
        checkPermission();
    }, [currentUser]);
    
    // Rôles protégés contre la suppression (SEULEMENT super_administrator)
    const PROTECTED_ROLES: Role[] = ['super_administrator'];

    // Realtime subscription pour les profils
    useEffect(() => {
        const channel = supabase
            .channel('profiles-changes')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'profiles'
            }, (payload) => {
                console.log('🔄 Changement Realtime profiles:', payload.eventType, payload.new);
                
                // Mettre à jour la liste des utilisateurs
                if (payload.eventType === 'UPDATE' && payload.new) {
                    const updatedProfile = payload.new as any;
                    const userToUpdate = managedUsers.find(u => {
                        // Vérifier si c'est le même utilisateur (user_id ou id)
                        return String(u.id) === String(updatedProfile.user_id) || String(u.id) === String(updatedProfile.id);
                    });
                    
                    if (userToUpdate) {
                        const updatedUser: User = {
                            ...userToUpdate,
                            role: updatedProfile.role as Role,
                            isActive: updatedProfile.is_active ?? true,
                            name: updatedProfile.full_name,
                            fullName: updatedProfile.full_name,
                            email: updatedProfile.email,
                            avatar: updatedProfile.avatar_url || '',
                            phone: updatedProfile.phone_number || '',
                            phoneNumber: updatedProfile.phone_number || '',
                            location: updatedProfile.location || '',
                            skills: updatedProfile.skills || [],
                            bio: updatedProfile.bio || '',
                            lastLogin: updatedProfile.last_login || userToUpdate.lastLogin,
                            createdAt: updatedProfile.created_at || userToUpdate.createdAt,
                            updatedAt: updatedProfile.updated_at || userToUpdate.updatedAt,
                            passwordChanged: updatedProfile.password_changed ?? userToUpdate.passwordChanged ?? false,
                        };
                        if (onUpdateUser) onUpdateUser(updatedUser);
                        else setManagedUsers((prev) => prev.map((u) => (String(u.id) === String(updatedUser.id) ? updatedUser : u)));
                    }
                }
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [managedUsers, onUpdateUser]);

    useEffect(() => {
        if (!inlineToast) return;
        const id = window.setTimeout(() => setInlineToast(null), 9500);
        return () => window.clearTimeout(id);
    }, [inlineToast]);

    // Toggle Component réutilisable
    const Toggle: React.FC<{ checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean; label?: string; compact?: boolean }> = ({
        checked,
        onChange,
        disabled = false,
        label,
        compact = false,
    }) => (
        <button
            type="button"
            onClick={() => !disabled && onChange(!checked)}
            disabled={disabled}
            className={`relative inline-flex items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1 ${
                compact ? 'h-5 w-9' : 'h-6 w-11'
            } ${checked ? 'bg-emerald-600' : 'bg-slate-300'} ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            title={label}
        >
            <span
                className={`inline-block transform rounded-full bg-white transition-transform ${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} ${
                    checked ? (compact ? 'translate-x-4' : 'translate-x-6') : 'translate-x-1'
                }`}
            />
        </button>
    );

    const handleEdit = (userToEdit: User) => {
        if (!canWriteModule) return;
        setSelectedUser(userToEdit);
        setModalOpen(true);
    };
    
    const handleEditProfile = (userToEdit: User) => {
        if (!canWriteModule) return;
        setProfileUser(userToEdit);
        setProfileModalOpen(true);
    };
    
    const handleSaveRole = async (userId: number, newRole: Role) => {
        if (!canWriteModule) return;
        const userToUpdate = managedUsers.find(u => u.id === userId);
        if(!userToUpdate) {
            console.error('❌ Utilisateur non trouvé pour modification rôle');
            return;
        }
        
        console.log('🔄 Modification rôle:', { userId, oldRole: userToUpdate.role, newRole });
        setIsUpdatingRole(true);
        try {
            if (onUpdateUser) {
                await onUpdateUser({...userToUpdate, role: newRole});
            } else {
                const res = await DataService.updateUserRole(String(userId), newRole);
                if (res.error) throw res.error;
                setManagedUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
            }
            console.log('✅ Rôle modifié avec succès');

            setIsUpdatingRole(false);
            setModalOpen(false);
            setSelectedUser(null);

            if (typeof window !== 'undefined' && (window as any).Toast) {
                (window as any).Toast.success(`Rôle modifié avec succès en ${newRole}`);
            }

            // Après démontage du modal : évite les courses DOM (insertBefore) avec le rechargement des permissions
            queueMicrotask(() => {
                window.dispatchEvent(new Event('permissions-reload'));
                console.log('📢 Event permissions-reload déclenché');
            });
        } catch (error) {
            console.error('❌ Erreur modification rôle:', error);
            alert('Erreur lors de la modification du rôle');
            setIsUpdatingRole(false);
        }
    };

    const handleSaveProfile = async (updatedUser: Partial<User>) => {
        if (!canWriteModule) return;
        if (!profileUser) return;
        const userToUpdate = { ...profileUser, ...updatedUser };
        try {
            if (onUpdateUser) {
                await onUpdateUser(userToUpdate);
            } else if (profileUser.id) {
                const { error } = await DataService.updateProfile(String(profileUser.id), {
                    full_name: userToUpdate.name,
                    phone_number: userToUpdate.phoneNumber ?? null,
                    location: userToUpdate.location ?? null,
                    bio: userToUpdate.bio ?? null,
                    skills: userToUpdate.skills ?? [],
                    website: userToUpdate.website ?? null,
                    linkedin_url: userToUpdate.linkedinUrl ?? null,
                    github_url: userToUpdate.githubUrl ?? null,
                });
                if (error) throw error;
                setManagedUsers((prev) => prev.map((u) => (String(u.id) === String(profileUser.id) ? userToUpdate : u)));
            }
            console.log('✅ Profil modifié avec succès');
            
            // Message de succès (utiliser Toast si disponible)
            if (typeof window !== 'undefined' && (window as any).Toast) {
                (window as any).Toast.success('Profil modifié avec succès');
            }
            
            setProfileModalOpen(false);
            setProfileUser(null);
        } catch (error) {
            console.error('❌ Erreur modification profil:', error);
            alert('Erreur lors de la modification du profil');
        }
    };

    const handleToggleActive = async (user: User, newState: boolean) => {
        if (!canWriteModule) return;
        const newActiveState = newState;
        if (onToggleActive) {
            await onToggleActive(user.id, newActiveState);
        } else {
            const res = await DataService.toggleUserActive(user.id, newActiveState);
            if (res.error) throw res.error;
            setManagedUsers((prev) => prev.map((u) => (String(u.id) === String(user.id) ? { ...u, isActive: newActiveState } : u)));
        }
    };

    const handleDelete = async (user: User) => {
        if (!canDeleteModule) return;
        // Vérifier si l'utilisateur a un rôle protégé (SEULEMENT super_administrator)
        if (PROTECTED_ROLES.includes(user.role as Role)) {
            alert(`Impossible de supprimer le rôle Super Administrateur (${user.role}). Ce rôle est protégé pour maintenir la sécurité de la plateforme.`);
            return;
        }
        
        setDeleteTarget({
            id: user.id,
            name: user.name || user.email || 'Utilisateur',
            email: user.email || '',
        });
    };

    const confirmDeleteUser = async () => {
        if (!deleteTarget) return;
        const { id: deleteId, name: userName } = deleteTarget;
        setIsDeleting(true);
        try {
            console.log('🔄 Suppression utilisateur en cours:', { userId: deleteId, userName });
            if (onDeleteUser) {
                await onDeleteUser(deleteId);
            } else {
                const res = await DataService.deleteUser(deleteId);
                if (res?.error) throw res.error;
                setManagedUsers((prev) => prev.filter((u) => String(u.id) !== String(deleteId)));
            }
            console.log('✅ Utilisateur supprimé avec succès');
            if (typeof window !== 'undefined' && (window as any).Toast) {
                (window as any).Toast.success(`${userName} supprimé avec succès`);
            }
        } catch (error: any) {
            console.error('❌ Erreur suppression utilisateur:', error);
            const errorMessage = error?.message || 'Erreur inconnue lors de la suppression';
            alert(`Erreur lors de la suppression de l'utilisateur : ${errorMessage}`);
        } finally {
            setIsDeleting(false);
        }
        // Fermer le portail après la fin du cycle « chargement » pour éviter NotFoundError insertBefore
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setDeleteTarget(null);
            });
        });
    };

    // PB4 : génère (régénère) un mot de passe par défaut pour ce compte via l'Edge Function
    // `admin-reset-password` (service_role). Mécanisme de récupération de mot de passe par l'admin.
    const handleGeneratePassword = async (u: User) => {
        if (!canWriteModule) return;
        const profileId = u.profileId ? String(u.profileId) : '';
        if (!profileId) {
            showToast('Profil introuvable pour cet utilisateur.', 'error');
            return;
        }
        const confirmed = window.confirm(
            `Générer un nouveau mot de passe par défaut pour ${u.name || u.email} ?\n\n` +
            `L’ancien mot de passe sera invalidé. Transmettez ensuite le nouveau mot de passe à la personne, ` +
            `qui pourra le modifier dans Paramètres → Profil.`,
        );
        if (!confirmed) return;
        setResettingUserId(u.id);
        try {
            const { password, email } = await DataService.regenerateUserPassword(profileId);
            setManagedUsers((prev) =>
                prev.map((x) => (String(x.id) === String(u.id) ? { ...x, passwordChanged: false } : x)),
            );
            setProvisionedCredentials({
                email: email || u.email || '',
                password,
                title: 'Mot de passe régénéré',
                note: 'Transmettez ce nouveau mot de passe par défaut. L’utilisateur pourra le modifier dans Paramètres → Profil.',
            });
            showToast(`Nouveau mot de passe généré pour ${u.email}`, 'success');
        } catch (e: any) {
            console.error('Erreur génération mot de passe:', e);
            showToast(e?.message || 'Erreur lors de la génération du mot de passe', 'error');
        } finally {
            setResettingUserId(null);
        }
    };

    // PB4 : consulte le mot de passe par défaut stocké (lecture admin via RLS), tant que
    // l'utilisateur ne l'a pas personnalisé.
    const handleViewProvisionalPassword = async (u: User) => {
        if (!canWriteModule) return;
        const profileId = u.profileId ? String(u.profileId) : '';
        if (!profileId) {
            showToast('Profil introuvable pour cet utilisateur.', 'error');
            return;
        }
        setResettingUserId(u.id);
        try {
            const pwd = await DataService.getProvisionalPassword(profileId);
            if (!pwd) {
                showToast(
                    'Aucun mot de passe par défaut disponible (déjà personnalisé par l’utilisateur ou compte non provisionné). Utilisez « Générer ».',
                    'error',
                );
                return;
            }
            setProvisionedCredentials({
                email: u.email || '',
                password: pwd,
                title: 'Mot de passe par défaut',
                note: 'Mot de passe par défaut actuel (non encore modifié par l’utilisateur). Transmettez-le de façon sécurisée.',
            });
        } catch (e: any) {
            console.error('Erreur consultation mot de passe:', e);
            showToast(e?.message || 'Erreur lors de la consultation du mot de passe', 'error');
        } finally {
            setResettingUserId(null);
        }
    };

    // Filtres des utilisateurs
    const filteredUsers = useMemo(() => {
        return managedUsers.filter(user => {
            const matchesSearch = searchQuery === '' ||
                user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                user.email?.toLowerCase().includes(searchQuery.toLowerCase());
            
            const matchesRole = roleFilter === 'all' || user.role === roleFilter;
            
            const matchesStatus = statusFilter === 'all' || 
                (statusFilter === 'active' && user.isActive !== false) ||
                (statusFilter === 'inactive' && user.isActive === false);
            
            return matchesSearch && matchesRole && matchesStatus;
        });
    }, [managedUsers, searchQuery, roleFilter, statusFilter]);

    const pendingUsers = useMemo(() => managedUsers.filter(user => user.status === 'pending'), [managedUsers]);
    const pendingApprovalsCount = pendingUsers.length;

    const formatRoleLabel = (roleValue?: Role | null) => {
        if (!roleValue) return '—';
        const translated = t(roleValue);
        if (translated && translated !== roleValue) {
            return translated;
        }
        return roleValue.replace(/_/g, ' ');
    };

    const handleNoteChange = (userId: string, value: string) => {
        setDecisionNotes(prev => ({
            ...prev,
            [userId]: value
        }));
    };

    const showToast = (message: string, type: 'success' | 'error' = 'success') => {
        if (typeof window !== 'undefined' && (window as any).Toast && typeof (window as any).Toast[type] === 'function') {
            (window as any).Toast[type](message);
        } else {
            setInlineToast({ message, variant: type });
        }
    };

    const formatApprovalError = (err: unknown): string => {
        if (err instanceof Error && err.message.trim()) return err.message;
        if (err && typeof err === 'object') {
            const o = err as { message?: string; details?: string; hint?: string; code?: string };
            const parts = [o.message, o.details, o.hint, o.code].filter(Boolean);
            if (parts.length) return parts.join(' — ');
        }
        if (typeof err === 'string' && err.trim()) return err;
        return 'Erreur inconnue (vérifiez la console et les politiques RLS sur profiles / role_approval_logs).';
    };

    // Métriques
    const totalUsers = managedUsers.length;
    const activeUsers = managedUsers.filter(u => u.isActive !== false).length;
    const adminUsers = managedUsers.filter(u => u.role === 'administrator' || u.role === 'super_administrator').length;
    const staffUsers = managedUsers.filter(u => ['manager', 'supervisor', 'intern'].includes(u.role)).length;

    if (!currentUser) return null;

    if (!canReadModule) {
        return <AccessDenied description="Vous n’avez pas les permissions nécessaires pour accéder à la gestion des utilisateurs. Veuillez contacter votre administrateur." />;
    }

    const hasAccess = currentUser.role === 'administrator' || currentUser.role === 'super_administrator' || currentUser.role === 'manager';
    const approverProfileId = currentUser.profileId ? String(currentUser.profileId) : (currentUser.id ? String(currentUser.id) : '');
    const canModerateApprovals =
        currentUser.role === 'super_administrator' || currentUser.role === 'administrator';

    const handleApproveRequest = async (pendingUser: User) => {
        if (!canModerateApprovals) return;
        const profileId = pendingUser.profileId ? String(pendingUser.profileId) : (pendingUser.id ? String(pendingUser.id) : '');
        if (!profileId) {
            alert('Profil utilisateur introuvable. Impossible de traiter la demande.');
            return;
        }
        if (!approverProfileId) {
            alert('Impossible de déterminer le validateur. Veuillez réessayer.');
            return;
        }
        const requested = (pendingUser.pendingRole || pendingUser.role) as Role;
        if (requested === 'super_administrator' && currentUser.role !== 'super_administrator') {
            alert('Seul un Super Administrateur peut approuver une demande de rôle Super Administrateur.');
            return;
        }
        const deptId = approvalDepartmentByProfileId[profileId] || '';
        if (!deptId) {
            alert('Veuillez sélectionner un département pour ce collaborateur avant d’approuver.');
            return;
        }
        const key = String(pendingUser.id);
        const note = (decisionNotes[key] || '').trim();
        setProcessingRequestId(`approve-${key}`);
        try {
            const { user: updatedUser, departmentAssignmentFailed, provisionedPassword } = await DataAdapter.approvePendingProfile(
                profileId,
                approverProfileId,
                note,
                deptId
            );
            if (updatedUser) {
                // En mode embarqué (Paramètres), onUpdateUser n'est pas fourni :
                // on met à jour la liste locale comme les autres handlers.
                if (onUpdateUser) {
                    onUpdateUser(updatedUser);
                } else {
                    setManagedUsers((prev) => prev.map((u) => (String(u.id) === String(updatedUser.id) ? updatedUser : u)));
                }
                setDecisionNotes(prev => ({ ...prev, [key]: '' }));
                const who = pendingUser.name || pendingUser.email || 'l’utilisateur';
                if (departmentAssignmentFailed) {
                    showToast(
                        `Demande approuvée pour ${who}, mais le rattachement au département a échoué (RLS). Ajustez les politiques Supabase sur user_departments pour les administrateurs, ou réassignez depuis l’onglet Départements.`,
                        'error'
                    );
                } else {
                    showToast(`Demande approuvée pour ${who}`, 'success');
                }
                // Demande d'accès self-service : un compte auth vient d'être créé avec un
                // mot de passe par défaut → l'afficher à l'admin pour transmission.
                if (provisionedPassword) {
                    setProvisionedCredentials({
                        email: updatedUser.email || pendingUser.email || '',
                        password: provisionedPassword,
                    });
                }
            }
        } catch (error) {
            const msg = formatApprovalError(error);
            console.error('❌ Erreur approbation utilisateur:', error);
            showToast(`Approbation impossible : ${msg}`, 'error');
            alert(`Erreur lors de l’approbation.\n\n${msg}`);
        } finally {
            setProcessingRequestId(null);
        }
    };

    const handleRejectRequest = async (pendingUser: User) => {
        if (!canModerateApprovals) return;
        const profileId = pendingUser.profileId ? String(pendingUser.profileId) : (pendingUser.id ? String(pendingUser.id) : '');
        if (!profileId) {
            alert('Profil utilisateur introuvable. Impossible de traiter la demande.');
            return;
        }
        if (!approverProfileId) {
            alert('Impossible de déterminer le validateur. Veuillez réessayer.');
            return;
        }
        const key = String(pendingUser.id);
        const note = (decisionNotes[key] || '').trim();
        if (!note) {
            const confirmed = window.confirm('Aucun commentaire n’a été saisi. Voulez-vous rejeter sans commentaire ?');
            if (!confirmed) {
                return;
            }
        }
        setProcessingRequestId(`reject-${key}`);
        try {
            const updatedUser = await DataAdapter.rejectPendingProfile(profileId, approverProfileId, note);
            if (updatedUser) {
                if (onUpdateUser) {
                    onUpdateUser(updatedUser);
                } else {
                    setManagedUsers((prev) => prev.map((u) => (String(u.id) === String(updatedUser.id) ? updatedUser : u)));
                }
                setDecisionNotes(prev => ({ ...prev, [key]: '' }));
                showToast(`Demande rejetée pour ${pendingUser.name || pendingUser.email || 'l’utilisateur'}`, 'success');
            }
        } catch (error) {
            const msg = formatApprovalError(error);
            console.error('❌ Erreur rejet utilisateur:', error);
            showToast(`Rejet impossible : ${msg}`, 'error');
            alert(`Erreur lors du rejet.\n\n${msg}`);
        } finally {
            setProcessingRequestId(null);
        }
    };

    if (!hasAccess) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="bg-white rounded-xl shadow-lg p-12 text-center max-w-md">
                    <i className="fas fa-lock text-6xl text-red-500 mb-4"></i>
                    <h2 className="text-2xl font-bold text-gray-800 mb-2">Accès Refusé</h2>
                    <p className="text-gray-600">Vous n'avez pas les permissions nécessaires pour accéder à ce module.</p>
                </div>
            </div>
        );
    }

    return (
        <div className={embedded ? 'min-h-0 text-gray-900' : 'p-6 space-y-6 text-gray-900'}>
            {/* Header */}
            <div className={`bg-gradient-to-r from-emerald-600 to-blue-600 text-white shadow-sm ${embedded ? 'rounded-lg' : ''}`}>
                <div className={`${embedded ? 'max-w-none mx-auto px-3 py-2' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6'}`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className={embedded ? 'text-base md:text-lg font-bold' : 'text-3xl md:text-4xl font-bold mb-1'}>
                                Gestion des Utilisateurs
                            </h1>
                            <p className={embedded ? 'text-emerald-50/90 text-xs leading-snug' : 'text-emerald-50 text-sm'}>
                                Gérez les utilisateurs, leurs rôles et leurs accès à la plateforme
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* Métriques + onglets */}
            <div className={`${embedded ? 'max-w-none mx-auto px-0 -mt-2 mb-3' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-4 mb-6'}`}>
                <div className={`bg-white rounded-lg shadow-sm border border-slate-200 ${embedded ? 'p-1 mb-3' : 'p-2 mb-4'}`}>
                    <div className={`flex ${embedded ? 'flex-wrap gap-1' : 'flex-wrap gap-2'} ${embedded ? '' : 'md:flex-nowrap'}`}>
                        <button
                            onClick={() => setActiveTab('users')}
                            className={`${embedded ? 'px-2 py-1.5 text-xs' : 'flex-1 px-3 py-2.5 text-sm'} font-medium rounded-md transition-colors ${
                                activeTab === 'users'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            <i className={`fas fa-users ${embedded ? 'mr-1' : 'mr-2'}`}></i>
                            Utilisateurs
                        </button>
                        {canModerateApprovals && (
                            <button
                                onClick={() => setActiveTab('approvals')}
                                className={`${embedded ? 'px-2 py-1.5 text-xs' : 'flex-1 px-3 py-2.5 text-sm'} font-medium rounded-md transition-colors ${
                                    activeTab === 'approvals'
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                <i className={`fas fa-user-clock ${embedded ? 'mr-1' : 'mr-2'}`}></i>
                                Demandes d'accès
                            </button>
                        )}
                        <button
                            onClick={() => setActiveTab('permissions')}
                            className={`${embedded ? 'px-2 py-1.5 text-xs' : 'flex-1 px-3 py-2.5 text-sm'} font-medium rounded-md transition-colors ${
                                activeTab === 'permissions'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            <i className={`fas fa-shield-alt ${embedded ? 'mr-1' : 'mr-2'}`}></i>
                            Permissions
                        </button>
                        <button
                            onClick={() => setActiveTab('departments')}
                            className={`${embedded ? 'px-2 py-1.5 text-xs' : 'flex-1 px-3 py-2.5 text-sm'} font-medium rounded-md transition-colors ${
                                activeTab === 'departments'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            <i className={`fas fa-sitemap ${embedded ? 'mr-1' : 'mr-2'}`}></i>
                            Départements
                        </button>
                        <button
                            onClick={() => setActiveTab('postes')}
                            className={`${embedded ? 'px-2 py-1.5 text-xs' : 'flex-1 px-3 py-2.5 text-sm'} font-medium rounded-md transition-colors ${
                                activeTab === 'postes'
                                    ? 'bg-emerald-600 text-white shadow-sm'
                                    : 'text-slate-600 hover:bg-slate-100'
                            }`}
                        >
                            <i className={`fas fa-user-tag ${embedded ? 'mr-1' : 'mr-2'}`}></i>
                            Postes
                        </button>
                        {currentUser?.role === 'super_administrator' && (
                            <button
                                onClick={() => setActiveTab('super_admin')}
                                className={`${embedded ? 'px-2 py-1.5 text-xs' : 'flex-1 px-3 py-2.5 text-sm'} font-medium rounded-md transition-colors ${
                                    activeTab === 'super_admin'
                                        ? 'bg-emerald-600 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                <i className={`fas fa-user-shield ${embedded ? 'mr-1' : 'mr-2'}`}></i>
                                Super Admin
                            </button>
                        )}
                    </div>
                </div>

                <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 ${embedded ? 'gap-2 mb-3' : 'gap-4 mb-5'}`}>
                    <div className={`bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg border border-blue-200 ${embedded ? 'p-2.5 shadow-sm' : 'rounded-xl shadow-md p-4'}`}>
                        <div className={`flex items-center justify-between ${embedded ? 'mb-0.5' : 'mb-1'}`}>
                            <span className={`font-medium text-slate-700 ${embedded ? 'text-[11px]' : 'text-sm'}`}>Total</span>
                            <i className={`fas fa-users text-blue-600 ${embedded ? 'text-sm' : 'text-xl'}`}></i>
                        </div>
                        <p className={`font-bold text-slate-900 ${embedded ? 'text-lg' : 'text-2xl'}`}>{totalUsers}</p>
                    </div>
                    <div className={`bg-gradient-to-br from-green-50 to-green-100 rounded-lg border border-green-200 ${embedded ? 'p-2.5 shadow-sm' : 'rounded-xl shadow-md p-4'}`}>
                        <div className={`flex items-center justify-between ${embedded ? 'mb-0.5' : 'mb-1'}`}>
                            <span className={`font-medium text-slate-700 ${embedded ? 'text-[11px]' : 'text-sm'}`}>Actifs</span>
                            <i className={`fas fa-user-check text-green-600 ${embedded ? 'text-sm' : 'text-xl'}`}></i>
                        </div>
                        <p className={`font-bold text-slate-900 ${embedded ? 'text-lg' : 'text-2xl'}`}>{activeUsers}</p>
                    </div>
                    <div className={`bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg border border-purple-200 ${embedded ? 'p-2.5 shadow-sm' : 'rounded-xl shadow-md p-4'}`}>
                        <div className={`flex items-center justify-between ${embedded ? 'mb-0.5' : 'mb-1'}`}>
                            <span className={`font-medium text-slate-700 ${embedded ? 'text-[11px]' : 'text-sm'}`}>Admins</span>
                            <i className={`fas fa-user-shield text-purple-600 ${embedded ? 'text-sm' : 'text-xl'}`}></i>
                        </div>
                        <p className={`font-bold text-slate-900 ${embedded ? 'text-lg' : 'text-2xl'}`}>{adminUsers}</p>
                    </div>
                    <div className={`bg-gradient-to-br from-orange-50 to-orange-100 rounded-lg border border-orange-200 ${embedded ? 'p-2.5 shadow-sm' : 'rounded-xl shadow-md p-4'}`}>
                        <div className={`flex items-center justify-between ${embedded ? 'mb-0.5' : 'mb-1'}`}>
                            <span className={`font-medium text-slate-700 ${embedded ? 'text-[11px]' : 'text-sm'}`}>Équipe</span>
                            <i className={`fas fa-user-tie text-orange-600 ${embedded ? 'text-sm' : 'text-xl'}`}></i>
                        </div>
                        <p className={`font-bold text-slate-900 ${embedded ? 'text-lg' : 'text-2xl'}`}>{staffUsers}</p>
                    </div>
                    {canModerateApprovals && (
                        <div className={`bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg border border-yellow-200 col-span-2 sm:col-span-1 ${embedded ? 'p-2.5 shadow-sm' : 'rounded-xl shadow-md p-4'}`}>
                            <div className={`flex items-center justify-between ${embedded ? 'mb-0.5' : 'mb-1'}`}>
                                <span className={`font-medium text-slate-700 ${embedded ? 'text-[11px]' : 'text-sm'}`}>En attente</span>
                                <i className={`fas fa-inbox text-yellow-600 ${embedded ? 'text-sm' : 'text-xl'}`}></i>
                            </div>
                            <p className={`font-bold text-slate-900 ${embedded ? 'text-lg' : 'text-2xl'}`}>{pendingApprovalsCount}</p>
                            <p className={`text-yellow-800 ${embedded ? 'text-[10px] mt-0.5 leading-tight' : 'text-xs mt-1'}`}>Validation admin.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Contenu des onglets */}
            <div className={embedded ? 'max-w-none mx-auto px-0 pb-2' : 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8'}>
                {activeTab === 'users' && (
                    <>
                        {/* Barre de recherche et filtres */}
                        <div className={`bg-white rounded-lg shadow-sm border border-slate-200 ${embedded ? 'p-2 mb-3' : 'p-4 mb-6'}`}>
                            <div className={`flex flex-wrap items-center ${embedded ? 'gap-2' : 'gap-4'}`}>
                                <div className="flex-1 min-w-[160px]">
                                    <div className="relative">
                                        <i className={`fas fa-search absolute left-2.5 top-1/2 transform -translate-y-1/2 text-slate-400 ${embedded ? 'text-xs' : ''}`}></i>
                                        <input
                                            type="text"
                                            placeholder="Rechercher un utilisateur..."
                                            value={searchQuery}
                                            onChange={(e) => setSearchQuery(e.target.value)}
                                            className={`w-full pl-8 pr-2 border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 ${embedded ? 'py-1.5 text-xs' : 'py-2 text-sm'}`}
                                        />
                                    </div>
                                </div>

                                <select
                                    value={roleFilter}
                                    onChange={(e) => setRoleFilter(e.target.value)}
                                    className={`border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 ${embedded ? 'px-2 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                                >
                                    <option value="all">Tous les rôles</option>
                                    <option value="super_administrator">Super Admin</option>
                                    <option value="administrator">Admin</option>
                                    <option value="manager">Manager</option>
                                    <option value="supervisor">Supervisor</option>
                                    <option value="intern">Stagiaire</option>
                                    <option value="hr_business_partner">RH partenaire métier</option>
                                    <option value="hr_officer">Assistant·e RH</option>
                                    <option value="recruiter">Recruteur·se</option>
                                    <option value="payroll_specialist">Paie</option>
                                    <option value="team_lead">Chef·fe d’équipe</option>
                                    <option value="student">Étudiant</option>
                                    <option value="employer">Employeur</option>
                                </select>

                                <select
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    className={`border border-slate-200 rounded-md focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 ${embedded ? 'px-2 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                                >
                                    <option value="all">Tous les statuts</option>
                                    <option value="active">Actifs</option>
                                    <option value="inactive">Inactifs</option>
                                </select>

                                {canWriteModule && (
                                    <button
                                        type="button"
                                        onClick={() => setCreateUserOpen(true)}
                                        className={`inline-flex items-center gap-2 rounded-md bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 ${embedded ? 'px-2 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}
                                    >
                                        <i className="fas fa-user-plus" aria-hidden />
                                        Nouvel utilisateur
                                    </button>
                                )}
                            </div>

                            {/* Compteur de résultats */}
                            <div className={`mt-2 pt-2 border-t border-slate-100 text-slate-600 ${embedded ? 'text-[11px]' : 'text-sm'}`}>
                                {filteredUsers.length} {filteredUsers.length > 1 ? 'utilisateurs trouvés' : 'utilisateur trouvé'}
                            </div>
                        </div>

                        {/* Liste des utilisateurs */}
                        {filteredUsers.length === 0 ? (
                            <div className="bg-white rounded-lg shadow-lg p-12 text-center">
                                <i className="fas fa-users text-6xl text-gray-300 mb-4"></i>
                                <h3 className="text-xl font-semibold text-gray-800 mb-2">Aucun utilisateur trouvé</h3>
                                <p className="text-gray-500">
                                    {searchQuery || roleFilter !== 'all' 
                                        ? 'Aucun utilisateur ne correspond aux critères de recherche' 
                                        : 'Aucun utilisateur enregistré'}
                                </p>
                            </div>
                        ) : (
                            <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">
                    <table className={`w-full text-left text-slate-600 ${embedded ? 'text-xs' : 'text-sm'}`}>
                        <thead className={`uppercase bg-slate-50 text-slate-600 ${embedded ? 'text-[10px]' : 'text-xs'}`}>
                            <tr>
                                            <th scope="col" className={embedded ? 'px-2 py-1.5' : 'px-4 py-2.5'}>Nom</th>
                                            <th scope="col" className={embedded ? 'px-2 py-1.5' : 'px-4 py-2.5'}>Email</th>
                                            <th scope="col" className={embedded ? 'px-2 py-1.5' : 'px-4 py-2.5'}>Rôle</th>
                                            <th scope="col" className={embedded ? 'px-2 py-1.5' : 'px-4 py-2.5'}>Statut</th>
                                            <th scope="col" className={`text-right ${embedded ? 'px-2 py-1.5' : 'px-4 py-2.5'}`}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                                        {filteredUsers.map(user => (
                                <tr key={user.id} className="bg-white border-b border-slate-100 hover:bg-slate-50/80">
                                    <th scope="row" className={`${embedded ? 'px-2 py-1.5' : 'px-4 py-2'} font-medium text-slate-900 whitespace-nowrap flex items-center min-w-0`}>
                                                    {user.avatar && !user.avatar.startsWith('data:image') ? (
                                                        <img src={user.avatar} alt={user.name || 'Utilisateur'} className={`rounded-full object-cover shrink-0 ${embedded ? 'w-6 h-6 mr-2' : 'w-8 h-8 mr-3'}`} onError={(e) => { e.currentTarget.style.display = 'none'; }}/>
                                                    ) : (
                                                        <div className={`rounded-full bg-gradient-to-br from-emerald-500 to-blue-500 flex items-center justify-center text-white font-bold shrink-0 ${embedded ? 'w-6 h-6 mr-2 text-[10px]' : 'w-8 h-8 mr-3 text-xs'}`}>
                                                            {(user.name || 'U').split(' ').filter(Boolean).map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                                        </div>
                                                    )}
                                        <span className="truncate max-w-[140px] sm:max-w-none">{user.name}</span>
                                    </th>
                                    <td className={`${embedded ? 'px-2 py-1.5' : 'px-4 py-2'} max-w-[200px] truncate`}>{user.email}</td>
                                                <td className={embedded ? 'px-2 py-1.5' : 'px-4 py-2'}>
                                                    <span className={`font-semibold rounded-full bg-blue-100 text-blue-800 ${embedded ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'}`}>
                                                        {t(user.role)}
                                                    </span>
                                                </td>
                                                <td className={embedded ? 'px-2 py-1.5' : 'px-4 py-2'}>
                                        <div className={`flex items-center ${embedded ? 'gap-1.5' : 'gap-3'}`}>
                                                        {user.isActive !== false ? (
                                                            <span className={`font-semibold rounded-full bg-green-100 text-green-800 ${embedded ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'}`}>
                                                                Actif
                                                            </span>
                                                        ) : (
                                                            <span className={`font-semibold rounded-full bg-slate-100 text-slate-800 ${embedded ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-xs'}`}>
                                                                Inactif
                                                            </span>
                                                        )}
                                                        <Toggle 
                                                            checked={user.isActive !== false}
                                                            onChange={(newState) => handleToggleActive(user, newState)}
                                                            disabled={!canWriteModule}
                                                            label={user.isActive !== false ? 'Activer' : 'Désactiver'}
                                                            compact={embedded}
                                                        />
                                                    </div>
                                                </td>
                                                <td className={`text-right ${embedded ? 'px-2 py-1.5' : 'px-4 py-2'}`}>
                                                    <div className={`flex flex-wrap justify-end ${embedded ? 'gap-0.5' : 'gap-1'}`}>
                                                    <button 
                                                        onClick={() => handleEditProfile(user)} 
                                                        disabled={!canWriteModule}
                                                        className={`font-medium text-emerald-600 hover:text-emerald-800 rounded transition-colors ${embedded ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-sm'} ${canWriteModule ? 'hover:bg-emerald-50' : 'opacity-50 cursor-not-allowed'}`}
                                                    >
                                                        <i className={`fas fa-user-edit ${embedded ? 'mr-1' : 'mr-1.5'}`}></i>
                                                        Profil
                                                    </button>
                                                    <button 
                                                        onClick={() => handleEdit(user)} 
                                                        disabled={!canWriteModule}
                                                        className={`font-medium text-blue-600 hover:text-blue-800 rounded transition-colors ${embedded ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-sm'} ${canWriteModule ? 'hover:bg-blue-50' : 'opacity-50 cursor-not-allowed'}`}
                                                    >
                                                        <i className={`fas fa-edit ${embedded ? 'mr-1' : 'mr-1.5'}`}></i>
                                                        Rôle
                                                    </button>
                                                    {user.passwordChanged === false && (
                                                        <button
                                                            onClick={() => handleViewProvisionalPassword(user)}
                                                            disabled={!canWriteModule || !user.profileId || resettingUserId === user.id}
                                                            className={`font-medium text-amber-700 hover:text-amber-900 rounded transition-colors ${embedded ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-sm'} ${
                                                                !canWriteModule || !user.profileId ? 'opacity-50 cursor-not-allowed' : 'hover:bg-amber-50'
                                                            }`}
                                                            title="Afficher le mot de passe par défaut (tant qu’il n’a pas été modifié)"
                                                        >
                                                            <i className={`fas fa-eye ${embedded ? 'mr-1' : 'mr-1.5'}`}></i>
                                                            {embedded ? 'Voir' : 'Voir MDP'}
                                                        </button>
                                                    )}
                                                    {user.passwordChanged === true && (
                                                        <span
                                                            className={`inline-flex items-center font-medium text-slate-400 ${embedded ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-sm'}`}
                                                            title="L’utilisateur a défini son propre mot de passe ; il n’est plus consultable."
                                                        >
                                                            <i className={`fas fa-user-lock ${embedded ? 'mr-1' : 'mr-1.5'}`}></i>
                                                            {embedded ? 'Perso.' : 'MDP perso.'}
                                                        </span>
                                                    )}
                                                    <button
                                                        onClick={() => handleGeneratePassword(user)}
                                                        disabled={!canWriteModule || !user.profileId || resettingUserId === user.id}
                                                        className={`font-medium text-slate-700 hover:text-slate-900 rounded transition-colors ${embedded ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-sm'} ${
                                                            !canWriteModule || !user.profileId ? 'opacity-50 cursor-not-allowed' : 'hover:bg-slate-100'
                                                        }`}
                                                        title={!user.profileId ? 'Profil introuvable' : 'Générer un nouveau mot de passe par défaut (récupération)'}
                                                    >
                                                        <i className={`fas fa-key ${embedded ? 'mr-1' : 'mr-1.5'} ${resettingUserId === user.id ? 'animate-pulse' : ''}`}></i>
                                                        {embedded ? 'Générer' : 'Générer MDP'}
                                                    </button>
                                                    <button 
                                                        onClick={() => handleDelete(user)} 
                                                        disabled={PROTECTED_ROLES.includes(user.role as Role) || !canDeleteModule}
                                                        className={`font-medium text-red-600 hover:text-red-800 rounded transition-colors ${embedded ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-sm'} ${PROTECTED_ROLES.includes(user.role as Role) || !canDeleteModule ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-50'}`}
                                                        title={
                                                            PROTECTED_ROLES.includes(user.role as Role)
                                                                ? 'Impossible de supprimer le Super Administrateur'
                                                                : !canDeleteModule
                                                                    ? 'Permissions insuffisantes pour supprimer'
                                                                    : ''
                                                        }
                                                    >
                                                        <i className={`fas fa-trash ${embedded ? 'mr-1' : 'mr-2'}`}></i>
                                                        {embedded ? 'Suppr.' : 'Supprimer'}
                                                    </button>
                                                    </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                        )}
                    </>
                )}
                {activeTab === 'approvals' && canModerateApprovals && (
                    <div className="space-y-6">
                        <div className="bg-white border border-emerald-200 rounded-lg shadow-sm p-6">
                            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                                <i className="fas fa-user-clock text-emerald-600"></i>
                                Workflow d'approbation
                            </h3>
                            <p className="text-sm text-gray-600 mt-2">
                                Chaque nouvelle inscription est en attente. À l’approbation, choisissez le <strong>département</strong> du collaborateur (obligatoire) puis validez.
                            </p>
                        </div>

                        {pendingUsers.length === 0 ? (
                            <div className="bg-white rounded-lg shadow-lg p-12 text-center border border-dashed border-emerald-200">
                                <i className="fas fa-check-circle text-6xl text-emerald-400 mb-4"></i>
                                <h3 className="text-xl font-semibold text-gray-800 mb-2">Aucune demande en attente</h3>
                                <p className="text-gray-500">
                                    Toutes les demandes ont été traitées. Les nouvelles demandes apparaîtront ici automatiquement.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {pendingUsers.map((pendingUser) => {
                                    const key = String(pendingUser.id);
                                    const profileIdForDept = pendingUser.profileId ? String(pendingUser.profileId) : '';
                                    const noteValue = decisionNotes[key] || '';
                                    const approveLoading = processingRequestId === `approve-${key}`;
                                    const rejectLoading = processingRequestId === `reject-${key}`;
                                    const requestedRoleLabel = formatRoleLabel(pendingUser.pendingRole || pendingUser.role);
                                    const currentRoleLabel = formatRoleLabel(pendingUser.role);
                                    const pendingSince = pendingUser.createdAt
                                        ? new Date(pendingUser.createdAt).toLocaleString('fr-FR')
                                        : '—';

                                    return (
                                        <div key={pendingUser.id} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                                                <div>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-500 to-blue-500 text-white flex items-center justify-center text-lg font-semibold">
                                                            {(pendingUser.name || pendingUser.email || 'U')
                                                                .split(' ')
                                                                .filter(Boolean)
                                                                .map((n) => n[0])
                                                                .join('')
                                                                .slice(0, 2)
                                                                .toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <h4 className="text-lg font-semibold text-gray-900">
                                                                {pendingUser.name || pendingUser.email}
                                                            </h4>
                                                            <p className="text-sm text-gray-500">{pendingUser.email}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-2 mt-3 text-xs font-semibold">
                                                        <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">
                                                            Rôle actuel : {currentRoleLabel}
                                                        </span>
                                                        <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">
                                                            Rôle demandé : {requestedRoleLabel}
                                                        </span>
                                                        <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-600">
                                                            Statut : En attente
                                                        </span>
                                                    </div>
                                                </div>
                                                <div className="text-sm text-gray-500">
                                                    <p>
                                                        <i className="far fa-clock mr-1"></i>
                                                        Demande créée le : <strong>{pendingSince}</strong>
                                                    </p>
                                                    {pendingUser.requestedPoste && (
                                                        <p className="mt-2">
                                                            <i className="fas fa-briefcase mr-1 text-blue-500"></i>
                                                            Poste souhaité : <strong>{pendingUser.requestedPoste}</strong>
                                                        </p>
                                                    )}
                                                    {pendingUser.requestedDepartmentId && (
                                                        <p className="mt-2 text-emerald-700">
                                                            <i className="fas fa-sitemap mr-1"></i>
                                                            Pilier demandé pré-rempli ci-dessous (modifiable).
                                                        </p>
                                                    )}
                                                    {pendingUser.reviewComment && (
                                                        <p className="mt-2">
                                                            <i className="fas fa-comment-dots mr-1 text-emerald-500"></i>
                                                            Dernier commentaire : {pendingUser.reviewComment}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="mt-6">
                                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                                    Commentaire interne (visible par l'équipe)
                                                </label>
                                                <textarea
                                                    value={noteValue}
                                                    onChange={(e) => handleNoteChange(key, e.target.value)}
                                                    rows={3}
                                                    disabled={approveLoading || rejectLoading}
                                                    className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                                    placeholder="Notes pour tracer la décision (optionnel)"
                                                />
                                            </div>

                                            <div className="mt-4">
                                                <label className="block text-sm font-medium text-gray-900 mb-2">
                                                    Département à l’activation <span className="text-red-600">*</span>
                                                </label>
                                                {!profileIdForDept ? (
                                                    <p className="text-xs text-amber-700">Profil sans identifiant — impossible d’assigner un département.</p>
                                                ) : (() => {
                                                    const orgKey = String(
                                                        pendingUser.organizationId ||
                                                            authProfile?.organization_id ||
                                                            currentUser?.organizationId ||
                                                            ''
                                                    );
                                                    const pendingOrgList = orgKey ? departmentsByOrgId[orgKey] || [] : [];
                                                    // Repli sur les piliers de l'organisation de l'admin lorsque l'organisation
                                                    // du demandeur n'en possède aucun (le profil sera réaligné à l'activation).
                                                    const deptList = pendingOrgList.length
                                                        ? pendingOrgList
                                                        : adminOrgId
                                                          ? departmentsByOrgId[adminOrgId] || []
                                                          : [];
                                                    if (!deptList.length) {
                                                        return (
                                                            <p className="text-xs text-amber-700">
                                                                Aucun département disponible. Créez-en un dans l’onglet
                                                                Départements.
                                                            </p>
                                                        );
                                                    }
                                                    return (
                                                        <select
                                                            value={approvalDepartmentByProfileId[profileIdForDept] || ''}
                                                            onChange={(e) =>
                                                                setApprovalDepartmentByProfileId((prev) => ({
                                                                    ...prev,
                                                                    [profileIdForDept]: e.target.value,
                                                                }))
                                                            }
                                                            disabled={approveLoading || rejectLoading}
                                                            className="w-full max-w-md border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                                        >
                                                            <option value="">— Choisir un département —</option>
                                                            {deptList.map((d) => (
                                                                <option key={d.id} value={d.id}>
                                                                    {d.name}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    );
                                                })()}
                                            </div>

                                            <div className="mt-4 flex flex-wrap justify-end gap-3">
                                                <button
                                                    onClick={() => handleRejectRequest(pendingUser)}
                                                    disabled={approveLoading || rejectLoading}
                                                    className="inline-flex items-center px-4 py-2 rounded-lg bg-red-100 text-red-700 font-semibold hover:bg-red-200 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {rejectLoading && (
                                                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-red-600 mr-2"></span>
                                                    )}
                                                    Refuser
                                                </button>
                                                <button
                                                    onClick={() => handleApproveRequest(pendingUser)}
                                                    disabled={approveLoading || rejectLoading}
                                                    className="inline-flex items-center px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                                >
                                                    {approveLoading && (
                                                        <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></span>
                                                    )}
                                                    Approuver
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'permissions' && (
                    <UserModulePermissions users={users} canEdit={canWriteModule} />
                )}
                {activeTab === 'departments' && (
                    <DepartmentManagement embedded embeddedInUserManagement canRead={canReadModule} canWrite={canWriteModule} />
                )}
                {activeTab === 'postes' && (
                    <PostesManagement embeddedInUserManagement />
                )}
            </div>

            {isModalOpen && selectedUser && (
                <UserEditModal 
                    user={selectedUser}
                    onClose={() => setModalOpen(false)}
                    onSave={handleSaveRole}
                    isLoading={isUpdatingRole}
                    allUsers={users}
                    currentUserId={currentUser?.id}
                    canAssignReservedRoles={canAssignReservedRoles}
                    adminOrgId={adminOrgId}
                />
            )}

            {isProfileModalOpen && profileUser && (
                <UserProfileEdit 
                    user={profileUser}
                    onClose={() => setProfileModalOpen(false)}
                    onSave={handleSaveProfile}
                />
            )}

            {deleteTarget && (
                <ConfirmationModal
                    title="Supprimer l'utilisateur"
                    message={`Êtes-vous sûr de vouloir supprimer l'utilisateur "${deleteTarget.name}" ? Cette action est irréversible.`}
                    onConfirm={confirmDeleteUser}
                    onCancel={() => {
                        if (!isDeleting) setDeleteTarget(null);
                    }}
                    confirmText="Supprimer"
                    cancelText="Annuler"
                    confirmButtonClass="bg-red-600 hover:bg-red-700"
                    isLoading={isDeleting}
                />
            )}

            <CreateUserModal
                open={createUserOpen}
                onClose={() => setCreateUserOpen(false)}
                showToast={showToast}
                canWriteModule={canWriteModule}
                currentRole={currentUser?.role}
                currentOrganizationId={currentUser?.organizationId}
                canAssignReservedRoles={canAssignReservedRoles}
                approverProfileId={approverProfileId}
                onRefreshUsers={onRefreshUsers}
                onLocalUsersReplace={(list) => setManagedUsers(list)}
            />

            {provisionedCredentials && (
                <div translate="no" className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 p-4">
                    <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
                        <div className="border-b border-slate-200 p-6">
                            <h2 className="text-lg font-bold text-slate-900">{provisionedCredentials.title || 'Compte activé'}</h2>
                            <p className="mt-2 text-sm text-slate-600">
                                {provisionedCredentials.email && (
                                    <>Compte : <strong className="text-slate-800">{provisionedCredentials.email}</strong>. </>
                                )}
                                {provisionedCredentials.note ||
                                    'Transmettez ce mot de passe par défaut. L’utilisateur pourra le modifier dans Paramètres → Profil.'}
                            </p>
                        </div>
                        <div className="space-y-4 p-6">
                            <div>
                                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                                    Mot de passe par défaut
                                </label>
                                <div className="mt-1 flex gap-2">
                                    <input
                                        readOnly
                                        value={provisionedCredentials.password}
                                        className="flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900"
                                        onFocus={(e) => e.currentTarget.select()}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            navigator.clipboard?.writeText(provisionedCredentials.password).then(
                                                () => showToast('Mot de passe copié', 'success'),
                                                () => showToast('Copie impossible', 'error'),
                                            );
                                        }}
                                        className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                                    >
                                        <i className="fas fa-copy mr-1" aria-hidden /> Copier
                                    </button>
                                </div>
                            </div>
                            <div className="flex justify-end">
                                <button
                                    type="button"
                                    onClick={() => setProvisionedCredentials(null)}
                                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                                >
                                    Fermer
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {inlineToast && (
                <div
                    role="status"
                    className={`fixed bottom-4 right-4 z-[200] flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-xl ${
                        inlineToast.variant === 'error'
                            ? 'border-amber-200 bg-amber-50 text-amber-950'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-950'
                    }`}
                >
                    <i
                        className={`fas mt-0.5 ${inlineToast.variant === 'error' ? 'fa-exclamation-triangle text-amber-600' : 'fa-check-circle text-emerald-600'}`}
                        aria-hidden
                    />
                    <p className="flex-1 leading-snug">{inlineToast.message}</p>
                    <button
                        type="button"
                        onClick={() => setInlineToast(null)}
                        className="shrink-0 rounded p-1 text-slate-500 hover:bg-black/5 hover:text-slate-800"
                        aria-label="Fermer la notification"
                    >
                        <i className="fas fa-times" aria-hidden />
                    </button>
                </div>
            )}
        </div>
    );
};

export default UserManagement;
