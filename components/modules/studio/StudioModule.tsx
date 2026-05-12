import React, { useEffect, useMemo, useState } from 'react';
import { useLocalization } from '../../../contexts/LocalizationContext';
import * as studioService from '../../../services/studioService';
import ModuleRichHub from '../../common/ModuleRichHub';

type TabKey = 'overview' | 'assets' | 'investments' | 'pricing' | 'requests' | 'contracts' | 'team';

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'overview', label: 'Vue d’ensemble', icon: 'fas fa-chart-pie' },
  { key: 'assets', label: 'Équipements', icon: 'fas fa-camera' },
  { key: 'investments', label: 'Investissements & amortissement', icon: 'fas fa-coins' },
  { key: 'pricing', label: 'Tarification', icon: 'fas fa-tags' },
  { key: 'requests', label: 'Demandes/Devis', icon: 'fas fa-file-signature' },
  { key: 'contracts', label: 'Contrats & factures', icon: 'fas fa-file-invoice' },
  { key: 'team', label: 'Équipe', icon: 'fas fa-users' },
];

function money(cents: number, currency = 'XOF') {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'XOF' ? 0 : 2,
  }).format((cents || 0) / 100);
}

const StudioModule: React.FC = () => {
  const { language } = useLocalization();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState<studioService.StudioDashboard>({
    assets: [],
    pricingRules: [],
    bookings: [],
    investments: [],
    team: [],
  });

  const isFr = language === 'fr';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    studioService
      .loadStudioDashboard()
      .then((data) => {
        if (!cancelled) setDashboard(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const metrics = useMemo(() => {
    const assetValue = dashboard.assets.reduce((sum, asset) => sum + asset.purchaseCostCents, 0);
    const netValue = dashboard.assets.reduce((sum, asset) => sum + (asset.netBookValueCents ?? asset.purchaseCostCents), 0);
    const pendingBookings = dashboard.bookings.filter((b) => ['requested', 'quoted'].includes(b.status)).length;
    const activePricing = dashboard.pricingRules.filter((r) => r.active).length;
    return { assetValue, netValue, pendingBookings, activePricing };
  }, [dashboard]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-500 p-8">
        <span className="animate-spin rounded-full h-5 w-5 border-2 border-purple-500 border-t-transparent" />
        <span>{isFr ? 'Chargement du studio...' : 'Loading studio...'}</span>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 text-slate-900">
      <header className="rounded-2xl border border-purple-100 bg-gradient-to-br from-purple-50 via-white to-emerald-50 p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-700">COYA Studio</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-950">
              {isFr ? 'Studio' : 'Studio'}
            </h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              {isFr
                ? 'Gestion des sites, équipements, investissements, amortissements, tarifs, demandes, devis, contrats, factures et équipe responsable.'
                : 'Sites, equipment, investments, depreciation, prices, requests, quotes, contracts, invoices and team ownership.'}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Metric label="Actifs" value={dashboard.assets.length.toString()} />
            <Metric label="Valeur brute" value={money(metrics.assetValue)} />
            <Metric label="Valeur nette" value={money(metrics.netValue)} />
            <Metric label="Demandes" value={metrics.pendingBookings.toString()} />
          </div>
        </div>
      </header>

      <ModuleRichHub
        isFr={isFr}
        metrics={[
          {
            labelFr: 'Actifs studio',
            labelEn: 'Studio assets',
            value: String(dashboard.assets.length),
            hintFr: 'Équipements suivis',
            hintEn: 'Tracked equipment',
          },
          {
            labelFr: 'Demandes / devis ouverts',
            labelEn: 'Open quotes / requests',
            value: String(metrics.pendingBookings),
            hintFr: 'Statuts requested + quoted',
            hintEn: 'requested + quoted statuses',
          },
          {
            labelFr: 'Règles tarifaires actives',
            labelEn: 'Active pricing rules',
            value: String(metrics.activePricing),
            hintFr: 'Tarification location / prestation',
            hintEn: 'Rental / service pricing',
          },
          {
            labelFr: 'Valeur nette comptable',
            labelEn: 'Net book value',
            value: money(metrics.netValue),
            hintFr: 'Amortissements intégrés',
            hintEn: 'Depreciation included',
          },
        ]}
        sections={[
          {
            key: 'studio-links',
            titleFr: 'Studio dans l’écosystème',
            titleEn: 'Studio in the ecosystem',
            icon: 'fas fa-video',
            bulletsFr: [
              'APEX : contenus pédagogiques et médias de formation.',
              'Logistique : matériel partagé hors tournage (stock).',
              'Drive : masters export et livrables clients.',
            ],
            bulletsEn: [
              'APEX: learning content and training media.',
              'Logistics: shared non-shoot equipment (stock).',
              'Drive: export masters and client deliverables.',
            ],
          },
        ]}
      />

      <nav className="flex gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium transition ${
              activeTab === tab.key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <i className={`${tab.icon} mr-2 text-xs`} />
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <section className="grid gap-4 lg:grid-cols-3">
          <Panel title="Portefeuille studio" icon="fas fa-chart-line">
            <p className="text-sm text-slate-600">
              {dashboard.assets.length} équipement(s), {dashboard.pricingRules.length} règle(s) de prix,
              {' '}{dashboard.team.length} responsable(s).
            </p>
          </Panel>
          <Panel title="Amortissement" icon="fas fa-calculator">
            <p className="text-sm text-slate-600">
              Valeur nette estimée : <strong>{money(metrics.netValue)}</strong>. Calcul linéaire côté base via
              {' '}<code>studio_asset_depreciation_projection</code>.
            </p>
          </Panel>
          <Panel title="Commercial" icon="fas fa-handshake">
            <p className="text-sm text-slate-600">
              {metrics.pendingBookings} demande(s) à convertir en devis. Les devis/factures peuvent alimenter le journal CRM.
            </p>
          </Panel>
        </section>
      )}

      {activeTab === 'assets' && (
        <DataTable
          headers={['Équipement', 'Catégorie', 'Statut', 'Valeur brute', 'Valeur nette']}
          rows={dashboard.assets.map((asset) => [
            asset.name,
            asset.category,
            asset.status,
            money(asset.purchaseCostCents),
            money(asset.netBookValueCents ?? asset.purchaseCostCents),
          ])}
          empty="Aucun équipement studio enregistré."
        />
      )}

      {activeTab === 'investments' && (
        <DataTable
          headers={['Date', 'Type', 'Fournisseur', 'Montant', 'Pièce']}
          rows={dashboard.investments.map((entry) => [
            entry.entryDate,
            entry.entryType,
            entry.vendorName || '—',
            money(entry.amountCents, entry.currency),
            entry.invoiceStoragePath ? 'Stockée' : '—',
          ])}
          empty="Aucune écriture d’investissement."
        />
      )}

      {activeTab === 'pricing' && (
        <DataTable
          headers={['Règle', 'Unité', 'Prix de base', 'Statut']}
          rows={dashboard.pricingRules.map((rule) => [
            rule.name,
            rule.unit,
            money(rule.basePriceCents, rule.currency),
            rule.active ? 'Active' : 'Inactive',
          ])}
          empty="Aucune règle tarifaire."
        />
      )}

      {activeTab === 'requests' && (
        <DataTable
          headers={['Objet', 'Statut', 'Début', 'Fin']}
          rows={dashboard.bookings.map((booking) => [
            booking.purpose || 'Demande studio',
            booking.status,
            booking.startsAt?.slice(0, 16) || '—',
            booking.endsAt?.slice(0, 16) || '—',
          ])}
          empty="Aucune demande/devis studio."
        />
      )}

      {activeTab === 'contracts' && (
        <Panel title="Contrats & factures" icon="fas fa-file-invoice-dollar">
          <p className="text-sm text-slate-600">
            Le socle base de données est en place pour contrats, factures, métadonnées et chemins de stockage.
            Les écrans de création détaillés peuvent être ajoutés sur les tables <code>studio_contracts</code> et
            {' '}<code>studio_invoices</code>.
          </p>
        </Panel>
      )}

      {activeTab === 'team' && (
        <DataTable
          headers={['Nom', 'Rôle', 'Email', 'Téléphone', 'Statut']}
          rows={dashboard.team.map((member) => [
            member.displayName,
            member.role,
            member.email || '—',
            member.phone || '—',
            member.active ? 'Actif' : 'Inactif',
          ])}
          empty="Aucun responsable studio."
        />
      )}
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-xl border border-white/80 bg-white/80 px-3 py-2 shadow-sm">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-0.5 text-base font-bold text-slate-950">{value}</p>
  </div>
);

const Panel: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({ title, icon, children }) => (
  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="mb-2 flex items-center gap-2 text-base font-semibold text-slate-900">
      <i className={`${icon} text-purple-600`} />
      {title}
    </h2>
    {children}
  </section>
);

const DataTable: React.FC<{ headers: string[]; rows: string[][]; empty: string }> = ({ headers, rows, empty }) => (
  <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row, index) => (
            <tr key={`${row.join('-')}-${index}`} className="hover:bg-slate-50">
              {row.map((cell, cellIndex) => (
                <td key={`${cell}-${cellIndex}`} className="px-4 py-3 text-slate-700">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="px-4 py-8 text-center text-sm text-slate-500">{empty}</div>}
    </div>
  </section>
);

export default StudioModule;
