import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalization } from '../contexts/LocalizationContext';
import { Language } from '../types';
import OrganizationService from '../services/organizationService';
import DataAdapter from '../services/dataAdapter';
import * as triniteService from '../services/triniteService';
import { useAuth } from '../contexts/AuthContextSupabase';
import { supabase } from '../services/supabaseService';
import { DataService } from '../services/dataService';
import ModuleRichHub from './common/ModuleRichHub';

/** Trinité : scoring Ndiguel, Yar, Barké ; fiche auto-évaluation ; pilotage managers */
const TriniteModule: React.FC = () => {
  const { language } = useLocalization();
  const isFr = language === Language.FR;
  const { user } = useAuth();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [periodStart, setPeriodStart] = useState<string>(new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [periodEnd, setPeriodEnd] = useState<string>(new Date().toISOString().slice(0, 10));
  const [scores, setScores] = useState<Awaited<ReturnType<typeof triniteService.listTriniteScores>>>([]);
  const [loading, setLoading] = useState(false);
  const [myProfileId, setMyProfileId] = useState('');
  const [selfNote, setSelfNote] = useState('');
  const [aidedReceived, setAidedReceived] = useState(false);
  const [aidedByProfileId, setAidedByProfileId] = useState('');
  const [aidedReason, setAidedReason] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [orgProfiles, setOrgProfiles] = useState<{ id: string; label: string }[]>([]);
  const [teamNotes, setTeamNotes] = useState<triniteService.TriniteSelfNoteRow[]>([]);
  const [teamReviews, setTeamReviews] = useState<triniteService.TriniteManagerReviewRow[]>([]);
  const [loadingTeam, setLoadingTeam] = useState(false);

  const isReviewer = useMemo(
    () => ['super_administrator', 'administrator', 'manager', 'supervisor'].includes(String((user as any)?.role || '')),
    [user],
  );

  useEffect(() => {
    OrganizationService.getCurrentUserOrganizationId().then((id) => setOrganizationId(id ?? null));
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    DataService.getProfiles().then(({ data }) => {
      const rows = (data || []).filter((p: any) => !organizationId || p.organization_id === organizationId);
      setOrgProfiles(rows.map((p: any) => ({ id: String(p.id), label: p.full_name || p.email || String(p.id) })));
    });
  }, [organizationId]);

  useEffect(() => {
    const uid = String((user as any)?.id || user?.id || '');
    if (!uid) return;
    (async () => {
      const { data } = await DataService.getProfile(uid);
      let pid = String((user as any)?.profileId || data?.id || '');
      if (!pid) {
        const { data: row } = await supabase.from('profiles').select('id').eq('user_id', uid).maybeSingle();
        if (row?.id) pid = String(row.id);
      }
      setMyProfileId(pid);
    })();
  }, [user]);

  useEffect(() => {
    if (!organizationId || !myProfileId) return;
    triniteService.getTriniteSelfNoteRow(organizationId, myProfileId, periodStart, periodEnd).then((row) => {
      if (row) {
        setSelfNote(row.note || '');
        setAidedReceived(row.aidedReceived);
        setAidedByProfileId(row.aidedByProfileId || '');
        setAidedReason(row.aidedReason || '');
      } else {
        setSelfNote('');
        setAidedReceived(false);
        setAidedByProfileId('');
        setAidedReason('');
      }
      setSaveError(null);
    });
  }, [organizationId, myProfileId, periodStart, periodEnd]);

  const loadScores = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const list = await triniteService.listTriniteScores(organizationId, periodStart, periodEnd);
      setScores(list);
    } finally {
      setLoading(false);
    }
  }, [organizationId, periodStart, periodEnd]);

  useEffect(() => {
    loadScores();
  }, [loadScores]);

  const loadTeamData = useCallback(async () => {
    if (!organizationId || !isReviewer) return;
    setLoadingTeam(true);
    try {
      const [notes, reviews] = await Promise.all([
        triniteService.listTriniteSelfNotesForPeriod(organizationId, periodStart, periodEnd),
        triniteService.listTriniteManagerReviews(organizationId, periodStart, periodEnd),
      ]);
      setTeamNotes(notes);
      setTeamReviews(reviews);
    } finally {
      setLoadingTeam(false);
    }
  }, [organizationId, periodStart, periodEnd, isReviewer]);

  useEffect(() => {
    loadTeamData();
  }, [loadTeamData]);

  const recompute = useCallback(async () => {
    if (!organizationId || !isReviewer) return;
    setLoading(true);
    try {
      const employees = await DataAdapter.listEmployees(organizationId);
      const sessions = await DataAdapter.getPresenceSessions({ organizationId, from: `${periodStart}T00:00:00Z`, to: `${periodEnd}T23:59:59Z` });
      const projects = await DataAdapter.getProjects();
      const objectives = await DataAdapter.getObjectives();
      const profileIds = employees.map((e) => e.profileId).filter(Boolean);
      const { data: profileRows } = profileIds.length > 0
        ? await supabase.from('profiles').select('id,user_id').in('id', profileIds)
        : { data: [] as any[] };
      const profileToAuthUser = new Map<string, string>((profileRows || []).map((r: any) => [String(r.id), String(r.user_id)]));
      for (const employee of employees) {
        const profileId = employee.profileId;
        const authUserId = profileToAuthUser.get(profileId) || '';
        const relatedProjects = projects.filter((p) => p.teamMemberIds?.includes(profileId));
        const totalTasks = relatedProjects.reduce((acc, p) => acc + (p.tasks?.length || 0), 0);
        const completedTasks = relatedProjects.reduce(
          (acc, p) => acc + (p.tasks?.filter((t) => t.status === 'Completed').length || 0),
          0,
        );
        const relatedObjectives = objectives.filter((o) => (o.ownerId || '') === profileId);
        const objectivesDone = relatedObjectives.filter((o) => (o.progress || 0) >= 100).length;
        const built = triniteService.buildTriniteScore({
          organizationId,
          profileId,
          periodStart,
          periodEnd,
          presenceSessions: sessions.filter((s) => s.userId === authUserId),
          completedTasks,
          totalTasks,
          objectivesDone,
          objectivesTotal: relatedObjectives.length,
          qualityIncidents: Math.max(0, totalTasks - completedTasks > 4 ? 1 : 0),
          generatedById: user?.id != null ? String(user.id) : null,
        });
        await triniteService.upsertTriniteScore(built);
      }
      await loadScores();
    } finally {
      setLoading(false);
    }
  }, [organizationId, periodStart, periodEnd, user?.id, loadScores, isReviewer]);

  const top = useMemo(() => scores.slice(0, 3), [scores]);
  const myScore = useMemo(() => scores.find((s) => s.profileId === myProfileId) || null, [scores, myProfileId]);

  const profileLabel = (id: string) => orgProfiles.find((p) => p.id === id)?.label || id.slice(0, 8);

  const submitSelfNote = async () => {
    if (!organizationId || !myProfileId) return;
    setSavingNote(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      await triniteService.upsertTriniteSelfNote({
        organizationId,
        profileId: myProfileId,
        periodStart,
        periodEnd,
        note: selfNote.trim() || null,
        aidedReceived,
        aidedByProfileId: aidedReceived ? aidedByProfileId || null : null,
        aidedReason: aidedReceived ? aidedReason.trim() || null : null,
      });
      const displayName = String((user as any)?.full_name || (user as any)?.name || user?.email || '').trim() || (isFr ? 'Un collaborateur' : 'A team member');
      await triniteService.notifyManagersTriniteSelfNote(organizationId, myProfileId, displayName);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 4000);
      if (isReviewer) await loadTeamData();
    } catch (e: any) {
      const msg = e?.message || e?.error_description || String(e);
      setSaveError(isFr ? `Enregistrement impossible : ${msg}` : `Could not save: ${msg}`);
    } finally {
      setSavingNote(false);
    }
  };

  return (
    <div className="p-6 space-y-6 text-gray-900">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-gray-900 flex items-center gap-2">
            <i className="fas fa-gem text-gray-600" />
            Trinité
          </h2>
          <p className="text-gray-500 text-sm">
            {isFr
              ? 'Ndiguel, Yar, Barké : la moyenne sert aux évaluations. Performances projet/tâches suivies ici et dans Projets.'
              : 'Ndiguel, Yar, Barké: averages feed reviews. Project/task performance tracked here and in Projects.'}
          </p>
        </div>
      </header>

      <ModuleRichHub
        isFr={isFr}
        metrics={[
          {
            labelFr: 'Profils scorés (période)',
            labelEn: 'Profiles scored (period)',
            value: String(scores.length),
            hintFr: 'Après recalcul / import',
            hintEn: 'After recompute / import',
          },
          {
            labelFr: 'Notes équipe (reviewers)',
            labelEn: 'Team notes (reviewers)',
            value: String(teamNotes.length),
            hintFr: 'Auto-évaluations sur la période',
            hintEn: 'Self-notes on the period',
          },
          {
            labelFr: 'Revues managers',
            labelEn: 'Manager reviews',
            value: String(teamReviews.length),
            hintFr: 'Retours management',
            hintEn: 'Management feedback',
          },
          {
            labelFr: 'Mon score global',
            labelEn: 'My global score',
            value: myScore ? myScore.globalScore.toFixed(1) : '—',
            hintFr: 'Ndiguel / Yar / Barké agrégés',
            hintEn: 'Aggregated Ndiguel / Yar / Barké',
          },
        ]}
        sections={[
          {
            key: 'tri',
            titleFr: 'Rôle de la Trinité dans COYA',
            titleEn: 'Trinité role in COYA',
            icon: 'fas fa-gem',
            bulletsFr: [
              'Alignement performance individuelle avec projets (tâches) et objectifs.',
              'Pont naturel vers Qualité (incidents) et RH (entretiens).',
              'Les managers filtrent la période et déclenchent un recalcul côté serveur.',
            ],
            bulletsEn: [
              'Aligns individual performance with projects (tasks) and objectives.',
              'Natural bridge to Quality (incidents) and HR (reviews).',
              'Managers pick the period and trigger server-side recompute.',
            ],
          },
        ]}
      />

      <div className="space-y-6">
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-slate-700">{isFr ? 'Période' : 'Period'}</span>
          <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <span className="text-slate-500">→</span>
          <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
        </div>

        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <i className="fas fa-user text-slate-600" />
            {isFr ? 'Ma fiche' : 'My record'}
          </h2>
          {!myProfileId ? (
            <p className="text-sm text-slate-500">{isFr ? 'Profil non résolu.' : 'Profile not resolved.'}</p>
          ) : myScore ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="rounded-lg border border-slate-200 p-3 text-center">
                <p className="text-xs text-slate-500">Ndiguel</p>
                <p className="text-lg font-semibold">{myScore.ndiguelScore.toFixed(1)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-center">
                <p className="text-xs text-slate-500">Yar</p>
                <p className="text-lg font-semibold">{myScore.yarScore.toFixed(1)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 p-3 text-center">
                <p className="text-xs text-slate-500">Barké</p>
                <p className="text-lg font-semibold">{myScore.barkeScore.toFixed(1)}</p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p className="text-xs text-emerald-700">{isFr ? 'Global' : 'Global'}</p>
                <p className="text-lg font-semibold text-emerald-900">{myScore.globalScore.toFixed(1)}</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-600 mb-4">{isFr ? 'Pas encore de score calculé pour vous sur cette période.' : 'No score computed for you on this period yet.'}</p>
          )}
          <label className="block text-sm font-medium text-slate-700 mb-1">{isFr ? 'Commentaire / auto-évaluation' : 'Self-assessment note'}</label>
          <textarea
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[100px] mb-4"
            value={selfNote}
            onChange={(e) => setSelfNote(e.target.value)}
            placeholder={isFr ? 'Votre retour sur la période…' : 'Your feedback on the period…'}
          />

          <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 mb-4 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">{isFr ? 'J’ai été aidé' : 'I received help'}</h3>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <input type="checkbox" checked={aidedReceived} onChange={(e) => setAidedReceived(e.target.checked)} />
              {isFr ? 'Oui, j’ai reçu une aide sur cette période' : 'Yes, I received help during this period'}
            </label>
            {aidedReceived && (
              <>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{isFr ? 'Par qui ? (profil organisation)' : 'By whom? (org profile)'}</label>
                  <select
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={aidedByProfileId}
                    onChange={(e) => setAidedByProfileId(e.target.value)}
                  >
                    <option value="">{isFr ? '— Choisir —' : '— Select —'}</option>
                    {orgProfiles.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">{isFr ? 'Pourquoi / contexte' : 'Why / context'}</label>
                  <textarea
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm min-h-[72px]"
                    value={aidedReason}
                    onChange={(e) => setAidedReason(e.target.value)}
                    placeholder={isFr ? 'Décrivez l’aide reçue…' : 'Describe the help you received…'}
                  />
                </div>
              </>
            )}
          </div>

          {saveError && (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
              {saveError}
            </div>
          )}
          {saveOk && (
            <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {isFr ? 'Fiche enregistrée. Votre manager a été notifié.' : 'Saved. Your manager has been notified.'}
            </div>
          )}
          <button
            type="button"
            disabled={!organizationId || !myProfileId || savingNote}
            onClick={submitSelfNote}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50"
          >
            {savingNote ? '…' : isFr ? 'Enregistrer ma fiche' : 'Save my record'}
          </button>
        </section>

        {isReviewer && (
          <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-900 mb-2 flex items-center gap-2">
              <i className="fas fa-clipboard-list text-slate-600" />
              {isFr ? 'Fiches équipe (période)' : 'Team records (period)'}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {isFr
                ? 'Seuls les rôles restreints voient les auto-évaluations des autres. Vous pouvez saisir une note (1–20) et une appréciation.'
                : 'Only restricted roles see others’ self-assessments. You can enter a rating (1–20) and feedback.'}
            </p>
            {loadingTeam ? (
              <p className="text-sm text-slate-500">…</p>
            ) : teamNotes.length === 0 ? (
              <p className="text-sm text-slate-600">{isFr ? 'Aucune fiche enregistrée sur cette période.' : 'No records for this period.'}</p>
            ) : (
              <div className="space-y-4">
                {teamNotes.map((note) => (
                  <Fragment key={note.profileId}>
                    <TriniteTeamNoteReviewCard
                      note={note}
                      initialReview={teamReviews.find(
                        (r) => r.subjectProfileId === note.profileId && r.periodStart === periodStart && r.periodEnd === periodEnd,
                      )}
                      profileLabel={profileLabel(note.profileId)}
                      aidedHelperLabel={note.aidedByProfileId ? profileLabel(note.aidedByProfileId) : '—'}
                      organizationId={organizationId!}
                      periodStart={periodStart}
                      periodEnd={periodEnd}
                      managerProfileId={myProfileId}
                      isFr={isFr}
                      onSaved={loadTeamData}
                    />
                  </Fragment>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-slate-900 mb-3 flex items-center gap-2">
            <i className="fas fa-calculator text-slate-600" />
            {isFr ? 'Scores Trinité' : 'Trinity scores'}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {isReviewer && (
              <button type="button" onClick={recompute} disabled={loading || !organizationId} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm disabled:opacity-50">
                {loading ? (isFr ? 'Calcul…' : 'Computing…') : (isFr ? 'Recalculer les scores' : 'Recompute scores')}
              </button>
            )}
          </div>
          {!isReviewer && (
            <p className="text-xs text-slate-500 mb-3">{isFr ? 'Le recalcul global est réservé aux managers / superviseurs / administrateurs.' : 'Global recompute is limited to managers / supervisors / admins.'}</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
            {top.map((score) => (
              <div key={score.id} className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs uppercase text-emerald-700">{isFr ? 'Top score' : 'Top score'}</p>
                <p className="text-xl font-semibold text-slate-900">{score.globalScore.toFixed(1)}</p>
                <p className="text-xs text-slate-500">{profileLabel(score.profileId)}</p>
              </div>
            ))}
            {top.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600 col-span-full">
                {isFr ? 'Aucun score pour la période. Lancez un recalcul.' : 'No score for this period. Run recompute.'}
              </div>
            )}
          </div>
          <p className="text-xs text-slate-500 mb-2">
            {isFr
              ? 'Le tableau respecte vos droits : les membres ne voient que leur ligne ; les managers voient l’équipe.'
              : 'The table follows your permissions: members see only their row; managers see the team.'}
          </p>
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3">{isFr ? 'Profil' : 'Profile'}</th>
                  <th className="text-right px-4 py-3">Ndiguel</th>
                  <th className="text-right px-4 py-3">Yar</th>
                  <th className="text-right px-4 py-3">Barké</th>
                  <th className="text-right px-4 py-3">{isFr ? 'Global' : 'Global'}</th>
                </tr>
              </thead>
              <tbody>
                {scores.map((score) => (
                  <tr key={score.id} className="border-b border-slate-100">
                    <td className="px-4 py-3">{profileLabel(score.profileId)}</td>
                    <td className="px-4 py-3 text-right font-mono">{score.ndiguelScore.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-mono">{score.yarScore.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-mono">{score.barkeScore.toFixed(1)}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold">{score.globalScore.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
};

function TriniteTeamNoteReviewCard({
  note,
  initialReview,
  profileLabel,
  aidedHelperLabel,
  organizationId,
  periodStart,
  periodEnd,
  managerProfileId,
  isFr,
  onSaved,
}: {
  note: triniteService.TriniteSelfNoteRow;
  initialReview?: triniteService.TriniteManagerReviewRow;
  profileLabel: string;
  aidedHelperLabel: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  managerProfileId: string;
  isFr: boolean;
  onSaved: () => void | Promise<void>;
}) {
  const [rating, setRating] = useState<string>(initialReview?.rating != null ? String(initialReview.rating) : '');
  const [feedback, setFeedback] = useState(initialReview?.feedback || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRating(initialReview?.rating != null ? String(initialReview.rating) : '');
    setFeedback(initialReview?.feedback || '');
  }, [initialReview?.id, initialReview?.rating, initialReview?.feedback]);

  const save = async () => {
    if (!managerProfileId) return;
    let r: number | null = null;
    if (rating.trim() !== '') {
      const n = parseInt(rating, 10);
      if (Number.isNaN(n) || n < 1 || n > 20) {
        setErr(isFr ? 'Note entre 1 et 20 ou laissez vide.' : 'Rating 1–20 or leave empty.');
        return;
      }
      r = n;
    }
    setErr(null);
    setSaving(true);
    try {
      await triniteService.upsertTriniteManagerReview({
        organizationId,
        subjectProfileId: note.profileId,
        periodStart,
        periodEnd,
        managerProfileId,
        rating: r,
        feedback: feedback.trim() || null,
      });
      await onSaved();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-slate-200 p-4 bg-slate-50/50 space-y-2">
      <div className="flex flex-wrap justify-between gap-2">
        <span className="font-medium text-slate-900">{profileLabel}</span>
        <span className="text-xs text-slate-500">{note.profileId.slice(0, 8)}…</span>
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{note.note || (isFr ? '(Pas de commentaire)' : '(No comment)')}</p>
      {note.aidedReceived && (
        <p className="text-xs text-slate-600">
          {isFr ? 'Aide reçue' : 'Help received'} : {aidedHelperLabel}
          {note.aidedReason ? ` — ${note.aidedReason}` : ''}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2 pt-2 border-t border-slate-200">
        <label className="text-xs text-slate-600">
          {isFr ? 'Note (1–20)' : 'Rating (1–20)'}
          <input
            type="number"
            min={1}
            max={20}
            className="ml-2 w-20 border border-slate-200 rounded px-2 py-1 text-sm"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          />
        </label>
        <input
          type="text"
          className="flex-1 min-w-[200px] border border-slate-200 rounded px-2 py-1 text-sm"
          placeholder={isFr ? 'Appréciation du manager' : 'Manager feedback'}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
        <button type="button" disabled={saving || !managerProfileId} onClick={save} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs disabled:opacity-50">
          {saving ? '…' : isFr ? 'Enregistrer avis' : 'Save review'}
        </button>
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

export default TriniteModule;
