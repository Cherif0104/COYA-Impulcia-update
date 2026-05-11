import React, { useState, useMemo } from 'react';
import {
  BookMarked,
  BookOpen,
  CheckCircle2,
  Database,
  Pencil,
  Plus,
  Search,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Users,
} from 'lucide-react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { Course, User } from '../types';
import ConfirmationModal from './common/ConfirmationModal';
import CourseCreatePage from './CourseCreatePage';
import AccessDenied from './common/AccessDenied';
import { Button } from './ui/Button';

const shellCard =
  'rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]';

interface CourseManagementProps {
    courses: Course[];
    users: User[];
    onAddCourse: (courseData: Omit<Course, 'id' | 'progress'>) => void;
    onUpdateCourse: (course: Course) => void;
    onDeleteCourse: (courseId: string) => void;
    /** Dans Paramètres : pas de plein écran ni header gradient (aligné design admin). */
    embedded?: boolean;
    isLoading?: boolean;
    loadingOperation?: string | null;
    /** Ouvre CRM → Collecte avec le cours présélectionné (campagne formation). */
    onOpenCrmCollecteForCourse?: (courseId: string) => void;
}

const CourseManagement: React.FC<CourseManagementProps> = ({
    courses,
    users,
    onAddCourse,
    onUpdateCourse,
    onDeleteCourse,
    embedded = false,
    onOpenCrmCollecteForCourse,
}) => {
    const { t } = useLocalization();
    const { canAccessModule, hasPermission } = useModulePermissions();
    const [showCourseForm, setShowCourseForm] = useState(false);
    const [editingCourse, setEditingCourse] = useState<Course | null>(null);
    const [deletingCourseId, setDeletingCourseId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [statusFilter, setStatusFilter] = useState<string>('all');

    const canReadModule = canAccessModule('course_management');
    const canWriteModule = hasPermission('course_management', 'write');
    const canDeleteModule = hasPermission('course_management', 'delete');

    // Extraire toutes les catégories uniques
    const categories = useMemo(() => {
        const cats = new Set<string>();
        courses.forEach(course => {
            if (course.category) cats.add(course.category);
        });
        return Array.from(cats).sort();
    }, [courses]);

    // Filtrage des cours
    const filteredCourses = useMemo(() => {
        return courses.filter(course => {
            const matchesSearch = searchQuery === '' || 
                course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                course.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                course.instructor.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesCategory = categoryFilter === 'all' || 
                (categoryFilter === 'no_category' && !course.category) ||
                course.category === categoryFilter;

            const matchesStatus = statusFilter === 'all' || course.status === statusFilter;

            return matchesSearch && matchesCategory && matchesStatus;
        });
    }, [courses, searchQuery, categoryFilter, statusFilter]);

    // Métriques
    const totalCourses = courses.length;
    const publishedCourses = courses.filter(c => c.status === 'published').length;
    const draftCourses = courses.filter(c => c.status === 'draft').length;
    const totalStudents = courses.reduce((sum, c) => sum + (c.studentsCount || 0), 0);

    const handleOpenForm = (course: Course | null = null) => {
        if (!canWriteModule) return;
        setEditingCourse(course);
        setShowCourseForm(true);
    };

    const handleCloseForm = () => {
        setShowCourseForm(false);
        setEditingCourse(null);
    };

    const handleSaveCourse = (courseData: Course | Omit<Course, 'id' | 'progress'>) => {
        if (!canWriteModule) return;
        if ('id' in courseData) {
            onUpdateCourse(courseData);
        } else {
            onAddCourse(courseData);
        }
        setShowCourseForm(false);
        setEditingCourse(null);
    };
    
    const handleDelete = (courseId: string) => {
        if (!canDeleteModule) return;
        onDeleteCourse(courseId);
        setDeletingCourseId(null);
    };

    if (!canReadModule) {
        return <AccessDenied description="Vous n’avez pas les permissions nécessaires pour gérer les cours. Veuillez contacter votre administrateur." />;
    }

    // Afficher la page de création/édition si active
    if (showCourseForm) {
        return (
            <CourseCreatePage
                editingCourse={editingCourse}
                users={users}
                onClose={handleCloseForm}
                onSave={handleSaveCourse}
            />
        );
    }

    const metricsGrid = embedded ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase text-slate-500">Total</p>
                <p className="text-2xl font-bold text-slate-900">{totalCourses}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase text-slate-500">Publiés</p>
                <p className="text-2xl font-bold text-slate-900">{publishedCourses}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase text-slate-500">Brouillons</p>
                <p className="text-2xl font-bold text-slate-900">{draftCourses}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase text-slate-500">Apprenants</p>
                <p className="text-2xl font-bold text-slate-900">{totalStudents}</p>
            </div>
        </div>
    ) : (
        <div className="mx-auto -mt-6 mb-8 max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className={`${shellCard} p-5`}>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total cours</span>
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                            <BookOpen className="h-5 w-5" aria-hidden />
                        </span>
                    </div>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{totalCourses}</p>
                </div>
                <div className={`${shellCard} p-5`}>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Publiés</span>
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                            <CheckCircle2 className="h-5 w-5" aria-hidden />
                        </span>
                    </div>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{publishedCourses}</p>
                </div>
                <div className={`${shellCard} p-5`}>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Brouillons</span>
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
                            <Pencil className="h-5 w-5" aria-hidden />
                        </span>
                    </div>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{draftCourses}</p>
                </div>
                <div className={`${shellCard} p-5`}>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Apprenants (cumul)</span>
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-50 text-violet-600">
                            <Users className="h-5 w-5" aria-hidden />
                        </span>
                    </div>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{totalStudents}</p>
                </div>
            </div>
        </div>
    );

    return (
        <div className={embedded ? 'space-y-4' : 'min-h-screen bg-slate-50'}>
            {embedded ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-slate-600">
                        Créez, modifiez et gérez le catalogue de formations pour votre organisation.
                    </p>
                    <Button
                        type="button"
                        variant="primary"
                        size="md"
                        leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                        onClick={() => handleOpenForm(null)}
                        disabled={!canWriteModule}
                        className="whitespace-nowrap"
                    >
                        Nouveau cours
                    </Button>
                </div>
            ) : (
                <div className="border-b border-slate-200 bg-white">
                    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:px-6 sm:flex-row sm:items-center sm:justify-between lg:px-8">
                        <div className="min-w-0">
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Studio</p>
                            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                                {t('course_management') || 'Gestion des formations'}
                            </h1>
                            <p className="mt-1 text-sm text-slate-600">Créez, modifiez et publiez le catalogue pour votre organisation.</p>
                        </div>
                        <Button
                            type="button"
                            variant="primary"
                            size="md"
                            leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                            onClick={() => handleOpenForm(null)}
                            disabled={!canWriteModule}
                            className="shrink-0"
                        >
                            Nouveau cours
                        </Button>
                    </div>
                </div>
            )}

            {metricsGrid}

            {/* Barre de recherche et filtres */}
            <div className={embedded ? 'pb-0' : 'mx-auto max-w-7xl px-4 pb-8 sm:px-6 lg:px-8'}>
                <div className={`${shellCard} mb-6 p-4`}>
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="min-w-[200px] flex-1">
                            <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                <input
                                    type="text"
                                    placeholder="Rechercher un cours…"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full rounded-xl border border-slate-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                />
                            </div>
                        </div>

                        {categories.length > 0 && (
                            <select
                                value={categoryFilter}
                                onChange={(e) => setCategoryFilter(e.target.value)}
                                className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                            >
                                <option value="all">Toutes les catégories</option>
                                <option value="no_category">Sans catégorie</option>
                                {categories.map(cat => (
                                    <option key={cat} value={cat}>{cat}</option>
                                ))}
                            </select>
                        )}

                        <select
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value)}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        >
                            <option value="all">Tous les statuts</option>
                            <option value="published">Publié</option>
                            <option value="draft">Brouillon</option>
                            <option value="archived">Archivé</option>
                        </select>
                    </div>

                    <div className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
                        {filteredCourses.length} {filteredCourses.length > 1 ? 'cours trouvés' : 'cours trouvé'}
                        {searchQuery && (
                            <span className="ml-2 font-medium text-blue-600">pour « {searchQuery} »</span>
                        )}
                    </div>
                </div>

                {filteredCourses.length === 0 ? (
                    <div className={`${shellCard} p-12 text-center`}>
                        <BookMarked className="mx-auto mb-4 h-14 w-14 text-slate-300" aria-hidden />
                        <p className="mb-2 text-lg text-slate-600">
                            {searchQuery || categoryFilter !== 'all' || statusFilter !== 'all' ? 
                                'Aucun cours ne correspond aux critères' : 
                                'Aucun cours'}
                        </p>
                        <Button
                            type="button"
                            variant="primary"
                            size="md"
                            className="mt-4"
                            leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                            onClick={() => handleOpenForm(null)}
                            disabled={!canWriteModule}
                        >
                            Créer le premier cours
                        </Button>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {filteredCourses.map(course => (
                            <div key={course.id} className={`${shellCard} p-6 transition-shadow hover:shadow-[0_12px_40px_rgba(15,23,42,0.08)]`}>
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="flex min-w-0 flex-1 items-start gap-4">
                                        {course.thumbnailUrl ? (
                                            <div
                                                className="h-24 w-24 shrink-0 rounded-xl bg-cover bg-center"
                                                style={{ backgroundImage: `url(${course.thumbnailUrl})` }}
                                                role="img"
                                                aria-hidden
                                            />
                                        ) : (
                                            <div className="flex shrink-0 items-center justify-center rounded-xl bg-slate-100 p-4 text-slate-600">
                                                <BookOpen className="h-8 w-8" aria-hidden />
                                            </div>
                                        )}
                                        <div className="min-w-0 flex-1">
                                            <h3 className="text-lg font-bold text-slate-900">{course.title}</h3>
                                            <p className="mt-1 text-sm text-slate-500">{course.instructor}</p>
                                            {course.description && (
                                                <p className="mt-2 line-clamp-2 text-sm text-slate-600">{course.description}</p>
                                            )}
                                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                                {course.category && (
                                                    <span className="inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                                                        {course.category}
                                                    </span>
                                                )}
                                                {course.level && (
                                                    <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${
                                                        course.level === 'beginner' ? 'bg-sky-100 text-sky-800' :
                                                        course.level === 'intermediate' ? 'bg-amber-100 text-amber-900' :
                                                        'bg-emerald-100 text-emerald-800'
                                                    }`}>
                                                        {course.level === 'beginner' ? 'Débutant' : course.level === 'intermediate' ? 'Intermédiaire' : 'Avancé'}
                                                    </span>
                                                )}
                                                {course.status && (
                                                    <span className={`inline-block rounded-full px-2 py-1 text-xs font-semibold ${
                                                        course.status === 'published' ? 'bg-emerald-100 text-emerald-800' :
                                                        course.status === 'draft' ? 'bg-slate-100 text-slate-700' :
                                                        'bg-red-100 text-red-800'
                                                    }`}>
                                                        {course.status === 'published' ? 'Publié' : course.status === 'draft' ? 'Brouillon' : 'Archivé'}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-1 sm:ml-2">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                const newStatus = course.status === 'published' ? 'draft' : 'published';
                                                try {
                                                    await onUpdateCourse({
                                                        ...course,
                                                        status: newStatus as 'draft' | 'published' | 'archived',
                                                    });
                                                } catch (error: unknown) {
                                                    const err = error as { code?: string };
                                                    if (err?.code === '23514') {
                                                        alert(
                                                            `Erreur : le statut « ${newStatus} » n'est pas autorisé. Statuts valides : published, draft, archived`,
                                                        );
                                                    } else {
                                                        alert('Erreur lors de la mise à jour du statut du cours');
                                                    }
                                                }
                                            }}
                                            className={`rounded-xl p-2 transition-colors ${
                                                course.status === 'published' 
                                                    ? 'text-emerald-600 hover:bg-emerald-50' 
                                                    : 'text-slate-400 hover:bg-slate-100'
                                            }`}
                                            title={course.status === 'published' ? 'Désactiver le cours (passer en brouillon)' : 'Activer le cours (publier)'}
                                        >
                                            {course.status === 'published' ? (
                                                <ToggleRight className="h-6 w-6" aria-hidden />
                                            ) : (
                                                <ToggleLeft className="h-6 w-6" aria-hidden />
                                            )}
                                        </button>
                                        <button 
                                            type="button"
                                            onClick={() => handleOpenForm(course)} 
                                            className="rounded-xl p-2 text-blue-600 transition-colors hover:bg-blue-50"
                                            title="Modifier"
                                        >
                                            <Pencil className="h-5 w-5" aria-hidden />
                                        </button>
                                        {onOpenCrmCollecteForCourse && (
                                            <button
                                                type="button"
                                                onClick={() => onOpenCrmCollecteForCourse(course.id)}
                                                className="rounded-xl p-2 text-emerald-700 transition-colors hover:bg-emerald-50"
                                                title="Collecte / CRM — rattacher une campagne à ce cours"
                                            >
                                                <Database className="h-5 w-5" aria-hidden />
                                            </button>
                                        )}
                                        {canDeleteModule && (
                                            <button
                                                type="button"
                                                onClick={() => setDeletingCourseId(course.id)}
                                                className="rounded-xl p-2 text-red-600 transition-colors hover:bg-red-50"
                                                title="Supprimer"
                                            >
                                                <Trash2 className="h-5 w-5" aria-hidden />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal de confirmation de suppression */}
            {deletingCourseId !== null && (
                <ConfirmationModal 
                    title="Supprimer le cours"
                    message="Êtes-vous sûr de vouloir supprimer ce cours ? Cette action est irréversible."
                    onConfirm={() => handleDelete(deletingCourseId)}
                    onCancel={() => setDeletingCourseId(null)}
                />
            )}
        </div>
    );
};

export default CourseManagement;

