/** Routes internes du module Comptabilité (session + état React). */
export type AccountingRouteId =
  | 'journal'
  | 'ecritures'
  | 'grand_livre'
  | 'plan_comptable'
  | 'balance'
  | 'bilan'
  | 'compte_resultat'
  | 'flux'
  | 'budgets'
  | 'cloture'
  | 'banques'
  | 'caisse'
  | 'rapprochements'
  | 'clients'
  | 'fournisseurs'
  | 'facturation'
  | 'paiements'
  | 'tva'
  | 'impots'
  | 'declarations'
  | 'analytique'
  | 'devise'
  | 'centres_couts'
  | 'utilisateurs';

export type AccountingReportMode = Extract<
  AccountingRouteId,
  'grand_livre' | 'balance' | 'bilan' | 'compte_resultat' | 'flux'
>;

export type AccountingComptaFocus = Extract<AccountingRouteId, 'plan_comptable' | 'analytique' | 'centres_couts'>;

export type AccountingTresorerieFocus = Extract<AccountingRouteId, 'banques' | 'caisse' | 'rapprochements'>;
