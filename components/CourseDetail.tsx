import React, { useState, useRef, useEffect, useCallback, useMemo, type ComponentType } from 'react';
import {
    ArrowLeft,
    ArrowRight,
    BookOpen,
    Check,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Circle,
    ClipboardCheck,
    Clock,
    FileText,
    Folder,
    FolderOpen,
    GraduationCap,
    HelpCircle,
    Hourglass,
    LineChart,
    Link2,
    Lock,
    Paperclip,
    Pause,
    Play,
    PlayCircle,
    Redo2,
    RotateCcw,
    Shield,
    StickyNote,
    Timer,
    User,
    Video,
} from 'lucide-react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { Course, Language, Lesson, Module, TimeLog, Project, EvidenceDocument } from '../types';
import LogTimeModal from './LogTimeModal';
import { DataService } from '../services/dataService';
import { logger } from '../services/loggerService';
import LinkPreview from './common/LinkPreview';
import RealtimeService from '../services/realtimeService';
import { LessonInPlatformViewer, LessonQuizRunner } from './common/LessonInPlatformViewer';
import { Button } from './ui/Button';

type LessonTimerState = {
    lessonId: string | null;
    startedAt: number | null;
    elapsedMs: number;
    isRunning: boolean;
};

const INITIAL_TIMER_STATE: LessonTimerState = {
    lessonId: null,
    startedAt: null,
    elapsedMs: 0,
    isRunning: false,
};

interface CourseDetailProps {
    course: Course;
    onBack: () => void;
    timeLogs: TimeLog[];
    onAddTimeLog: (log: Omit<TimeLog, 'id' | 'userId'>) => void;
    projects: Project[];
    onCourseChange: (course: Course) => void;
}

// Interface pour les notes par leçon
interface LessonNote {
    lessonId: string;
    note: string;
    updatedAt: string;
}

function lessonTypeMeta(lesson: Lesson): { label: string; Icon: ComponentType<{ className?: string }> } {
    if (lesson.type === 'video') return { label: 'Vidéo', Icon: Video };
    if (lesson.type === 'reading') return { label: 'Lecture', Icon: BookOpen };
    if (lesson.type === 'quiz') return { label: 'Quiz', Icon: HelpCircle };
    return { label: 'Document', Icon: FileText };
}

// Composant pour une leçon avec statut et notes
const EnhancedLessonItem: React.FC<{
    lesson: Lesson;
    moduleIndex: number;
    lessonIndex: number;
    isCompleted: boolean;
    isInProgress: boolean;
    isNext: boolean;
    note: string;
    onToggle: (id: string) => void;
    onStart: (lesson: Lesson) => void;
    onNoteChange: (lessonId: string, note: string) => void;
    course: Course;
    isLocked: boolean;
    timerSeconds?: number;
    timerIsRunning?: boolean;
    onPauseResume?: () => void;
    isFr?: boolean;
}> = ({ lesson, isCompleted, isInProgress, isNext, note, onToggle, onStart, onNoteChange, course, isLocked, timerSeconds, timerIsRunning, onPauseResume, isFr = true }) => {
    const [showNote, setShowNote] = useState(false);
    const [editingNote, setEditingNote] = useState(note);
    const { label: typeLabel, Icon: TypeIcon } = lessonTypeMeta(lesson);

    const formatSeconds = (totalSeconds: number) => {
        const safeValue = Math.max(0, totalSeconds);
        const minutes = Math.floor(safeValue / 60);
        const seconds = safeValue % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    const getStatusBadge = () => {
        if (isCompleted) {
            return (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Terminé
                </span>
            );
        }
        if (isInProgress) {
            return (
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-800">
                    <Play className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    En cours
                </span>
            );
        }
        if (isNext) {
            return (
                <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-1 text-xs font-semibold text-violet-800">
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Prochaine
                </span>
            );
        }
        return (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">
                <Circle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                À faire
            </span>
        );
    };

    const handleNoteSave = () => {
        onNoteChange(lesson.id, editingNote);
        setShowNote(false);
    };

    return (
        <div
            className={`rounded-2xl border-2 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)] transition-all duration-200 ${
                isNext
                    ? 'border-violet-300 bg-violet-50/80'
                    : isCompleted
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : isInProgress
                        ? 'border-blue-200 bg-blue-50/60'
                        : 'border-slate-200/80 bg-white hover:border-slate-300'
            }`}
        >
            <div className="mb-3 flex items-start justify-between">
                <div className="flex min-w-0 flex-1 items-start">
                    <div
                        className={`mr-4 flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
                            isCompleted
                                ? 'bg-emerald-500 text-white'
                                : isInProgress
                                  ? 'bg-blue-600 text-white'
                                  : isNext
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-slate-200 text-slate-600'
                        }`}
                    >
                        {isCompleted ? (
                            <Check className="h-5 w-5" aria-hidden />
                        ) : isInProgress ? (
                            <Play className="h-5 w-5" aria-hidden />
                        ) : isNext ? (
                            <ArrowRight className="h-5 w-5" aria-hidden />
                        ) : (
                            <Circle className="h-5 w-5" aria-hidden />
                        )}
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                            <h4
                                className={`text-lg font-bold ${
                                    isCompleted
                                        ? 'text-emerald-900'
                                        : isInProgress
                                          ? 'text-blue-900'
                                          : isNext
                                            ? 'text-violet-900'
                                            : 'text-slate-900'
                                }`}
                            >
                                {lesson.title}
                            </h4>
                            {getStatusBadge()}
                        </div>
                        <div className="mb-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                            <span className="inline-flex items-center gap-1.5">
                                <TypeIcon className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                                {typeLabel}
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                                {lesson.duration}
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2">
                {!isCompleted && (
                    <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        disabled={isLocked}
                        leftIcon={
                            isInProgress ? (
                                <Redo2 className="h-4 w-4" aria-hidden />
                            ) : (
                                <Play className="h-4 w-4" aria-hidden />
                            )
                        }
                        className={
                            isNext
                                ? '!bg-gradient-to-r !from-violet-600 !to-violet-700 hover:!from-violet-700 hover:!to-violet-800'
                                : isInProgress
                                  ? '!bg-gradient-to-r !from-blue-600 !to-blue-700 hover:!from-blue-700 hover:!to-blue-800'
                                  : '!bg-slate-800 hover:!bg-slate-900'
                        }
                        onClick={() => {
                            if (isLocked) return;
                            onStart(lesson);
                        }}
                    >
                        {isNext ? 'Continuer' : isInProgress ? 'Reprendre' : 'Commencer'}
                    </Button>
                )}
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={isLocked}
                    leftIcon={isCompleted ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
                    onClick={() => {
                        if (isLocked) return;
                        onToggle(lesson.id);
                    }}
                >
                    {isCompleted ? 'Marquer non terminé' : 'Marquer terminé'}
                </Button>
                {typeof timerSeconds === 'number' && onPauseResume && (
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className={timerIsRunning ? '!border-amber-300 !bg-amber-500 !text-white hover:!bg-amber-600' : '!border-amber-200 !bg-amber-50 !text-amber-900'}
                        leftIcon={timerIsRunning ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                        onClick={onPauseResume}
                    >
                        {timerIsRunning ? 'Pause' : 'Reprendre chrono'}
                    </Button>
                )}
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    leftIcon={<StickyNote className="h-4 w-4" aria-hidden />}
                    onClick={() => setShowNote(!showNote)}
                    className={note ? '!border-amber-200 !bg-amber-50 !text-amber-900' : undefined}
                >
                    Notes{note ? ` (${note.length} car.)` : ''}
                </Button>
            </div>

            {showNote && (
                <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50/80 p-3">
                    <textarea
                        value={editingNote}
                        onChange={(e) => setEditingNote(e.target.value)}
                        placeholder="Ajoutez vos notes sur cette leçon…"
                        className="min-h-[100px] w-full rounded-xl border border-amber-200/80 p-2 text-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300/40"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                setEditingNote(note);
                                setShowNote(false);
                            }}
                        >
                            Annuler
                        </Button>
                        <Button type="button" variant="primary" size="sm" onClick={handleNoteSave}>
                            Enregistrer
                        </Button>
                    </div>
                </div>
            )}

            {typeof timerSeconds === 'number' && (
                <div className="mt-3 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="font-mono text-xl text-slate-900">{formatSeconds(timerSeconds)}</span>
                    {timerIsRunning !== undefined && (
                        <span className={`text-xs font-semibold uppercase ${timerIsRunning ? 'text-emerald-600' : 'text-slate-500'}`}>
                            {timerIsRunning ? 'Chrono en cours' : 'Chrono en pause'}
                        </span>
                    )}
                </div>
            )}

            <div className="mt-4 space-y-4">
                {lesson.type === 'quiz' && lesson.quizQuestions && lesson.quizQuestions.length > 0 ? (
                    <LessonQuizRunner questions={lesson.quizQuestions} isFr={isFr} />
                ) : lesson.type === 'quiz' ? (
                    <p className="rounded-coya border border-dashed border-coya-border p-4 text-sm text-coya-text-muted">
                        {isFr
                            ? 'Leçon quiz : ajoutez des questions dans la gestion du cours (module Gestion des formations).'
                            : 'Quiz lesson: add questions in course management.'}
                    </p>
                ) : (
                    <LessonInPlatformViewer lesson={lesson} course={course} isFr={isFr} />
                )}
            </div>

            {lesson.attachments && lesson.attachments.length > 0 && (
                <div className="mt-3">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <Paperclip className="h-4 w-4 text-emerald-600" aria-hidden />
                        Pièces jointes
                    </p>
                    <div className="flex flex-wrap gap-2">
                        {lesson.attachments.map((attachment, index) => (
                            <a
                                key={`${attachment.fileName}-${index}`}
                                href={attachment.dataUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                download={attachment.fileName}
                                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                            >
                                <span className="inline-flex items-center gap-1">
                                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                    {attachment.fileName}
                                </span>
                            </a>
                        ))}
                    </div>
                </div>
            )}

            {lesson.externalLinks && lesson.externalLinks.length > 0 && (
                <div className="mt-3">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                        <Link2 className="h-4 w-4 text-blue-600" aria-hidden />
                        Liens complémentaires
                    </p>
                    <ul className="space-y-1 text-sm">
                        {lesson.externalLinks.map((link, index) => (
                            <li key={`${link.url}-${index}`}>
                                <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-800">
                                    {link.label || link.url}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

const CourseDetail: React.FC<CourseDetailProps> = ({ course, onBack, timeLogs, onAddTimeLog, projects, onCourseChange }) => {
    const { t, language } = useLocalization();
    const isFr = language === Language.FR;
    const { user } = useAuth();
    const [isLogTimeModalOpen, setLogTimeModalOpen] = useState(false);
    const [isLoadingModules, setIsLoadingModules] = useState(true);
    const [lessonNotes, setLessonNotes] = useState<Record<string, string>>({});
    const [inProgressLessons, setInProgressLessons] = useState<string[]>([]);
    const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
    const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
    const [lessonTimer, setLessonTimer] = useState<LessonTimerState>({ ...INITIAL_TIMER_STATE });
    const [timerTick, setTimerTick] = useState(0);
    const modulesLoadedRef = useRef<string | null>(null);

    useEffect(() => {
        if (!lessonTimer.isRunning || !lessonTimer.lessonId) {
            return;
        }
        const interval = window.setInterval(() => {
            setTimerTick(tick => tick + 1);
        }, 1000);
        return () => window.clearInterval(interval);
    }, [lessonTimer.isRunning, lessonTimer.lessonId]);

    const resetLessonTimer = () => {
        setLessonTimer({ ...INITIAL_TIMER_STATE });
        setTimerTick(0);
    };

    const getElapsedMsForLesson = useCallback((lessonId: string) => {
        if (lessonTimer.lessonId !== lessonId) return 0;
        let total = lessonTimer.elapsedMs;
        if (lessonTimer.isRunning && lessonTimer.startedAt) {
            total += Date.now() - lessonTimer.startedAt;
        }
        return total;
    }, [lessonTimer]);

    const parseDurationToMinutes = useCallback((duration?: string | null) => {
        if (!duration) return null;
        const trimmed = duration.trim().toLowerCase();
        const minuteMatch = trimmed.match(/([0-9]+)\s*(min|minutes|m)/);
        if (minuteMatch) {
            return Math.max(1, parseInt(minuteMatch[1], 10));
        }
        const hourMatch = trimmed.match(/([0-9]+)\s*(h|heures|hours)/);
        if (hourMatch) {
            return Math.max(1, parseInt(hourMatch[1], 10) * 60);
        }
        return null;
    }, []);

    const computeModuleStates = useMemo(() => {
        if (!course.modules || course.modules.length === 0) return [];

        const completedSet = new Set(course.completedLessons || []);
        let lockedForNext = course.sequentialModules ? false : false;
        let lockReasonForNext = '';

        return course.modules.map((module, index) => {
            const lessons = module.lessons || [];
            const completedCount = lessons.filter(lesson => completedSet.has(lesson.id)).length;
            const moduleCompleted = lessons.length === 0 ? true : completedCount === lessons.length;
            const awaitingValidation = module.requiresValidation && moduleCompleted;

            const isLocked = course.sequentialModules ? lockedForNext : false;
            const lockedReason = course.sequentialModules && lockedForNext ? (lockReasonForNext || 'Terminez le module précédent pour continuer.') : '';

            if (course.sequentialModules) {
                if (!moduleCompleted) {
                    lockedForNext = true;
                    lockReasonForNext = 'Terminez ce module pour débloquer le suivant.';
                } else if (module.requiresValidation && module.unlocksNextModule === false) {
                    lockedForNext = true;
                    lockReasonForNext = 'Un instructeur doit valider ce module pour débloquer le suivant.';
                } else if (module.unlocksNextModule === false) {
                    lockedForNext = true;
                    lockReasonForNext = 'Ce module est verrouillé par un administrateur.';
                } else {
                    lockedForNext = false;
                    lockReasonForNext = '';
                }
            }

            return {
                moduleIndex: index,
                isLocked,
                lockedReason,
                awaitingValidation,
                moduleCompleted
            };
        });
    }, [course.modules, course.completedLessons, course.sequentialModules]);

    if (!user) return null;

    // Trouver la prochaine leçon non complétée
    const getNextLesson = useCallback(() => {
        if (!course.modules || course.modules.length === 0) return null;
        
        const completed = new Set(course.completedLessons || []);
        
        for (const module of course.modules) {
            for (const lesson of module.lessons) {
                if (!completed.has(lesson.id)) {
                    return lesson.id;
                }
            }
        }
        
        return null;
    }, [course.modules, course.completedLessons]);

    const nextLessonId = useMemo(() => getNextLesson(), [getNextLesson]);

    const selectedLesson = useMemo(() => {
        if (!course.modules) return null;
        const lessonId = selectedLessonId || nextLessonId;
        if (!lessonId) return null;
        for (const module of course.modules) {
            const found = module.lessons.find(lesson => lesson.id === lessonId);
            if (found) {
                return found;
            }
        }
        return null;
    }, [course.modules, selectedLessonId, nextLessonId]);

    const activeElapsedSeconds = useMemo(() => {
        if (!selectedLesson) return 0;
        return Math.floor(getElapsedMsForLesson(selectedLesson.id) / 1000);
    }, [selectedLesson, getElapsedMsForLesson, timerTick]);

    const handlePauseResumeTimer = () => {
        setLessonTimer(prev => {
            if (!prev.lessonId) {
                return prev;
            }
            if (prev.isRunning) {
                const accumulated = prev.startedAt ? prev.elapsedMs + (Date.now() - prev.startedAt) : prev.elapsedMs;
                return { ...prev, elapsedMs: accumulated, startedAt: null, isRunning: false };
            }
            return { ...prev, startedAt: Date.now(), isRunning: true };
        });
    };

    useEffect(() => {
        if (!course.modules || course.modules.length === 0) return;
        const exists = selectedLessonId && course.modules.some(module => module.lessons.some(lesson => lesson.id === selectedLessonId));
        if (!exists) {
            const fallback = nextLessonId || course.modules[0]?.lessons[0]?.id || null;
            if (fallback) {
                setSelectedLessonId(fallback);
            }
        }
    }, [course.modules, selectedLessonId, nextLessonId]);

    useEffect(() => {
        if (!course.modules || course.modules.length === 0) return;
        setExpandedModules(prev => {
            const next = { ...prev };
            let changed = false;

            if (Object.keys(next).length === 0) {
                course.modules.forEach((module, index) => {
                    const shouldOpen = module.lessons.some(lesson => lesson.id === (selectedLesson?.id || nextLessonId));
                    next[module.id] = shouldOpen || index === 0;
                });
                changed = true;
            } else if (selectedLesson) {
                course.modules.forEach(module => {
                    if (module.lessons.some(lesson => lesson.id === selectedLesson.id) && !next[module.id]) {
                        next[module.id] = true;
                        changed = true;
                    }
                });
            }

            return changed ? next : prev;
        });
    }, [course.modules, selectedLesson, nextLessonId]);

    const selectedModuleIndex = useMemo(() => {
        if (!course.modules || !selectedLesson) return 0;
        const idx = course.modules.findIndex(module => module.lessons.some(lesson => lesson.id === selectedLesson.id));
        return idx >= 0 ? idx : 0;
    }, [course.modules, selectedLesson]);

    const selectedLessonIndex = useMemo(() => {
        if (!course.modules || !selectedLesson) return 0;
        const module = course.modules[selectedModuleIndex];
        if (!module) return 0;
        const idx = module.lessons.findIndex(lesson => lesson.id === selectedLesson.id);
        return idx >= 0 ? idx : 0;
    }, [course.modules, selectedModuleIndex, selectedLesson]);

    const nextLessonAfterSelected = useMemo(() => {
        if (!course.modules || !selectedLesson) return null;
        let seen = false;
        for (const mod of course.modules) {
            for (const les of mod.lessons) {
                if (seen) return les;
                if (les.id === selectedLesson.id) seen = true;
            }
        }
        return null;
    }, [course.modules, selectedLesson]);

    const selectedModuleState = useMemo(() => {
        if (!selectedLesson) return undefined;
        return computeModuleStates[selectedModuleIndex] || undefined;
    }, [computeModuleStates, selectedLesson, selectedModuleIndex]);

    const selectedLessonLocked = useMemo(() => {
        if (!selectedLesson) return false;
        if (!selectedModuleState) return false;
        const isCompleted = (course.completedLessons || []).includes(selectedLesson.id);
        return selectedModuleState.isLocked && !isCompleted;
    }, [selectedLesson, selectedModuleState, course.completedLessons]);

    const selectedModule = useMemo(() => {
        if (!course.modules || course.modules.length === 0) return undefined;
        return course.modules[selectedModuleIndex];
    }, [course.modules, selectedModuleIndex]);

    // Charger les modules et la progression
    useEffect(() => {
        const loadCourseData = async () => {
            if (!user || !course.id) return;
            
            if (modulesLoadedRef.current === course.id) {
                setIsLoadingModules(false);
                return;
            }
            
            setIsLoadingModules(true);
            try {
                logger.info('course', `Chargement modules pour cours: ${course.id}`);
                const userId = (user as any).profileId || user.id;
                
                // Charger les modules et leçons
                const modulesResult = await DataService.getCourseModules(course.id);
                logger.info('course', `Résultat getCourseModules: ${modulesResult.error ? 'ERROR' : 'OK'}, ${modulesResult.data?.length || 0} modules`);
                
                if (!modulesResult.error && modulesResult.data) {
                    const mappedModules: Module[] = modulesResult.data.map((mod: any) => ({
                        id: mod.id,
                        title: mod.title,
                        description: mod.description,
                        requiresValidation: mod.requires_validation ?? false,
                        unlocksNextModule: mod.unlocks_next_module ?? false,
                        evidenceDocuments: mod.evidence_documents || [],
                        lessons: (mod.lessons || []).map((lesson: any) => ({
                            id: lesson.id,
                            title: lesson.title,
                            type: lesson.type || 'video',
                            duration: lesson.duration || '0 min',
                            icon: lesson.icon || 'fas fa-play-circle',
                            description: lesson.description || '',
                            contentUrl: lesson.content_url || undefined,
                            attachments: lesson.attachments || [],
                            externalLinks: lesson.external_links || [],
                            quizQuestions: Array.isArray(lesson.quiz?.questions) ? lesson.quiz.questions : [],
                        }))
                    }));
                    
                    logger.info('course', `Modules mappés: ${mappedModules.length} modules, ${mappedModules.reduce((sum, m) => sum + m.lessons.length, 0)} leçons`);
                    
                    // Charger la progression de l'utilisateur
                    const enrollmentResult = await DataService.getCourseEnrollment(course.id, String(userId));
                    const completedLessons = enrollmentResult.data?.completed_lessons || [];
                    const progress = enrollmentResult.data?.progress || 0;
                    const notes = enrollmentResult.data?.notes || {};
                    
                    logger.info('course', `Progression chargée: ${progress}%, ${completedLessons.length} leçons complétées`);
                    
                    // Charger les notes
                    setLessonNotes(notes || {});
                    
                    // Mettre à jour le cours avec les modules et la progression
                    onCourseChange({
                        ...course,
                        modules: mappedModules,
                        completedLessons,
                        progress
                    });

                    // Créer l'enrollment s'il n'existe pas encore (inscription auto)
                    if (!enrollmentResult.data && mappedModules.length > 0) {
                        logger.info('course', `Inscription automatique au cours: ${course.id}`);
                        await DataService.upsertCourseEnrollment(
                            course.id,
                            String(userId),
                            0,
                            []
                        );
                    }
                    
                    modulesLoadedRef.current = course.id;
                } else {
                    logger.error('course', `Erreur chargement modules:`, modulesResult.error);
                }
            } catch (error) {
                logger.error('course', `Erreur chargement modules:`, error);
            } finally {
                setIsLoadingModules(false);
            }
        };

        loadCourseData();
    }, [course.id]);

    // Realtime subscription pour la progression
    useEffect(() => {
        if (!user || !course.id) return;
        
        const userId = (user as any).profileId || user.id;
        const filter = `course_id=eq.${course.id}&user_id=eq.${userId}`;
        const channel = RealtimeService.subscribeToTable('course_enrollments', (payload: any) => {
            if (payload.new && payload.new.course_id === course.id && payload.new.user_id === userId) {
                // Mettre à jour la progression en temps réel
                const newProgress = payload.new.progress || 0;
                const newCompletedLessons = payload.new.completed_lessons || [];
                const newNotes = payload.new.notes || {};
                
                onCourseChange({
                    ...course,
                    progress: newProgress,
                    completedLessons: newCompletedLessons
                });
                
                // Mettre à jour les notes
                setLessonNotes(newNotes);
            }
        }, filter);

        return () => {
            if (channel) {
                RealtimeService.unsubscribe(channel);
            }
        };
    }, [course.id, user]);

    const handleStartLesson = (lesson: Lesson) => {
        const isDifferentLesson = lessonTimer.lessonId !== lesson.id;
        setSelectedLessonId(lesson.id);
        setLessonTimer(prev => {
            if (prev.lessonId === lesson.id) {
                if (prev.isRunning) {
                    return prev;
                }
                return { ...prev, startedAt: Date.now(), isRunning: true };
            }
            return {
                lessonId: lesson.id,
                startedAt: Date.now(),
                elapsedMs: 0,
                isRunning: true,
            };
        });
        if (isDifferentLesson) {
            setTimerTick(0);
        }
        setInProgressLessons(prev => [...new Set([...prev, lesson.id])]);
        
        // Si c'est la première leçon, mettre la progression à 5%
        if (course.progress === 0) {
            onCourseChange({ ...course, progress: 5 });
        }
        // Le contenu s’affiche dans la plateforme (lecteur intégré / quiz) — pas d’ouverture d’onglet systématique.
    };

    const handleToggleLesson = async (lessonId: string) => {
        logger.info('course', `handleToggleLesson appelé pour leçon: ${lessonId}`);
        
        const totalLessons = course.modules?.reduce((acc, module) => acc + module.lessons.length, 0) || 0;
        const completed = new Set(course.completedLessons || []);
        
        const wasCompleted = completed.has(lessonId);
        if (wasCompleted) {
            completed.delete(lessonId);
            setInProgressLessons(prev => prev.filter(id => id !== lessonId));
        } else {
            completed.add(lessonId);
            setInProgressLessons(prev => prev.filter(id => id !== lessonId));
        }
        
        const newCompletedLessons = Array.from(completed);
        let newProgress = totalLessons > 0 ? Math.round((newCompletedLessons.length / totalLessons) * 100) : 0;
        
        if (newProgress === 0 && course.progress > 0) {
            newProgress = 5;
        }

        // Mettre à jour l'état local immédiatement
        onCourseChange({
            ...course,
            completedLessons: newCompletedLessons,
            progress: newProgress,
        });

        // Sauvegarder dans Supabase
        try {
            const userId = (user as any).profileId || user.id;
            const result = await DataService.upsertCourseEnrollment(
                course.id,
                String(userId),
                newProgress,
                newCompletedLessons
            );
            
            if (result.error) {
                console.error('❌ Erreur sauvegarde progression:', result.error);
                // Rollback
                onCourseChange({
                    ...course,
                    completedLessons: course.completedLessons || [],
                    progress: course.progress || 0,
                });
                alert('Erreur lors de la sauvegarde de la progression');
            }
        } catch (error) {
            console.error('❌ Erreur sauvegarde progression:', error);
        }

        let targetLesson: Lesson | null = null;
        if (course.modules) {
            for (const mod of course.modules) {
                const l = mod.lessons.find(x => x.id === lessonId);
                if (l) { targetLesson = l; break; }
            }
        }

        if (!wasCompleted) {
            let minutesLogged: number | null = null;
            const totalMs = getElapsedMsForLesson(lessonId);
            if (totalMs > 0) {
                minutesLogged = Math.max(1, Math.round(totalMs / 60000));
            }
            if (!minutesLogged || !Number.isFinite(minutesLogged)) {
                const fallback = parseDurationToMinutes(targetLesson?.duration);
                if (fallback) {
                    minutesLogged = fallback;
                }
            }
            if (!minutesLogged || minutesLogged <= 0) {
                minutesLogged = 5;
            }

            onAddTimeLog({
                entityType: 'course',
                entityId: String(course.id),
                entityTitle: `${course.title}${targetLesson ? ' • ' + targetLesson.title : ''}`,
                date: new Date().toISOString().split('T')[0],
                duration: minutesLogged,
                description: `Temps passé sur ${targetLesson ? targetLesson.title : 'une leçon'}`
            });

            if (lessonTimer.lessonId === lessonId) {
                resetLessonTimer();
            }
        } else if (lessonTimer.lessonId === lessonId) {
            resetLessonTimer();
        }
 
        if (!wasCompleted && nextLessonId && nextLessonId !== lessonId) {
            setSelectedLessonId(nextLessonId);
        }
    };

    const handleNoteChange = async (lessonId: string, note: string) => {
        setLessonNotes(prev => ({ ...prev, [lessonId]: note }));
        
        // Sauvegarder les notes dans Supabase
        try {
            const userId = (user as any).profileId || user.id;
            const enrollmentResult = await DataService.getCourseEnrollment(course.id, String(userId));
            
            if (enrollmentResult.data) {
                const currentNotes = enrollmentResult.data.notes || {};
                const updatedNotes = { ...currentNotes, [lessonId]: note };
                
                // Mettre à jour les notes dans l'enrollment
                await DataService.upsertCourseEnrollment(
                    course.id,
                    String(userId),
                    course.progress || 0,
                    course.completedLessons || [],
                    updatedNotes
                );
            }
        } catch (error) {
            console.error('❌ Erreur sauvegarde notes:', error);
        }
    };

    const handleContinue = () => {
        if (!nextLessonId || !course.modules) return;
        
        for (const module of course.modules) {
            const lesson = module.lessons.find(l => l.id === nextLessonId);
            if (lesson) {
                handleStartLesson(lesson);
                break;
            }
        }
    };

    const totalLessons = course.modules?.reduce((acc, module) => acc + module.lessons.length, 0) || 0;
    const completedLessonsCount = (course.completedLessons || []).length;
    const totalMinutesLogged = timeLogs
        .filter(log => log.entityType === 'course' && log.entityId === course.id && log.userId === user.id)
        .reduce((sum, log) => sum + log.duration, 0);

    const formatMinutes = (minutes: number) => {
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m`;
    };

    const handleSaveTimeLog = (logData: Omit<TimeLog, 'id' | 'userId'>) => {
        onAddTimeLog(logData);
        setLogTimeModalOpen(false);
    };

    const audienceLabel =
        course.audienceSegment === 'incubated'
            ? isFr ? 'Parcours incubés' : 'Incubated track'
            : course.audienceSegment === 'beneficiary'
              ? isFr ? 'Parcours bénéficiaires' : 'Beneficiary track'
              : null;

    return (
        <div className="min-h-screen bg-coya-bg text-coya-text">
            {/* Page de garde — thème COYA */}
            <div className="border-b border-coya-border bg-coya-card shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                    <button
                        type="button"
                        onClick={onBack}
                        className="mb-4 flex items-center gap-2 text-sm font-medium text-coya-primary transition-opacity hover:opacity-90"
                    >
                        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden />
                        {t('back_to_courses')}
                    </button>
                    <div className="flex flex-col md:flex-row gap-6 items-start">
                        {course.thumbnailUrl ? (
                            <div className="w-full md:w-56 shrink-0 rounded-coya overflow-hidden border border-coya-border aspect-video bg-coya-bg">
                                <img src={course.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                        ) : (
                            <div className="flex aspect-video w-full shrink-0 items-center justify-center rounded-coya border border-coya-border bg-coya-primary/10 md:w-56">
                                <GraduationCap className="h-12 w-12 text-coya-primary/80" aria-hidden />
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            {audienceLabel && (
                                <span className="inline-block mb-2 rounded-full bg-coya-primary/15 text-coya-primary text-xs font-semibold px-3 py-0.5">
                                    {audienceLabel}
                                </span>
                            )}
                            <h1 className="text-3xl font-bold text-coya-text mb-2">{course.title}</h1>
                            <p className="text-sm text-coya-text-muted leading-relaxed">{course.description}</p>
                            <div className="mt-4 flex flex-wrap items-center gap-4">
                                <div>
                                    <p className="text-[10px] uppercase tracking-wide text-coya-text-muted">{isFr ? 'Progression' : 'Progress'}</p>
                                    <p className="text-2xl font-bold text-coya-primary">{course.progress || 0}%</p>
                                </div>
                                <div className="h-8 w-px bg-coya-border hidden sm:block" />
                                <p className="inline-flex items-center gap-1.5 text-sm text-coya-text-muted">
                                    <User className="h-4 w-4 shrink-0 text-coya-primary" aria-hidden />
                                    {course.instructor}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 -mt-6 mb-8">
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                        <div className="rounded-xl bg-blue-50 p-3 text-blue-600">
                            <BookOpen className="h-5 w-5" aria-hidden />
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Modules</p>
                            <p className="text-xl font-bold text-slate-900">{course.modules?.length || 0}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                        <div className="rounded-xl bg-emerald-50 p-3 text-emerald-600">
                            <CheckCircle2 className="h-5 w-5" aria-hidden />
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Leçons terminées</p>
                            <p className="text-xl font-bold text-slate-900">
                                {completedLessonsCount}/{totalLessons}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                        <div className="rounded-xl bg-violet-50 p-3 text-violet-600">
                            <Clock className="h-5 w-5" aria-hidden />
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Temps enregistré</p>
                            <p className="text-xl font-bold text-slate-900">{formatMinutes(totalMinutesLogged)}</p>
                        </div>
                    </div>
                </div>

                {course.courseMaterials && course.courseMaterials.length > 0 && (
                    <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                        <h3 className="mb-3 flex items-center gap-2 text-lg font-semibold text-slate-900">
                            <Folder className="h-5 w-5 text-emerald-600" aria-hidden />
                            Ressources du cours
                        </h3>
                        <p className="mb-3 text-sm text-slate-600">
                            Documents fournis par l’instructeur (PDF, Word, Excel, images…).
                        </p>
                        <div className="flex flex-wrap gap-3">
                            {course.courseMaterials.map((doc: EvidenceDocument, idx: number) => (
                                <a
                                    key={`${doc.fileName}-${idx}`}
                                    href={doc.dataUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    download={doc.fileName}
                                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                                >
                                    <FileText className="h-4 w-4 shrink-0" aria-hidden />
                                    {doc.fileName}
                                </a>
                            ))}
                        </div>
                    </div>
                )}

                <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[320px,1fr]">
                    <aside className="space-y-4 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plan du cours</p>
                                <p className="text-sm text-slate-600">
                                    {completedLessonsCount} leçons terminées sur {totalLessons}
                                </p>
                            </div>
                        </div>

                        {isLoadingModules ? (
                            <div className="py-10 text-center">
                                <div className="mx-auto mb-3 h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
                                <p className="text-sm text-slate-500">Chargement du plan…</p>
                            </div>
                        ) : course.modules && course.modules.length > 0 ? (
                            course.modules.map((module, index) => {
                                const state = computeModuleStates[index] || {
                                    isLocked: false,
                                    lockedReason: '',
                                    awaitingValidation: false,
                                    moduleCompleted: false,
                                };
                                const completedSet = new Set(course.completedLessons || []);
                                const lessons = module.lessons || [];
                                const moduleCompletedCount = lessons.filter((lesson) => completedSet.has(lesson.id)).length;
                                const moduleProgress =
                                    lessons.length > 0 ? Math.round((moduleCompletedCount / lessons.length) * 100) : 100;
                                const expanded = expandedModules[module.id] ?? false;

                                return (
                                    <div key={module.id} className="overflow-hidden rounded-2xl border border-slate-200/80">
                                        <button
                                            type="button"
                                            onClick={() => setExpandedModules((prev) => ({ ...prev, [module.id]: !expanded }))}
                                            className="flex w-full items-center justify-between bg-slate-50 px-3 py-3 text-left hover:bg-slate-100"
                                        >
                                            <div className="min-w-0 text-left">
                                                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                                                    Module {index + 1}
                                                </p>
                                                <p className="truncate text-sm font-semibold text-slate-900">{module.title}</p>
                                                {state.awaitingValidation && (
                                                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-800">
                                                        <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                                        En attente de validation
                                                    </p>
                                                )}
                                                {state.isLocked && state.lockedReason && (
                                                    <p className="mt-1 text-xs text-slate-500">{state.lockedReason}</p>
                                                )}
                                            </div>
                                            <div className="flex shrink-0 items-center gap-2">
                                                <span className="text-xs font-semibold text-blue-600">{moduleProgress}%</span>
                                                {expanded ? (
                                                    <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden />
                                                ) : (
                                                    <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
                                                )}
                                            </div>
                                        </button>

                                        {expanded && (
                                            <ul className="border-t border-slate-200 bg-white">
                                                {lessons.length === 0 && (
                                                    <li className="px-3 py-3 text-xs italic text-slate-500">
                                                        Aucune leçon dans ce module
                                                    </li>
                                                )}
                                                {lessons.map((lesson) => {
                                                    const isCompleted = completedSet.has(lesson.id);
                                                    const isInProgress = inProgressLessons.includes(lesson.id);
                                                    const isCurrent = selectedLesson?.id === lesson.id;
                                                    const isNext = nextLessonId === lesson.id;
                                                    const lessonLocked = state.isLocked && !isCompleted;

                                                    let statusEl: React.ReactNode;
                                                    if (isCompleted) {
                                                        statusEl = <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />;
                                                    } else if (lessonLocked) {
                                                        statusEl = <Lock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />;
                                                    } else if (isInProgress) {
                                                        statusEl = <Play className="h-4 w-4 shrink-0 text-blue-600" aria-hidden />;
                                                    } else if (isNext) {
                                                        statusEl = <ArrowRight className="h-4 w-4 shrink-0 text-violet-600" aria-hidden />;
                                                    } else {
                                                        statusEl = <Circle className="h-4 w-4 shrink-0 text-slate-300" aria-hidden />;
                                                    }

                                                    return (
                                                        <li key={lesson.id} className="border-b border-slate-100 last:border-b-0">
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (lessonLocked) return;
                                                                    setSelectedLessonId(lesson.id);
                                                                    setExpandedModules((prev) => ({ ...prev, [module.id]: true }));
                                                                }}
                                                                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                                                                    isCurrent
                                                                        ? 'border-l-4 border-emerald-500 bg-emerald-50'
                                                                        : 'hover:bg-slate-50'
                                                                } ${lessonLocked ? 'cursor-not-allowed opacity-60' : ''}`}
                                                            >
                                                                {statusEl}
                                                                <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
                                                                {isNext && !isCompleted && (
                                                                    <span className="shrink-0 text-xs font-semibold text-violet-600">
                                                                        Suivant
                                                                    </span>
                                                                )}
                                                            </button>
                                                        </li>
                                                    );
                                                })}
                                            </ul>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            <div className="text-sm text-slate-500">Aucun module n’a encore été publié.</div>
                        )}
                    </aside>

                    <div className="space-y-6">
                        {nextLessonId && (
                            <Button
                                type="button"
                                variant="primary"
                                size="lg"
                                className="w-full !bg-slate-900 hover:!bg-slate-800"
                                leftIcon={<PlayCircle className="h-5 w-5" aria-hidden />}
                                onClick={handleContinue}
                            >
                                Reprendre là où vous vous êtes arrêté
                            </Button>
                        )}

                        {selectedLesson ? (
                            <EnhancedLessonItem
                                lesson={selectedLesson}
                                moduleIndex={selectedModuleIndex}
                                lessonIndex={selectedLessonIndex}
                                isCompleted={(course.completedLessons || []).includes(selectedLesson.id)}
                                isInProgress={inProgressLessons.includes(selectedLesson.id)}
                                isNext={nextLessonId === selectedLesson.id}
                                note={lessonNotes[selectedLesson.id] || ''}
                                onToggle={handleToggleLesson}
                                onStart={handleStartLesson}
                                onNoteChange={handleNoteChange}
                                course={course}
                                isLocked={selectedLessonLocked}
                                timerSeconds={lessonTimer.lessonId === selectedLesson.id ? activeElapsedSeconds : undefined}
                                timerIsRunning={lessonTimer.lessonId === selectedLesson.id ? lessonTimer.isRunning : undefined}
                                onPauseResume={lessonTimer.lessonId === selectedLesson.id ? handlePauseResumeTimer : undefined}
                                isFr={isFr}
                            />
                        ) : (
                            <div className="rounded-coya border border-coya-border bg-coya-card p-6 text-center text-sm text-coya-text-muted">
                                {isFr
                                    ? 'Sélectionnez une leçon dans le plan à gauche.'
                                    : 'Select a lesson from the outline on the left.'}
                            </div>
                        )}

                        {selectedLesson && nextLessonAfterSelected && (
                            <div className="rounded-coya border border-coya-border bg-coya-bg/60 p-4 flex flex-wrap items-center justify-between gap-3">
                                <p className="text-sm text-coya-text">
                                    <span className="text-coya-text-muted">{isFr ? 'Suite du parcours' : 'Next in path'} · </span>
                                    <span className="font-medium">{nextLessonAfterSelected.title}</span>
                                </p>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedLessonId(nextLessonAfterSelected.id);
                                        handleStartLesson(nextLessonAfterSelected);
                                    }}
                                    className="rounded-coya bg-coya-primary px-4 py-2 text-sm font-medium text-white hover:opacity-95 shrink-0"
                                >
                                    {isFr ? 'Leçon suivante →' : 'Next lesson →'}
                                </button>
                            </div>
                        )}

                        {selectedModule?.evidenceDocuments && selectedModule.evidenceDocuments.length > 0 && (
                            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
                                    <FolderOpen className="h-4 w-4 text-emerald-600" aria-hidden />
                                    Ressources du module
                                </h3>
                                <div className="flex flex-wrap gap-3">
                                    {selectedModule.evidenceDocuments.map((doc: EvidenceDocument, idx: number) => (
                                        <a
                                            key={`${doc.fileName}-${idx}`}
                                            href={doc.dataUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            download={doc.fileName}
                                            className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100"
                                        >
                                            <FileText className="h-4 w-4 shrink-0" aria-hidden />
                                            {doc.fileName}
                                        </a>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.06)]">
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <div>
                                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-600">
                                        <User className="h-4 w-4 text-blue-600" aria-hidden />
                                        {t('instructor')}
                                    </div>
                                    <p className="font-medium text-slate-900">{course.instructor}</p>
                                </div>
                                <div>
                                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-600">
                                        <Hourglass className="h-4 w-4 text-violet-600" aria-hidden />
                                        Durée estimée
                                    </div>
                                    <p className="font-medium text-slate-900">{course.duration}</p>
                                </div>
                                <div>
                                    <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-600">
                                        <LineChart className="h-4 w-4 text-emerald-600" aria-hidden />
                                        Progression
                                    </div>
                                    <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                                        <div
                                            className="h-3 rounded-full bg-blue-600 transition-all duration-500"
                                            style={{ width: `${course.progress || 0}%` }}
                                        />
                                    </div>
                                    <p className="mt-1 text-xs text-slate-500">
                                        {completedLessonsCount} leçons sur {totalLessons}
                                    </p>
                                </div>
                                <div className="flex items-center md:justify-end">
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="md"
                                        leftIcon={<Timer className="h-4 w-4" aria-hidden />}
                                        onClick={() => setLogTimeModalOpen(true)}
                                        className="!border-2 !border-coya-green !text-coya-green hover:!bg-emerald-50"
                                    >
                                        {t('log_time')}
                                    </Button>
                                </div>
                            </div>

                            {course.requiresFinalValidation && (
                                <div className="mt-4 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                                    <Shield className="mt-0.5 h-5 w-5 shrink-0 text-violet-600" aria-hidden />
                                    <div>
                                        <p className="text-sm font-semibold text-violet-900">Validation finale requise</p>
                                        <p className="text-xs text-violet-800">
                                            Une validation manuelle sera effectuée par un instructeur une fois toutes les leçons
                                            terminées.
                                        </p>
                                    </div>
                                </div>
                            )}

                            {course.youtubeUrl && (
                                <div className="mt-6 border-t border-slate-200 pt-6">
                                    <LinkPreview url={course.youtubeUrl} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {isLogTimeModalOpen && (
                <LogTimeModal
                    onClose={() => setLogTimeModalOpen(false)}
                    onSave={handleSaveTimeLog}
                    projects={projects}
                    courses={[course]}
                    user={user}
                    initialEntity={{ type: 'course', id: course.id }}
                />
            )}
        </div>
    );
};

export default CourseDetail;

