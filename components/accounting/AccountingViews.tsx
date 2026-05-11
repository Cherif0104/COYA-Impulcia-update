import React, { useCallback, useEffect, useState } from 'react';
import * as comptabiliteService from '../../services/comptabiliteService';
import type { AccountingJournal, Budget, ChartOfAccount, CostCenter, AccountingReconciliation } from '../../types';
import type { AccountingComptaFocus, AccountingReportMode, AccountingTresorerieFocus } from './accountingRoutes';

const card = 'rounded-xl border border-slate-200 bg-white shadow-sm';

function fmtMoney(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n);
}

/** Écran minimal lorsqu’aucune API n’existe encore pour la sous-fonction. */
export const AccountingRouteEmpty: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <div className={`${card} p-10 text-center`}>
    <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
    <p className="mt-3 text-sm text-slate-600 max-w-lg mx-auto">{message}</p>
  </div>
);

export const AccountingDashboardView: React.FC<{ organizationId: string | null }> = ({ organizationId }) => {
  if (!organizationId) {
    return (
      <AccountingRouteEmpty
        title="Synthèse"
        message="Associez une organisation à votre compte pour afficher les indicateurs comptables."
      />
    );
  }
  return (
    <div className={`${card} p-10 text-center space-y-3`}>
      <h3 className="text-lg font-semibold text-slate-900">Synthèse & devise</h3>
      <p className="text-sm text-slate-600 max-w-xl mx-auto">
        Le tableau de bord consolidé (KPI multi-comptes) n’est pas encore livré. Les soldes et le journal sont
        disponibles via les onglets « Balance », « Grand livre » et « Journal ».
      </p>
    </div>
  );
};

export const AccountingFacturationView: React.FC<{ organizationId: string | null }> = ({ organizationId }) => {
  if (!organizationId) {
    return (
      <AccountingRouteEmpty
        title="Facturation"
        message="Organisation requise pour lier les pièces aux écritures."
      />
    );
  }
  return (
    <div className={`${card} p-10 text-center space-y-3`}>
      <h3 className="text-lg font-semibold text-slate-900">Facturation</h3>
      <p className="text-sm text-slate-600 max-w-lg mx-auto">
        Aucune vue facture dédiée dans le module comptabilité pour l’instant. Les encours clients/fournisseurs
        transitent par le plan comptable (401, 411…) et le journal.
      </p>
    </div>
  );
};

export const AccountingFiscaliteView: React.FC = () => (
  <AccountingRouteEmpty
    title="Fiscalité"
    message="TVA, liasses et déclarations : écrans à brancher sur les règles fiscales (fiscal_rules) et les exports comptables."
  />
);

export const AccountingBudgetsView: React.FC<{ organizationId: string | null }> = ({ organizationId }) => {
  const [rows, setRows] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setErr(null);
    try {
      const list = await comptabiliteService.listBudgets(organizationId);
      setRows(list);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur chargement budgets');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!organizationId) {
    return <AccountingRouteEmpty title="Budgets" message="Organisation requise." />;
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Budgets</h3>
          <p className="text-sm text-slate-500 mt-1">Budgets enregistrés pour l’organisation (table budgets).</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
        >
          Actualiser
        </button>
      </header>
      {err ? <p className="text-sm text-amber-700">{err}</p> : null}
      <div className={`${card} overflow-hidden`}>
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-600">
            Aucun budget en base. Créez un budget via l’API ou les écrans d’administration lorsqu’ils seront exposés ici.
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Nom</th>
                <th className="px-4 py-2 font-medium">Exercice</th>
                <th className="px-4 py-2 font-medium">Créé le</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((b) => (
                <tr key={b.id} className="text-slate-800">
                  <td className="px-4 py-2 font-medium">{b.name}</td>
                  <td className="px-4 py-2 tabular-nums">{b.fiscalYear}</td>
                  <td className="px-4 py-2 text-slate-500">{b.createdAt ? new Date(b.createdAt).toLocaleDateString('fr-FR') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export const AccountingTresorerieView: React.FC<{
  organizationId: string | null;
  focus: AccountingTresorerieFocus;
}> = ({ organizationId, focus }) => {
  const [rows, setRows] = useState<AccountingReconciliation[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setErr(null);
    try {
      const list = await comptabiliteService.listReconciliations(organizationId);
      setRows(list);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur chargement rapprochements');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const focusLabel =
    focus === 'banques'
      ? 'Comptes bancaires'
      : focus === 'caisse'
        ? 'Caisse'
        : 'Rapprochements bancaires';

  if (!organizationId) {
    return <AccountingRouteEmpty title={focusLabel} message="Organisation requise." />;
  }

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-lg font-semibold text-slate-900">{focusLabel}</h3>
        <p className="text-sm text-slate-500 mt-1">
          {focus === 'rapprochements'
            ? 'Pointages relevé ↔ grand-livre (table accounting_reconciliations).'
            : 'Soldes par compte de trésorerie : à compléter avec le marquage is_cash_flow_register sur le plan comptable et les mouvements bancaires.'}
        </p>
      </header>
      {focus !== 'rapprochements' ? (
        <div className={`${card} p-8 text-center text-sm text-slate-600`}>
          Vue détaillée « {focusLabel} » : pas d’agrégat dédié en base hors rapprochements. Utilisez le tableau de flux ou le grand livre filtré sur les comptes de trésorerie.
        </div>
      ) : null}
      {err ? <p className="text-sm text-amber-700">{err}</p> : null}
      <div className={`${card} overflow-hidden`}>
        <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-slate-800">Rapprochements</h4>
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs font-medium text-coya-primary hover:underline"
          >
            Actualiser
          </button>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-slate-500">Chargement…</p>
        ) : rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-600">Aucun rapprochement enregistré.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Réf. relevé</th>
                <th className="px-4 py-2 font-medium">Date relevé</th>
                <th className="px-4 py-2 text-right font-medium">Relevé</th>
                <th className="px-4 py-2 text-right font-medium">Comptable</th>
                <th className="px-4 py-2 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-mono text-xs">{r.statementReference}</td>
                  <td className="px-4 py-2">{r.statementDate}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.statementBalance)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(r.bookBalance)}</td>
                  <td className="px-4 py-2 text-slate-600">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export const AccountingComptaGeneraleView: React.FC<{
  organizationId: string | null;
  focus: AccountingComptaFocus;
}> = ({ organizationId, focus }) => {
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [journals, setJournals] = useState<AccountingJournal[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setErr(null);
    try {
      const [a, j, c] = await Promise.all([
        comptabiliteService.listChartOfAccounts(organizationId),
        comptabiliteService.listAccountingJournals(organizationId),
        comptabiliteService.listCostCenters(organizationId),
      ]);
      setAccounts(a);
      setJournals(j);
      setCenters(c);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur chargement');
      setAccounts([]);
      setJournals([]);
      setCenters([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!organizationId) {
    return <AccountingRouteEmpty title="Comptabilité générale" message="Organisation requise." />;
  }

  const title =
    focus === 'plan_comptable' ? 'Plan comptable' : focus === 'analytique' ? 'Analytique' : 'Centres de coûts';

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <p className="text-sm text-slate-500 mt-1">Données Supabase (RLS organisation).</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
        >
          Actualiser
        </button>
      </header>
      {err ? <p className="text-sm text-amber-700">{err}</p> : null}
      {loading ? (
        <p className="text-sm text-slate-500">Chargement…</p>
      ) : null}

      {(focus === 'plan_comptable' || focus === 'analytique') && (
        <div className={`${card} overflow-hidden`}>
          <div className="border-b border-slate-200 px-4 py-3">
            <h4 className="text-sm font-semibold text-slate-800">Plan comptable ({accounts.length} comptes)</h4>
          </div>
          {accounts.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">Aucun compte. Initialisez le plan (template SYSCOHADA / SYCEBNL) depuis les migrations ou l’admin.</p>
          ) : (
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Code</th>
                    <th className="px-4 py-2 font-medium">Libellé</th>
                    <th className="px-4 py-2 font-medium">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts
                    .slice()
                    .sort((x, y) => x.code.localeCompare(y.code))
                    .map((a) => (
                      <tr key={a.id}>
                        <td className="px-4 py-2 font-mono text-xs text-slate-900">{a.code}</td>
                        <td className="px-4 py-2 text-slate-800">{a.label}</td>
                        <td className="px-4 py-2 text-slate-500">{a.accountType}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {(focus === 'analytique' || focus === 'centres_couts') && (
        <div className={`${card} overflow-hidden`}>
          <div className="border-b border-slate-200 px-4 py-3">
            <h4 className="text-sm font-semibold text-slate-800">Centres de coûts ({centers.length})</h4>
          </div>
          {centers.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">Aucun centre de coût.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Libellé</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {centers.map((c) => (
                  <tr key={c.id}>
                    <td className="px-4 py-2 font-mono text-xs">{c.code}</td>
                    <td className="px-4 py-2">{c.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {focus === 'plan_comptable' && (
        <div className={`${card} overflow-hidden`}>
          <div className="border-b border-slate-200 px-4 py-3">
            <h4 className="text-sm font-semibold text-slate-800">Journaux ({journals.length})</h4>
          </div>
          {journals.length === 0 ? (
            <p className="p-6 text-sm text-slate-600">Aucun journal comptable.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Nom</th>
                  <th className="px-4 py-2 font-medium">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {journals.map((j) => (
                  <tr key={j.id}>
                    <td className="px-4 py-2 font-mono text-xs">{j.code}</td>
                    <td className="px-4 py-2">{j.name}</td>
                    <td className="px-4 py-2 text-slate-500">{j.journalType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export const AccountingRapportsView: React.FC<{
  organizationId: string | null;
  mode: AccountingReportMode;
}> = ({ organizationId, mode }) => {
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [balances, setBalances] = useState<
    Array<{ accountId: string; code: string; label: string; accountType: string; debit: number; credit: number; balance: number }>
  >([]);
  const [bilan, setBilan] = useState<Awaited<ReturnType<typeof comptabiliteService.getBalanceSheet>> | null>(null);
  const [cr, setCr] = useState<Awaited<ReturnType<typeof comptabiliteService.getIncomeStatement>> | null>(null);
  const [flux, setFlux] = useState<Awaited<ReturnType<typeof comptabiliteService.getCashFlowStatement>> | null>(null);

  const title =
    mode === 'grand_livre'
      ? 'Grand livre (soldes par compte)'
      : mode === 'balance'
        ? 'Balance des comptes'
        : mode === 'bilan'
          ? 'Bilan'
          : mode === 'compte_resultat'
            ? 'Compte de résultat'
            : 'Tableau de flux de trésorerie';

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setErr(null);
    try {
      if (mode === 'grand_livre' || mode === 'balance') {
        const b = await comptabiliteService.getAccountBalances({ organizationId, dateFrom, dateTo });
        setBalances(b.sort((x, y) => x.code.localeCompare(y.code)));
        setBilan(null);
        setCr(null);
        setFlux(null);
      } else if (mode === 'bilan') {
        const data = await comptabiliteService.getBalanceSheet(organizationId, dateTo);
        setBilan(data);
        setBalances([]);
        setCr(null);
        setFlux(null);
      } else if (mode === 'compte_resultat') {
        const data = await comptabiliteService.getIncomeStatement(organizationId, dateFrom, dateTo);
        setCr(data);
        setBalances([]);
        setBilan(null);
        setFlux(null);
      } else {
        const data = await comptabiliteService.getCashFlowStatement(organizationId, dateFrom, dateTo);
        setFlux(data);
        setBalances([]);
        setBilan(null);
        setCr(null);
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Erreur chargement rapport');
      setBalances([]);
      setBilan(null);
      setCr(null);
      setFlux(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId, mode, dateFrom, dateTo]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!organizationId) {
    return <AccountingRouteEmpty title={title} message="Organisation requise pour calculer les soldes." />;
  }

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-500 mt-1">Calculs issus des écritures validées sur la période (getAccountBalances / rapports SYSCOHADA).</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        {mode !== 'bilan' ? (
          <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
            Du
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
          {mode === 'bilan' ? 'À la date du' : 'Au'}
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
        >
          Actualiser
        </button>
      </div>

      {err ? <p className="text-sm text-amber-700">{err}</p> : null}

      {loading ? <p className="text-sm text-slate-500">Chargement…</p> : null}

      {(mode === 'grand_livre' || mode === 'balance') && !loading && (
        <div className={`${card} overflow-hidden`}>
          {balances.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-600">Aucune écriture sur cette période — balance vide.</p>
          ) : (
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Compte</th>
                    <th className="px-4 py-2 text-right font-medium">Débit</th>
                    <th className="px-4 py-2 text-right font-medium">Crédit</th>
                    <th className="px-4 py-2 text-right font-medium">Solde</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balances.map((b) => (
                    <tr key={b.accountId}>
                      <td className="px-4 py-2">
                        <span className="font-mono text-xs text-slate-800">{b.code}</span>
                        <span className="text-slate-600"> · {b.label}</span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(b.debit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(b.credit)}</td>
                      <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtMoney(b.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {mode === 'bilan' && bilan && !loading && (
        <div className="space-y-3">
          <div className="grid gap-4 md:grid-cols-3">
            {(
              [
                { label: 'Actif', rows: bilan.assets, total: bilan.totalAssets },
                {
                  label: 'Passif',
                  rows: bilan.liabilities,
                  total: bilan.liabilities.reduce((s, x) => s + x.balance, 0),
                },
                {
                  label: 'Capitaux propres',
                  rows: bilan.equity,
                  total: bilan.equity.reduce((s, x) => s + x.balance, 0),
                },
              ] as const
            ).map((block) => (
              <div key={block.label} className={card}>
                <div className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-800">{block.label}</div>
                <div className="max-h-64 overflow-auto">
                  {block.rows.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">Aucune ligne.</p>
                  ) : (
                    <table className="w-full text-xs">
                      <tbody>
                        {block.rows.map((r) => (
                          <tr key={`${block.label}-${r.code}`} className="border-b border-slate-100">
                            <td className="px-3 py-1.5 text-slate-700">
                              {r.code} · {r.label}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtMoney(r.balance)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="border-t border-slate-200 px-4 py-2 text-right text-sm font-semibold text-slate-900">
                  Sous-total {fmtMoney(block.total)}
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Total actif {fmtMoney(bilan.totalAssets)} · Total passif + capitaux propres (agrégat service){' '}
            {fmtMoney(bilan.totalLiabilitiesAndEquity)}
          </p>
        </div>
      )}

      {mode === 'compte_resultat' && cr && !loading && (
        <div className="grid gap-4 md:grid-cols-2">
          <div className={card}>
            <div className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-800">Produits</div>
            <div className="max-h-64 overflow-auto text-sm">
              {cr.income.length === 0 ? (
                <p className="p-4 text-slate-500">Aucun produit sur la période.</p>
              ) : (
                cr.income.map((r) => (
                  <div key={r.code} className="flex justify-between border-b border-slate-100 px-4 py-2">
                    <span className="text-slate-700">
                      {r.code} · {r.label}
                    </span>
                    <span className="tabular-nums">{fmtMoney(r.balance)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-slate-200 px-4 py-2 text-right font-semibold">Total {fmtMoney(cr.totalIncome)}</div>
          </div>
          <div className={card}>
            <div className="border-b border-slate-200 px-4 py-2 font-semibold text-slate-800">Charges</div>
            <div className="max-h-64 overflow-auto text-sm">
              {cr.expense.length === 0 ? (
                <p className="p-4 text-slate-500">Aucune charge sur la période.</p>
              ) : (
                cr.expense.map((r) => (
                  <div key={r.code} className="flex justify-between border-b border-slate-100 px-4 py-2">
                    <span className="text-slate-700">
                      {r.code} · {r.label}
                    </span>
                    <span className="tabular-nums">{fmtMoney(r.balance)}</span>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-slate-200 px-4 py-2 text-right font-semibold">Total {fmtMoney(cr.totalExpense)}</div>
          </div>
          <p className="md:col-span-2 text-sm font-medium text-slate-800">
            Résultat : {fmtMoney(cr.result)} (produits − charges selon soldes période)
          </p>
        </div>
      )}

      {mode === 'flux' && flux && !loading && (
        <div className={`${card} p-6 space-y-4`}>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-xs uppercase text-slate-500">Trésorerie ouverture</p>
              <p className="text-lg font-semibold tabular-nums">{fmtMoney(flux.openingCash)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Trésorerie clôture</p>
              <p className="text-lg font-semibold tabular-nums">{fmtMoney(flux.closingCash)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Mouvement période</p>
              <p className="text-lg font-semibold tabular-nums">{fmtMoney(flux.periodMovement)}</p>
            </div>
          </div>
          {flux.details.length === 0 ? (
            <p className="text-sm text-slate-600">
              Aucun compte marqué « registre de trésorerie » (is_cash_flow_register). Paramétrez le plan comptable pour
              alimenter ce tableau.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2 font-medium">Compte</th>
                  <th className="py-2 text-right font-medium">Ouverture</th>
                  <th className="py-2 text-right font-medium">Clôture</th>
                  <th className="py-2 text-right font-medium">Mouvement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {flux.details.map((d) => (
                  <tr key={d.code}>
                    <td className="py-2">
                      <span className="font-mono text-xs">{d.code}</span> · {d.label}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtMoney(d.opening)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtMoney(d.closing)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtMoney(d.movement)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
};

export const AccountingParametresView: React.FC<{ organizationId: string | null }> = ({ organizationId }) => {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof comptabiliteService.getOrganizationAccountingSettings>>>(null);
  const [fiscalYears, setFiscalYears] = useState<Awaited<ReturnType<typeof comptabiliteService.listFiscalYears>>>([]);
  const [perms, setPerms] = useState<Awaited<ReturnType<typeof comptabiliteService.getAccountingPermissions>>>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const [s, fy, p] = await Promise.all([
        comptabiliteService.getOrganizationAccountingSettings(organizationId),
        comptabiliteService.listFiscalYears(organizationId),
        comptabiliteService.getAccountingPermissions(organizationId),
      ]);
      setSettings(s);
      setFiscalYears(fy);
      setPerms(p);
    } catch {
      setSettings(null);
      setFiscalYears([]);
      setPerms([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!organizationId) {
    return <AccountingRouteEmpty title="Paramètres" message="Organisation requise." />;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Paramètres & accès</h3>
          <p className="text-sm text-slate-500 mt-1">Cadre comptable, exercices, droits métier (tables Supabase).</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100"
        >
          Actualiser
        </button>
      </header>

      {loading ? <p className="text-sm text-slate-500">Chargement…</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className={card + ' p-5'}>
          <h4 className="text-sm font-semibold text-slate-900">Cadre comptable</h4>
          <p className="mt-2 text-sm text-slate-600">
            {settings?.accountingFramework
              ? `Référentiel : ${settings.accountingFramework}`
              : 'Aucun cadre enregistré (organization_accounting_settings).'}
          </p>
        </div>
        <div className={card + ' p-5'}>
          <h4 className="text-sm font-semibold text-slate-900">Exercices fiscaux</h4>
          {fiscalYears.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">Aucun exercice.</p>
          ) : (
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {fiscalYears.map((fy) => (
                <li key={fy.id} className="flex justify-between gap-2">
                  <span>{fy.label}</span>
                  <span className="text-slate-500 text-xs">
                    {fy.dateStart} → {fy.dateEnd}
                    {fy.isClosed ? ' · clôturé' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className={card + ' p-5'}>
        <h4 className="text-sm font-semibold text-slate-900">Droits comptabilité ({perms.length})</h4>
        {perms.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">Aucune ligne accounting_permissions pour cette organisation.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-slate-700 font-mono">
            {perms.map((p) => (
              <li key={p.id}>
                {p.userId?.slice(0, 8)}… — {p.role}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
