import React, { useCallback, useEffect, useMemo, useState } from 'react';
import OrganizationService from '../../services/organizationService';
import * as comptabiliteService from '../../services/comptabiliteService';
import type { FiscalYear } from '../../types';
import {
  AccountingBudgetsView,
  AccountingComptaGeneraleView,
  AccountingDashboardView,
  AccountingFacturationView,
  AccountingFiscaliteView,
  AccountingParametresView,
  AccountingRapportsView,
  AccountingTresorerieView,
  AccountingRouteEmpty,
} from './AccountingViews';
import AccountingJournalLive from './AccountingJournalLive';
import type { AccountingRouteId } from './accountingRoutes';

const STORAGE_ROUTE = 'coya.accounting.shell.route.v2';

export type { AccountingRouteId } from './accountingRoutes';

type NavGroup = { title: string; items: { id: AccountingRouteId; label: string }[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: 'TABLEAU DE BORD',
    items: [
      { id: 'journal', label: 'Journal' },
      { id: 'ecritures', label: 'Écritures' },
      { id: 'grand_livre', label: 'Grand livre' },
      { id: 'plan_comptable', label: 'Plan comptable' },
      { id: 'balance', label: 'Balance' },
      { id: 'bilan', label: 'Bilan' },
      { id: 'compte_resultat', label: 'Compte de résultat' },
      { id: 'flux', label: 'Tableau de flux' },
      { id: 'budgets', label: 'Budgets' },
      { id: 'cloture', label: 'Clôture' },
    ],
  },
  {
    title: 'TRÉSORERIE',
    items: [
      { id: 'banques', label: 'Comptes bancaires' },
      { id: 'caisse', label: 'Caisse' },
      { id: 'rapprochements', label: 'Rapprochements' },
    ],
  },
  {
    title: 'CLIENTS & FOURNISSEURS',
    items: [
      { id: 'clients', label: 'Clients' },
      { id: 'fournisseurs', label: 'Fournisseurs' },
      { id: 'facturation', label: 'Facturation' },
      { id: 'paiements', label: 'Paiements' },
    ],
  },
  {
    title: 'FISCALITÉ',
    items: [
      { id: 'tva', label: 'TVA' },
      { id: 'impots', label: 'Impôts & Taxes' },
      { id: 'declarations', label: 'Déclarations' },
    ],
  },
  {
    title: 'PARAMÈTRES',
    items: [
      { id: 'analytique', label: 'Analytique' },
      { id: 'devise', label: 'Devise' },
      { id: 'centres_couts', label: 'Centre de coûts' },
      { id: 'utilisateurs', label: 'Utilisateurs & Accès' },
    ],
  },
];

const ALL_IDS = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.id)));

function readStoredRoute(): AccountingRouteId | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_ROUTE);
    if (!raw || !ALL_IDS.has(raw as AccountingRouteId)) return null;
    return raw as AccountingRouteId;
  } catch {
    return null;
  }
}

const AccountingModuleShell: React.FC = () => {
  const [route, setRouteState] = useState<AccountingRouteId>('journal');
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [orgLabel, setOrgLabel] = useState<string | null>(null);
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);

  useEffect(() => {
    const r = readStoredRoute();
    if (r) setRouteState(r);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const id = await OrganizationService.getCurrentUserOrganizationId();
      const org = await OrganizationService.getCurrentUserOrganization();
      if (cancelled) return;
      setOrganizationId(id);
      setOrgLabel(org?.name ?? (id ? `Organisation ${id.slice(0, 8)}…` : null));
      if (id) {
        try {
          const fy = await comptabiliteService.listFiscalYears(id);
          if (!cancelled) setFiscalYears(fy);
        } catch {
          if (!cancelled) setFiscalYears([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setRoute = useCallback((next: AccountingRouteId) => {
    setRouteState(next);
    try {
      sessionStorage.setItem(STORAGE_ROUTE, next);
    } catch {
      /* ignore */
    }
  }, []);

  const flatNav = useMemo(() => NAV_GROUPS.flatMap((g) => g.items), []);

  const mainContent = useMemo(() => {
    switch (route) {
      case 'journal':
        return <AccountingJournalLive />;
      case 'ecritures':
        return <AccountingJournalLive hideReportsSection />;
      case 'grand_livre':
      case 'balance':
      case 'bilan':
      case 'compte_resultat':
      case 'flux':
        return <AccountingRapportsView organizationId={organizationId} mode={route} />;
      case 'plan_comptable':
      case 'analytique':
      case 'centres_couts':
        return <AccountingComptaGeneraleView organizationId={organizationId} focus={route} />;
      case 'budgets':
        return <AccountingBudgetsView organizationId={organizationId} />;
      case 'banques':
      case 'caisse':
      case 'rapprochements':
        return <AccountingTresorerieView organizationId={organizationId} focus={route} />;
      case 'facturation':
        return <AccountingFacturationView organizationId={organizationId} />;
      case 'tva':
      case 'impots':
      case 'declarations':
        return <AccountingFiscaliteView />;
      case 'devise':
        return <AccountingDashboardView organizationId={organizationId} />;
      case 'utilisateurs':
        return <AccountingParametresView organizationId={organizationId} />;
      case 'cloture':
        return <AccountingRouteEmpty title="Clôture" message="Workflow de clôture d’exercice : brancher les écrans sur accounting_period_closures lorsque le périmètre métier sera figé." />;
      case 'clients':
        return <AccountingRouteEmpty title="Clients" message="Les auxiliaires clients ne sont pas encore exposés dans ce module. Les factures client peuvent être gérées depuis le module commercial." />;
      case 'fournisseurs':
        return <AccountingRouteEmpty title="Fournisseurs" message="Auxiliaires fournisseurs non branchés. Utilisez le journal et le plan comptable pour les écritures fournisseurs." />;
      case 'paiements':
        return <AccountingRouteEmpty title="Paiements" message="Écran de suivi des règlements : à connecter aux écritures de trésorerie et aux flux bancaires." />;
      default:
        return <AccountingJournalLive />;
    }
  }, [route, organizationId]);

  return (
    <div className="p-6 space-y-6 text-gray-900">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-gray-900">Comptabilité</h2>
          <p className="text-gray-500 text-sm mt-1">
            Journal et plan comptable connectés à Supabase (RLS par organisation). Les autres écrans s’enrichissent au fil des migrations.
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm shrink-0 max-w-md">
          <p className="font-medium text-slate-800">{orgLabel ?? 'Organisation'}</p>
          <p className="text-xs text-slate-500 mt-1">
            {organizationId ? `ID : ${organizationId}` : 'Aucune organisation — connectez un compte avec une organisation.'}
          </p>
          {fiscalYears.length > 0 ? (
            <p className="text-xs text-slate-500 mt-2">
              Exercices :{' '}
              {fiscalYears
                .slice(0, 4)
                .map((fy) => fy.label || `${fy.dateStart} → ${fy.dateEnd}`)
                .join(' · ')}
              {fiscalYears.length > 4 ? '…' : ''}
            </p>
          ) : organizationId ? (
            <p className="text-xs text-amber-700 mt-2">Aucun exercice fiscal en base — créez-en via l’administration ou les migrations comptables.</p>
          ) : null}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-1.5 inline-flex flex-wrap gap-1">
        {flatNav.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setRoute(item.id)}
            className={`rounded-xl font-medium transition-all px-3 py-2 text-xs sm:text-sm ${
              route === item.id ? 'bg-coya-green text-white shadow-sm' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            aria-label={item.label}
            aria-current={route === item.id ? 'page' : undefined}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-w-0">{mainContent}</div>
    </div>
  );
};

export default AccountingModuleShell;
