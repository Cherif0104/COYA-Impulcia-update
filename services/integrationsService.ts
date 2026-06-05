import { supabase } from './supabaseService';

export type ExternalIntegrationProvider =
  | 'atlassian'
  | 'monday'
  | 'google_drive'
  | 'odoo_sync'
  | 'hubspot'
  | 'daily_co'
  | 'agora'
  | 'twilio'
  | 'novu'
  | 'yousign'
  | 'formbricks'
  | 'cal_com'
  | 'meta'
  | 'resend'
  | 'other';

export type ExternalIntegrationStatus = 'inactive' | 'active' | 'error';

export type ExternalIntegration = {
  id: string;
  organizationId: string;
  provider: ExternalIntegrationProvider;
  status: ExternalIntegrationStatus;
  displayName: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function mapRow(row: Record<string, unknown>): ExternalIntegration {
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    provider: row.provider as ExternalIntegrationProvider,
    status: row.status as ExternalIntegrationStatus,
    displayName: (row.display_name as string | null) ?? null,
    config: (row.config as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function listIntegrations(organizationId: string): Promise<ExternalIntegration[]> {
  const { data, error } = await supabase
    .from('coya_external_integrations')
    .select('*')
    .eq('organization_id', organizationId)
    .order('provider', { ascending: true });
  if (error) throw error;
  return (data || []).map(mapRow);
}

export async function upsertIntegration(input: {
  organizationId: string;
  provider: ExternalIntegrationProvider;
  status?: ExternalIntegrationStatus;
  displayName?: string | null;
  config?: Record<string, unknown>;
}): Promise<ExternalIntegration> {
  const payload = {
    organization_id: input.organizationId,
    provider: input.provider,
    status: input.status ?? 'inactive',
    display_name: input.displayName ?? null,
    config: input.config ?? {},
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('coya_external_integrations')
    .upsert(payload, { onConflict: 'organization_id,provider' })
    .select('*')
    .single();
  if (error) throw error;
  return mapRow(data);
}

export async function getIntegration(
  organizationId: string,
  provider: ExternalIntegrationProvider,
): Promise<ExternalIntegration | null> {
  const { data, error } = await supabase
    .from('coya_external_integrations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw error;
  return data ? mapRow(data) : null;
}
