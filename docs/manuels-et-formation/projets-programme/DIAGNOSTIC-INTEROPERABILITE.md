# Diagnostic — interopérabilité module Projets & Programme (COYA)

**Date** : 13 mai 2026  
**Contexte** : journaux navigateur + alignement vision dossier SENEGEL (référence locale utilisateur : `c:\Users\Lenovo\Downloads\SENEGEL ONG\`).

---

## 1. Lecture des journaux fournis

| Observation | Interprétation |
|---------------|------------------|
| Phase 1 ~1,7 s, 6 succès | Chargement essentiel (projets, factures, time logs, etc.) **OK**. |
| Phase 2 ~33 s total, **Formations ~32 s** | Goulot probable sur la ressource « courses » / formations ; à profiler côté `App.loadData` et requête Supabase (hors module projet stricto sensu). |
| `message channel closed` sur `projects/...` ou `:5174/` | Bruit fréquent d’**extensions Chrome** ; ne pas confondre avec une erreur applicative. |
| Création projet + navigation `programmes_projects` ↔ `project_workspace` | Flux **OK** (création, rechargement liste, ouverture workspace). |
| `ReferenceError: OrganizationService is not defined` dans `MobiliteRequestHub.tsx` | **Bug applicatif** : imports manquants (corrigé dans le code : `OrganizationService`, `programmeService`, `parcAutoService`, `mobilityRequestService`). |

---

## 2. Correctif appliqué (liaison Projet → Mobilité)

Le hub **Demande mobilité** consomme l’organisation courante, les programmes, les projets org et les demandes. Il utilisait déjà `OrganizationService` et les services métiers **sans les importer** → plantage au montage dès navigation depuis le workspace projet.

Fichier : `components/MobiliteRequestHub.tsx` — imports ajoutés vers `organizationService`, `programmeService`, `parcAutoService`, `mobilityRequestService`.

Le bouton **Mobilité** dans le workspace projet (`ProjectDetailPage`) pose déjà `NAV_QUERY_MOBILITE_PROJECT_ID` dans l’URL avant `setView('demande_mobilite')` : le hub peut filtrer sur le projet une fois les services chargés.

---

## 3. Carte d’interopérabilité (état actuel)

| Module / domaine | Mécanisme de lien avec Projets & Programme | Remarque |
|------------------|--------------------------------------------|----------|
| **Programme** | `programmeId` sur projet ; shell `ProgrammesProjectsShell` ; `programmeService` ; navigation session (`NAV_SESSION_*`). | Cœur LOS côté COYA. |
| **Mobilité** | Query `projectId` / `programmeId` ; session filtres ; `mobility_requests` ; routage vers Parc auto / Logistique. | **Réparé** (imports hub). |
| **Parc auto** | `parcAutoService.listOrgProjects`, intention `NAV_SESSION_MOBILITE_INTENT`. | Données projets alignées flotte. |
| **Logistique** | Idem intention « external ». | |
| **Temps / HR** | `timeLogs` passés au workspace ; cohérence charge. | Données déjà chargées en phase 1. |
| **Objectifs** | `objectives` dans cockpit / `ProjectDetailPage`. | |
| **Budget / finance** | Budgets, lignes ; onglet Finances projet. | |
| **Documents** | Liste + pièces projet (`project-attachments`, `project_attachments`). | |
| **Formations (courses)** | Chargement global lent ; lien programme possible via `NAV_SESSION_COURSES_PROGRAMME_ID` (CRM / formations). | **Perf** à traiter séparément. |

Référence domaine : `domains/projects/overview.md` (dépendances `core`, `hr`, `finance`, `documents`, `workflows`, `analytics`).

---

## 4. Pistes de renforcement (hors correctif immédiat)

1. **Formations 32 s** : mesurer la requête `courses` (index, pagination, colonnes `select`).  
2. **Tests manuels inter-modules** : depuis un projet → Mobilité (filtre projet) → brouillon → Parc auto / Logistique selon droits.  
3. **SENEGEL** : recouper ce tableau avec les exigences LOS du dossier local (processus, jalons, preuves) et mettre à jour `MANUEL-UTILISATION-ET-FORMATION-v0.md` en **v1** après validation métier.

---

*Document technique de suivi ; à compléter après recette inter-modules.*
