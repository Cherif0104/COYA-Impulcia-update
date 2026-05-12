import React, { useMemo } from 'react';
import type { Course } from '../../../types';
import { APEX_SHELL_CARD } from '../apexConstants';
import { deriveApexHubPilotScope, apexPilotScopeLabel } from '../../../utils/apexHubScope';
import type { ApexCohortRow } from '../types/apexHub';
import { ApexYouTubeEmbed } from '../ApexMediaEmbed';
import ModuleRichHub from '../../common/ModuleRichHub';

export type ApexOverviewSectionProps = {
  isFr: boolean;
  userRole: string | undefined;
  courses: Course[];
  published: Course[];
  cohortRows: ApexCohortRow[];
  demoYoutubeUrl: string;
};

export const ApexOverviewSection: React.FC<ApexOverviewSectionProps> = ({
  isFr,
  userRole,
  courses,
  published,
  cohortRows,
  demoYoutubeUrl,
}) => {
  const scope = deriveApexHubPilotScope(userRole);
  const scopeLabel = apexPilotScopeLabel(scope, isFr);

  const learnerCount = useMemo(
    () => courses.reduce((s, c) => s + (c.studentsCount || 0), 0),
    [courses],
  );
  const activeCohorts = useMemo(
    () => cohortRows.filter((r) => r.status === 'open' || r.status === 'planned').length,
    [cohortRows],
  );
  const sessionsLive = useMemo(() => cohortRows.filter((r) => r.status === 'open').length, [cohortRows]);
  const avgProgress = useMemo(() => {
    const withP = published.filter((c) => typeof c.progress === 'number');
    if (!withP.length) return null;
    return Math.round(withP.reduce((s, c) => s + (c.progress || 0), 0) / withP.length);
  }, [published]);
  const churnEstimate = useMemo(() => {
    if (!published.length) return null;
    const low = published.filter((c) => (c.progress || 0) < 30 && (c.studentsCount || 0) > 0).length;
    return Math.min(100, Math.round((low / published.length) * 100));
  }, [published]);

  const calendarItems = useMemo(() => {
    return cohortRows.slice(0, 6).map((r) => ({
      id: r.sessionId,
      title: r.sessionTitle,
      at: r.startsAt,
      kind: r.status === 'open' ? ('live' as const) : ('session' as const),
    }));
  }, [cohortRows]);

  const kpi = [
    {
      key: 'learners',
      label: isFr ? 'Apprenants (inscriptions)' : 'Learners (enrollments)',
      value: String(learnerCount),
      hint: isFr ? 'Somme `studentsCount` du catalogue' : 'Sum of course `studentsCount`',
    },
    {
      key: 'cohorts',
      label: isFr ? 'Cohortes actives / planifiées' : 'Active / planned cohorts',
      value: String(activeCohorts),
      hint: isFr ? 'Sessions `open` + `planned`' : 'Sessions `open` + `planned`',
    },
    {
      key: 'sessions',
      label: isFr ? 'Sessions en cours' : 'Sessions in progress',
      value: String(sessionsLive),
      hint: isFr ? 'Statut `open`' : 'Status `open`',
    },
    {
      key: 'success',
      label: isFr ? 'Taux réussite (est.)' : 'Pass rate (est.)',
      value: avgProgress != null ? `${avgProgress}%` : '—',
      hint: isFr ? 'Moyenne progression cours (profil courant)' : 'Avg course progress (current profile)',
    },
    {
      key: 'progress',
      label: isFr ? 'Progression moyenne catalogue' : 'Avg catalog progress',
      value: avgProgress != null ? `${avgProgress}%` : '—',
      hint: isFr ? 'Basé sur les cours publiés avec progression' : 'From published courses with progress',
    },
    {
      key: 'certs',
      label: isFr ? 'Certificats (module)' : 'Certificates (module)',
      value: isFr ? 'Temps réel + PDF' : 'Realtime + PDF',
      hint: isFr ? 'Voir onglet Certifications' : 'See Certifications tab',
    },
    {
      key: 'attendance',
      label: isFr ? 'Présence (sessions)' : 'Attendance (sessions)',
      value: cohortRows.length ? isFr ? 'À brancher QR' : 'Wire QR' : '—',
      hint: isFr ? 'QR, émargement, activité — données session' : 'QR, roll call, activity',
    },
    {
      key: 'churn',
      label: isFr ? 'Risque abandon (heuristique)' : 'Churn risk (heuristic)',
      value: churnEstimate != null ? `${churnEstimate}%` : '—',
      hint: isFr ? 'Cours avec progression < 30 % et inscrits > 0' : 'Courses progress < 30% with enrollments',
    },
  ];

  return (
    <div className="space-y-6">
      <div className={`${APEX_SHELL_CARD} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {isFr ? 'Contexte permissions' : 'Permission context'}
          </p>
          <p className="mt-1 text-sm font-medium text-slate-900">{scopeLabel}</p>
          <p className="mt-1 text-xs text-slate-500">
            {isFr
              ? 'Tableau filtrable par rôle : admin (global), manager (programmes), formateur (cohortes), apprenant (perso).'
              : 'Role-scoped dashboard: admin (global), manager (programs), trainer (cohorts), learner (self).'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] text-slate-600">
            {isFr ? 'Filtre période' : 'Period filter'}: <strong>{isFr ? '30 j.' : '30d'}</strong>
          </span>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] text-emerald-800">
            {isFr ? 'Temps réel' : 'Live'} · WebSocket / polling
          </span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {kpi.map((x) => (
          <div key={x.key} className={`${APEX_SHELL_CARD} p-4`} title={x.hint}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{x.label}</p>
            <p className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{x.value}</p>
            <p className="mt-1 text-[10px] text-slate-400">{x.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${APEX_SHELL_CARD} p-5`}>
          <h3 className="text-sm font-semibold text-slate-900">
            {isFr ? 'Activité récente' : 'Recent activity'}
          </h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-700">
            <li className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span>{isFr ? 'Nouveaux inscrits (agrégat catalogue)' : 'New enrollments (catalog aggregate)'}</span>
              <span className="font-semibold tabular-nums text-slate-900">+{learnerCount}</span>
            </li>
            <li className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span>{isFr ? 'Certifications / attestations' : 'Certifications'}</span>
              <span className="text-xs text-slate-500">{isFr ? 'Voir onglet Certifications' : 'See Certifications'}</span>
            </li>
            <li className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span>{isFr ? 'Examens & quiz' : 'Exams & quizzes'}</span>
              <span className="text-xs text-slate-500">{isFr ? 'Moteur évaluations' : 'Assessment engine'}</span>
            </li>
            <li className="flex justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <span>{isFr ? 'Feedbacks & NPS' : 'Feedback & NPS'}</span>
              <span className="text-xs text-amber-700">{isFr ? 'À connecter CRM' : 'Connect CRM'}</span>
            </li>
          </ul>
        </div>

        <div className={`${APEX_SHELL_CARD} p-5`}>
          <h3 className="text-sm font-semibold text-slate-900">
            {isFr ? 'Calendrier intelligent' : 'Smart calendar'}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {isFr ? 'Lives, coaching, examens, deadlines — alimenté par les sessions LMS.' : 'Lives, coaching, exams, deadlines — fed by LMS sessions.'}
          </p>
          <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto text-xs">
            {calendarItems.length === 0 ? (
              <li className="text-slate-500">{isFr ? 'Aucune session planifiée.' : 'No planned sessions.'}</li>
            ) : (
              calendarItems.map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 px-2 py-1.5"
                >
                  <span className="truncate font-medium text-slate-800">{ev.title}</span>
                  <span className="shrink-0 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] text-sky-800">
                    {ev.kind === 'live' ? 'Live' : isFr ? 'Session' : 'Session'}
                  </span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className={`${APEX_SHELL_CARD} p-5`}>
        <h3 className="text-sm font-semibold text-slate-900">{isFr ? 'Alertes' : 'Alerts'}</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[
            {
              k: 'exp',
              t: isFr ? 'Accès expirants' : 'Expiring access',
              d: isFr ? 'Invitations temporaires proches de la fin.' : 'Temporary invites near end.',
              tone: 'border-amber-200 bg-amber-50 text-amber-900',
            },
            {
              k: 'inactive',
              t: isFr ? 'Cohortes inactives' : 'Inactive cohorts',
              d: isFr ? 'Sessions `closed` sans remplacement planifié.' : 'Closed sessions without follow-up.',
              tone: 'border-slate-200 bg-slate-50 text-slate-800',
            },
            {
              k: 'low',
              t: isFr ? 'Faibles progressions' : 'Low progress',
              d: isFr ? 'Heuristique progression < 30 %.' : 'Heuristic progress < 30%.',
              tone: 'border-rose-200 bg-rose-50 text-rose-900',
            },
            {
              k: 'exam',
              t: isFr ? 'Examens non corrigés' : 'Uncorrected exams',
              d: isFr ? 'File manuelle + file auto (builder).' : 'Manual queue + auto queue.',
              tone: 'border-violet-200 bg-violet-50 text-violet-900',
            },
          ].map((a) => (
            <div key={a.k} className={`rounded-xl border px-3 py-2 text-xs ${a.tone}`}>
              <p className="font-semibold">{a.t}</p>
              <p className="mt-0.5 opacity-90">{a.d}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={`${APEX_SHELL_CARD} p-6`}>
        <h3 className="text-sm font-semibold text-slate-900">{isFr ? 'Média intégré (démo)' : 'Embedded media (demo)'}</h3>
        <p className="mt-1 text-xs text-slate-500">
          {isFr
            ? 'YouTube / Vimeo / streaming interne — contenus sensibles restent dans le lecteur plateforme.'
            : 'YouTube / Vimeo / internal streaming — sensitive content stays in-app.'}
        </p>
        <div className="mt-4">
          {demoYoutubeUrl ? (
            <ApexYouTubeEmbed title="COYA APEX" url={demoYoutubeUrl} />
          ) : (
            <p className="text-sm text-slate-500">
              {isFr
                ? 'Ajoutez une URL YouTube sur un cours publié pour prévisualiser ici.'
                : 'Add a YouTube URL on a published course to preview here.'}
            </p>
          )}
        </div>
      </div>

      <ModuleRichHub
        isFr={isFr}
        metrics={[
          {
            labelFr: 'Cours (catalogue)',
            labelEn: 'Courses (catalog)',
            value: String(courses.length),
            hintFr: 'Tous statuts confondus',
            hintEn: 'All statuses',
          },
          {
            labelFr: 'Publiés',
            labelEn: 'Published',
            value: String(published.length),
            hintFr: 'Visibles apprenants',
            hintEn: 'Visible to learners',
          },
          {
            labelFr: 'Sessions & cohortes',
            labelEn: 'Sessions & cohorts',
            value: String(cohortRows.length),
            hintFr: 'Lignes agrégées DataAdapter',
            hintEn: 'Rows from DataAdapter',
          },
          {
            labelFr: 'Pilotage',
            labelEn: 'Steering',
            value: scopeLabel,
            hintFr: 'Portée permissions courantes',
            hintEn: 'Current permission scope',
          },
        ]}
        sections={[
          {
            key: 'chain',
            titleFr: 'Chaîne de valeur APEX dans COYA',
            titleEn: 'APEX value chain inside COYA',
            icon: 'fas fa-link',
            bulletsFr: [
              'CRM & Collecte : campagnes liées aux programmes / formations.',
              'Drive : supports, médias et preuves de conformité.',
              'Trinité & Qualité : scoring et incidents reliés aux parcours.',
              'Messagerie / Ticket IT : support apprenants et incidents LMS.',
            ],
            bulletsEn: [
              'CRM & Collecte: campaigns tied to programmes / courses.',
              'Drive: assets, media and compliance evidence.',
              'Trinité & Quality: scoring and incidents tied to learning paths.',
              'Messaging / IT tickets: learner support and LMS incidents.',
            ],
          },
        ]}
      />
    </div>
  );
};
