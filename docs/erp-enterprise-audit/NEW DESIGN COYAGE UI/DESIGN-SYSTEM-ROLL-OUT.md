# Design System COYA (roll-out)

Objectif : standardiser progressivement l’UI sur le **style RH** (référence de qualité) et supprimer les patterns legacy (anciens boutons/inputs/cards) tout en gardant l’application buildable.

## Principes

- **Source de vérité tokens** : variables CSS dans `src/design-tokens.css` + mapping Tailwind dans `tailwind.config.js` (`bg-coya-*`, `text-coya-*`, **`bg-coya-institutional`** charte SENEGEL `#0D7A2B`, etc.).
- **Base composants** : classes utilitaires déjà présentes dans `src/index.css` (ex. `.coya-input`, `.coya-card`, `.coya-btn-*`).
- **Approche** : wrappers React simples dans `components/ui/` pour éviter la duplication et accélérer la migration.

## Patterns RH / MAKE FIGMA à répliquer partout

Référence : cockpit RH (`components/hr/workforce-live/*`) + primitives **`ui-runtime`** (`AnalyticsWorkspaceFloorplan`, `KPIStrip`, etc.).

- **Layout modules** : même enveloppe que RH → `AnalyticsWorkspaceFloorplan` / `WorkspaceShell` (`p-6 space-y-6`). Les pages basées sur `StructuredModulePage` utilisent désormais ce floorplan.
- **Layout legacy** : pages en `p-6 space-y-6` (`.coya-page`), headers en `.coya-page-header` (migration progressive vers floorplan).
- **Cards** : coins arrondis 2XL, bordure très légère (`gray-100`), ombre douce.
- **Champs** : inputs arrondis, focus ring léger, contraste AA.
- **CTA** : un primaire clair, un secondaire neutre, un danger rouge.
- **Tableaux** : header gris clair, hover subtil.

## Composants UI (nouveau / renforcé)

Emplacement : `components/ui/`

- `Button` : variants `primary|secondary|danger|ghost`, tailles `sm|md|lg`.
- `Input` : champ standard + `rightElement` (ex: toggle password) + `error`.
- `Card` / `CardContent` : wrappers sur `.coya-card`.
- `SectionHeader` : titre + sous-titre + actions à droite.
- `StatusPill` : badge de statut (success/warning/danger/info).
- `Skeleton` : placeholder de chargement.
- `EmptyState` : état vide standard avec CTA optionnel.

## Shell application (navigation globale)

- **Sidebar** : fond `var(--coya-shell-sidebar-bg)` (#071018), logo / pastilles **dégradé institutionnel** (`from-coya-institutional to-coya-institutional-secondary`), indicateur d’item actif **accent or** (`coya-institutional-accent`).
- **Header** : ombre basse teintée vert institutionnel ; avatar fallback même dégradé que la sidebar.
- **Dashboard** : enveloppe **`WorkspaceShell`** (`ui-runtime`) — même grille `p-6 space-y-6` que les cockpits RH ; bannière `.coya-welcome-banner` en gradient institutionnel (plus de bleu `#0d1b2a`).

## Migration progressive (stratégie)

- **Étape 1 — nouveaux écrans** : utiliser uniquement les composants `components/ui/*`.
- **Étape 2 — écrans existants** : remplacer au fil de l’eau :
  - `button` → `Button`
  - `input/select` → `Input` (+ wrappers futurs si besoin)
  - cards “custom” → `Card`
- **Étape 3 — consolidation** :
  - aligner les classes legacy vers `.coya-*` (déjà en place)
  - supprimer les composants obsolètes uniquement quand **non référencés**.

## Login & Loading Overlay (nouveau standard)

- **Login** : split-screen enterprise (branding à gauche + card premium à droite), cohérent avec les docs :
  - `docs/erp-enterprise-audit/NEW DESIGN COYAGE UI/NEW LOGIN PAGE COYA PROMPT`
- **Récupération mot de passe (après clic lien Supabase)** : plein écran même charte que le login (`components/PasswordRecoveryScreen.tsx`) — confirmation du mot de passe, toggles visibilité, i18n `recovery_*`, abandon = `signOut` + retour vue connexion. URL de retour e-mail : **`https://www.coya.pro/auth/recovery`** (constante `AUTH_RECOVERY_CALLBACK_PATH`, à autoriser dans Supabase Redirect URLs).
- **Loading overlay** : fullscreen cinematic (logo SENEGEL, slogan, progress bar), cohérent avec :
  - `docs/erp-enterprise-audit/NEW DESIGN COYAGE UI/NEW DESIGN COYA OVERLAYE PAGE DE CHARGEMENT`

## Règles de suppression “safe”

Avant suppression :
- vérifier “non utilisé” via recherche globale
- ne pas casser `npm run build`
- privilégier une phase de dépréciation (remplacement, puis suppression)

