/**
 * Navigation sous-sections du module Formation (URL #formation/<section> + événements sync sidebar).
 */

export type FormationHubSection =
  | 'overview'
  | 'programmes'
  | 'cohortes'
  | 'formations'
  | 'cours'
  | 'formateurs'
  | 'apprenants'
  | 'evaluations'
  | 'certificats'
  | 'rapports';

const VALID = new Set<string>([
  'overview',
  'programmes',
  'cohortes',
  'formations',
  'cours',
  'formateurs',
  'apprenants',
  'evaluations',
  'certificats',
  'rapports',
]);

export function isFormationHubSection(value: string): value is FormationHubSection {
  return VALID.has(value);
}

export function parseFormationSectionFromHash(): FormationHubSection | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const m = hash.match(/^formation\/(.+)$/);
  if (!m) return null;
  const raw = m[1];
  if (!VALID.has(raw)) return null;
  return raw as FormationHubSection;
}

/** Met à jour le hash sans empiler l’historique et notifie les écouteurs (sidebar). */
export function pushFormationSectionToUrl(section: FormationHubSection): void {
  if (typeof window === 'undefined') return;
  const next = `#formation/${section}`;
  if (window.location.hash === next) {
    window.dispatchEvent(new CustomEvent('coya-formation-section'));
    return;
  }
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${next}`);
  window.dispatchEvent(new CustomEvent('coya-formation-section'));
}

export const FORMATION_SIDEBAR_ITEMS: { section: FormationHubSection; label: string }[] = [
  { section: 'overview', label: 'Vue d\u2019ensemble' },
  { section: 'programmes', label: 'Programmes de formation' },
  { section: 'cohortes', label: 'Cohortes' },
  { section: 'formations', label: 'Studio formations' },
  { section: 'cours', label: 'Cours' },
  { section: 'formateurs', label: 'Formateurs / Mentors' },
  { section: 'apprenants', label: 'Apprenants' },
  { section: 'evaluations', label: '\u00c9valuations' },
  { section: 'certificats', label: 'Certificats' },
  { section: 'rapports', label: 'Rapports' },
];
