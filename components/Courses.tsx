import React, { useState, useMemo, useEffect } from 'react';
import {
  ArrowDownWideNarrow,
  ArrowUpWideNarrow,
  BookMarked,
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Clock,
  Filter,
  Grid3x3,
  GripHorizontal,
  LayoutList,
  Pencil,
  Search,
  SlidersHorizontal,
  Star,
  User as UserIcon,
  Users,
} from 'lucide-react';
import { useLocalization } from '../contexts/LocalizationContext';
import { NAV_SESSION_COURSES_PROGRAMME_ID } from '../contexts/AppNavigationContext';
import type { Course, User as CoyaUser } from '../types';
import LinkPreview from './common/LinkPreview';

const shellCard =
  'rounded-2xl border border-slate-200/80 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.06)]';

interface CoursesProps {
  onSelectCourse: (id: string) => void;
  courses: Course[];
  users?: CoyaUser[];
  /** Grille intégrée au hub Formation : onglets catégories, badges promo, chrome allégé. */
  formationHubEmbed?: boolean;
  // Module consultatif uniquement - pas de création/édition
}

function coursePromoBadge(course: Course): { label: string; className: string } | null {
  const createdRaw = course.createdAt ? new Date(course.createdAt).getTime() : 0;
  const fortyFiveDays = 45 * 24 * 60 * 60 * 1000;
  if (createdRaw && Date.now() - createdRaw < fortyFiveDays) {
    return { label: 'Nouveau', className: 'bg-blue-600 text-white' };
  }
  if ((course.rating ?? 0) >= 4.5 && (course.studentsCount ?? 0) >= 10) {
    return { label: 'Populaire', className: 'bg-violet-600 text-white' };
  }
  if ((course.rating ?? 0) >= 4.2 && (course.studentsCount ?? 0) < 80) {
    return { label: 'Recommandé', className: 'bg-emerald-600 text-white' };
  }
  return null;
}

const DESIGN_CATEGORY_TABS = [
  'Toutes',
  'Entrepreneuriat',
  'Agriculture',
  'Numérique',
  'Santé',
  'Leadership',
  'Gestion',
];

function levelLabel(level?: Course['level']): string {
  if (level === 'beginner') return 'Débutant';
  if (level === 'intermediate') return 'Intermédiaire';
  if (level === 'advanced') return 'Avancé';
  return 'Tous niveaux';
}

const Courses: React.FC<CoursesProps> = ({ courses, users: _users = [], onSelectCourse, formationHubEmbed = false }) => {
  const { t } = useLocalization();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'title' | 'instructor' | 'rating' | 'students'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'compact'>('grid');
  const [programmeFilterId, setProgrammeFilterId] = useState<string | null>(null);
  const [hubCategoryTab, setHubCategoryTab] = useState<string>('Toutes');

  useEffect(() => {
    try {
      const preset = sessionStorage.getItem(NAV_SESSION_COURSES_PROGRAMME_ID);
      if (preset) setProgrammeFilterId(preset);
    } catch {
      /* ignore */
    }
  }, []);

  // Extraire toutes les catégories uniques
  const categories = useMemo(() => {
    const cats = new Set<string>();
    courses.forEach(course => {
      if (course.category) cats.add(course.category);
    });
    return Array.from(cats).sort();
  }, [courses]);

  const hubCategoryTabs = useMemo(() => {
    const merged = new Set<string>([...DESIGN_CATEGORY_TABS, ...categories]);
    return Array.from(merged);
  }, [categories]);

  // Filtrage et tri des cours
  const filteredCourses = useMemo(() => {
    let filtered = courses.filter(course => {
      // IMPORTANT: Ne montrer que les cours publiés dans le module Courses (consultation)
      // Les cours en brouillon (draft) ou archivés ne doivent pas apparaître
      if (course.status !== 'published') {
        return false;
      }

      // Recherche
      const matchesSearch = searchQuery === '' || 
        course.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        course.instructor.toLowerCase().includes(searchQuery.toLowerCase());

      // Filtre par catégorie
      const matchesCategory = categoryFilter === 'all' || 
        (categoryFilter === 'no_category' && !course.category) ||
        course.category === categoryFilter;

      const matchesHubTab =
        !formationHubEmbed ||
        hubCategoryTab === 'Toutes' ||
        (course.category && course.category.toLowerCase() === hubCategoryTab.toLowerCase());

      // Filtre par niveau
      const matchesLevel = levelFilter === 'all' || course.level === levelFilter;

      const matchesProgramme =
        !programmeFilterId || (course.programmeId && String(course.programmeId) === String(programmeFilterId));

      return matchesSearch && matchesCategory && matchesLevel && matchesProgramme && matchesHubTab;
    });

    // Tri
    filtered.sort((a, b) => {
      let aValue: any, bValue: any;
      if (sortBy === 'date') {
        aValue = new Date(a.createdAt || '').getTime();
        bValue = new Date(b.createdAt || '').getTime();
      } else if (sortBy === 'title') {
        aValue = a.title.toLowerCase();
        bValue = b.title.toLowerCase();
      } else if (sortBy === 'instructor') {
        aValue = a.instructor.toLowerCase();
        bValue = b.instructor.toLowerCase();
      } else if (sortBy === 'rating') {
        aValue = a.rating || 0;
        bValue = b.rating || 0;
      } else if (sortBy === 'students') {
        aValue = a.studentsCount || 0;
        bValue = b.studentsCount || 0;
      }
      
      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    return filtered;
  }, [
    courses,
    searchQuery,
    categoryFilter,
    levelFilter,
    sortBy,
    sortOrder,
    programmeFilterId,
    formationHubEmbed,
    hubCategoryTab,
  ]);

  // Métriques
  const totalCourses = courses.length;
  const publishedCourses = courses.filter(c => c.status === 'published').length;
  const draftCourses = courses.filter(c => c.status === 'draft').length;
  const totalStudents = courses.reduce((sum, c) => sum + (c.studentsCount || 0), 0);

  // Format duration
  const formatDuration = (duration: number | string | undefined): string => {
    if (!duration) return '—';
    if (typeof duration === 'string') return duration;
    const weeks = Math.ceil(duration / 40);
    return `${weeks} sem.`;
  };

  // Format rating
  const formatRating = (rating: number | undefined): string => {
    if (!rating) return '0.0';
    return rating.toFixed(1);
  };

  const hubShell = formationHubEmbed ? 'space-y-5 p-0' : 'p-6 space-y-6';

  return (
      <div className={hubShell}>
        {/* Header — pattern Figma `make figma/src/app/pages/Formations.tsx` */}
        {!formationHubEmbed ? (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-slate-900">{t('courses') || 'Formations'}</h2>
            <p className="mt-1 text-sm text-slate-600">{t('view_all_courses') || 'Catalogue des parcours publiés'}</p>
          </div>
        </div>
        ) : null}

        {formationHubEmbed ? (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
            {hubCategoryTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setHubCategoryTab(tab)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                  hubCategoryTab === tab
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        ) : null}

        {/* KPIs */}
        {!formationHubEmbed ? (
        <div>
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
        ) : null}

        {/* Barre de recherche et filtres */}
        <div>
          {programmeFilterId && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
              <span className="flex items-start gap-2">
                <Filter className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
                {t('courses') || 'Formations'} : affichage filtré par le programme ouvert depuis le module Programme.
              </span>
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
                onClick={() => {
                  setProgrammeFilterId(null);
                  try {
                    sessionStorage.removeItem(NAV_SESSION_COURSES_PROGRAMME_ID);
                  } catch {
                    /* ignore */
                  }
                }}
              >
                Effacer le filtre
              </button>
            </div>
          )}
          <div className={`${shellCard} mb-4 p-4 sm:mb-6`}>
            <div className="flex flex-wrap items-center gap-4">
              {/* Recherche */}
              <div className="flex-1 min-w-[200px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input
                    type="text"
                    placeholder={t('search') || 'Rechercher un cours...'}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 py-2 pl-10 pr-4 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {/* Filtre par catégorie */}
              {categories.length > 0 && !formationHubEmbed && (
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
              {formationHubEmbed && categories.length > 0 ? (
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="all">Toutes les catégories</option>
                  <option value="no_category">Sans catégorie</option>
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              ) : null}

              {/* Filtre par niveau */}
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="all">Tous les niveaux</option>
                <option value="beginner">Débutant</option>
                <option value="intermediate">Intermédiaire</option>
                <option value="advanced">Avancé</option>
              </select>

            {/* Note: Seuls les cours publiés sont affichés */}
            <div className="flex items-center gap-2 px-2 py-2 text-sm text-slate-500">
              <CircleHelp className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
              <span className="italic">Cours publiés uniquement</span>
            </div>

              {/* Tri */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="date">Date</option>
                <option value="title">Titre</option>
                <option value="instructor">Formateur</option>
                <option value="rating">Note</option>
                <option value="students">Apprenants</option>
              </select>

              {/* Ordre de tri */}
              <button
                type="button"
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                title={sortOrder === 'asc' ? 'Ordre croissant' : 'Ordre décroissant'}
              >
                {sortOrder === 'asc' ? (
                  <ArrowUpWideNarrow className="h-4 w-4" aria-hidden />
                ) : (
                  <ArrowDownWideNarrow className="h-4 w-4" aria-hidden />
                )}
                {sortOrder === 'asc' ? '↑' : '↓'}
              </button>

              {/* Sélecteur de vue */}
              {!formationHubEmbed ? (
              <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50/80 p-1">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`rounded-lg p-2 transition-colors ${
                    viewMode === 'grid' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                  title="Vue grille"
                >
                  <Grid3x3 className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`rounded-lg p-2 transition-colors ${
                    viewMode === 'list' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                  title="Vue liste"
                >
                  <LayoutList className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('compact')}
                  className={`rounded-lg p-2 transition-colors ${
                    viewMode === 'compact' ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                  title="Vue compacte"
                >
                  <GripHorizontal className="h-4 w-4" aria-hidden />
                </button>
              </div>
              ) : (
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50"
                  aria-label="Filtres"
                >
                  <SlidersHorizontal className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>

            {/* Compteur de résultats */}
            <div className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
              {filteredCourses.length} {filteredCourses.length > 1 ? 'cours trouvés' : 'cours trouvé'}
              {searchQuery && (
                <span className="ml-2 font-medium text-blue-600">
                  pour « {searchQuery} »
                </span>
              )}
            </div>
          </div>

          {/* Liste des cours selon le mode de vue */}
          {filteredCourses.length === 0 ? (
            <div className={`${shellCard} p-12 text-center`}>
              <BookMarked className="mx-auto mb-4 h-14 w-14 text-slate-300" aria-hidden />
              <p className="mb-2 text-lg text-slate-600">
                {searchQuery || categoryFilter !== 'all' || levelFilter !== 'all' ? 
                'Aucun cours publié ne correspond aux critères' : 
                t('no_courses_found') || 'Aucun cours publié disponible'}
            </p>
            </div>
          ) : (
            <div className={
              viewMode === 'grid' ? 
                formationHubEmbed
                  ? 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
                  : 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6'
                : viewMode === 'compact' ?
                `${shellCard} overflow-hidden` :
                'space-y-6'
            }>
              {filteredCourses.map(course => {
                const promo = formationHubEmbed ? coursePromoBadge(course) : null;
                return viewMode === 'grid' ? (
                  <div
                    key={course.id}
                    onClick={() => onSelectCourse(course.id)}
                    className={
                      formationHubEmbed
                        ? `cursor-pointer overflow-hidden ${shellCard} transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(15,23,42,0.08)]`
                        : `cursor-pointer overflow-hidden ${shellCard} transition-all hover:shadow-[0_12px_40px_rgba(15,23,42,0.08)]`
                    }
                  >
                    {course.thumbnailUrl ? (
                      <div className="relative h-40 bg-cover bg-center" style={{ backgroundImage: `url(${course.thumbnailUrl})` }}>
                        {promo ? (
                          <span
                            className={`absolute left-3 top-3 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide ${promo.className}`}
                          >
                            {promo.label}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <div className="relative flex h-40 items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200/80">
                        {promo ? (
                          <span
                            className={`absolute left-3 top-3 rounded-md px-2 py-0.5 text-[10px] font-bold tracking-wide ${promo.className}`}
                          >
                            {promo.label}
                          </span>
                        ) : null}
                        <BookOpen className="h-16 w-16 text-slate-400" aria-hidden />
                      </div>
                    )}
                    <div className="p-5">
                    <h3 className="mb-2 line-clamp-2 text-lg font-bold text-slate-900">{course.title}</h3>
                      <p className="mb-2 line-clamp-2 text-sm text-slate-600">{course.description}</p>
                      {formationHubEmbed ? (
                        <p className="mb-2 text-xs font-medium text-slate-500">
                          {levelLabel(course.level)} ·{' '}
                          {(() => {
                            const n = course.modules?.length ?? course.lessonsCount ?? 0;
                            return n > 0 ? `${n} module${n > 1 ? 's' : ''}` : 'Parcours modulaire';
                          })()}
                        </p>
                      ) : null}
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1"><UserIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />{course.instructor}</span>
                        <span className="text-slate-300">•</span>
                        <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5 shrink-0" aria-hidden />{formatDuration(course.duration)}</span>
                        {course.level && (
                          <>
                            <span>•</span>
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              course.level === 'beginner' ? 'bg-sky-100 text-sky-800' :
                              course.level === 'intermediate' ? 'bg-amber-100 text-amber-900' :
                              'bg-emerald-100 text-emerald-800'
                            }`}>
                              {course.level === 'beginner' ? 'Débutant' : course.level === 'intermediate' ? 'Intermédiaire' : 'Avancé'}
                            </span>
                          </>
                        )}
                      </div>
                      {course.category && (
                        <span className="mb-2 inline-block rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700">
                          {course.category}
                        </span>
                      )}
                      {/* Aperçus de liens */}
                      {(course.youtubeUrl || course.driveUrl) && (
                        <div className="mt-3 space-y-2">
                          {course.youtubeUrl && (
                            <LinkPreview url={course.youtubeUrl} type="youtube" className="text-xs" />
                          )}
                          {course.driveUrl && (
                            <LinkPreview url={course.driveUrl} type="drive" className="text-xs" />
                          )}
                        </div>
                      )}
                      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                        <div className="flex items-center gap-3 text-sm text-slate-600">
                          {course.rating && course.rating > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                              {formatRating(course.rating)}
                            </span>
                          )}
                          {course.studentsCount && course.studentsCount > 0 && (
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-4 w-4 text-slate-400" aria-hidden />
                              {course.studentsCount}
                            </span>
                          )}
                        </div>
                        {course.status && !formationHubEmbed ? (
                          <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            course.status === 'published' ? 'bg-emerald-100 text-emerald-800' :
                            course.status === 'draft' ? 'bg-slate-100 text-slate-700' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {course.status === 'published' ? 'Publié' : course.status === 'draft' ? 'Brouillon' : 'Archivé'}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : viewMode === 'compact' ? (
                  <div
                    key={course.id}
                    className="cursor-pointer border-b border-slate-100 transition-colors hover:bg-slate-50/80"
                    onClick={() => onSelectCourse(course.id)}
                  >
                    <div className="px-6 py-4 flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <h3 className="truncate text-sm font-semibold text-slate-900">{course.title}</h3>
                          {course.category && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                              {course.category}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {course.instructor} • {formatDuration(course.duration)} • {course.studentsCount || 0} apprenants
                        </p>
                      </div>
                    </div>
        </div>
      ) : (
                  <div
                    key={course.id}
                    onClick={() => onSelectCourse(course.id)}
                    className={`cursor-pointer p-6 ${shellCard} transition-all hover:shadow-[0_12px_40px_rgba(15,23,42,0.08)]`}
                  >
                    <div className="flex items-start gap-5">
                      {course.thumbnailUrl ? (
                        <div className="h-32 w-32 shrink-0 rounded-xl bg-cover bg-center" style={{ backgroundImage: `url(${course.thumbnailUrl})` }}></div>
                      ) : (
                        <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-100 to-slate-200/80">
                          <BookOpen className="h-10 w-10 text-slate-400" aria-hidden />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="mb-2 flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="mb-1 text-xl font-bold text-slate-900">{course.title}</h3>
                            <p className="mb-3 text-sm text-slate-600">{course.description}</p>
                          </div>
                        </div>
                        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
                          <span className="inline-flex items-center gap-2">
                            <UserIcon className="h-4 w-4 text-slate-400" aria-hidden />
                            {course.instructor}
                          </span>
                          <span className="inline-flex items-center gap-2">
                            <Clock className="h-4 w-4 text-slate-400" aria-hidden />
                            {formatDuration(course.duration)}
                          </span>
                          {course.level && (
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${
                              course.level === 'beginner' ? 'bg-sky-100 text-sky-800' :
                              course.level === 'intermediate' ? 'bg-amber-100 text-amber-900' :
                              'bg-emerald-100 text-emerald-800'
                            }`}>
                              {course.level === 'beginner' ? 'Débutant' : course.level === 'intermediate' ? 'Intermédiaire' : 'Avancé'}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          {course.category && (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                              {course.category}
                            </span>
                          )}
                          {course.rating && course.rating > 0 && (
                            <span className="inline-flex items-center gap-1 text-sm">
                              <Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />
                              {formatRating(course.rating)}
                            </span>
                          )}
                          {course.studentsCount && course.studentsCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-sm text-slate-600">
                              <Users className="h-4 w-4 text-slate-400" aria-hidden />
                              {course.studentsCount} apprenant{course.studentsCount > 1 ? 's' : ''}
                            </span>
                          )}
                          {course.status && (
                            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
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
                  </div>
                );
              })}
        </div>
      )}
        </div>
    </div>
  );
};

export default Courses;

