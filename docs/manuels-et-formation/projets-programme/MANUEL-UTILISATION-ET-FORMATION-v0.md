# Manuel d’utilisation et de formation — Module Projets & Programme (COYA)

**Version** : v0 — état au **13 mai 2026**  
**Statut** : document **vivant** ; une version **v1** officielle sera publiée après validation complète des fonctionnalités et recette utilisateur.  
**Public** : équipes projet, PM, PMO, managers, formateurs (« un seul document de référence » pour la montée en compétence).

---

## 1. Objet du module

Le module **Projets & Programme** permet de :

- piloter un **projet** (équipe, échéances, budget, risques, tâches, documents) ;
- le relier au **programme** (vue combinée dans l’application via l’espace Programmes & Projets) ;
- s’aligner sur une logique **LOS / pilotage** : visibilité, traçabilité, indicateurs, preuves.

Référence canon produit : dossier [`domains/projects/`](../../../domains/projects/) (états, événements, permissions, read models documentés).

---

## 2. Présentation des fonctionnalités existantes (workspace projet)

L’écran principal est le **workspace objet projet** (`ProjectObjectWorkspace` / page détail projet). Les onglets disponibles dans l’interface sont :

| Onglet (FR) | Identifiant technique | Rôle pour l’utilisateur |
|-------------|-------------------------|-------------------------|
| **Aperçu** | `cockpit` | Synthèse : santé du projet, alertes, temps enregistré, jalons, progression, liens rapides vers les tâches ; bandeau KPI financiers si données disponibles. |
| **Informations** | `team` | Métadonnées projet, équipe, rattachements (ex. programme) ; accès au wizard de modification projet selon droits. |
| **Planification** | `planning` | Vue planification liée aux tâches / créneaux (synchronisation avec le module planning selon configuration). |
| **Finances** | `budget` | Budget projet, lignes budgétaires, indicateurs financiers liés au projet. |
| **Indicateurs** | `performance` | Vue performance / indicateurs projet. |
| **Documents** | `documents` | Pièces jointes projet : upload, liste, suppression ; stockage **Supabase Storage** (bucket `project-attachments`) + métadonnées en base (`project_attachments`). |
| **Tâches** | `tasks` | Liste / Kanban, filtres, création et édition de tâches, assignation, statuts, gouvernance tâche (périodes, justificatifs selon règles) ; bandeau **read models** (agrégats tâches / risques) lorsque disponibles. |
| **Historique** | `history` | Historique des événements domaine projet (timeline) lorsque branché à la persistance des événements. |

**Hors onglets mais dans le même workspace** : temps passé (modal), rapports, risques (table / règles), objectifs liés selon écran, etc. — selon droits `useModulePermissions` et maturité des données.

---

## 3. Ce qui existe côté technique (pour les formateurs / SI)

| Composant | Description |
|-----------|-------------|
| **Données projet** | Table `projects` (JSON `tasks`, `risks`, équipe, etc.) + table `tasks` pour persistance SQL alignée client. |
| **Pièces jointes** | Table `project_attachments` + bucket Storage `project-attachments` ; politiques **RLS** sur la table et **policies Storage** sur les objets (accès par organisation / chemin). |
| **Read models** | Vues matérialisées `project_tasks_read_model`, `project_risks_read_model` (rafraîchissement + consommation UI ; pas de RLS direct sur vues matérialisées — sécurité portée par les tables sources). |
| **Risques structurés** | Table `risks` (si déployée) + read model risques enrichi (SLA / RAG selon schéma). |
| **Dépendances** | Table `task_dependencies` ; commandes **Edge** `project-command` (type `add_dependency`). |
| **Commandes métier** | Edge Function `project-command` : changement de statut, création tâche, assignation, dépendance ; corrélation `command_id` / `correlation_id` / `event_ids` ; journal `domain_events` côté serveur. |
| **Client BFF** | `services/domain/bff/projectCommandClient.ts` — en-têtes `x-org-id`, `x-actor-id` pour alignement organisationnel. |
| **Temps réel** | Abonnements Realtime sur read models dans la page projet (avec refetch de secours). |
| **Audit** | Table `audit_logs` avec **RLS activé** et policies restreintes (rôles élevés) ; le service applicatif d’audit applicatif utilise surtout `activity_logs` — distinguer les deux en formation. |

---

## 4. Politiques et méthodologies d’usage (LOS / PMO)

### 4.1 Principes

1. **Une trace par décision sensible** : clôture de jalon, changement de budget validé, preuve de livrable — privilégier document + référence en tâche ou en risque.  
2. **Pas de contournement des rôles** : création / structuration des tâches réservée aux profils autorisés ; contributeurs se concentrent sur l’exécution et les preuves.  
3. **Alignement organisation** : les en-têtes et RLS supposent une **organisation** cohérente sur le profil utilisateur ; en cas d’erreur d’accès, vérifier profil et membership projet.  
4. **Stand-up quotidien** : utiliser le script **10 min** (équipe réduite) ou **15 min** (équipe large) + compte-rendu PMO à trois actions — document transmis séparément ou intégré au wiki interne.

### 4.2 États et transitions (tâches)

Référence normative : [`domains/projects/states.md`](../../../domains/projects/states.md).  
En UI, les libellés peuvent rester compatibles avec l’ancien format ; le **canon** est en codes (`todo`, `in_progress`, `done`, etc.).

### 4.3 Matrice RACI / permissions

Référence : [`domains/projects/permissions.md`](../../../domains/projects/permissions.md).  
À rappeler en formation : **ne jamais s’appuyer uniquement sur des contrôles côté navigateur** pour les actions sensibles (clôture, budget, conformité).

---

## 5. Mode d’emploi utilisateur (parcours type)

### 5.1 Ouvrir un projet

Depuis **Programmes & Projets** ou la liste **Projets** : sélectionner un projet → workspace avec onglets ci-dessus.

### 5.2 Consulter l’aperçu (Aperçu)

Lire la **santé**, les **alertes**, la **progression** ; cliquer vers **Tâches** si action immédiate.

### 5.3 Mettre à jour les informations (Informations)

Ouvrir le wizard de modification si autorisé ; sauvegarder pour persister côté `projects`.

### 5.4 Gérer les tâches (Tâches)

- Filtrer, trier, passer en vue tableau ou Kanban.  
- Changer statut / assignation : selon configuration, passage par **commande Edge** (traçabilité).  
- Respecter les règles de **justificatif** si le projet impose une pièce jointe pour clôturer une tâche critique.

### 5.5 Joindre des preuves (Documents)

- Uploader un fichier ; vérifier que le fichier apparaît dans la liste.  
- En cas d’erreur : vérifier bucket, droits Storage, taille du fichier, connexion.

### 5.6 Suivre les risques

Saisir ou mettre à jour les risques dans l’interface prévue ; les indicateurs agrégés peuvent apparaître sur l’onglet Tâches / cockpit selon données.

### 5.7 Historique

Consulter la timeline pour audit narratif des changements projet lorsque les événements sont persistés et affichés.

---

## 6. Plan de formation suggéré (montée en compétence)

| Séquence | Durée indic. | Contenu |
|----------|--------------|---------|
| F1 | 30 min | Carte du module + onglets + rôles. |
| F2 | 45 min | Tâches : statuts, Kanban, assignation, gouvernance. |
| F3 | 30 min | Documents + bonnes pratiques de preuve. |
| F4 | 30 min | Cockpit / indicateurs / lecture des alertes. |
| F5 | 20 min | Lien Programme & Projet (navigation). |
| F6 | 20 min | Q/R + fiche mémo « 3 actions par jour » (stand-up). |

**Évaluation** : checklist pratique (créer une tâche, changer statut, joindre un fichier, lire le cockpit).

---

## 7. Évolution vers le manuel v1 (après validation produit)

Lorsque l’ensemble des fonctionnalités prévues sera **implémenté et validé** :

1. Mettre à jour ce document (captures d’écran, numérotation des étapes, messages d’erreur réels).  
2. Renommer ou dupliquer en **`MANUEL-UTILISATION-ET-FORMATION-v1.md`**.  
3. Archiver **v0** dans un sous-dossier `archives/` si besoin de traçabilité documentaire.

---

## 8. Contacts et maintenance documentaire

- **Référent produit / PMO** : à désigner en interne.  
- **Référent technique** : équipe développement COYA — pour écarts entre manuel et comportement réel de l’application.

---

*Fin du document v0 — Projets & Programme.*
