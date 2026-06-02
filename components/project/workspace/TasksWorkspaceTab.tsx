import React from 'react';
import { getTaskGovernance, isTaskScheduledFrozen as isTaskFrozen } from '../../../utils/projectTaskLifecycle';
import { normalizeTaskStatus, TASK_STATUS_CANONICAL, taskStatusCanonToLabel } from '../../../utils/taskStatus';
import type { Project, Task } from '../../../types';

export type TasksWorkspaceTabProps = {
  isFr: boolean;
  canGovernTasks: boolean;
  canManageProject: boolean;
  project: Project;
  taskReadModel?: { total?: number; in_progress?: number; done?: number; blocked?: number; on_hold?: number; overdue?: number };
  riskReadModel?: { open?: number; mitigating?: number; closed?: number; high?: number; overdue?: number; rag?: string };
  commitTasks: (tasks: Task[]) => void;
  onOpenAddTaskDrawer: () => void;
  taskViewMode: 'table' | 'kanban';
  setTaskViewMode: React.Dispatch<React.SetStateAction<'table' | 'kanban'>>;
  taskSearch: string;
  setTaskSearch: React.Dispatch<React.SetStateAction<string>>;
  taskStatusFilter: 'all' | Task['status'];
  setTaskStatusFilter: React.Dispatch<React.SetStateAction<'all' | Task['status']>>;
  taskPriorityFilter: 'all' | Task['priority'];
  setTaskPriorityFilter: React.Dispatch<React.SetStateAction<'all' | Task['priority']>>;
  taskAssigneeFilter: string;
  setTaskAssigneeFilter: React.Dispatch<React.SetStateAction<string>>;
  taskSortBy: 'dueDate' | 'priority' | 'status';
  setTaskSortBy: React.Dispatch<React.SetStateAction<'dueDate' | 'priority' | 'status'>>;
  filteredTasks: Task[];
  filteredFrozenCount: number;
  filteredTaskIds: string[];
  allFilteredSelected: boolean;
  selectedTaskCount: number;
  selectedTaskIds: string[];
  setSelectedTaskIds: React.Dispatch<React.SetStateAction<string[]>>;
  toggleTaskSelection: (taskId: string) => void;
  toggleSelectAllFilteredTasks: (checked: boolean, filteredIds: string[]) => void;
  bulkUpdateSelectedTasks: (updater: (task: Task) => Task) => void;
  inspectorTaskId: string | null;
  setInspectorTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  pendingTasks: Task[];
  setPendingTasks: React.Dispatch<React.SetStateAction<Task[]>>;
  onCancelPendingTasks: () => void;
  onSavePendingTasks: () => void | Promise<void>;
  kanbanColumns: Array<{ key: Task['status']; label: string }>;
  onKanbanDrop: (targetStatus: Task['status']) => void;
  setKanbanDraggingTaskId: React.Dispatch<React.SetStateAction<string | null>>;
  formatDateForInput: (dateString?: string) => string;
  requireJustification: boolean;
  currentUserId?: string | null;
  onUpdateTask: (taskId: string, updates: Partial<Task>) => void | Promise<void>;
};

export const TasksWorkspaceTab: React.FC<TasksWorkspaceTabProps> = ({
  isFr,
  canGovernTasks,
  canManageProject,
  project,
  taskReadModel,
  riskReadModel,
  commitTasks,
  onOpenAddTaskDrawer,
  taskViewMode,
  setTaskViewMode,
  taskSearch,
  setTaskSearch,
  taskStatusFilter,
  setTaskStatusFilter,
  taskPriorityFilter,
  setTaskPriorityFilter,
  taskAssigneeFilter,
  setTaskAssigneeFilter,
  taskSortBy,
  setTaskSortBy,
  filteredTasks,
  filteredFrozenCount,
  filteredTaskIds,
  allFilteredSelected,
  selectedTaskCount,
  selectedTaskIds,
  setSelectedTaskIds,
  toggleTaskSelection,
  toggleSelectAllFilteredTasks,
  bulkUpdateSelectedTasks,
  inspectorTaskId,
  setInspectorTaskId,
  pendingTasks,
  setPendingTasks,
  onCancelPendingTasks,
  onSavePendingTasks,
  kanbanColumns,
  onKanbanDrop,
  setKanbanDraggingTaskId,
  formatDateForInput,
  requireJustification,
  currentUserId,
  onUpdateTask,
}) => (
                                <div className="space-y-6">
                                    {(taskReadModel || riskReadModel) && (
                                        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm text-xs text-slate-700">
                                            {taskReadModel && (
                                                <>
                                                    <span>Tâches: {taskReadModel.total ?? 0}</span>
                                                    <span>En cours: {taskReadModel.in_progress ?? 0}</span>
                                                    <span>Bloquées: {taskReadModel.blocked ?? 0}</span>
                                                    <span>En pause: {taskReadModel.on_hold ?? 0}</span>
                                                    <span>En retard: {taskReadModel.overdue ?? 0}</span>
                                                </>
                                            )}
                                            {riskReadModel && (
                                                <>
                                                    <span>Risques ouverts: {riskReadModel.open ?? 0}</span>
                                                    <span>En mitigation: {riskReadModel.mitigating ?? 0}</span>
                                                    <span>Critiques: {riskReadModel.high ?? 0}</span>
                                                    <span>En retard: {riskReadModel.overdue ?? 0}</span>
                                                    <span>RAG: {riskReadModel.rag ?? 'ok'}</span>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    {canGovernTasks && (
                                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                                            <p className="text-sm text-slate-600">
                                                {isFr
                                                    ? 'Créez une tâche dans le panneau latéral — la liste reste lisible.'
                                                    : 'Create tasks in the side panel — keep the list scannable.'}
                                            </p>
                                    <button
                                                type="button"
                                                onClick={() => onOpenAddTaskDrawer()}
                                                className="inline-flex items-center gap-2 rounded-xl bg-[#0d1b2a] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1a3a5c]"
                                            >
                                                <i className="fas fa-plus" />
                                                {isFr ? 'Nouvelle tâche' : 'New task'}
                                    </button>
                            </div>
                                    )}
                                    {!canGovernTasks && (
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                                            Vous pouvez réaliser les tâches qui vous sont assignées (justificatif si exigé) et mettre à jour l’avancement. La création et la structure des tâches sont réservées aux rôles autorisés (manager, superviseur, formateur, administrateur…). Après échéance non tenue, la tâche se clôture automatiquement ; votre manager peut réaffecter ou clôturer.
                                        </div>
                                    )}

                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <div className="mb-3 flex items-center justify-between">
                                            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1">
                                                <button
                                                    type="button"
                                                    className={`px-3 py-1.5 text-xs rounded-lg ${taskViewMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                                                    onClick={() => setTaskViewMode('table')}
                                                >
                                                    Table
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`px-3 py-1.5 text-xs rounded-lg ${taskViewMode === 'kanban' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}
                                                    onClick={() => setTaskViewMode('kanban')}
                                                >
                                                    Kanban
                                                </button>
                                            </div>
                                            <span className="text-xs text-slate-600">{selectedTaskCount} sélectionnée(s)</span>
                                        </div>
                                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                                            <input
                                                type="text"
                                                value={taskSearch}
                                                onChange={(e) => setTaskSearch(e.target.value)}
                                                placeholder="Rechercher une tâche..."
                                                className="md:col-span-2 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                            />
                                            <select value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value as any)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                                                <option value="all">Tous statuts</option>
                                                {TASK_STATUS_CANONICAL.map((s) => (
                                                    <option key={s} value={s}>
                                                        {taskStatusCanonToLabel(s)}
                                                    </option>
                                                ))}
                                            </select>
                                            <select value={taskPriorityFilter} onChange={(e) => setTaskPriorityFilter(e.target.value as any)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                                                <option value="all">Toutes priorités</option>
                                                <option value="High">Haute</option>
                                                <option value="Medium">Moyenne</option>
                                                <option value="Low">Faible</option>
                                            </select>
                                            <select value={taskAssigneeFilter} onChange={(e) => setTaskAssigneeFilter(e.target.value)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                                                <option value="all">Toute l'équipe</option>
                                                <option value="unassigned">Non attribuée</option>
                                                {project.team.map(member => (
                                                    <option key={member.id} value={String(member.id)}>{member.fullName || member.email}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="mt-3 flex flex-wrap items-center gap-3">
                                            <select value={taskSortBy} onChange={(e) => setTaskSortBy(e.target.value as any)} className="px-3 py-2 border border-slate-300 rounded-lg text-sm">
                                                <option value="dueDate">Tri: échéance</option>
                                                <option value="priority">Tri: priorité</option>
                                                <option value="status">Tri: statut</option>
                                            </select>
                                            <button
                                                type="button"
                                                className="btn-3d-secondary"
                                                onClick={() => {
                                                    setTaskSearch('');
                                                    setTaskStatusFilter('all');
                                                    setTaskPriorityFilter('all');
                                                    setTaskAssigneeFilter('all');
                                                    setTaskSortBy('dueDate');
                                                }}
                                            >
                                                Réinitialiser
                                            </button>
                                            {canGovernTasks && (
                                                <>
                                                    <button
                                                        type="button"
                                                        className="btn-3d-secondary"
                                                        onClick={() => {
                                                            const filteredIds = new Set(filteredTasks.map((t) => t.id));
                                                            const updatedTasks = (project.tasks || []).map((task) => (
                                                                filteredIds.has(task.id) && task.status === 'To Do'
                                                                    ? { ...task, status: 'In Progress' as const }
                                                                    : task
                                                            ));
                                                            commitTasks(updatedTasks);
                                                        }}
                                                    >
                                                        Passer filtrées en cours
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-3d-secondary"
                                                        disabled={filteredFrozenCount === 0}
                                                        onClick={() => {
                                                            const filteredIds = new Set(filteredTasks.map((t) => t.id));
                                                            const updatedTasks = (project.tasks || []).map((task) => (
                                                                filteredIds.has(task.id) ? { ...task, isFrozen: false } : task
                                                            ));
                                                            commitTasks(updatedTasks);
                                                        }}
                                                    >
                                                        Débloquer gelées ({filteredFrozenCount})
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-3d-secondary"
                                                        disabled={selectedTaskCount === 0}
                                                        onClick={() => {
                                                            bulkUpdateSelectedTasks((task) => ({ ...task, status: 'In Progress' }));
                                                        }}
                                                    >
                                                        Bulk: en cours
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-3d-secondary"
                                                        disabled={selectedTaskCount === 0}
                                                        onClick={() => {
                                                            let blocked = 0;
                                                            bulkUpdateSelectedTasks((task) => {
                                                                const hasJustif = (task.justificationAttachmentIds?.length ?? 0) > 0;
                                                                if (requireJustification && !hasJustif) {
                                                                    blocked += 1;
                                                                    return task;
                                                                }
                                                                return {
                                                                    ...task,
                                                                    status: 'Completed',
                                                                    taskGovernance: 'done_proven' as const,
                                                                    completedAt: new Date().toISOString(),
                                                                    completedById: currentUserId,
                                                                    isFrozen: false,
                                                                };
                                                            });
                                                            if (blocked > 0) {
                                                                alert(`${blocked} tâche(s) non complétée(s): justificatif manquant.`);
                                                            }
                                                        }}
                                                    >
                                                        Bulk: clôturer
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="btn-3d-danger"
                                                        disabled={selectedTaskCount === 0}
                                                        onClick={() => {
                                                            if (!confirm(`Supprimer ${selectedTaskCount} tâche(s) sélectionnée(s) ?`)) return;
                                                            const selected = new Set(selectedTaskIds);
                                                            const updatedTasks = (project.tasks || []).filter((task) => !selected.has(task.id));
                                                            commitTasks(updatedTasks);
                                                            setSelectedTaskIds([]);
                                                        }}
                                                    >
                                                        Bulk: supprimer
                                                    </button>
                                                    <select
                                                        className="px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                                        defaultValue=""
                                                        onChange={(e) => {
                                                            const assigneeId = e.target.value;
                                                            if (!assigneeId) return;
                                                            const assignee = project.team.find((m) => String(m.id) === String(assigneeId));
                                                            if (!assignee) return;
                                                            bulkUpdateSelectedTasks((task) => ({ ...task, assignee }));
                                                            e.target.value = '';
                                                        }}
                                                    >
                                                        <option value="">Bulk: assigner à...</option>
                                                        {project.team.map((member) => (
                                                            <option key={member.id} value={String(member.id)}>
                                                                {member.fullName || member.email}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </>
                                            )}
                                            <span className="text-xs text-slate-600">
                                                {filteredTasks.length} / {(project.tasks || []).length} tâche(s) affichée(s)
                                            </span>
                                        </div>
                                    </div>

                                    {/* Table / Kanban des tâches */}
                                    {taskViewMode === 'table' && (
                                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                                            <div className="overflow-x-auto">
                                                <table className="min-w-full divide-y divide-gray-200">
                                                    <thead className="bg-gray-50">
                                                        <tr>
                                                            <th scope="col" className="w-10 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                                <input
                                                                    type="checkbox"
                                                                    className="rounded"
                                                                    checked={allFilteredSelected}
                                                                    onChange={(e) => toggleSelectAllFilteredTasks(e.target.checked, filteredTaskIds)}
                                                                />
                                                            </th>
                                                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                                {isFr ? 'Tâche' : 'Task'}
                                                            </th>
                                                            <th className="hidden px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sm:table-cell">
                                                                {isFr ? 'Assigné' : 'Assignee'}
                                                            </th>
                                                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                                {isFr ? 'Échéance' : 'Due'}
                                                            </th>
                                                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                                {isFr ? 'Statut' : 'Status'}
                                                            </th>
                                                            <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                                {isFr ? 'Priorité' : 'Priority'}
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="bg-white divide-y divide-gray-200">
                                                        {/* Liste dense : détail dans l’inspecteur à droite */}
                                                        {filteredTasks.map((task) => {
                                                            const governance = getTaskGovernance(task);
                                                            const isOverdue =
                                                                !!task.dueDate &&
                                                                new Date(task.dueDate) < new Date() &&
                                                                task.status !== 'Completed';
                                                            const frozen = isTaskFrozen(task);
                                                            const blocked =
                                                                governance === 'not_realized' || governance === 'closed_out';
                                                            const statusLabel =
                                                                task.status === 'To Do'
                                                                    ? isFr
                                                                        ? 'À faire'
                                                                        : 'To do'
                                                                    : task.status === 'In Progress'
                                                                      ? isFr
                                                                          ? 'En cours'
                                                                          : 'In progress'
                                                                      : isFr
                                                                        ? 'Réalisé'
                                                                        : 'Done';
                                                            const statusPill =
                                                                task.status === 'Completed'
                                                                    ? 'bg-emerald-100 text-emerald-800'
                                                                    : task.status === 'In Progress'
                                                                      ? 'bg-blue-100 text-blue-800'
                                                                      : 'bg-slate-100 text-slate-700';
                                                            const priLabel =
                                                                task.priority === 'High'
                                                                    ? isFr
                                                                        ? 'Haute'
                                                                        : 'High'
                                                                    : task.priority === 'Medium'
                                                                      ? isFr
                                                                          ? 'Moyenne'
                                                                          : 'Medium'
                                                                      : isFr
                                                                        ? 'Faible'
                                                                        : 'Low';
                                                            const priPill =
                                                                task.priority === 'High'
                                                                    ? 'bg-red-100 text-red-800'
                                                                    : task.priority === 'Medium'
                                                                      ? 'bg-amber-100 text-amber-900'
                                                                      : 'bg-slate-100 text-slate-700';

                                                            return (
                                                                <tr
                                                                    key={task.id}
                                                                    role="button"
                                                                    tabIndex={0}
                                                                    onClick={(e) => {
                                                                        const el = e.target as HTMLElement;
                                                                        if (el.closest('input, button, label'))
                                                                            return;
                                                                        setInspectorTaskId((prev) =>
                                                                            prev === task.id ? null : task.id,
                                                                        );
                                                                    }}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                                            e.preventDefault();
                                                                            setInspectorTaskId((prev) =>
                                                                                prev === task.id ? null : task.id,
                                                                            );
                                                                        }
                                                                    }}
                                                                    className={`hover:bg-gray-50 ${frozen || blocked ? 'bg-amber-50 border-l-4 border-amber-500' : ''} cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[#0d1b2a]/30 ${inspectorTaskId === task.id ? 'bg-slate-50 ring-1 ring-inset ring-[#0d1b2a]/20' : ''}`}
                                                                >
                                                                    <td className="px-3 py-3 whitespace-nowrap align-middle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={selectedTaskIds.includes(task.id)}
                                                                        onChange={() => toggleTaskSelection(task.id)}
                                                                        className="rounded"
                                                                            title={
                                                                                frozen && !canManageProject
                                                                                    ? 'Tâche gelée : seul le manager peut clôturer'
                                                                                    : ''
                                                                            }
                                                                    />
                                                                </td>
                                                                    <td className="max-w-[min(28rem,55vw)] px-3 py-3 align-middle">
                                                                        <div className="min-w-0">
                                                                            <div className="flex items-center gap-2">
                                                                                <span className="truncate font-medium text-slate-900">
                                                                                    {task.text}
                                                                            </span>
                                                                                {frozen ? (
                                                                                    <span
                                                                                        className="shrink-0 text-amber-700"
                                                                                        title={
                                                                                            isFr
                                                                                                ? 'Gelée — voir inspecteur'
                                                                                                : 'Frozen — see inspector'
                                                                                        }
                                                                                    >
                                                                                        <i className="fas fa-pause-circle text-xs" />
                                                                                    </span>
                                                                                ) : null}
                                                                                {(task.justificationAttachmentIds?.length ??
                                                                                    0) > 0 ? (
                                                                                    <i
                                                                                        className="fas fa-paperclip shrink-0 text-xs text-emerald-700"
                                                                                        title={
                                                                                            isFr ? 'Justificatif lié' : 'Proof attached'
                                                                                        }
                                                                                    />
                                                                                ) : null}
                                                                            </div>
                                                                            {task.managerComment ? (
                                                                                <p className="mt-0.5 truncate text-xs text-slate-500">
                                                                                    {task.managerComment}
                                                                                </p>
                                                                            ) : null}
                                                                    </div>
                                                                </td>
                                                                    <td className="hidden max-w-[10rem] truncate px-3 py-3 align-middle text-sm text-slate-600 sm:table-cell">
                                                                        {task.assignee?.fullName ||
                                                                            task.assignee?.email ||
                                                                            '—'}
                                                                </td>
                                                                    <td className="whitespace-nowrap px-3 py-3 align-middle text-sm text-slate-600">
                                                                        <span>
                                                                            {task.dueDate
                                                                                ? new Date(task.dueDate).toLocaleDateString(
                                                                                      isFr ? 'fr-FR' : 'en-US',
                                                                                  )
                                                                                : '—'}
                                                                        </span>
                                                                        {task.scheduledDate ? (
                                                                            <i
                                                                                className="fas fa-clock ml-1 text-xs text-slate-400"
                                                                                title={`${task.scheduledDate} ${task.scheduledTime || ''}`}
                                                                            />
                                                                        ) : null}
                                                                        {isOverdue ? (
                                                                            <span className="ml-1 text-xs font-medium text-red-600">
                                                                                {isFr ? 'Retard' : 'Late'}
                                                                            </span>
                                                                        ) : null}
                                                                </td>
                                                                    <td className="whitespace-nowrap px-3 py-3 align-middle">
                                                                        <span
                                                                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${statusPill}`}
                                                                        >
                                                                            {statusLabel}
                                                                        </span>
                                                                </td>
                                                                    <td className="whitespace-nowrap px-3 py-3 align-middle">
                                                                        <span
                                                                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${priPill}`}
                                                                        >
                                                                            {priLabel}
                                                                        </span>
                                                                </td>
                                                            </tr>
                                                            );
                                                        })}
                                                        
                                                        {/* Afficher les tâches temporaires générées par l'IA */}
                                                        {pendingTasks.map((task) => {
                                                            const isOverdue =
                                                                !!task.dueDate &&
                                                                new Date(task.dueDate) < new Date() &&
                                                                task.status !== 'Completed';
                                                            return (
                                                                <tr
                                                                    key={task.id}
                                                                    className="border-l-4 border-yellow-400 bg-yellow-50/90 hover:bg-yellow-50"
                                                                >
                                                                    <td className="whitespace-nowrap px-3 py-3 align-middle">
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={task.status === 'Completed'}
                                                                        onChange={(e) => {
                                                                                const newStatus = e.target.checked
                                                                                    ? 'Completed'
                                                                                    : 'To Do';
                                                                                setPendingTasks(
                                                                                    pendingTasks.map((t) =>
                                                                                        t.id === task.id
                                                                                            ? { ...t, status: newStatus }
                                                                                            : t,
                                                                                    ),
                                                                                );
                                                                        }}
                                                                        className="rounded"
                                                                    />
                                                                </td>
                                                                    <td className="max-w-[min(28rem,55vw)] px-3 py-3 align-middle">
                                                                        <div className="flex items-start gap-2">
                                                                    <input
                                                                        type="text"
                                                                        value={task.text}
                                                                        onChange={(e) => {
                                                                                    setPendingTasks(
                                                                                        pendingTasks.map((t) =>
                                                                                            t.id === task.id
                                                                                                ? {
                                                                                                      ...t,
                                                                                                      text: e.target.value,
                                                                                                  }
                                                                                                : t,
                                                                                        ),
                                                                                    );
                                                                                }}
                                                                                className="min-w-0 flex-1 rounded border border-amber-200 bg-white px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                                                                                placeholder={
                                                                                    isFr ? 'Nom de la tâche' : 'Task title'
                                                                                }
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    setPendingTasks(
                                                                                        pendingTasks.filter(
                                                                                            (t) => t.id !== task.id,
                                                                                        ),
                                                                                    )
                                                                                }
                                                                                className="shrink-0 rounded p-1.5 text-red-600 hover:bg-red-50"
                                                                                title={
                                                                                    isFr
                                                                                        ? 'Retirer cette ligne'
                                                                                        : 'Remove row'
                                                                                }
                                                                            >
                                                                                <i className="fas fa-times text-xs" />
                                                                            </button>
                                                                        </div>
                                                                </td>
                                                                    <td className="hidden px-3 py-3 align-middle sm:table-cell">
                                                                    <select
                                                                            value={task.assignee?.id || ''}
                                                                        onChange={(e) => {
                                                                                const assigneeId = e.target.value;
                                                                                const assignee = assigneeId
                                                                                    ? project.team.find(
                                                                                          (m) => m.id === assigneeId,
                                                                                      )
                                                                                    : undefined;
                                                                                setPendingTasks(
                                                                                    pendingTasks.map((t) =>
                                                                                        t.id === task.id
                                                                                            ? { ...t, assignee }
                                                                                            : t,
                                                                                    ),
                                                                                );
                                                                            }}
                                                                            className="w-full max-w-[10rem] rounded border border-amber-200 bg-white px-2 py-1 text-xs"
                                                                        >
                                                                            <option value="">
                                                                                {isFr ? 'Non attribué' : 'Unassigned'}
                                                                            </option>
                                                                            {project.team.map((member) => (
                                                                                <option key={member.id} value={member.id}>
                                                                                    {member.fullName || member.email}
                                                                                </option>
                                                                            ))}
                                                                    </select>
                                                                </td>
                                                                    <td className="whitespace-nowrap px-3 py-3 align-middle">
                                                                    <input
                                                                        type="date"
                                                                        value={formatDateForInput(task.dueDate)}
                                                                        onChange={(e) => {
                                                                                setPendingTasks(
                                                                                    pendingTasks.map((t) =>
                                                                                        t.id === task.id
                                                                                            ? { ...t, dueDate: e.target.value }
                                                                                            : t,
                                                                                    ),
                                                                                );
                                                                            }}
                                                                            className="rounded border border-amber-200 bg-white px-2 py-1 text-xs"
                                                                        />
                                                                        {isOverdue ? (
                                                                            <span className="ml-1 text-xs font-medium text-red-600">
                                                                                {isFr ? 'Retard' : 'Late'}
                                                                            </span>
                                                                        ) : null}
                                                                </td>
                                                                    <td className="whitespace-nowrap px-3 py-3 align-middle">
                                                                    <select
                                                                            value={task.status}
                                                                        onChange={(e) => {
                                                                                setPendingTasks(
                                                                                    pendingTasks.map((t) =>
                                                                                        t.id === task.id
                                                                                            ? {
                                                                                                  ...t,
                                                                                                  status: e.target
                                                                                                      .value as Task['status'],
                                                                                              }
                                                                                            : t,
                                                                                    ),
                                                                                );
                                                                            }}
                                                                            className="rounded border border-amber-200 bg-white px-2 py-1 text-xs"
                                                                        >
                                                                            <option value="To Do">
                                                                                {isFr ? 'À faire' : 'To do'}
                                                                            </option>
                                                                            <option value="In Progress">
                                                                                {isFr ? 'En cours' : 'In progress'}
                                                                            </option>
                                                                            <option value="Completed">
                                                                                {isFr ? 'Réalisé' : 'Done'}
                                                                            </option>
                                                                    </select>
                                                                </td>
                                                                    <td className="whitespace-nowrap px-3 py-3 align-middle">
                                                                        <select
                                                                            value={task.priority}
                                                                            onChange={(e) => {
                                                                                setPendingTasks(
                                                                                    pendingTasks.map((t) =>
                                                                                        t.id === task.id
                                                                                            ? {
                                                                                                  ...t,
                                                                                                  priority: e.target
                                                                                                      .value as Task['priority'],
                                                                                              }
                                                                                            : t,
                                                                                    ),
                                                                                );
                                                                            }}
                                                                            className="rounded border border-amber-200 bg-white px-2 py-1 text-xs"
                                                                        >
                                                                            <option value="Low">
                                                                                {isFr ? 'Faible' : 'Low'}
                                                                                </option>
                                                                            <option value="Medium">
                                                                                {isFr ? 'Moyenne' : 'Medium'}
                                                                            </option>
                                                                            <option value="High">
                                                                                {isFr ? 'Haute' : 'High'}
                                                                            </option>
                                                                        </select>
                                                                </td>
                                                            </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                                
                                                {/* Boutons CTA pour les tâches temporaires */}
                                                {pendingTasks.length > 0 && (
                                                    <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center">
                                                                <i className="fas fa-exclamation-triangle text-yellow-600 mr-2"></i>
                                                                <span className="text-sm text-yellow-800">
                                                                    {pendingTasks.length} tâche(s) générée(s) par l'IA en attente de sauvegarde
                                                                </span>
                                                            </div>
                                                            <div className="flex space-x-2">
                                                                <button
                                                                    onClick={onCancelPendingTasks}
                                                                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                                                                >
                                                                    Annuler
                                                                </button>
                                                                <button
                                                                    onClick={onSavePendingTasks}
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
                                    )}
                                    {taskViewMode === 'kanban' && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            {kanbanColumns.map((column) => {
                                                const columnTasks = filteredTasks.filter((task) => task.status === column.key);
                                                return (
                                                    <div
                                                        key={column.key}
                                                        className="rounded-xl border border-slate-200 bg-white p-3 min-h-[360px]"
                                                        onDragOver={(e) => e.preventDefault()}
                                                        onDrop={() => onKanbanDrop(column.key)}
                                                    >
                                                        <div className="mb-3 flex items-center justify-between">
                                                            <h5 className="text-sm font-semibold text-slate-800">{column.label}</h5>
                                                            <span className="text-xs rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{columnTasks.length}</span>
                                                        </div>
                                                        <div className="space-y-2">
                                                            {columnTasks.map((task) => {
                                                                const isOverdue = task.dueDate && new Date(task.dueDate) < new Date() && task.status !== 'Completed';
                                                                return (
                                                                    <div
                                                                        key={task.id}
                                                                        draggable
                                                                        onDragStart={() => setKanbanDraggingTaskId(task.id)}
                                                                        onDragEnd={() => setKanbanDraggingTaskId(null)}
                                                                        role="button"
                                                                        tabIndex={0}
                                                                        onClick={(e) => {
                                                                            const el = e.target as HTMLElement;
                                                                            if (el.closest('input, button, label'))
                                                                                return;
                                                                            setInspectorTaskId((prev) =>
                                                                                prev === task.id ? null : task.id,
                                                                            );
                                                                        }}
                                                                        onKeyDown={(e) => {
                                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                                e.preventDefault();
                                                                                setInspectorTaskId((prev) =>
                                                                                    prev === task.id ? null : task.id,
                                                                                );
                                                                            }
                                                                        }}
                                                                        className={`rounded-lg border p-3 bg-slate-50 cursor-pointer ${selectedTaskIds.includes(task.id) ? 'border-emerald-400' : 'border-slate-200'} ${inspectorTaskId === task.id ? 'ring-2 ring-[#0d1b2a]/25' : ''}`}
                                                                    >
                                                                        <div className="mb-2 flex items-start justify-between gap-2">
                                                                            <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={selectedTaskIds.includes(task.id)}
                                                                                    onChange={() => toggleTaskSelection(task.id)}
                                                                                />
                                                                                Sel.
                                                                            </label>
                                                                            <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                                                                                task.priority === 'High' ? 'bg-red-100 text-red-700' :
                                                                                task.priority === 'Medium' ? 'bg-amber-100 text-amber-700' :
                                                                                'bg-slate-100 text-slate-700'
                                                                            }`}>
                                                                                {task.priority}
                                                                            </span>
                                                                        </div>
                                                                        <p className="text-sm font-medium text-slate-900 break-words">{task.text}</p>
                                                                        <div className="mt-2 space-y-1 text-xs text-slate-500">
                                                                            <p>
                                                                                {task.assignee ? `Assigné: ${task.assignee.fullName || task.assignee.email}` : 'Non attribuée'}
                                                                            </p>
                                                                            <p>
                                                                                {task.dueDate ? `Échéance: ${new Date(task.dueDate).toLocaleDateString('fr-FR')}` : 'Sans échéance'}
                                                                                {isOverdue && <span className="ml-2 text-red-600">En retard</span>}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
);

export default TasksWorkspaceTab;
