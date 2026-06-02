import React, { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Project, User } from '../types';
import TeamSelector from './common/TeamSelector';
import OrganizationService from '../services/organizationService';
import * as programmeService from '../services/programmeService';
import { postCoyaDebugIngest } from '../utils/coyaDebugIngest';

const PROJECT_TITLE_MIN = 10;
const PROJECT_TITLE_MAX = 120;
const PROJECT_DESCRIPTION_MIN = 30;
const PROJECT_DESCRIPTION_MAX = 1200;

type WizardStepId = 'basics' | 'planning' | 'team' | 'review';

interface ProjectCreatePageProps {
    onClose: () => void;
    onSave: (project: Omit<Project, 'id' | 'tasks' | 'risks'> | Project) => Promise<void>;
    users: User[];
    editingProject?: Project | null;
}

const ProjectCreatePage: React.FC<ProjectCreatePageProps> = ({
    onClose,
    onSave,
    users,
    editingProject = null
}) => {
    const [isLoading, setIsLoading] = useState(false);
    const submitInFlightRef = useRef(false);
    const isEditMode = !!editingProject?.id;
    const draftKey = useMemo(
        () => `coya.projectCreateWizard.draft.${isEditMode ? `edit.${editingProject!.id}` : 'new'}`,
        [isEditMode, editingProject],
    );

    const steps: Array<{ id: WizardStepId; title: string; subtitle: string }> = useMemo(
        () => [
            { id: 'basics', title: 'Informations', subtitle: 'Titre et description' },
            { id: 'planning', title: 'Planification', subtitle: 'Statut, dates, rattachement' },
            { id: 'team', title: 'Équipe', subtitle: 'Membres et gouvernance' },
            { id: 'review', title: 'Résumé', subtitle: 'Validation finale' },
        ],
        [],
    );
    const [step, setStep] = useState<WizardStepId>('basics');
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        status: 'Not Started' as 'Not Started' | 'In Progress' | 'Completed' | 'On Hold',
        startDate: '',
        dueDate: '',
        team: [] as User[],
        programmeId: '',
    });

    const [programmes, setProgrammes] = useState<{ id: string; name: string }[]>([]);

    const [errors, setErrors] = useState<Record<string, string>>({});

    useEffect(() => {
        // #region agent log
        postCoyaDebugIngest({
                sessionId: '5fe008',
                hypothesisId: 'H1',
                location: 'ProjectCreatePage.tsx:mount',
                message: 'wizard_mounted',
                data: { isEditMode },
                timestamp: Date.now(),
            });
        // #endregion
        return () => {
            // #region agent log
            postCoyaDebugIngest({
                    sessionId: '5fe008',
                    hypothesisId: 'H1',
                    location: 'ProjectCreatePage.tsx:unmount',
                    message: 'wizard_unmounted',
                    data: {},
                    timestamp: Date.now(),
                });
            // #endregion
        };
    }, [isEditMode]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const orgId = await OrganizationService.getCurrentUserOrganizationId();
            if (cancelled || !orgId) return;
            try {
                const list = await programmeService.listProgrammes(orgId);
                if (!cancelled) setProgrammes(list.map((p) => ({ id: p.id, name: p.name })));
            } catch {
                if (!cancelled) setProgrammes([]);
            }
        })();
        return () => { cancelled = true; };
    }, []);

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

    useEffect(() => {
        if (editingProject) {
            setFormData({
                title: editingProject.title,
                description: editingProject.description || '',
                status: editingProject.status,
                startDate: formatDateForInput(editingProject.startDate),
                dueDate: formatDateForInput(editingProject.dueDate),
                team: editingProject.team || [],
                programmeId: editingProject.programmeId ?? '',
            });
            setStep('basics');
        } else {
            // Définir la date de début par défaut à aujourd'hui pour les nouveaux projets
            const today = new Date().toISOString().split('T')[0];
            setFormData(prev => ({
                ...prev,
                startDate: today,
                programmeId: '',
            }));
        }
    }, [editingProject]);

    useEffect(() => {
        if (isEditMode) return;
        try {
            const raw = localStorage.getItem(draftKey);
            if (!raw) return;
            const parsed = JSON.parse(raw);
            if (parsed?.formData) setFormData(parsed.formData);
            if (parsed?.step) setStep(parsed.step);
        } catch {
            /* ignore */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draftKey]);

    useEffect(() => {
        if (isEditMode) return;
        const handle = window.setTimeout(() => {
            try {
                localStorage.setItem(draftKey, JSON.stringify({ step, formData, savedAt: new Date().toISOString() }));
            } catch {
                /* ignore */
            }
        }, 300);
        return () => window.clearTimeout(handle);
    }, [draftKey, formData, isEditMode, step]);

    /** Valide les champs de l’étape qu’on vient de terminer (avant d’afficher la suivante). */
    const validateCompletedStep = (completedStep: WizardStepId): boolean => {
        const newErrors: Record<string, string> = {};
        const titleLen = formData.title.trim().length;
        const descLen = formData.description.trim().length;

        const pushTitleDesc = () => {
            if (!titleLen) {
                newErrors.title = 'Le titre du projet est requis.';
            } else if (titleLen < PROJECT_TITLE_MIN || titleLen > PROJECT_TITLE_MAX) {
                newErrors.title = `Le titre doit contenir entre ${PROJECT_TITLE_MIN} et ${PROJECT_TITLE_MAX} caractères.`;
            }
            if (!descLen) {
                newErrors.description = 'La description du projet est requise.';
            } else if (descLen < PROJECT_DESCRIPTION_MIN || descLen > PROJECT_DESCRIPTION_MAX) {
                newErrors.description = `La description doit contenir entre ${PROJECT_DESCRIPTION_MIN} et ${PROJECT_DESCRIPTION_MAX} caractères.`;
            }
        };

        const pushPlanningDates = () => {
            if (!formData.dueDate) {
                newErrors.dueDate = 'La date d\'échéance est requise';
            }
            if (formData.startDate && formData.dueDate && formData.dueDate < formData.startDate) {
                newErrors.dueDate = 'La date d\'échéance doit être après la date de début.';
            }
        };

        if (completedStep === 'basics') {
            pushTitleDesc();
        } else if (completedStep === 'planning') {
            pushTitleDesc();
            pushPlanningDates();
        } else if (completedStep === 'team') {
            pushTitleDesc();
            pushPlanningDates();
            if (formData.team.length === 0) {
                newErrors.team = 'Au moins un membre de l\'équipe est requis';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    /** Validation finale (soumission depuis l’étape Résumé). */
    const validateFullForm = (): boolean => validateCompletedStep('team');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (submitInFlightRef.current) return;
        
        if (!validateFullForm()) {
            return;
        }

        submitInFlightRef.current = true;
        setIsLoading(true);
        let saveSucceeded = false;
        try {
            // Si on est en mode édition, inclure l'ID du projet
            const programmeIdNorm = formData.programmeId.trim() || null;
            const projectToSave = editingProject
                ? {
                    ...formData,
                    id: editingProject.id,
                    tasks: editingProject.tasks,
                    risks: editingProject.risks,
                    programmeId: programmeIdNorm,
                }
                : { ...formData, programmeId: programmeIdNorm };

            await onSave(projectToSave as Project | Omit<Project, 'id' | 'tasks' | 'risks'>);
            // #region agent log
            postCoyaDebugIngest({
                    sessionId: '5fe008',
                    hypothesisId: 'H1',
                    location: 'ProjectCreatePage.tsx:handleSubmit',
                    message: 'onSave_resolved',
                    data: { isEditMode },
                    timestamp: Date.now(),
                });
            // #endregion
            if (!isEditMode) {
                try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
            }
            saveSucceeded = true;
        } catch (error) {
            console.error('Erreur lors de la sauvegarde:', error);
        } finally {
            submitInFlightRef.current = false;
        }
        if (saveSucceeded) {
            // #region agent log
            postCoyaDebugIngest({
                    sessionId: '5fe008',
                    hypothesisId: 'H1',
                    location: 'ProjectCreatePage.tsx:handleSubmit',
                    message: 'wizard_onClose_after_success',
                    data: {},
                    timestamp: Date.now(),
                });
            // #endregion
            // Ne pas appeler setIsLoading(false) puis onClose() dans le même tick : React met à jour
            // les nœuds texte du bouton submit pendant que le portail se démonte → NotFoundError removeChild.
            // Déferrer la fermeture après peinture + tick suivant (évite conflit portail / submit / flushSync inter-racines).
            window.requestAnimationFrame(() => {
                window.setTimeout(() => {
                    onClose();
                }, 0);
            });
        } else {
            setIsLoading(false);
        }
    };

    const handleInputChange = (field: string, value: any) => {
        setFormData(prev => ({ ...prev, [field]: value }));
        // Effacer l'erreur du champ modifié
        if (errors[field]) {
            setErrors(prev => ({ ...prev, [field]: '' }));
        }
    };

    const handleTeamChange = (selectedUsers: User[]) => {
        handleInputChange('team', selectedUsers);
    };

    const stepIndex = steps.findIndex((s) => s.id === step);
    const canGoPrev = stepIndex > 0;
    const canGoNext = stepIndex >= 0 && stepIndex < steps.length - 1;

    const goPrev = () => {
        if (!canGoPrev) return;
        startTransition(() => setStep(steps[stepIndex - 1].id));
    };
    const goNext = () => {
        if (!canGoNext) return;
        if (!validateCompletedStep(step)) return;
        startTransition(() => setStep(steps[stepIndex + 1].id));
    };

    return (
        <div className="fixed inset-0 bg-slate-50 z-50 overflow-y-auto" data-testid="project-create-wizard">
            {/* Header avec bouton de retour - Fixe en haut */}
            <div className="sticky top-0 bg-white border-b border-slate-200 z-10">
                <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex items-center justify-between h-16">
                        <div className="flex items-center">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex items-center text-slate-600 hover:text-slate-900 mr-4 transition-colors"
                            >
                                <i className="fas fa-arrow-left mr-2"></i>
                                Retour aux projets
                            </button>
                            <h1 className="text-2xl font-semibold text-slate-900">
                                {editingProject ? 'Modifier le projet' : 'Créer un nouveau projet'}
                            </h1>
                        </div>
                        <div className="flex items-center space-x-4">
                            <span className="text-sm text-slate-500">
                                {editingProject ? 'Mode édition' : 'Nouveau projet'}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Contenu principal - Scrollable */}
            <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="bg-white rounded-xl border border-slate-200">
                    <form onSubmit={handleSubmit} className="p-6" autoComplete="off" noValidate>
                        <div className="space-y-8">
                            {/* Progress */}
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <p className="text-sm font-semibold text-slate-900">{steps[stepIndex]?.title}</p>
                                    <p className="text-xs text-slate-500">{steps[stepIndex]?.subtitle}</p>
                                </div>
                                <div className="flex items-center gap-2 text-xs text-slate-500">
                                    <span className="rounded-full bg-slate-100 px-2 py-1">
                                        Étape {stepIndex + 1}/{steps.length}
                                    </span>
                                    {!isEditMode && (
                                        <button
                                            type="button"
                                            className="rounded-full bg-slate-100 px-2 py-1 hover:bg-slate-200"
                                            onClick={() => {
                                                if (!confirm('Effacer le brouillon ?')) return;
                                                try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
                                                const today = new Date().toISOString().split('T')[0];
                                                setFormData({
                                                    title: '',
                                                    description: '',
                                                    status: 'Not Started',
                                                    startDate: today,
                                                    dueDate: '',
                                                    team: [],
                                                    programmeId: '',
                                                });
                                                setStep('basics');
                                            }}
                                        >
                                            Effacer brouillon
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Étapes toujours montées (display) : évite démontages massifs + removeChild sous React 19 / portail. */}
                            <div
                                className={step === 'basics' ? 'grid grid-cols-1 gap-6' : 'hidden'}
                                data-wizard-step="basics"
                                inert={step !== 'basics' ? true : undefined}
                            >
                                    <div>
                                        <label htmlFor="title" className="block text-sm font-medium text-slate-700 mb-2">
                                            Titre du projet *
                                        </label>
                                        <input
                                            type="text"
                                            id="title"
                                            name="title"
                                            data-testid="project-create-title"
                                            value={formData.title}
                                            onChange={(e) => handleInputChange('title', e.target.value)}
                                            className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-slate-300 focus:border-slate-400 ${
                                                errors.title ? 'border-red-500' : 'border-gray-300'
                                            }`}
                                            placeholder={`Entrez le titre du projet (${PROJECT_TITLE_MIN}-${PROJECT_TITLE_MAX} caractères)`}
                                            maxLength={PROJECT_TITLE_MAX}
                                        />
                                        <p className="mt-1 text-xs text-slate-500">
                                            {formData.title.trim().length}/{PROJECT_TITLE_MAX} caractères (min {PROJECT_TITLE_MIN}).
                                        </p>
                                        {errors.title && (
                                            <p className="mt-1 text-sm text-red-600">{errors.title}</p>
                                        )}
                                    </div>

                                    <div>
                                        <label htmlFor="description" className="block text-sm font-medium text-slate-700 mb-2">
                                            Description *
                                        </label>
                                        <textarea
                                            id="description"
                                            name="description"
                                            data-testid="project-create-description"
                                            value={formData.description}
                                            onChange={(e) => handleInputChange('description', e.target.value)}
                                            rows={5}
                                            className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-slate-300 focus:border-slate-400 resize-none ${
                                                errors.description ? 'border-red-500' : 'border-gray-300'
                                            }`}
                                            placeholder={`Décrivez le projet (${PROJECT_DESCRIPTION_MIN}-${PROJECT_DESCRIPTION_MAX} caractères)`}
                                            maxLength={PROJECT_DESCRIPTION_MAX}
                                        />
                                        <p className="mt-1 text-xs text-slate-500">
                                            {formData.description.trim().length}/{PROJECT_DESCRIPTION_MAX} caractères (min {PROJECT_DESCRIPTION_MIN}).
                                        </p>
                                        {errors.description && (
                                            <p className="mt-1 text-sm text-red-600">{errors.description}</p>
                                        )}
                                    </div>
                                </div>

                            <div
                                className={step === 'planning' ? 'grid grid-cols-1 gap-6' : 'hidden'}
                                data-wizard-step="planning"
                                inert={step !== 'planning' ? true : undefined}
                            >
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                        <div>
                                            <label htmlFor="status" className="block text-sm font-medium text-slate-700 mb-2">
                                                Statut
                                            </label>
                                            <select
                                                id="status"
                                                value={formData.status}
                                                onChange={(e) => handleInputChange('status', e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                            >
                                                <option value="Not Started">Non démarré</option>
                                                <option value="In Progress">En cours</option>
                                                <option value="Completed">Terminé</option>
                                                <option value="On Hold">En attente</option>
                                            </select>
                                        </div>

                                        <div>
                                            <label htmlFor="startDate" className="block text-sm font-medium text-slate-700 mb-2">
                                                Date de début
                                            </label>
                                            <input
                                                type="date"
                                                id="startDate"
                                                value={formData.startDate || ''}
                                                onChange={(e) => handleInputChange('startDate', e.target.value)}
                                                className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                            />
                                        </div>

                                        <div>
                                            <label htmlFor="dueDate" className="block text-sm font-medium text-slate-700 mb-2">
                                                Date d'échéance *
                                            </label>
                                            <input
                                                type="date"
                                                id="dueDate"
                                                name="dueDate"
                                                data-testid="project-create-due-date"
                                                value={formData.dueDate}
                                                onChange={(e) => handleInputChange('dueDate', e.target.value)}
                                                className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-slate-300 focus:border-slate-400 ${
                                                    errors.dueDate ? 'border-red-500' : 'border-gray-300'
                                                }`}
                                            />
                                            {errors.dueDate && (
                                                <p className="mt-1 text-sm text-red-600">{errors.dueDate}</p>
                                            )}
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="programmeId" className="block text-sm font-medium text-slate-700 mb-2">
                                            Programme (optionnel)
                                        </label>
                                        <select
                                            id="programmeId"
                                            value={formData.programmeId}
                                            onChange={(e) => handleInputChange('programmeId', e.target.value)}
                                            className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-slate-300 focus:border-slate-400"
                                        >
                                            <option value="">— Aucun —</option>
                                            {programmes.map((p) => (
                                                <option key={p.id} value={p.id}>{p.name}</option>
                                            ))}
                                        </select>
                                        <p className="mt-1 text-xs text-slate-500">
                                            Rattache le projet à un programme (projection programme-cockpit).
                                        </p>
                                    </div>
                                </div>

                            <div
                                className={step === 'team' ? 'block' : 'hidden'}
                                data-wizard-step="team"
                                inert={step !== 'team' ? true : undefined}
                            >
                                    <div className={`border rounded-xl p-6 ${
                                        errors.team ? 'border-red-500' : 'border-gray-300'
                                    }`}>
                                        <TeamSelector
                                            selectedUsers={formData.team}
                                            onUsersChange={handleTeamChange}
                                            placeholder="Sélectionnez les membres de l'équipe"
                                        />
                                        {errors.team && (
                                            <p className="mt-2 text-sm text-red-600">{errors.team}</p>
                                        )}
                                    </div>
                                </div>

                            <div
                                className={step === 'review' ? 'space-y-4' : 'hidden'}
                                data-wizard-step="review"
                                inert={step !== 'review' ? true : undefined}
                            >
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                                        <p className="text-xs font-semibold text-slate-500">Résumé</p>
                                        <p className="mt-1 text-lg font-semibold text-slate-900">{formData.title || '—'}</p>
                                        <p className="mt-1 text-sm text-slate-600 whitespace-pre-wrap">{formData.description || '—'}</p>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                        <div className="rounded-xl border border-slate-200 p-4">
                                            <p className="text-xs text-slate-500">Statut</p>
                                            <p className="text-sm font-semibold text-slate-900">{formData.status}</p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 p-4">
                                            <p className="text-xs text-slate-500">Dates</p>
                                            <p className="text-sm font-semibold text-slate-900">
                                                {formData.startDate || '—'} → {formData.dueDate || '—'}
                                            </p>
                                        </div>
                                        <div className="rounded-xl border border-slate-200 p-4">
                                            <p className="text-xs text-slate-500">Équipe</p>
                                            <p className="text-sm font-semibold text-slate-900">{formData.team.length} membre(s)</p>
                                        </div>
                                    </div>
                                    {Object.keys(errors).length > 0 && (
                                        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                            Veuillez corriger les champs en erreur avant de valider.
                                        </div>
                                    )}
                                </div>

                            {/* Actions */}
                            <div className="flex justify-end space-x-4 pt-6 border-t border-slate-200">
                                <div className="flex flex-1 items-center justify-between gap-3">
                                    <button type="button" onClick={onClose} className="btn-3d-secondary">
                                        Annuler
                                    </button>
                                    <div className="flex items-center gap-2">
                                        <button
                                            type="button"
                                            onClick={goPrev}
                                            disabled={!canGoPrev || isLoading}
                                            className="btn-3d-secondary disabled:opacity-50"
                                        >
                                            <span className="mr-2 opacity-80" aria-hidden>←</span>
                                            Précédent
                                        </button>
                                        {/*
                                          Même <button> + sous-arbre stable : deux panneaux (navigation / soumission)
                                          basculent en display pour éviter removeChild sur nœuds texte (React 19).
                                        */}
                                        <button
                                            type={step === 'review' ? 'submit' : 'button'}
                                            data-testid={step === 'review' ? 'project-wizard-submit' : 'project-wizard-next'}
                                            onClick={step === 'review' ? undefined : goNext}
                                            disabled={step === 'review' ? isLoading : !canGoNext || isLoading}
                                            className="btn-3d-primary disabled:opacity-50"
                                        >
                                            <span className="inline-flex min-h-[1.5rem] items-center justify-center gap-2">
                                                <span
                                                    className={
                                                        step === 'review' ? 'hidden' : 'inline-flex items-center gap-0'
                                                    }
                                                >
                                                    Suivant
                                                    <span className="ml-2 opacity-80" aria-hidden>
                                                        →
                                                    </span>
                                                </span>
                                                <span
                                                    className={
                                                        step === 'review' ? 'inline-flex items-center gap-2' : 'hidden'
                                                    }
                                                >
                                                    <span
                                                        aria-hidden
                                                        className={`inline-block size-4 shrink-0 rounded-full border-2 border-current border-t-transparent ${
                                                            isLoading ? 'animate-spin opacity-90' : 'hidden'
                                                        }`}
                                                    />
                                                    <span className={isLoading ? 'hidden' : 'opacity-90'} aria-hidden>
                                                        ✓
                                                    </span>
                                                    <span>
                                                        {isLoading
                                                            ? editingProject
                                                                ? 'Modification...'
                                                                : 'Création...'
                                                            : editingProject
                                                              ? 'Enregistrer'
                                                              : 'Créer le projet'}
                                                    </span>
                                                </span>
                                            </span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default ProjectCreatePage;

