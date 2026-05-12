import React, { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import {
    Project,
    User,
    TimeLog,
    Objective,
    Language,
    Translation,
    Role,
    SUPPORTED_CURRENCIES,
    Task,
    RESOURCE_MANAGEMENT_ROLES,
} from '../types';
import LogTimeModal from './LogTimeModal';
import ConfirmationModal from './common/ConfirmationModal';
import TeamSelector from './common/TeamSelector';
import ExtensibleSelect from './common/ExtensibleSelect';
import ProjectCreatePage from './ProjectCreatePage';
import ProjectsAnalytics from './ProjectsAnalytics';
import OrganizationService from '../services/organizationService';
import * as programmeService from '../services/programmeService';
import * as referentialsService from '../services/referentialsService';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { NAV_SESSION_OPEN_PROJECT_ID } from '../contexts/AppNavigationContext';
import { postCoyaDebugIngest } from '../utils/coyaDebugIngest';
import { getProjectCockpitSnapshot } from '../services/projectCockpitService';
import { WorkspaceShell, WorkspaceHeader } from '../ui-runtime';
import { EnterpriseProjectsTable } from './program-projects/enterprise/EnterpriseProjectsTable';

const statusStyles: Record<string, string> = {
    'Not Started': 'bg-gray-200 text-gray-800',
    'In Progress': 'bg-blue-200 text-blue-800',
    'Completed': 'bg-emerald-200 text-emerald-800',
    'On Hold': 'bg-amber-200 text-amber-800',
    'Cancelled': 'bg-red-200 text-red-800',
};

// Gouvernance projet : seuls ces rôles créent des projets (et gouvernent la structuration).
const PROJECT_CREATOR_ROLES: Role[] = ['super_administrator', 'administrator', 'manager'];

const ProjectFormModal: React.FC<{
    project: Omit<Project, 'id' | 'tasks' | 'risks'> | Project | null;
    users: User[];
    onClose: () => void;
    onSave: (project: Omit<Project, 'id' | 'tasks' | 'risks'> | Project) => void;
}> = ({ project, users, onClose, onSave }) => {
    const { t } = useLocalization();
    const isEditMode = project && 'id' in project;
    const [formData, setFormData] = useState({
        title: project?.title || '',
        description: project?.description || '',
        status: project?.status || 'Not Started',
        dueDate: project?.dueDate || '',
        team: project?.team || [],
        programmeId: (project && 'programmeId' in project) ? (project.programmeId ?? '') : '',
        budgetPlanned: (project && 'budgetPlanned' in project) ? (project.budgetPlanned ?? undefined) : undefined,
        budgetCurrency: (project && 'budgetCurrency' in project) ? (project.budgetCurrency ?? 'XOF') : 'XOF',
    });
    const [statusOptionId, setStatusOptionId] = useState('');
    const [organizationId, setOrganizationId] = useState<string | null>(null);
    const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);
    const [statusOptions, setStatusOptions] = useState<referentialsService.ReferentialValue[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const orgId = await OrganizationService.getCurrentUserOrganizationId();
            if (cancelled) return;
            setOrganizationId(orgId || null);
            if (orgId) {
                try {
                    const [list, statusList] = await Promise.all([
                        programmeService.listProgrammes(orgId),
                        referentialsService.listValues('project_status', orgId),
                    ]);
                    if (!cancelled) {
                        setProgrammes(list.map(p => ({ id: p.id, name: p.name })));
                        setStatusOptions(statusList);
                    }
                } catch (_) { if (!cancelled) setProgrammes([]); }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (project) {
            const p = project as Project;
            setFormData(prev => ({
                ...prev,
                programmeId: p.programmeId ?? '',
                budgetPlanned: p.budgetPlanned,
                budgetCurrency: p.budgetCurrency ?? 'XOF',
            }));
        }
    }, [project?.id, (project as Project)?.programmeId, (project as Project)?.budgetPlanned, (project as Project)?.budgetCurrency]);

    useEffect(() => {
        if (statusOptions.length > 0 && formData.status && !statusOptionId) {
            const id = statusOptions.find(o => o.name === formData.status)?.id ?? '';
            setStatusOptionId(id);
        }
    }, [statusOptions, formData.status, statusOptionId]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const projectData = {
            ...project,
            ...formData,
            programmeId: formData.programmeId || null,
            team: formData.team,
        };
        onSave(projectData as Project);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--coya-enterprise-border)] bg-white shadow-[0_8px_30px_rgba(15,23,42,0.12)]">
                <form onSubmit={handleSubmit} className="flex h-full max-h-[90vh] flex-col">
                    <div className="border-b border-[var(--coya-enterprise-border)] p-6">
                        <h2 className="text-xl font-semibold tracking-tight text-[var(--coya-enterprise-text)]">{isEditMode ? t('edit_project') : t('create_new_project')}</h2>
                    </div>
                    <div className="flex-grow space-y-4 overflow-y-auto p-6">
                        <div>
                            <label className="block text-sm font-medium text-[var(--coya-enterprise-text)]">{t('project_title')}</label>
                            <input type="text" name="title" value={formData.title} onChange={handleChange} className="mt-1 block w-full rounded-xl border border-[var(--coya-enterprise-border)] p-2.5 text-[var(--coya-enterprise-text)] focus:border-[var(--coya-institutional)] focus:outline-none focus:ring-2 focus:ring-[var(--coya-institutional)]/25" required />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--coya-enterprise-text)]">{t('project_description')}</label>
                            <textarea name="description" value={formData.description} onChange={handleChange} rows={4} className="mt-1 block w-full rounded-xl border border-[var(--coya-enterprise-border)] p-2.5 text-[var(--coya-enterprise-text)] focus:border-[var(--coya-institutional)] focus:outline-none focus:ring-2 focus:ring-[var(--coya-institutional)]/25" required />
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label className="block text-sm font-medium text-[var(--coya-enterprise-text)]">{t('status')}</label>
                                <ExtensibleSelect
                                    entityType="project_status"
                                    value={statusOptionId}
                                    onChange={(id, item) => {
                                        setStatusOptionId(id);
                                        setFormData(prev => ({ ...prev, status: item?.name ?? prev.status }));
                                    }}
                                    organizationId={organizationId}
                                    canCreate
                                    canEdit
                                    placeholder={t('status')}
                                    className="mt-1 block w-full rounded-xl border border-[var(--coya-enterprise-border)] p-2.5"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-[var(--coya-enterprise-text)]">{t('due_date')}</label>
                                <input type="date" name="dueDate" value={formData.dueDate} onChange={handleChange} className="mt-1 block w-full rounded-xl border border-[var(--coya-enterprise-border)] p-2.5 text-[var(--coya-enterprise-text)] focus:border-[var(--coya-institutional)] focus:outline-none focus:ring-2 focus:ring-[var(--coya-institutional)]/25" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-[var(--coya-enterprise-text)]">Programme</label>
                            <select name="programmeId" value={formData.programmeId} onChange={handleChange} className="mt-1 block w-full rounded-xl border border-[var(--coya-enterprise-border)] bg-white p-2.5 text-[var(--coya-enterprise-text)] focus:border-[var(--coya-institutional)] focus:outline-none focus:ring-2 focus:ring-[var(--coya-institutional)]/25">
                                <option value="">— Aucun —</option>
                                {programmes.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <label className="block text-sm font-medium text-[var(--coya-enterprise-text)]">Budget prévisionnel</label>
                                <div className="mt-1 flex gap-2">
                                    <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        value={formData.budgetPlanned ?? ''}
                                        onChange={(e) => setFormData(prev => ({ ...prev, budgetPlanned: e.target.value === '' ? undefined : Number(e.target.value) }))}
                                        className="block w-full rounded-xl border border-[var(--coya-enterprise-border)] p-2.5 text-[var(--coya-enterprise-text)] focus:border-[var(--coya-institutional)] focus:outline-none focus:ring-2 focus:ring-[var(--coya-institutional)]/25"
                                        placeholder="Montant"
                                    />
                                    <select
                                        value={formData.budgetCurrency}
                                        onChange={(e) => setFormData(prev => ({ ...prev, budgetCurrency: e.target.value as any }))}
                                        className="rounded-xl border border-[var(--coya-enterprise-border)] bg-white p-2.5 text-[var(--coya-enterprise-text)]"
                                    >
                                        {SUPPORTED_CURRENCIES.map((c) => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div>
                            <TeamSelector
                                selectedUsers={formData.team}
                                onUsersChange={(users) => setFormData(prev => ({ ...prev, team: users }))}
                                placeholder={t('search_team_members')}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-[var(--coya-enterprise-border)] p-6">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--coya-enterprise-text)] hover:bg-[#F8FAFC]"
                        >
                            {t('cancel')}
                        </button>
                        <button
                            type="submit"
                            className="rounded-xl bg-[var(--coya-institutional)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[var(--coya-institutional-secondary)]"
                        >
                            {t('save')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};



interface ProjectsProps {
    projects: Project[];
    users: User[];
    timeLogs: TimeLog[];
    onUpdateProject: (project: Project) => void;
    onAddProject: (project: Omit<Project, 'id' | 'tasks' | 'risks'>) => void;
    onDeleteProject: (projectId: string | number) => void;
    onAddTimeLog: (log: Omit<TimeLog, 'id' | 'userId'>) => void;
    objectives?: Objective[];
    setView?: (view: string) => void;
    isLoading?: boolean;
    loadingOperation?: string | null;
    isDataLoaded?: boolean;
    autoOpenProjectId?: string | null;
    onNotificationHandled?: () => void;
    /** Navigation vers la page object workspace (URL + vue dédiée), plus de modale plein écran. */
    onOpenProjectWorkspace: (projectId: string) => void;
}

const Projects: React.FC<ProjectsProps> = ({
    projects,
    users,
    timeLogs,
    onUpdateProject,
    onAddProject,
    onDeleteProject,
    onAddTimeLog,
    objectives = [],
    setView,
    isLoading = false,
    loadingOperation = null,
    isDataLoaded = true,
    autoOpenProjectId = null,
    onNotificationHandled,
    onOpenProjectWorkspace,
}) => {
    const { t, language } = useLocalization();
    const localize = (en: string, fr: string) => (language === Language.FR ? fr : en);
    const { user: currentUser } = useAuth();
    const { hasPermission } = useModulePermissions();
    const locale = language === Language.FR ? 'fr-FR' : 'en-US';
    const [editingProject, setEditingProject] = useState<Project | null>(null);
    const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
    const [isProjectCreatePageOpen, setIsProjectCreatePageOpen] = useState(false);
    /** Incrémenté à chaque ouverture du wizard pour remonter un arbre DOM propre (évite removeChild avec extensions / IME). */
    const [projectCreateMountKey, setProjectCreateMountKey] = useState(0);
    
    // États pour recherche, filtres et vue
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [programmeFilter, setProgrammeFilter] = useState<string>('');
    const [programmesList, setProgrammesList] = useState<{ id: string; name: string }[]>([]);
    const [sortBy, setSortBy] = useState<'date' | 'title' | 'status' | 'smart'>('smart');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [activeSection, setActiveSection] = useState<'overview' | 'analytics' | 'tasks_week'>('overview');
    const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
    const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState('');
    /** Après 1ère visite Analytics : garde Recharts monté (display none) pour éviter cycles unmount/remount → removeChild. */
    const [retainAnalyticsDom, setRetainAnalyticsDom] = useState(false);

    useEffect(() => {
        // #region agent log
        postCoyaDebugIngest({
                sessionId: '5fe008',
                hypothesisId: 'H2',
                location: 'Projects.tsx:mount',
                message: 'Projects_mounted',
                data: {},
                timestamp: Date.now(),
            });
        // #endregion
        return () => {
            // #region agent log
            postCoyaDebugIngest({
                    sessionId: '5fe008',
                    hypothesisId: 'H2',
                    location: 'Projects.tsx:unmount',
                    message: 'Projects_unmounted',
                    data: {},
                    timestamp: Date.now(),
                });
            // #endregion
        };
    }, []);

    useEffect(() => {
        // #region agent log
        postCoyaDebugIngest({
                sessionId: '5fe008',
                hypothesisId: 'H1',
                location: 'Projects.tsx:isProjectCreatePageOpen',
                message: 'wizard_visibility',
                data: { open: isProjectCreatePageOpen },
                timestamp: Date.now(),
            });
        // #endregion
    }, [isProjectCreatePageOpen]);

    useEffect(() => {
        // #region agent log
        postCoyaDebugIngest({
                sessionId: '5fe008',
                hypothesisId: 'H6',
                location: 'Projects.tsx:activeSection',
                message: 'section_changed',
                data: { activeSection },
                timestamp: Date.now(),
            });
        // #endregion
    }, [activeSection]);

    useEffect(() => {
        if (activeSection === 'analytics') setRetainAnalyticsDom(true);
    }, [activeSection]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const orgId = await OrganizationService.getCurrentUserOrganizationId();
            if (cancelled || !orgId) return;
            try {
                const list = await programmeService.listProgrammes(orgId);
                if (!cancelled) setProgrammesList(list.map(p => ({ id: p.id, name: p.name })));
            } catch (_) { if (!cancelled) setProgrammesList([]); }
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!autoOpenProjectId) return;

        const targetId = String(autoOpenProjectId);
        const targetProject = projects.find(project => String(project.id) === targetId);

        if (!targetProject) {
            return;
        }

        onOpenProjectWorkspace(targetId);
        setActiveSection('overview');
        setViewMode('list');
        onNotificationHandled?.();
    }, [autoOpenProjectId, projects, onOpenProjectWorkspace, onNotificationHandled]);

    /** Navigation depuis le module Programme : ouvrir la fiche du projet ciblé. */
    useEffect(() => {
        const raw = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(NAV_SESSION_OPEN_PROJECT_ID) : null;
        if (!raw) return;
        const target = projects.find((p) => String(p.id) === String(raw));
        if (!target) {
            if (projects.length > 0) {
                try {
                    sessionStorage.removeItem(NAV_SESSION_OPEN_PROJECT_ID);
                } catch (_) { /* ignore */ }
            }
            return;
        }
        try {
            sessionStorage.removeItem(NAV_SESSION_OPEN_PROJECT_ID);
        } catch (_) { /* ignore */ }
        onOpenProjectWorkspace(String(target.id));
        setActiveSection('overview');
        setViewMode('list');
    }, [projects, onOpenProjectWorkspace]);

    const validateProject = (projectData: Project | Omit<Project, 'id' | 'tasks' | 'risks'>): string | null => {
        if (!projectData.title?.trim()) {
            return t('project_title_required');
        }
        if (!projectData.description?.trim()) {
            return t('project_description_required');
        }
        if (projectData.dueDate && new Date(projectData.dueDate) < new Date()) {
            return t('project_due_date_invalid');
        }
        return null;
    };

    const handleSaveProject = async (projectData: Project | Omit<Project, 'id' | 'tasks' | 'risks'>) => {
        // #region agent log
        postCoyaDebugIngest({
                sessionId: '5fe008',
                hypothesisId: 'H1',
                location: 'Projects.tsx:handleSaveProject',
                message: 'save_start',
                data: { hasId: 'id' in projectData },
                timestamp: Date.now(),
            });
        // #endregion
        const validationError = validateProject(projectData);
        if (validationError) {
            alert(validationError);
            return;
        }

        // Vérifier si on est en mode édition (si editingProject existe ou si l'ID est présent)
        const isEditMode = editingProject !== null || ('id' in projectData && projectData.id !== undefined);

        if (isEditMode) {
            // Mode édition : utiliser l'ID du projet en édition ou celui fourni
            const projectId = editingProject?.id || (projectData as Project).id;
            if (!projectId) {
                console.error('❌ Erreur: ID du projet manquant pour la mise à jour');
                alert(t('project_missing_id_error'));
                return;
            }
            
            // S'assurer que toutes les propriétés du projet sont incluses
            const projectToUpdate: Project = {
                ...editingProject!,
                ...projectData,
                id: projectId,
                tasks: (projectData as Project).tasks || editingProject?.tasks || [],
                risks: (projectData as Project).risks || editingProject?.risks || []
            };
            
            console.log('🔄 Mise à jour projet ID:', projectId, projectToUpdate);
            await onUpdateProject(projectToUpdate);
        } else {
            // Mode création
            console.log('➕ Création nouveau projet');
            const projectToCreate = {
                ...(projectData as Omit<Project, 'id' | 'tasks' | 'risks'>),
                createdById: currentUser?.id ? currentUser.id.toString() : undefined,
                createdByName: currentUser?.fullName || currentUser?.email,
            };
            await onAddProject(projectToCreate);
        }
        // #region agent log
        postCoyaDebugIngest({
                sessionId: '5fe008',
                hypothesisId: 'H1',
                location: 'Projects.tsx:handleSaveProject',
                message: 'persist_complete_wizard_closes_in_child',
                data: {},
                timestamp: Date.now(),
            });
        // #endregion
        // Fermeture : uniquement depuis ProjectCreatePage après remise de isLoading (évite removeChild sur le submit).
    };

    const handleDeleteProject = () => {
        if (projectToDelete) {
            if (!canManageProject(projectToDelete)) {
                alert(t('project_permission_error'));
                setProjectToDelete(null);
                return;
            }
            onDeleteProject(projectToDelete.id);
            setProjectToDelete(null);
        }
    };

    const handleOpenForm = (project: Project | null = null) => {
        // #region agent log
        postCoyaDebugIngest({
                sessionId: '5fe008',
                hypothesisId: 'H3',
                location: 'Projects.tsx:handleOpenForm',
                message: 'open_wizard',
                data: { editMode: !!project },
                timestamp: Date.now(),
            });
        // #endregion
        if (project && !canManageProject(project)) {
            alert(t('project_permission_error'));
            return;
        }
        setEditingProject(project);
        setProjectCreateMountKey((k) => k + 1);
        setIsProjectCreatePageOpen(true);
    };

    const handleRequestDeleteProject = (project: Project) => {
        if (!canManageProject(project)) {
            alert(t('project_permission_error'));
            return;
        }
        setProjectToDelete(project);
    };

    const cockpitByProjectId = useMemo(() => {
        const m = new Map<string, ReturnType<typeof getProjectCockpitSnapshot>>();
        for (const p of projects) {
            try {
                m.set(String(p.id), getProjectCockpitSnapshot({ project: p, timeLogs, objectives }));
            } catch {
                // fallback : pas de cockpit
            }
        }
        return m;
    }, [projects, timeLogs, objectives]);

    const getProjectInsights = useCallback(
        (project: Project) => {
            const cockpit = cockpitByProjectId.get(String(project.id));
            const core = cockpit?.insights;
            return {
                progressPercentage: core?.progressPercentage ?? 0,
                highRiskCount: core?.highRiskCount ?? 0,
                dueInDays: core?.dueInDays ?? 0,
                urgencyScore: core?.urgencyScore ?? 0,
                riskLevel: core?.riskLevel ?? 'low',
                recommendedAction: core ? localize(core.recommendedActionEn, core.recommendedActionFr) : localize('No cockpit yet', 'Cockpit indisponible'),
            };
        },
        [cockpitByProjectId, localize],
    );

    const filteredProjects = useMemo(() => {
        let filtered = projects.filter(project => {
            const matchesSearch = searchQuery === '' ||
                project.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                project.team.some(member =>
                    member.fullName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    member.email.toLowerCase().includes(searchQuery.toLowerCase())
                );
            const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
            const matchesProgramme = !programmeFilter || project.programmeId === programmeFilter;
            return matchesSearch && matchesStatus && matchesProgramme;
        });

        // Tri
        filtered.sort((a, b) => {
            let compareValue = 0;
            
            switch (sortBy) {
                case 'smart': {
                    const aScore = getProjectInsights(a).urgencyScore;
                    const bScore = getProjectInsights(b).urgencyScore;
                    compareValue = aScore - bScore;
                    break;
                }
                case 'title':
                    compareValue = a.title.localeCompare(b.title);
                    break;
                case 'status':
                    compareValue = a.status.localeCompare(b.status);
                    break;
                case 'date':
                default:
                    const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
                    const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
                    compareValue = dateA - dateB;
                    break;
            }

            return sortOrder === 'asc' ? compareValue : -compareValue;
        });

        return filtered;
    }, [projects, searchQuery, statusFilter, programmeFilter, sortBy, sortOrder, getProjectInsights]);

    const prioritizedProjects = useMemo(
        () => [...filteredProjects].sort((a, b) => getProjectInsights(b).urgencyScore - getProjectInsights(a).urgencyScore),
        [filteredProjects, getProjectInsights]
    );

    useEffect(() => {
        setPage(1);
    }, [searchQuery, statusFilter, programmeFilter, sortBy, sortOrder]);

    const totalPages = Math.max(1, Math.ceil(prioritizedProjects.length / pageSize));
    const paginatedPrioritized = useMemo(() => {
        const start = (page - 1) * pageSize;
        return prioritizedProjects.slice(start, start + pageSize);
    }, [prioritizedProjects, page, pageSize]);

    useEffect(() => {
        setPage((p) => Math.min(p, totalPages));
    }, [totalPages]);

    const projectsTableEmptyMessage = useMemo(() => {
        if (isLoading) return undefined;
        if (projects.length > 0 && prioritizedProjects.length === 0) {
            return localize(
                'No projects match your current filters or search.',
                'Aucun projet ne correspond aux filtres ou à la recherche.',
            );
        }
        return undefined;
    }, [isLoading, projects.length, prioritizedProjects.length, localize]);

    // Rôles autorisés à créer un projet
    const canCreateProject = useMemo(() => {
        if (!currentUser) return false;
        return hasPermission('projects', 'write') || PROJECT_CREATOR_ROLES.includes(currentUser.role as Role);
    }, [currentUser, hasPermission]);

    const canManageProject = useCallback(
        (project: Project | null) => {
            if (!currentUser) return false;
            if (project?.createdById && currentUser.id) {
                const isCreator =
                    project.createdById.toString() === currentUser.id.toString();
                if (isCreator) {
                    return true;
                }
            }
            return (
                hasPermission('projects', 'write') ||
                hasPermission('projects', 'delete') ||
                PROJECT_CREATOR_ROLES.includes(currentUser.role as Role)
            );
        },
        [currentUser, hasPermission]
    );


    // Tâches de la semaine (Phase 2.2) : tâches dont l'échéance est dans la semaine courante (lundi–dimanche)
    const tasksThisWeek = useMemo(() => {
        const now = new Date();
        const day = now.getDay();
        const diff = day === 0 ? -6 : 1 - day;
        const monday = new Date(now);
        monday.setDate(monday.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(sunday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        const weekStart = monday.getTime();
        const weekEnd = sunday.getTime();
        const out: Array<{ project: Project; task: import('../types').Task }> = [];
        projects.forEach(project => {
            (project.tasks || []).forEach(task => {
                const due = task.dueDate ? new Date(task.dueDate).getTime() : null;
                if (due != null && due >= weekStart && due <= weekEnd) {
                    out.push({ project, task });
                }
            });
        });
        out.sort((a, b) => (a.task.dueDate || '').localeCompare(b.task.dueDate || ''));
        return out;
    }, [projects]);

    // Calculer les métriques globales
    const totalProjects = projects.length;
    const activeProjects = projects.filter(p => p.status === 'In Progress').length;
    const completedProjectsCount = projects.filter(p => p.status === 'Completed').length;
    const onHoldProjectsCount = projects.filter(p => p.status === 'On Hold').length;
    const totalTasks = projects.reduce((sum, p) => sum + (Array.isArray(p.tasks) ? p.tasks.length : 0), 0);

    const statusUi = (status: string) => {
        // Internal statuses → libellés enterprise + badges bordés (charte COYA ERP)
        if (status === 'In Progress')
            return { label: 'En cours', badge: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: 'fa-play' };
        if (status === 'Completed')
            return { label: 'Terminé', badge: 'border-sky-200 bg-sky-50 text-sky-900', icon: 'fa-circle-check' };
        if (status === 'Not Started')
            return { label: 'En attente', badge: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'fa-pause' };
        if (status === 'On Hold')
            return { label: 'En pause', badge: 'border-[#F4C430]/60 bg-[#FDF8E8] text-amber-950', icon: 'fa-circle-pause' };
        if (status === 'Cancelled')
            return { label: 'Annulé', badge: 'border-slate-200 bg-slate-100 text-slate-700', icon: 'fa-ban' };
        return { label: status, badge: 'border-slate-200 bg-slate-100 text-slate-700', icon: 'fa-circle' };
    };

    const priorityUi = (urgencyScore: number) => {
        if (urgencyScore >= 75) return { label: 'Critique', badge: 'bg-red-100 text-red-700' };
        if (urgencyScore >= 55) return { label: 'Haute', badge: 'bg-orange-100 text-orange-700' };
        if (urgencyScore >= 35) return { label: 'Moyenne', badge: 'bg-amber-100 text-amber-700' };
        return { label: 'Normale', badge: 'bg-green-100 text-green-700' };
    };

    const formatMoney = (amount?: number | null, currency?: string | null) => {
        if (amount == null || Number.isNaN(amount)) return localize('—', '—');
        try {
            return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount) + ` ${currency || 'XOF'}`;
        } catch (_) {
            return String(amount);
        }
    };

    const projectLoggedMinutes = useCallback(
        (projectId: string | number) => {
            const id = String(projectId);
            return timeLogs
                .filter((l: any) => String(l?.projectId) === id || String(l?.project_id) === id)
                .reduce((sum: number, l: any) => sum + Number(l?.duration || l?.durationMinutes || 0), 0);
        },
        [timeLogs]
    );

    const formatBudgetRow = useCallback(
        (p: Project) => {
            if (p.budgetPlanned != null && Number(p.budgetPlanned) > 0) {
                return formatMoney(p.budgetPlanned, p.budgetCurrency);
            }
            const cockpitSnap = cockpitByProjectId.get(String(p.id));
            if (cockpitSnap?.budgetPlannedTotal) return formatMoney(cockpitSnap.budgetPlannedTotal, p.budgetCurrency);
            return localize('—', '—');
        },
        [cockpitByProjectId, localize],
    );

    const progressPercentRow = useCallback(
        (p: Project) => Math.min(100, Math.max(0, getProjectInsights(p).progressPercentage ?? 0)),
        [getProjectInsights],
    );

    const managerLabelRow = useCallback(
        (p: Project) =>
            p.createdByName || p.team?.[0]?.fullName || p.team?.[0]?.email || localize('—', '—'),
        [localize],
    );

    const pctOfTotal = (n: number) => (totalProjects > 0 ? Math.round((n / totalProjects) * 100) : 0);

    const headerActionsEl = (
        <>
            {isLoading && (
                <div className="flex items-center text-sm text-[var(--coya-enterprise-muted)]">
                    <i className="fas fa-spinner fa-spin mr-2" />
                    <span>
                        {loadingOperation === 'create' && localize('Creating…', 'Création…')}
                        {loadingOperation === 'update' && localize('Updating…', 'Mise à jour…')}
                        {loadingOperation === 'delete' && localize('Deleting…', 'Suppression…')}
                        {!loadingOperation && localize('Loading…', 'Chargement…')}
                    </span>
                </div>
            )}
            {canCreateProject && (
                <button
                    type="button"
                    data-testid="projects-create-btn"
                    onClick={() => handleOpenForm()}
                    disabled={isLoading}
                    className="inline-flex items-center gap-2 rounded-xl bg-[var(--coya-institutional)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--coya-institutional-secondary)] disabled:opacity-50"
                >
                    <i className="fas fa-plus h-4 w-4" />
                    {localize('New project', 'Nouveau projet')}
                </button>
            )}
            {currentUser?.role === 'super_administrator' && (
                <button
                    type="button"
                    onClick={() => setBulkDeleteOpen(true)}
                    disabled={isLoading || projects.length === 0}
                    className="flex items-center gap-2 rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-4 py-2.5 text-sm text-[var(--coya-enterprise-text)] transition-colors hover:bg-[#F8FAFC] disabled:opacity-50"
                    title="Action dangereuse (super admin)"
                >
                    <i className="fas fa-trash h-4 w-4 text-red-500" />
                    {localize('Delete all projects', 'Supprimer tous les projets')}
                </button>
            )}
        </>
    );

    return (
        <Fragment>
        <WorkspaceShell
            data-testid="projects-list"
            className="font-coya min-h-0 bg-[var(--coya-enterprise-bg,#F8FAFC)] text-[var(--coya-enterprise-text)] !shadow-none"
        >
            {bulkDeleteOpen && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <p className="font-semibold">{localize('Danger zone', 'Zone dangereuse')}</p>
                            <p className="text-red-800 mt-1">
                                {localize(
                                    'This will delete ALL projects in the current list. Type DELETE to confirm.',
                                    'Ceci supprimera TOUS les projets de la liste courante. Tape DELETE pour confirmer.'
                                )}
                            </p>
                        </div>
                        <button
                            type="button"
                            className="text-red-700 hover:text-red-900"
                            onClick={() => {
                                setBulkDeleteOpen(false);
                                setBulkDeleteConfirm('');
                            }}
                            aria-label="Fermer"
                        >
                            <i className="fas fa-xmark" />
                        </button>
                    </div>

                    <div className="mt-3 flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                        <div className="flex-1 w-full">
                            <label className="block text-xs font-semibold text-red-800 mb-1">Confirmation</label>
                            <input
                                value={bulkDeleteConfirm}
                                onChange={(e) => setBulkDeleteConfirm(e.target.value)}
                                placeholder="DELETE"
                                className="w-full rounded-xl border border-red-200 px-3 py-2 bg-white"
                            />
                        </div>
                        <button
                            type="button"
                            className="rounded-xl bg-red-600 text-white px-4 py-2.5 font-semibold hover:bg-red-700 disabled:opacity-50"
                            disabled={bulkDeleteConfirm.trim() !== 'DELETE' || isLoading}
                            onClick={() => {
                                if (bulkDeleteConfirm.trim() !== 'DELETE') return;
                                if (!confirm('Confirmer la suppression de tous les projets ?')) return;
                                projects.forEach((p) => onDeleteProject(p.id));
                                setBulkDeleteOpen(false);
                                setBulkDeleteConfirm('');
                            }}
                        >
                            {localize('Confirm delete', 'Confirmer suppression')}
                        </button>
                    </div>
                </div>
            )}

            <div className="mx-auto max-w-[1400px] px-4 pb-10 pt-4">
            <WorkspaceHeader
                className="mb-6"
                title={localize('Projects', 'Projets')}
                subtitle={localize('List of all projects', 'Liste de tous les projets')}
                actions={headerActionsEl}
            />
            <div className="mb-6 inline-flex rounded-2xl border border-[var(--coya-enterprise-border)] bg-white/90 p-1.5 shadow-sm backdrop-blur-sm">
                <button
                    type="button"
                    onClick={() => setActiveSection('overview')}
                    className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                        activeSection === 'overview'
                            ? 'bg-[var(--coya-institutional)] text-white shadow-sm'
                            : 'text-[var(--coya-enterprise-muted)] hover:bg-[#F8FAFC] hover:text-[var(--coya-enterprise-text)]'
                    }`}
                >
                    {t('overview') || 'Vue globale'}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveSection('analytics')}
                    className={`ml-1 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                        activeSection === 'analytics'
                            ? 'bg-[var(--coya-institutional)] text-white shadow-sm'
                            : 'text-[var(--coya-enterprise-muted)] hover:bg-[#F8FAFC] hover:text-[var(--coya-enterprise-text)]'
                    }`}
                >
                    {t('analytics') || 'Analytics'}
                </button>
                <button
                    type="button"
                    onClick={() => setActiveSection('tasks_week')}
                    className={`ml-1 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
                        activeSection === 'tasks_week'
                            ? 'bg-[var(--coya-institutional)] text-white shadow-sm'
                            : 'text-[var(--coya-enterprise-muted)] hover:bg-[#F8FAFC] hover:text-[var(--coya-enterprise-text)]'
                    }`}
                >
                    {localize('Tasks this week', 'Tâches de la semaine')}
                    {tasksThisWeek.length > 0 && (
                        <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] ${activeSection === 'tasks_week' ? 'bg-white/20' : 'bg-slate-200 text-slate-700'}`}>{tasksThisWeek.length}</span>
                    )}
                </button>
            </div>

            {activeSection === 'overview' && (
                <>
                    {projects.length > 0 && (
                        <div
                            className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
                            data-testid="projects-enterprise-kpi"
                        >
                            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                                    {localize('Total projects', 'Total projets')}
                                </p>
                                <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">{totalProjects}</p>
                                <p className="mt-1 text-xs text-[var(--coya-enterprise-muted)]">{totalTasks} {localize('tasks (portfolio)', 'tâches (portefeuille)')}</p>
                            </div>
                            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                                    {localize('In progress', 'En cours')}
                                </p>
                                <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">{activeProjects}</p>
                                <p className="mt-1 text-xs font-medium text-[var(--coya-institutional)]">{pctOfTotal(activeProjects)}% {localize('of total', 'du total')}</p>
                            </div>
                            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                                    {localize('Completed', 'Terminés')}
                                </p>
                                <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">{completedProjectsCount}</p>
                                <p className="mt-1 text-xs font-medium text-sky-700">{pctOfTotal(completedProjectsCount)}% {localize('of total', 'du total')}</p>
                            </div>
                            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--coya-enterprise-muted)]">
                                    {localize('On hold', 'En pause')}
                                </p>
                                <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">{onHoldProjectsCount}</p>
                                <p className="mt-1 text-xs font-medium text-amber-800">{pctOfTotal(onHoldProjectsCount)}% {localize('of total', 'du total')}</p>
                            </div>
                        </div>
                    )}

                {/* Barre de recherche, filtres et sélecteur de vue */}
                <div className="mb-6 rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                    <div className="flex flex-col lg:flex-row gap-4">
                        {/* Barre de recherche */}
                        <div className="flex-1">
                            <div className="relative">
                                <input
                                    type="text"
                                    data-testid="projects-search"
                                    placeholder={localize("Search a project by name, description or team member...", "Rechercher un projet par nom, description ou membre d'équipe...")}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full rounded-xl border border-[var(--coya-enterprise-border)] py-2.5 pl-10 pr-4 transition-all focus:border-[var(--coya-institutional)] focus:ring-2 focus:ring-emerald-100"
                                />
                                <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                                {searchQuery && (
                                    <button
                                        onClick={() => setSearchQuery('')}
                                        className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Filtres */}
                        <div className="flex flex-wrap gap-3">
                            {/* Filtre par statut */}
                            <select
                                name="status-filter"
                                data-testid="projects-status-filter"
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value)}
                                className="rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2.5 focus:border-[var(--coya-institutional)] focus:ring-2 focus:ring-emerald-100"
                            >
                                <option value="all">{localize('All statuses', 'Tous les statuts')}</option>
                                <option value="Not Started">{localize('Not started', 'Non démarré')}</option>
                                <option value="In Progress">{localize('In progress', 'En cours')}</option>
                                <option value="Completed">{localize('Completed', 'Terminé')}</option>
                                <option value="On Hold">{localize('On hold', 'En pause')}</option>
                            </select>

                            {/* Filtre par programme */}
                            <select
                                value={programmeFilter}
                                onChange={(e) => setProgrammeFilter(e.target.value)}
                                className="rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2.5 focus:border-[var(--coya-institutional)] focus:ring-2 focus:ring-emerald-100"
                            >
                                <option value="">{localize('All programmes', 'Tous les programmes')}</option>
                                {programmesList.map(p => (
                                    <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                            </select>

                            {/* Tri */}
                            <select
                                value={sortBy}
                                onChange={(e) => setSortBy(e.target.value as 'date' | 'title' | 'status' | 'smart')}
                                className="rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2.5 focus:border-[var(--coya-institutional)] focus:ring-2 focus:ring-emerald-100"
                            >
                                <option value="smart">{localize('Smart priority', 'Priorite intelligente')}</option>
                                <option value="date">{t('sort_by_date')}</option>
                                <option value="title">{t('sort_by_title')}</option>
                                <option value="status">{t('sort_by_status')}</option>
                            </select>

                            {/* Ordre de tri */}
                            <button
                                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                                className="flex items-center rounded-xl border border-[var(--coya-enterprise-border)] px-3 py-2.5 transition-colors hover:bg-[#F8FAFC]"
                                title={sortOrder === 'asc' ? t('sort_ascending') : t('sort_descending')}
                            >
                                <i className={`fas ${sortOrder === 'asc' ? 'fa-sort-up' : 'fa-sort-down'} mr-2`}></i>
                                {sortOrder === 'asc' ? t('sort_ascending') : t('sort_descending')}
                            </button>
                        </div>
                    </div>

                    {/* Sélecteur de vue */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--coya-enterprise-border)] pt-3">
                        <div className="text-sm text-[var(--coya-enterprise-muted)]">
                            {prioritizedProjects.length}{' '}
                            {prioritizedProjects.length > 1 ? t('project_found_plural') : t('project_found_singular')}
                            {searchQuery && (
                                <span className="ml-2">
                                    {t('for_search')} "{searchQuery}"
                                </span>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 text-sm text-[var(--coya-enterprise-muted)]">
                                <span>{localize('Per page', 'Par page')}</span>
                                <select
                                    value={pageSize}
                                    onChange={(e) => {
                                        setPageSize(Number(e.target.value));
                                        setPage(1);
                                    }}
                                    className="rounded-lg border border-[var(--coya-enterprise-border)] bg-white px-2 py-1 text-sm"
                                >
                                    {[5, 10, 20, 50].map((n) => (
                                        <option key={n} value={n}>
                                            {n}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <span className="text-sm text-[var(--coya-enterprise-muted)]">{t('view_label')}:</span>
                            <button
                                type="button"
                                onClick={() => setViewMode('grid')}
                                className={`rounded-lg p-2 transition-all ${
                                    viewMode === 'grid'
                                        ? 'bg-[var(--coya-institutional)] text-white shadow-sm'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                                title={t('grid_view')}
                            >
                                <i className="fas fa-th"></i>
                            </button>
                            <button
                                type="button"
                                onClick={() => setViewMode('list')}
                                className={`rounded-lg p-2 transition-all ${
                                    viewMode === 'list'
                                        ? 'bg-[var(--coya-institutional)] text-white shadow-sm'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}
                                title={t('list_view')}
                            >
                                <i className="fas fa-list"></i>
                            </button>
                        </div>
                    </div>
                </div>

                {prioritizedProjects.length > 0 ? (
                    <>
                        {viewMode === 'grid' && (
                            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                                {paginatedPrioritized.map((project) => {
                                    const cockpit = cockpitByProjectId.get(String(project.id));
                                    const insight = getProjectInsights(project);
                                    const progressPercentage = insight.progressPercentage ?? 0;
                                    const status = statusUi(project.status);
                                    const priority = priorityUi(insight.urgencyScore);
                                    const loggedMinutes = projectLoggedMinutes(project.id);
                                    
                                    return (
                                        <div
                                            key={project.id}
                                            data-testid="project-item"
                                            className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100 hover:shadow-md transition-shadow cursor-pointer"
                                            onClick={() => {
                                                onOpenProjectWorkspace(String(project.id));
                                            }}
                                        >
                                            <div className="flex items-start justify-between mb-4">
                                                <div className="flex items-center gap-3">
                                                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--coya-institutional)]">
                                                        <span className="text-white text-sm font-bold">
                                                            {(project.title || 'P').trim().charAt(0).toUpperCase()}
                                                        </span>
                                                    </div>
                                                    <div>
                                                        <p className="text-gray-500 text-xs">{String(project.id).slice(0, 8).toUpperCase()}</p>
                                                        <span className={`text-xs px-2 py-0.5 rounded-full ${priority.badge}`}>{priority.label}</span>
                                                    </div>
                                                </div>
                                                <button
                                                    type="button"
                                                    className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center"
                                                    onClick={(e) => e.stopPropagation()}
                                                    aria-label="Menu"
                                                >
                                                    <i className="fas fa-ellipsis-vertical text-gray-400 text-sm" />
                                                </button>
                                            </div>

                                            <h4 className="text-gray-900 mb-1 leading-snug">{project.title}</h4>
                                            <p className="text-gray-500 text-xs mb-4">
                                                {project.programmeName
                                                    ? `${project.programmeName}${project.programmeBailleurName ? ` · ${project.programmeBailleurName}` : ''}`
                                                    : localize('Internal / unspecified', 'Interne / non précisé')}
                                            </p>

                                            <div className="mb-4">
                                                <div className="flex justify-between mb-1.5">
                                                    <span className="text-xs text-gray-500">{localize('Progress', 'Avancement')}</span>
                                                    <span className="text-xs font-semibold text-gray-700">{progressPercentage}%</span>
                                                </div>
                                                <div className="h-2 overflow-hidden rounded-full bg-[#E2E8F0]">
                                                    <div className="h-full rounded-full bg-[var(--coya-institutional)] transition-all" style={{ width: `${progressPercentage}%` }} />
                                                </div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-3 mb-4">
                                                <div className="bg-gray-50 rounded-xl p-2.5">
                                                    <p className="text-gray-400 text-[10px]">{localize('Budget Δ', 'Budget Δ')}</p>
                                                    <p className="text-gray-700 text-xs font-medium">
                                                        {cockpit
                                                            ? `${cockpit.budgetVariance >= 0 ? '+' : ''}${Math.round(cockpit.budgetVariance).toLocaleString()} ${project.budgetCurrency || 'XOF'}`
                                                            : '—'}
                                                    </p>
                                                    {cockpit?.budgetPlannedTotal ? (
                                                        <p className="text-[10px] text-gray-400 mt-0.5">
                                                            {localize('vs plan', 'vs prév.')} {cockpit.budgetVariancePercent >= 0 ? '+' : ''}{cockpit.budgetVariancePercent.toFixed(0)}%
                                                        </p>
                                                    ) : null}
                                                </div>
                                                <div className="bg-gray-50 rounded-xl p-2.5">
                                                    <p className="text-gray-400 text-[10px]">{localize('Alerts / Sync', 'Alertes / Sync')}</p>
                                                    <p className="text-gray-700 text-xs font-medium">
                                                        {cockpit ? `${cockpit.alerts.length} ${localize('alerts', 'alertes')}` : localize('No cockpit', 'Cockpit indisponible')}
                                                    </p>
                                                    <p className="text-[10px] text-gray-400 mt-0.5">
                                                        {localize('Time logged', 'Temps loggé')}: {Math.round(loggedMinutes / 60)}h
                                                    </p>
                                                </div>
                                            </div>

                                            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                                <div className="flex items-center gap-2">
                                                    <div className="flex -space-x-1.5">
                                                        {Array.from({ length: Math.min(3, project.team.length) }).map((_, i) => (
                                                            <div key={i} className="w-6 h-6 rounded-full bg-blue-500 border-2 border-white flex items-center justify-center">
                                                                <span className="text-white text-[9px] font-bold">{String.fromCharCode(65 + i)}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                    <span className="text-gray-400 text-xs">+{project.team.length} {localize('members', 'membres')}</span>
                                                </div>
                                                <span className={`flex items-center gap-1 text-xs px-2 py-1 rounded-full ${status.badge}`}>
                                                    <i className={`fas ${status.icon} text-[10px]`} />
                                                    {status.label}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                </div>
                        )}

                        {viewMode === 'list' && (
                            <EnterpriseProjectsTable
                                projects={paginatedPrioritized}
                                localize={localize}
                                isFr={language === Language.FR}
                                isLoading={isLoading}
                                statusUi={statusUi}
                                progressPercent={progressPercentRow}
                                formatBudget={formatBudgetRow}
                                managerLabel={managerLabelRow}
                                onOpenRow={onOpenProjectWorkspace}
                                onEdit={handleOpenForm}
                                onDelete={handleRequestDeleteProject}
                                canManage={canManageProject}
                                emptyMessage={projectsTableEmptyMessage}
                            />
                        )}

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--coya-enterprise-border)] bg-white px-4 py-3 text-sm text-[var(--coya-enterprise-muted)] shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                            <span>
                                {localize('Page', 'Page')} {page} / {totalPages}
                                <span className="mx-2 opacity-40" aria-hidden>
                                    ·
                                </span>
                                {prioritizedProjects.length}{' '}
                                {localize(prioritizedProjects.length > 1 ? 'projects' : 'project', prioritizedProjects.length > 1 ? 'projets' : 'projet')}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    disabled={page <= 1 || isLoading}
                                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    className="rounded-xl border border-[var(--coya-enterprise-border)] px-3 py-1.5 font-medium text-[var(--coya-enterprise-text)] transition-colors hover:bg-[#F8FAFC] disabled:opacity-40"
                                >
                                    {localize('Previous', 'Précédent')}
                                </button>
                                <button
                                    type="button"
                                    disabled={page >= totalPages || isLoading}
                                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    className="rounded-xl border border-[var(--coya-enterprise-border)] px-3 py-1.5 font-medium text-[var(--coya-enterprise-text)] transition-colors hover:bg-[#F8FAFC] disabled:opacity-40"
                                >
                                    {localize('Next', 'Suivant')}
                                </button>
                            </div>
                        </div>

                    </>
                ) : (
                    <div className="text-center py-20 px-4 bg-white rounded-xl border border-slate-200">
                        <div className="mb-6">
                            <i className={`fas ${searchQuery || statusFilter !== 'all' ? 'fa-search' : 'fa-folder-open'} fa-5x text-gray-300`}></i>
                        </div>
                        <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                            {searchQuery || statusFilter !== 'all' 
                                ? localize('No project matches your filters', 'Aucun projet ne correspond à vos critères') 
                                : localize('No project created yet', 'Aucun projet créé pour le moment')
                            }
                        </h3>
                        <p className="text-gray-600 mb-6">
                            {searchQuery || statusFilter !== 'all'
                                ? localize('Try adjusting your search or filters', 'Essayez de modifier vos critères de recherche ou de filtrage')
                                : localize('Start by creating your first project to organize your work', 'Commencez par créer votre premier projet pour organiser votre travail')
                            }
                        </p>
                        {(searchQuery || statusFilter !== 'all') && (
                            <button 
                                onClick={() => {
                                    setSearchQuery('');
                                    setStatusFilter('all');
                                }}
                                className="bg-gray-600 text-white px-6 py-3 rounded-lg hover:bg-gray-700 transition-colors font-semibold shadow-md hover:shadow-lg mr-3"
                            >
                                <i className="fas fa-times mr-2"></i>
                                {localize('Reset filters', 'Réinitialiser les filtres')}
                            </button>
                        )}
                    {canCreateProject && (
                        <button 
                            type="button"
                            onClick={() => {
                                setProjectCreateMountKey((k) => k + 1);
                                setIsProjectCreatePageOpen(true);
                            }}
                                className="bg-emerald-600 text-white px-8 py-3 rounded-lg hover:bg-emerald-700 transition-colors font-semibold shadow-md hover:shadow-lg"
                        >
                            <i className="fas fa-plus mr-2"></i>
                            {localize('Create a new project', 'Créer un nouveau projet')}
                        </button>
                    )}
                </div>
            )}
                </>
            )}

            {retainAnalyticsDom && (
                <div
                    className={activeSection === 'analytics' ? 'block' : 'hidden'}
                    aria-hidden={activeSection !== 'analytics'}
                >
                    <ProjectsAnalytics projects={projects} />
                </div>
            )}

            {activeSection === 'tasks_week' && (
                <div className="bg-white rounded-xl shadow-lg p-6">
                    <h2 className="text-xl font-bold text-coya-text mb-4 flex items-center gap-2">
                        <i className="fas fa-calendar-week text-coya-primary" />
                        {localize('Tasks this week', 'Tâches de la semaine')}
                    </h2>
                    {tasksThisWeek.length === 0 ? (
                        <p className="text-coya-text-muted py-8 text-center">
                            {localize('No tasks due this week.', 'Aucune tâche à échéance cette semaine.')}
                        </p>
                    ) : (
                        <ul className="divide-y divide-coya-border">
                            {tasksThisWeek.map(({ project, task }) => (
                                <li key={`${project.id}-${task.id}`} className="py-4 flex items-center justify-between gap-4">
                                    <div className="flex-1 min-w-0">
                                        <p className="font-medium text-coya-text truncate">{task.text || (task as any).title}</p>
                                        <p className="text-sm text-coya-text-muted">{project.title} — {task.dueDate ? new Date(task.dueDate).toLocaleDateString(language === Language.FR ? 'fr-FR' : 'en-US') : ''}</p>
                                    </div>
                                    <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${
                                        task.status === 'Completed' ? 'bg-green-100 text-green-800' :
                                        task.status === 'In Progress' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
                                    }`}>
                                        {task.status}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => onOpenProjectWorkspace(String(project.id))}
                                        className="shrink-0 text-sm font-medium text-coya-primary hover:text-coya-primary-light"
                                    >
                                        {localize('Open project', 'Ouvrir le projet')} →
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>

            {projectToDelete && (
                <ConfirmationModal
                    title={t('delete_project')}
                    message={t('confirm_delete_message')}
                    onConfirm={handleDeleteProject}
                    onCancel={() => setProjectToDelete(null)}
                />
            )}
        </WorkspaceShell>
        {typeof document !== 'undefined' &&
            isProjectCreatePageOpen &&
            createPortal(
                <ProjectCreatePage
                    key={projectCreateMountKey}
                    onClose={() => {
                        setIsProjectCreatePageOpen(false);
                        setEditingProject(null);
                    }}
                    onSave={handleSaveProject}
                    users={users}
                    editingProject={editingProject}
                />,
                document.body,
            )}
        </Fragment>
    );
};

export default Projects;
