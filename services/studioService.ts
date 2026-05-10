import { supabase } from './supabaseService';
import OrganizationService from './organizationService';

export type StudioBookingStatus = 'requested' | 'quoted' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
export type StudioInvoiceStatus = 'draft' | 'sent' | 'partially_paid' | 'paid' | 'cancelled' | 'overdue';

export interface StudioAsset {
  id: string;
  organizationId: string;
  studioSiteId?: string | null;
  name: string;
  category: string;
  brand?: string | null;
  model?: string | null;
  assetReference?: string | null;
  acquisitionDate: string;
  purchaseCostCents: number;
  salvageValueCents: number;
  usefulLifeYears: number;
  status: string;
  custodianProfileId?: string | null;
  netBookValueCents?: number;
  accumulatedDepreciationCents?: number;
}

export interface StudioPricingRule {
  id: string;
  name: string;
  unit: 'hour' | 'day' | 'session' | 'project';
  basePriceCents: number;
  currency: string;
  active: boolean;
}

export interface StudioBooking {
  id: string;
  status: StudioBookingStatus;
  startsAt?: string | null;
  endsAt?: string | null;
  purpose?: string | null;
}

export interface StudioInvestment {
  id: string;
  studioAssetId?: string | null;
  entryDate: string;
  entryType: string;
  amountCents: number;
  currency: string;
  vendorName?: string | null;
  invoiceStoragePath?: string | null;
}

export interface StudioTeamMember {
  id: string;
  displayName: string;
  role: string;
  email?: string | null;
  phone?: string | null;
  active: boolean;
}

export interface StudioDashboard {
  assets: StudioAsset[];
  pricingRules: StudioPricingRule[];
  bookings: StudioBooking[];
  investments: StudioInvestment[];
  team: StudioTeamMember[];
}

function cents(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function mapAsset(row: any, depreciation?: any): StudioAsset {
  return {
    id: row.id,
    organizationId: row.organization_id,
    studioSiteId: row.studio_site_id ?? null,
    name: row.name,
    category: row.category ?? 'equipment',
    brand: row.brand ?? null,
    model: row.model ?? null,
    assetReference: row.asset_reference ?? null,
    acquisitionDate: row.acquisition_date,
    purchaseCostCents: cents(row.purchase_cost_cents),
    salvageValueCents: cents(row.salvage_value_cents),
    usefulLifeYears: Number(row.useful_life_years ?? 5),
    status: row.status ?? 'active',
    custodianProfileId: row.custodian_profile_id ?? null,
    netBookValueCents: depreciation ? cents(depreciation.net_book_value_cents) : undefined,
    accumulatedDepreciationCents: depreciation ? cents(depreciation.accumulated_depreciation_cents) : undefined,
  };
}

export function projectStraightLineDepreciation(params: {
  purchaseCostCents: number;
  salvageValueCents?: number;
  usefulLifeYears?: number;
  acquisitionDate?: string;
}) {
  const usefulLifeYears = Math.max(Number(params.usefulLifeYears ?? 5), 0.01);
  const salvage = Math.max(Number(params.salvageValueCents ?? 0), 0);
  const depreciable = Math.max(Number(params.purchaseCostCents ?? 0) - salvage, 0);
  const monthly = Math.round(depreciable / (usefulLifeYears * 12));
  const acquisition = params.acquisitionDate ? new Date(params.acquisitionDate) : new Date();
  const now = new Date();
  const elapsedMonths = Math.max(
    0,
    (now.getFullYear() - acquisition.getFullYear()) * 12 + (now.getMonth() - acquisition.getMonth()),
  );
  const accumulated = Math.min(depreciable, monthly * elapsedMonths);
  return {
    depreciableAmountCents: depreciable,
    monthlyDepreciationCents: monthly,
    annualDepreciationCents: monthly * 12,
    accumulatedDepreciationCents: accumulated,
    netBookValueCents: Math.max(Number(params.purchaseCostCents ?? 0) - accumulated, salvage),
  };
}

export async function loadStudioDashboard(organizationId?: string | null): Promise<StudioDashboard> {
  const orgId = organizationId || (await OrganizationService.getCurrentUserOrganizationId());
  if (!orgId) return { assets: [], pricingRules: [], bookings: [], investments: [], team: [] };

  const [assetsRes, depreciationRes, pricingRes, bookingsRes, investmentsRes, teamRes] = await Promise.all([
    supabase.from('studio_assets').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('studio_asset_depreciation_projection').select('*').eq('organization_id', orgId),
    supabase.from('studio_pricing_rules').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('studio_bookings').select('*').eq('organization_id', orgId).order('created_at', { ascending: false }),
    supabase.from('studio_investment_ledger').select('*').eq('organization_id', orgId).order('entry_date', { ascending: false }),
    supabase.from('studio_responsible_persons').select('*').eq('organization_id', orgId).order('display_name'),
  ]);

  const depreciationByAsset = new Map((depreciationRes.data || []).map((r: any) => [r.studio_asset_id, r]));
  return {
    assets: (assetsRes.data || []).map((r: any) => mapAsset(r, depreciationByAsset.get(r.id))),
    pricingRules: (pricingRes.data || []).map((r: any) => ({
      id: r.id,
      name: r.name,
      unit: r.unit,
      basePriceCents: cents(r.base_price_cents),
      currency: r.currency ?? 'XOF',
      active: r.active !== false,
    })),
    bookings: (bookingsRes.data || []).map((r: any) => ({
      id: r.id,
      status: r.status ?? 'requested',
      startsAt: r.starts_at ?? null,
      endsAt: r.ends_at ?? null,
      purpose: r.purpose ?? null,
    })),
    investments: (investmentsRes.data || []).map((r: any) => ({
      id: r.id,
      studioAssetId: r.studio_asset_id ?? null,
      entryDate: r.entry_date,
      entryType: r.entry_type ?? 'purchase',
      amountCents: cents(r.amount_cents),
      currency: r.currency ?? 'XOF',
      vendorName: r.vendor_name ?? null,
      invoiceStoragePath: r.invoice_storage_path ?? null,
    })),
    team: (teamRes.data || []).map((r: any) => ({
      id: r.id,
      displayName: r.display_name,
      role: r.role ?? 'responsable',
      email: r.email ?? null,
      phone: r.phone ?? null,
      active: r.active !== false,
    })),
  };
}
