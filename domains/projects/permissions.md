# Permissions — Programmes & Projets

## Principes

- **RBAC** + **scope** : organisation, programme, projet (membership explicite).
- Alignement **RLS Supabase** : toute permission UI doit avoir une règle serveur équivalente.

## Matrice (exemple — à synchroniser avec `useModulePermissions` / policies)

| Capacité | Rôle exemple | Scope | Action |
|----------|--------------|-------|--------|
| Voir projet | membre projet | projet | `project:read` |
| Éditer projet | chef de projet | projet | `project:write` |
| Changer statut tâche | contributeur | projet | `task:transition` |
| Valider tâche | manager / MOA | projet | `task:validate` |
| Voir budget projet | finance + CP | projet | `project:budget:read` |
| Modifier budget | finance | org / programme | `project:budget:write` |
| Clôturer projet | direction / admin | org | `project:close` |

## RACI projet / tâche (canon)

| Activité | R (Responsible) | A (Accountable) | C (Consulted) | I (Informed) |
|----------|-----------------|-----------------|---------------|--------------|
| Création projet | Chef de projet | Direction / PMO | Finance, Ops | Membres projet |
| Changement statut projet | Chef de projet | Direction / PMO | Finance | Membres projet |
| Création tâche | Contributeur | Chef de projet | Reviewer | Membres projet |
| Transition statut tâche (`todo`→`in_progress`→`in_review`→`done`) | Contributeur | Chef de projet / Reviewer (validation) | Reviewer | Membres projet |
| Validation livrable / tâche | Reviewer / Manager | Chef de projet | PMO | Membres projet |
| Budget / engagement | Finance | Direction | Chef de projet | Membres projet |
| Clôture projet | Direction / PMO | Direction | Finance, Chef de projet | Organisation |

## Interdictions

- Ne pas coder des **checks** uniquement côté client pour des actions sensibles (clôture, validation budget).

## Références code

- `hooks/useModulePermissions.ts`, `utils/modulePermissionDefaults.ts`, `middleware/authGuard.ts` — à rapprocher de cette matrice.
