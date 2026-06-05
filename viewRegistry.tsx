/**
 * Registre des vues (view name → composant) pour le routage principal.
 * Intégration dans l'App : utiliser <ViewRouter currentView={currentView}>{fallback}</ViewRouter>
 * ou : const Module = getModuleViewComponent(currentView); if (Module) return <Module />;
 */
import React from 'react';
import ProgrammeModule from './components/ProgrammeModule';
import TriniteModule from './components/TriniteModule';
import LogistiqueModule from './components/LogistiqueModule';
import ParcAutoModule from './components/ParcAutoModule';
import MobiliteRequestHub from './components/MobiliteRequestHub';
import MessagerieModule from './components/MessagerieModule';
import StudioModule from './components/modules/studio/StudioModule';
export type ViewName = string;

const MODULE_VIEWS: Record<string, React.ComponentType<{}>> = {
  programme: ProgrammeModule,
  trinite: TriniteModule,
  logistique: LogistiqueModule,
  studio: StudioModule,
  parc_auto: ParcAutoModule,
  demande_mobilite: MobiliteRequestHub,
  messagerie: MessagerieModule,
};

/**
 * Retourne le composant à afficher pour une vue donnée, ou null si géré ailleurs (dashboard, projects, etc.).
 * Usage dans le routeur principal (App ou équivalent) :
 *   const ModuleComponent = getModuleViewComponent(currentView);
 *   if (ModuleComponent) return <ModuleComponent />;
 *   // sinon : switch (currentView) { case 'dashboard': return <Dashboard />; ... }
 */
export function getModuleViewComponent(viewName: ViewName): React.ComponentType<{}> | null {
  return MODULE_VIEWS[viewName] ?? null;
}

/** Composant à utiliser dans le layout : rend le module du registre si la vue correspond, sinon children (switch existant). */
export const ViewRouter: React.FC<{ currentView: string; children: React.ReactNode }> = ({ currentView, children }) => {
  const ModuleComponent = getModuleViewComponent(currentView);
  if (ModuleComponent) return <ModuleComponent />;
  return <>{children}</>;
};

/** Labels pour les modules du registre (fallback si useModuleLabels non dispo) */
export const MODULE_LABELS: Record<string, { fr: string; en: string }> = {
  programme: { fr: 'Programme', en: 'Programme' },
  comptabilite: { fr: 'Comptabilité', en: 'Accounting' },
  trinite: { fr: 'Trinité', en: 'Trinité' },
  logistique: { fr: 'Logistique', en: 'Logistics' },
  studio: { fr: 'Studio', en: 'Studio' },
  parc_auto: { fr: 'Parc Auto', en: 'Fleet management' },
  demande_mobilite: { fr: 'Demande mobilité', en: 'Mobility request' },
  ticket_it: { fr: 'Ticket IT', en: 'IT Ticket' },
  messagerie: { fr: 'Messagerie', en: 'Messaging' },
  /** Coquille LMS APEX (routée dans App.tsx avec données cours). */
  apex: { fr: 'APEX (e-learning)', en: 'APEX (e-learning)' },
  formation: { fr: 'APEX (e-learning)', en: 'APEX (e-learning)' },
};
