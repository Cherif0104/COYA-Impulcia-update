import { supabase } from './supabaseService';
import type {
  MobilityIntentRoute,
  MobilityRequest,
  MobilityRequestStatus,
  MobilityTripType,
} from '../types';

function mapRow(row: Record<string, unknown>): MobilityRequest {
  const rawParticipants = row.participant_profile_ids;
  const participantProfileIds = Array.isArray(rawParticipants)
    ? rawParticipants.map((x) => String(x))
    : [];

  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    createdByProfileId: String(row.created_by_profile_id),
    status: row.status as MobilityRequestStatus,
    intentRoute: (row.intent_route as MobilityIntentRoute | null) ?? null,
    passengerCount: Number(row.passenger_count ?? 1),
    tripType: row.trip_type as MobilityTripType,
    projectId: row.project_id != null ? String(row.project_id) : null,
    programmeId: row.programme_id != null ? String(row.programme_id) : null,
    participantProfileIds,
    title: String(row.title ?? ''),
    notes: row.notes != null ? String(row.notes) : null,
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

export async function listByOrg(organizationId: string): Promise<MobilityRequest[]> {
  const { data, error } = await supabase
    .from('mobility_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('mobilityRequestService.listByOrg', error.message);
    return [];
  }
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function listFilteredByProjectId(
  organizationId: string,
  projectId: string,
): Promise<MobilityRequest[]> {
  const { data, error } = await supabase
    .from('mobility_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('mobilityRequestService.listFilteredByProjectId', error.message);
    return [];
  }
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function listFilteredByProgrammeId(
  organizationId: string,
  programmeId: string,
): Promise<MobilityRequest[]> {
  const { data, error } = await supabase
    .from('mobility_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('programme_id', programmeId)
    .order('created_at', { ascending: false });
  if (error) {
    console.warn('mobilityRequestService.listFilteredByProgrammeId', error.message);
    return [];
  }
  return (data || []).map((r) => mapRow(r as Record<string, unknown>));
}

export async function getById(id: string): Promise<MobilityRequest | null> {
  const { data, error } = await supabase.from('mobility_requests').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return mapRow(data as Record<string, unknown>);
}

export type MobilityDraftInput = {
  title: string;
  notes?: string | null;
  passengerCount: number;
  tripType: MobilityTripType;
  intentRoute: MobilityIntentRoute | null;
  projectId?: string | null;
  programmeId?: string | null;
  participantProfileIds?: string[];
};

export async function createDraft(
  organizationId: string,
  createdByProfileId: string,
  input: MobilityDraftInput,
): Promise<MobilityRequest | null> {
  const payload = {
    organization_id: organizationId,
    created_by_profile_id: createdByProfileId,
    status: 'draft' as const,
    title: input.title.trim() || 'Sans titre',
    notes: input.notes?.trim() || null,
    passenger_count: input.passengerCount,
    trip_type: input.tripType,
    intent_route: input.intentRoute,
    project_id: input.projectId || null,
    programme_id: input.programmeId || null,
    participant_profile_ids: input.participantProfileIds ?? [],
  };
  const { data, error } = await supabase.from('mobility_requests').insert(payload).select('*').single();
  if (error) {
    console.warn('mobilityRequestService.createDraft', error.message);
    return null;
  }
  return mapRow(data as Record<string, unknown>);
}

export async function updateDraft(id: string, patch: Partial<MobilityDraftInput>): Promise<MobilityRequest | null> {
  const row: Record<string, unknown> = {};
  if (patch.title !== undefined) row.title = patch.title.trim() || 'Sans titre';
  if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
  if (patch.passengerCount !== undefined) row.passenger_count = patch.passengerCount;
  if (patch.tripType !== undefined) row.trip_type = patch.tripType;
  if (patch.intentRoute !== undefined) row.intent_route = patch.intentRoute;
  if (patch.projectId !== undefined) row.project_id = patch.projectId || null;
  if (patch.programmeId !== undefined) row.programme_id = patch.programmeId || null;
  if (patch.participantProfileIds !== undefined) row.participant_profile_ids = patch.participantProfileIds;

  const { data, error } = await supabase.from('mobility_requests').update(row).eq('id', id).select('*').single();
  if (error) {
    console.warn('mobilityRequestService.updateDraft', error.message);
    return null;
  }
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}

export async function submit(id: string): Promise<MobilityRequest | null> {
  const { data, error } = await supabase
    .from('mobility_requests')
    .update({ status: 'submitted' })
    .eq('id', id)
    .eq('status', 'draft')
    .select('*')
    .single();
  if (error) {
    console.warn('mobilityRequestService.submit', error.message);
    return null;
  }
  if (!data) return null;
  return mapRow(data as Record<string, unknown>);
}
