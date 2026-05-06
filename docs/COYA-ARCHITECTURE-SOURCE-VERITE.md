# COYA — Source de vérité et périmètre (Phase 0)

Ce document fige les règles d’architecture pour le **CD COYA** : l’application web **coya-pro** et la base **Supabase (Postgres + Auth + Storage)** sont la **référence métier**. Les autres systèmes sont des **connecteurs** ou des sources secondaires, jamais des concurrents silencieux.

## 1. Principes non négociables

1. **Une seule vérité** pour présence, temps projet, validation et preuves : tables et RLS **Supabase** décrites dans la migration `20260506120000_coya_time_presence_planning_integrations.sql`.
2. **Odoo** (addons du même dépôt) : **hors périmètre produit COYA** sauf décision explicite de **synchronisation** (import/export ou job miroir). Pas de double saisie « Odoo + COYA » sans pont documenté.
3. **Atlassian / Monday / Google Drive** : intégrations **API + webhooks** (ou Edge Functions) ; les plugins IDE servent à la **spec**, pas au runtime utilisateur.

## 2. Matrice module COYA ↔ données ↔ équivalent marché

| Module / besoin COYA | Données Supabase (cible) | Référence marché (pattern) |
|----------------------|---------------------------|---------------------------|
| Pointage (entrées/sorties) | `coya_attendance_events` | SAP CATS / Odoo `hr.attendance` — événements horodatés |
| Temps projet / tâche | `coya_project_time_entries` | Jira worklog / Tempo / Monday time column |
| Tâches autorisées (N+1) | `coya_task_time_allowances` | Tempo « permissions » / SAP imputation autorisée |
| Période & validation manager | `coya_timesheet_periods` | Approbation de semaine (Tempo, SAP) |
| Planification prévue | `coya_planning_slots` | Outlook / Odoo Planning / Monday timeline |
| Écart plan vs réalisé | vue `coya_v_planning_vs_time_daily` | Capacity vs actuals |
| Synthèse jour (RH + projet) | `coya_work_day_summaries` | Relevé journalier type paie / CRA |
| Preuves (URL, fichier) | `coya_work_proofs` + Storage | Justificatifs bailleur / audit |
| Connecteurs externes | `coya_external_integrations` | iPaaS minimal (config par org) |

## 3. Flux logique (résumé)

```text
Congés / absences (tables existantes ou futures)
        │
        ▼
coya_attendance_events ──┐
coya_project_time_entries ┼──► coya_recompute_work_day_summary(profile, date)
coya_planning_slots ─────┘              │
                                          ▼
                              coya_work_day_summaries (+ coya_work_proofs)
```

## 4. Décision Odoo (à cocher en gouvernance)

- [ ] **Hors scope** — aucune sync.
- [ ] **Lecture seule** — exports Odoo vers COYA (one-shot ou batch).
- [ ] **Bidirectionnelle** — nécessite mapping d’identités (`profiles` ↔ `hr.employee`) et file d’événements ; hors de ce livrable sans cahier des charges séparé.

---

*Document généré dans le cadre du plan « COYA — reprendre à zéro ». Ne pas modifier le fichier de plan Cursor ; mettre à jour ce document si la gouvernance change.*
