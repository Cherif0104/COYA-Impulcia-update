import React, { createContext, useContext } from 'react';

/** sessionStorage : onglet initial de la coquille `programmes_projects` (`programme` | `projects`). */
export const NAV_SESSION_PROGRAMMES_PROJECTS_TAB = 'coya_nav_programmes_projects_tab';

/** sessionStorage : ouvrir un programme précis après navigation vers la vue `programme`. */
export const NAV_SESSION_OPEN_PROGRAMME_ID = 'coya_nav_open_programme_id';
/** sessionStorage : onglet détail programme (`collecte` | `projets` | …) après ouverture via `NAV_SESSION_OPEN_PROGRAMME_ID`. */
export const NAV_SESSION_OPEN_PROGRAMME_DETAIL_TAB = 'coya_nav_open_programme_detail_tab';
/** sessionStorage : ouvrir la fiche projet après navigation vers la vue `projects`. */
export const NAV_SESSION_OPEN_PROJECT_ID = 'coya_nav_open_project_id';
/** sessionStorage : préremplir une campagne « programme » dans la vue `collecte`. */
export const NAV_SESSION_COLLECTE_PRESET_PROGRAMME_ID = 'coya_nav_collecte_preset_programme_id';
/** sessionStorage : préremplir rattachement « formation » (course id) dans Collecte (CRM ou module). */
export const NAV_SESSION_COLLECTE_PRESET_FORMATION_ID = 'coya_nav_collecte_preset_formation_id';
/** sessionStorage : au montage du CRM, ouvrir l’onglet Collecte (1 = oui). */
export const NAV_SESSION_CRM_OPEN_COLLECTE_TAB = 'coya_nav_crm_open_collecte_tab';
/** sessionStorage : sous-vue APEX (`overview` | `catalog` | …) — consommé au montage de `ApexModuleShell`. */
export const NAV_SESSION_APEX_SECTION = 'coya_nav_apex_section';
/** @deprecated Utiliser `NAV_SESSION_APEX_SECTION` — conservé pour migration session une fois. */
export const NAV_SESSION_FORMATION_SECTION = 'coya_nav_formation_section';
/** sessionStorage : préremplir la campagne (id collecte) dans la zone soumissions → CRM. */
export const NAV_SESSION_COLLECTE_PRESET_COLLECTION_ID = 'coya_nav_collecte_preset_collection_id';
/** sessionStorage : appliquer au montage du CRM un filtre sur `source_collection_id`. */
export const NAV_SESSION_CRM_FILTER_SOURCE_COLLECTION_ID = 'coya_nav_crm_filter_source_collection_id';
/** sessionStorage : filtrer les formations (vue `courses`) par programme lié. */
export const NAV_SESSION_COURSES_PROGRAMME_ID = 'coya_nav_courses_programme_id';

/** sessionStorage : intention mobilité depuis le hub `demande_mobilite` — valeurs `internal` | `external` (consommé au montage Parc auto / Logistique). */
export const NAV_SESSION_MOBILITE_INTENT = 'coya_mobilite_intent';

/** Query URL (avec `history.replaceState`) : filtrer le hub sur un projet. */
export const NAV_QUERY_MOBILITE_PROJECT_ID = 'projectId';
/** Query URL : filtrer le hub sur un programme. */
export const NAV_QUERY_MOBILITE_PROGRAMME_ID = 'programmeId';

/** sessionStorage (secours si pas de query) : filtre projet pour le hub mobilité. */
export const NAV_SESSION_MOBILITE_FILTER_PROJECT_ID = 'coya_mobilite_filter_project_id';
/** sessionStorage (secours) : filtre programme pour le hub mobilité. */
export const NAV_SESSION_MOBILITE_FILTER_PROGRAMME_ID = 'coya_mobilite_filter_programme_id';

export type AppNavigationContextValue = {
  setView: (view: string) => void;
};

export const AppNavigationContext = createContext<AppNavigationContextValue | null>(null);

export function useAppNavigation(): AppNavigationContextValue | null {
  return useContext(AppNavigationContext);
}
