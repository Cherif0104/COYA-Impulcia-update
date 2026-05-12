import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { Project, User, TimeLog, Objective, ProjectAttachment, MANAGEMENT_ROLES, Role, ProjectBudgetLine, Task, SUPPORTED_CURRENCIES, TASK_SCORE_PERCENT_EMPLOYEE, TASK_SCORE_PERCENT_MANAGER, Language, RESOURCE_MANAGEMENT_ROLES } from '../types';
import { NAV_SESSION_OPEN_PROGRAMME_ID, NAV_SESSION_PROGRAMMES_PROJECTS_TAB, NAV_QUERY_MOBILITE_PROJECT_ID } from '../contexts/AppNavigationContext';
import { applyProjectTasksAutoClose, getTaskGovernance, isTaskScheduledFrozen as isTaskFrozen } from '../utils/projectTaskLifecycle';
import { buildProjectCockpitReadModel } from '../services/projectCockpitReadModel';
import { applyTaskStatusChange, dispatchProjectDomainEvents } from '../services/domain';
import {
    ObjectWorkspaceFloorplan,
    KPIStrip,
    PillTabs,
    WorkspaceRouteShell,
    WorkspaceTopBar,
    WorkspaceBackButton,
    WorkspaceBreadcrumbs,
    WorkspaceSection,
    TimelineEmptyState,
    type KPIStripItem,
    type WorkspaceBreadcrumbItem,
} from '../ui-runtime';
import LogTimeModal from './LogTimeModal';
import ProjectCreatePage from './ProjectCreatePage';
import ObjectivesBlock from './ObjectivesBlock';
import ConfirmationModal from './common/ConfirmationModal';
import DataAdapter from '../services/dataAdapter';
import { syncProjectTasksToPlanningSlots } from '../services/planning/projectTaskPlanningSync';
import { ProjectWorkspaceProvider, type ProjectWorkspaceContextValue } from '../contexts/project-workspace';
import { HistoryWorkspaceTab } from './project/workspace/HistoryWorkspaceTab';
import { TasksWorkspaceTab } from './project/workspace/TasksWorkspaceTab';
import { ProjectWorkspaceHero } from './project/workspace/ProjectWorkspaceHero';
import type { ProjectWorkspaceTab } from './project/workspace/types';
import { useProjectModuleSettings } from '../hooks/useProjectModuleSettings';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { EnterpriseDonutRing, type EnterpriseDonutSegment } from './program-projects/enterprise/EnterpriseDonutRing';
import { EnterpriseFinanceKpiStrip, type EnterpriseFinanceKpiItem } from './program-projects/enterprise/EnterpriseFinanceKpiStrip';
import jsPDF from 'jspdf';
const PROJECT_MANAGEMENT_ROLES: Role[] = [
    'super_administrator',
    'administrator',
    'manager',
];

const TASK_TITLE_MIN = 8;
const TASK_TITLE_MAX = 120;

export type ProjectObjectWorkspaceProps = {
    project: Project;
    onClose: () => void;
    onUpdateProject: (project: Project) => void;
    onDeleteProject: (projectId: string) => void;
    onAddTimeLog: (log: Omit<TimeLog, 'id' | 'userId'>) => void;
    timeLogs: TimeLog[];
    objectives?: Objective[];
    setView?: (view: string) => void;
    /** Pour le wizard « Modifier le projet » (métadonnées / équipe / rattachements) */
    users?: User[];
};

const ProjectObjectWorkspace: React.FC<ProjectObjectWorkspaceProps> = ({
    project,
    onClose,
    onUpdateProject,
    onDeleteProject,
    onAddTimeLog,
    timeLogs,
    objectives = [],
    setView,
    users = [],
}) => {
    const { t, language } = useLocalization();
    const isFr = language === Language.FR;
    const { user: currentUser } = useAuth();
    const { hasPermission } = useModulePermissions();
    const [currentProject, setCurrentProject] = useState(project);
    /** Évite les boucles onUpdateProject quand la clôture auto des tâches ne se stabilise pas côté parent. */
    const lastAutoCloseEmittedSigRef = useRef<string | null>(null);
    const [workspaceTab, setWorkspaceTab] = useState<ProjectWorkspaceTab>('cockpit');
    const [isLogTimeModalOpen, setLogTimeModalOpen] = useState(false);
    const [isDeleteModalOpen, setDeleteModalOpen] = useState(false);
    const [isProjectMetaWizardOpen, setProjectMetaWizardOpen] = useState(false);

    // Vérification des permissions pour gérer le projet (modifier/supprimer)
    const canManageProject = useMemo(() => {
        if (!currentUser || !currentProject) return false;
        const isCreator = currentProject.createdById?.toString() === currentUser.id?.toString();
        const hasRole = PROJECT_MANAGEMENT_ROLES.includes(currentUser.role);
        const canWriteProject = hasPermission('projects', 'write');
        return isCreator || hasRole || canWriteProject;
    }, [currentUser, currentProject, hasPermission]);

    /** Création / structure des tâches (période, consigne, réaffectation) : aligné module Programme. */
    const canGovernTasks = useMemo(
        () => !!currentUser && RESOURCE_MANAGEMENT_ROLES.includes(currentUser.role),
        [currentUser],
    );

    const [isLoading, setIsLoading] = useState(false);
    const [pendingTasks, setPendingTasks] = useState<any[]>([]);
    const [pendingRisks, setPendingRisks] = useState<any[]>([]);
    const [hasPendingChanges, setHasPendingChanges] = useState(false);
    const [generatedReport, setGeneratedReport] = useState<string>('');
    const [taskSummary, setTaskSummary] = useState<string>('');
    const [committeeReport, setCommitteeReport] = useState<string>('');
    const [savedReports, setSavedReports] = useState<any[]>([]);
    const [savedTaskSummaries, setSavedTaskSummaries] = useState<any[]>([]);
    const [savedCommitteeReports, setSavedCommitteeReports] = useState<any[]>([]);
    const { settings: projectSettings } = useProjectModuleSettings();
    const requireJustification = projectSettings?.requireJustificationForCompletion !== false;

    // États pour la gestion des tâches
    const [newTaskText, setNewTaskText] = useState('');
    const [newTaskDueDate, setNewTaskDueDate] = useState('');
    const [newTaskPriority, setNewTaskPriority] = useState<'Low' | 'Medium' | 'High'>('Medium');
    const [newTaskAssignee, setNewTaskAssignee] = useState<string>('');
    const [newTaskScheduledDate, setNewTaskScheduledDate] = useState('');
    const [newTaskScheduledTime, setNewTaskScheduledTime] = useState('');
    const [newTaskScheduledDuration, setNewTaskScheduledDuration] = useState<number>(60);
    const [newTaskSmartCriteria, setNewTaskSmartCriteria] = useState<{ specific?: string; measurable?: string; achievable?: string; relevant?: string; timeBound?: string }>({});
    const [newTaskPeriodStart, setNewTaskPeriodStart] = useState('');
    const [newTaskPeriodEnd, setNewTaskPeriodEnd] = useState('');
    const [newTaskManagerComment, setNewTaskManagerComment] = useState('');
    const [taskSearch, setTaskSearch] = useState('');
    const [taskStatusFilter, setTaskStatusFilter] = useState<'all' | Task['status']>('all');
    const [taskPriorityFilter, setTaskPriorityFilter] = useState<'all' | Task['priority']>('all');
    const [taskAssigneeFilter, setTaskAssigneeFilter] = useState<'all' | 'unassigned' | string>('all');
    const [taskSortBy, setTaskSortBy] = useState<'dueDate' | 'priority' | 'status'>('dueDate');
    const [taskViewMode, setTaskViewMode] = useState<'table' | 'kanban'>('table');
    const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
    const [kanbanDraggingTaskId, setKanbanDraggingTaskId] = useState<string | null>(null);
    const [newRiskDescription, setNewRiskDescription] = useState('');
    const [newRiskLikelihood, setNewRiskLikelihood] = useState<'High' | 'Medium' | 'Low'>('Medium');
    const [newRiskImpact, setNewRiskImpact] = useState<'High' | 'Medium' | 'Low'>('Medium');
    const [newRiskMitigation, setNewRiskMitigation] = useState('');
    const [newRiskOwnerId, setNewRiskOwnerId] = useState('');
    const [newRiskDueDate, setNewRiskDueDate] = useState('');
    const [newRiskStatus, setNewRiskStatus] = useState<'open' | 'mitigating' | 'closed'>('open');
    const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
    const [attachmentsLoading, setAttachmentsLoading] = useState(false);
    const [uploadingAttachment, setUploadingAttachment] = useState(false);
    /** API / schéma pièces jointes indisponible : masquer l’UI plutôt que fallback silencieux répété. */
    const [projectAttachmentsUnavailable, setProjectAttachmentsUnavailable] = useState(false);
    /** Inspecteur workspace : détail tâche sélectionnée (progressive disclosure). */
    const [inspectorTaskId, setInspectorTaskId] = useState<string | null>(null);
    /** Formulaire création tâche : panneau latéral (évite le bloc permanent). */
    const [isAddTaskDrawerOpen, setIsAddTaskDrawerOpen] = useState(false);

    // Fonction utilitaire pour convertir une date ISO en format yyyy-MM-dd pour les champs input date
    const formatDateForInput = (dateString?: string): string => {
        if (!dateString) return '';
        try {
            // Si c'est déjà au format yyyy-MM-dd, le retourner tel quel
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
                return dateString;
            }
            // Sinon, convertir depuis ISO en yyyy-MM-dd
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return '';
            return date.toISOString().split('T')[0];
        } catch {
            return '';
        }
    };

    const loadProjectReports = useCallback(async () => {
        try {
            const reports = await DataAdapter.getProjectReports(project.id);
            const statusReports = reports.filter(r => r.type === 'status_report');
            const taskSummaries = reports.filter(r => r.type === 'task_summary');
            const committeeReports = reports.filter(r => r.type === 'committee_report');
            
            setSavedReports(statusReports.map(r => ({
                id: r.id,
                title: r.title,
                content: r.content,
                createdAt: new Date(r.created_at).toLocaleString('fr-FR'),
                type: r.type
            })));
            
            setSavedTaskSummaries(taskSummaries.map(r => ({
                id: r.id,
                title: r.title,
                content: r.content,
                createdAt: new Date(r.created_at).toLocaleString('fr-FR'),
                type: r.type
            })));
            setSavedCommitteeReports(committeeReports.map(r => ({
                id: r.id,
                title: r.title,
                content: r.content,
                createdAt: new Date(r.created_at).toLocaleString('fr-FR'),
                type: r.type
            })));
        } catch (error) {
            console.error('Erreur lors du chargement des rapports:', error);
        }
    }, [project.id]);

    useEffect(() => {
        const tasks = applyProjectTasksAutoClose(project.tasks || []);
        const incomingSig = JSON.stringify(project.tasks ?? []);
        const processedSig = JSON.stringify(tasks);
        const merged = { ...project, tasks };
        setCurrentProject(merged);

        if (processedSig !== incomingSig) {
            if (lastAutoCloseEmittedSigRef.current !== processedSig) {
                lastAutoCloseEmittedSigRef.current = processedSig;
                queueMicrotask(() => {
                    onUpdateProject(merged);
                });
            }
        } else {
            lastAutoCloseEmittedSigRef.current = null;
        }
    }, [project, onUpdateProject]);

    useEffect(() => {
        void loadProjectReports();
    }, [loadProjectReports]);

    const tasksPlanningSyncSig = useMemo(
        () => `${currentProject.id}|${JSON.stringify(currentProject.tasks ?? [])}`,
        [currentProject.id, currentProject.tasks],
    );

    const flushPlanningSlotSync = useCallback((project: Project) => {
        void syncProjectTasksToPlanningSlots(project).catch(() => {});
    }, []);

    useEffect(() => {
        const t = window.setTimeout(() => {
            void syncProjectTasksToPlanningSlots(currentProject).catch(() => {});
        }, 600);
        return () => window.clearTimeout(t);
    }, [tasksPlanningSyncSig, currentProject]);

    const loadAttachments = useCallback(async () => {
        if (!currentProject?.id || projectAttachmentsUnavailable) return;
        setAttachmentsLoading(true);
        try {
            const list = await DataAdapter.getProjectAttachments(currentProject.id);
            setAttachments(list);
        } catch (e) {
            console.error('Erreur chargement pièces jointes:', e);
            setProjectAttachmentsUnavailable(true);
            setAttachments([]);
        } finally {
            setAttachmentsLoading(false);
        }
    }, [currentProject?.id, projectAttachmentsUnavailable]);

    useEffect(() => {
        if (projectAttachmentsUnavailable) return;
        if (workspaceTab === 'team' || workspaceTab === 'tasks' || workspaceTab === 'documents')
            void loadAttachments();
    }, [workspaceTab, currentProject?.id, projectAttachmentsUnavailable, loadAttachments]);

    const handleSaveTimeLog = (log: Omit<TimeLog, 'id' | 'userId'>) => {
        onAddTimeLog(log);
        setLogTimeModalOpen(false);
    };

    const handleUploadAttachment = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !currentProject?.id) return;
        e.target.value = '';
        setUploadingAttachment(true);
        try {
            const created = await DataAdapter.uploadProjectAttachment(currentProject.id, file);
            if (created) setAttachments(prev => [created, ...prev]);
        } catch (err) {
            console.error('Erreur upload pièce jointe:', err);
            alert('Impossible d’ajouter le fichier. Vérifiez que le bucket Supabase "project-attachments" existe.');
        } finally {
            setUploadingAttachment(false);
        }
    };

    const handleDeleteAttachment = async (attachmentId: string) => {
        if (!confirm('Supprimer cette pièce jointe ?')) return;
        try {
            await DataAdapter.deleteProjectAttachment(attachmentId);
            setAttachments(prev => prev.filter(a => a.id !== attachmentId));
        } catch (err) {
            console.error('Erreur suppression pièce jointe:', err);
        }
    };

    const handleDownloadAttachment = async (a: ProjectAttachment) => {
        try {
            const url = await DataAdapter.getProjectAttachmentDownloadUrl(a.filePath);
            if (url) window.open(url, '_blank');
        } catch (err) {
            console.error('Erreur téléchargement:', err);
        }
    };

    const projectTimeLogs = timeLogs.filter(log => 
        log.entityType === 'project' && log.entityId === project.id
    );

    const totalLoggedHours = projectTimeLogs.reduce((sum, log) => sum + ((Number(log.duration) || 0) / 60), 0);

    // Vérifier si l'utilisateur appartient à l'équipe de gestion
    const isSenegalTeam = currentUser?.role && MANAGEMENT_ROLES.includes(currentUser.role);

    // Fonction pour calculer les métriques de charge de travail par rôle
    const getTeamWorkloadMetrics = () => {
        const roleMetrics: { [key: string]: any } = {};

        if (!currentProject.team || currentProject.team.length === 0) {
            return [
                {
                    role: 'Manager',
                    memberCount: 1,
                    taskCount: 3,
                    estimatedHours: 24,
                    loggedHours: 12
                },
                {
                    role: 'Student',
                    memberCount: 2,
                    taskCount: 5,
                    estimatedHours: 40,
                    loggedHours: 20
                }
            ];
        }

        // Initialiser les métriques pour chaque rôle
        currentProject.team.forEach(member => {
            if (!roleMetrics[member.role]) {
                roleMetrics[member.role] = {
                    role: member.role,
                    members: [],
                    taskCount: 0,
                    estimatedHours: 0,
                    loggedHours: 0
                };
            }
            roleMetrics[member.role].members.push(member);
        });

        // Calculer les métriques pour chaque tâche
        (currentProject.tasks || []).forEach(task => {
            if (task.assignee) {
                const role = task.assignee.role;
                if (roleMetrics[role]) {
                    roleMetrics[role].taskCount += 1;
                    roleMetrics[role].estimatedHours += task.estimatedHours || 0;
                    roleMetrics[role].loggedHours += task.loggedHours || 0;
                }
            }
        });

        // Convertir en tableau et ajouter le nombre de membres
        const result = Object.values(roleMetrics).map((roleData: any) => ({
            ...roleData,
            memberCount: roleData.members.length
        }));
        
        return result;
    };

    const handleUpdateTask = (taskId: string, updates: any) => {
        const result = applyTaskStatusChange(currentProject, taskId, updates, {
            organizationId: currentUser?.organizationId ?? null,
            actorId: currentUser?.id != null ? String(currentUser.id) : null,
            canGovernTasks,
        });
        if (result.ok === false) {
            if (!result.silent && (result.errorFr || result.errorEn)) {
                alert(isFr ? result.errorFr : result.errorEn);
            }
            return;
        }
        setCurrentProject(result.updatedProject);
        onUpdateProject(result.updatedProject);
        flushPlanningSlotSync(result.updatedProject);
        if (result.statusDomainEvents.length > 0) {
            dispatchProjectDomainEvents(result.statusDomainEvents, {
                project: result.updatedProject,
                timeLogs,
                objectives,
            });
        }
    };

    const handleAddTask = () => {
        if (!canGovernTasks) {
            alert('Seuls les rôles autorisés (manager, superviseur, formateur, administrateur…) peuvent créer des tâches.');
            return;
        }
        const title = newTaskText.trim();
        if (!title) return;
        if (title.length < TASK_TITLE_MIN || title.length > TASK_TITLE_MAX) {
            alert(`Le titre de la tâche doit contenir entre ${TASK_TITLE_MIN} et ${TASK_TITLE_MAX} caractères.`);
            return;
        }
        if (!newTaskAssignee.trim()) {
            alert(isFr ? 'Assignez la tâche à une personne (participant obligatoire).' : 'Assign the task to a person (required).');
            return;
        }

        const periodEnd = newTaskPeriodEnd.trim() || newTaskDueDate.trim();
        const newTask: Task = {
            id: `task-${Date.now()}`,
            text: title,
            status: 'To Do' as const,
            priority: newTaskPriority,
            dueDate: newTaskDueDate || periodEnd || undefined,
            periodStart: newTaskPeriodStart || undefined,
            periodEnd: periodEnd || undefined,
            managerComment: newTaskManagerComment.trim() || undefined,
            taskGovernance: 'open',
            assignee: currentProject.team?.find(m => m.id === newTaskAssignee),
            estimatedHours: 8,
            loggedHours: 0,
            scheduledDate: newTaskScheduledDate || undefined,
            scheduledTime: newTaskScheduledTime || undefined,
            scheduledDurationMinutes: newTaskScheduledDuration || undefined,
            smartCriteria: Object.keys(newTaskSmartCriteria).some(k => (newTaskSmartCriteria as any)[k]) ? newTaskSmartCriteria : undefined,
        };

        const updatedProject = {
            ...currentProject,
            tasks: [...(currentProject.tasks || []), newTask],
        };

        setCurrentProject(updatedProject);
        onUpdateProject(updatedProject);
        flushPlanningSlotSync(updatedProject);
        setIsAddTaskDrawerOpen(false);

        setNewTaskText('');
        setNewTaskDueDate('');
        setNewTaskPriority('Medium');
        setNewTaskAssignee('');
        setNewTaskPeriodStart('');
        setNewTaskPeriodEnd('');
        setNewTaskManagerComment('');
        setNewTaskScheduledDate('');
        setNewTaskScheduledTime('');
        setNewTaskScheduledDuration(60);
    };

    const handleDeleteTask = (taskId: string) => {
        if (!canGovernTasks) return;
        const updatedTasks = (currentProject.tasks || []).filter(task => task.id !== taskId);
        const updatedProject = { ...currentProject, tasks: updatedTasks };
        setCurrentProject(updatedProject);
        onUpdateProject(updatedProject);
        flushPlanningSlotSync(updatedProject);
    };

    const toggleTaskSelection = (taskId: string) => {
        setSelectedTaskIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
    };

    const toggleSelectAllFilteredTasks = (checked: boolean, filteredIds: string[]) => {
        if (checked) {
            setSelectedTaskIds((prev) => Array.from(new Set([...prev, ...filteredIds])));
            return;
        }
        setSelectedTaskIds((prev) => prev.filter((id) => !filteredIds.includes(id)));
    };

    const bulkUpdateSelectedTasks = (updater: (task: Task) => Task) => {
        if (selectedTaskIds.length === 0) return;
        const selected = new Set(selectedTaskIds);
        const updatedTasks = (currentProject.tasks || []).map((task) => (selected.has(task.id) ? updater(task) : task));
        const updatedProject = { ...currentProject, tasks: updatedTasks };
        setCurrentProject(updatedProject);
        onUpdateProject(updatedProject);
        flushPlanningSlotSync(updatedProject);
    };

    const commitProjectTasks = useCallback(
        (tasks: Task[]) => {
            const updatedProject = { ...currentProject, tasks };
            setCurrentProject(updatedProject);
            void onUpdateProject(updatedProject);
            flushPlanningSlotSync(updatedProject);
        },
        [currentProject, onUpdateProject, flushPlanningSlotSync],
    );

    const handleKanbanDrop = (targetStatus: Task['status']) => {
        if (!kanbanDraggingTaskId) return;
        const draggedTask = (currentProject.tasks || []).find((task) => task.id === kanbanDraggingTaskId);
        if (!draggedTask) return;
        const g = getTaskGovernance(draggedTask);
        if (g === 'not_realized' || g === 'closed_out') {
            setKanbanDraggingTaskId(null);
            return;
        }
        if (targetStatus === 'Completed' && requireJustification) {
            const hasJustif = (draggedTask.justificationAttachmentIds?.length ?? 0) > 0;
            if (!hasJustif) {
                alert('Justificatif obligatoire : liez au moins une pièce jointe avant de marquer comme Réalisé.');
                setKanbanDraggingTaskId(null);
                return;
            }
        }
        const updates: Partial<Task> = { status: targetStatus };
        if (targetStatus === 'Completed') {
            updates.completedAt = new Date().toISOString();
            updates.completedById = currentUser?.id != null ? String(currentUser.id) : undefined;
            updates.isFrozen = false;
        }
        handleUpdateTask(kanbanDraggingTaskId, updates);
        setKanbanDraggingTaskId(null);
    };

    const handleUpdateRisk = (riskId: string, updates: any) => {
        const updatedRisks = (currentProject.risks || []).map(risk =>
            risk.id === riskId ? { ...risk, ...updates } : risk
        );
        
        const updatedProject = {
            ...currentProject,
            risks: updatedRisks
        };
        
        setCurrentProject(updatedProject);
        onUpdateProject(updatedProject);
    };

    const handleDeleteRisk = (riskId: string) => {
        const updatedRisks = (currentProject.risks || []).filter(risk => risk.id !== riskId);
        const updatedProject = { ...currentProject, risks: updatedRisks };
        setCurrentProject(updatedProject);
        onUpdateProject(updatedProject);
    };

    const handleAddRisk = () => {
        if (!newRiskDescription.trim()) return;
        const newRisk = {
            id: `risk-${Date.now()}`,
            description: newRiskDescription.trim(),
            likelihood: newRiskLikelihood,
            impact: newRiskImpact,
            mitigationStrategy: newRiskMitigation.trim(),
            ownerId: newRiskOwnerId || undefined,
            dueDate: newRiskDueDate || undefined,
            status: newRiskStatus,
        };
        const updatedProject = {
            ...currentProject,
            risks: [...(currentProject.risks || []), newRisk]
        };
        setCurrentProject(updatedProject);
        onUpdateProject(updatedProject);
        setNewRiskDescription('');
        setNewRiskLikelihood('Medium');
        setNewRiskImpact('Medium');
        setNewRiskMitigation('');
        setNewRiskOwnerId('');
        setNewRiskDueDate('');
        setNewRiskStatus('open');
    };

    const getRiskLevel = (likelihood: string, impact: string) => {
        if (likelihood === 'High' && impact === 'High') return 'High';
        if (likelihood === 'High' || impact === 'High') return 'Medium';
        return 'Low';
    };

    const handleUpdateBudget = (updates: { budgetPlanned?: number; budgetCurrency?: string; budgetLines?: ProjectBudgetLine[] }) => {
        const updated = { ...currentProject, ...updates };
        setCurrentProject(updated);
        onUpdateProject(updated);
    };

    const handleAddBudgetLine = () => {
        const lines = currentProject.budgetLines || [];
        const newLine: ProjectBudgetLine = {
            id: `bl-${Date.now()}`,
            label: '',
            plannedAmount: 0,
            realAmount: 0,
            currency: (currentProject.budgetCurrency as any) || 'XOF',
        };
        handleUpdateBudget({ budgetLines: [...lines, newLine] });
    };

    const handleUpdateBudgetLine = (id: string, patch: Partial<ProjectBudgetLine>) => {
        const lines = (currentProject.budgetLines || []).map((l) => (l.id === id ? { ...l, ...patch } : l));
        handleUpdateBudget({ budgetLines: lines });
    };

    const handleRemoveBudgetLine = (id: string) => {
        const lines = (currentProject.budgetLines || []).filter((l) => l.id !== id);
        handleUpdateBudget({ budgetLines: lines });
    };

    const handleIdentifyRisksWithAI = async () => {
        setIsLoading(true);
        // Simulation de génération de risques par IA
        setTimeout(() => {
            const aiRisks = [
                {
                    id: `ai-risk-${Date.now()}-1`,
                    description: 'Retard dans la livraison des contenus créatifs due aux changements de dernière minute',
                    likelihood: 'High' as const,
                    impact: 'Medium' as const,
                    mitigationStrategy: 'Établir des deadlines fermes et un processus d\'approbation accéléré pour les révisions mineures'
                },
                {
                    id: `ai-risk-${Date.now()}-2`,
                    description: 'Dépassement du budget publicitaire dû à l\'augmentation des coûts des plateformes',
                    likelihood: 'Medium' as const,
                    impact: 'High' as const,
                    mitigationStrategy: 'Surveiller quotidiennement les dépenses et ajuster les enchères en temps réel'
                },
                {
                    id: `ai-risk-${Date.now()}-3`,
                    description: 'Faible engagement sur les réseaux sociaux due à la saturation du marché',
                    likelihood: 'Medium' as const,
                    impact: 'Medium' as const,
                    mitigationStrategy: 'Diversifier les canaux de communication et tester de nouveaux formats créatifs'
                },
                {
                    id: `ai-risk-${Date.now()}-4`,
                    description: 'Problèmes techniques lors du webinar de lancement',
                    likelihood: 'Low' as const,
                    impact: 'High' as const,
                    mitigationStrategy: 'Effectuer des tests techniques complets et avoir un plan de secours avec une plateforme alternative'
                },
                {
                    id: `ai-risk-${Date.now()}-5`,
                    description: 'Conflit de calendrier avec les membres de l\'équipe sur des tâches critiques',
                    likelihood: 'Medium' as const,
                    impact: 'Medium' as const,
                    mitigationStrategy: 'Établir des priorités claires et avoir des ressources de secours identifiées'
                }
            ];

            // Stocker les risques générés temporairement
            setPendingRisks(aiRisks.map((risk) => ({
                ...risk,
                ownerId: undefined,
                dueDate: undefined,
                status: 'open' as const,
            })));
            setHasPendingChanges(true);
            setIsLoading(false);
        }, 2500);
    };

    const handleSavePendingRisks = async () => {
        if (pendingRisks.length > 0) {
            const updatedProject = {
                ...currentProject,
                risks: [...(currentProject.risks || []), ...pendingRisks]
            };
            
            setCurrentProject(updatedProject);
            await onUpdateProject(updatedProject);
            
            // Nettoyer les données temporaires
            setPendingRisks([]);
            setHasPendingChanges(false);
        }
    };

    const handleCancelPendingRisks = () => {
        setPendingRisks([]);
        setHasPendingChanges(false);
    };

    const handleSummarizeTasks = async () => {
        setIsLoading(true);
        // Simulation de génération de résumé par IA
        setTimeout(() => {
            const tasks = currentProject.tasks || [];
            const completedTasks = tasks.filter(task => task.status === 'Completed');
            const inProgressTasks = tasks.filter(task => task.status === 'In Progress');
            const todoTasks = tasks.filter(task => task.status === 'To Do');
            const overdueTasks = tasks.filter(task => task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'Completed');
            
            const totalEstimatedHours = tasks.reduce((sum, task) => sum + (task.estimatedHours || 0), 0);
            const totalLoggedHours = tasks.reduce((sum, task) => sum + (task.loggedHours || 0), 0);
            
            const summary = {
                id: `summary-${Date.now()}`,
                projectTitle: currentProject.title,
                totalTasks: tasks.length,
                completedTasks: completedTasks.length,
                inProgressTasks: inProgressTasks.length,
                todoTasks: todoTasks.length,
                overdueTasks: overdueTasks.length,
                totalEstimatedHours,
                totalLoggedHours,
                progressPercentage: tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
                generatedAt: new Date().toLocaleString('fr-FR')
            };

            // Stocker le résumé dans l'état pour l'afficher dans l'interface
            const summaryText = `📊 RÉSUMÉ DES TÂCHES - ${summary.projectTitle}

✅ Tâches terminées: ${summary.completedTasks}/${summary.totalTasks} (${summary.progressPercentage}%)
🔄 Tâches en cours: ${summary.inProgressTasks}
📋 Tâches à faire: ${summary.todoTasks}
⚠️ Tâches en retard: ${summary.overdueTasks}

⏱️ Heures estimées: ${summary.totalEstimatedHours}h
⏱️ Heures enregistrées: ${summary.totalLoggedHours}h

📅 Résumé généré le: ${summary.generatedAt}`;

            setTaskSummary(summaryText);
            setIsLoading(false);
        }, 1500);
    };

    const handleGenerateStatusReport = async () => {
        setIsLoading(true);
        // Simulation de génération de rapport d'état par IA
        setTimeout(() => {
            const tasks = currentProject.tasks || [];
            const risks = currentProject.risks || [];
            const completedTasks = tasks.filter(task => task.status === 'Completed');
            const highPriorityTasks = tasks.filter(task => task.priority === 'High');
            const highRiskItems = risks.filter(risk => getRiskLevel(risk.likelihood, risk.impact) === 'High');
            
            const report = {
                id: `report-${Date.now()}`,
                projectTitle: currentProject.title,
                status: currentProject.status,
                dueDate: currentProject.dueDate,
                teamSize: currentProject.team.length,
                totalTasks: tasks.length,
                completedTasks: completedTasks.length,
                progressPercentage: tasks.length > 0 ? Math.round((completedTasks.length / tasks.length) * 100) : 0,
                highPriorityTasks: highPriorityTasks.length,
                totalRisks: risks.length,
                highRiskItems: highRiskItems.length,
                generatedAt: new Date().toLocaleString('fr-FR')
            };

            // Stocker le rapport dans l'état pour l'afficher dans l'interface
            const reportText = `📋 RAPPORT D'ÉTAT - ${report.projectTitle}

📊 ÉTAT DU PROJET
• Statut: ${report.status}
• Date d'échéance: ${report.dueDate ? new Date(report.dueDate).toLocaleDateString('fr-FR') : 'Non définie'}
• Équipe: ${report.teamSize} membres

📈 PROGRESSION
• Progression: ${report.progressPercentage}%
• Tâches terminées: ${report.completedTasks}/${report.totalTasks}
• Tâches prioritaires: ${report.highPriorityTasks}

⚠️ RISQUES
• Total des risques: ${report.totalRisks}
• Risques élevés: ${report.highRiskItems}

📅 Rapport généré le: ${report.generatedAt}`;

            setGeneratedReport(reportText);
            setIsLoading(false);
        }, 2000);
    };

    const handleGenerateTasksWithAI = async () => {
        setIsLoading(true);
        // Simulation de génération de tâches par IA
        setTimeout(() => {
            const aiTasks = [
                {
                    id: `ai-task-${Date.now()}-1`,
                    text: 'Finalize key messaging and positioning strategy',
                    status: 'Completed',
                    priority: 'High' as const,
                    dueDate: '2024-10-15',
                    assignee: currentProject.team[0],
                    estimatedHours: 8,
                    loggedHours: 6
                },
                {
                    id: `ai-task-${Date.now()}-2`,
                    text: 'Develop social media content calendar',
                    status: 'Completed',
                    priority: 'High' as const,
                    dueDate: '2024-10-20',
                    assignee: currentProject.team[1] || currentProject.team[0],
                    estimatedHours: 12,
                    loggedHours: 15
                },
                {
                    id: `ai-task-${Date.now()}-3`,
                    text: 'Create video testimonials and case studies',
                    status: 'To Do',
                    priority: 'Medium' as const,
                    dueDate: '2024-11-05',
                    assignee: currentProject.team[2] || currentProject.team[0],
                    estimatedHours: 16,
                    loggedHours: 4.5
                },
                {
                    id: `ai-task-${Date.now()}-4`,
                    text: 'Organize launch webinar and virtual event',
                    status: 'To Do',
                    priority: 'High' as const,
                    dueDate: '2024-12-01',
                    assignee: undefined,
                    estimatedHours: 40,
                    loggedHours: 0
                },
                {
                    id: `ai-task-${Date.now()}-5`,
                    text: 'Develop core messaging and value propositions',
                    status: 'To Do',
                    priority: 'High' as const,
                    dueDate: undefined,
                    assignee: currentProject.team[0],
                    estimatedHours: 0,
                    loggedHours: 0
                },
                {
                    id: `ai-task-${Date.now()}-6`,
                    text: 'Design campaign visual assets and graphics',
                    status: 'To Do',
                    priority: 'High' as const,
                    dueDate: undefined,
                    assignee: currentProject.team[1] || currentProject.team[0],
                    estimatedHours: 0,
                    loggedHours: 0
                },
                {
                    id: `ai-task-${Date.now()}-7`,
                    text: 'Create content for social media platforms',
                    status: 'To Do',
                    priority: 'Medium' as const,
                    dueDate: undefined,
                    assignee: currentProject.team[2] || currentProject.team[0],
                    estimatedHours: 0,
                    loggedHours: 0
                }
            ];

            // Stocker les tâches générées temporairement
            setPendingTasks(aiTasks);
            setHasPendingChanges(true);
            setIsLoading(false);
        }, 2000);
    };

    const handleSavePendingTasks = async () => {
        if (pendingTasks.length > 0) {
            const updatedProject = {
                ...currentProject,
                tasks: [...(currentProject.tasks || []), ...pendingTasks]
            };
            
            setCurrentProject(updatedProject);
            await onUpdateProject(updatedProject);
            flushPlanningSlotSync(updatedProject);
            
            // Nettoyer les données temporaires
            setPendingTasks([]);
            setHasPendingChanges(false);
        }
    };

    const handleCancelPendingTasks = () => {
        setPendingTasks([]);
        setHasPendingChanges(false);
    };

    // Fonctions pour la gestion des rapports
    const handleSaveReport = async () => {
        if (generatedReport && currentUser) {
            try {
                const reportData = {
                    projectId: currentProject.id,
                    title: `Rapport d'état - ${new Date().toLocaleDateString('fr-FR')}`,
                    content: generatedReport,
                    type: 'status_report',
                    createdBy: currentUser.email
                };
                
                await DataAdapter.createProjectReport(reportData);
                setGeneratedReport('');
                await loadProjectReports(); // Recharger les rapports depuis la DB
            } catch (error) {
                console.error('Erreur lors de la sauvegarde du rapport:', error);
                alert('Erreur lors de la sauvegarde du rapport');
            }
        }
    };

    const handleSaveTaskSummary = async () => {
        if (taskSummary && currentUser) {
            try {
                const summaryData = {
                    projectId: currentProject.id,
                    title: `Résumé des tâches - ${new Date().toLocaleDateString('fr-FR')}`,
                    content: taskSummary,
                    type: 'task_summary',
                    createdBy: currentUser.email
                };
                
                await DataAdapter.createProjectReport(summaryData);
                setTaskSummary('');
                await loadProjectReports(); // Recharger les rapports depuis la DB
            } catch (error) {
                console.error('Erreur lors de la sauvegarde du résumé:', error);
                alert('Erreur lors de la sauvegarde du résumé');
            }
        }
    };

    const handleGenerateCommitteeReport = async () => {
        setIsLoading(true);
        setTimeout(() => {
            const tasks = currentProject.tasks || [];
            const risks = currentProject.risks || [];
            const completedTasks = tasks.filter(task => task.status === 'Completed').length;
            const progress = tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0;
            const openRisks = risks.filter((risk: any) => (risk.status || 'open') !== 'closed').length;
            const criticalOpenRisks = risks.filter((risk: any) => {
                const lvl = getRiskLevel(risk.likelihood, risk.impact);
                const status = risk.status || 'open';
                return status !== 'closed' && lvl === 'High';
            }).length;
            const planned = (currentProject.budgetLines || []).reduce((sum, line) => sum + (line.plannedAmount || 0), 0);
            const real = (currentProject.budgetLines || []).reduce((sum, line) => sum + (line.realAmount || 0), 0);
            const variance = real - planned;
            const variancePercent = planned > 0 ? (variance / planned) * 100 : 0;

            const content = `RAPPORT COMITÉ PMO - ${currentProject.title}

1) EXECUTIVE SNAPSHOT
- Statut projet: ${currentProject.status}
- Progression: ${progress}% (${completedTasks}/${tasks.length} tâches)
- Échéance: ${currentProject.dueDate ? new Date(currentProject.dueDate).toLocaleDateString('fr-FR') : 'Non définie'}

2) RISQUES
- Risques ouverts: ${openRisks}
- Risques critiques ouverts: ${criticalOpenRisks}
- Risques clos: ${risks.filter((risk: any) => (risk.status || 'open') === 'closed').length}

3) BUDGET
- Prévu: ${planned.toLocaleString()} ${currentProject.budgetCurrency || 'XOF'}
- Réel: ${real.toLocaleString()} ${currentProject.budgetCurrency || 'XOF'}
- Variance: ${variance >= 0 ? '+' : ''}${variance.toLocaleString()} (${variancePercent.toFixed(1)}%)

4) DÉCISIONS COMITÉ
- Priorités 2 semaines: ...
- Arbitrages demandés: ...
- Responsables et échéances: ...

5) PLAN D'ACTIONS
- Action 1:
- Action 2:
- Action 3:
`;

            setCommitteeReport(content);
            setIsLoading(false);
        }, 1200);
    };

    const handleSaveCommitteeReport = async () => {
        if (committeeReport && currentUser) {
            try {
                const reportData = {
                    projectId: currentProject.id,
                    title: `Rapport comité PMO - ${new Date().toLocaleDateString('fr-FR')}`,
                    content: committeeReport,
                    type: 'committee_report',
                    createdBy: currentUser.email
                };
                await DataAdapter.createProjectReport(reportData);
                setCommitteeReport('');
                await loadProjectReports();
            } catch (error) {
                console.error('Erreur lors de la sauvegarde du rapport comité:', error);
                alert('Erreur lors de la sauvegarde du rapport comité');
            }
        }
    };

    const handleDeleteReport = async (reportId: string) => {
        try {
            await DataAdapter.deleteProjectReport(reportId);
            await loadProjectReports(); // Recharger les rapports depuis la DB
        } catch (error) {
            console.error('Erreur lors de la suppression du rapport:', error);
            alert('Erreur lors de la suppression du rapport');
        }
    };

    const handleDeleteTaskSummary = async (summaryId: string) => {
        try {
            await DataAdapter.deleteProjectReport(summaryId);
            await loadProjectReports(); // Recharger les rapports depuis la DB
        } catch (error) {
            console.error('Erreur lors de la suppression du résumé:', error);
            alert('Erreur lors de la suppression du résumé');
        }
    };

    const handleDeleteCommitteeReport = async (reportId: string) => {
        try {
            await DataAdapter.deleteProjectReport(reportId);
            await loadProjectReports();
        } catch (error) {
            console.error('Erreur lors de la suppression du rapport comité:', error);
            alert('Erreur lors de la suppression du rapport comité');
        }
    };

    const handleExportToPDF = (content: string, title: string) => {
        try {
            // Créer un nouveau document PDF
            const doc = new jsPDF();
            
            // Configuration de la page
            const pageWidth = doc.internal.pageSize.getWidth();
            const pageHeight = doc.internal.pageSize.getHeight();
            const margin = 20;
            const maxWidth = pageWidth - (margin * 2);
            const lineHeight = 7;
            
            // En-tête du document
            doc.setFontSize(18);
            doc.setFont(undefined, 'bold');
            doc.text(title, margin, margin + 10);
            
            // Ligne de séparation
            doc.setLineWidth(0.5);
            doc.line(margin, margin + 15, pageWidth - margin, margin + 15);
            
            // Informations du projet
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text(`Projet: ${currentProject.title}`, margin, margin + 25);
            doc.text(`Date de génération: ${new Date().toLocaleDateString('fr-FR')}`, margin, margin + 35);
            
            // Ligne de séparation
            doc.line(margin, margin + 40, pageWidth - margin, margin + 40);
            
            // Contenu du rapport
            doc.setFontSize(10);
            doc.setFont(undefined, 'normal');
            
            // Diviser le contenu en lignes
            const lines = doc.splitTextToSize(content, maxWidth);
            let yPosition = margin + 50;
            
            // Ajouter chaque ligne
            lines.forEach((line: string) => {
                // Vérifier si on a besoin d'une nouvelle page
                if (yPosition + lineHeight > pageHeight - margin) {
                    doc.addPage();
                    yPosition = margin;
                }
                
                doc.text(line, margin, yPosition);
                yPosition += lineHeight;
            });
            
            // Sauvegarder le PDF
            const fileName = `${title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${currentProject.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`;
            doc.save(fileName);
            
        } catch (error) {
            console.error('Erreur lors de l\'export PDF:', error);
            alert('Erreur lors de l\'export PDF');
        }
    };

    const getStatusColor = (status: string) => {
        switch (status?.toLowerCase()) {
            case 'completed':
                return 'bg-emerald-100 text-emerald-800 border-emerald-200';
            case 'in progress':
                return 'bg-blue-100 text-blue-800 border-blue-200';
            case 'on hold':
                return 'bg-amber-100 text-amber-800 border-amber-200';
            default:
                return 'bg-gray-100 text-gray-800 border-gray-200';
        }
    };

    const cockpit = useMemo(
        () => buildProjectCockpitReadModel(currentProject, timeLogs, objectives),
        [currentProject, timeLogs, objectives],
    );
    const progressPercentage = cockpit.insights.progressPercentage;
    const totalEstimatedHours = (currentProject.tasks || []).reduce((sum, task) => sum + (task.estimatedHours || 0), 0);

    const projectWorkspaceContextValue = useMemo((): ProjectWorkspaceContextValue => ({
        project: currentProject,
        setProject: setCurrentProject,
        workspaceTab,
        setWorkspaceTab,
        cockpitReadModel: cockpit,
        canManageProject,
        canGovernTasks,
        isFr,
        organizationId: currentUser?.organizationId ?? null,
        userId: currentUser?.id != null ? String(currentUser.id) : null,
        onUpdateProject,
    }), [
        currentProject,
        workspaceTab,
        cockpit,
        canManageProject,
        canGovernTasks,
        isFr,
        currentUser?.organizationId,
        currentUser?.id,
        onUpdateProject,
    ]);

    const filteredTasks = useMemo(() => {
        const rankPriority = (priority: Task['priority']) => (priority === 'High' ? 0 : priority === 'Medium' ? 1 : 2);
        const rankStatus = (status: Task['status']) => (status === 'To Do' ? 0 : status === 'In Progress' ? 1 : 2);
        const list = (currentProject.tasks || []).filter((task) => {
            const q = taskSearch.trim().toLowerCase();
            const taskAssigneeId = task.assignee?.id ? String(task.assignee.id) : '';
            const matchesSearch = !q || task.text.toLowerCase().includes(q);
            const matchesStatus = taskStatusFilter === 'all' || task.status === taskStatusFilter;
            const matchesPriority = taskPriorityFilter === 'all' || task.priority === taskPriorityFilter;
            const matchesAssignee =
                taskAssigneeFilter === 'all' ||
                (taskAssigneeFilter === 'unassigned' ? !taskAssigneeId : taskAssigneeId === String(taskAssigneeFilter));
            return matchesSearch && matchesStatus && matchesPriority && matchesAssignee;
        });

        list.sort((a, b) => {
            if (taskSortBy === 'priority') return rankPriority(a.priority) - rankPriority(b.priority);
            if (taskSortBy === 'status') return rankStatus(a.status) - rankStatus(b.status);
            const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
            return aDue - bDue;
        });
        return list;
    }, [currentProject.tasks, taskSearch, taskStatusFilter, taskPriorityFilter, taskAssigneeFilter, taskSortBy]);
    const filteredFrozenCount = filteredTasks.filter((task) => isTaskFrozen(task)).length;
    const filteredTaskIds = filteredTasks.map((task) => task.id);
    const selectedFilteredCount = filteredTaskIds.filter((id) => selectedTaskIds.includes(id)).length;
    const allFilteredSelected = filteredTaskIds.length > 0 && selectedFilteredCount === filteredTaskIds.length;
    const selectedTaskCount = selectedTaskIds.length;
    const kanbanColumns: Array<{ key: Task['status']; label: string }> = [
        { key: 'To Do', label: 'À faire' },
        { key: 'In Progress', label: 'En cours' },
        { key: 'Completed', label: 'Réalisé' },
    ];
    const unresolvedHighRisks = (currentProject.risks || []).filter((risk) => risk.likelihood === 'High' || risk.impact === 'High').length;
    const governanceChecklist = [
        { id: 'tasks', label: 'Toutes les tâches sont terminées', done: cockpit.totalTasks > 0 && cockpit.completedTasks === cockpit.totalTasks },
        { id: 'risks', label: 'Aucun risque critique ouvert', done: unresolvedHighRisks === 0 },
        { id: 'budget', label: 'Budget final renseigné', done: Number((currentProject as any).budgetPlanned || 0) > 0 || (currentProject.budgetLines || []).length > 0 },
        { id: 'report', label: 'Rapport de clôture généré', done: savedReports.length > 0 },
    ];
    const canCloseProject = governanceChecklist.every((item) => item.done);

    useEffect(() => {
        const validTaskIds = new Set((currentProject.tasks || []).map((task) => task.id));
        setSelectedTaskIds((prev) => prev.filter((id) => validTaskIds.has(id)));
    }, [currentProject.tasks]);

    useEffect(() => {
        if (workspaceTab !== 'tasks') setInspectorTaskId(null);
    }, [workspaceTab]);

    const inspectedTask = useMemo(
        () => (inspectorTaskId ? (currentProject.tasks || []).find((t) => t.id === inspectorTaskId) ?? null : null),
        [inspectorTaskId, currentProject.tasks],
    );

    const workspaceHealthLabel =
        cockpit.insights.riskLevel === 'high'
            ? isFr
                ? 'Critique'
                : 'Critical'
            : cockpit.insights.riskLevel === 'medium'
              ? isFr
                  ? 'À surveiller'
                  : 'Watch'
              : isFr
                ? 'Stable'
                : 'Stable';

    const projectStatusShort = useMemo(() => {
        switch (currentProject.status) {
            case 'In Progress':
                return isFr ? 'En cours' : 'In progress';
            case 'Completed':
                return isFr ? 'Terminé' : 'Completed';
            case 'Not Started':
                return isFr ? 'Non démarré' : 'Not started';
            case 'On Hold':
                return isFr ? 'En pause' : 'On hold';
            default:
                return String(currentProject.status);
        }
    }, [currentProject.status, isFr]);

    const projectWorkspaceSubtitle = useMemo(() => {
        const bits = [
            `${isFr ? 'Santé' : 'Health'}: ${workspaceHealthLabel}`,
            `${isFr ? 'Avancement' : 'Progress'} ${progressPercentage}%`,
        ];
        if (currentProject.programmeName) {
            bits.splice(1, 0, `${isFr ? 'Programme' : 'Programme'}: ${currentProject.programmeName}`);
        }
        if (currentProject.dueDate) {
            bits.push(
                `${isFr ? 'Échéance' : 'Due'} ${new Date(currentProject.dueDate).toLocaleDateString(isFr ? 'fr-FR' : 'en-US')}`,
            );
        }
        return bits.join(' · ');
    }, [workspaceHealthLabel, progressPercentage, currentProject.dueDate, currentProject.programmeName, isFr]);

    const projectStatusBadgeClass = useMemo(() => {
        switch (currentProject.status) {
            case 'Completed':
                return 'border-sky-200 bg-sky-50 text-sky-900';
            case 'On Hold':
                return 'border-[#F4C430]/60 bg-[#FDF8E8] text-amber-950';
            case 'Not Started':
                return 'border-slate-200 bg-slate-100 text-slate-700';
            case 'Cancelled':
                return 'border-slate-300 bg-slate-100 text-slate-600';
            default:
                return 'border-emerald-200 bg-emerald-50 text-emerald-900';
        }
    }, [currentProject.status]);

    const workspaceBreadcrumbItems = useMemo((): WorkspaceBreadcrumbItem[] => {
        const items: WorkspaceBreadcrumbItem[] = [
            { id: 'projects', label: isFr ? 'Projets' : 'Projects', onClick: onClose },
        ];
        if (currentProject.programmeName) {
            items.push({
                id: 'programme',
                label: currentProject.programmeName,
                onClick:
                    setView && currentProject.programmeId
                        ? () => {
                              try {
                                  sessionStorage.setItem(
                                      NAV_SESSION_OPEN_PROGRAMME_ID,
                                      String(currentProject.programmeId),
                                  );
                                  sessionStorage.setItem(NAV_SESSION_PROGRAMMES_PROJECTS_TAB, 'programme');
                              } catch (_) {
                                  /* ignore */
                              }
                              setView('programmes_projects');
                          }
                        : undefined,
            });
        }
        items.push({ id: 'detail', label: isFr ? 'Détail du projet' : 'Project detail' });
        return items;
    }, [currentProject.programmeId, currentProject.programmeName, isFr, onClose, setView]);

    const cockpitKpiStripItems = useMemo((): KPIStripItem[] => {
        const cur = currentProject.budgetCurrency || 'XOF';
        const hasBudget = cockpit.budgetPlannedTotal > 0 || cockpit.budgetRealTotal > 0;
        const varianceDisplay = !hasBudget
            ? '—'
            : `${cockpit.budgetVariance >= 0 ? '+' : ''}${cockpit.budgetVariance.toLocaleString()} ${cur}` +
              (cockpit.budgetPlannedTotal > 0
                  ? ` (${cockpit.budgetVariancePercent >= 0 ? '+' : ''}${cockpit.budgetVariancePercent.toFixed(0)}%)`
                  : '');
        return [
            { id: 'health', label: isFr ? 'Santé projet' : 'Project health', value: workspaceHealthLabel },
            {
                id: 'progress',
                label: isFr ? 'Progression' : 'Progress',
                value: `${cockpit.insights.progressPercentage}%`,
                unit: `${cockpit.completedTasks}/${cockpit.totalTasks}`,
            },
            {
                id: 'budget',
                label: isFr ? 'Variance budget' : 'Budget variance',
                value: varianceDisplay,
            },
            {
                id: 'blocked',
                label: isFr ? 'Tâches bloquées' : 'Blocked tasks',
                value: cockpit.blockedTasksCount,
            },
            {
                id: 'team',
                label: isFr ? 'Charge équipe' : 'Team load',
                value: cockpit.teamLoadOpenTasksPerMember.toFixed(1),
                unit: isFr ? 'ouvertes / membre' : 'open / member',
            },
        ];
    }, [cockpit, currentProject.budgetCurrency, isFr, workspaceHealthLabel]);

    const cockpitDonutSegments = useMemo((): EnterpriseDonutSegment[] => {
        const tasks = currentProject.tasks || [];
        const n = tasks.length;
        if (n === 0) {
            const p = Math.min(100, Math.max(0, cockpit.insights.progressPercentage));
            return [
                { name: isFr ? 'Avancement' : 'Progress', value: p, color: '#199C45' },
                { name: isFr ? 'Reste' : 'Remaining', value: Math.max(0, 100 - p), color: '#E2E8F0' },
            ];
        }
        const done = tasks.filter((t) => t.status === 'Completed').length;
        const ip = tasks.filter((t) => t.status === 'In Progress').length;
        const rest = Math.max(0, n - done - ip);
        return [
            { name: isFr ? 'Terminées' : 'Done', value: (done / n) * 100, color: '#199C45' },
            { name: isFr ? 'En cours' : 'In progress', value: (ip / n) * 100, color: '#0D7A2B' },
            { name: isFr ? 'En attente' : 'Pending', value: (rest / n) * 100, color: '#F4C430' },
        ];
    }, [currentProject.tasks, cockpit.insights.progressPercentage, isFr]);

    const cockpitFinanceItems = useMemo((): EnterpriseFinanceKpiItem[] => {
        const cur = currentProject.budgetCurrency || 'XOF';
        const fmt = (x: number) =>
            `${new Intl.NumberFormat(isFr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 }).format(Math.round(x))} ${cur}`;
        const plannedRaw = cockpit.budgetPlannedTotal > 0 ? cockpit.budgetPlannedTotal : (currentProject.budgetPlanned ?? 0);
        const planned = Math.max(plannedRaw, cockpit.budgetRealTotal);
        const spent = cockpit.budgetRealTotal;
        if (planned <= 0 && spent <= 0) return [];
        const avail = Math.max(0, planned - spent);
        const execPct = planned > 0 ? Math.round((spent / planned) * 100) : 0;
        const availPct = planned > 0 ? Math.round((avail / planned) * 100) : 0;
        const varAmt = spent - planned;
        let varVariant: EnterpriseFinanceKpiItem['variant'] = 'default';
        if (cockpit.budgetAlertLevel === 'critical') varVariant = 'danger';
        else if (cockpit.budgetAlertLevel === 'warning') varVariant = 'warning';
        else if (varAmt <= 0) varVariant = 'positive';

        return [
            {
                id: 'total',
                label: isFr ? 'Budget total' : 'Total budget',
                value: fmt(planned),
            },
            {
                id: 'spent',
                label: isFr ? 'Dépensé à ce jour' : 'Spent to date',
                value: fmt(spent),
                hint: `${execPct}% ${isFr ? 'du prévu' : 'of planned'}`,
            },
            {
                id: 'avail',
                label: isFr ? 'Disponible' : 'Available',
                value: fmt(avail),
                hint: `${availPct}% ${isFr ? 'du prévu' : 'of planned'}`,
            },
            {
                id: 'var',
                label: isFr ? 'Écart vs prévision' : 'Variance vs plan',
                value: `${varAmt >= 0 ? '+' : '−'}${fmt(Math.abs(varAmt))}`,
                variant: varVariant,
            },
        ];
    }, [
        cockpit.budgetPlannedTotal,
        cockpit.budgetRealTotal,
        cockpit.budgetAlertLevel,
        currentProject.budgetPlanned,
        currentProject.budgetCurrency,
        isFr,
    ]);

    const renderProjectInspectorBody = () => (
        <>
            <div className="space-y-6">
                            {(currentProject.programmeId || currentProject.programmeName) && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
                                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                {isFr ? 'Programme' : 'Programme'}
                                            </p>
                        <p className="text-sm font-semibold text-slate-900 truncate">
                                                {currentProject.programmeName || currentProject.programmeId}
                                            </p>
                                            {currentProject.programmeBailleurName ? (
                            <p className="text-xs text-slate-600 mt-1">
                                                    {isFr ? 'Bailleur : ' : 'Donor: '}
                                                    {currentProject.programmeBailleurName}
                                                </p>
                                            ) : null}
                                    {setView && currentProject.programmeId ? (
                                        <button
                                            type="button"
                                className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                                            onClick={() => {
                                                try {
                                        sessionStorage.setItem(NAV_SESSION_OPEN_PROGRAMME_ID, String(currentProject.programmeId));
                                        sessionStorage.setItem(NAV_SESSION_PROGRAMMES_PROJECTS_TAB, 'programme');
                                    } catch (_) {
                                        /* ignore */
                                    }
                                    setView('programmes_projects');
                                            }}
                                        >
                                            <i className="fas fa-external-link-alt mr-2" aria-hidden />
                                            {isFr ? 'Voir le programme' : 'Open programme'}
                                        </button>
                                    ) : null}
                                </div>
                            )}
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">
                        {isFr ? 'Description' : 'Description'}
                    </label>
                    <textarea
                        value={currentProject.description || ''}
                        onChange={(e) => {
                            const updatedProject = { ...currentProject, description: e.target.value };
                            setCurrentProject(updatedProject);
                            onUpdateProject(updatedProject);
                        }}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[#0d1b2a]/15 focus:border-slate-300"
                        rows={4}
                        placeholder={isFr ? 'Description du projet' : 'Project description'}
                    />
                        </div>
                <div>
                    <label className="block text-xs font-medium text-slate-500 mb-2">
                        {isFr ? 'Équipe' : 'Team'}
                    </label>
                    <div className="space-y-2">
                        {currentProject.team?.map((member) => (
                            <div
                                key={member.id}
                                className="flex items-center gap-3 p-2 bg-white rounded-lg border border-slate-200"
                            >
                                <div className="w-9 h-9 bg-gradient-to-br from-slate-600 to-slate-800 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                                    {(member.fullName || member.email || 'U').charAt(0).toUpperCase()}
                    </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-900 truncate">
                                        {member.fullName || member.email}
                                    </p>
                                    <p className="text-xs text-slate-500 truncate">{member.role}</p>
                                    </div>
                                </div>
                        ))}
                    </div>
                </div>
                {isSenegalTeam && getTeamWorkloadMetrics().length > 0 && (
                    <div>
                        <label className="block text-xs font-medium text-slate-500 mb-2">
                            {isFr ? 'Charge de travail' : 'Workload'}
                        </label>
                        <div className="space-y-3">
                            {getTeamWorkloadMetrics().map((roleData, index) => (
                                <div key={index} className="bg-white rounded-lg p-3 border border-slate-200">
                                    <div className="flex items-center justify-between mb-2">
                                        <h4 className="text-xs font-semibold text-slate-900">{roleData.role}</h4>
                                        <span className="text-[10px] text-slate-500">{roleData.memberCount}</span>
                                    </div>
                                    <div className="grid grid-cols-3 gap-1 text-center text-[10px] mb-2">
                                        <div>
                                            <div className="text-sm font-bold text-emerald-600">{roleData.taskCount}</div>
                                            <div className="text-slate-500">{isFr ? 'Tâches' : 'Tasks'}</div>
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-blue-600">{roleData.estimatedHours}h</div>
                                            <div className="text-slate-500">Est.</div>
                                        </div>
                                        <div>
                                            <div className="text-sm font-bold text-violet-600">{roleData.loggedHours}h</div>
                                            <div className="text-slate-500">Log.</div>
                                        </div>
                                    </div>
                                    <div className="w-full bg-slate-100 rounded-full h-1">
                                        <div
                                            className="bg-gradient-to-r from-emerald-400 to-blue-500 h-1 rounded-full"
                                            style={{
                                                width: `${Math.min((roleData.loggedHours / Math.max(roleData.estimatedHours, 1)) * 100, 100)}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            ))}
                        </div>
                                    </div>
                                )}
                <div className="pt-3 border-t border-slate-200">
                    <h4 className="text-xs font-semibold text-slate-700 mb-2">
                        {isFr ? 'Checklist clôture' : 'Close-out checklist'}
                    </h4>
                    <div className="space-y-1.5 mb-3">
                        {governanceChecklist.map((item) => (
                            <div
                                key={item.id}
                                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                            >
                                <span className="text-[11px] text-slate-700">{item.label}</span>
                                <span
                                    className={`text-[10px] font-semibold ${item.done ? 'text-emerald-700' : 'text-amber-700'}`}
                                >
                                    {item.done ? 'OK' : '…'}
                                </span>
                            </div>
                        ))}
                        </div>
                    {canManageProject && (
                            <button
                            type="button"
                            disabled={!canCloseProject || currentProject.status === 'Completed'}
                            onClick={() => {
                                if (!canCloseProject) return;
                                const updatedProject = { ...currentProject, status: 'Completed' as const };
                                setCurrentProject(updatedProject);
                                onUpdateProject(updatedProject);
                            }}
                            className="w-full rounded-lg bg-[#0d1b2a] text-white text-xs font-semibold py-2 disabled:opacity-50"
                        >
                            {currentProject.status === 'Completed'
                                ? isFr
                                    ? 'Projet clôturé'
                                    : 'Project closed'
                                : isFr
                                  ? 'Clôturer le projet'
                                  : 'Close project'}
                            </button>
                    )}
                </div>
                <div className="pt-3 border-t border-slate-200 space-y-2">
                    <h4 className="text-xs font-semibold text-slate-700 mb-1">
                        {isFr ? 'Actions rapides' : 'Quick actions'}
                    </h4>
                    {workspaceTab === 'cockpit' && (
                        <>
                            <button
                                type="button"
                                onClick={() => setWorkspaceTab('tasks')}
                                className="w-full rounded-lg bg-[#0d1b2a] text-white text-xs font-semibold py-2"
                            >
                                <i className="fas fa-tasks mr-2" />
                                {isFr ? 'Tâches' : 'Tasks'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setWorkspaceTab('budget')}
                                className="w-full rounded-lg border border-slate-200 bg-white text-xs font-semibold py-2 text-slate-800"
                            >
                                <i className="fas fa-coins mr-2" />
                                {isFr ? 'Budget' : 'Budget'}
                            </button>
                        </>
                    )}
                    {workspaceTab === 'tasks' && (
                        <button
                            onClick={handleGenerateTasksWithAI}
                            disabled={isLoading}
                            className="w-full rounded-lg bg-emerald-600 text-white text-xs font-semibold py-2 disabled:opacity-50"
                        >
                            <i className="fas fa-magic mr-2" />
                            {isLoading ? '…' : isFr ? 'Tâches (IA)' : 'Tasks (AI)'}
                        </button>
                    )}
                    {workspaceTab === 'cockpit' && (
                        <button
                            onClick={handleIdentifyRisksWithAI}
                            disabled={isLoading}
                            className="w-full rounded-lg bg-red-600 text-white text-xs font-semibold py-2 disabled:opacity-50"
                        >
                            <i className="fas fa-bolt mr-2" />
                            {isLoading ? '…' : isFr ? 'Risques (IA)' : 'Risks (AI)'}
                        </button>
                    )}
                    {workspaceTab === 'planning' && (
                        <>
                            <button
                                onClick={handleGenerateStatusReport}
                                disabled={isLoading}
                                className="w-full rounded-lg bg-[#0d1b2a] text-white text-xs font-semibold py-2"
                            >
                                {isLoading ? '…' : isFr ? 'Rapport d’état' : 'Status report'}
                            </button>
                            <button
                                onClick={handleSummarizeTasks}
                                disabled={isLoading}
                                className="w-full rounded-lg border border-slate-200 bg-white text-xs font-semibold py-2"
                            >
                                {isLoading ? '…' : isFr ? 'Résumé tâches' : 'Task summary'}
                            </button>
                            <button
                                onClick={handleGenerateCommitteeReport}
                                disabled={isLoading}
                                className="w-full rounded-lg border border-slate-200 bg-white text-xs font-semibold py-2"
                            >
                                {isLoading ? '…' : 'PMO'}
                            </button>
                        </>
                            )}
                        </div>
                    </div>
        </>
    );

    const renderTaskInspectorBody = (task: Task) => {
        const governance = getTaskGovernance(task);
        const frozen = isTaskFrozen(task);
        const blocked = governance === 'not_realized' || governance === 'closed_out';
        const canSetCompleted = !blocked && (!frozen || canManageProject);
        const canEditStructure = canGovernTasks;
        const isAssignee =
            !!task.assignee?.id &&
            !!currentUser?.id &&
            String(task.assignee.id) === String(currentUser.id);
        const canChangeStatus = canGovernTasks || isAssignee;

        return (
            <div className="space-y-4 text-sm">
                <div>
                    <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Titre' : 'Title'}</label>
                    <input
                        type="text"
                        value={task.text}
                        onChange={(e) => handleUpdateTask(task.id, { text: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#0d1b2a]/10 disabled:bg-slate-50"
                        disabled={!canEditStructure}
                    />
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {governance === 'not_realized' && (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-900">
                            {isFr ? 'Non réalisée' : 'Not done'}
                        </span>
                    )}
                    {governance === 'closed_out' && (
                        <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-900">
                            {isFr ? 'Clôturée manager' : 'Closed'}
                        </span>
                    )}
                    {frozen && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
                            {isFr ? 'Gelée' : 'Frozen'}
                        </span>
                    )}
            </div>

                <div>
                    <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Statut' : 'Status'}</label>
                    <select
                        value={task.status}
                        onChange={(e) => {
                            const newStatus = e.target.value as Task['status'];
                            if (blocked && newStatus !== task.status) return;
                            if (newStatus === 'Completed' && requireJustification) {
                                const hasJustif = (task.justificationAttachmentIds?.length ?? 0) > 0;
                                if (!hasJustif) {
                                    alert(
                                        isFr
                                            ? 'Justificatif obligatoire : liez au moins une pièce jointe avant Réalisé.'
                                            : 'Attachment required before marking completed.',
                                    );
                                    return;
                                }
                            }
                            const updates: Partial<Task> = { status: newStatus };
                            if (newStatus === 'Completed') {
                                updates.completedAt = new Date().toISOString();
                                updates.completedById = currentUser?.id != null ? String(currentUser.id) : undefined;
                                updates.isFrozen = false;
                            }
                            handleUpdateTask(task.id, updates);
                        }}
                        disabled={!canChangeStatus || (task.status !== 'Completed' && !canSetCompleted)}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50"
                    >
                        <option value="To Do">{isFr ? 'À faire' : 'To do'}</option>
                        <option value="In Progress">{isFr ? 'En cours' : 'In progress'}</option>
                        <option value="Completed">{isFr ? 'Réalisé' : 'Completed'}</option>
                    </select>
                                        </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Échéance' : 'Due'}</label>
                        <input
                            type="date"
                            value={formatDateForInput(task.dueDate)}
                            onChange={(e) => handleUpdateTask(task.id, { dueDate: e.target.value })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs disabled:bg-slate-50"
                            disabled={!canEditStructure}
                        />
                                    </div>
                    <div>
                        <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Priorité' : 'Priority'}</label>
                        <select
                            value={task.priority}
                            onChange={(e) => handleUpdateTask(task.id, { priority: e.target.value as Task['priority'] })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs disabled:bg-slate-50"
                            disabled={!canEditStructure}
                        >
                            <option value="Low">{isFr ? 'Faible' : 'Low'}</option>
                            <option value="Medium">{isFr ? 'Moyenne' : 'Medium'}</option>
                            <option value="High">{isFr ? 'Haute' : 'High'}</option>
                        </select>
                                </div>
                                        </div>

                <div>
                    <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Assigné à' : 'Assignee'}</label>
                    <select
                        value={task.assignee?.id || ''}
                        onChange={(e) => {
                            const assigneeId = e.target.value;
                            const assignee = assigneeId ? currentProject.team.find((m) => m.id === assigneeId) : undefined;
                            handleUpdateTask(task.id, { assignee });
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs disabled:bg-slate-50"
                        disabled={!canEditStructure}
                    >
                        <option value="">{isFr ? 'Non attribué' : 'Unassigned'}</option>
                        {currentProject.team.map((member) => (
                            <option key={member.id} value={member.id}>
                                {member.fullName || member.email}
                            </option>
                        ))}
                    </select>
                                        </div>

                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Est. (h)' : 'Est. (h)'}</label>
                        <input
                            type="number"
                            value={task.estimatedHours || 0}
                            onChange={(e) => handleUpdateTask(task.id, { estimatedHours: Number(e.target.value) })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs disabled:bg-slate-50"
                            min={0}
                            disabled={!canEditStructure}
                        />
                                    </div>
                    <div>
                        <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Log (h)' : 'Log (h)'}</label>
                        <input
                            type="number"
                            value={task.loggedHours || 0}
                            onChange={(e) => handleUpdateTask(task.id, { loggedHours: Number(e.target.value) })}
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs disabled:bg-slate-50"
                            min={0}
                            disabled={!canGovernTasks && !isAssignee}
                        />
                                </div>
                                        </div>

                {task.managerComment ? (
                    <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">{isFr ? 'Consigne : ' : 'Brief: '}</span>
                        {task.managerComment}
                    </p>
                ) : null}

                {requireJustification && task.status !== 'Completed' && attachments.length > 0 && (
                    <div>
                        <label className="text-[11px] font-medium text-slate-500">{isFr ? 'Justificatif' : 'Proof'}</label>
                        <select
                            className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-2 text-xs"
                            value=""
                            onChange={(e) => {
                                const aid = e.target.value;
                                if (!aid) return;
                                const ids = task.justificationAttachmentIds ?? [];
                                if (!ids.includes(aid)) {
                                    handleUpdateTask(task.id, { justificationAttachmentIds: [...ids, aid] });
                                }
                                e.target.value = '';
                            }}
                        >
                            <option value="">{isFr ? '— Lier une pièce —' : '— Link file —'}</option>
                            {attachments
                                .filter((a) => !(task.justificationAttachmentIds ?? []).includes(a.id))
                                .map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.fileName}
                                    </option>
                                ))}
                        </select>
                                </div>
                            )}

                {canGovernTasks && governance === 'not_realized' && (
                    <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
                        <button
                            type="button"
                            className="w-full rounded-lg border border-slate-200 bg-white py-2 text-xs font-semibold text-blue-800 hover:bg-slate-50"
                            onClick={() =>
                                handleUpdateTask(task.id, {
                                    taskGovernance: 'open',
                                    isFrozen: false,
                                    status: 'To Do',
                                })
                            }
                        >
                            {isFr ? 'Réouvrir / réaffecter' : 'Reopen'}
                        </button>
                        <button
                            type="button"
                            className="w-full rounded-lg border border-red-200 bg-red-50 py-2 text-xs font-semibold text-red-900 hover:bg-red-100"
                            onClick={() =>
                                handleUpdateTask(task.id, {
                                    taskGovernance: 'closed_out',
                                    isFrozen: true,
                                    productivityPenalty: Math.min(1, Number(task.productivityPenalty ?? 0) + 0.3),
                                })
                            }
                        >
                            {isFr ? 'Clôturer (hors perf.)' : 'Close out'}
                        </button>
                            </div>
                )}

                {canGovernTasks && (
                    <button
                        type="button"
                        onClick={() => handleDeleteTask(task.id)}
                        className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
                    >
                        <i className="fas fa-trash" />
                        {isFr ? 'Supprimer la tâche' : 'Delete task'}
                    </button>
                )}
                            </div>
        );
    };

    return (
        <ProjectWorkspaceProvider value={projectWorkspaceContextValue}>
        <>
            <WorkspaceRouteShell
                className="bg-[var(--coya-enterprise-bg,#F8FAFC)]"
                top={
                    <WorkspaceTopBar
                        leading={
                            <WorkspaceBackButton
                            onClick={onClose}
                                label={isFr ? 'Projets' : 'Projects'}
                            />
                        }
                        breadcrumbs={<WorkspaceBreadcrumbs items={workspaceBreadcrumbItems} />}
                    />
                }
            >
                <div
                    data-testid="project-workspace"
                    className="flex min-h-0 flex-1 flex-col"
                >
                <ObjectWorkspaceFloorplan
                    useWorkspaceShell={false}
                    className="flex min-h-0 flex-1 flex-col border-b border-[var(--coya-enterprise-border)] bg-white px-4 pb-4 pt-3 lg:px-6"
                    hero={
                        <ProjectWorkspaceHero
                            title={<span className="truncate">{currentProject.title}</span>}
                            subtitle={projectWorkspaceSubtitle}
                            progressPercent={progressPercentage}
                            statusBadge={
                                <span
                                    className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${projectStatusBadgeClass}`}
                                >
                                    {projectStatusShort}
                                </span>
                            }
                            actions={
                                <>
                            <button
                                type="button"
                                onClick={() => setLogTimeModalOpen(true)}
                                className="inline-flex items-center gap-2 rounded-xl bg-[var(--coya-institutional)] px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[var(--coya-institutional-secondary)]"
                            >
                                <i className="fas fa-clock" />
                                {isFr ? 'Temps' : 'Time'}
                            </button>
                                    {canManageProject && (
                                        <button
                                            type="button"
                                            onClick={() => setProjectMetaWizardOpen(true)}
                                            className="inline-flex items-center gap-2 rounded-xl border border-[var(--coya-institutional)] bg-white px-3 py-2 text-xs font-semibold text-[var(--coya-institutional)] shadow-sm hover:bg-emerald-50"
                                        >
                                            <i className="fas fa-pen" />
                                            {isFr ? 'Modifier le projet' : 'Edit project'}
                                        </button>
                                    )}
                                <button
                                    type="button"
                                        onClick={() => setWorkspaceTab('documents')}
                                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--coya-enterprise-text)] hover:bg-[#F8FAFC]"
                                >
                                        <i className="fas fa-paperclip" />
                                        {isFr ? 'Documents' : 'Documents'}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        try {
                                            const u = new URL(window.location.href);
                                            u.searchParams.set(
                                                NAV_QUERY_MOBILITE_PROJECT_ID,
                                                String(currentProject.id),
                                            );
                                            window.history.replaceState({}, '', u.toString());
                                        } catch {
                                            /* ignore */
                                        }
                                        setView?.('demande_mobilite');
                                    }}
                                    className="inline-flex items-center gap-2 rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--coya-enterprise-text)] hover:bg-[#F8FAFC]"
                                >
                                    <i className="fas fa-route" />
                                    {t('mobility_link_project_workspace')}
                                </button>
                            <button
                                type="button"
                                        onClick={() => setWorkspaceTab('team')}
                                        className="inline-flex items-center gap-2 rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--coya-enterprise-text)] hover:bg-[#F8FAFC]"
                                    >
                                        <i className="fas fa-users" />
                                        {isFr ? 'Équipe' : 'Team'}
                            </button>
                                    {canManageProject && (
                            <button
                                            type="button"
                                            onClick={() => setDeleteModalOpen(true)}
                                            className="inline-flex items-center gap-2 rounded-xl border border-[var(--coya-enterprise-border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--coya-enterprise-text)] hover:bg-[#F8FAFC]"
                                        >
                                            <i className="fas fa-trash text-red-500" />
                                            {isFr ? 'Supprimer' : 'Delete'}
                            </button>
                                    )}
                                </>
                            }
                        />
                    }
                    kpi={
                        <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-[#F8FAFC]/60 p-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
                            <KPIStrip items={cockpitKpiStripItems} max={5} />
                        </div>
                    }
                    tabs={
                        <PillTabs<ProjectWorkspaceTab>
                            items={[
                                {
                                    id: 'cockpit',
                                    label: isFr ? 'Aperçu' : 'Overview',
                                },
                                { id: 'team', label: isFr ? 'Informations' : 'Information' },
                                {
                                    id: 'planning',
                                    label: isFr ? 'Planification' : 'Planning',
                                },
                                { id: 'budget', label: isFr ? 'Finances' : 'Finance' },
                                {
                                    id: 'performance',
                                    label: isFr ? 'Indicateurs' : 'Indicators',
                                },
                                { id: 'documents', label: isFr ? 'Documents' : 'Documents' },
                                { id: 'tasks', label: isFr ? 'Tâches' : 'Tasks' },
                                {
                                    id: 'history',
                                    label: isFr ? 'Historique' : 'History',
                                },
                            ]}
                            value={workspaceTab}
                            onChange={setWorkspaceTab}
                            className="max-w-full flex-wrap"
                        />
                    }
                >

                    {/* Zone focus + inspecteur : scroll unique = `main` de l’app (pas de scroll imbriqué). */}
                    <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-start">
                        <div className="min-w-0 flex-1 p-4 lg:p-6">
                            {workspaceTab === 'cockpit' && (
                                <div className="space-y-6">
                                    {cockpitFinanceItems.length > 0 ? (
                                        <EnterpriseFinanceKpiStrip
                                            title={isFr ? 'Performance financière' : 'Financial performance'}
                                            items={cockpitFinanceItems}
                                            dataTestId="project-cockpit-finance-kpi-strip"
                                        />
                                    ) : null}

                                    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_minmax(260px,300px)]">
                                        <div className="min-w-0 space-y-6">
                                            <div className="flex flex-wrap items-center justify-between gap-3">
                                                <div>
                                                    <h3 className="text-lg font-semibold text-[var(--coya-enterprise-text)]">
                                                        {isFr ? 'Résumé du projet' : 'Project summary'}
                                                    </h3>
                                                    <p className="mt-1 text-sm text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? cockpit.insights.recommendedActionFr : cockpit.insights.recommendedActionEn}
                                                    </p>
                                                </div>
                                                <div
                                                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                                        cockpit.insights.riskLevel === 'high'
                                                            ? 'bg-red-100 text-red-800'
                                                            : cockpit.insights.riskLevel === 'medium'
                                                              ? 'bg-amber-100 text-amber-900'
                                                              : 'bg-emerald-100 text-emerald-900'
                                                    }`}
                                                >
                                                    {isFr ? 'Santé' : 'Health'} :{' '}
                                                    {cockpit.insights.riskLevel === 'high'
                                                        ? isFr
                                                            ? 'Critique'
                                                            : 'Critical'
                                                        : cockpit.insights.riskLevel === 'medium'
                                                          ? isFr
                                                              ? 'À surveiller'
                                                              : 'Watch'
                                                          : isFr
                                                            ? 'Stable'
                                                            : 'Stable'}{' '}
                                                    ({cockpit.insights.urgencyScore}/100)
                                                </div>
                                            </div>

                                            {cockpit.alerts.length > 0 && (
                                                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4">
                                                    <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-900">
                                                        <i className="fas fa-bell" />
                                                        {isFr ? 'Alertes' : 'Alerts'}
                                                    </h4>
                                                    <ul className="space-y-2 text-sm text-amber-950">
                                                        {cockpit.alerts.map((a) => (
                                                            <li key={a.id} className="flex gap-2">
                                                                <span
                                                                    className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${
                                                                        a.severity === 'high'
                                                                            ? 'bg-red-500'
                                                                            : a.severity === 'medium'
                                                                              ? 'bg-amber-500'
                                                                              : 'bg-slate-400'
                                                                    }`}
                                                                />
                                                                {isFr ? a.fr : a.en}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                                <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                                    <p className="text-xs font-medium text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Temps enregistré' : 'Logged time'}
                                                    </p>
                                                    <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">
                                                        {cockpit.projectLoggedHoursFromTimeLogs.toFixed(1)}h
                                                    </p>
                                                    <p className="mt-1 text-xs text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Feuilles de temps' : 'Timesheets'}
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                                    <p className="text-xs font-medium text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Risques forts' : 'High risks'}
                                                    </p>
                                                    <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">
                                                        {cockpit.insights.highRiskCount}
                                                    </p>
                                                    <p className="mt-1 text-xs text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Ouverts / à mitiger' : 'Open / to mitigate'}
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                                    <p className="text-xs font-medium text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Jalon échéance' : 'Due milestone'}
                                                    </p>
                                                    <p className="mt-2 text-lg font-bold text-[var(--coya-enterprise-text)]">
                                                        {cockpit.insights.dueInDays >= 9990
                                                            ? isFr
                                                                ? 'Sans date'
                                                                : 'No date'
                                                            : cockpit.insights.dueInDays < 0
                                                              ? isFr
                                                                  ? `${-cockpit.insights.dueInDays} j. retard`
                                                                  : `${-cockpit.insights.dueInDays} d. overdue`
                                                              : isFr
                                                                ? `J-${cockpit.insights.dueInDays}`
                                                                : `D-${cockpit.insights.dueInDays}`}
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                                    <p className="text-xs font-medium text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Tâches sensibles' : 'Sensitive tasks'}
                                                    </p>
                                                    <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">
                                                        {cockpit.frozenOrGovernedCount}
                                                    </p>
                                                    <p className="mt-1 text-xs text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Gel / gouvernance' : 'Frozen / governance'}
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                                    <p className="text-xs font-medium text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Objectifs liés' : 'Linked objectives'}
                                                    </p>
                                                    <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">
                                                        {cockpit.objectivesCount}
                                                    </p>
                                                </div>
                                                <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                                    <p className="text-xs font-medium text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Tâches (terminées / total)' : 'Tasks (done / total)'}
                                                    </p>
                                                    <p className="mt-2 text-3xl font-bold tabular-nums text-[var(--coya-enterprise-text)]">
                                                        {cockpit.completedTasks}/{cockpit.totalTasks}
                                                    </p>
                                                    <p className="mt-1 text-xs font-medium text-[var(--coya-institutional)]">
                                                        {cockpit.insights.progressPercentage}% {isFr ? 'complétion' : 'complete'}
                                                    </p>
                                                </div>
                                            </div>

                                            {cockpitFinanceItems.length === 0 &&
                                                (cockpit.budgetPlannedTotal > 0 || cockpit.budgetRealTotal > 0) && (
                                                    <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-[#F8FAFC] p-4">
                                                        <h4 className="mb-2 text-sm font-semibold text-[var(--coya-enterprise-text)]">
                                                            {isFr ? 'Budget (lignes)' : 'Budget (lines)'}
                                                        </h4>
                                                        <div className="flex flex-wrap gap-4 text-sm text-[var(--coya-enterprise-muted)]">
                                                            <span>
                                                                {isFr ? 'Prévu' : 'Planned'} : {cockpit.budgetPlannedTotal.toLocaleString()}
                                                            </span>
                                                            <span>
                                                                {isFr ? 'Réel' : 'Actual'} : {cockpit.budgetRealTotal.toLocaleString()}
                                                            </span>
                                                            <span
                                                                className={
                                                                    cockpit.budgetAlertLevel === 'critical'
                                                                        ? 'font-semibold text-red-700'
                                                                        : cockpit.budgetAlertLevel === 'warning'
                                                                          ? 'font-semibold text-amber-800'
                                                                          : ''
                                                                }
                                                            >
                                                                {isFr ? 'Écart' : 'Variance'} :{' '}
                                                                {(cockpit.budgetRealTotal - cockpit.budgetPlannedTotal).toLocaleString()}
                                                            </span>
                                                        </div>
                                                    </div>
                                                )}

                                            <div className="rounded-2xl border border-[var(--coya-enterprise-border)] bg-white p-4 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
                                                <div className="mb-3 flex items-center justify-between">
                                                    <h4 className="text-sm font-semibold text-[var(--coya-enterprise-text)]">
                                                        {isFr ? 'Prochaines tâches' : 'Next tasks'}
                                                    </h4>
                                                    <button
                                                        type="button"
                                                        className="text-xs font-semibold text-[var(--coya-institutional)] hover:underline"
                                                        onClick={() => setWorkspaceTab('tasks')}
                                                    >
                                                        {isFr ? 'Tout voir' : 'See all'}
                                                    </button>
                                                </div>
                                                {cockpit.nextTasks.length === 0 ? (
                                                    <p className="text-sm text-[var(--coya-enterprise-muted)]">
                                                        {isFr ? 'Aucune tâche ouverte.' : 'No open tasks.'}
                                                    </p>
                                                ) : (
                                                    <ul className="divide-y divide-[var(--coya-enterprise-border)]">
                                                        {cockpit.nextTasks.map((t) => (
                                                            <li key={t.id} className="flex justify-between gap-2 py-2 text-sm">
                                                                <span className="truncate text-[var(--coya-enterprise-text)]">{t.title}</span>
                                                                <span className="shrink-0 text-xs text-[var(--coya-enterprise-muted)]">
                                                                    {t.due ? new Date(t.due).toLocaleDateString(isFr ? 'fr-FR' : 'en-US') : '—'}{' '}
                                                                    · {t.status}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>
                                        </div>

                                        <EnterpriseDonutRing
                                            className="lg:sticky lg:top-4"
                                            heading={isFr ? 'Progression globale' : 'Overall progress'}
                                            centerPrimary={`${progressPercentage}%`}
                                            segments={cockpitDonutSegments}
                                        />
                                    </div>
                                </div>
                            )}
                            {workspaceTab === 'tasks' && (
                                <TasksWorkspaceTab
                                    isFr={isFr}
                                    canGovernTasks={canGovernTasks}
                                    canManageProject={canManageProject}
                                    project={currentProject}
                                    commitTasks={commitProjectTasks}
                                    onOpenAddTaskDrawer={() => setIsAddTaskDrawerOpen(true)}
                                    taskViewMode={taskViewMode}
                                    setTaskViewMode={setTaskViewMode}
                                    taskSearch={taskSearch}
                                    setTaskSearch={setTaskSearch}
                                    taskStatusFilter={taskStatusFilter}
                                    setTaskStatusFilter={setTaskStatusFilter}
                                    taskPriorityFilter={taskPriorityFilter}
                                    setTaskPriorityFilter={setTaskPriorityFilter}
                                    taskAssigneeFilter={taskAssigneeFilter}
                                    setTaskAssigneeFilter={setTaskAssigneeFilter}
                                    taskSortBy={taskSortBy}
                                    setTaskSortBy={setTaskSortBy}
                                    filteredTasks={filteredTasks}
                                    filteredFrozenCount={filteredFrozenCount}
                                    filteredTaskIds={filteredTaskIds}
                                    allFilteredSelected={allFilteredSelected}
                                    selectedTaskCount={selectedTaskCount}
                                    selectedTaskIds={selectedTaskIds}
                                    setSelectedTaskIds={setSelectedTaskIds}
                                    toggleTaskSelection={toggleTaskSelection}
                                    toggleSelectAllFilteredTasks={toggleSelectAllFilteredTasks}
                                    bulkUpdateSelectedTasks={bulkUpdateSelectedTasks}
                                    inspectorTaskId={inspectorTaskId}
                                    setInspectorTaskId={setInspectorTaskId}
                                    pendingTasks={pendingTasks}
                                    setPendingTasks={setPendingTasks}
                                    onCancelPendingTasks={handleCancelPendingTasks}
                                    onSavePendingTasks={handleSavePendingTasks}
                                    kanbanColumns={kanbanColumns}
                                    onKanbanDrop={handleKanbanDrop}
                                    setKanbanDraggingTaskId={setKanbanDraggingTaskId}
                                    formatDateForInput={formatDateForInput}
                                    requireJustification={requireJustification}
                                    currentUserId={currentUser?.id}
                                    onUpdateTask={handleUpdateTask}
                                />
                            )}
                                
                                {workspaceTab === 'cockpit' && (
                                    <div className="space-y-6">
                                        <div className="rounded-lg border border-violet-200 bg-violet-50/80 p-4">
                                            <h4 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
                                                <i className="fas fa-shield-alt text-violet-700" />
                                                {isFr ? 'Risques détectés automatiquement' : 'Auto-detected risks'}
                                            </h4>
                                            <p className="text-xs text-gray-700 leading-relaxed">
                                                {isFr
                                                    ? 'Les risques ne se saisissent plus à la main : ils sont issus d’analyses (règles + IA « Risques ») et des alertes COYA. Vous pouvez toujours mettre à jour ou clôturer les lignes ci-dessous.'
                                                    : 'Risks are not manually created here: they come from rules, the AI “Risks” flow and COYA alerts. You can still update or close rows below.'}
                                            </p>
                                        </div>

                                        {/* Table des risques */}
                                        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm">
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full divide-y divide-gray-200">
                                                    <thead className="bg-gray-50">
                                                        <tr>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Description du risque
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Probabilité
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Impact
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Niveau
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Owner
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Échéance
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Statut
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Stratégie d'atténuation
                                                            </th>
                                                            <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                                                                Actions
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-gray-200">
                                                        {/* Afficher les risques existants */}
                                                        {(currentProject.risks || []).map(risk => {
                                                            const riskLevel = getRiskLevel(risk.likelihood, risk.impact);
                                                            return (
                                                            <tr key={risk.id} className="hover:bg-gray-50">
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-900">
                                                                    <div className="flex items-center">
                                                                <textarea
                                                                    value={risk.description}
                                                                    onChange={(e) => handleUpdateRisk(risk.id, { description: e.target.value })}
                                                                    className="w-full min-w-80 text-sm border border-gray-300 rounded px-3 py-2"
                                                                    rows={2}
                                                                    placeholder="Description du risque"
                                                                />
                                                            </div>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.likelihood}
                                                                        onChange={(e) => handleUpdateRisk(risk.id, { likelihood: e.target.value as 'High' | 'Medium' | 'Low' })}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    >
                                                                        <option value="Low">Faible</option>
                                                                        <option value="Medium">Moyenne</option>
                                                                        <option value="High">Élevée</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.impact}
                                                                        onChange={(e) => handleUpdateRisk(risk.id, { impact: e.target.value as 'High' | 'Medium' | 'Low' })}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    >
                                                                        <option value="Low">Faible</option>
                                                                        <option value="Medium">Moyen</option>
                                                                        <option value="High">Élevé</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                                            riskLevel === 'High' ? 'bg-red-100 text-red-800' :
                                                                            riskLevel === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                                                                        'bg-green-100 text-green-800'
                                                                    }`}>
                                                                            {riskLevel === 'High' ? 'Élevé' :
                                                                             riskLevel === 'Medium' ? 'Moyen' : 'Faible'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.ownerId || ''}
                                                                        onChange={(e) => handleUpdateRisk(risk.id, { ownerId: e.target.value || undefined })}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1 min-w-32"
                                                                    >
                                                                        <option value="">Non assigné</option>
                                                                        {currentProject.team.map(member => (
                                                                            <option key={member.id} value={String(member.id)}>{member.fullName || member.email}</option>
                                                                        ))}
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <input
                                                                        type="date"
                                                                        value={risk.dueDate ? String(risk.dueDate).slice(0, 10) : ''}
                                                                        onChange={(e) => handleUpdateRisk(risk.id, { dueDate: e.target.value || undefined })}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.status || 'open'}
                                                                        onChange={(e) => handleUpdateRisk(risk.id, { status: e.target.value as 'open' | 'mitigating' | 'closed' })}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    >
                                                                        <option value="open">Ouvert</option>
                                                                        <option value="mitigating">Mitigation</option>
                                                                        <option value="closed">Clos</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 text-sm text-gray-500">
                                                                    <div className="max-w-xs">
                                                                        <textarea
                                                                            value={risk.mitigationStrategy}
                                                                            onChange={(e) => handleUpdateRisk(risk.id, { mitigationStrategy: e.target.value })}
                                                                            className="w-full text-sm border border-gray-300 rounded px-2 py-1 resize-none"
                                                                            rows={2}
                                                                        />
                                                                        </div>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                    <button
                                                                            onClick={() => handleDeleteRisk(risk.id)}
                                                                        className="text-red-600 hover:text-red-800 transition-colors p-2 rounded hover:bg-red-50"
                                                                        title="Supprimer le risque"
                                                                    >
                                                                        <i className="fas fa-trash"></i>
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                            );
                                                        })}
                                                        
                                                        {/* Afficher les risques temporaires générés par l'IA */}
                                                        {pendingRisks.map(risk => {
                                                            const riskLevel = getRiskLevel(risk.likelihood, risk.impact);
                                                            return (
                                                            <tr key={risk.id} className="hover:bg-gray-50 bg-yellow-50 border-l-4 border-yellow-400">
                                                                <td className="px-4 py-4">
                                                                    <textarea
                                                                        value={risk.description}
                                                                        onChange={(e) => {
                                                                            const updatedRisks = pendingRisks.map(r => 
                                                                                r.id === risk.id ? { ...r, description: e.target.value } : r
                                                                            );
                                                                            setPendingRisks(updatedRisks);
                                                                        }}
                                                                        className="w-full min-w-80 text-sm border border-gray-300 rounded px-3 py-2 resize-none"
                                                                        rows={2}
                                                                        placeholder="Description du risque"
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.likelihood}
                                                                        onChange={(e) => {
                                                                            const updatedRisks = pendingRisks.map(r => 
                                                                                r.id === risk.id ? { ...r, likelihood: e.target.value } : r
                                                                            );
                                                                            setPendingRisks(updatedRisks);
                                                                        }}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    >
                                                                        <option value="Low">Faible</option>
                                                                        <option value="Medium">Moyenne</option>
                                                                        <option value="High">Élevée</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.impact}
                                                                        onChange={(e) => {
                                                                            const updatedRisks = pendingRisks.map(r => 
                                                                                r.id === risk.id ? { ...r, impact: e.target.value } : r
                                                                            );
                                                                            setPendingRisks(updatedRisks);
                                                                        }}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    >
                                                                        <option value="Low">Faible</option>
                                                                        <option value="Medium">Moyen</option>
                                                                        <option value="High">Élevé</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                                                        riskLevel === 'High' ? 'bg-red-100 text-red-800' :
                                                                        riskLevel === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                                                                        'bg-green-100 text-green-800'
                                                                    }`}>
                                                                        {riskLevel === 'High' ? 'Élevé' :
                                                                         riskLevel === 'Medium' ? 'Moyen' : 'Faible'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.ownerId || ''}
                                                                        onChange={(e) => {
                                                                            const updatedRisks = pendingRisks.map(r =>
                                                                                r.id === risk.id ? { ...r, ownerId: e.target.value || undefined } : r
                                                                            );
                                                                            setPendingRisks(updatedRisks);
                                                                        }}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1 min-w-32"
                                                                    >
                                                                        <option value="">Non assigné</option>
                                                                        {currentProject.team.map(member => (
                                                                            <option key={member.id} value={String(member.id)}>{member.fullName || member.email}</option>
                                                                        ))}
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <input
                                                                        type="date"
                                                                        value={risk.dueDate ? String(risk.dueDate).slice(0, 10) : ''}
                                                                        onChange={(e) => {
                                                                            const updatedRisks = pendingRisks.map(r =>
                                                                                r.id === risk.id ? { ...r, dueDate: e.target.value || undefined } : r
                                                                            );
                                                                            setPendingRisks(updatedRisks);
                                                                        }}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap">
                                                                    <select
                                                                        value={risk.status || 'open'}
                                                                        onChange={(e) => {
                                                                            const updatedRisks = pendingRisks.map(r =>
                                                                                r.id === risk.id ? { ...r, status: e.target.value as 'open' | 'mitigating' | 'closed' } : r
                                                                            );
                                                                            setPendingRisks(updatedRisks);
                                                                        }}
                                                                        className="text-xs border border-gray-300 rounded px-2 py-1"
                                                                    >
                                                                        <option value="open">Ouvert</option>
                                                                        <option value="mitigating">Mitigation</option>
                                                                        <option value="closed">Clos</option>
                                                                    </select>
                                                                </td>
                                                                <td className="px-4 py-4 text-sm text-gray-500">
                                                                    <div className="max-w-xs">
                                                                        <textarea
                                                                            value={risk.mitigationStrategy}
                                                                            onChange={(e) => {
                                                                                const updatedRisks = pendingRisks.map(r => 
                                                                                    r.id === risk.id ? { ...r, mitigationStrategy: e.target.value } : r
                                                                                );
                                                                                setPendingRisks(updatedRisks);
                                                                            }}
                                                                            className="w-full text-sm border border-gray-300 rounded px-3 py-2 resize-none"
                                                                            rows={2}
                                                                            placeholder="Description du risque"
                                                                        />
                                                                    </div>
                                                                </td>
                                                                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500">
                                                                    <button
                                                                        onClick={() => {
                                                                            const updatedRisks = pendingRisks.filter(r => r.id !== risk.id);
                                                                            setPendingRisks(updatedRisks);
                                                                        }}
                                                                        className="text-red-600 hover:text-red-800"
                                                                        title="Supprimer ce risque temporaire"
                                                                    >
                                                                        <i className="fas fa-times"></i>
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                            );
                                                        })}
                                                        
                                                        {(!currentProject.risks || currentProject.risks.length === 0) && pendingRisks.length === 0 && (
                                                            <tr>
                                                                <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                                                                    <i className="fas fa-exclamation-triangle text-4xl text-gray-300 mb-4"></i>
                                                                    <p>Aucun risque identifié pour ce projet</p>
                                                                    <p className="text-sm mt-2">Cliquez sur "Identifier les risques avec l'IA" pour analyser le projet</p>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </tbody>
                                                </table>
                                                
                                                {/* Boutons CTA pour les risques temporaires */}
                                                {pendingRisks.length > 0 && (
                                                    <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center">
                                                                <i className="fas fa-exclamation-triangle text-yellow-600 mr-2"></i>
                                                                <span className="text-sm text-yellow-800">
                                                                    {pendingRisks.length} risque(s) généré(s) par l'IA en attente de sauvegarde
                                                                </span>
                                                            </div>
                                                            <div className="flex space-x-2">
                                                                <button
                                                                    onClick={handleCancelPendingRisks}
                                                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                                                >
                                                                    Annuler
                                                                </button>
                                                                <button
                                                                    onClick={handleSavePendingRisks}
                                                                    className="px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700"
                                                                >
                                                                    Sauvegarder
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                
                                {workspaceTab === 'planning' && (
                                    <div className="space-y-6">
                                        {!generatedReport && !taskSummary && !committeeReport && savedReports.length === 0 && savedTaskSummaries.length === 0 && savedCommitteeReports.length === 0 && (
                                            <div className="text-center py-8 text-gray-500">
                                                <i className="fas fa-file-alt text-6xl text-gray-300 mb-4"></i>
                                                <p className="text-lg">Générer un rapport d'état, un résumé des tâches ou un rapport comité PMO.</p>
                                            </div>
                                        )}

                                        <div className="flex flex-wrap gap-2">
                                            <button type="button" onClick={handleGenerateStatusReport} className="btn-3d-secondary">
                                                <i className="fas fa-file-alt"></i>
                                                Rapport d'état
                                            </button>
                                            <button type="button" onClick={handleSummarizeTasks} className="btn-3d-secondary">
                                                <i className="fas fa-list"></i>
                                                Résumé tâches
                                            </button>
                                            <button type="button" onClick={handleGenerateCommitteeReport} className="btn-3d-primary">
                                                <i className="fas fa-users-cog"></i>
                                                Rapport comité PMO
                                            </button>
                                        </div>
                                        
                                        {/* Rapport d'état généré */}
                                        {generatedReport && (
                                            <div className="bg-white border border-gray-200 rounded-lg p-6">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                                                        <i className="fas fa-file-alt text-blue-600 mr-2"></i>
                                                        Rapport d'état généré
                                                    </h3>
                                                    <div className="flex space-x-2">
                                                        <button
                                                            onClick={() => handleSaveReport()}
                                                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                                                            title="Sauvegarder le rapport"
                                                        >
                                                            <i className="fas fa-save mr-1"></i>Sauvegarder
                                                        </button>
                                                        <button
                                                            onClick={() => handleExportToPDF(generatedReport, 'rapport_etat')}
                                                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                                                            title="Exporter en PDF"
                                                        >
                                                            <i className="fas fa-file-pdf mr-1"></i>PDF
                                                        </button>
                                                        <button
                                                            onClick={() => setGeneratedReport('')}
                                                            className="text-gray-400 hover:text-gray-600"
                                                            title="Effacer le rapport"
                                                        >
                                                            <i className="fas fa-times"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="bg-gray-50 p-4 rounded-lg">
                                                    <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                                                        {generatedReport}
                                                    </pre>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Résumé des tâches généré */}
                                        {taskSummary && (
                                            <div className="bg-white border border-gray-200 rounded-lg p-6">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                                                        <i className="fas fa-list text-green-600 mr-2"></i>
                                                        Résumé des tâches généré
                                                    </h3>
                                                    <div className="flex space-x-2">
                                                        <button
                                                            onClick={() => handleSaveTaskSummary()}
                                                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                                                            title="Sauvegarder le résumé"
                                                        >
                                                            <i className="fas fa-save mr-1"></i>Sauvegarder
                                                        </button>
                                                        <button
                                                            onClick={() => handleExportToPDF(taskSummary, 'resume_taches')}
                                                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                                                            title="Exporter en PDF"
                                                        >
                                                            <i className="fas fa-file-pdf mr-1"></i>PDF
                                                        </button>
                                                        <button
                                                            onClick={() => setTaskSummary('')}
                                                            className="text-gray-400 hover:text-gray-600"
                                                            title="Effacer le résumé"
                                                        >
                                                            <i className="fas fa-times"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="bg-gray-50 p-4 rounded-lg">
                                                    <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                                                        {taskSummary}
                                                    </pre>
                                                </div>
                                            </div>
                                        )}

                                        {/* Rapport comité PMO généré */}
                                        {committeeReport && (
                                            <div className="bg-white border border-gray-200 rounded-lg p-6">
                                                <div className="flex items-center justify-between mb-4">
                                                    <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                                                        <i className="fas fa-users-cog text-emerald-600 mr-2"></i>
                                                        Rapport comité PMO généré
                                                    </h3>
                                                    <div className="flex space-x-2">
                                                        <button
                                                            onClick={() => handleSaveCommitteeReport()}
                                                            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                                                            title="Sauvegarder le rapport comité"
                                                        >
                                                            <i className="fas fa-save mr-1"></i>Sauvegarder
                                                        </button>
                                                        <button
                                                            onClick={() => handleExportToPDF(committeeReport, 'rapport_comite_pmo')}
                                                            className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                                                            title="Exporter en PDF"
                                                        >
                                                            <i className="fas fa-file-pdf mr-1"></i>PDF
                                                        </button>
                                                        <button
                                                            onClick={() => setCommitteeReport('')}
                                                            className="text-gray-400 hover:text-gray-600"
                                                            title="Effacer le rapport comité"
                                                        >
                                                            <i className="fas fa-times"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="bg-gray-50 p-4 rounded-lg">
                                                    <pre className="whitespace-pre-wrap text-sm text-gray-700 font-mono">
                                                        {committeeReport}
                                                    </pre>
                                                </div>
                                            </div>
                                        )}

                                        {/* Rapports sauvegardés */}
                                        {savedReports.length > 0 && (
                                            <div className="space-y-3">
                                                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                                                    <i className="fas fa-archive text-blue-600 mr-2"></i>
                                                    Rapports sauvegardés ({savedReports.length})
                                                </h3>
                                                {savedReports.map(report => (
                                                    <div key={report.id} className="bg-white border border-gray-200 rounded-lg p-4">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 className="font-medium text-gray-900">{report.title}</h4>
                                                            <div className="flex space-x-2">
                                                                <button
                                                                    onClick={() => handleExportToPDF(report.content, report.title)}
                                                                    className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                                                    title="Exporter en PDF"
                                                                >
                                                                    <i className="fas fa-file-pdf mr-1"></i>PDF
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteReport(report.id)}
                                                                    className="text-red-600 hover:text-red-800 transition-colors p-2 rounded hover:bg-red-50"
                                                                    title="Supprimer le rapport"
                                                                >
                                                                    <i className="fas fa-trash"></i>
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <p className="text-xs text-gray-500 mb-2">Créé le: {report.createdAt}</p>
                                                        <div className="bg-gray-50 p-3 rounded text-sm">
                                                            <pre className="whitespace-pre-wrap text-gray-700 font-mono text-xs">
                                                                {report.content.substring(0, 200)}...
                                                            </pre>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Résumés sauvegardés */}
                                        {savedTaskSummaries.length > 0 && (
                                            <div className="space-y-3">
                                                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                                                    <i className="fas fa-archive text-green-600 mr-2"></i>
                                                    Résumés sauvegardés ({savedTaskSummaries.length})
                                                </h3>
                                                {savedTaskSummaries.map(summary => (
                                                    <div key={summary.id} className="bg-white border border-gray-200 rounded-lg p-4">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 className="font-medium text-gray-900">{summary.title}</h4>
                                                            <div className="flex space-x-2">
                                                                <button
                                                                    onClick={() => handleExportToPDF(summary.content, summary.title)}
                                                                    className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                                                    title="Exporter en PDF"
                                                                >
                                                                    <i className="fas fa-file-pdf mr-1"></i>PDF
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteTaskSummary(summary.id)}
                                                                    className="text-red-600 hover:text-red-800 transition-colors p-2 rounded hover:bg-red-50"
                                                                    title="Supprimer le résumé"
                                                                >
                                                                    <i className="fas fa-trash"></i>
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <p className="text-xs text-gray-500 mb-2">Créé le: {summary.createdAt}</p>
                                                        <div className="bg-gray-50 p-3 rounded text-sm">
                                                            <pre className="whitespace-pre-wrap text-gray-700 font-mono text-xs">
                                                                {summary.content.substring(0, 200)}...
                                                            </pre>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        {/* Rapports comité PMO sauvegardés */}
                                        {savedCommitteeReports.length > 0 && (
                                            <div className="space-y-3">
                                                <h3 className="text-lg font-semibold text-gray-900 flex items-center">
                                                    <i className="fas fa-archive text-emerald-600 mr-2"></i>
                                                    Rapports comité PMO ({savedCommitteeReports.length})
                                                </h3>
                                                {savedCommitteeReports.map(report => (
                                                    <div key={report.id} className="bg-white border border-gray-200 rounded-lg p-4">
                                                        <div className="flex items-center justify-between mb-2">
                                                            <h4 className="font-medium text-gray-900">{report.title}</h4>
                                                            <div className="flex space-x-2">
                                                                <button
                                                                    onClick={() => handleExportToPDF(report.content, report.title)}
                                                                    className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700"
                                                                    title="Exporter en PDF"
                                                                >
                                                                    <i className="fas fa-file-pdf mr-1"></i>PDF
                                                                </button>
                                                                <button
                                                                    onClick={() => handleDeleteCommitteeReport(report.id)}
                                                                    className="text-red-600 hover:text-red-800 transition-colors p-2 rounded hover:bg-red-50"
                                                                    title="Supprimer le rapport comité"
                                                                >
                                                                    <i className="fas fa-trash"></i>
                                                                </button>
                                                            </div>
                                                        </div>
                                                        <p className="text-xs text-gray-500 mb-2">Créé le: {report.createdAt}</p>
                                                        <div className="bg-gray-50 p-3 rounded text-sm">
                                                            <pre className="whitespace-pre-wrap text-gray-700 font-mono text-xs">
                                                                {report.content.substring(0, 240)}...
                                                            </pre>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {workspaceTab === 'history' && (
                                    <HistoryWorkspaceTab
                                        organizationId={currentUser?.organizationId}
                                        projectId={String(currentProject.id)}
                                        language={isFr ? 'fr' : 'en'}
                                    />
                                )}

                                {workspaceTab === 'performance' && (
                                    <WorkspaceSection
                                        title={isFr ? 'Indicateurs projet' : 'Project indicators'}
                                        description={
                                            isFr
                                                ? 'Vue synthèse (charge, pénalités, jalons) — agrégation cockpit.'
                                                : 'Summary view (load, penalties, milestones) — cockpit aggregation.'
                                        }
                                    >
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <TimelineEmptyState
                                                title={isFr ? 'Santé & risques' : 'Health & risks'}
                                                description={`${workspaceHealthLabel} · ${unresolvedHighRisks} ${isFr ? 'risque(s) critique(s) ouvert(s)' : 'open critical risk(s)'}`}
                                            />
                                            <TimelineEmptyState
                                                title={isFr ? 'Productivité tâches' : 'Task productivity'}
                                                description={`${cockpit.completedTasks}/${cockpit.totalTasks} ${isFr ? 'tâches réalisées' : 'tasks completed'} · ${cockpit.blockedTasksCount} ${isFr ? 'bloquées' : 'blocked'}`}
                                            />
                                        </div>
                                    </WorkspaceSection>
                                )}

                                {workspaceTab === 'team' && (
                                    <div className="space-y-6">
                                        <ObjectivesBlock
                                            objectives={objectives}
                                            entityType="project"
                                            entityId={String(currentProject.id)}
                                            setView={setView}
                                            maxItems={10}
                                        />
                                    </div>
                                )}

                                {workspaceTab === 'documents' && (
                                    <div className="space-y-6">
                                        {projectAttachmentsUnavailable ? (
                                            <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
                                                {isFr
                                                    ? 'Les pièces jointes projet ne sont pas disponibles (API ou stockage). Réessayez après configuration Supabase « project_attachments » / bucket.'
                                                    : 'Project attachments are unavailable (API or storage). Retry after configuring Supabase « project_attachments » / bucket.'}
                                            </div>
                                        ) : (
                                            <>
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-lg font-semibold text-gray-900">Pièces jointes</h3>
                                            <label className="inline-flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg cursor-pointer text-sm font-medium disabled:opacity-50">
                                                <i className="fas fa-upload"></i>
                                                {uploadingAttachment ? 'Envoi…' : 'Ajouter un fichier'}
                                                <input
                                                    type="file"
                                                    className="hidden"
                                                    onChange={handleUploadAttachment}
                                                    disabled={uploadingAttachment}
                                                />
                                            </label>
                                        </div>
                                        {attachmentsLoading ? (
                                            <p className="text-gray-500">Chargement…</p>
                                        ) : attachments.length === 0 ? (
                                            <p className="text-gray-500">Aucune pièce jointe. Utilisez « Ajouter un fichier » pour en déposer.</p>
                                        ) : (
                                            <ul className="divide-y divide-gray-200 border border-gray-200 rounded-lg overflow-hidden">
                                                {attachments.map((a) => (
                                                    <li key={a.id} className="flex items-center justify-between px-4 py-3 bg-white hover:bg-gray-50">
                                                        <div className="flex items-center gap-3 min-w-0">
                                                            <i className="fas fa-file text-amber-600"></i>
                                                            <div className="min-w-0">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleDownloadAttachment(a)}
                                                                    className="text-sm font-medium text-emerald-600 hover:underline truncate block text-left"
                                                                >
                                                                    {a.fileName}
                                                                </button>
                                                                <span className="text-xs text-gray-500">
                                                                    {(a.fileSize / 1024).toFixed(1)} Ko · {new Date(a.createdAt).toLocaleDateString('fr-FR')}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {canManageProject && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleDeleteAttachment(a.id)}
                                                                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                                                                title="Supprimer"
                                                            >
                                                                <i className="fas fa-trash"></i>
                                                            </button>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* Onglet Budget (Phase 2) : prévu vs réel */}
                                {workspaceTab === 'budget' && (
                                    <div className="space-y-6">
                                        <h3 className="text-lg font-semibold text-gray-900">Budget du projet</h3>
                                        <p className="text-sm text-gray-500">Budget prévisionnel et lignes par poste de dépense ; suivi prévu vs réel.</p>
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                <p className="text-xs text-slate-500">Total prévu</p>
                                                <p className="text-lg font-semibold text-slate-900">{cockpit.budgetPlannedTotal.toLocaleString()} {currentProject.budgetCurrency || 'XOF'}</p>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                <p className="text-xs text-slate-500">Total réel</p>
                                                <p className="text-lg font-semibold text-slate-900">{cockpit.budgetRealTotal.toLocaleString()} {currentProject.budgetCurrency || 'XOF'}</p>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                <p className="text-xs text-slate-500">Variance</p>
                                                <p className={`text-lg font-semibold ${cockpit.budgetVariance >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                    {cockpit.budgetVariance >= 0 ? '+' : ''}{cockpit.budgetVariance.toLocaleString()} ({cockpit.budgetVariancePercent.toFixed(1)}%)
                                                </p>
                                            </div>
                                            <div className="rounded-lg border border-slate-200 bg-white p-3">
                                                <p className="text-xs text-slate-500">Alerte budget</p>
                                                <p className={`text-sm font-semibold ${
                                                    cockpit.budgetAlertLevel === 'critical' ? 'text-red-700' :
                                                    cockpit.budgetAlertLevel === 'warning' ? 'text-amber-700' :
                                                    cockpit.budgetAlertLevel === 'under' ? 'text-emerald-700' :
                                                    'text-slate-700'
                                                }`}>
                                                    {cockpit.budgetAlertLevel === 'critical' ? 'Critique (>= 15%)' :
                                                     cockpit.budgetAlertLevel === 'warning' ? 'Surveillance (>= 8%)' :
                                                     cockpit.budgetAlertLevel === 'under' ? 'Sous consommation' : 'Sous contrôle'}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-4 mb-4">
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">Budget prévisionnel total</label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step={1}
                                                        value={currentProject.budgetPlanned ?? ''}
                                                        onChange={(e) => handleUpdateBudget({ budgetPlanned: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                        className="w-40 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                                    />
                                                    <select
                                                        value={currentProject.budgetCurrency || 'XOF'}
                                                        onChange={(e) => handleUpdateBudget({ budgetCurrency: e.target.value as any })}
                                                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                                    >
                                                        {SUPPORTED_CURRENCIES.map((c) => (
                                                            <option key={c} value={c}>{c}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={handleAddBudgetLine}
                                                className="mt-6 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700"
                                            >
                                                <i className="fas fa-plus mr-2"></i>Ligne budgétaire
                                            </button>
                                        </div>
                                        {(currentProject.budgetLines || []).length === 0 ? (
                                            <p className="text-gray-500 text-sm">Aucune ligne. Cliquez sur « Ligne budgétaire » pour ajouter un poste de dépense.</p>
                                        ) : (
                                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                                                <table className="min-w-full divide-y divide-gray-200">
                                                    <thead className="bg-gray-50">
                                                        <tr>
                                                            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Poste</th>
                                                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Prévu</th>
                                                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Réel</th>
                                                            <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Variance</th>
                                                            <th className="px-4 py-2 w-10"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-gray-200">
                                                        {(currentProject.budgetLines || []).map((line) => {
                                                            const lineVariance = (line.realAmount || 0) - (line.plannedAmount || 0);
                                                            const lineVariancePct = (line.plannedAmount || 0) > 0 ? (lineVariance / (line.plannedAmount || 1)) * 100 : 0;
                                                            return (
                                                            <tr key={line.id}>
                                                                <td className="px-4 py-2">
                                                                    <input
                                                                        type="text"
                                                                        value={line.label}
                                                                        onChange={(e) => handleUpdateBudgetLine(line.id, { label: e.target.value })}
                                                                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                                                        placeholder="Libellé"
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-2 text-right">
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        value={line.plannedAmount}
                                                                        onChange={(e) => handleUpdateBudgetLine(line.id, { plannedAmount: Number(e.target.value) })}
                                                                        className="w-28 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-2 text-right">
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        value={line.realAmount ?? ''}
                                                                        onChange={(e) => handleUpdateBudgetLine(line.id, { realAmount: e.target.value === '' ? undefined : Number(e.target.value) })}
                                                                        className="w-28 px-2 py-1 border border-gray-300 rounded text-sm text-right"
                                                                    />
                                                                </td>
                                                                <td className={`px-4 py-2 text-right text-xs font-semibold ${lineVariance >= 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                                                    {lineVariance >= 0 ? '+' : ''}{lineVariance.toLocaleString()} ({lineVariancePct.toFixed(1)}%)
                                                                </td>
                                                                <td className="px-4 py-2">
                                                                    <button type="button" onClick={() => handleRemoveBudgetLine(line.id)} className="text-red-600 hover:text-red-800 p-1" title="Supprimer"><i className="fas fa-trash"></i></button>
                                                                </td>
                                                            </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                        {(currentProject.budgetLines || []).length > 0 && (
                                            <p className="text-xs text-gray-500">
                                                Total prévu : {(currentProject.budgetLines || []).reduce((s, l) => s + (l.plannedAmount || 0), 0).toLocaleString()} {currentProject.budgetCurrency || 'XOF'} · 
                                                Total réel : {(currentProject.budgetLines || []).reduce((s, l) => s + (l.realAmount || 0), 0).toLocaleString()} {currentProject.budgetCurrency || 'XOF'}
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>

                        <aside
                            className="hidden w-[min(100%,380px)] shrink-0 flex-col border-l border-slate-200 bg-slate-50/90 lg:flex lg:flex-col"
                            aria-label={isFr ? 'Inspecteur contextuel' : 'Context inspector'}
                        >
                            <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3">
                                <div className="flex items-center justify-between gap-2">
                                    <h2 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                        {inspectedTask
                                            ? isFr
                                                ? 'Tâche'
                                                : 'Task'
                                            : isFr
                                              ? 'Contexte projet'
                                              : 'Project context'}
                                    </h2>
                                    {inspectedTask ? (
                                        <button
                                            type="button"
                                            className="rounded-lg px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                                            onClick={() => setInspectorTaskId(null)}
                                        >
                                            {isFr ? 'Vue projet' : 'Project view'}
                                        </button>
                                    ) : null}
                        </div>
                    </div>
                            <div className="flex min-h-0 flex-1 flex-col p-4">
                                {inspectedTask ? renderTaskInspectorBody(inspectedTask) : renderProjectInspectorBody()}
                            </div>
                        </aside>
                    </div>
                </ObjectWorkspaceFloorplan>
                </div>
            </WorkspaceRouteShell>

            {isAddTaskDrawerOpen && canGovernTasks && (
                <div className="fixed inset-0 z-[60] flex justify-end">
                    <button
                        type="button"
                        className="absolute inset-0 bg-slate-900/40"
                        aria-label={isFr ? 'Fermer' : 'Close'}
                        onClick={() => setIsAddTaskDrawerOpen(false)}
                    />
                    <div className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
                        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                            <h3 className="text-sm font-semibold text-slate-900">
                                {isFr ? 'Nouvelle tâche' : 'New task'}
                            </h3>
                            <button
                                type="button"
                                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                onClick={() => setIsAddTaskDrawerOpen(false)}
                                aria-label={isFr ? 'Fermer' : 'Close'}
                            >
                                <i className="fas fa-times" />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto overscroll-contain p-5">
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <input
                                        type="text"
                                        value={newTaskText}
                                        onChange={(e) => setNewTaskText(e.target.value)}
                                        placeholder={isFr ? 'Nom de la tâche (8-120 car.)' : 'Task title (8-120 chars)'}
                                        className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0d1b2a]/15"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newTaskText.trim()) handleAddTask();
                                        }}
                                    />
                                    <input
                                        type="date"
                                        value={newTaskDueDate}
                                        onChange={(e) => setNewTaskDueDate(e.target.value)}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                        title={isFr ? 'Échéance' : 'Due'}
                                    />
                                    <select
                                        value={newTaskPriority}
                                        onChange={(e) => setNewTaskPriority(e.target.value as 'Low' | 'Medium' | 'High')}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        <option value="Low">{isFr ? 'Faible' : 'Low'}</option>
                                        <option value="Medium">{isFr ? 'Moyen' : 'Medium'}</option>
                                        <option value="High">{isFr ? 'Haut' : 'High'}</option>
                                    </select>
                                    <select
                                        required
                                        value={newTaskAssignee}
                                        onChange={(e) => setNewTaskAssignee(e.target.value)}
                                        className="md:col-span-2 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    >
                                        <option value="" disabled>
                                            {isFr ? 'Assigné (obligatoire)' : 'Assignee (required)'}
                                        </option>
                                        {(currentProject.team || []).map((m) => (
                                            <option key={m.id} value={String(m.id)}>
                                                {m.fullName || m.email}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <div>
                                        <label className="mb-1 block text-xs text-slate-500">
                                            {isFr ? 'Début période (optionnel)' : 'Period start'}
                                        </label>
                                        <input
                                            type="date"
                                            value={newTaskPeriodStart}
                                            onChange={(e) => setNewTaskPeriodStart(e.target.value)}
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="mb-1 block text-xs text-slate-500">
                                            {isFr ? 'Fin période / pilotage' : 'Period end'}
                                        </label>
                                        <input
                                            type="date"
                                            value={newTaskPeriodEnd}
                                            onChange={(e) => setNewTaskPeriodEnd(e.target.value)}
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="mb-1 block text-xs text-slate-500">
                                        {isFr ? 'Consigne manager' : 'Manager brief'}
                                    </label>
                                    <textarea
                                        value={newTaskManagerComment}
                                        onChange={(e) => setNewTaskManagerComment(e.target.value)}
                                        rows={3}
                                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                        placeholder={isFr ? 'Instructions…' : 'Instructions…'}
                                    />
                                </div>
                                <details className="rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2">
                                    <summary className="cursor-pointer text-xs text-slate-600">
                                        {isFr ? 'Critères SMART (optionnel)' : 'SMART criteria (optional)'}
                                    </summary>
                                    <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
                                        <input
                                            type="text"
                                            placeholder="Spécifique"
                                            value={newTaskSmartCriteria.specific ?? ''}
                                            onChange={(e) =>
                                                setNewTaskSmartCriteria((p) => ({ ...p, specific: e.target.value || undefined }))
                                            }
                                            className="rounded border px-2 py-1"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Mesurable"
                                            value={newTaskSmartCriteria.measurable ?? ''}
                                            onChange={(e) =>
                                                setNewTaskSmartCriteria((p) => ({ ...p, measurable: e.target.value || undefined }))
                                            }
                                            className="rounded border px-2 py-1"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Atteignable"
                                            value={newTaskSmartCriteria.achievable ?? ''}
                                            onChange={(e) =>
                                                setNewTaskSmartCriteria((p) => ({ ...p, achievable: e.target.value || undefined }))
                                            }
                                            className="rounded border px-2 py-1"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Pertinent"
                                            value={newTaskSmartCriteria.relevant ?? ''}
                                            onChange={(e) =>
                                                setNewTaskSmartCriteria((p) => ({ ...p, relevant: e.target.value || undefined }))
                                            }
                                            className="rounded border px-2 py-1"
                                        />
                                        <input
                                            type="text"
                                            placeholder="Temporel"
                                            value={newTaskSmartCriteria.timeBound ?? ''}
                                            onChange={(e) =>
                                                setNewTaskSmartCriteria((p) => ({ ...p, timeBound: e.target.value || undefined }))
                                            }
                                            className="rounded border px-2 py-1"
                                        />
                                    </div>
                                </details>
                                <p className="text-xs text-slate-500">
                                    {isFr
                                        ? 'Date/heure cible : sans « Réalisé », la tâche peut être gelée ; le manager débloque.'
                                        : 'Scheduled slot: task may freeze without completion; manager can unblock.'}
                                </p>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <input
                                        type="date"
                                        value={newTaskScheduledDate}
                                        onChange={(e) => setNewTaskScheduledDate(e.target.value)}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                    <input
                                        type="time"
                                        value={newTaskScheduledTime}
                                        onChange={(e) => setNewTaskScheduledTime(e.target.value)}
                                        className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                    />
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="number"
                                            min={1}
                                            value={newTaskScheduledDuration}
                                            onChange={(e) => setNewTaskScheduledDuration(Number(e.target.value) || 60)}
                                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                                        />
                                        <span className="text-xs text-slate-500">min</span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAddTask}
                                    disabled={
                                        !newTaskText.trim() ||
                                        newTaskText.trim().length < TASK_TITLE_MIN ||
                                        newTaskText.trim().length > TASK_TITLE_MAX
                                    }
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#0d1b2a] py-3 text-sm font-semibold text-white disabled:opacity-50"
                                >
                                    <i className="fas fa-plus" />
                                    {isFr ? 'Ajouter la tâche' : 'Add task'}
                                </button>
                                <p className="text-xs text-slate-500">
                                    {isFr ? 'Titre : ' : 'Title: '}
                                    {newTaskText.trim().length}/{TASK_TITLE_MAX} ({isFr ? 'min' : 'min'} {TASK_TITLE_MIN})
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Modals */}
            {isProjectMetaWizardOpen && (
                <ProjectCreatePage
                    users={users}
                    editingProject={currentProject}
                    onClose={() => setProjectMetaWizardOpen(false)}
                    onSave={async (data) => {
                        await Promise.resolve(onUpdateProject(data as Project));
                    }}
                />
            )}

            {isLogTimeModalOpen && currentUser && (
                <LogTimeModal
                    onClose={() => setLogTimeModalOpen(false)}
                    onSave={handleSaveTimeLog}
                    projects={[currentProject]}
                    courses={[]}
                    user={currentUser}
                    initialEntity={{ type: 'project', id: currentProject.id }}
                />
            )}

            {isDeleteModalOpen && (
                <ConfirmationModal
                    title="Supprimer le projet"
                    message={`Êtes-vous sûr de vouloir supprimer le projet "${currentProject.title}" ? Cette action est irréversible.`}
                    onConfirm={() => {
                        if (!canManageProject) {
                            alert(t('project_permission_error'));
                            setDeleteModalOpen(false);
                            return;
                        }
                        onDeleteProject(currentProject.id);
                        onClose();
                    }}
                    onCancel={() => setDeleteModalOpen(false)}
                    confirmText="Supprimer"
                    cancelText="Annuler"
                    confirmButtonClass="bg-red-600 hover:bg-red-700"
                />
            )}
        </>
        </ProjectWorkspaceProvider>
    );
};

export default ProjectObjectWorkspace;
export { ProjectObjectWorkspace, ProjectObjectWorkspace as ProjectDetailPage };
export type { ProjectWorkspaceTab } from './project/workspace/types';

