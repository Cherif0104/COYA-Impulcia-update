import React, { useState, useMemo } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import { useModulePermissions } from '../hooks/useModulePermissions';
import { Job, User, Language } from '../types';
import ModuleRichHub from './common/ModuleRichHub';

const CircularProgress: React.FC<{ score: number }> = ({ score }) => {
  const radius = 22;
  const circumference = 2 * Math.PI * radius;
  // Clamp score to be between 0 and 100
  const clampedScore = Math.max(0, Math.min(score, 100));
  const offset = circumference - (clampedScore / 100) * circumference;

  return (
    <div className="relative w-16 h-16">
      <svg className="w-full h-full" viewBox="0 0 50 50">
        <circle
          className="text-gray-200"
          strokeWidth="4"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="25"
          cy="25"
        />
        <circle
          className="text-emerald-500 transition-all duration-500 ease-in-out"
          strokeWidth="4"
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx="25"
          cy="25"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 25 25)"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-emerald-600">
        {Math.round(score)}%
      </span>
    </div>
  );
};


const ApplicantsModal: React.FC<{ job: Job; onClose: () => void }> = ({ job, onClose }) => {
  const { t } = useLocalization();
  
  const calculateMatchScore = (applicantSkills: string[]) => {
    const jobSkills = new Set(job.requiredSkills.map(s => s.toLowerCase()));
    if (jobSkills.size === 0) return 100; // If no skills required, everyone is a match
    const applicantSkillSet = new Set(applicantSkills.map(s => s.toLowerCase()));
    let commonSkills = 0;
    for (const skill of applicantSkillSet) {
        if (jobSkills.has(skill)) {
            commonSkills++;
        }
    }
    return (commonSkills / jobSkills.size) * 100;
  };

  const sortedApplicants = [...job.applicants].sort((a, b) => calculateMatchScore(b.skills) - calculateMatchScore(a.skills));
  const jobSkillsLower = new Set(job.requiredSkills.map(s => s.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">{t('applicants')} for {job.title}</h2>
        </div>
        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {sortedApplicants.length > 0 ? (
            <ul className="space-y-4">
              {sortedApplicants.map((applicant, index) => {
                const score = calculateMatchScore(applicant.skills);
                const isTopCandidate = index === 0 && score >= 50;
                return (
                    <li key={applicant.id} className={`p-4 rounded-lg border flex items-center space-x-4 relative overflow-hidden transition-all ${isTopCandidate ? 'border-emerald-500 bg-emerald-50 shadow-md' : 'border-gray-200'}`}>
                        {isTopCandidate && (
                            <div className="absolute top-0 left-0">
                                <div className="flex items-center space-x-1.5 px-3 py-1 bg-emerald-500 text-white text-xs font-bold rounded-br-lg shadow">
                                    <i className="fas fa-star text-yellow-300"></i>
                                    <span>{t('top_candidate')}</span>
                                </div>
                            </div>
                        )}
                        <img src={applicant.avatar} alt={applicant.name} className="w-16 h-16 rounded-full"/>
                        <div className="flex-grow">
                            <p className="font-bold text-lg text-gray-800">{applicant.name}</p>
                            <p className="text-sm text-gray-500">{applicant.email}</p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                                {applicant.skills.map(skill => (
                                    <span key={skill} className={`text-xs px-2 py-1 rounded-full ${jobSkillsLower.has(skill.toLowerCase()) ? 'bg-emerald-100 text-emerald-800 font-semibold' : 'bg-gray-100 text-gray-700'}`}>
                                        {skill}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div className="text-center flex-shrink-0 flex flex-col items-center">
                           <CircularProgress score={score} />
                           <p className="text-xs text-gray-500 mt-1">{t('ai_smart_match')}</p>
                        </div>
                    </li>
                );
            })}
            </ul>
          ) : (
            <p className="text-gray-500 text-center py-8">{t('no_applicants')}</p>
          )}
        </div>
        <div className="p-4 bg-gray-50 border-t flex justify-end">
          <button onClick={onClose} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300">Close</button>
        </div>
      </div>
    </div>
  );
};


const JobRow: React.FC<{ job: Job, onApply: (jobId: number, source: 'online' | 'email' | 'link') => void, onShowApplicants: (job: Job) => void, currentUser: User, canManageJobs?: boolean }> = ({ job, onApply, onShowApplicants, currentUser, canManageJobs }) => {
  const { t } = useLocalization();
  const hasApplied = job.applicants.some(app => app.id === currentUser.id);
  const showApplicants = Boolean(canManageJobs) || currentUser.role === 'employer' || currentUser.role === 'administrator' || currentUser.role === 'super_administrator';

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="flex flex-col lg:flex-row lg:items-start gap-6">
        {/* Contenu principal */}
        <div className="flex-grow">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-xl font-bold text-emerald-700 mb-1">{job.title}</h3>
              <p className="text-lg text-gray-800 font-medium">{job.company}</p>
            </div>
            {/* Badges */}
            <div className="flex flex-wrap gap-2">
              {job.sector && (
                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">
                  {job.sector}
                </span>
              )}
              {job.experienceLevel && (
                <span className="px-3 py-1 bg-purple-100 text-purple-800 text-xs font-semibold rounded-full">
                  {job.experienceLevel}
                </span>
              )}
              {job.remoteWork && (
                <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                  job.remoteWork === 'Remote' ? 'bg-green-100 text-green-800' :
                  job.remoteWork === 'Hybrid' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  <i className="fas fa-laptop-house mr-1"></i>
                  {job.remoteWork === 'Remote' ? 'Télétravail' : job.remoteWork === 'Hybrid' ? 'Hybride' : 'Sur site'}
                </span>
              )}
            </div>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-600 mb-4 line-clamp-2">{job.description}</p>

          {/* Compétences requises */}
          {job.requiredSkills && job.requiredSkills.length > 0 && (
            <div className="mb-4">
              <p className="text-xs font-semibold text-gray-700 mb-2">Compétences requises :</p>
              <div className="flex flex-wrap gap-2">
                {job.requiredSkills.map((skill, index) => (
                  <span key={index} className="px-2 py-1 bg-emerald-50 text-emerald-700 text-xs rounded border border-emerald-200">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Informations supplémentaires */}
          <div className="flex flex-wrap gap-4 text-sm text-gray-600">
            <div className="flex items-center">
              <i className="fas fa-map-marker-alt mr-2 text-gray-400"></i>
              <span>{job.location}</span>
            </div>
            <div className="flex items-center">
              <i className="fas fa-briefcase mr-2 text-gray-400"></i>
              <span>{job.type}</span>
            </div>
            <div className="flex items-center">
              <i className="far fa-calendar-alt mr-2 text-gray-400"></i>
              <span>{job.postedDate}</span>
            </div>
            {job.education && (
              <div className="flex items-center">
                <i className="fas fa-graduation-cap mr-2 text-gray-400"></i>
                <span>{job.education}</span>
              </div>
            )}
            {job.salary && (
              <div className="flex items-center">
                <i className="fas fa-money-bill-wave mr-2 text-gray-400"></i>
                <span className="font-semibold text-emerald-600">{job.salary}</span>
              </div>
            )}
          </div>

          {/* Langues et Avantages */}
          {(job.languages || job.benefits) && (
            <div className="mt-4 pt-4 border-t border-gray-200 text-xs text-gray-600">
              {job.languages && (
                <p className="mb-1"><b>Langues :</b> {job.languages}</p>
              )}
              {job.benefits && (
                <p><b>Avantages :</b> {job.benefits}</p>
              )}
      </div>
          )}
      </div>

        {/* Actions */}
        <div className="flex flex-col gap-3 lg:min-w-[200px]">
        {showApplicants ? (
            <button type="button" onClick={() => onShowApplicants(job)} className="btn-3d-secondary">
              <i className="fas fa-users mr-2"></i>
              Voir candidats ({job.applicants?.length ?? 0})
            </button>
        ) : (
          <button type="button" onClick={() => onApply(job.id, 'online')} disabled={hasApplied} className="btn-3d-primary disabled:opacity-50 disabled:cursor-not-allowed">
            <i className={`fas ${hasApplied ? 'fa-check' : 'fa-paper-plane'} mr-2`}></i>
            {hasApplied ? t('applied') : t('apply_now')}
          </button>
        )}

          {/* Liens de candidature externes */}
          {!hasApplied && (job.applicationLink || job.applicationEmail) && (
            <div className="flex flex-col gap-2 pt-2 border-t border-gray-200">
              {job.applicationLink && (
                <a
                  href={job.applicationLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => onApply(job.id, 'link')}
                  className="bg-white border-2 border-emerald-600 text-emerald-600 px-6 py-3 rounded-lg font-semibold hover:bg-emerald-50 transition-colors text-center"
                >
                  <i className="fas fa-external-link-alt mr-2"></i>
                  Postuler en ligne
                </a>
              )}
              {job.applicationEmail && (
                <a
                  href={`mailto:${job.applicationEmail}?subject=Candidature: ${job.title}`}
                  onClick={() => onApply(job.id, 'email')}
                  className="bg-white border-2 border-gray-300 text-gray-700 px-6 py-3 rounded-lg font-semibold hover:border-gray-400 hover:bg-gray-50 transition-colors text-center"
                >
                  <i className="fas fa-envelope mr-2"></i>
                  Envoyer un email
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface JobsProps {
    jobs: Job[];
    setJobs: React.Dispatch<React.SetStateAction<Job[]>>;
    setView: (view: string) => void;
}

const Jobs: React.FC<JobsProps> = ({ jobs, setJobs, setView }) => {
  const { t, language } = useLocalization();
  const isFr = language === Language.FR;
  const { user } = useAuth();
  const { canAccessModule, hasPermission } = useModulePermissions();
  const canManageJobs = useMemo(() => {
    try {
      return Boolean(canAccessModule && hasPermission && canAccessModule('job_management') && hasPermission('job_management', 'write'));
    } catch {
      return false;
    }
  }, [canAccessModule, hasPermission]);
  const [modalJob, setModalJob] = useState<Job | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // Fonction pour tracker une candidature avec source
  const trackJobApplication = async (jobId: number, user: User, source: 'online' | 'email' | 'link') => {
    try {
      // Enregistrer dans Supabase
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/job_applications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Prefer': 'return=representation',
        },
        body: JSON.stringify({
          job_id: jobId,
          user_id: user.profileId || user.id.toString(),
          source: source,
          applied_at: new Date().toISOString(),
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.warn('⚠️ Erreur enregistrement candidature (continue quand même):', error);
        return false;
      } else {
        console.log('✅ Candidature trackée avec source:', source);
        return true;
      }
    } catch (error) {
      console.warn('⚠️ Erreur tracking candidature (continue quand même):', error);
      return false;
    }
  };

  const handleApply = async (jobId: number, source: 'online' | 'email' | 'link' = 'online') => {
    if(!user) return;
    
    try {
      // Tracker la candidature avec source
      await trackJobApplication(jobId, user, source);
      
      // Mettre à jour l'état local
      setJobs(prevJobs => prevJobs.map(job => {
        if (job.id === jobId && !job.applicants.some(app => app.id === user.id)) {
          const currentStats = job.applicationStats || {
            total: job.applicants.length || 0,
            bySource: { online: 0, email: 0, link: 0, direct: 0 }
          };
          
          return {
            ...job,
            applicants: [...job.applicants, user],
            // Mettre à jour les stats
            applicationStats: {
              total: currentStats.total + 1,
              bySource: {
                online: source === 'online' ? currentStats.bySource.online + 1 : currentStats.bySource.online,
                email: source === 'email' ? currentStats.bySource.email + 1 : currentStats.bySource.email,
                link: source === 'link' ? currentStats.bySource.link + 1 : currentStats.bySource.link,
                direct: currentStats.bySource.direct,
              }
            }
          };
        }
        return job;
      }));
    } catch (error) {
      console.error('Erreur lors du tracking de candidature:', error);
      // Continuer quand même avec la mise à jour locale
      setJobs(prevJobs => prevJobs.map(job => 
        job.id === jobId && !job.applicants.some(app => app.id === user.id) 
        ? { ...job, applicants: [...job.applicants, user] }
        : job
      ));
    }
  };

  const handleShowApplicants = (job: Job) => {
    setModalJob(job);
  };
  
  if (!user) return null;

  const isPrivilegedUser = Boolean(canManageJobs) || user.role === 'employer' || user.role === 'administrator' || user.role === 'super_administrator';

  // Extraire toutes les localisations uniques
  const locations = [...new Set(jobs.map(job => job.location).filter(Boolean))].sort();

  // Filtrer les jobs publiés uniquement
  const filteredJobs = jobs.filter(job => {
    // IMPORTANT: Ne montrer que les jobs publiés
    if (!job.status || job.status !== 'published') {
      return false;
    }

    const matchesSearch = searchQuery === '' || 
      job.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.company.toLowerCase().includes(searchQuery.toLowerCase()) ||
      job.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesLocation = locationFilter === 'all' || job.location === locationFilter;
    const matchesType = typeFilter === 'all' || job.type === typeFilter;

    return matchesSearch && matchesLocation && matchesType;
  });

  // Métriques
  const totalJobs = jobs.filter(j => j.status === 'published').length;
  const totalApplicants = jobs.reduce((sum, job) => sum + (job.applicants?.length || 0), 0);
  const openJobs = jobs.filter(j => j.status === 'published' && j.applicants?.length === 0).length;

  return (
    <div className="p-6 space-y-6 text-gray-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isPrivilegedUser ? (t('job_openings') || 'Offres d\'emploi') : t('job_openings')}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {isPrivilegedUser ? 'Gérez vos offres et candidatures.' : 'Consultez les opportunités et postulez.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {Boolean(canManageJobs) && (
            <button
              type="button"
              onClick={() => setView('job_management')}
              className="btn-3d-secondary"
            >
              <i className="fas fa-cog mr-2" />
              {t('job_management') || 'Gestion des offres'}
            </button>
          )}
          {isPrivilegedUser && (
            <button
              type="button"
              onClick={() => setView('create_job')}
              className="btn-3d-primary"
            >
              <i className="fas fa-plus mr-2" />
              {t('create_job') || 'Nouvelle offre'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Offres actives</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totalJobs}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Candidats total</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{totalApplicants}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Offres sans candidature</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{openJobs}</p>
        </div>
      </div>

      <ModuleRichHub
        isFr={isFr}
        sections={[
          {
            key: 'flow',
            titleFr: 'Parcours recrutement dans COYA',
            titleEn: 'Recruitment journey in COYA',
            icon: 'fas fa-route',
            bulletsFr: [
              'Publication des offres (statut « publié ») et visibilité côté candidats.',
              'Gestion des offres : module dédié pour créer, modifier, archiver.',
              'CRM : transformer les leads en contacts après campagnes Collecte ou sourcing.',
              'RH & Trinité : suivi des collaborateurs et scoring périodique.',
            ],
            bulletsEn: [
              'Job postings (published status) and candidate-facing list.',
              'Job management module to create, edit and archive postings.',
              'CRM: turn leads into contacts after Collecte campaigns or sourcing.',
              'HR & Trinité: workforce tracking and periodic scoring.',
            ],
          },
        ]}
      />

      <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-[200px]">
              <div className="relative">
                <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                <input
                  type="text"
                  placeholder="Rechercher un emploi..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                />
              </div>
            </div>

            {locations.length > 0 && (
              <select
                value={locationFilter}
                onChange={(e) => setLocationFilter(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
              >
                <option value="all">Toutes les localisations</option>
                {locations.map(location => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </select>
            )}

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
            >
              <option value="all">Tous les types</option>
              <option value="Full-time">Temps plein</option>
              <option value="Part-time">Temps partiel</option>
              <option value="Contract">Contrat</option>
            </select>

            {/* Note: Seuls les jobs publiés sont affichés */}
            <div className="px-4 py-2 text-sm text-gray-500 italic">
              <i className="fas fa-info-circle mr-2"></i>
              Offres publiées uniquement
            </div>
          </div>

          {/* Compteur de résultats */}
          <div className="mt-3 pt-3 border-t border-gray-200 text-sm text-gray-600">
            {filteredJobs.length} {filteredJobs.length > 1 ? 'offres trouvées' : 'offre trouvée'}
            {searchQuery && (
              <span className="ml-2 text-emerald-600">
                pour "{searchQuery}"
              </span>
            )}
          </div>
      </div>

      {filteredJobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <i className="fas fa-briefcase text-5xl text-slate-300 mb-4" />
          <h3 className="text-lg font-semibold text-slate-800 mb-2">{t('no_jobs_found')}</h3>
          <p className="text-slate-500 text-sm">
            {searchQuery || locationFilter !== 'all' || typeFilter !== 'all'
              ? 'Aucune offre publiée ne correspond aux critères.'
              : isPrivilegedUser ? "Créez une nouvelle offre pour attirer les talents." : "Aucune opportunité disponible pour le moment."}
          </p>
          {isPrivilegedUser && (
            <button type="button" onClick={() => setView('create_job')} className="mt-4 btn-3d-primary">
              <i className="fas fa-plus mr-2" />
              Créer la première offre
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredJobs.map(job => (
            <JobRow
              key={job.id}
              job={job}
              onApply={handleApply}
              onShowApplicants={handleShowApplicants}
              currentUser={user}
              canManageJobs={Boolean(canManageJobs)}
            />
          ))}
        </div>
      )}

      {modalJob && <ApplicantsModal job={modalJob} onClose={() => setModalJob(null)} />}
    </div>
  );
};

export default Jobs;
