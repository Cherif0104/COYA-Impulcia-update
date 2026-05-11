import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Loader2,
  Cloud,
  FileText,
  FolderOpen,
  Globe2,
  Info,
  Link2,
  Network,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
  UserCheck,
  Users,
  Video,
} from 'lucide-react';
import { Course, User, Module, Lesson, EvidenceDocument, Role, Programme, CourseQuizQuestion, CourseAudienceSegment } from '../types';
import DataAdapter from '../services/dataAdapter';
import * as programmeService from '../services/programmeService';
import OrganizationService from '../services/organizationService';
import { Button } from './ui/Button';

const genQuizId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

function newQuizQuestion(): CourseQuizQuestion {
  const a = genQuizId();
  const b = genQuizId();
  return {
    id: genQuizId(),
    prompt: '',
    mode: 'single',
    choices: [
      { id: a, label: 'Réponse A' },
      { id: b, label: 'Réponse B' },
    ],
    correctChoiceIds: [a],
  };
}

const INSTRUCTOR_ROLES: Role[] = ['trainer', 'coach', 'mentor', 'facilitator', 'partner_facilitator', 'administrator', 'manager', 'supervisor', 'super_administrator'];
const TARGETABLE_ROLES: Role[] = ['student', 'intern', 'alumni', 'trainer', 'coach', 'mentor', 'entrepreneur', 'employer', 'facilitator', 'partner_facilitator'];

interface CourseCreatePageProps {
    onClose: () => void;
    onSave: (course: Course | Omit<Course, 'id' | 'progress'>) => void;
    users: User[];
    editingCourse?: Course | null;
}

const CourseCreatePage: React.FC<CourseCreatePageProps> = ({
    onClose,
    onSave,
    users,
    editingCourse = null
}) => {
    const isEditMode = editingCourse !== null;
    
    const [formData, setFormData] = useState({
        title: '',
        description: '',
        instructor: '',
        instructorId: '',
        duration: '',
        level: 'beginner' as 'beginner' | 'intermediate' | 'advanced',
        category: '',
        price: 0,
        status: 'draft' as 'draft' | 'published' | 'archived',
        thumbnailUrl: '',
        targetAllUsers: true,
        selectedUserIds: [] as string[],
        youtubeUrl: '',
        driveUrl: '',
        modules: [] as Module[],
        requiresFinalValidation: false,
        sequentialModules: false,
        courseMaterials: [] as EvidenceDocument[],
        programmeId: '' as string,
        audienceSegment: 'general' as CourseAudienceSegment,
        certificationEnabled: false,
        certificationLabel: '',
    });

    const [errors, setErrors] = useState<Record<string, string>>({});
    const [instructorFilter, setInstructorFilter] = useState('');
    const [instructorSearchResults, setInstructorSearchResults] = useState<User[]>([]);
    const [isInstructorSearchLoading, setIsInstructorSearchLoading] = useState(false);
    const [targetSearch, setTargetSearch] = useState('');
    const [targetRoleFilter, setTargetRoleFilter] = useState<'all' | Role>('all');
    const [programmes, setProgrammes] = useState<Programme[]>([]);

    const eligibleInstructors = useMemo(() => {
        return users
            .filter(user => INSTRUCTOR_ROLES.includes(user.role))
            .sort((a, b) => (a.fullName || a.name).localeCompare(b.fullName || b.name));
    }, [users]);

    useEffect(() => {
        if (!instructorFilter.trim()) {
            setInstructorSearchResults(eligibleInstructors);
            setIsInstructorSearchLoading(false);
        }
    }, [eligibleInstructors, instructorFilter]);

    useEffect(() => {
        const trimmed = instructorFilter.trim();
        if (!trimmed) {
            return;
        }

        if (trimmed.length < 2) {
            setInstructorSearchResults(eligibleInstructors);
            setIsInstructorSearchLoading(false);
            return;
        }

        let cancelled = false;
        setIsInstructorSearchLoading(true);

        DataAdapter.searchInstructors(trimmed, INSTRUCTOR_ROLES)
            .then(results => {
                if (cancelled) return;
                if (results && results.length > 0) {
                    setInstructorSearchResults(results);
                } else {
                    setInstructorSearchResults(eligibleInstructors);
                }
            })
            .catch(error => {
                console.error('Erreur recherche instructeur:', error);
                if (!cancelled) {
                    setInstructorSearchResults(eligibleInstructors);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setIsInstructorSearchLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [instructorFilter, eligibleInstructors]);

    useEffect(() => {
        if (!formData.instructorId && eligibleInstructors.length === 1) {
            const first = eligibleInstructors[0];
            const instructorId = first.profileId || String(first.id);
            setFormData(prev => ({
                ...prev,
                instructorId,
                instructor: first.fullName || first.name
            }));
        }
    }, [eligibleInstructors, formData.instructorId]);

    useEffect(() => {
        if (editingCourse) {
            setFormData({
                title: editingCourse.title,
                description: editingCourse.description || '',
                instructor: editingCourse.instructor || '',
                instructorId: editingCourse.instructorId || '',
                duration: editingCourse.duration || '',
                level: editingCourse.level || 'beginner',
                category: editingCourse.category || '',
                price: editingCourse.price || 0,
                status: editingCourse.status || 'draft',
                thumbnailUrl: editingCourse.thumbnailUrl || '',
                targetAllUsers: editingCourse.targetStudents === null || editingCourse.targetStudents === undefined,
                selectedUserIds: (editingCourse.targetStudents as string[]) || [],
                youtubeUrl: editingCourse.youtubeUrl || '',
                driveUrl: editingCourse.driveUrl || '',
                modules: editingCourse.modules || [],
                requiresFinalValidation: editingCourse.requiresFinalValidation || false,
                sequentialModules: editingCourse.sequentialModules || false,
                courseMaterials: editingCourse.courseMaterials || [],
                programmeId: editingCourse.programmeId || '',
                audienceSegment: (editingCourse.audienceSegment as CourseAudienceSegment) || 'general',
                certificationEnabled: !!editingCourse.certificationEnabled,
                certificationLabel: editingCourse.certificationLabel || '',
            });
        }
    }, [editingCourse]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const orgId = await OrganizationService.getCurrentUserOrganizationId();
            if (!orgId || cancelled) return;
            const list = await programmeService.listProgrammes(orgId);
            if (!cancelled) setProgrammes(list);
        })();
        return () => { cancelled = true; };
    }, []);

    useEffect(() => {
        if (!isEditMode) return;
        if (!editingCourse) return;
        if (editingCourse.instructorId) return;
        const match = eligibleInstructors.find(user => (user.fullName || user.name).toLowerCase() === (editingCourse.instructor || '').toLowerCase());
        if (match) {
            const instructorId = match.profileId || String(match.id);
            setFormData(prev => ({
                ...prev,
                instructorId,
                instructor: match.fullName || match.name
            }));
        }
    }, [eligibleInstructors, editingCourse, isEditMode]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleTargetUsersChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const isAll = e.target.value === 'all';
        setFormData(prev => ({
            ...prev,
            targetAllUsers: isAll,
            selectedUserIds: isAll ? [] : prev.selectedUserIds
        }));
    };

    const handleUserToggle = (userId: string) => {
        setFormData(prev => {
            if (prev.selectedUserIds.includes(userId)) {
                return {
                    ...prev,
                    selectedUserIds: prev.selectedUserIds.filter(id => id !== userId)
                };
            } else {
                return {
                    ...prev,
                    selectedUserIds: [...prev.selectedUserIds, userId]
                };
            }
        });
    };

    const validateForm = (): boolean => {
        const newErrors: Record<string, string> = {};

        if (!formData.title.trim()) {
            newErrors.title = 'Le titre du cours est requis';
        }

        if (!formData.description.trim()) {
            newErrors.description = 'La description du cours est requise';
        }

        if (!formData.instructorId) {
            newErrors.instructor = 'Sélectionnez un instructeur parmi les profils existants';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleInstructorSelection = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selectedId = event.target.value;
        setFormData(prev => {
            const selectedProfile = eligibleInstructors.find(user => (user.profileId || String(user.id)) === selectedId);
            return {
                ...prev,
                instructorId: selectedId,
                instructor: selectedProfile ? (selectedProfile.fullName || selectedProfile.name) : ''
            };
        });
    };

    const filteredInstructors = useMemo(() => {
        const baseList = instructorFilter.trim() ? instructorSearchResults : eligibleInstructors;
        const uniqueMap = new Map<string, User>();

        const addUser = (user: User) => {
            const key = user.profileId || (typeof user.id === 'string' ? user.id : String(user.id));
            if (!uniqueMap.has(key)) {
                uniqueMap.set(key, user);
            }
        };

        eligibleInstructors.forEach(addUser);
        baseList.forEach(addUser);

        if (formData.instructorId && !uniqueMap.has(formData.instructorId)) {
            addUser({
                id: formData.instructorId,
                profileId: formData.instructorId,
                name: formData.instructor || 'Instructeur sélectionné',
                fullName: formData.instructor || 'Instructeur sélectionné',
                email: '',
                avatar: '',
                role: 'trainer',
                skills: [],
                isActive: true
            } as User);
        }

        const candidates = Array.from(uniqueMap.values());

        if (!instructorFilter.trim()) {
            return candidates;
        }

        const lowered = instructorFilter.toLowerCase();
        return candidates.filter(user => {
            const haystack = `${user.fullName || user.name} ${user.email}`.toLowerCase();
            return haystack.includes(lowered);
        });
    }, [eligibleInstructors, instructorSearchResults, instructorFilter, formData.instructorId, formData.instructor]);

    const selectableTargetUsers = useMemo(() => {
        return users.filter(u => TARGETABLE_ROLES.includes(u.role));
    }, [users]);

    const filteredTargetUsers = useMemo(() => {
        return selectableTargetUsers.filter(user => {
            if (targetRoleFilter !== 'all' && user.role !== targetRoleFilter) return false;
            if (!targetSearch.trim()) return true;
            const haystack = `${user.fullName || user.name} ${user.email} ${user.role}`.toLowerCase();
            return haystack.includes(targetSearch.toLowerCase());
        });
    }, [selectableTargetUsers, targetRoleFilter, targetSearch]);

    const loadFileAsEvidence = (file: File): Promise<EvidenceDocument> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = event => {
                resolve({
                    fileName: file.name,
                    dataUrl: event.target?.result as string
                });
            };
            reader.onerror = () => reject(new Error('Erreur lors du chargement du fichier'));
            reader.readAsDataURL(file);
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        const selectedInstructor = eligibleInstructors.find(user => (user.profileId || String(user.id)) === formData.instructorId);

        const courseData = {
            ...formData,
            instructor: selectedInstructor ? (selectedInstructor.fullName || selectedInstructor.name) : formData.instructor,
            targetStudents: formData.targetAllUsers ? null : formData.selectedUserIds,
            youtubeUrl: formData.youtubeUrl || null,
            driveUrl: formData.driveUrl || null,
            instructorId: formData.instructorId || null,
            programmeId: formData.programmeId.trim() || null,
            audienceSegment: formData.audienceSegment,
            certificationEnabled: formData.certificationEnabled,
            certificationLabel: formData.certificationLabel.trim() || null,
        };

        // Si mode édition, conserver l'ID
        if (isEditMode && editingCourse) {
            onSave({ ...courseData, id: editingCourse.id } as Course);
        } else {
            onSave(courseData);
        }
    };

    // Gestion des modules et leçons
    const handleModuleChange = (moduleIndex: number, field: string, value: string) => {
        const newModules = [...formData.modules];
        (newModules[moduleIndex] as any)[field] = value;
        setFormData(prev => ({...prev, modules: newModules}));
    };
    
    const updateLesson = (moduleIndex: number, lessonIndex: number, updater: (lesson: Lesson) => Lesson) => {
        setFormData(prev => {
            const modules = [...prev.modules];
            const module = { ...modules[moduleIndex] };
            const lessons = [...module.lessons];
            lessons[lessonIndex] = updater({ ...lessons[lessonIndex] });
            module.lessons = lessons;
            modules[moduleIndex] = module;
            return { ...prev, modules };
        });
    };
    
    const handleLessonChange = (moduleIndex: number, lessonIndex: number, field: string, value: string) => {
        updateLesson(moduleIndex, lessonIndex, (lesson) => {
            const next: Lesson = { ...lesson, [field]: value } as Lesson;
            if (field === 'type' && value === 'quiz' && (!next.quizQuestions || next.quizQuestions.length === 0)) {
                next.quizQuestions = [newQuizQuestion()];
            }
            return next;
        });
    };

    useEffect(() => {
        setFormData(prev => ({
            ...prev,
            modules: prev.modules.map(module => ({
                ...module,
                unlocksNextModule: prev.sequentialModules ? (module.unlocksNextModule ?? true) : false
            }))
        }));
    }, [formData.sequentialModules]);

    const addModule = () => {
        setFormData(prev => {
            const newModule: Module = {
                id: `m-${Date.now()}`,
                title: `Module ${prev.modules.length + 1}`,
                lessons: [],
                evidenceDocuments: [],
                requiresValidation: false,
                unlocksNextModule: prev.sequentialModules
            };
            return {
                ...prev,
                modules: [...prev.modules, newModule]
            };
        });
    };
    
    const addLesson = (moduleIndex: number) => {
        const newLesson: Lesson = {
            id: `l-${Date.now()}`,
            title: 'Nouvelle leçon',
            type: 'video',
            duration: '10 min',
            icon: 'fas fa-play-circle',
            description: '',
            contentUrl: '',
            attachments: [],
            externalLinks: [],
            quizQuestions: [],
        };
        const newModules = [...formData.modules];
        newModules[moduleIndex].lessons.push(newLesson);
        setFormData(prev => ({...prev, modules: newModules}));
    };
    
    const removeModule = (moduleIndex: number) => {
         const newModules = formData.modules.filter((_, index) => index !== moduleIndex);
         setFormData(prev => ({...prev, modules: newModules}));
    };
    
    const removeLesson = (moduleIndex: number, lessonIndex: number) => {
        const newModules = [...formData.modules];
        newModules[moduleIndex].lessons = newModules[moduleIndex].lessons.filter((_, index) => index !== lessonIndex);
        setFormData(prev => ({...prev, modules: newModules}));
    };
    
    const handleEvidenceUpload = (e: React.ChangeEvent<HTMLInputElement>, moduleIndex: number) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                const newDocument: EvidenceDocument = {
                    fileName: file.name,
                    dataUrl: loadEvent.target?.result as string,
                };
                const newModules = [...formData.modules];
                const updatedDocs = [...(newModules[moduleIndex].evidenceDocuments || []), newDocument];
                newModules[moduleIndex].evidenceDocuments = updatedDocs;
                setFormData(prev => ({ ...prev, modules: newModules }));
            };
            reader.readAsDataURL(file);
        }
    };
    
    const removeEvidenceDocument = (moduleIndex: number, docIndex: number) => {
        const newModules = [...formData.modules];
        const updatedDocs = newModules[moduleIndex].evidenceDocuments?.filter((_, i) => i !== docIndex);
        newModules[moduleIndex].evidenceDocuments = updatedDocs;
        setFormData(prev => ({ ...prev, modules: newModules }));
    };

    const handleCourseMaterialsUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const files = event.target.files;
        if (!files || files.length === 0) return;

        const documents = await Promise.all(Array.from(files).map((file: File) => loadFileAsEvidence(file)));
        setFormData(prev => ({
            ...prev,
            courseMaterials: [...prev.courseMaterials, ...documents]
        }));
        event.target.value = '';
    };

    const removeCourseMaterial = (index: number) => {
        setFormData(prev => ({
            ...prev,
            courseMaterials: prev.courseMaterials.filter((_, i) => i !== index)
        }));
    };

    const handleLessonAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>, moduleIndex: number, lessonIndex: number) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const document = await loadFileAsEvidence(file);
        updateLesson(moduleIndex, lessonIndex, lesson => ({
            ...lesson,
            attachments: [...(lesson.attachments || []), document]
        }));
        event.target.value = '';
    };

    const handleRemoveLessonAttachment = (moduleIndex: number, lessonIndex: number, attachmentIndex: number) => {
        updateLesson(moduleIndex, lessonIndex, lesson => ({
            ...lesson,
            attachments: (lesson.attachments || []).filter((_, idx) => idx !== attachmentIndex)
        }));
    };

    const handleAddLessonLink = (moduleIndex: number, lessonIndex: number) => {
        updateLesson(moduleIndex, lessonIndex, lesson => ({
            ...lesson,
            externalLinks: [...(lesson.externalLinks || []), { label: '', url: '' }]
        }));
    };

    const handleLessonLinkChange = (moduleIndex: number, lessonIndex: number, linkIndex: number, field: 'label' | 'url', value: string) => {
        updateLesson(moduleIndex, lessonIndex, lesson => {
            const links = [...(lesson.externalLinks || [])];
            links[linkIndex] = { ...links[linkIndex], [field]: value };
            return { ...lesson, externalLinks: links };
        });
    };

    const handleRemoveLessonLink = (moduleIndex: number, lessonIndex: number, linkIndex: number) => {
        updateLesson(moduleIndex, lessonIndex, lesson => ({
            ...lesson,
            externalLinks: (lesson.externalLinks || []).filter((_, idx) => idx !== linkIndex)
        }));
    };

    const handleModuleBooleanToggle = (moduleIndex: number, field: 'requiresValidation' | 'unlocksNextModule') => {
        setFormData(prev => {
            const modulesCopy = [...prev.modules];
            modulesCopy[moduleIndex] = {
                ...modulesCopy[moduleIndex],
                [field]: !modulesCopy[moduleIndex][field]
            };
            return {
                ...prev,
                modules: modulesCopy
            };
        });
    };

    return (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-50">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-6 lg:px-8">
                    <div className="flex min-w-0 items-center gap-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-50"
                            aria-label="Retour"
                        >
                            <ArrowLeft className="h-5 w-5" aria-hidden />
                        </button>
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Studio formations</p>
                            <h1 className="text-xl font-bold tracking-tight text-slate-900">
                                {isEditMode ? 'Modifier le cours' : 'Nouveau cours'}
                            </h1>
                            <p className="mt-0.5 text-sm text-slate-600">
                                {isEditMode ? 'Mettez à jour le contenu et la structure du parcours.' : 'Créez un parcours pour votre catalogue.'}
                            </p>
                        </div>
                    </div>
                    <Button
                        type="submit"
                        form="course-form"
                        variant="primary"
                        size="md"
                        leftIcon={<Save className="h-4 w-4" aria-hidden />}
                        className="shrink-0"
                    >
                        Enregistrer
                    </Button>
                </div>
            </div>

            <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
                <form
                    id="course-form"
                    onSubmit={handleSubmit}
                    className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)] sm:p-8"
                >
                    {/* Course Details */}
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="mb-2 block text-sm font-medium text-slate-700">
                                    Titre du cours *
                                </label>
                                <input
                                    type="text"
                                    name="title"
                                    value={formData.title}
                                    onChange={handleChange}
                                    className="w-full rounded-xl border border-slate-300 px-4 py-2 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                    placeholder="Ex: Digital Marketing Fundamentals"
                                    required
                                />
                                {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title}</p>}
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Instructeur *
                                </label>
                                <div className="space-y-3">
                                    <div className="relative">
                                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                <input
                                    type="text"
                                            value={instructorFilter}
                                            onChange={(event) => setInstructorFilter(event.target.value)}
                                            placeholder="Rechercher un instructeur..."
                                            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                        />
                                    </div>
                                    {isInstructorSearchLoading && (
                                        <p className="text-xs text-slate-500 flex items-center gap-2">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                            Recherche d'instructeurs...
                                        </p>
                                    )}
                                    <select
                                        name="instructorId"
                                        value={formData.instructorId}
                                        onChange={handleInstructorSelection}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                    required
                                    >
                                        <option value="" disabled>Sélectionnez un profil instructeur</option>
                                        {filteredInstructors.map(user => {
                                            const userId = user.profileId || String(user.id);
                                            return (
                                                <option key={userId} value={userId}>
                                                    {(user.fullName || user.name)} • {user.role}
                                                </option>
                                            );
                                        })}
                                        {filteredInstructors.length === 0 && (
                                            <option value="" disabled>Aucun instructeur trouvé</option>
                                        )}
                                    </select>
                                    {formData.instructor && (
                                        <p className="text-xs text-slate-500">
                                            Instructeur sélectionné : <span className="font-semibold text-emerald-600">{formData.instructor}</span>
                                        </p>
                                    )}
                                {errors.instructor && <p className="text-red-500 text-xs mt-1">{errors.instructor}</p>}
                                </div>
                            </div>
                        </div>
                        
                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                                Description *
                            </label>
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                rows={4}
                                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                                placeholder="Description détaillée du cours..."
                                required
                            />
                            {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description}</p>}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Durée</label>
                                <input
                                    name="duration"
                                    value={formData.duration}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    placeholder="Ex: 6 Weeks"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Niveau</label>
                                <select
                                    name="level"
                                    value={formData.level}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                >
                                    <option value="beginner">Débutant</option>
                                    <option value="intermediate">Intermédiaire</option>
                                    <option value="advanced">Avancé</option>
                                </select>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Catégorie</label>
                                <input
                                    name="category"
                                    value={formData.category}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    placeholder="Ex: Marketing, Business, Technology"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Prix (XOF)</label>
                                <input
                                    name="price"
                                    type="number"
                                    value={formData.price}
                                    onChange={handleChange}
                                    min="0"
                                    step="1000"
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Statut</label>
                                <select
                                    name="status"
                                    value={formData.status}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                >
                                    <option value="draft">Brouillon</option>
                                    <option value="published">Publié</option>
                                    <option value="archived">Archivé</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">URL de l'image de couverture</label>
                                <input
                                    name="thumbnailUrl"
                                    type="url"
                                    value={formData.thumbnailUrl}
                                    onChange={handleChange}
                                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500"
                                    placeholder="https://example.com/image.jpg"
                                />
                            </div>
                        </div>

                        {/* Ciblage des utilisateurs */}
                        <div className="border-t pt-6">
                            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-800">
                                <Users className="h-5 w-5 text-emerald-600" aria-hidden />
                                Cours destiné à
                            </h3>
                            <div className="space-y-3">
                                <div className="flex items-center p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                                    <input type="radio" name="targetUsers" value="all" checked={formData.targetAllUsers} onChange={handleTargetUsersChange} className="mr-3" />
                                    <label className="text-sm font-medium text-slate-700 cursor-pointer flex-1 flex items-center">
                                        <Globe2 className="mr-2 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                                        Tous les utilisateurs
                                    </label>
                                </div>
                                <div className="flex items-center p-3 border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer">
                                    <input type="radio" name="targetUsers" value="specific" checked={!formData.targetAllUsers} onChange={handleTargetUsersChange} className="mr-3" />
                                    <label className="text-sm font-medium text-slate-700 cursor-pointer flex-1 flex items-center">
                                        <UserCheck className="mr-2 h-4 w-4 shrink-0 text-blue-600" aria-hidden />
                                        Utilisateurs sélectionnés
                                    </label>
                                </div>
                                {!formData.targetAllUsers && (
                                    <div className="ml-6 mt-2 border-2 border-emerald-200 rounded-lg p-4 max-h-64 overflow-y-auto bg-slate-50 shadow-inner">
                                        <div className="flex flex-wrap gap-3 mb-4">
                                            <div className="relative flex-1 min-w-[180px]">
                                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                                <input
                                                    type="text"
                                                    value={targetSearch}
                                                    onChange={(event) => setTargetSearch(event.target.value)}
                                                    placeholder="Rechercher par nom, email..."
                                                    className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                                />
                                            </div>
                                            <select
                                                value={targetRoleFilter}
                                                onChange={(event) => setTargetRoleFilter(event.target.value as Role | 'all')}
                                                className="px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                            >
                                                <option value="all">Tous les rôles</option>
                                                <option value="student">Étudiants</option>
                                                <option value="intern">Stagiaires</option>
                                                <option value="alumni">Alumni</option>
                                                <option value="trainer">Formateurs</option>
                                                <option value="coach">Coachs</option>
                                                <option value="mentor">Mentors</option>
                                                <option value="facilitator">Facilitateurs</option>
                                                <option value="partner_facilitator">Partenaires</option>
                                                <option value="entrepreneur">Entrepreneurs</option>
                                                <option value="employer">Employeurs</option>
                                            </select>
                                        </div>
                                        <p className="text-xs font-semibold text-slate-600 mb-3 uppercase">Sélectionnez les utilisateurs :</p>
                                        {filteredTargetUsers.length === 0 ? (
                                            <p className="text-sm text-slate-500 italic">Aucun utilisateur disponible</p>
                                        ) : (
                                            filteredTargetUsers.map(user => {
                                                const userIdToUse = user.profileId || String(user.id);
                                                return (
                                                    <label key={userIdToUse} className="flex items-center py-2 px-3 hover:bg-white rounded-md cursor-pointer transition-colors mb-1">
                                                        <input type="checkbox" checked={formData.selectedUserIds.includes(userIdToUse)} onChange={() => handleUserToggle(userIdToUse)} className="mr-3 h-4 w-4" />
                                                        <div className="flex-1">
                                                            <span className="text-sm font-medium text-slate-800 block">{user.fullName || user.name}</span>
                                                            <span className="text-xs text-slate-500">{user.email} • {user.role}</span>
                                                        </div>
                                                    </label>
                                                );
                                            })
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Lien module Programme & parcours apprenant */}
                        <div className="space-y-4 border-t pt-6">
                            <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-slate-800">
                                <Network className="h-5 w-5 text-emerald-600" aria-hidden />
                                Programme & public cible
                            </h3>
                            <p className="text-xs text-slate-600 mb-3">
                                Rattachez la formation à un programme (bailleurs, participants, collecte) et précisez le type de parcours pour l’affichage côté apprenant.
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Programme COYA (optionnel)</label>
                                    <select
                                        value={formData.programmeId}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, programmeId: e.target.value }))}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                    >
                                        <option value="">— Aucun rattachement —</option>
                                        {programmes.map((p) => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Parcours / présentation</label>
                                    <select
                                        value={formData.audienceSegment}
                                        onChange={(e) => setFormData((prev) => ({ ...prev, audienceSegment: e.target.value as CourseAudienceSegment }))}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                    >
                                        <option value="general">Tous publics</option>
                                        <option value="incubated">Incubés / entrepreneurs accompagnés</option>
                                        <option value="beneficiary">Bénéficiaires de programme</option>
                                    </select>
                                </div>
                            </div>
                            <div className="mt-4 rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4">
                                <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.certificationEnabled}
                                        onChange={(e) =>
                                            setFormData((prev) => ({ ...prev, certificationEnabled: e.target.checked }))
                                        }
                                        className="mt-1 h-4 w-4"
                                    />
                                    <span>
                                        <span className="text-sm font-medium text-slate-800">
                                            Activer la certification / attestation (MVP)
                                        </span>
                                        <span className="block text-xs text-slate-600 mt-1">
                                            Les attestations seront stockées dans <code className="text-[10px]">learning_certificates</code>{' '}
                                            après migration ; l’émission automatisée arrive dans une prochaine itération.
                                        </span>
                                    </span>
                                </label>
                                {formData.certificationEnabled ? (
                                    <div className="mt-3">
                                        <label className="block text-sm font-medium text-slate-700 mb-1">
                                            Libellé affiché aux apprenants
                                        </label>
                                        <input
                                            type="text"
                                            value={formData.certificationLabel}
                                            onChange={(e) =>
                                                setFormData((prev) => ({ ...prev, certificationLabel: e.target.value }))
                                            }
                                            placeholder="Ex. Attestation de participation"
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>

                        {/* Liens YouTube et Drive */}
                        <div className="space-y-4 border-t pt-6">
                            <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-800">
                                <Link2 className="h-5 w-5 text-emerald-600" aria-hidden />
                                Ressources et liens externes
                            </h3>
                            
                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                                <p className="text-sm text-blue-800">
                                    <Info className="mr-2 inline h-4 w-4 shrink-0 text-blue-700" aria-hidden />
                                    Ajoutez des liens vers des vidéos, documents ou ressources pédagogiques externes
                                </p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    <Video className="mr-2 inline h-4 w-4 shrink-0 text-red-600" aria-hidden />
                                    Vidéo YouTube
                                </label>
                                <input 
                                    name="youtubeUrl" 
                                    type="url" 
                                    value={formData.youtubeUrl} 
                                    onChange={handleChange} 
                                    className="mt-1 block w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500" 
                                    placeholder="https://www.youtube.com/watch?v=..." 
                                />
                                <p className="text-xs text-slate-500 mt-2">Exemple: https://www.youtube.com/watch?v=dQw4w9WgXcQ</p>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    <Cloud className="mr-2 inline h-4 w-4 shrink-0 text-blue-600" aria-hidden />
                                    Google Drive / OneDrive
                                </label>
                                <input 
                                    name="driveUrl" 
                                    type="url" 
                                    value={formData.driveUrl} 
                                    onChange={handleChange} 
                                    className="mt-1 block w-full p-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" 
                                    placeholder="https://drive.google.com/file/d/..." 
                                />
                                <p className="text-xs text-slate-500 mt-2">Lien vers un dossier ou fichier contenant les ressources du cours</p>
                            </div>
                        </div>

                        {/* Modules & Lessons */}
                        <div className="border-t pt-6">
                            <div className="bg-gradient-to-r from-blue-50 to-emerald-50 border border-blue-200 rounded-lg p-4 mb-4">
                                <h3 className="mb-2 flex items-center gap-2 text-lg font-bold text-slate-800">
                                    <Network className="h-5 w-5 text-emerald-600" aria-hidden />
                                    Modules du cours
                                </h3>
                                <p className="text-sm text-slate-600">
                                    Organisez votre cours en modules. Chaque module peut contenir plusieurs leçons que les étudiants pourront valider progressivement.
                                </p>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                                <label className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow-lg transition-shadow cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.requiresFinalValidation}
                                        onChange={() => setFormData(prev => ({ ...prev, requiresFinalValidation: !prev.requiresFinalValidation }))}
                                        className="mt-1 h-5 w-5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                                    />
                                    <div>
                                        <span className="font-semibold text-sm text-slate-800 block">Validation finale du cours</span>
                                        <span className="text-xs text-slate-500">
                                            Activez pour nécessiter une validation manuelle à la fin du cours (par un instructeur ou administrateur).
                                        </span>
                                    </div>
                                </label>
                                <label className="flex items-start gap-3 bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow-lg transition-shadow cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.sequentialModules}
                                        onChange={() => setFormData(prev => ({ ...prev, sequentialModules: !prev.sequentialModules }))}
                                        className="mt-1 h-5 w-5 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                                    />
                                    <div>
                                        <span className="font-semibold text-sm text-slate-800 block">Progression séquentielle</span>
                                        <span className="text-xs text-slate-500">
                                            Oblige les apprenants à valider chaque module avant de débloquer le suivant.
                                        </span>
                                    </div>
                                </label>
                            </div>

                            <div className="bg-white border border-emerald-200 rounded-lg p-4 mb-6 shadow-sm">
                                <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                                    <FolderOpen className="h-4 w-4 text-emerald-600" aria-hidden />
                                    Ressources du cours
                                </h4>
                                <p className="text-xs text-slate-500 mb-4">
                                    Ajoutez des documents (PDF, Word, Excel, images) accessibles depuis l’espace apprenant.
                                </p>
                                {formData.courseMaterials && formData.courseMaterials.length > 0 && (
                                    <ul className="space-y-2 mb-4">
                                        {formData.courseMaterials.map((document, index) => (
                                            <li key={`${document.fileName}-${index}`} className="flex items-center justify-between bg-slate-50 px-3 py-2 rounded-md text-sm">
                                                <span className="truncate flex-1">{document.fileName}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => removeCourseMaterial(index)}
                                                    className="text-red-500 hover:text-red-700 ml-3"
                                                >
                                                    <Trash2 className="h-4 w-4" aria-hidden />
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                <label className="inline-flex items-center gap-2 px-4 py-2 border border-dashed border-emerald-400 rounded-lg text-emerald-600 hover:text-emerald-700 hover:border-emerald-600 cursor-pointer transition-colors text-sm font-semibold">
                                    <Upload className="h-4 w-4" aria-hidden />
                                    Importer des fichiers
                                    <input
                                        type="file"
                                        className="hidden"
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.ppt,.pptx"
                                        multiple
                                        onChange={handleCourseMaterialsUpload}
                                    />
                                </label>
                            </div>
                            
                            <div className="space-y-4">
                                {formData.modules.map((module, mIndex) => (
                                    <div key={module.id} className="p-5 border-2 border-emerald-200 rounded-lg bg-white shadow-sm hover:shadow-md transition-shadow">
                                        <div className="flex items-center justify-between mb-3">
                                            <div className="flex items-center gap-2 flex-1">
                                                <span className="bg-emerald-600 text-white px-3 py-1 rounded-full text-xs font-bold">Module {mIndex + 1}</span>
                                                <input 
                                                    value={module.title} 
                                                    onChange={(e) => handleModuleChange(mIndex, 'title', e.target.value)} 
                                                    placeholder="Titre du module (ex: Introduction au Marketing)" 
                                                    className="text-md font-semibold p-2 border-b-2 border-emerald-300 w-full bg-transparent focus:border-emerald-600 focus:outline-none"
                                                />
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={module.requiresValidation ?? false}
                                                        onChange={() => handleModuleBooleanToggle(mIndex, 'requiresValidation')}
                                                        className="h-4 w-4 text-emerald-600 border-slate-300 rounded focus:ring-emerald-500"
                                                    />
                                                    Validation requise
                                                </label>
                                                {formData.sequentialModules && (
                                                    <label className="flex items-center gap-2 text-xs font-semibold text-blue-600 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={module.unlocksNextModule ?? false}
                                                            onChange={() => handleModuleBooleanToggle(mIndex, 'unlocksNextModule')}
                                                            className="h-4 w-4 text-blue-500 border-slate-300 rounded focus:ring-blue-400"
                                                        />
                                                        Débloque le module suivant
                                                    </label>
                                                )}
                                            <button 
                                                type="button" 
                                                onClick={() => removeModule(mIndex)} 
                                                className="text-red-600 hover:text-red-800 hover:bg-red-50 p-2 rounded-lg transition-colors"
                                                title="Supprimer ce module"
                                            >
                                                <Trash2 className="h-4 w-4" aria-hidden />
                                            </button>
                                            </div>
                                        </div>
                                        
                                        <div className="ml-8 mt-3 space-y-2">
                                            <p className="text-xs font-semibold text-slate-600 uppercase mb-2">Leçons :</p>
                                            {module.lessons.length === 0 && (
                                                <p className="text-xs text-slate-400 italic mb-2">Aucune leçon ajoutée</p>
                                            )}
                                            {module.lessons.map((lesson, lIndex) => (
                                                <div key={lesson.id} className="bg-white border border-emerald-100 rounded-lg shadow-sm p-4 space-y-3">
                                                    <div className="flex items-start gap-3">
                                                        <span className="text-sm font-semibold text-emerald-600 mt-1">{lIndex + 1}.</span>
                                                        <div className="flex-1 space-y-3">
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                <div>
                                                                    <label className="block text-xs font-semibold text-slate-600 mb-1">Titre de la leçon</label>
                                                    <input 
                                                        value={lesson.title} 
                                                        onChange={(e) => handleLessonChange(mIndex, lIndex, 'title', e.target.value)} 
                                                        placeholder="Titre de la leçon"
                                                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                                                    />
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-3">
                                                                    <div>
                                                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Type</label>
                                                                        <select
                                                                            value={lesson.type}
                                                                            onChange={(e) => handleLessonChange(mIndex, lIndex, 'type', e.target.value)}
                                                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                                                        >
                                                                            <option value="video">Vidéo</option>
                                                                            <option value="reading">Lecture</option>
                                                                            <option value="quiz">Quiz</option>
                                                                        </select>
                                                                    </div>
                                                                    <div>
                                                                        <label className="block text-xs font-semibold text-slate-600 mb-1">Durée (ex: 15 min)</label>
                                                    <input 
                                                        value={lesson.duration} 
                                                        onChange={(e) => handleLessonChange(mIndex, lIndex, 'duration', e.target.value)} 
                                                                            placeholder="15 min"
                                                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>

                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
                                                                <textarea
                                                                    value={lesson.description || ''}
                                                                    onChange={(e) => handleLessonChange(mIndex, lIndex, 'description', e.target.value)}
                                                                    placeholder="Ajoutez un résumé de la leçon..."
                                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm min-h-[70px]"
                                                                />
                                                            </div>

                                                            <div>
                                                                <label className="block text-xs font-semibold text-slate-600 mb-1">Lien principal</label>
                                                                <input
                                                                    type="url"
                                                                    value={lesson.contentUrl || ''}
                                                                    onChange={(e) => handleLessonChange(mIndex, lIndex, 'contentUrl', e.target.value)}
                                                                    placeholder="https://..."
                                                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                                                                />
                                                                <p className="text-[11px] text-slate-500 mt-1">YouTube, lien vidéo direct (.mp4), ou PDF : affichage intégré dans la plateforme pour les apprenants.</p>
                                                            </div>

                                                            {lesson.type === 'quiz' && (
                                                                <div className="rounded-lg border border-amber-200 bg-amber-50/90 p-3 space-y-3">
                                                                    <p className="text-xs font-bold text-amber-900">Quiz — questions et bonnes réponses</p>
                                                                    {(lesson.quizQuestions || []).map((q, qIdx) => (
                                                                        <div key={q.id} className="border border-amber-100 rounded-md p-2 bg-white space-y-2">
                                                                            <div className="flex flex-wrap gap-2 items-center justify-between">
                                                                                <span className="text-[10px] font-semibold text-slate-500">Question {qIdx + 1}</span>
                                                                                <button
                                                                                    type="button"
                                                                                    className="text-[10px] text-red-600"
                                                                                    onClick={() => updateLesson(mIndex, lIndex, (l) => {
                                                                                        const qs = [...(l.quizQuestions || [])];
                                                                                        qs.splice(qIdx, 1);
                                                                                        return { ...l, quizQuestions: qs };
                                                                                    })}
                                                                                >
                                                                                    Supprimer
                                                                                </button>
                                                                            </div>
                                                                            <input
                                                                                value={q.prompt}
                                                                                onChange={(e) => updateLesson(mIndex, lIndex, (l) => {
                                                                                    const qs = [...(l.quizQuestions || [])];
                                                                                    qs[qIdx] = { ...qs[qIdx], prompt: e.target.value };
                                                                                    return { ...l, quizQuestions: qs };
                                                                                })}
                                                                                placeholder="Intitulé de la question"
                                                                                className="w-full px-2 py-1.5 border border-slate-300 rounded text-sm"
                                                                            />
                                                                            <div className="flex gap-2 items-center text-xs">
                                                                                <span className="text-slate-600">Mode :</span>
                                                                                <select
                                                                                    value={q.mode}
                                                                                    onChange={(e) => updateLesson(mIndex, lIndex, (l) => {
                                                                                        const qs = [...(l.quizQuestions || [])];
                                                                                        qs[qIdx] = { ...qs[qIdx], mode: e.target.value as 'single' | 'multiple' };
                                                                                        return { ...l, quizQuestions: qs };
                                                                                    })}
                                                                                    className="border border-slate-300 rounded px-2 py-1"
                                                                                >
                                                                                    <option value="single">Une bonne réponse</option>
                                                                                    <option value="multiple">Plusieurs bonnes réponses</option>
                                                                                </select>
                                                                            </div>
                                                                            <div className="space-y-1">
                                                                                {q.choices.map((c, cIdx) => (
                                                                                    <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs">
                                                                                        <input
                                                                                            value={c.label}
                                                                                            onChange={(e) => updateLesson(mIndex, lIndex, (l) => {
                                                                                                const qs = [...(l.quizQuestions || [])];
                                                                                                const ch = [...qs[qIdx].choices];
                                                                                                ch[cIdx] = { ...ch[cIdx], label: e.target.value };
                                                                                                qs[qIdx] = { ...qs[qIdx], choices: ch };
                                                                                                return { ...l, quizQuestions: qs };
                                                                                            })}
                                                                                            className="flex-1 min-w-[120px] px-2 py-1 border border-slate-200 rounded"
                                                                                            placeholder={`Choix ${cIdx + 1}`}
                                                                                        />
                                                                                        <label className="flex items-center gap-1 whitespace-nowrap">
                                                                                            <input
                                                                                                type="checkbox"
                                                                                                checked={q.correctChoiceIds.includes(c.id)}
                                                                                                onChange={() => updateLesson(mIndex, lIndex, (l) => {
                                                                                                    const qs = [...(l.quizQuestions || [])];
                                                                                                    const cur = qs[qIdx];
                                                                                                    let ids = [...cur.correctChoiceIds];
                                                                                                    if (cur.mode === 'single') {
                                                                                                        ids = ids.includes(c.id) ? [] : [c.id];
                                                                                                    } else if (ids.includes(c.id)) {
                                                                                                        ids = ids.filter((x) => x !== c.id);
                                                                                                    } else {
                                                                                                        ids.push(c.id);
                                                                                                    }
                                                                                                    qs[qIdx] = { ...cur, correctChoiceIds: ids };
                                                                                                    return { ...l, quizQuestions: qs };
                                                                                                })}
                                                                                            />
                                                                                            Correct
                                                                                        </label>
                                                                                        <button
                                                                                            type="button"
                                                                                            className="text-red-500"
                                                                                            onClick={() => updateLesson(mIndex, lIndex, (l) => {
                                                                                                const qs = [...(l.quizQuestions || [])];
                                                                                                const ch = qs[qIdx].choices.filter((_, i) => i !== cIdx);
                                                                                                qs[qIdx] = {
                                                                                                    ...qs[qIdx],
                                                                                                    choices: ch,
                                                                                                    correctChoiceIds: qs[qIdx].correctChoiceIds.filter((id) => id !== c.id),
                                                                                                };
                                                                                                return { ...l, quizQuestions: qs };
                                                                                            })}
                                                                                        >
                                                                                            ×
                                                                                        </button>
                                                                                    </div>
                                                                                ))}
                                                                                <button
                                                                                    type="button"
                                                                                    className="text-[11px] text-emerald-700 font-semibold"
                                                                                    onClick={() => updateLesson(mIndex, lIndex, (l) => {
                                                                                        const qs = [...(l.quizQuestions || [])];
                                                                                        const nid = genQuizId();
                                                                                        qs[qIdx] = {
                                                                                            ...qs[qIdx],
                                                                                            choices: [...qs[qIdx].choices, { id: nid, label: `Choix ${qs[qIdx].choices.length + 1}` }],
                                                                                        };
                                                                                        return { ...l, quizQuestions: qs };
                                                                                    })}
                                                                                >
                                                                                    + Choix
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                    <button
                                                                        type="button"
                                                                        className="text-xs font-semibold text-amber-900"
                                                                        onClick={() => updateLesson(mIndex, lIndex, (l) => ({
                                                                            ...l,
                                                                            quizQuestions: [...(l.quizQuestions || []), newQuizQuestion()],
                                                                        }))}
                                                                    >
                                                                        + Ajouter une question
                                                                    </button>
                                                                </div>
                                                            )}

                                                            <div>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <label className="text-xs font-semibold text-slate-600">Pièces jointes</label>
                                                                    <label className="inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold text-emerald-600 border border-emerald-300 rounded cursor-pointer hover:bg-emerald-50 transition">
                                                                        <Upload className="h-3.5 w-3.5" aria-hidden />
                                                                        Ajouter un fichier
                                                                        <input
                                                                            type="file"
                                                                            className="hidden"
                                                                            onChange={(e) => handleLessonAttachmentUpload(e, mIndex, lIndex)}
                                                                        />
                                                                    </label>
                                                                </div>
                                                                {lesson.attachments && lesson.attachments.length > 0 ? (
                                                                    <ul className="space-y-1 text-xs">
                                                                        {lesson.attachments.map((attachment, attachmentIdx) => (
                                                                            <li key={`${attachment.fileName}-${attachmentIdx}`} className="flex items-center justify-between bg-slate-100 px-3 py-2 rounded">
                                                                                <span className="truncate">{attachment.fileName}</span>
                                                                                <button
                                                                                    type="button"
                                                                                    onClick={() => handleRemoveLessonAttachment(mIndex, lIndex, attachmentIdx)}
                                                                                    className="text-red-500 hover:text-red-700"
                                                                                >
                                                                                    <X className="h-3.5 w-3.5" aria-hidden />
                                                                                </button>
                                                                            </li>
                                                                        ))}
                                                                    </ul>
                                                                ) : (
                                                                    <p className="text-[11px] text-slate-400 italic">Aucun fichier joint</p>
                                                                )}
                                                            </div>

                                                            <div>
                                                                <div className="flex items-center justify-between mb-2">
                                                                    <label className="text-xs font-semibold text-slate-600">Liens complémentaires</label>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleAddLessonLink(mIndex, lIndex)}
                                                                        className="text-xs text-blue-600 hover:text-blue-700 font-semibold"
                                                                    >
                                                                        <Plus className="mr-1 inline h-3.5 w-3.5" aria-hidden />
                                                                        Ajouter un lien
                                                                    </button>
                                                                </div>
                                                                {(lesson.externalLinks || []).length === 0 && (
                                                                    <p className="text-[11px] text-slate-400 italic">Aucun lien ajouté</p>
                                                                )}
                                                                <div className="space-y-2">
                                                                    {(lesson.externalLinks || []).map((link, linkIdx) => (
                                                                        <div key={linkIdx} className="grid grid-cols-1 md:grid-cols-5 gap-2 text-xs items-center">
                                                                            <input
                                                                                value={link.label}
                                                                                onChange={(e) => handleLessonLinkChange(mIndex, lIndex, linkIdx, 'label', e.target.value)}
                                                                                placeholder="Nom du lien"
                                                                                className="md:col-span-2 px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                                                                            />
                                                                            <input
                                                                                value={link.url}
                                                                                onChange={(e) => handleLessonLinkChange(mIndex, lIndex, linkIdx, 'url', e.target.value)}
                                                                                placeholder="https://..."
                                                                                className="md:col-span-2 px-3 py-2 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                                                                            />
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => handleRemoveLessonLink(mIndex, lIndex, linkIdx)}
                                                                                className="text-red-500 hover:text-red-700 px-2 py-1 rounded"
                                                                            >
                                                                                <X className="h-4 w-4" aria-hidden />
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    <button 
                                                        type="button" 
                                                        onClick={() => removeLesson(mIndex, lIndex)} 
                                                            className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded transition-colors"
                                                        title="Supprimer cette leçon"
                                                    >
                                                            <Trash2 className="h-4 w-4" aria-hidden />
                                                    </button>
                                                    </div>
                                                </div>
                                            ))}
                                            <button 
                                                type="button" 
                                                onClick={() => addLesson(mIndex)} 
                                                className="text-sm text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50 p-2 rounded-lg transition-colors font-semibold"
                                            >
                                                <Plus className="mr-1 inline h-4 w-4" aria-hidden /> 
                                                Ajouter une leçon
                                            </button>
                                        </div>

                                        {/* Evidence Documents */}
                                        <div className="mt-4 pt-4 border-t border-slate-200">
                                            <h4 className="text-xs font-semibold text-slate-600 uppercase mb-2 flex items-center">
                                                <FileText className="mr-2 inline h-4 w-4" aria-hidden />
                                                Documents de preuve
                                            </h4>
                                            {module.evidenceDocuments && module.evidenceDocuments.length > 0 && (
                                                <div className="space-y-2 mb-2">
                                                    {module.evidenceDocuments.map((doc, dIndex) => (
                                                        <div key={dIndex} className="flex items-center justify-between bg-slate-50 p-2 rounded-md text-sm">
                                                            <span className="truncate flex-1">{doc.fileName}</span>
                                                            <button 
                                                                type="button" 
                                                                onClick={() => removeEvidenceDocument(mIndex, dIndex)} 
                                                                className="text-red-500 hover:text-red-700"
                                                            >
                                                                <X className="h-4 w-4" aria-hidden />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            <label className="text-sm text-emerald-600 hover:text-emerald-800 cursor-pointer inline-flex items-center gap-2 px-3 py-2 border border-emerald-300 rounded-md hover:bg-emerald-50 transition-colors">
                                                <Upload className="h-4 w-4" aria-hidden />
                                                Uploader un document
                                                <input type="file" className="hidden" onChange={(e) => handleEvidenceUpload(e, mIndex)} />
                                            </label>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            
                            <button 
                                type="button" 
                                onClick={addModule} 
                                className="w-full border-dashed border-2 border-emerald-400 p-4 rounded-lg hover:bg-emerald-50 hover:border-emerald-600 transition-all mt-4"
                            >
                                <Plus className="mr-2 inline h-5 w-5 text-emerald-600" aria-hidden />
                                <span className="font-semibold text-emerald-600">Ajouter un module</span>
                            </button>
                        </div>

                        {/* Boutons d'action */}
                        <div className="flex justify-end gap-3 border-t border-slate-100 pt-6">
                            <Button type="button" variant="secondary" size="md" onClick={onClose}>
                                Annuler
                            </Button>
                            <Button type="submit" variant="primary" size="md" leftIcon={<Save className="h-4 w-4" aria-hidden />}>
                                {isEditMode ? 'Sauvegarder' : 'Créer le cours'}
                            </Button>
                        </div>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CourseCreatePage;


