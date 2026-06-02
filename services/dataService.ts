import { supabase } from './supabaseService';
import { ApiHelper, isLikelyPostgrestSelectError } from './apiHelper';
import {
  Project,
  Invoice,
  Expense,
  Contact,
  TimeLog,
  LeaveRequest,
  Course,
  Objective,
  Document,
  CurrencyCode,
  PresenceSession,
  PresenceStatus,
  Employee,
  EmployeeHrAttachment,
  PresenceStatusEvent,
  HrAttendancePolicy,
  HrWorkforceAnomaly,
  WorkMode,
  WorkforceTimelineSegmentRow,
  EmployeeWorkSchedule,
  Meeting,
} from '../types';
import OrganizationService from './organizationService';
import DepartmentService from './departmentService';
import { CurrencyService } from './currencyService';
import { handleOptionalTableError, isMissingTableError, isTableUnavailable } from './optionalTableGuard';
import { logger } from './loggerService';
import { derivePersistedInvoiceStatus } from './invoiceDerivedStatus';

/** Évite de spammer la console si la table notifications existe mais refuse lecture/écriture (RLS / 403). */
let notificationAccessDeniedWarned = false;

function isNotificationWriteDenied(error: unknown): boolean {
  const e = error as { code?: string; message?: string; status?: number; statusCode?: number };
  const status = e?.status ?? (e as any)?.statusCode;
  const code = String(e?.code || '');
  const msg = String(e?.message || '').toLowerCase();
  if (status === 403 || status === 401) return true;
  if (code === '42501') return true;
  if (msg.includes('permission denied') || msg.includes('row-level security') || msg.includes('rls')) return true;
  return false;
}

/** Contrainte unique (ex. idx_notifications_workflow_user_event) — doublon attendu, pas une erreur métier. */
function isDuplicateNotificationInsert(error: unknown): boolean {
  const e = error as { code?: string; message?: string };
  const code = String(e?.code || '');
  if (code === '23505') return true;
  const msg = String(e?.message || '').toLowerCase();
  return msg.includes('duplicate key') || msg.includes('unique constraint');
}

/** Statut UI CRM (PascalCase) → valeur colonne `contacts.status` Supabase */
const CONTACT_UI_STATUS_TO_DB: Record<string, string> = {
  Lead: 'lead',
  Contacted: 'contacted',
  Unreachable: 'unreachable',
  CallbackExpected: 'callback_expected',
  Prospect: 'prospect',
  Customer: 'customer',
};

/** Valeurs autorisées par `contacts_status_check` (aligné migration `20260424170000_contacts_status_check_crm.sql`). */
const CONTACT_STATUS_DB_ALLOWED = new Set([
  'lead',
  'contacted',
  'unreachable',
  'callback_expected',
  'prospect',
  'customer',
]);

function contactStatusUiToDb(status: string | undefined): string {
  if (!status) return 'lead';
  const mapped = CONTACT_UI_STATUS_TO_DB[status] ?? String(status).trim().toLowerCase().replace(/\s+/g, '_');
  if (CONTACT_STATUS_DB_ALLOWED.has(mapped)) return mapped;
  return 'lead';
}

/** Prénom / nom à partir du modèle CRM (`name`) ou champs legacy firstName/lastName */
function splitContactNameParts(contact: {
  name?: string;
  firstName?: string;
  lastName?: string;
}): { first_name: string; last_name: string } {
  let firstName = contact.firstName || '';
  let lastName = contact.lastName || '';
  if (contact.name && !firstName && !lastName) {
    const nameParts = contact.name.trim().split(/\s+/);
    firstName = nameParts[0] || '';
    lastName = nameParts.slice(1).join(' ') || '';
  }
  return { first_name: firstName, last_name: lastName };
}

function contactPhonesToDb(c: Partial<Contact>): string {
  return String(c.officePhone || c.mobilePhone || c.whatsappNumber || '').trim();
}

/** Payload insert `contacts` depuis le shape CRM / legacy */
function buildContactInsertRow(contact: Partial<Contact> & Record<string, unknown>): Record<string, unknown> {
  const { first_name, last_name } = splitContactNameParts(contact as any);
  const emailRaw = String(
    (contact.workEmail as string) || (contact.email as string) || (contact.personalEmail as string) || ''
  ).trim();
  const companyTrim = String(contact.company ?? '').trim();
  return {
    first_name,
    last_name,
    email: emailRaw || null,
    phone: contactPhonesToDb(contact) || null,
    company: companyTrim || 'N/A',
    position: contact.position ?? null,
    status: contactStatusUiToDb(contact.status as string | undefined),
    source: contact.source ?? null,
    notes: contact.notes ?? null,
    tags: Array.isArray(contact.tags) ? contact.tags : [],
    category_id: contact.categoryId ?? null,
    source_collection_id: contact.sourceCollectionId ?? null,
    source_submission_id: contact.sourceSubmissionId ?? null,
  };
}

/** Patch `contacts` depuis `Partial<Contact>` — uniquement les clés présentes sur `updates` */
function buildContactUpdatePatch(updates: Partial<Contact>): Record<string, unknown> {
  const row: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  const u = updates as Partial<Contact> & { firstName?: string; lastName?: string; email?: string };
  if ('name' in u || 'firstName' in u || 'lastName' in u) {
    const { first_name, last_name } = splitContactNameParts(u as any);
    row.first_name = first_name;
    row.last_name = last_name;
  }
  if ('workEmail' in u || 'personalEmail' in u || 'email' in u) {
    const em = String((u.workEmail ?? u.email ?? u.personalEmail ?? '')).trim();
    row.email = em || null;
  }
  if ('officePhone' in u || 'mobilePhone' in u || 'whatsappNumber' in u) {
    row.phone = contactPhonesToDb(u);
  }
  if ('company' in u) row.company = String(u.company ?? '').trim();
  if ('position' in u) row.position = u.position ?? null;
  if ('status' in u) row.status = contactStatusUiToDb(u.status);
  if ('workflowStatus' in u) {
    row.workflow_status = u.workflowStatus || 'new';
    row.workflow_updated_at = new Date().toISOString();
  }
  if ('source' in u) row.source = u.source ?? null;
  if ('notes' in u) row.notes = u.notes ?? null;
  if ('tags' in u) row.tags = Array.isArray(u.tags) ? u.tags : [];
  if ('categoryId' in u) row.category_id = u.categoryId ?? null;
  if ('sourceCollectionId' in u) row.source_collection_id = u.sourceCollectionId ?? null;
  if ('sourceSubmissionId' in u) row.source_submission_id = u.sourceSubmissionId ?? null;
  return row;
}

/** Résolution profiles.id / auth user_id pour notifications — cache + requêtes in-flight dédupliquées (évite tempête réseau). */
const NOTIF_TARGET_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const notifTargetProfileCache = new Map<string, string>();
const notifTargetProfileInflight = new Map<string, Promise<string | null>>();

async function resolveNotifTargetProfileId(rawUserId: string): Promise<string | null> {
  const raw = String(rawUserId);
  if (!NOTIF_TARGET_UUID.test(raw)) return null;

  const hit = notifTargetProfileCache.get(raw);
  if (hit) return hit;

  const pending = notifTargetProfileInflight.get(raw);
  if (pending) return pending;

  const task = (async (): Promise<string | null> => {
    try {
      const { data: profileById } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', raw)
        .maybeSingle();
      if (profileById?.id) {
        const id = String(profileById.id);
        notifTargetProfileCache.set(raw, id);
        return id;
      }
      const { data: profileByUserId } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', raw)
        .maybeSingle();
      if (profileByUserId?.id) {
        const id = String(profileByUserId.id);
        notifTargetProfileCache.set(raw, id);
        return id;
      }
      return null;
    } finally {
      notifTargetProfileInflight.delete(raw);
    }
  })();

  notifTargetProfileInflight.set(raw, task);
  return task;
}

// Service de données Supabase
export class DataService {
  private static projectsSupportsProgrammeId = true;
  /**
   * Helper pour récupérer l'organization_id de l'utilisateur actuel
   * Utilisé pour toutes les opérations multi-tenant
   */
  private static async getCurrentUserOrganizationId(): Promise<string | null> {
    try {
      return await OrganizationService.getCurrentUserOrganizationId();
    } catch (error) {
      console.warn('⚠️ Erreur récupération organization_id (continue sans filtre):', error);
      return null;
    }
  }

  private static normalizeDate(dateInput?: string | null): string {
    if (dateInput) return new Date(dateInput).toISOString().split('T')[0];
    return new Date().toISOString().split('T')[0];
  }

  private static async buildCurrencyColumns(
    amount?: number | null,
    currencyCode?: CurrencyCode | null,
    transactionDate?: string | null,
    manualExchangeRate?: number | null
  ) {
    const safeAmount = typeof amount === 'number' ? amount : 0;
    const code: CurrencyCode = (currencyCode as CurrencyCode) || 'USD';
    const normalizedDate = this.normalizeDate(transactionDate);

    let exchangeRate = 1;
    let baseAmountUSD = safeAmount;

    try {
      // Si un taux manuel est fourni, l'utiliser directement
      if (manualExchangeRate && manualExchangeRate > 0) {
        exchangeRate = manualExchangeRate;
        baseAmountUSD = safeAmount * exchangeRate;
      } else {
        // Sinon, récupérer les taux manuels de la base et les utiliser en priorité
        const manualRates = await this.getManualExchangeRates(code, 'USD', normalizedDate);
        exchangeRate = await CurrencyService.getRateToUSD(code, normalizedDate, manualRates);
        baseAmountUSD = safeAmount * exchangeRate;
      }
    } catch (error) {
      console.warn('⚠️ Currency conversion fallback:', error);
    }

    return {
      currency_code: code,
      exchange_rate: exchangeRate,
      base_amount_usd: baseAmountUSD,
      transaction_date: normalizedDate
    };
  }
  // ===== PROFILES =====
  static async getProfiles() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération profils:', error);
      return { data: null, error };
    }
  }

  static async getPendingProfiles() {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération profils en attente:', error);
      return { data: null, error };
    }
  }

  static async searchInstructors(searchTerm: string, roles?: string[]) {
    const sanitized = searchTerm.trim().replace(/[%]/g, '').replace(/['"]/g, '');
    if (!sanitized) {
      return { data: [], error: null };
    }

    try {
      const organizationId = await this.getCurrentUserOrganizationId();
      let queryBuilder = supabase
        .from('profiles')
        .select('id, user_id, full_name, email, role, avatar_url, is_active')
        .or(`full_name.ilike.%${sanitized}%,email.ilike.%${sanitized}%`)
        .order('full_name', { ascending: true });

      if (roles && roles.length > 0) {
        queryBuilder = queryBuilder.in('role', roles);
      }

      if (organizationId) {
        queryBuilder = queryBuilder.eq('organization_id', organizationId);
      }

      const { data, error } = await queryBuilder.limit(20);

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur recherche instructeurs:', error);
      return { data: null, error };
    }
  }

  static async getProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération profil:', error);
      return { data: null, error };
    }
  }

  static async updateProfile(userId: string, updates: any) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('user_id', userId)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour profil:', error);
      return { data: null, error };
    }
  }

  // Mettre à jour le rôle d'un utilisateur
  static async updateUserRole(userId: string, newRole: string) {
    try {
      console.log('🔄 Update user role:', { userId, newRole });
      
      const { data, error } = await supabase
        .from('profiles')
        .update({ 
          role: newRole,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur update user role:', error);
        throw error;
      }
      
      console.log('✅ User role updated:', data);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur update user role:', error);
      return { data: null, error };
    }
  }

  static async approveProfileRole(params: {
    profileId: string;
    approverId: string;
    comment?: string;
    /** Obligatoire côté UI : rattachement `user_departments` après activation */
    departmentId?: string | null;
  }): Promise<
    | { data: Record<string, unknown>; error: null; departmentAssignmentFailed?: boolean }
    | { data: null; error: unknown }
  > {
    const { profileId, approverId, comment, departmentId } = params;
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .single();

      if (profileError) throw profileError;
      if (!profile) throw new Error('Profil introuvable');

      const approvedRole: string = (profile.pending_role as string) || profile.role || 'student';
      const reviewComment = comment?.trim() ? comment.trim() : null;
      const requestedRole = profile.pending_role || approvedRole;

      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
          role: approvedRole,
          status: 'active',
          pending_role: null,
          review_comment: reviewComment,
          reviewed_at: new Date().toISOString(),
          reviewed_by: approverId,
          updated_at: new Date().toISOString()
        })
        .eq('id', profileId)
        .select()
        .single();

      if (updateError) throw updateError;

      const authUserId = String((updatedProfile as { user_id?: string }).user_id || (profile as { user_id?: string }).user_id || '');
      let departmentAssignmentFailed = false;
      if (departmentId && authUserId) {
        const ok = await DepartmentService.assignUserToDepartment(authUserId, departmentId, 'member');
        if (!ok) {
          departmentAssignmentFailed = true;
          console.warn('⚠️ Approbation OK mais échec assignation département (RLS ou table user_departments)');
        }
      }

      const { error: logError } = await supabase
        .from('role_approval_logs')
        .insert({
          profile_id: profileId,
          requested_role: requestedRole,
          decision: 'approved',
          comment: reviewComment,
          decided_by: approverId
        });

      if (logError) {
        console.warn('⚠️ Erreur enregistrement log approbation (non bloquant):', logError);
      }

      return {
        data: updatedProfile,
        error: null,
        ...(departmentAssignmentFailed ? { departmentAssignmentFailed: true as const } : {})
      };
    } catch (error) {
      console.error('❌ Erreur approbation rôle profil:', error);
      return { data: null, error };
    }
  }

  static async rejectProfileRole(params: { profileId: string; approverId: string; comment?: string }) {
    const { profileId, approverId, comment } = params;
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', profileId)
        .single();

      if (profileError) throw profileError;
      if (!profile) throw new Error('Profil introuvable');

      const reviewComment = comment?.trim() ? comment.trim() : null;
      const requestedRole = profile.pending_role || profile.role || 'student';

      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
          status: 'rejected',
          pending_role: null,
          review_comment: reviewComment,
          reviewed_at: new Date().toISOString(),
          reviewed_by: approverId,
          updated_at: new Date().toISOString()
        })
        .eq('id', profileId)
        .select()
        .single();

      if (updateError) throw updateError;

      const { error: logError } = await supabase
        .from('role_approval_logs')
        .insert({
          profile_id: profileId,
          requested_role: requestedRole,
          decision: 'rejected',
          comment: reviewComment,
          decided_by: approverId
        });

      if (logError) {
        console.warn('⚠️ Erreur enregistrement log rejet (non bloquant):', logError);
      }

      return { data: updatedProfile, error: null };
    } catch (error) {
      console.error('❌ Erreur rejet rôle profil:', error);
      return { data: null, error };
    }
  }

  // Fonction pour activer/désactiver un utilisateur
  static async toggleUserActive(userId: string | number, isActive: boolean) {
    try {
      console.log('🔄 Toggle user active:', { userId, isActive });
      
      // Convertir userId en string si c'est un number
      const userIdStr = String(userId);
      
      const { data, error } = await supabase
        .from('profiles')
        .update({ 
          is_active: isActive,
          updated_at: new Date().toISOString() 
        })
        .eq('user_id', userIdStr)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur toggle user active:', error);
        throw error;
      }
      
      console.log('✅ User active status updated:', { userId: userIdStr, isActive, profileId: data?.id });
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur toggle user active:', error);
      return { data: null, error };
    }
  }

  // Fonction pour supprimer un utilisateur (suppression du profil uniquement)
  static async deleteUser(userId: string | number) {
    try {
      console.log('🔄 Delete user:', { userId });
      
      // Convertir userId en string si c'est un number
      const userIdStr = String(userId);
      
      // Vérifier que l'utilisateur existe d'abord
      const { data: existingUser, error: checkError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', userIdStr)
        .maybeSingle();
      
      // Gérer les cas où l'utilisateur n'existe pas (pas une erreur critique)
      if (checkError && checkError.code !== 'PGRST116') {
        // PGRST116 = "no rows returned" - ce n'est pas une vraie erreur
        console.error('❌ Erreur lors de la vérification de l\'utilisateur:', checkError);
        throw new Error(`Erreur lors de la vérification: ${checkError.message}`);
      }
      
      if (!existingUser) {
        console.warn('⚠️ Utilisateur non trouvé dans profiles:', userIdStr);
        // Retourner succès même si l'utilisateur n'existe pas (déjà supprimé ou n'existe jamais)
        return { success: true, error: null };
      }
      
      console.log('✅ Utilisateur trouvé:', existingUser.email, existingUser.full_name);
      
      // Supprimer les données liées à cet utilisateur AVANT de supprimer le profil
      // pour éviter les violations de contrainte de clé étrangère
      const profileId = existingUser.id;
      console.log('🔄 Suppression des données liées pour profileId:', profileId);
      
      // Supprimer les factures
      const { error: invoicesError } = await supabase
        .from('invoices')
        .delete()
        .eq('user_id', profileId);
      if (invoicesError) {
        console.error('❌ Erreur suppression factures:', invoicesError);
      } else {
        console.log('✅ Factures supprimées');
      }
      
      // Supprimer les dépenses
      const { error: expensesError } = await supabase
        .from('expenses')
        .delete()
        .eq('user_id', profileId);
      if (expensesError) {
        console.error('❌ Erreur suppression dépenses:', expensesError);
      } else {
        console.log('✅ Dépenses supprimées');
      }
      
      // Supprimer les time logs
      const { error: timeLogsError } = await supabase
        .from('time_logs')
        .delete()
        .eq('user_id', profileId);
      if (timeLogsError) {
        console.error('❌ Erreur suppression time logs:', timeLogsError);
      } else {
        console.log('✅ Time logs supprimés');
      }
      
      // Supprimer les demandes de congé
      const { error: leaveRequestsError } = await supabase
        .from('leave_requests')
        .delete()
        .eq('user_id', profileId);
      if (leaveRequestsError) {
        console.error('❌ Erreur suppression demandes de congé:', leaveRequestsError);
      } else {
        console.log('✅ Demandes de congé supprimées');
      }
      
      // Supprimer les objectifs
      const { error: objectivesError } = await supabase
        .from('objectives')
        .delete()
        .eq('owner_id', profileId);
      if (objectivesError) {
        console.error('❌ Erreur suppression objectifs:', objectivesError);
      } else {
        console.log('✅ Objectifs supprimés');
      }
      
      // Supprimer les notifications
      const { error: notificationsError } = await supabase
        .from('notifications')
        .delete()
        .eq('user_id', profileId);
      if (notificationsError) {
        console.error('❌ Erreur suppression notifications:', notificationsError);
      } else {
        console.log('✅ Notifications supprimées');
      }
      
      // Supprimer les permissions modules
      const { error: permissionsError } = await supabase
        .from('user_module_permissions')
        .delete()
        .eq('user_id', profileId);
      if (permissionsError) {
        console.error('❌ Erreur suppression permissions:', permissionsError);
      } else {
        console.log('✅ Permissions supprimées');
      }
      
      // Supprimer les budgets
      const { error: budgetsError } = await supabase
        .from('budgets')
        .delete()
        .eq('owner_id', profileId);
      if (budgetsError) {
        console.error('❌ Erreur suppression budgets:', budgetsError);
      } else {
        console.log('✅ Budgets supprimés');
      }
      
      // Supprimer les inscriptions aux cours
      const { error: enrollmentsError } = await supabase
        .from('course_enrollments')
        .delete()
        .eq('user_id', profileId);
      if (enrollmentsError) {
        console.error('❌ Erreur suppression inscriptions cours:', enrollmentsError);
      } else {
        console.log('✅ Inscriptions cours supprimées');
      }
      
      // Supprimer les instructeurs de cours
      const { error: instructorsError } = await supabase
        .from('course_instructors')
        .delete()
        .eq('profile_id', profileId);
      if (instructorsError) {
        console.error('❌ Erreur suppression instructeurs:', instructorsError);
      } else {
        console.log('✅ Instructeurs supprimés');
      }
      
      // Supprimer les favoris de documents
      const { error: favoritesError } = await supabase
        .from('document_favorites')
        .delete()
        .eq('user_id', profileId);
      if (favoritesError) {
        console.error('❌ Erreur suppression favoris documents:', favoritesError);
      } else {
        console.log('✅ Favoris documents supprimés');
      }
      
      // Supprimer les partages de documents
      const { error: sharesError } = await supabase
        .from('document_shares')
        .delete()
        .or(`shared_by_id.eq.${profileId},shared_with_user_id.eq.${profileId}`);
      if (sharesError) {
        console.error('❌ Erreur suppression partages documents:', sharesError);
      } else {
        console.log('✅ Partages documents supprimés');
      }
      
      // Supprimer les versions de documents
      const { error: versionsError } = await supabase
        .from('document_versions')
        .delete()
        .eq('updated_by_id', profileId);
      if (versionsError) {
        console.error('❌ Erreur suppression versions documents:', versionsError);
      } else {
        console.log('✅ Versions documents supprimées');
      }
      
      // Supprimer les documents créés
      const { error: documentsError } = await supabase
        .from('documents')
        .delete()
        .eq('created_by_id', profileId);
      if (documentsError) {
        console.error('❌ Erreur suppression documents:', documentsError);
      } else {
        console.log('✅ Documents supprimés');
      }
      
      // Supprimer les articles de connaissance
      const { error: articlesError } = await supabase
        .from('knowledge_articles')
        .delete()
        .eq('user_id', profileId);
      if (articlesError) {
        console.error('❌ Erreur suppression articles:', articlesError);
      } else {
        console.log('✅ Articles supprimés');
      }
      
      // Supprimer les catégories de connaissance
      const { error: categoriesError } = await supabase
        .from('knowledge_categories')
        .delete()
        .eq('user_id', profileId);
      if (categoriesError) {
        console.error('❌ Erreur suppression catégories:', categoriesError);
      } else {
        console.log('✅ Catégories supprimées');
      }
      
      // Supprimer les demandes de congé (manager_id aussi)
      const { error: leaveManagerError } = await supabase
        .from('leave_requests')
        .delete()
        .eq('manager_id', profileId);
      if (leaveManagerError) {
        console.error('❌ Erreur suppression demandes congé (manager):', leaveManagerError);
      } else {
        console.log('✅ Demandes congé (manager) supprimées');
      }
      
      // Supprimer les réunions (organisateur)
      const { error: meetingsError } = await supabase
        .from('meetings')
        .delete()
        .eq('organizer_id', profileId);
      if (meetingsError) {
        console.error('❌ Erreur suppression réunions:', meetingsError);
      } else {
        console.log('✅ Réunions supprimées');
      }
      
      // Supprimer les utilisateurs d'organisation
      const { error: orgUsersError } = await supabase
        .from('organization_users')
        .delete()
        .or(`user_id.eq.${profileId},invited_by.eq.${profileId}`);
      if (orgUsersError) {
        console.error('❌ Erreur suppression org users:', orgUsersError);
      } else {
        console.log('✅ Org users supprimés');
      }
      
      // ATTENTION: Ne pas supprimer les profils ayant ce manager_id
      // car cela supprimerait d'autres utilisateurs !
      // Mieux vaut modifier leur manager_id à NULL ou à un autre manager
      
      // Supprimer les dépenses récurrentes
      const { error: recurringExpensesError } = await supabase
        .from('recurring_expenses')
        .delete()
        .eq('owner_id', profileId);
      if (recurringExpensesError) {
        console.error('❌ Erreur suppression dépenses récurrentes:', recurringExpensesError);
      } else {
        console.log('✅ Dépenses récurrentes supprimées');
      }
      
      // Supprimer les factures récurrentes
      const { error: recurringInvoicesError } = await supabase
        .from('recurring_invoices')
        .delete()
        .eq('owner_id', profileId);
      if (recurringInvoicesError) {
        console.error('❌ Erreur suppression factures récurrentes:', recurringInvoicesError);
      } else {
        console.log('✅ Factures récurrentes supprimées');
      }
      
      // Supprimer les rôles utilisateur
      const { error: userRolesError } = await supabase
        .from('user_roles')
        .delete()
        .or(`user_id.eq.${profileId},granted_by.eq.${profileId},revoked_by.eq.${profileId}`);
      if (userRolesError) {
        console.error('❌ Erreur suppression rôles utilisateur:', userRolesError);
      } else {
        console.log('✅ Rôles utilisateur supprimés');
      }
      
      // Maintenant supprimer le profil
      const { error } = await supabase
        .from('profiles')
        .delete()
        .eq('user_id', userIdStr);
      
      if (error) {
        console.error('❌ Erreur delete user:', error);
        throw error;
      }
      
      console.log('✅ User deleted:', { userId: userIdStr });
      return { success: true, error: null };
    } catch (error) {
      console.error('❌ Erreur delete user:', error);
      return { success: false, error };
    }
  }

  // Fonction pour récupérer les permissions module d'un utilisateur
  static async getUserModulePermissions(userId: string) {
    try {
      console.log('🔄 Get user module permissions:', { userId });
      
      const { data, error } = await supabase
        .from('user_module_permissions')
        .select('*')
        .eq('user_id', userId);
      
      if (error) {
        console.error('❌ Erreur get user module permissions:', error);
        throw error;
      }
      
      console.log('✅ User module permissions retrieved:', data?.length || 0, 'permissions');
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur get user module permissions:', error);
      return { data: null, error };
    }
  }

  // Upsert des permissions module pour un utilisateur
  static async upsertUserModulePermissions(userId: string, perms: Array<{ moduleName: string; canRead: boolean; canWrite: boolean; canDelete: boolean; canApprove: boolean }>) {
    try {
      console.log('💾 Upsert user module permissions:', { userId, count: perms.length });
      if (!userId || !Array.isArray(perms)) throw new Error('Paramètres invalides');

      const rows = perms.map(p => ({
        user_id: userId,
        module_name: p.moduleName,
        can_read: p.canRead,
        can_write: p.canWrite,
        can_delete: p.canDelete,
        can_approve: p.canApprove,
        updated_at: new Date().toISOString()
      }));

      const { data, error } = await supabase
        .from('user_module_permissions')
        .upsert(rows, { onConflict: 'user_id,module_name' })
        .select();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur upsert user module permissions:', error);
      return { data: null, error };
    }
  }

  // ===== UTILISATEURS PAR IDS =====
  static async getUsersByIds(userIds: string[]) {
    try {
      if (userIds.length === 0) return { data: [], error: null };
      
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .in('user_id', userIds);
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération utilisateurs par IDs:', error);
      return { data: null, error };
    }
  }
  static async getProjects() {
    return await ApiHelper.get('projects', {
      select: '*',
      order: 'created_at.desc'
    });
  }

  static async getProject(id: string) {
    return await ApiHelper.get(`projects?id=eq.${id}&select=*`);
  }

  static async getProjectTaskReadModel(projectId: string) {
    try {
      const { data, error } = await supabase
        .from('project_tasks_read_model')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) return { data: null, error };
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  static async getProjectRiskReadModel(projectId: string) {
    try {
      const { data, error } = await supabase
        .from('project_risks_read_model')
        .select('*')
        .eq('project_id', projectId)
        .maybeSingle();
      if (error) return { data: null, error };
      return { data, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  static async createProject(project: Partial<Project>) {
    try {
      // Mapper les statuts vers les valeurs valides de la base
      const mapStatus = (status: string) => {
        switch (status?.toLowerCase()) {
          case 'not started':
          case 'not_started':
            return 'active';
          case 'in progress':
          case 'in_progress':
            return 'active';
          case 'completed':
            return 'completed';
          case 'cancelled':
            return 'cancelled';
          case 'on hold':
          case 'on_hold':
            return 'on_hold';
          default:
            return 'active';
        }
      };

      // Mapper les priorités vers les valeurs valides de la base
      const mapPriority = (priority: string) => {
        switch (priority?.toLowerCase()) {
          case 'low':
            return 'low';
          case 'medium':
            return 'medium';
          case 'high':
            return 'high';
          case 'urgent':
            return 'urgent';
          default:
            return 'medium';
        }
      };

      console.log('🔍 Données projet reçues:', {
        title: project.title,
        status: project.status,
        mappedStatus: mapStatus(project.status || 'active'),
        priority: project.priority,
        mappedPriority: mapPriority(project.priority || 'medium'),
        team: project.team,
        teamCount: project.team?.length || 0
      });

      // Conserver uniquement les IDs réellement connus, sans générer d'UUID artificiels.
      const teamMemberIds = (project.team || [])
        .map(member => {
          const candidate = (member as any)?.profileId || (member as any)?.userId || member.id;
          if (!candidate) return null;
          return String(candidate);
        })
        .filter((id): id is string => Boolean(id));

      console.log('🔍 Team members IDs:', teamMemberIds);
      console.log('🔍 Team members count:', teamMemberIds.length);

      // Formater les dates pour Supabase (format ISO avec timezone)
      const formatDate = (dateString?: string) => {
        if (!dateString) return null;
        const date = new Date(dateString);
        return date.toISOString();
      };

      // Récupérer l'utilisateur actuel pour définir owner_id
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      // Récupérer l'organization_id de l'utilisateur
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id, full_name, email')
        .eq('user_id', currentUser?.id || '')
        .single();

      const creatorName = profile?.full_name || profile?.email || currentUser?.email || null;

      const payload: Record<string, unknown> = {
        name: project.title || '',
        description: project.description || '',
        status: mapStatus(project.status || 'active'),
        priority: mapPriority(project.priority || 'medium'),
        start_date: formatDate(project.startDate),
        end_date: formatDate(project.dueDate),
        budget: project.budget || null,
        client: project.clientName || null,
        team_members: teamMemberIds.length > 0 ? teamMemberIds : null,
        owner_id: currentUser?.id || null,
        organization_id: profile?.organization_id || null,
        created_by_id: currentUser?.id || null,
        created_by_name: creatorName,
        tasks: project.tasks || [],
        risks: project.risks || [],
      };
      if (this.projectsSupportsProgrammeId) {
        payload.programme_id = project.programmeId || null;
      }
      try {
        return await ApiHelper.post('projects', payload);
      } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase();
        if (msg.includes("could not find the 'programme_id' column")) {
          this.projectsSupportsProgrammeId = false;
          delete payload.programme_id;
          return await ApiHelper.post('projects', payload);
        }
        throw e;
      }
    } catch (error) {
      console.error('Erreur création projet:', error);
      return { data: null, error };
    }
  }

  static async updateProject(id: string, updates: Partial<Project>) {
    // Mapper les statuts vers les valeurs valides de la base
    const mapStatus = (status: string) => {
      switch (status?.toLowerCase()) {
        case 'not started':
        case 'not_started':
          return 'active';
        case 'in progress':
        case 'in_progress':
          return 'active';
        case 'completed':
          return 'completed';
        case 'cancelled':
          return 'cancelled';
        case 'on hold':
        case 'on_hold':
          return 'on_hold';
        default:
          return 'active';
      }
    };

    // Mapper les priorités vers les valeurs valides de la base
    const mapPriority = (priority: string) => {
      switch (priority?.toLowerCase()) {
        case 'low':
          return 'low';
        case 'medium':
          return 'medium';
        case 'high':
          return 'high';
        case 'urgent':
          return 'urgent';
        default:
          return 'medium';
      }
    };

    // Extraire les IDs des membres de l'équipe
    const teamMemberIds = updates.team?.map(member => {
      // Si c'est déjà un UUID valide, l'utiliser tel quel
      if (member.id && typeof member.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(member.id)) {
        return member.id;
      }
      // Si c'est un nombre (ancien format), le convertir en string
      if (member.id && typeof member.id === 'number') {
        return String(member.id);
      }
      // Si c'est une string qui n'est pas un UUID, l'utiliser quand même (peut être un ID valide)
      if (member.id && typeof member.id === 'string') {
        return member.id;
      }
      // Si aucun ID n'est fourni, ignorer ce membre (ne devrait pas arriver)
      console.warn('⚠️ DataService.updateProject - Membre sans ID valide:', member);
      return null;
    }).filter((id): id is string => id !== null && id !== undefined) || [];

    console.log('🔄 DataService.updateProject - Team members IDs:', teamMemberIds);

    const payload: Record<string, unknown> = {
      name: updates.title,
      description: updates.description,
      status: mapStatus(updates.status || 'active'),
      priority: mapPriority(updates.priority || 'medium'),
      start_date: updates.startDate,
      end_date: updates.dueDate,
      budget: updates.budget,
      client: updates.clientName,
      team_members: teamMemberIds.length > 0 ? teamMemberIds : null,
      tasks: updates.tasks || [],
      risks: updates.risks || [],
      updated_at: new Date().toISOString(),
    };
    if (this.projectsSupportsProgrammeId && updates.programmeId !== undefined) {
      payload.programme_id = updates.programmeId;
    }
    try {
      return await ApiHelper.put('projects', id, payload);
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase();
      if (msg.includes("could not find the 'programme_id' column")) {
        this.projectsSupportsProgrammeId = false;
        delete payload.programme_id;
        return await ApiHelper.put('projects', id, payload);
      }
      throw e;
    }
  }

  static async deleteProject(id: string) {
    return await ApiHelper.delete('projects', id);
  }

  // ===== PROJECT ATTACHMENTS (Phase 2.4) =====
  static async getProjectAttachments(projectId: string) {
    try {
      const { data, error } = await supabase
        .from('project_attachments')
        .select('*')
        .eq('project_id', projectId)
        .order('uploaded_at', { ascending: false });
      if (error) {
        if (handleOptionalTableError(error, 'project_attachments', 'DataService.getProjectAttachments')) {
          return { data: [], error: null };
        }
        throw error;
      }
      return { data: data || [], error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'project_attachments', 'DataService.getProjectAttachments.catch')) {
        return { data: [], error: null };
      }
      return { data: [], error };
    }
  }

  static async uploadProjectAttachment(projectId: string, file: File) {
    try {
      const organizationId = await this.getCurrentUserOrganizationId();
      if (!organizationId) throw new Error('Organization not found');
      const { data: { user } } = await supabase.auth.getUser();
      const bucket = 'project-attachments';
      const randomSuffix =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
      const path = `${organizationId}/${projectId}/${randomSuffix}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
        cacheControl: '3600',
        upsert: false
      });
      if (uploadError) throw uploadError;

      const { data: row, error: insertError } = await supabase
        .from('project_attachments')
        .insert({
          organization_id: organizationId,
          project_id: projectId,
          file_name: file.name,
          file_path: path,
          file_size: file.size,
          mime_type: file.type || null,
          uploaded_by_id: user?.id || null
        })
        .select('*')
        .single();
      if (insertError) throw insertError;
      return { data: row, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'project_attachments', 'DataService.uploadProjectAttachment')) {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
  }

  static async deleteProjectAttachment(attachmentId: string) {
    try {
      const { data: row, error: fetchError } = await supabase
        .from('project_attachments')
        .select('file_path')
        .eq('id', attachmentId)
        .single();
      if (fetchError || !row) throw fetchError || new Error('Attachment not found');
      await supabase.storage.from('project-attachments').remove([row.file_path]);
      const { error: deleteError } = await supabase
        .from('project_attachments')
        .delete()
        .eq('id', attachmentId);
      if (deleteError) throw deleteError;
      return { error: null };
    } catch (error) {
      return { error };
    }
  }

  static async getProjectAttachmentUrl(filePath: string, expiresIn = 3600) {
    const { data } = await supabase.storage.from('project-attachments').createSignedUrl(filePath, expiresIn);
    return data?.signedUrl || null;
  }

  // ===== PROJECT MODULE SETTINGS (Phase 2.4) =====
  static async getProjectModuleSettings() {
    if (isTableUnavailable('project_module_settings')) {
      return { data: null, error: null };
    }
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) return { data: null, error: null };
      const { data, error } = await supabase
        .from('project_module_settings')
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) {
        if (handleOptionalTableError(error, 'project_module_settings', 'DataService.getProjectModuleSettings')) {
          return { data: null, error: null };
        }
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'project_module_settings', 'DataService.getProjectModuleSettings.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
  }

  static async upsertProjectModuleSettings(settings: {
    projectTypes?: string[];
    statuses?: string[];
    alertDelayDays?: number;
    taskTemplates?: Array<{ title: string; defaultPriority?: string }>;
    taskScorePercent?: number;
    managerScorePercent?: number;
    requireJustificationForCompletion?: boolean;
    autoFreezeOverdueTasks?: boolean;
    evaluationStartDate?: string | null;
    leavePendingSlaDays?: number;
    budgetWarningPercent?: number;
    budgetCriticalPercent?: number;
    objectiveOffTrackGapPercent?: number;
  }) {
    if (isTableUnavailable('project_module_settings')) {
      return { data: null, error: null };
    }
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) throw new Error('Organization not found');
      const payload: Record<string, unknown> = {
        organization_id: orgId,
        updated_at: new Date().toISOString()
      };
      if (settings.projectTypes !== undefined) payload.project_types = settings.projectTypes;
      if (settings.statuses !== undefined) payload.statuses = settings.statuses;
      if (settings.alertDelayDays !== undefined) payload.alert_delay_days = settings.alertDelayDays;
      if (settings.taskTemplates !== undefined) payload.task_templates = settings.taskTemplates;
      if (settings.taskScorePercent !== undefined) payload.task_score_percent = settings.taskScorePercent;
      if (settings.managerScorePercent !== undefined) payload.manager_score_percent = settings.managerScorePercent;
      if (settings.requireJustificationForCompletion !== undefined) payload.require_justification_for_completion = settings.requireJustificationForCompletion;
      if (settings.autoFreezeOverdueTasks !== undefined) payload.auto_freeze_overdue_tasks = settings.autoFreezeOverdueTasks;
      if (settings.evaluationStartDate !== undefined) payload.evaluation_start_date = settings.evaluationStartDate;
      if (settings.leavePendingSlaDays !== undefined) payload.leave_pending_sla_days = settings.leavePendingSlaDays;
      if (settings.budgetWarningPercent !== undefined) payload.budget_warning_percent = settings.budgetWarningPercent;
      if (settings.budgetCriticalPercent !== undefined) payload.budget_critical_percent = settings.budgetCriticalPercent;
      if (settings.objectiveOffTrackGapPercent !== undefined) payload.objective_offtrack_gap_percent = settings.objectiveOffTrackGapPercent;

      const { data, error } = await supabase
        .from('project_module_settings')
        .upsert({ ...payload, organization_id: orgId }, { onConflict: 'organization_id' })
        .select('*')
        .single();
      if (error) {
        if (handleOptionalTableError(error, 'project_module_settings', 'DataService.upsertProjectModuleSettings')) {
          return { data: null, error: null };
        }
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'project_module_settings', 'DataService.upsertProjectModuleSettings.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
  }

  // ===== INVOICES =====
  static async getInvoices() {
    const invoiceSelectVariants = [
      'id,invoice_number,client_name,amount,tax,total,currency_code,exchange_rate,base_amount_usd,due_date,status,receipt_file_name,receipt_data_url,paid_date,paid_amount,recurring_source_id,user_id,created_by,created_at,updated_at',
      'id,invoice_number,client_name,amount,tax,total,due_date,status,paid_date,paid_amount,user_id,created_by,created_at,updated_at',
      'id,invoice_number,client_name,amount,due_date,status,user_id,created_at,updated_at',
    ];

    let result: { data: unknown; error: unknown } = { data: null, error: new Error('no invoice select variant') };
    for (const select of invoiceSelectVariants) {
      result = await ApiHelper.get(
        'invoices',
        {
          select,
          order: 'created_at.desc',
        },
        30000,
      );
      if (!result.error) return result;
      if (!isLikelyPostgrestSelectError(result.error)) break;
    }
    if (result.error && isLikelyPostgrestSelectError(result.error)) {
      result = await ApiHelper.get('invoices', { select: '*', order: 'created_at.desc' }, 30000);
    }

    if (result.data && Array.isArray(result.data)) {
      logger.debug('data', 'DataService.getInvoices — résumé', {
        count: result.data.length,
        statuses: [...new Set(result.data.map((inv: any) => inv.status))],
        partiallyPaidCount: result.data.filter((inv: any) => inv.status === 'partially_paid').length,
      });
    }

    return result;
  }

  static async createInvoice(invoice: Partial<Invoice>) {
    try {
      // Récupérer l'utilisateur actuel et son profil
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      // Récupérer le profil pour obtenir l'ID du profil
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('user_id', currentUser.id)
        .single();
      if (!profile) {
        throw new Error('Profil utilisateur non trouvé');
      }

      if (!profile) {
        throw new Error('Profil utilisateur non trouvé');
      }

      const normalizedStatus = invoice.status?.toLowerCase().replace(/\s+/g, '_') || 'draft';

      let paidForDerive = 0;
      if (invoice.paidAmount != null) {
        const p = Number(invoice.paidAmount);
        if (!Number.isNaN(p) && p > 0) paidForDerive = p;
      }

      // Préparer les données d'insertion - Colonnes obligatoires uniquement d'abord
      const invoiceNumber = invoice.invoiceNumber || `INV-${Date.now().toString().slice(-4)}`;
      
      // Commencer avec les colonnes obligatoires seulement
      const creatorName = profile?.full_name || currentUser.email || null;

      const currencyPayload = await this.buildCurrencyColumns(
        invoice.amount ?? 0,
        (invoice.currencyCode as CurrencyCode) || 'USD',
        invoice.transactionDate || invoice.dueDate,
        (invoice as any).manualExchangeRate || invoice.exchangeRate || undefined
      );

      const insertData: any = {
        invoice_number: invoiceNumber, // Basé sur getInvoices qui utilise invoice.invoice_number
      client_name: invoice.clientName || '',
      amount: invoice.amount || 0,
        status: derivePersistedInvoiceStatus(
          Number(invoice.amount) || 0,
          paidForDerive,
          normalizedStatus,
        ),
        due_date: invoice.dueDate || null,
        user_id: profile.id,
        created_by: currentUser.id,
        created_by_name: creatorName,
        ...currencyPayload
      };
      
      // Ajouter les colonnes optionnelles seulement si elles ont une valeur
      // (elles peuvent ne pas exister dans la table)
      if (invoice.vatAmount !== undefined && invoice.vatAmount !== null) {
        const vat = Number(invoice.vatAmount);
        if (!Number.isNaN(vat) && vat !== 0) {
          insertData.tax = vat;
        }
      }
      if (invoice.totalAmount !== undefined && invoice.totalAmount !== null) {
        const tot = Number(invoice.totalAmount);
        if (!Number.isNaN(tot) && tot > 0) {
          insertData.total = tot;
        }
      } else if (insertData.tax != null) {
        const base = Number(invoice.amount) || 0;
        const tot = base + Number(insertData.tax);
        if (tot > 0) {
          insertData.total = tot;
        }
      }

      if (invoice.paidDate) {
        insertData.paid_date = invoice.paidDate;
      }
      
      // Gérer paid_amount pour paiement partiel
      if (invoice.paidAmount !== undefined && invoice.paidAmount !== null) {
        const paidAmount = Number(invoice.paidAmount);
        if (!isNaN(paidAmount) && paidAmount > 0) {
          insertData.paid_amount = paidAmount;
        }
      }
      
      // Receipt (peut ne pas exister)
      if (invoice.receipt?.fileName) {
        insertData.receipt_file_name = invoice.receipt.fileName;
      }
      if (invoice.receipt?.dataUrl) {
        insertData.receipt_data_url = invoice.receipt.dataUrl;
      }
      
      if (invoice.recurringSourceId) {
        insertData.recurring_source_id = invoice.recurringSourceId;
      }
      
      console.log('📤 DataService.createInvoice - Données à insérer:', insertData);
      
      // Essayer d'abord avec 'invoice_number' (basé sur les logs getInvoices)
      let { data, error } = await supabase
        .from('invoices')
        .insert(insertData)
        .select()
        .single();
      
      // Si erreur liée à une colonne inexistante, réinsérer sans champs optionnels (évite les essais `number` / colonnes absentes → bruit 400).
      if (error && (error.message?.includes('column') || error.code === 'PGRST116' || error.code === '42703')) {
        console.log('⚠️ DataService.createInvoice - Erreur colonne, essai sans colonnes optionnelles');
        console.log('⚠️ Erreur:', error.message);

        const minimalData: Record<string, unknown> = {
          invoice_number: insertData.invoice_number,
          client_name: insertData.client_name,
          amount: insertData.amount,
          status: insertData.status,
          due_date: insertData.due_date,
          user_id: insertData.user_id,
          created_by: insertData.created_by,
        };

        const retryResult = await supabase.from('invoices').insert(minimalData).select().single();

        if (!retryResult.error) {
          data = retryResult.data;
          error = null;
        } else {
          data = retryResult.data;
          error = retryResult.error;
        }
      }
      
      if (error) {
        console.error('❌ DataService.createInvoice - Erreur Supabase:', {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
          insertData: insertData
        });
        throw error;
      }
      
      console.log('✅ DataService.createInvoice - Facture créée dans Supabase:', {
        id: data.id,
        number: data.number || data.invoice_number,
        status: data.status
      });
      
      return { data, error: null };
    } catch (error: any) {
      console.error('❌ DataService.createInvoice - Erreur complète:', {
        error,
        message: error?.message,
        details: error?.details,
        hint: error?.hint,
        code: error?.code
      });
      return { data: null, error };
    }
  }

  static async updateInvoice(id: string, updates: Partial<Invoice>) {
    try {
      const { data: existing, error: existingErr } = await supabase
        .from('invoices')
        .select('amount, paid_amount, status')
        .eq('id', id)
        .single();
      if (existingErr) throw existingErr;

      const normalizedStatus = updates.status?.toLowerCase().replace(/\s+/g, '_');

      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.invoiceNumber !== undefined) updateData.invoice_number = updates.invoiceNumber;
      if (updates.clientName !== undefined) updateData.client_name = updates.clientName;
      if (updates.amount !== undefined) updateData.amount = updates.amount;
      if (updates.dueDate !== undefined) updateData.due_date = updates.dueDate;
      if (updates.paidDate !== undefined) updateData.paid_date = updates.paidDate;
      if (updates.paidAmount !== undefined) {
        if (updates.paidAmount != null) {
          const paidAmount = Number(updates.paidAmount);
          if (!isNaN(paidAmount) && paidAmount > 0) {
            updateData.paid_amount = paidAmount;
          } else {
            updateData.paid_amount = null;
          }
        } else {
          updateData.paid_amount = null;
        }
      }

      if (updates.vatAmount !== undefined) {
        if (updates.vatAmount != null) {
          const vat = Number(updates.vatAmount);
          updateData.tax = !Number.isNaN(vat) ? vat : null;
        } else {
          updateData.tax = null;
        }
      }

      if (updates.totalAmount !== undefined) {
        if (updates.totalAmount != null) {
          const tot = Number(updates.totalAmount);
          updateData.total = !Number.isNaN(tot) ? tot : null;
        } else {
          updateData.total = null;
        }
      }

      const nextAmount =
        updates.amount !== undefined ? Number(updates.amount) || 0 : Number(existing?.amount) || 0;
      let nextPaid: number;
      if (updates.paidAmount !== undefined) {
        if (updates.paidAmount == null) {
          nextPaid = 0;
        } else {
          const n = Number(updates.paidAmount);
          nextPaid = !Number.isNaN(n) && n > 0 ? n : 0;
        }
      } else {
        nextPaid = Number(existing?.paid_amount) || 0;
      }
      const statusForDerive =
        updates.status !== undefined ? normalizedStatus : existing?.status || 'draft';
      updateData.status = derivePersistedInvoiceStatus(nextAmount, nextPaid, statusForDerive);
      if (updates.receipt !== undefined) {
        updateData.receipt_file_name = updates.receipt?.fileName || null;
        updateData.receipt_data_url = updates.receipt?.dataUrl || null;
      }
      if (updates.recurringSourceId !== undefined) updateData.recurring_source_id = updates.recurringSourceId;

      if (
        updates.amount !== undefined ||
        updates.currencyCode !== undefined ||
        updates.transactionDate !== undefined ||
        (updates as any).manualExchangeRate !== undefined
      ) {
        const currencyPayload = await this.buildCurrencyColumns(
          updates.amount ?? 0,
          (updates.currencyCode as CurrencyCode) || undefined,
          updates.transactionDate || updates.dueDate,
          (updates as any).manualExchangeRate || updates.exchangeRate || undefined
        );
        Object.assign(updateData, currencyPayload);
      }

      if (
        updates.amount !== undefined ||
        updates.currencyCode !== undefined ||
        updates.transactionDate !== undefined
      ) {
        const currencyPayload = await this.buildCurrencyColumns(
          updates.amount ?? 0,
          (updates.currencyCode as CurrencyCode) || undefined,
          updates.transactionDate || updates.dueDate
        );
        Object.assign(updateData, currencyPayload);
      }

      const { data, error } = await supabase
        .from('invoices')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour facture:', error);
      return { data: null, error };
    }
  }

  static async deleteInvoice(id: string) {
    try {
      const { error } = await supabase
        .from('invoices')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression facture:', error);
      return { error };
    }
  }

  // ===== EXPENSES =====
  static async getExpenses() {
    return await ApiHelper.get('expenses', { 
      select: '*', 
      order: 'created_at.desc' 
    });
  }

  static async createExpense(expense: Partial<Expense>) {
    try {
      // Récupérer l'utilisateur actuel et son profil
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      // Récupérer le profil pour obtenir l'ID du profil
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('user_id', currentUser.id)
        .single();

      if (!profile) {
        throw new Error('Profil utilisateur non trouvé');
      }

      // Normaliser le status en minuscules
      const normalizedStatus = expense.status?.toLowerCase() || 'unpaid';
      
      const creatorName = profile?.full_name || currentUser.email || null;

      const currencyPayload = await this.buildCurrencyColumns(
        expense.amount ?? 0,
        (expense.currencyCode as CurrencyCode) || 'USD',
        expense.transactionDate || expense.date,
        (expense as any).manualExchangeRate || expense.exchangeRate || undefined
      );
      
      const { data, error } = await supabase
        .from('expenses')
        .insert({
          title: expense.description || '',
          amount: expense.amount || 0,
          category: expense.category || '',
          date: expense.date || new Date().toISOString().split('T')[0],
          due_date: expense.dueDate || null,
          description: expense.description || '',
          status: normalizedStatus,
          receipt_file_name: expense.receipt?.fileName || null,
          receipt_data_url: expense.receipt?.dataUrl || null,
          budget_item_id: expense.budgetItemId || null,
          recurring_source_id: expense.recurringSourceId || null,
          user_id: profile.id,
          created_by: currentUser.id,
          created_by_name: creatorName,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...currencyPayload
        })
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création dépense:', error);
      return { data: null, error };
    }
  }

  static async updateExpense(id: string, updates: Partial<Expense>) {
    try {
      // Normaliser le status en minuscules
      const normalizedStatus = updates.status?.toLowerCase();
      
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.description !== undefined) {
        updateData.title = updates.description;
        updateData.description = updates.description;
      }
      if (updates.amount !== undefined) updateData.amount = updates.amount;
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.date !== undefined) updateData.date = updates.date;
      if (updates.dueDate !== undefined) updateData.due_date = updates.dueDate;
      if (normalizedStatus !== undefined) updateData.status = normalizedStatus;
      if (updates.receipt !== undefined) {
        updateData.receipt_file_name = updates.receipt?.fileName || null;
        updateData.receipt_data_url = updates.receipt?.dataUrl || null;
      }
      if (updates.budgetItemId !== undefined) updateData.budget_item_id = updates.budgetItemId;
      if (updates.recurringSourceId !== undefined) updateData.recurring_source_id = updates.recurringSourceId;

      const { data, error } = await supabase
        .from('expenses')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour dépense:', error);
      return { data: null, error };
    }
  }

  static async deleteExpense(id: string) {
    try {
      const { error } = await supabase
        .from('expenses')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression dépense:', error);
      return { error };
    }
  }

  // ===== RECURRING INVOICES =====
  static async getRecurringInvoices() {
    return await ApiHelper.get('recurring_invoices', { 
      select: '*', 
      order: 'created_at.desc' 
    });
  }

  static async createRecurringInvoice(recurringInvoice: Partial<any>) {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('user_id', currentUser.id)
        .single();

      if (!profile) {
        throw new Error('Profil utilisateur non trouvé');
      }

      const creatorName = profile?.full_name || currentUser.email || null;
      
      const currencyPayload = await this.buildCurrencyColumns(
        recurringInvoice.amount ?? 0,
        (recurringInvoice.currencyCode as CurrencyCode) || 'USD',
        recurringInvoice.startDate,
        (recurringInvoice as any).manualExchangeRate || recurringInvoice.exchangeRate || undefined
      );

      const { data, error } = await supabase
        .from('recurring_invoices')
        .insert({
          client_name: recurringInvoice.clientName || '',
          amount: recurringInvoice.amount || 0,
          frequency: recurringInvoice.frequency?.toLowerCase() || 'monthly',
          start_date: recurringInvoice.startDate || new Date().toISOString().split('T')[0],
          end_date: recurringInvoice.endDate || null,
          last_generated_date: recurringInvoice.lastGeneratedDate || recurringInvoice.startDate || new Date().toISOString().split('T')[0],
          owner_id: profile.id,
          created_by: currentUser.id,
          created_by_name: creatorName,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...currencyPayload
        })
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création facture récurrente:', error);
      return { data: null, error };
    }
  }

  static async updateRecurringInvoice(id: string, updates: Partial<any>) {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.clientName !== undefined) updateData.client_name = updates.clientName;
      if (updates.amount !== undefined) updateData.amount = updates.amount;
      if (updates.frequency !== undefined) updateData.frequency = updates.frequency.toLowerCase();
      if (updates.startDate !== undefined) updateData.start_date = updates.startDate;
      if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
      if (updates.lastGeneratedDate !== undefined) updateData.last_generated_date = updates.lastGeneratedDate;

      if (
        updates.amount !== undefined ||
        updates.currencyCode !== undefined ||
        (updates as any).manualExchangeRate !== undefined
      ) {
        const currencyPayload = await this.buildCurrencyColumns(
          updates.amount ?? 0,
          (updates.currencyCode as CurrencyCode) || undefined,
          updates.startDate,
          (updates as any).manualExchangeRate || updates.exchangeRate || undefined
        );
        Object.assign(updateData, currencyPayload);
      }

      const { data, error } = await supabase
        .from('recurring_invoices')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour facture récurrente:', error);
      return { data: null, error };
    }
  }

  static async deleteRecurringInvoice(id: string) {
    try {
      const { error } = await supabase
        .from('recurring_invoices')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression facture récurrente:', error);
      return { error };
    }
  }

  // ===== RECURRING EXPENSES =====
  static async getRecurringExpenses() {
    return await ApiHelper.get('recurring_expenses', { 
      select: '*', 
      order: 'created_at.desc' 
    });
  }

  static async createRecurringExpense(recurringExpense: Partial<any>) {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('user_id', currentUser.id)
        .single();

      if (!profile) {
        throw new Error('Profil utilisateur non trouvé');
      }

      const creatorName = profile?.full_name || currentUser.email || null;
      
      const currencyPayload = await this.buildCurrencyColumns(
        recurringExpense.amount ?? 0,
        (recurringExpense.currencyCode as CurrencyCode) || 'USD',
        recurringExpense.startDate,
        (recurringExpense as any).manualExchangeRate || recurringExpense.exchangeRate || undefined
      );

      const { data, error } = await supabase
        .from('recurring_expenses')
        .insert({
          category: recurringExpense.category || '',
          description: recurringExpense.description || '',
          amount: recurringExpense.amount || 0,
          frequency: recurringExpense.frequency?.toLowerCase() || 'monthly',
          start_date: recurringExpense.startDate || new Date().toISOString().split('T')[0],
          end_date: recurringExpense.endDate || null,
          last_generated_date: recurringExpense.lastGeneratedDate || recurringExpense.startDate || new Date().toISOString().split('T')[0],
          owner_id: profile.id,
          created_by: currentUser.id,
          created_by_name: creatorName,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...currencyPayload
        })
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création dépense récurrente:', error);
      return { data: null, error };
    }
  }

  static async updateRecurringExpense(id: string, updates: Partial<any>) {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.amount !== undefined) updateData.amount = updates.amount;
      if (updates.frequency !== undefined) updateData.frequency = updates.frequency.toLowerCase();
      if (updates.startDate !== undefined) updateData.start_date = updates.startDate;
      if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
      if (updates.lastGeneratedDate !== undefined) updateData.last_generated_date = updates.lastGeneratedDate;

      if (
        updates.amount !== undefined ||
        updates.currencyCode !== undefined ||
        (updates as any).manualExchangeRate !== undefined
      ) {
        const currencyPayload = await this.buildCurrencyColumns(
          updates.amount ?? 0,
          (updates.currencyCode as CurrencyCode) || undefined,
          updates.startDate,
          (updates as any).manualExchangeRate || updates.exchangeRate || undefined
        );
        Object.assign(updateData, currencyPayload);
      }

      const { data, error } = await supabase
        .from('recurring_expenses')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour dépense récurrente:', error);
      return { data: null, error };
    }
  }

  static async deleteRecurringExpense(id: string) {
    try {
      const { error } = await supabase
        .from('recurring_expenses')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression dépense récurrente:', error);
      return { error };
    }
  }

  // ===== BUDGETS =====
  static async getBudgets() {
    return await ApiHelper.get('budgets', { 
      select: '*', 
      order: 'created_at.desc' 
    });
  }

  static async getBudgetLines(budgetId: string) {
    return await ApiHelper.get('budget_lines', { 
      select: '*', 
      order: 'created_at.asc',
      budget_id: `eq.${budgetId}`
    });
  }

  static async getBudgetItems(budgetLineId: string) {
    return await ApiHelper.get('budget_items', { 
      select: '*', 
      order: 'created_at.asc',
      budget_line_id: `eq.${budgetLineId}`
    });
  }

  static async createBudget(budget: Partial<any>) {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .eq('user_id', currentUser.id)
        .single();

      if (!profile) {
        throw new Error('Profil utilisateur non trouvé');
      }

      const creatorName = profile?.full_name || currentUser.email || null;
      
      const currencyPayload = await this.buildCurrencyColumns(
        budget.amount ?? 0,
        (budget.currencyCode as CurrencyCode) || 'USD',
        budget.startDate,
        (budget as any).manualExchangeRate || budget.exchangeRate || undefined
      );
      
      // Pour les budgets, on n'utilise pas transaction_date (la table budgets n'a pas cette colonne)
      const { transaction_date, ...budgetCurrencyPayload } = currencyPayload;

      const { data: budgetData, error: budgetError } = await supabase
        .from('budgets')
        .insert({
          title: budget.title || '',
          type: budget.type?.toLowerCase() || 'project',
          amount: budget.amount || 0,
          start_date: budget.startDate || new Date().toISOString().split('T')[0],
          end_date: budget.endDate || new Date().toISOString().split('T')[0],
          project_id: budget.projectId || null,
          owner_id: profile.id,
          created_by: currentUser.id,
          created_by_name: creatorName,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...budgetCurrencyPayload
        })
        .select()
        .single();
      
      if (budgetError) throw budgetError;

      // Créer les budget_lines et budget_items si fournis
      if (budgetData && budget.budgetLines && Array.isArray(budget.budgetLines)) {
        for (const line of budget.budgetLines) {
          const { data: lineData, error: lineError } = await supabase
            .from('budget_lines')
            .insert({
              budget_id: budgetData.id,
              title: line.title || '',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select()
            .single();

          if (lineError) {
            console.error('Erreur création ligne budget:', lineError);
            continue;
          }

          if (lineData && line.items && Array.isArray(line.items)) {
            for (const item of line.items) {
              await supabase
                .from('budget_items')
                .insert({
                  budget_line_id: lineData.id,
                  description: item.description || '',
                  amount: item.amount || 0,
                  created_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                });
            }
          }
        }
      }

      return { data: budgetData, error: null };
    } catch (error) {
      console.error('Erreur création budget:', error);
      return { data: null, error };
    }
  }

  static async updateBudget(id: string, updates: Partial<any>) {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.type !== undefined) updateData.type = updates.type.toLowerCase();
      if (updates.amount !== undefined) updateData.amount = updates.amount;
      if (updates.startDate !== undefined) updateData.start_date = updates.startDate;
      if (updates.endDate !== undefined) updateData.end_date = updates.endDate;
      if (updates.projectId !== undefined) updateData.project_id = updates.projectId;

      if (
        updates.amount !== undefined ||
        updates.currencyCode !== undefined ||
        (updates as any).manualExchangeRate !== undefined
      ) {
        const currencyPayload = await this.buildCurrencyColumns(
          updates.amount ?? 0,
          (updates.currencyCode as CurrencyCode) || undefined,
          updates.startDate || (updates as any).transactionDate,
          (updates as any).manualExchangeRate || updates.exchangeRate || undefined
        );
        // Pour les budgets, on n'utilise pas transaction_date (la table budgets n'a pas cette colonne)
        const { transaction_date, ...budgetCurrencyPayload } = currencyPayload;
        Object.assign(updateData, budgetCurrencyPayload);
      }

      const { data, error } = await supabase
        .from('budgets')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      if (updates.budgetLines && Array.isArray(updates.budgetLines)) {
        const { data: existingLinesData } = await supabase
          .from('budget_lines')
          .select('id')
          .eq('budget_id', id);
        const existingLineIds = new Set((existingLinesData || []).map(line => line.id));
        const keptLineIds = new Set<string>();

        for (const line of updates.budgetLines) {
          const timestamp = new Date().toISOString();
          let lineId = (line.id && existingLineIds.has(line.id)) ? line.id : undefined;

          if (lineId) {
            await supabase
              .from('budget_lines')
              .update({
                title: line.title || '',
                updated_at: timestamp
              })
              .eq('id', lineId);
          } else {
            const { data: insertedLine } = await supabase
              .from('budget_lines')
              .insert({
                budget_id: id,
                title: line.title || '',
                created_at: timestamp,
                updated_at: timestamp
              })
              .select()
              .single();
            lineId = insertedLine?.id;
          }

          if (!lineId) continue;
          keptLineIds.add(lineId);

          if (line.items && Array.isArray(line.items)) {
            const { data: existingItemsData } = await supabase
              .from('budget_items')
              .select('id')
              .eq('budget_line_id', lineId);
            const existingItemIds = new Set((existingItemsData || []).map(item => item.id));
            const keptItemIds = new Set<string>();

            for (const item of line.items) {
              let itemId = (item.id && existingItemIds.has(item.id)) ? item.id : undefined;

              if (itemId) {
                await supabase
                  .from('budget_items')
                  .update({
                    description: item.description || '',
                    amount: item.amount || 0,
                    updated_at: timestamp
                  })
                  .eq('id', itemId);
              } else {
                const { data: insertedItem } = await supabase
                  .from('budget_items')
                  .insert({
                    budget_line_id: lineId,
                    description: item.description || '',
                    amount: item.amount || 0,
                    created_at: timestamp,
                    updated_at: timestamp
                  })
                  .select()
                  .single();
                itemId = insertedItem?.id;
              }

              if (itemId) {
                keptItemIds.add(itemId);
              }
            }

            const itemsToDelete = [...existingItemIds].filter(itemId => !keptItemIds.has(itemId));
            if (itemsToDelete.length > 0) {
              await supabase
                .from('budget_items')
                .delete()
                .in('id', itemsToDelete);
            }
          }
        }

        const linesToDelete = [...existingLineIds].filter(lineId => !keptLineIds.has(lineId));
        if (linesToDelete.length > 0) {
          const { data: orphanItems } = await supabase
            .from('budget_items')
            .select('id')
            .in('budget_line_id', linesToDelete);
          const orphanItemIds = (orphanItems || []).map(item => item.id);
          if (orphanItemIds.length > 0) {
            await supabase
              .from('budget_items')
              .delete()
              .in('id', orphanItemIds);
          }

          await supabase
            .from('budget_lines')
            .delete()
            .in('id', linesToDelete);
        }
      }

      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour budget:', error);
      return { data: null, error };
    }
  }

  static async deleteBudget(id: string) {
    try {
      // Les budget_lines et budget_items seront supprimés automatiquement via CASCADE
      const { error } = await supabase
        .from('budgets')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression budget:', error);
      return { error };
    }
  }

  // ===== CONTACTS =====
  static async getContacts() {
    return await ApiHelper.get('contacts', { 
      select: '*', 
      order: 'created_at.desc' 
    });
  }

  static async createContact(contact: any) {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, organization_id')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (!profile?.id) {
        throw new Error('Profil utilisateur introuvable');
      }

      const creatorName = profile.full_name || currentUser.email || null;
      let organizationId = (profile as { organization_id?: string | null }).organization_id ?? null;
      if (!organizationId) {
        organizationId = await OrganizationService.getCurrentUserOrganizationId();
      }
      const baseRow = buildContactInsertRow(contact as Partial<Contact>);

      // `contacts.created_by` référence `auth.users` (table `users` côté PostgREST), pas `profiles.id`.
      const insertRow: Record<string, unknown> = {
        ...baseRow,
        created_by: currentUser.id,
        created_by_name: creatorName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (organizationId) {
        insertRow.organization_id = organizationId;
      }

      const { data, error } = await supabase
        .from('contacts')
        .insert(insertRow)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      const e = error as { message?: string; code?: string; details?: string; hint?: string };
      console.error('Erreur création contact:', e?.message || error, e?.code, e?.details, e?.hint);
      return { data: null, error };
    }
  }

  static async updateContact(id: string, updates: Partial<Contact>) {
    try {
      const row = buildContactUpdatePatch(updates);
      const { data, error } = await supabase
        .from('contacts')
        .update(row)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour contact:', error);
      return { data: null, error };
    }
  }

  static async deleteContact(id: string) {
    try {
      const { error } = await supabase
        .from('contacts')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression contact:', error);
      return { error };
    }
  }

  // ===== TIME LOGS =====
  static async getTimeLogs() {
    return await ApiHelper.get('time_logs', { 
      select: '*', 
      order: 'created_at.desc' 
    });
  }

  static async createTimeLog(timeLog: Partial<TimeLog>) {
    try {
      // Récupérer l'utilisateur actuel et son profil
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      // Récupérer le profil pour obtenir l'ID du profil (pas l'ID auth)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', currentUser.id)
        .single();
      
      if (profileError || !profile) {
        console.error('❌ Erreur récupération profil:', profileError);
        throw new Error(`Profil non trouvé: ${profileError?.message || 'Profil introuvable'}`);
      }

      console.log('✅ Profil trouvé pour time log:', { profileId: profile.id, userId: currentUser.id });

      // Convertir duration (minutes) en hours si nécessaire
      const hours = timeLog.duration ? timeLog.duration / 60 : 0;

      // Fonction pour vérifier si une string est un UUID valide
      const isValidUUID = (str: string): boolean => {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        return uuidRegex.test(str);
      };

      // Résoudre les IDs selon le type d'entité
      // IMPORTANT: Ne mettre project_id, course_id, task_id, meeting_id QUE si ce sont des UUIDs valides
      let projectId: string | null = null;
      let courseId: string | null = null;
      let taskId: string | null = null;
      let meetingId: string | null = null;

      const entityIdStr = typeof timeLog.entityId === 'string' ? timeLog.entityId : String(timeLog.entityId || '');

      if (timeLog.entityType === 'project') {
        // Si c'est un UUID valide, utiliser project_id, sinon utiliser uniquement entity_id (text)
        if (isValidUUID(entityIdStr)) {
          projectId = entityIdStr;
        }
        // Pour les cas comme "meeting", on laisse projectId à null et on utilise entity_id (text)
      } else if (timeLog.entityType === 'course') {
        // Course.id est un number, donc on ne peut pas l'utiliser comme UUID
        // On utilise uniquement entity_id (text)
        // Mais si on a un UUID de cours depuis Supabase, on peut l'utiliser
        if (isValidUUID(entityIdStr)) {
          courseId = entityIdStr;
        }
      } else if (timeLog.entityType === 'task') {
        // Les tâches ont des IDs comme "ai-task-1761739925911-2" qui ne sont pas des UUIDs
        // On utilise uniquement entity_id (text), pas task_id (UUID)
        // Mais si c'est un UUID valide, on peut l'utiliser
        if (isValidUUID(entityIdStr)) {
          taskId = entityIdStr;
        }
      }

      console.log('🔄 Tentative création time log avec:', {
        entityType: timeLog.entityType,
        entityId: entityIdStr,
        entityTitle: timeLog.entityTitle,
        projectId,
        courseId,
        taskId,
        meetingId
      });

      const { data, error } = await supabase
        .from('time_logs')
        .insert({
          user_id: profile.id, // Utiliser l'ID du profil
          project_id: projectId, // null si pas un UUID valide
          course_id: courseId, // null si pas un UUID valide
          task_id: taskId, // null si pas un UUID valide
          meeting_id: meetingId, // null si pas un UUID valide
          description: timeLog.description || '',
          duration: timeLog.duration || 0, // En minutes
          hours: hours, // En heures
          date: timeLog.date || new Date().toISOString().split('T')[0],
          entity_type: timeLog.entityType || 'project',
          entity_id: entityIdStr, // Toujours utiliser ce champ pour stocker l'ID (text)
          entity_title: timeLog.entityTitle || '',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur création time log:', error);
        throw error;
      }
      
      console.log('✅ Time log créé:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création log temps:', error);
      return { data: null, error };
    }
  }

  static async updateTimeLog(id: string, updates: Partial<TimeLog>) {
    try {
      const hours = updates.duration ? updates.duration / 60 : 0;
      
      const { data, error } = await supabase
        .from('time_logs')
        .update({
          description: updates.description,
          duration: updates.duration,
          hours: hours,
          date: updates.date,
          entity_type: updates.entityType,
          entity_id: typeof updates.entityId === 'string' ? updates.entityId : String(updates.entityId || ''),
          entity_title: updates.entityTitle,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour time log:', error);
      return { data: null, error };
    }
  }

  static async deleteTimeLog(id: string) {
    try {
      const { error } = await supabase
        .from('time_logs')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression time log:', error);
      return { error };
    }
  }

  // ===== WORKFORCE TIMELINE SEGMENTS =====
  private static mapWorkforceTimelineSegmentRow(row: any): WorkforceTimelineSegmentRow {
    return {
      id: row.id,
      organizationId: row.organization_id,
      createdByUserId: row.created_by_user_id,
      workerId: row.worker_id,
      segmentKind: row.segment_kind,
      operationalContext: row.operational_context ?? null,
      deviceRef: (row.device_ref && typeof row.device_ref === 'object' ? row.device_ref : {}) as Record<string, unknown>,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      sourceClientEventId: row.source_client_event_id,
      payload: (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>,
      createdAt: row.created_at,
    };
  }

  /** Segments du jour pour l’utilisateur connecté (créateur des lignes). */
  static async listMyWorkforceTimelineSegmentsForDay(
    day: Date | string,
  ): Promise<{ data: WorkforceTimelineSegmentRow[] | null; error: any }> {
    if (isTableUnavailable('workforce_timeline_segments')) {
      return { data: [], error: null };
    }
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) return { data: [], error: null };

      const d = typeof day === 'string' ? new Date(`${day}T12:00:00`) : new Date(day);
      const from = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
      const to = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();

      const { data, error } = await supabase
        .from('workforce_timeline_segments')
        .select('*')
        .eq('created_by_user_id', user.id)
        .gte('started_at', from)
        .lte('started_at', to)
        .order('started_at', { ascending: true });

      if (error) {
        if (
          handleOptionalTableError(error, 'workforce_timeline_segments', 'DataService.listMyWorkforceTimelineSegmentsForDay')
        ) {
          return { data: [], error: null };
        }
        return { data: null, error };
      }
      return { data: (data || []).map(this.mapWorkforceTimelineSegmentRow), error: null };
    } catch (e) {
      if (
        handleOptionalTableError(e, 'workforce_timeline_segments', 'DataService.listMyWorkforceTimelineSegmentsForDay.catch')
      ) {
        return { data: [], error: null };
      }
      return { data: null, error: e };
    }
  }

  // ===== PRESENCE SESSIONS (Phase 4 Bloc 1) =====
  private static mapPresenceRow(row: any): PresenceSession {
    return {
      id: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? undefined,
      status: row.status as PresenceStatus,
      meetingId: row.meeting_id ?? undefined,
      pauseMinutes: row.pause_minutes ?? 0,
      hourlyRate: row.hourly_rate ?? null,
      startedIp: row.started_ip ?? null,
      endedIp: row.ended_ip ?? null,
      workMode: (row.work_mode || 'office') as WorkMode,
      notes: row.notes ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private static mapPresenceStatusEventRow(row: any): PresenceStatusEvent {
    return {
      id: row.id,
      presenceSessionId: row.presence_session_id,
      organizationId: row.organization_id,
      userId: row.user_id,
      status: row.status as PresenceStatus,
      startedAt: row.started_at,
      endedAt: row.ended_at ?? null,
      durationMinutes: row.duration_minutes ?? null,
      durationSeconds: row.duration_seconds ?? null,
      source: row.source ?? 'system',
      notes: row.notes ?? null,
      createdAt: row.created_at,
    };
  }

  private static mapHrAttendancePolicyRow(row: any): HrAttendancePolicy {
    return {
      id: row.id,
      organizationId: row.organization_id,
      payrollPeriodStartDay: row.payroll_period_start_day ?? 1,
      expectedDailyMinutes: row.expected_daily_minutes ?? 540,
      expectedWorkStartTime: row.expected_work_start_time ?? '09:00:00',
      expectedWorkEndTime: row.expected_work_end_time ?? '17:00:00',
      morningSegmentEndTime: row.morning_segment_end_time ?? '12:00:00',
      lunchStartTime: row.lunch_start_time ?? '13:00:00',
      lunchEndTime: row.lunch_end_time ?? '14:00:00',
      afternoonPresenceDeadlineTime: row.afternoon_presence_deadline_time ?? '14:00:00',
      monthlyDelayToleranceMinutes: row.monthly_delay_tolerance_minutes ?? 45,
      monthlyUnjustifiedAbsenceToleranceMinutes: row.monthly_unjustified_absence_tolerance_minutes ?? 480,
      defaultWorkMode: (row.default_work_mode || 'office') as WorkMode,
      enforceOfficeIp: row.enforce_office_ip === true,
      officeIpAllowlist: Array.isArray(row.office_ip_allowlist) ? row.office_ip_allowlist : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private static mapEmployeeWorkScheduleRow(row: any): EmployeeWorkSchedule {
    return {
      id: row.id,
      organizationId: row.organization_id,
      profileId: row.profile_id,
      isoWeekday: row.iso_weekday,
      expectedStartTime: row.expected_start_time ?? null,
      expectedEndTime: row.expected_end_time ?? null,
      lunchStartTime: row.lunch_start_time ?? null,
      lunchEndTime: row.lunch_end_time ?? null,
      afternoonStartTime: row.afternoon_start_time ?? null,
      active: row.active !== false,
      effectiveFrom: row.effective_from ?? null,
      effectiveTo: row.effective_to ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private static mapHrWorkforceAnomalyRow(row: any): HrWorkforceAnomaly {
    return {
      id: row.id,
      organizationId: row.organization_id,
      profileId: row.profile_id,
      workDate: row.work_date,
      anomalyKind: row.anomaly_kind,
      minutesValue: row.minutes_value ?? 0,
      managerDecision: row.manager_decision ?? 'pending',
      countsTowardAbsence: row.counts_toward_absence !== false,
      notes: row.notes ?? null,
      decidedByUserId: row.decided_by_user_id ?? null,
      decidedAt: row.decided_at ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  static async getPresenceSessions(params?: { userId?: string; organizationId?: string; from?: string; to?: string }): Promise<{ data: PresenceSession[] | null; error: any }> {
    if (isTableUnavailable('presence_sessions')) {
      return { data: [], error: null };
    }
    try {
      let query = supabase.from('presence_sessions').select('*').order('started_at', { ascending: false });
      if (params?.userId) query = query.eq('user_id', params.userId);
      if (params?.organizationId) query = query.eq('organization_id', params.organizationId);
      if (params?.from) query = query.gte('started_at', params.from);
      if (params?.to) query = query.lte('started_at', params.to);
      const { data, error } = await query;
      if (error) {
        if (handleOptionalTableError(error, 'presence_sessions', 'DataService.getPresenceSessions')) {
          return { data: [], error: null };
        }
        return { data: null, error };
      }
      return { data: (data || []).map(this.mapPresenceRow), error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'presence_sessions', 'DataService.getPresenceSessions.catch')) {
        return { data: [], error: null };
      }
      console.error('getPresenceSessions error:', e);
      return { data: null, error: e };
    }
  }

  static async getCurrentPresenceSession(userId: string): Promise<{ data: PresenceSession | null; error: any }> {
    try {
      const { data, error } = await supabase
        .from('presence_sessions')
        .select('*')
        .eq('user_id', userId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) return { data: null, error };
      const mapped = data ? this.mapPresenceRow(data) : null;
      // « Absent » = pas de session active : pas de chronomètre ni de durée continue.
      if (mapped && mapped.status === 'absent') {
        return { data: null, error: null };
      }
      return { data: mapped, error: null };
    } catch (e) {
      console.error('getCurrentPresenceSession error:', e);
      return { data: null, error: e };
    }
  }

  static async createPresenceSession(session: Partial<PresenceSession>): Promise<{ data: PresenceSession | null; error: any }> {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return { data: null, error: new Error('Non authentifié') };
      const { data: profile } = await supabase.from('profiles').select('id, organization_id').eq('user_id', currentUser.id).single();
      const organizationId = session.organizationId || (profile as any)?.organization_id;
      if (!organizationId) return { data: null, error: new Error('Organisation inconnue') };

      const [policyResult, employeeResult] = await Promise.all([
        this.getHrAttendancePolicy(organizationId),
        profile?.id ? this.getEmployeeByProfileId(String((profile as any).id)) : Promise.resolve({ data: null, error: null as any }),
      ]);
      const policy = policyResult.data;
      const employee = employeeResult.data;
      const resolvedMode = (session.workMode || employee?.workMode || policy?.defaultWorkMode || 'office') as WorkMode;
      const officeCheck = this.isOfficeAccessAllowed(policy, resolvedMode, session.startedIp ?? null);
      if (!officeCheck.allowed) {
        return { data: null, error: new Error(officeCheck.reason || 'Accès présence refusé (politique de localisation).') };
      }

      const row = {
        user_id: currentUser.id,
        organization_id: organizationId,
        started_at: session.startedAt || new Date().toISOString(),
        ended_at: session.endedAt ?? null,
        status: session.status ?? 'absent',
        meeting_id: session.meetingId ?? null,
        pause_minutes: session.pauseMinutes ?? 0,
        notes: session.notes ?? null,
        hourly_rate: session.hourlyRate ?? employee?.hourlyRate ?? null,
        started_ip: session.startedIp ?? null,
        work_mode: resolvedMode,
      };
      const { data, error } = await supabase.from('presence_sessions').insert(row).select().single();
      if (error) return { data: null, error };
      const mapped = this.mapPresenceRow(data);
      await this.startPresenceStatusEvent({
        presenceSessionId: mapped.id,
        organizationId: mapped.organizationId,
        userId: mapped.userId,
        status: mapped.status,
        startedAt: mapped.startedAt,
        source: 'selector',
      });
      return { data: mapped, error: null };
    } catch (e) {
      console.error('createPresenceSession error:', e);
      return { data: null, error: e };
    }
  }

  static async updatePresenceSession(id: string, updates: Partial<PresenceSession>): Promise<{ data: PresenceSession | null; error: any }> {
    try {
      const row: any = {};
      if (updates.endedAt !== undefined) row.ended_at = updates.endedAt;
      if (updates.startedAt !== undefined) row.started_at = updates.startedAt;
      if (updates.status !== undefined) row.status = updates.status;
      if (updates.meetingId !== undefined) row.meeting_id = updates.meetingId;
      if (updates.pauseMinutes !== undefined) row.pause_minutes = updates.pauseMinutes;
      if (updates.notes !== undefined) row.notes = updates.notes;
      if (updates.hourlyRate !== undefined) row.hourly_rate = updates.hourlyRate;
      if (updates.startedIp !== undefined) row.started_ip = updates.startedIp;
      if (updates.endedIp !== undefined) row.ended_ip = updates.endedIp;
      if (updates.workMode !== undefined) row.work_mode = updates.workMode;
      row.updated_at = new Date().toISOString();
      const { data, error } = await supabase.from('presence_sessions').update(row).eq('id', id).select().single();
      if (error) return { data: null, error };
      const mapped = this.mapPresenceRow(data);
      if (updates.status !== undefined) {
        await this.startPresenceStatusEvent({
          presenceSessionId: mapped.id,
          organizationId: mapped.organizationId,
          userId: mapped.userId,
          status: updates.status,
          startedAt: new Date().toISOString(),
          source: 'widget',
        });
      }
      if (updates.endedAt) {
        await this.closeActivePresenceStatusEvent(mapped.id, updates.endedAt);
      }
      return { data: mapped, error: null };
    } catch (e) {
      console.error('updatePresenceSession error:', e);
      return { data: null, error: e };
    }
  }

  static async listPresenceStatusEvents(params: {
    organizationId?: string;
    userId?: string;
    sessionId?: string;
    from?: string;
    to?: string;
    /** Si true avec organizationId seul : limite aux 365 derniers jours (évite chargements énormes) */
    defaultRecentWindow?: boolean;
  }): Promise<{ data: PresenceStatusEvent[] | null; error: any }> {
    if (isTableUnavailable('presence_status_events')) {
      return { data: [], error: null };
    }
    try {
      let query = supabase.from('presence_status_events').select('*').order('started_at', { ascending: false });
      if (params.organizationId) query = query.eq('organization_id', params.organizationId);
      if (params.userId) query = query.eq('user_id', params.userId);
      if (params.sessionId) query = query.eq('presence_session_id', params.sessionId);
      if (params.from) query = query.gte('started_at', params.from);
      if (params.to) query = query.lte('started_at', params.to);
      if (params.organizationId && params.defaultRecentWindow !== false && !params.from && !params.sessionId) {
        const d = new Date();
        d.setDate(d.getDate() - 365);
        query = query.gte('started_at', d.toISOString());
      }
      const { data, error } = await query.limit(8000);
      if (error) {
        if (handleOptionalTableError(error, 'presence_status_events', 'DataService.listPresenceStatusEvents')) {
          return { data: [], error: null };
        }
        return { data: null, error };
      }
      return { data: (data || []).map((r: any) => this.mapPresenceStatusEventRow(r)), error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'presence_status_events', 'DataService.listPresenceStatusEvents.catch')) {
        return { data: [], error: null };
      }
      return { data: null, error: e };
    }
  }

  static async startPresenceStatusEvent(params: {
    presenceSessionId: string;
    organizationId: string;
    userId: string;
    status: PresenceStatus;
    startedAt?: string;
    source?: 'selector' | 'widget' | 'system';
    notes?: string | null;
  }): Promise<{ data: PresenceStatusEvent | null; error: any }> {
    if (isTableUnavailable('presence_status_events')) {
      return { data: null, error: null };
    }
    try {
      const nowIso = params.startedAt || new Date().toISOString();
      const { data: active } = await supabase
        .from('presence_status_events')
        .select('*')
        .eq('presence_session_id', params.presenceSessionId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (active) {
        const deltaMs = new Date(nowIso).getTime() - new Date(active.started_at).getTime();
        const durationSeconds = Math.max(0, Math.floor(deltaMs / 1000));
        const durationMinutes = Math.floor(durationSeconds / 60);
        await supabase
          .from('presence_status_events')
          .update({
            ended_at: nowIso,
            duration_minutes: durationMinutes,
            duration_seconds: durationSeconds,
          })
          .eq('id', active.id);
      }

      const { data, error } = await supabase
        .from('presence_status_events')
        .insert({
          presence_session_id: params.presenceSessionId,
          organization_id: params.organizationId,
          user_id: params.userId,
          status: params.status,
          started_at: nowIso,
          source: params.source || 'system',
          notes: params.notes ?? null,
        })
        .select('*')
        .single();
      if (error) {
        if (handleOptionalTableError(error, 'presence_status_events', 'DataService.startPresenceStatusEvent')) {
          return { data: null, error: null };
        }
        return { data: null, error };
      }
      return { data: this.mapPresenceStatusEventRow(data), error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'presence_status_events', 'DataService.startPresenceStatusEvent.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error: e };
    }
  }

  static async closeActivePresenceStatusEvent(sessionId: string, endedAt?: string): Promise<void> {
    if (isTableUnavailable('presence_status_events')) return;
    const endIso = endedAt || new Date().toISOString();
    try {
      const { data: active } = await supabase
        .from('presence_status_events')
        .select('*')
        .eq('presence_session_id', sessionId)
        .is('ended_at', null)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active) return;
      const deltaMs = new Date(endIso).getTime() - new Date(active.started_at).getTime();
      const durationSeconds = Math.max(0, Math.floor(deltaMs / 1000));
      const durationMinutes = Math.floor(durationSeconds / 60);
      await supabase
        .from('presence_status_events')
        .update({
          ended_at: endIso,
          duration_minutes: durationMinutes,
          duration_seconds: durationSeconds,
        })
        .eq('id', active.id);
    } catch {
      // silent
    }
  }

  // ===== EMPLOYEES (Phase 4 Bloc 1.5 – Fiche salarié) =====
  private static parseHrAttachments(raw: unknown): EmployeeHrAttachment[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as EmployeeHrAttachment[];
    if (typeof raw === 'string') {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private static mapEmployeeRow(row: any): Employee {
    return {
      id: row.id,
      organizationId: row.organization_id,
      profileId: row.profile_id,
      position: row.position ?? undefined,
      workMode: row.work_mode ?? 'office',
      hourlyRate: row.hourly_rate ?? null,
      expectedDailyMinutes: row.expected_daily_minutes ?? null,
      managerId: row.manager_id ?? undefined,
      mentorId: row.mentor_id ?? undefined,
      cnss: row.cnss ?? undefined,
      amo: row.amo ?? undefined,
      indemnities: row.indemnities ?? undefined,
      leaveRate: row.leave_rate ?? undefined,
      tenureDate: row.tenure_date ?? undefined,
      familySituation: row.family_situation ?? undefined,
      photoUrl: row.photo_url ?? undefined,
      cvUrl: row.cv_url ?? undefined,
      hrAttachments: this.parseHrAttachments(row.hr_attachments),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /** Upload photo / CV / document RH vers le bucket `employee-files` (migration + bucket requis). */
  static async uploadEmployeeHrFile(params: {
    organizationId: string;
    employeeProfileId: string;
    file: File;
    subfolder: 'photo' | 'cv' | 'documents';
  }): Promise<{ publicUrl: string | null; error: any }> {
    try {
      const bucket = 'employee-files';
      const safe = params.file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
      const path = `${params.organizationId}/${params.employeeProfileId}/${params.subfolder}/${Date.now()}_${safe}`;
      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, params.file, {
        cacheControl: '3600',
        upsert: true,
      });
      if (uploadError) return { publicUrl: null, error: uploadError };
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      return { publicUrl: data?.publicUrl ?? null, error: null };
    } catch (e) {
      return { publicUrl: null, error: e };
    }
  }

  static async listEmployees(organizationId?: string | null): Promise<Employee[]> {
    if (isTableUnavailable('employees')) return [];
    try {
      const orgId = organizationId || (await this.getCurrentUserOrganizationId());
      if (!orgId) return [];
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (error) {
        if (handleOptionalTableError(error, 'employees', 'DataService.listEmployees')) {
          return [];
        }
        return [];
      }
      return (data || []).map((r: any) => this.mapEmployeeRow(r));
    } catch (e) {
      if (handleOptionalTableError(e, 'employees', 'DataService.listEmployees.catch')) {
        return [];
      }
      console.error('listEmployees error:', e);
      return [];
    }
  }

  static async getEmployeeByProfileId(profileId: string): Promise<{ data: Employee | null; error: any }> {
    if (isTableUnavailable('employees')) return { data: null, error: null };
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) return { data: null, error: new Error('Organisation inconnue') };
      const { data, error } = await supabase
        .from('employees')
        .select('*')
        .eq('organization_id', orgId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) {
        if (handleOptionalTableError(error, 'employees', 'DataService.getEmployeeByProfileId')) {
          return { data: null, error: null };
        }
        return { data: null, error };
      }
      return { data: data ? this.mapEmployeeRow(data) : null, error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'employees', 'DataService.getEmployeeByProfileId.catch')) {
        return { data: null, error: null };
      }
      console.error('getEmployeeByProfileId error:', e);
      return { data: null, error: e };
    }
  }

  static async upsertEmployee(employee: Partial<Employee>): Promise<{ data: Employee | null; error: any }> {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) return { data: null, error: new Error('Non authentifié') };
      const { data: profile } = await supabase.from('profiles').select('id, organization_id').eq('user_id', currentUser.id).single();
      const organizationId = employee.organizationId || (profile as any)?.organization_id;
      const profileId = employee.profileId || (profile as any)?.id;
      if (!organizationId || !profileId) return { data: null, error: new Error('Organisation ou profil manquant') };
      // PostgREST PGRST204 si une clé JSON ne correspond à aucune colonne. Le hotfix `employees` n’a souvent
      // pas cnss/amo/work_mode/… — le formulaire envoie toujours les clés avec des chaînes vides : on n’inclut
      // ces champs que s’ils ont une valeur utile, ou (HR) si l’utilisateur sort des défauts du formulaire.
      const row: Record<string, unknown> = {
        organization_id: organizationId,
        profile_id: profileId,
        updated_at: new Date().toISOString(),
      };
      const e = employee as Record<string, unknown>;
      const strTrim = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
      const includeOptionalText = (v: unknown) => strTrim(v) !== '';

      if ('position' in e) row.position = strTrim(e.position) === '' ? null : e.position ?? null;
      if ('managerId' in e) row.manager_id = strTrim(e.managerId) === '' ? null : e.managerId ?? null;
      if ('mentorId' in e) row.mentor_id = strTrim(e.mentorId) === '' ? null : e.mentorId ?? null;
      if ('cnss' in e && includeOptionalText(e.cnss)) row.cnss = strTrim(e.cnss);
      if ('amo' in e && includeOptionalText(e.amo)) row.amo = strTrim(e.amo);
      if ('indemnities' in e && includeOptionalText(e.indemnities)) row.indemnities = strTrim(e.indemnities);
      if ('leaveRate' in e) row.leave_rate = e.leaveRate ?? null;
      if ('tenureDate' in e && includeOptionalText(e.tenureDate)) row.tenure_date = strTrim(e.tenureDate);
      if ('familySituation' in e && includeOptionalText(e.familySituation)) row.family_situation = strTrim(e.familySituation);
      if ('photoUrl' in e && includeOptionalText(e.photoUrl)) row.photo_url = strTrim(e.photoUrl);
      if ('cvUrl' in e && includeOptionalText(e.cvUrl)) row.cv_url = strTrim(e.cvUrl);

      const wm = e.workMode;
      const hr = e.hourlyRate;
      const edm = e.expectedDailyMinutes;
      const hrMeaningful =
        ('workMode' in e && wm != null && String(wm) !== '' && String(wm) !== 'office') ||
        ('hourlyRate' in e && typeof hr === 'number' && Number.isFinite(hr) && hr > 0) ||
        ('expectedDailyMinutes' in e &&
          typeof edm === 'number' &&
          Number.isFinite(edm) &&
          edm !== 480);
      if (hrMeaningful) {
        if ('workMode' in e) row.work_mode = wm ?? null;
        if ('hourlyRate' in e) row.hourly_rate = hr ?? null;
        if ('expectedDailyMinutes' in e) row.expected_daily_minutes = edm ?? null;
      }
      const att = (e as any).hrAttachments;
      if ('hrAttachments' in e && Array.isArray(att) && att.length > 0) {
        row.hr_attachments = att;
      }
      const { data, error } = await supabase.from('employees').upsert(row, {
        onConflict: 'organization_id,profile_id',
        ignoreDuplicates: false
      }).select().single();
      if (error) return { data: null, error };
      return { data: this.mapEmployeeRow(data), error: null };
    } catch (e) {
      console.error('upsertEmployee error:', e);
      return { data: null, error: e };
    }
  }

  static async getHrAttendancePolicy(organizationId?: string | null): Promise<{ data: HrAttendancePolicy | null; error: any }> {
    if (isTableUnavailable('hr_attendance_policies')) {
      return { data: null, error: null };
    }
    try {
      const orgId = organizationId || (await this.getCurrentUserOrganizationId());
      if (!orgId) return { data: null, error: new Error('Organisation inconnue') };
      const { data, error } = await supabase
        .from('hr_attendance_policies')
        .select('*')
        .eq('organization_id', orgId)
        .maybeSingle();
      if (error) {
        if (handleOptionalTableError(error, 'hr_attendance_policies', 'DataService.getHrAttendancePolicy')) {
          return { data: null, error: null };
        }
        return { data: null, error };
      }
      return { data: data ? this.mapHrAttendancePolicyRow(data) : null, error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_attendance_policies', 'DataService.getHrAttendancePolicy.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error: e };
    }
  }

  static async upsertHrAttendancePolicy(policy: Partial<HrAttendancePolicy>): Promise<{ data: HrAttendancePolicy | null; error: any }> {
    if (isTableUnavailable('hr_attendance_policies')) {
      return { data: null, error: null };
    }
    try {
      const orgId = policy.organizationId || (await this.getCurrentUserOrganizationId());
      if (!orgId) return { data: null, error: new Error('Organisation inconnue') };
      const row = {
        organization_id: orgId,
        payroll_period_start_day: policy.payrollPeriodStartDay ?? 1,
        expected_daily_minutes: policy.expectedDailyMinutes ?? 480,
        expected_work_start_time: policy.expectedWorkStartTime ?? '09:00:00',
        expected_work_end_time: policy.expectedWorkEndTime ?? '17:00:00',
        morning_segment_end_time: policy.morningSegmentEndTime ?? '12:00:00',
        lunch_start_time: policy.lunchStartTime ?? '13:00:00',
        lunch_end_time: policy.lunchEndTime ?? '14:00:00',
        afternoon_presence_deadline_time: policy.afternoonPresenceDeadlineTime ?? '14:00:00',
        monthly_delay_tolerance_minutes: policy.monthlyDelayToleranceMinutes ?? 45,
        monthly_unjustified_absence_tolerance_minutes: policy.monthlyUnjustifiedAbsenceToleranceMinutes ?? 480,
        default_work_mode: policy.defaultWorkMode ?? 'office',
        enforce_office_ip: policy.enforceOfficeIp === true,
        office_ip_allowlist: policy.officeIpAllowlist ?? [],
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase
        .from('hr_attendance_policies')
        .upsert(row, { onConflict: 'organization_id', ignoreDuplicates: false })
        .select('*')
        .single();
      if (error) {
        if (handleOptionalTableError(error, 'hr_attendance_policies', 'DataService.upsertHrAttendancePolicy')) {
          return { data: null, error: null };
        }
        return { data: null, error };
      }
      return { data: this.mapHrAttendancePolicyRow(data), error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_attendance_policies', 'DataService.upsertHrAttendancePolicy.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error: e };
    }
  }

  static async listEmployeeWorkSchedules(params: {
    profileId?: string;
    organizationId?: string;
    isoWeekday?: number;
    activeOnly?: boolean;
    forDate?: string;
  }): Promise<{ data: EmployeeWorkSchedule[] | null; error: any }> {
    if (isTableUnavailable('employee_work_schedules')) {
      return { data: [], error: null };
    }
    try {
      let query = supabase.from('employee_work_schedules').select('*').order('iso_weekday', { ascending: true });
      if (params.profileId) query = query.eq('profile_id', params.profileId);
      if (params.organizationId) query = query.eq('organization_id', params.organizationId);
      if (params.isoWeekday) query = query.eq('iso_weekday', params.isoWeekday);
      if (params.activeOnly !== false) query = query.eq('active', true);

      const { data, error } = await query;
      if (error) {
        if (handleOptionalTableError(error, 'employee_work_schedules', 'DataService.listEmployeeWorkSchedules')) {
          return { data: [], error: null };
        }
        return { data: null, error };
      }

      const rows = (data || []).map((r: any) => this.mapEmployeeWorkScheduleRow(r));
      if (params.forDate) {
        const target = params.forDate;
        const within = (row: EmployeeWorkSchedule) => {
          const fromOk = !row.effectiveFrom || row.effectiveFrom <= target;
          const toOk = !row.effectiveTo || row.effectiveTo >= target;
          return fromOk && toOk;
        };
        return { data: rows.filter(within), error: null };
      }
      return { data: rows, error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'employee_work_schedules', 'DataService.listEmployeeWorkSchedules.catch')) {
        return { data: [], error: null };
      }
      return { data: null, error: e };
    }
  }

  static async listHrWorkforceAnomalies(params: {
    organizationId: string;
    profileId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<{ data: HrWorkforceAnomaly[] | null; error: any }> {
    if (isTableUnavailable('hr_workforce_anomalies')) {
      return { data: [], error: null };
    }
    try {
      let q = supabase.from('hr_workforce_anomalies').select('*').eq('organization_id', params.organizationId).order('work_date', { ascending: false });
      if (params.profileId) q = q.eq('profile_id', params.profileId);
      if (params.fromDate) q = q.gte('work_date', params.fromDate);
      if (params.toDate) q = q.lte('work_date', params.toDate);
      const { data, error } = await q.limit(2000);
      if (error) {
        if (handleOptionalTableError(error, 'hr_workforce_anomalies', 'DataService.listHrWorkforceAnomalies')) {
          return { data: [], error: null };
        }
        return { data: null, error };
      }
      return { data: (data || []).map((r: any) => this.mapHrWorkforceAnomalyRow(r)), error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_workforce_anomalies', 'DataService.listHrWorkforceAnomalies.catch')) {
        return { data: [], error: null };
      }
      return { data: null, error: e };
    }
  }

  static async upsertHrWorkforceAnomaly(row: Omit<HrWorkforceAnomaly, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<{ data: HrWorkforceAnomaly | null; error: any }> {
    if (isTableUnavailable('hr_workforce_anomalies')) {
      return { data: null, error: null };
    }
    try {
      const payload: any = {
        organization_id: row.organizationId,
        profile_id: row.profileId,
        work_date: row.workDate,
        anomaly_kind: row.anomalyKind,
        minutes_value: row.minutesValue ?? 0,
        manager_decision: row.managerDecision ?? 'pending',
        counts_toward_absence: row.countsTowardAbsence !== false,
        notes: row.notes ?? null,
        decided_by_user_id: row.decidedByUserId ?? null,
        decided_at: row.decidedAt ?? null,
        updated_at: new Date().toISOString(),
      };
      if (row.id) payload.id = row.id;
      const { data, error } = await supabase.from('hr_workforce_anomalies').upsert(payload, { onConflict: 'organization_id,profile_id,work_date,anomaly_kind' }).select('*').single();
      if (error) {
        if (handleOptionalTableError(error, 'hr_workforce_anomalies', 'DataService.upsertHrWorkforceAnomaly')) {
          return { data: null, error: null };
        }
        return { data: null, error };
      }
      return { data: data ? this.mapHrWorkforceAnomalyRow(data) : null, error: null };
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_workforce_anomalies', 'DataService.upsertHrWorkforceAnomaly.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error: e };
    }
  }

  private static isOfficeAccessAllowed(policy: HrAttendancePolicy | null, workMode: WorkMode, ip: string | null): { allowed: boolean; reason?: string } {
    if (!policy || policy.enforceOfficeIp !== true) return { allowed: true };
    if (workMode !== 'office') return { allowed: true };
    const allowlist = policy.officeIpAllowlist || [];
    if (allowlist.length === 0) {
      return { allowed: false, reason: 'Aucune IP bureau autorisée n’est configurée.' };
    }
    if (!ip) {
      return { allowed: false, reason: 'IP non détectée. Connexion bureau requise.' };
    }
    const normalized = ip.trim();
    if (!allowlist.includes(normalized)) {
      return { allowed: false, reason: 'Connexion refusée: IP hors liste bureau.' };
    }
    return { allowed: true };
  }

  // ===== MEETINGS =====
  static async getMeetings() {
    return await ApiHelper.get('meetings', { 
      select: '*', 
      order: 'start_time.desc' 
    });
  }

  static async createMeeting(meeting: Partial<Meeting>) {
    try {
      // Récupérer l'utilisateur actuel et son profil
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      // Récupérer le profil pour obtenir l'ID du profil (pas l'ID auth)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('user_id', currentUser.id)
        .single();
      
      if (profileError || !profile) {
        console.error('❌ Erreur récupération profil:', profileError);
        throw new Error(`Profil non trouvé: ${profileError?.message || 'Profil introuvable'}`);
      }

      console.log('✅ Profil trouvé pour meeting:', { profileId: profile.id, userId: currentUser.id });

      // Convertir les attendees (User[]) en array d'IDs de profils
      // Les attendees sont stockés en JSONB avec soit profile.id soit profile.user_id
      const attendeeIds: string[] = [];
      if (meeting.attendees && Array.isArray(meeting.attendees)) {
        // Si les attendees sont des objets User avec id (number), on doit les convertir
        // Pour l'instant, on stocke juste les IDs comme string
        attendeeIds.push(...meeting.attendees.map((a: any) => String(a.id || a)));
      }

      const { data, error } = await supabase
        .from('meetings')
        .insert({
          title: meeting.title || '',
          description: meeting.description || '',
          start_time: meeting.startTime || new Date().toISOString(),
          end_time: meeting.endTime || new Date().toISOString(),
          organizer_id: profile.id, // Utiliser l'ID du profil
          attendees: attendeeIds.length > 0 ? attendeeIds : [],
          meeting_url: meeting.meetingUrl || null,
          access_code: meeting.accessCode || null,
          meeting_platform: meeting.meetingPlatform || null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur création meeting:', error);
        throw error;
      }
      
      console.log('✅ Meeting créé:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création réunion:', error);
      return { data: null, error };
    }
  }

  static async updateMeeting(id: string, updates: Partial<Meeting>) {
    try {
      const attendeeIds: string[] = [];
      if (updates.attendees && Array.isArray(updates.attendees)) {
        attendeeIds.push(...updates.attendees.map((a: any) => String(a.id || a)));
      }

      const { data, error } = await supabase
        .from('meetings')
        .update({
          title: updates.title,
          description: updates.description,
          start_time: updates.startTime,
          end_time: updates.endTime,
          attendees: attendeeIds.length > 0 ? attendeeIds : undefined,
          meeting_url: updates.meetingUrl !== undefined ? (updates.meetingUrl || null) : undefined,
          access_code: updates.accessCode !== undefined ? (updates.accessCode || null) : undefined,
          meeting_platform: updates.meetingPlatform !== undefined ? (updates.meetingPlatform || null) : undefined,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour réunion:', error);
      return { data: null, error };
    }
  }

  static async deleteMeeting(id: string) {
    try {
      const { error } = await supabase
        .from('meetings')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression réunion:', error);
      return { error };
    }
  }

  // ===== PLANNING SLOTS (Phase 3) =====
  static async getPlanningSlots(params: { dateFrom: string; dateTo: string; userId?: string; userIds?: string[] }) {
    if (isTableUnavailable('planning_slots')) return { data: [], error: null };
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) return { data: [], error: null };
      let query = supabase
        .from('planning_slots')
        .select('*')
        .eq('organization_id', orgId)
        .gte('slot_date', params.dateFrom)
        .lte('slot_date', params.dateTo)
        .order('slot_date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false });
      if (params.userIds && params.userIds.length > 0) {
        query = query.in('user_id', params.userIds);
      } else if (params.userId) {
        query = query.eq('user_id', params.userId);
      }
      const { data, error } = await query;
      if (error) {
        if (handleOptionalTableError(error, 'planning_slots', 'DataService.getPlanningSlots')) {
          return { data: [], error: null };
        }
        throw error;
      }
      return { data: data || [], error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'planning_slots', 'DataService.getPlanningSlots.catch')) {
        return { data: [], error: null };
      }
      return { data: [], error };
    }
  }

  static async createPlanningSlot(slot: {
    userId: string;
    slotDate: string;
    slotType: string;
    startTime?: string;
    endTime?: string;
    meetingId?: string;
    title?: string;
    notes?: string;
  }) {
    if (isTableUnavailable('planning_slots')) return { data: null, error: null };
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) throw new Error('Organization not found');
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('planning_slots')
        .insert({
          organization_id: orgId,
          user_id: slot.userId,
          slot_date: slot.slotDate,
          slot_type: slot.slotType,
          start_time: slot.startTime || null,
          end_time: slot.endTime || null,
          meeting_id: slot.meetingId || null,
          title: slot.title || null,
          notes: slot.notes || null,
          created_by_id: user?.id || null
        })
        .select()
        .single();
      if (error) {
        if (handleOptionalTableError(error, 'planning_slots', 'DataService.createPlanningSlot')) {
          return { data: null, error: null };
        }
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'planning_slots', 'DataService.createPlanningSlot.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
  }

  static async updatePlanningSlot(id: string, updates: Partial<{
    userId: string;
    slotDate: string;
    slotType: string;
    startTime: string | null;
    endTime: string | null;
    meetingId: string | null;
    title: string | null;
    notes: string | null;
  }>) {
    if (isTableUnavailable('planning_slots')) return { data: null, error: null };
    try {
      const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.userId !== undefined) row.user_id = updates.userId;
      if (updates.slotDate !== undefined) row.slot_date = updates.slotDate;
      if (updates.slotType !== undefined) row.slot_type = updates.slotType;
      if (updates.startTime !== undefined) row.start_time = updates.startTime;
      if (updates.endTime !== undefined) row.end_time = updates.endTime;
      if (updates.meetingId !== undefined) row.meeting_id = updates.meetingId;
      if (updates.title !== undefined) row.title = updates.title;
      if (updates.notes !== undefined) row.notes = updates.notes;
      const { data, error } = await supabase
        .from('planning_slots')
        .update(row)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        if (handleOptionalTableError(error, 'planning_slots', 'DataService.updatePlanningSlot')) {
          return { data: null, error: null };
        }
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'planning_slots', 'DataService.updatePlanningSlot.catch')) {
        return { data: null, error: null };
      }
      return { data: null, error };
    }
  }

  static async deletePlanningSlot(id: string) {
    if (isTableUnavailable('planning_slots')) return { error: null };
    try {
      const { error } = await supabase.from('planning_slots').delete().eq('id', id);
      if (error) {
        if (handleOptionalTableError(error, 'planning_slots', 'DataService.deletePlanningSlot')) {
          return { error: null };
        }
        throw error;
      }
      return { error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'planning_slots', 'DataService.deletePlanningSlot.catch')) {
        return { error: null };
      }
      return { error };
    }
  }

  /** Supprime les créneaux dont `notes` commence par le préfixe (ex. sync tâches projet). */
  static async deletePlanningSlotsByNotesPrefix(prefix: string) {
    if (isTableUnavailable('planning_slots')) return { deleted: 0, error: null };
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) return { deleted: 0, error: null };
      const likePattern = `${prefix}%`;
      const { data: rows, error } = await supabase
        .from('planning_slots')
        .select('id')
        .eq('organization_id', orgId)
        .like('notes', likePattern);
      if (error) {
        if (handleOptionalTableError(error, 'planning_slots', 'DataService.deletePlanningSlotsByNotesPrefix')) {
          return { deleted: 0, error: null };
        }
        throw error;
      }
      const ids = (rows || []).map((r: { id: string }) => r.id).filter(Boolean);
      let deleted = 0;
      for (const id of ids) {
        const del = await this.deletePlanningSlot(id);
        if (!del.error) deleted += 1;
      }
      return { deleted, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'planning_slots', 'DataService.deletePlanningSlotsByNotesPrefix.catch')) {
        return { deleted: 0, error: null };
      }
      return { deleted: 0, error };
    }
  }

  // ===== WFM: OPEN SHIFTS / SWAPS / CONFLICTS (Phase Planning++) =====
  static async getOpenShifts(params: { dateFrom?: string; dateTo?: string; status?: string }) {
    if (isTableUnavailable('wfm_open_shifts')) return { data: [], error: null };
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) return { data: [], error: null };
      let query = supabase
        .from('wfm_open_shifts')
        .select('*')
        .eq('organization_id', orgId)
        .order('slot_date', { ascending: true })
        .order('start_time', { ascending: true, nullsFirst: false });
      if (params.status) query = query.eq('status', params.status);
      if (params.dateFrom) query = query.gte('slot_date', params.dateFrom);
      if (params.dateTo) query = query.lte('slot_date', params.dateTo);
      const { data, error } = await query;
      if (error) {
        if (handleOptionalTableError(error, 'wfm_open_shifts', 'DataService.getOpenShifts')) return { data: [], error: null };
        throw error;
      }
      return { data: data || [], error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'wfm_open_shifts', 'DataService.getOpenShifts.catch')) return { data: [], error: null };
      return { data: [], error };
    }
  }

  static async takeOpenShift(openShiftId: string, assigneeUserId: string) {
    if (isTableUnavailable('wfm_open_shifts')) return { data: null, error: null };
    try {
      const { data, error } = await supabase
        .from('wfm_open_shifts')
        .update({
          status: 'taken',
          assigned_user_id: assigneeUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', openShiftId)
        .select()
        .single();
      if (error) {
        if (handleOptionalTableError(error, 'wfm_open_shifts', 'DataService.takeOpenShift')) return { data: null, error: null };
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'wfm_open_shifts', 'DataService.takeOpenShift.catch')) return { data: null, error: null };
      return { data: null, error };
    }
  }

  static async getSwapRequests(params: { status?: string; dateFrom?: string; dateTo?: string }) {
    if (isTableUnavailable('wfm_swap_requests')) return { data: [], error: null };
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) return { data: [], error: null };
      let query = supabase
        .from('wfm_swap_requests')
        .select('*')
        .eq('organization_id', orgId)
        .order('created_at', { ascending: false });
      if (params.status) query = query.eq('status', params.status);
      if (params.dateFrom) query = query.gte('slot_date', params.dateFrom);
      if (params.dateTo) query = query.lte('slot_date', params.dateTo);
      const { data, error } = await query;
      if (error) {
        if (handleOptionalTableError(error, 'wfm_swap_requests', 'DataService.getSwapRequests')) return { data: [], error: null };
        throw error;
      }
      return { data: data || [], error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'wfm_swap_requests', 'DataService.getSwapRequests.catch')) return { data: [], error: null };
      return { data: [], error };
    }
  }

  static async createSwapRequest(payload: any) {
    if (isTableUnavailable('wfm_swap_requests')) return { data: null, error: null };
    try {
      const orgId = await this.getCurrentUserOrganizationId();
      if (!orgId) throw new Error('Organization not found');
      const row = { ...payload, organization_id: orgId, created_at: new Date().toISOString() };
      const { data, error } = await supabase.from('wfm_swap_requests').insert(row).select().single();
      if (error) {
        if (handleOptionalTableError(error, 'wfm_swap_requests', 'DataService.createSwapRequest')) return { data: null, error: null };
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'wfm_swap_requests', 'DataService.createSwapRequest.catch')) return { data: null, error: null };
      return { data: null, error };
    }
  }

  static async updateSwapRequest(id: string, updates: any) {
    if (isTableUnavailable('wfm_swap_requests')) return { data: null, error: null };
    try {
      const { data, error } = await supabase
        .from('wfm_swap_requests')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) {
        if (handleOptionalTableError(error, 'wfm_swap_requests', 'DataService.updateSwapRequest')) return { data: null, error: null };
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'wfm_swap_requests', 'DataService.updateSwapRequest.catch')) return { data: null, error: null };
      return { data: null, error };
    }
  }

  // ===== LEAVE REQUESTS =====
  static async getLeaveRequests() {
    return await ApiHelper.get('leave_requests', { 
      select: '*', 
      order: 'created_at.desc' 
    });
  }

  // Fonction pour valider les règles RH
  static async validateLeaveRequestRules(leaveRequest: Partial<LeaveRequest>, userId: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    if (!leaveRequest.startDate || !leaveRequest.endDate) {
      return { valid: false, errors: ['Les dates sont requises'] };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDate = new Date(leaveRequest.startDate);
    startDate.setHours(0, 0, 0, 0);
    const daysUntilStart = Math.floor((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // Règle 1: Anticipation de 15 jours (sauf urgence)
    if (!leaveRequest.isUrgent && daysUntilStart < 15) {
      errors.push('La date de début doit être au moins 15 jours après la date de demande (préavis de 15 jours requis pour les congés non urgents).');
    }

    // Règle 2: Motif d'urgence obligatoire si urgence cochée
    if (leaveRequest.isUrgent && (!leaveRequest.urgencyReason || leaveRequest.urgencyReason.trim() === '')) {
      errors.push('Le motif d\'urgence est obligatoire lorsque le congé est marqué comme urgent.');
    }

    // Règle 3: Éligibilité (6 mois entre congés) - seulement si pas urgent
    if (!leaveRequest.isUrgent) {
      try {
        // Récupérer le dernier congé terminé de l'utilisateur
        const { data: previousLeaves } = await supabase
          .from('leave_requests')
          .select('end_date, status')
          .eq('user_id', userId)
          .in('status', ['approved', 'completed'])
          .order('end_date', { ascending: false })
          .limit(1);

        if (previousLeaves && previousLeaves.length > 0) {
          const lastLeaveEnd = new Date(previousLeaves[0].end_date);
          lastLeaveEnd.setHours(0, 0, 0, 0);
          
          // Calculer 6 mois après la fin du dernier congé
          const sixMonthsLater = new Date(lastLeaveEnd);
          sixMonthsLater.setMonth(sixMonthsLater.getMonth() + 6);
          
          if (startDate < sixMonthsLater) {
            const monthsWait = Math.ceil((sixMonthsLater.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30));
            errors.push(`Vous devez attendre 6 mois après votre dernier congé avant d'en demander un nouveau. Délai restant: environ ${monthsWait} mois.`);
          }
        }
      } catch (error) {
        console.warn('⚠️ Erreur lors de la vérification de l\'éligibilité:', error);
        // Ne pas bloquer la demande si erreur de vérification
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  static async createLeaveRequest(leaveRequest: Partial<LeaveRequest>) {
    try {
      // Récupérer l'utilisateur actuel et son profil
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      // Récupérer le profil pour obtenir l'ID du profil (pas l'ID auth)
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name, avatar_url, manager_id')
        .eq('user_id', currentUser.id)
        .single();
      
      if (profileError || !profile) {
        console.error('❌ Erreur récupération profil:', profileError);
        throw new Error(`Profil non trouvé: ${profileError?.message || 'Profil introuvable'}`);
      }

      console.log('✅ Profil trouvé pour leave request:', { profileId: profile.id, userId: currentUser.id });

      // Valider les dates
      if (!leaveRequest.startDate || !leaveRequest.endDate) {
        throw new Error('Les dates de début et de fin sont requises');
      }

      if (new Date(leaveRequest.endDate) < new Date(leaveRequest.startDate)) {
        throw new Error('La date de fin doit être après la date de début');
      }

      // Valider les règles RH
      const validation = await this.validateLeaveRequestRules(leaveRequest, profile.id);
      if (!validation.valid) {
        throw new Error(validation.errors.join('\n'));
      }

      const { data, error } = await supabase
        .from('leave_requests')
        .insert({
          user_id: profile.id, // Utiliser l'ID du profil
          leave_type_id: leaveRequest.leaveTypeId || null,
          start_date: leaveRequest.startDate,
          end_date: leaveRequest.endDate,
          status: 'pending', // Toujours 'pending' à la création
          reason: leaveRequest.reason || '',
          leave_type: leaveRequest.leaveTypeName || 'annual_leave', // Fallback si pas de leave_type_id
          is_urgent: leaveRequest.isUrgent || false,
          urgency_reason: leaveRequest.isUrgent ? (leaveRequest.urgencyReason || '') : null,
          manager_id: profile.manager_id || null, // Récupérer le manager_id du profil
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur création demande congé:', error);
        throw error;
      }

      console.log('✅ Leave request créée:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création demande congé:', error);
      return { data: null, error };
    }
  }

  static async updateLeaveRequest(id: string, updates: Partial<LeaveRequest>) {
    try {
      // Récupérer l'utilisateur actuel pour approver_id si statut change
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      let approverProfileId = null;

      if (currentUser && (updates.status === 'approved' || updates.status === 'rejected')) {
        // Récupérer le profile.id de l'approbateur
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('user_id', currentUser.id)
          .single();
        
        approverProfileId = profile?.id || null;
      }

      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      // Mettre à jour seulement les champs fournis
      if (updates.status) {
        // Normaliser le status en minuscules pour respecter la contrainte CHECK
        const normalizedStatus = updates.status.toLowerCase() as 'pending' | 'approved' | 'rejected' | 'cancelled';
        
        // Vérifier que le status est valide
        const validStatuses = ['pending', 'approved', 'rejected', 'cancelled'];
        if (!validStatuses.includes(normalizedStatus)) {
          throw new Error(`Status invalide: ${updates.status}. Les valeurs autorisées sont: ${validStatuses.join(', ')}`);
        }
        
        updateData.status = normalizedStatus;
        if (approverProfileId) {
          updateData.approver_id = currentUser.id; // Supabase attend auth.users.id pour approver_id
        }
      }
      // Vérifier la validation hiérarchique si on approuve/rejette
      if (updates.status && (updates.status.toLowerCase() === 'approved' || updates.status.toLowerCase() === 'rejected') && currentUser) {
        // Récupérer la demande pour vérifier le manager_id
        const { data: existingRequest } = await supabase
          .from('leave_requests')
          .select('manager_id, user_id')
          .eq('id', id)
          .single();

        if (existingRequest) {
          // Récupérer le profil de l'approbateur
          const { data: approverProfile } = await supabase
            .from('profiles')
            .select('id, role')
            .eq('user_id', currentUser.id)
            .single();

          // Vérifier si l'approbateur est admin/super_admin OU le manager assigné
          const isAdmin = approverProfile?.role === 'administrator' || approverProfile?.role === 'super_administrator';
          const isManager = existingRequest.manager_id && approverProfile?.id === existingRequest.manager_id;

          if (!isAdmin && !isManager) {
            throw new Error('Seul le responsable assigné ou un administrateur peut approuver/rejeter cette demande.');
          }
        }
      }

      if (updates.reason !== undefined) updateData.reason = updates.reason;
      if (updates.rejectionReason !== undefined) updateData.rejection_reason = updates.rejectionReason;
      if (updates.approvalReason !== undefined) updateData.approval_reason = updates.approvalReason;
      if (updates.startDate) updateData.start_date = updates.startDate;
      if (updates.endDate) updateData.end_date = updates.endDate;
      if (updates.leaveTypeId !== undefined) updateData.leave_type_id = updates.leaveTypeId || null;
      if (updates.isUrgent !== undefined) updateData.is_urgent = updates.isUrgent;
      if (updates.urgencyReason !== undefined) updateData.urgency_reason = updates.urgencyReason;
      
      // Si on approuve, on nettoie rejection_reason. Si on rejette, on nettoie approval_reason
      if (updates.status) {
        const normalizedStatus = updates.status.toLowerCase();
        if (normalizedStatus === 'approved') {
          updateData.rejection_reason = null;
        } else if (normalizedStatus === 'rejected') {
          updateData.approval_reason = null;
        }
      }

      const { data, error } = await supabase
        .from('leave_requests')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur mise à jour demande congé:', error);
        throw error;
      }

      console.log('✅ Leave request mise à jour:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour demande congé:', error);
      return { data: null, error };
    }
  }

  static async deleteLeaveRequest(id: string) {
    try {
      const { error } = await supabase
        .from('leave_requests')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression demande congé:', error);
      return { error };
    }
  }

  static async getLeaveTypes() {
    try {
      const { data, error } = await supabase
        .from('leave_types')
        .select('*')
        .order('name');
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération types de congés:', error);
      return { data: null, error };
    }
  }

  /** JSON stocké dans course_lessons.quiz */
  private static courseLessonQuizToJson(lesson: { quizQuestions?: unknown }): unknown | null {
    const qs = lesson.quizQuestions;
    if (!qs || !Array.isArray(qs) || qs.length === 0) return null;
    return { questions: qs };
  }

  // ===== COURSES =====
  static async getCourses() {
    /** Noyau stable (indexes `courses` existants) — évite 400 si migrations LMS / programme pas appliquées. */
    const courseSelectBase =
      'id,title,description,instructor,instructor_id,duration,level,category,price,status,thumbnail_url,target_students,youtube_url,drive_url,other_links,requires_final_validation,sequential_modules,course_materials,created_at,updated_at,rating,students_count,lessons_count';
    const courseSelectProgramme = `${courseSelectBase},programme_id,audience_segment`;
    const courseSelectLmsExtended =
      `${courseSelectProgramme},certification_enabled,certification_label,publish_workflow_status,submitted_for_review_at,reviewed_at,reviewed_by`;

    const selectVariants = [courseSelectBase, courseSelectProgramme, courseSelectLmsExtended, '*'];

    for (const select of selectVariants) {
      const result = await ApiHelper.get('courses', { select, order: 'created_at.desc' });
      if (!result.error) return result;
      if (!isLikelyPostgrestSelectError(result.error)) {
        // Erreur métier / réseau : ne pas tenter d’autres variantes.
        return result;
      }
    }

    // Dernier recours : renvoyer la dernière erreur si toutes les variantes échouent.
    return { data: null, error: new Error('Unable to fetch courses with any select variant') };
  }

  static async createCourse(course: Partial<Course>) {
    try {
      // Convertir duration en nombre si c'est une string (ex: "6 Weeks" -> nombre d'heures)
      let durationValue = 0;
      if (typeof course.duration === 'string') {
        // Extraire le nombre (ex: "6 Weeks" -> 6)
        const match = course.duration.match(/\d+/);
        durationValue = match ? parseInt(match[0]) * 40 : 0; // Approximation: 40h par semaine
      } else {
        durationValue = course.duration || 0;
      }

      const { data, error } = await supabase
        .from('courses')
        .insert({
          title: course.title || '',
          description: course.description || '',
          instructor: course.instructor || '',
          instructor_id: course.instructorId || null,
          duration: durationValue,
          level: course.level || 'beginner',
          category: course.category || '',
          price: course.price || 0,
          status: course.status || 'draft',
          thumbnail_url: course.thumbnailUrl || null,
          target_students: course.targetStudents || null,
          youtube_url: course.youtubeUrl || null,
          drive_url: course.driveUrl || null,
          other_links: course.otherLinks || null,
          requires_final_validation: !!course.requiresFinalValidation,
          sequential_modules: !!course.sequentialModules,
          course_materials: course.courseMaterials || [],
          programme_id: course.programmeId ?? null,
          audience_segment: course.audienceSegment ?? null,
          certification_enabled: course.certificationEnabled ?? false,
          certification_label: course.certificationLabel ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      console.log('✅ Course créé:', data.id);
      
      // Sauvegarder les modules et leçons si présents
      if (course.modules && course.modules.length > 0) {
        console.log('📦 Sauvegarde modules pour cours:', data.id);
        
        for (let mIndex = 0; mIndex < course.modules.length; mIndex++) {
          const module = course.modules[mIndex];
          
          // Créer le module
          const { data: moduleData, error: moduleError } = await supabase
            .from('course_modules')
            .insert({
              course_id: data.id,
              title: module.title || 'Untitled Module',
              order_index: mIndex + 1,
              requires_validation: module.requiresValidation ?? false,
              unlocks_next_module: module.unlocksNextModule ?? true,
              evidence_documents: module.evidenceDocuments || [],
              created_at: new Date().toISOString()
            })
            .select()
            .single();
          
          if (moduleError) {
            console.error(`❌ Erreur création module ${mIndex}:`, moduleError);
            continue;
          }
          
          console.log(`✅ Module créé: ${moduleData.id}`);
          
          // Créer les leçons pour ce module
          if (module.lessons && module.lessons.length > 0) {
            for (let lIndex = 0; lIndex < module.lessons.length; lIndex++) {
              const lesson = module.lessons[lIndex];
              
              const { data: lessonData, error: lessonError } = await supabase
                .from('course_lessons')
                .insert({
                  module_id: moduleData.id,
                  title: lesson.title || 'Untitled Lesson',
                  type: lesson.type || 'video',
                  duration: lesson.duration || '0 min',
                  description: lesson.description || null,
                  content_url: lesson.contentUrl || null,
                  attachments: lesson.attachments || [],
                  external_links: lesson.externalLinks || [],
                  quiz: DataService.courseLessonQuizToJson(lesson),
                  order_index: lIndex + 1,
                  created_at: new Date().toISOString()
                })
                .select()
                .single();
              
              if (lessonError) {
                console.error(`❌ Erreur création leçon ${lIndex}:`, lessonError);
              } else {
                console.log(`✅ Leçon créée: ${lessonData.id}`);
              }
            }
          }
        }
        
        console.log('✅ Modules et leçons sauvegardés pour le cours');
      }
      
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur création cours:', error);
      return { data: null, error };
    }
  }

  static async updateCourse(id: string, updates: Partial<Course>) {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      // Filtrer seulement les champs qui existent réellement dans la table courses de Supabase
      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.instructor !== undefined) updateData.instructor = updates.instructor;
      if (updates.instructorId !== undefined) updateData.instructor_id = updates.instructorId;
      if (updates.duration !== undefined) {
        // Convertir duration en nombre si c'est une string
        if (typeof updates.duration === 'string') {
          const match = updates.duration.match(/\d+/);
          updateData.duration = match ? parseInt(match[0]) * 40 : 0;
        } else {
          updateData.duration = updates.duration;
        }
      }
      if (updates.level !== undefined) updateData.level = updates.level;
      if (updates.category !== undefined) updateData.category = updates.category;
      if (updates.price !== undefined) updateData.price = updates.price;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.thumbnailUrl !== undefined) updateData.thumbnail_url = updates.thumbnailUrl;
      if (updates.targetStudents !== undefined) updateData.target_students = updates.targetStudents;
      if (updates.youtubeUrl !== undefined) updateData.youtube_url = updates.youtubeUrl;
      if (updates.driveUrl !== undefined) updateData.drive_url = updates.driveUrl;
      if (updates.otherLinks !== undefined) updateData.other_links = updates.otherLinks;
      if (updates.requiresFinalValidation !== undefined) updateData.requires_final_validation = updates.requiresFinalValidation;
      if (updates.sequentialModules !== undefined) updateData.sequential_modules = updates.sequentialModules;
      if (updates.courseMaterials !== undefined) updateData.course_materials = updates.courseMaterials;
      if (updates.programmeId !== undefined) updateData.programme_id = updates.programmeId;
      if (updates.audienceSegment !== undefined) updateData.audience_segment = updates.audienceSegment;
      if (updates.publishWorkflowStatus !== undefined) {
        updateData.publish_workflow_status = updates.publishWorkflowStatus;
      }
      if (updates.submittedForReviewAt !== undefined) {
        updateData.submitted_for_review_at = updates.submittedForReviewAt;
      }
      if (updates.reviewedAt !== undefined) updateData.reviewed_at = updates.reviewedAt;
      if (updates.reviewedBy !== undefined) updateData.reviewed_by = updates.reviewedBy;
      if (updates.certificationEnabled !== undefined) updateData.certification_enabled = updates.certificationEnabled;
      if (updates.certificationLabel !== undefined) updateData.certification_label = updates.certificationLabel;

      // Ignorer les champs calculés : modules, completedLessons, progress
      // Ces champs ne sont pas stockés dans la table courses

      const courseUpdateAllowed = new Set([
        'updated_at',
        'title',
        'description',
        'instructor',
        'instructor_id',
        'duration',
        'level',
        'category',
        'price',
        'status',
        'thumbnail_url',
        'target_students',
        'youtube_url',
        'drive_url',
        'other_links',
        'requires_final_validation',
        'sequential_modules',
        'course_materials',
        'programme_id',
        'audience_segment',
        'publish_workflow_status',
        'submitted_for_review_at',
        'reviewed_at',
        'reviewed_by',
        'certification_enabled',
        'certification_label',
      ]);
      const patch = Object.fromEntries(
        Object.entries(updateData).filter(([k]) => courseUpdateAllowed.has(k)),
      );

      console.log('🔄 Mise à jour course avec data:', patch);

      const courseUpdateReturnSelects = [
        'id,title,description,instructor,instructor_id,duration,level,category,price,status,thumbnail_url,target_students,youtube_url,drive_url,other_links,requires_final_validation,sequential_modules,course_materials,programme_id,audience_segment,certification_enabled,certification_label,publish_workflow_status,submitted_for_review_at,reviewed_at,reviewed_by,rating,students_count,lessons_count,created_at,updated_at',
        'id,title,description,instructor,instructor_id,duration,level,category,price,status,thumbnail_url,target_students,youtube_url,drive_url,other_links,requires_final_validation,sequential_modules,course_materials,created_at,updated_at,rating,students_count,lessons_count',
        'id,title,description,instructor,instructor_id,duration,level,category,price,status,created_at,updated_at',
      ];

      let data: any = null;
      let error: any = null;
      for (const sel of courseUpdateReturnSelects) {
        const res = await supabase.from('courses').update(patch).eq('id', id).select(sel).single();
        data = res.data;
        error = res.error;
        if (!error) break;
        if (!isLikelyPostgrestSelectError(error)) break;
      }

      if (error) {
        console.error('❌ Erreur lors de la mise à jour:', error);
        throw error;
      }
      console.log('✅ Course mis à jour:', data.id);

      // Mettre à jour les modules et leçons si fournis
      if (updates.modules) {
        const { data: existingModules, error: fetchModulesError } = await supabase
          .from('course_modules')
          .select('id')
          .eq('course_id', id);

        if (fetchModulesError) {
          console.error('❌ Erreur récupération modules avant mise à jour:', fetchModulesError);
          throw fetchModulesError;
        }

        const moduleIds = (existingModules || []).map((module: any) => module.id);

        if (moduleIds.length > 0) {
          const { error: deleteLessonsError } = await supabase
            .from('course_lessons')
            .delete()
            .in('module_id', moduleIds);

          if (deleteLessonsError) {
            console.error('❌ Erreur suppression leçons existantes:', deleteLessonsError);
            throw deleteLessonsError;
          }

          const { error: deleteModulesError } = await supabase
            .from('course_modules')
            .delete()
            .in('id', moduleIds);

          if (deleteModulesError) {
            console.error('❌ Erreur suppression modules existants:', deleteModulesError);
            throw deleteModulesError;
          }
        }

        for (let mIndex = 0; mIndex < updates.modules.length; mIndex++) {
          const module = updates.modules[mIndex];

          const { data: moduleData, error: moduleError } = await supabase
            .from('course_modules')
            .insert({
              course_id: id,
              title: module.title || 'Untitled Module',
              order_index: mIndex + 1,
              requires_validation: module.requiresValidation ?? false,
              unlocks_next_module: module.unlocksNextModule ?? true,
              evidence_documents: module.evidenceDocuments || [],
              created_at: new Date().toISOString()
            })
            .select()
            .single();

          if (moduleError) {
            console.error(`❌ Erreur création module lors mise à jour ${mIndex}:`, moduleError);
            throw moduleError;
          }

          if (module.lessons && module.lessons.length > 0) {
            for (let lIndex = 0; lIndex < module.lessons.length; lIndex++) {
              const lesson = module.lessons[lIndex];

              const { error: lessonError } = await supabase
                .from('course_lessons')
                .insert({
                  module_id: moduleData.id,
                  title: lesson.title || 'Untitled Lesson',
                  type: lesson.type || 'video',
                  duration: lesson.duration || '0 min',
                  description: lesson.description || null,
                  content_url: lesson.contentUrl || null,
                  attachments: lesson.attachments || [],
                  external_links: lesson.externalLinks || [],
                  quiz: DataService.courseLessonQuizToJson(lesson),
                  order_index: lIndex + 1,
                  created_at: new Date().toISOString()
                });

              if (lessonError) {
                console.error(`❌ Erreur création leçon lors mise à jour ${lIndex}:`, lessonError);
                throw lessonError;
              }
            }
          }
        }
        console.log('✅ Modules et leçons mis à jour pour le cours', id);
      }

      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur mise à jour cours:', error);
      return { data: null, error };
    }
  }

  static async deleteCourse(id: string) {
    try {
      // 1. Récupérer les modules liés au cours
      const { data: modules, error: modulesFetchError } = await supabase
        .from('course_modules')
        .select('id')
        .eq('course_id', id);

      if (modulesFetchError) {
        throw modulesFetchError;
      }

      const moduleIds = (modules || []).map((module: any) => module.id);

      // 2. Supprimer les leçons associées
      if (moduleIds.length > 0) {
        const { error: lessonsDeleteError } = await supabase
          .from('course_lessons')
          .delete()
          .in('module_id', moduleIds);

        if (lessonsDeleteError) {
          throw lessonsDeleteError;
        }
      }

      // 3. Supprimer les modules
      if (moduleIds.length > 0) {
        const { error: modulesDeleteError } = await supabase
          .from('course_modules')
          .delete()
          .eq('course_id', id);

        if (modulesDeleteError) {
          throw modulesDeleteError;
        }
      }

      // 4. Supprimer les inscriptions (course_enrollments)
      const { error: enrollmentsDeleteError } = await supabase
        .from('course_enrollments')
        .delete()
        .eq('course_id', id);

      if (enrollmentsDeleteError) {
        throw enrollmentsDeleteError;
      }

      // 4b. Sessions LMS + inscriptions session (si tables présentes)
      const { data: sessions, error: sessionsFetchError } = await supabase
        .from('course_sessions')
        .select('id')
        .eq('course_id', id);
      if (sessionsFetchError && sessionsFetchError.code !== '42P01') {
        throw sessionsFetchError;
      }
      const sessionIds = (sessions || []).map((s: { id: string }) => s.id);
      if (sessionIds.length > 0) {
        const { error: sessEnrollErr } = await supabase
          .from('course_session_enrollments')
          .delete()
          .in('course_session_id', sessionIds);
        if (sessEnrollErr && sessEnrollErr.code !== '42P01') {
          throw sessEnrollErr;
        }
      }
      const { error: sessionsDeleteError } = await supabase.from('course_sessions').delete().eq('course_id', id);
      if (sessionsDeleteError && sessionsDeleteError.code !== '42P01') {
        throw sessionsDeleteError;
      }

      // 5. Supprimer les time logs liés au cours
      const { data: timeLogs, error: timeLogsSelectError } = await supabase
        .from('time_logs')
        .select('id')
        .eq('entity_type', 'course')
        .eq('entity_id', id);

      if (timeLogsSelectError) {
        throw timeLogsSelectError;
      }

      if ((timeLogs || []).length > 0) {
        const timeLogIds = (timeLogs || []).map((log: any) => log.id);
        const { error: timeLogsDeleteError } = await supabase
          .from('time_logs')
          .delete()
          .in('id', timeLogIds);

        if (timeLogsDeleteError) {
          throw timeLogsDeleteError;
        }
      }

      // 6. Supprimer le cours
      const { error } = await supabase
        .from('courses')
        .delete()
        .eq('id', id);

      if (error) throw error;
      console.log('✅ Course supprimé:', id);
      return { error: null };
    } catch (error) {
      console.error('❌ Erreur suppression cours:', error);
      return { error };
    }
  }

  // Fonction pour charger les modules et leçons d'un cours
  static async getCourseModules(courseId: string) {
    try {
      const { data, error } = await this.getCourseModulesForCourseIds([courseId]);
      if (error) throw error;
      return { data: data || [], error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  /** Modules + leçons pour plusieurs cours — requêtes plates (pas d’embed PostgREST) pour éviter 400 selon schéma. */
  static async getCourseModulesForCourseIds(courseIds: string[]) {
    try {
      if (!courseIds.length) return { data: [] as any[], error: null };

      const moduleSelectVariants = [
        'id,course_id,title,order_index,requires_validation,unlocks_next_module,evidence_documents',
        'id,course_id,title,order_index',
      ];

      let modules: any[] = [];
      let lastModuleError: any = null;
      for (const sel of moduleSelectVariants) {
        const { data, error } = await supabase
          .from('course_modules')
          .select(sel)
          .in('course_id', courseIds)
          .order('order_index');
        if (!error) {
          modules = data || [];
          lastModuleError = null;
          break;
        }
        lastModuleError = error;
        if (!isLikelyPostgrestSelectError(error)) {
          if (isMissingTableError(error, 'course_modules')) {
            return { data: [] as any[], error: null };
          }
          return { data: null, error };
        }
      }
      if (lastModuleError) {
        return { data: null, error: lastModuleError };
      }

      const moduleIds = modules.map((m) => m.id).filter(Boolean);
      const lessonsByModuleId = new Map<string, any[]>();

      if (moduleIds.length) {
        const lessonSelectVariants = [
          'id,module_id,title,type,duration,description,content_url,attachments,external_links,quiz,order_index',
          'id,module_id,title,type,duration,description,content_url,order_index',
          'id,module_id,title,type,duration,order_index',
        ];

        let flatLessons: any[] = [];
        for (const lsel of lessonSelectVariants) {
          const { data, error } = await supabase
            .from('course_lessons')
            .select(lsel)
            .in('module_id', moduleIds)
            .order('order_index');
          if (!error) {
            flatLessons = data || [];
            break;
          }
          if (!isLikelyPostgrestSelectError(error)) {
            if (isMissingTableError(error, 'course_lessons')) {
              flatLessons = [];
              break;
            }
            return { data: null, error };
          }
        }

        for (const ls of flatLessons) {
          const mid = String(ls.module_id);
          if (!lessonsByModuleId.has(mid)) lessonsByModuleId.set(mid, []);
          lessonsByModuleId.get(mid)!.push(ls);
        }
      }

      const rows = modules.map((m) => {
        const lessons = [...(lessonsByModuleId.get(String(m.id)) || [])].sort(
          (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0),
        );
        return { ...m, lessons };
      });

      return { data: rows, error: null };
    } catch (error) {
      return { data: null, error };
    }
  }

  // Fonction pour récupérer la progression d'un utilisateur pour un cours
  static async getCourseEnrollment(courseId: string, userId: string) {
    try {
      const { data, error } = await supabase
        .from('course_enrollments')
        .select('*')
        .eq('course_id', courseId)
        .eq('user_id', userId)
        .maybeSingle();
      
      if (error) {
        const details = `${error.code || ''} ${error.details || ''} ${error.message || ''}`.toLowerCase();
        if (details.includes('0 rows') || error.code === 'PGRST116') {
          return { data: null, error: null };
        }
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur récupération enrollment:', error);
      return { data: null, error };
    }
  }

  // Fonction pour créer ou mettre à jour l'enrollment (inscription + progression + notes)
  static async upsertCourseEnrollment(
    courseId: string, 
    userId: string, 
    progress: number, 
    completedLessons: string[], 
    notes?: Record<string, string>
  ) {
    try {
      // Vérifier si l'enrollment existe déjà
      const existing = await this.getCourseEnrollment(courseId, userId);
      
      const updateData: any = {
        progress,
        completed_lessons: completedLessons,
        updated_at: new Date().toISOString()
      };
      
      // Ajouter les notes si fournies
      if (notes !== undefined) {
        updateData.notes = notes;
      }
      
      if (existing.data) {
        // Mettre à jour l'enrollment existant
        const { data, error } = await supabase
          .from('course_enrollments')
          .update(updateData)
          .eq('course_id', courseId)
          .eq('user_id', userId)
          .select()
          .single();
        
        if (error) throw error;
        console.log('✅ Enrollment mis à jour:', data.id);
        return { data, error: null };
      } else {
        // Créer un nouvel enrollment
        const insertData: any = {
          course_id: courseId,
          user_id: userId,
          progress,
          completed_lessons: completedLessons,
          status: 'active',
          enrolled_at: new Date().toISOString()
        };
        
        // Ajouter les notes si fournies
        if (notes !== undefined) {
          insertData.notes = notes;
        }
        
        const { data, error } = await supabase
          .from('course_enrollments')
          .insert(insertData)
          .select()
          .single();
        
        if (error) throw error;
        console.log('✅ Enrollment créé:', data.id);
        return { data, error: null };
      }
    } catch (error) {
      console.error('❌ Erreur upsert enrollment:', error);
      return { data: null, error };
    }
  }

  /** Sessions LMS (cohortes) pour un cours — table absente avant migration : retourne []. */
  static async listCourseSessionsByCourseId(courseId: string) {
    try {
      const { data, error } = await supabase
        .from('course_sessions')
        .select('*')
        .eq('course_id', courseId)
        .order('starts_at', { ascending: true, nullsFirst: false });
      if (error) {
        if ((error as { code?: string }).code === '42P01') return { data: [], error: null };
        throw error;
      }
      return { data: data || [], error: null };
    } catch (error) {
      console.warn('listCourseSessionsByCourseId:', error);
      return { data: [], error: null };
    }
  }

  static async insertCourseSession(row: {
    organizationId: string;
    courseId: string;
    title: string;
    startsAt?: string | null;
    endsAt?: string | null;
    capacity?: number | null;
    status?: string;
    programmeId?: string | null;
    projectId?: string | null;
    programmeActionId?: string | null;
  }) {
    try {
      const { data, error } = await supabase
        .from('course_sessions')
        .insert({
          organization_id: row.organizationId,
          course_id: row.courseId,
          title: row.title,
          starts_at: row.startsAt ?? null,
          ends_at: row.endsAt ?? null,
          capacity: row.capacity ?? null,
          status: row.status || 'planned',
          programme_id: row.programmeId ?? null,
          project_id: row.projectId ?? null,
          programme_action_id: row.programmeActionId ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('insertCourseSession:', error);
      return { data: null, error };
    }
  }

  static async updateCourseSession(
    id: string,
    updates: Partial<{
      title: string;
      startsAt: string | null;
      endsAt: string | null;
      capacity: number | null;
      status: string;
      programmeId: string | null;
      projectId: string | null;
      programmeActionId: string | null;
    }>,
  ) {
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.title !== undefined) patch.title = updates.title;
      if (updates.startsAt !== undefined) patch.starts_at = updates.startsAt;
      if (updates.endsAt !== undefined) patch.ends_at = updates.endsAt;
      if (updates.capacity !== undefined) patch.capacity = updates.capacity;
      if (updates.status !== undefined) patch.status = updates.status;
      if (updates.programmeId !== undefined) patch.programme_id = updates.programmeId;
      if (updates.projectId !== undefined) patch.project_id = updates.projectId;
      if (updates.programmeActionId !== undefined) patch.programme_action_id = updates.programmeActionId;
      const { data, error } = await supabase.from('course_sessions').update(patch).eq('id', id).select().single();
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('updateCourseSession:', error);
      return { data: null, error };
    }
  }

  static async deleteCourseSession(id: string) {
    try {
      const { error: e1 } = await supabase.from('course_session_enrollments').delete().eq('course_session_id', id);
      if (e1 && (e1 as { code?: string }).code !== '42P01') throw e1;
      const { error } = await supabase.from('course_sessions').delete().eq('id', id);
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('deleteCourseSession:', error);
      return { error };
    }
  }

  /** Inscrits à une session (stub liste — phase 3 : sync avec parcours). */
  static async listCourseSessionEnrollments(courseSessionId: string) {
    try {
      const { data, error } = await supabase
        .from('course_session_enrollments')
        .select('*')
        .eq('course_session_id', courseSessionId)
        .order('created_at', { ascending: true });
      if (error) {
        if ((error as { code?: string }).code === '42P01') return { data: [], error: null };
        throw error;
      }
      return { data: data || [], error: null };
    } catch (error) {
      console.warn('listCourseSessionEnrollments:', error);
      return { data: [], error: null };
    }
  }

  /** Total inscriptions cohortes pour toutes les sessions d’un cours. */
  static async countCourseSessionEnrollmentsByCourseId(courseId: string): Promise<{ count: number | null; error: unknown | null }> {
    try {
      const { data: sessions, error: e1 } = await supabase.from('course_sessions').select('id').eq('course_id', courseId);
      if (e1) {
        if ((e1 as { code?: string }).code === '42P01') return { count: 0, error: null };
        throw e1;
      }
      const ids = (sessions || []).map((s: { id: string }) => s.id);
      if (ids.length === 0) return { count: 0, error: null };
      const { count, error: e2 } = await supabase
        .from('course_session_enrollments')
        .select('*', { count: 'exact', head: true })
        .in('course_session_id', ids);
      if (e2) {
        if ((e2 as { code?: string }).code === '42P01') return { count: 0, error: null };
        throw e2;
      }
      return { count: count ?? 0, error: null };
    } catch (error) {
      console.warn('countCourseSessionEnrollmentsByCourseId:', error);
      return { count: 0, error: null };
    }
  }

  // ===== OBJECTIVES =====
  static async getObjectives() {
    try {
      const { data, error } = await supabase
        .from('objectives')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération objectifs:', error);
      return { data: null, error };
    }
  }

  static async createObjective(objective: Partial<Objective>) {
    try {
      // Récupérer l'utilisateur actuel pour définir owner_id
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      
      if (!currentUser) {
        throw new Error('Utilisateur non authentifié');
      }

      // Récupérer le profil pour obtenir l'ID du profil (pas l'ID auth)
      // car objectives.owner_id référence profiles.id, pas auth.users.id
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .eq('user_id', currentUser.id)
        .single();
      
      if (profileError || !profile) {
        console.error('❌ Erreur récupération profil:', {
          userId: currentUser.id,
          profileError,
          profile
        });
        throw new Error(`Profil non trouvé pour l'utilisateur: ${profileError?.message || 'Profil introuvable'}`);
      }

      console.log('✅ Profil trouvé:', {
        profileId: profile.id,
        userId: currentUser.id,
        fullName: profile.full_name
      });

      const ownerName = profile.full_name || currentUser.email || 'Utilisateur';

      console.log('🔄 Tentative création objectif avec:', {
        title: objective.title,
        owner_id: profile.id,
        project_id: objective.projectId
      });

      const { data, error } = await supabase
        .from('objectives')
        .insert({
          title: objective.title || '',
          description: objective.description,
          quarter: objective.quarter || 'Q4',
          year: objective.year || new Date().getFullYear(),
          owner_id: profile.id, // Utiliser l'ID du profil, pas l'ID auth
          status: objective.status || 'active',
          progress: objective.progress || 0,
          priority: objective.priority || 'Medium',
          start_date: objective.startDate,
          end_date: objective.endDate,
          category: objective.category,
          owner_name: ownerName,
          team_members: objective.teamMembers || [],
          key_results: objective.keyResults || [],
          project_id: objective.projectId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création objectif:', error);
      return { data: null, error };
    }
  }

  static async updateObjective(id: string, updates: Partial<Objective>) {
    try {
      const { data, error } = await supabase
        .from('objectives')
        .update({
          title: updates.title,
          description: updates.description,
          quarter: updates.quarter,
          year: updates.year,
          owner_id: updates.ownerId,
          status: updates.status,
          progress: updates.progress,
          priority: updates.priority,
          start_date: updates.startDate,
          end_date: updates.endDate,
          category: updates.category,
          owner_name: updates.ownerName,
          team_members: updates.teamMembers,
          key_results: updates.keyResults,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur mise à jour objectif:', error);
      return { data: null, error };
    }
  }

  static async deleteObjective(id: string) {
    try {
      const { data, error } = await supabase
        .from('objectives')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur suppression objectif:', error);
      return { data: null, error };
    }
  }

  // ===== DOCUMENTS (KNOWLEDGE BASE) =====

  static async getDocumentAcl(documentId: string): Promise<{
    profileIds: string[];
    departmentIds: string[];
    projectIds: string[];
  } | null> {
    try {
      const [p, d, j] = await Promise.all([
        supabase.from('document_acl_profiles').select('profile_id').eq('document_id', documentId),
        supabase.from('document_acl_departments').select('department_id').eq('document_id', documentId),
        supabase.from('document_acl_projects').select('project_id').eq('document_id', documentId),
      ]);
      if (p.error && p.error.code !== 'PGRST116') console.warn('document_acl_profiles:', p.error.message);
      if (d.error && d.error.code !== 'PGRST116') console.warn('document_acl_departments:', d.error.message);
      if (j.error && j.error.code !== 'PGRST116') console.warn('document_acl_projects:', j.error.message);
      return {
        profileIds: (p.data || []).map((r: any) => String(r.profile_id)),
        departmentIds: (d.data || []).map((r: any) => String(r.department_id)),
        projectIds: (j.data || []).map((r: any) => String(r.project_id)),
      };
    } catch (e) {
      console.warn('getDocumentAcl:', e);
      return null;
    }
  }

  static async replaceDocumentAcl(
    documentId: string,
    acl: { profileIds?: string[] | undefined; departmentIds?: string[] | undefined; projectIds?: string[] | undefined }
  ): Promise<void> {
    const profileIds = [...new Set((acl.profileIds || []).filter(Boolean))];
    const departmentIds = [...new Set((acl.departmentIds || []).filter(Boolean))];
    const projectIds = [...new Set((acl.projectIds || []).filter(Boolean))];

    const del = async (table: string) => {
      const { error } = await supabase.from(table).delete().eq('document_id', documentId);
      if (error && !String(error.message || '').includes('does not exist') && error.code !== '42P01') {
        console.warn(`replaceDocumentAcl delete ${table}:`, error.message);
      }
    };

    await del('document_acl_profiles');
    await del('document_acl_departments');
    await del('document_acl_projects');

    if (profileIds.length) {
      const { error } = await supabase.from('document_acl_profiles').insert(
        profileIds.map((profile_id) => ({ document_id: documentId, profile_id }))
      );
      if (error) console.warn('document_acl_profiles insert:', error.message);
    }
    if (departmentIds.length) {
      const { error } = await supabase.from('document_acl_departments').insert(
        departmentIds.map((department_id) => ({ document_id: documentId, department_id }))
      );
      if (error) console.warn('document_acl_departments insert:', error.message);
    }
    if (projectIds.length) {
      const { error } = await supabase.from('document_acl_projects').insert(
        projectIds.map((project_id) => ({ document_id: documentId, project_id }))
      );
      if (error) console.warn('document_acl_projects insert:', error.message);
    }
  }

  /** Colonnes liste KB sans `content` (réduit fortement le payload réseau). */
  private static readonly DOCUMENT_LIST_COLUMNS =
    'id,title,description,category,tags,created_by_id,created_by_name,is_public,organization_id,view_count,last_viewed_at,version,created_at,updated_at,thumbnail_url,attachments';

  static async getDocuments() {
    const t0 = performance.now();
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) {
        throw new Error('Utilisateur non authentifié');
      }

      const uid = currentUser.user.id;

      const [{ data: profile, error: profileError }, { data: documents, error: docError }] =
        await Promise.all([
          supabase.from('profiles').select('id, full_name').eq('user_id', uid).single(),
          supabase
            .from('documents')
            .select(DataService.DOCUMENT_LIST_COLUMNS)
            .order('created_at', { ascending: false }),
        ]);

      if (profileError) throw profileError;
      if (!profile) {
        throw new Error('Profil utilisateur introuvable');
      }
      if (docError) throw docError;

      const { data: userFavorites } = await supabase
        .from('document_favorites')
        .select('document_id')
        .eq('user_id', profile.id);

      const favoriteIds = new Set(userFavorites?.map((f) => f.document_id) || []);

      const documentsWithFavorites =
        documents?.map((doc: Record<string, unknown>) => ({
          ...doc,
          content: '',
          is_favorite: favoriteIds.has(doc.id as string),
        })) || [];

      const elapsed = Math.round(performance.now() - t0);
      logger.logDataLoad('documents_list', documentsWithFavorites.length, elapsed);
      return { data: documentsWithFavorites, error: null };
    } catch (error) {
      logger.error('data', 'Erreur récupération liste documents', undefined, error as Error);
      return { data: null, error };
    }
  }

  static async getDocumentById(documentId: string) {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('*')
        .eq('id', documentId)
        .maybeSingle();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      logger.error('data', 'Erreur getDocumentById', { documentId }, error as Error);
      return { data: null, error };
    }
  }

  static async createDocument(document: Partial<Document>) {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) {
        throw new Error('Utilisateur non authentifié');
      }

      // Récupérer le profile.id et full_name pour created_by_id et created_by_name
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, full_name, organization_id')
        .eq('user_id', currentUser.user.id)
        .single();

      if (!profile) {
        throw new Error('Profil utilisateur introuvable');
      }

      const { data, error } = await supabase
        .from('documents')
        .insert({
          title: document.title || '',
          content: document.content || '',
          description: document.description || null,
          created_by_id: profile.id,
          created_by_name: profile.full_name || currentUser.user.email || 'Utilisateur',
          category: document.category || null,
          tags: document.tags || null,
          is_public: document.isPublic ?? false,
          organization_id: profile.organization_id ?? null,
          view_count: 0,
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur création document:', error);
        throw error;
      }

      const docId = data?.id as string | undefined;
      if (docId) {
        const pub = document.isPublic ?? false;
        await DataService.replaceDocumentAcl(docId, {
          profileIds: pub ? [] : document.sharedProfileIds,
          departmentIds: pub ? [] : document.sharedDepartmentIds,
          projectIds: pub ? [] : document.sharedProjectIds,
        });
      }

      console.log('✅ Document créé:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur création document:', error);
      return { data: null, error };
    }
  }

  static async updateDocument(id: string, updates: Partial<Document>) {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.content !== undefined) updateData.content = updates.content;
      if (updates.description !== undefined) updateData.description = updates.description || null;
      if (updates.category !== undefined) updateData.category = updates.category || null;
      if (updates.tags !== undefined) updateData.tags = updates.tags || null;
      if (updates.isPublic !== undefined) updateData.is_public = updates.isPublic;
      if (updates.viewCount !== undefined) updateData.view_count = updates.viewCount;
      // Incrémenter la version si le contenu change
      if (updates.content !== undefined) {
        const { data: currentDoc } = await supabase
          .from('documents')
          .select('version')
          .eq('id', id)
          .single();
        updateData.version = (currentDoc?.version || 1) + 1;
      }

      const { data, error } = await supabase
        .from('documents')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) {
        console.error('❌ Erreur mise à jour document:', error);
        throw error;
      }

      const syncAcl =
        updates.sharedProfileIds !== undefined ||
        updates.sharedDepartmentIds !== undefined ||
        updates.sharedProjectIds !== undefined ||
        (updates.isPublic !== undefined &&
          (updates.title !== undefined ||
            updates.content !== undefined ||
            updates.description !== undefined ||
            updates.category !== undefined ||
            updates.tags !== undefined));
      if (syncAcl && data?.id) {
        const pub = updates.isPublic ?? (data as any).is_public ?? false;
        if (pub) {
          await DataService.replaceDocumentAcl(id, { profileIds: [], departmentIds: [], projectIds: [] });
        } else {
          await DataService.replaceDocumentAcl(id, {
            profileIds: updates.sharedProfileIds,
            departmentIds: updates.sharedDepartmentIds,
            projectIds: updates.sharedProjectIds,
          });
        }
      }

      console.log('✅ Document mis à jour:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur mise à jour document:', error);
      return { data: null, error };
    }
  }

  static async deleteDocument(id: string) {
    try {
      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', id);
      
      if (error) {
        console.error('❌ Erreur suppression document:', error);
        throw error;
      }

      console.log('✅ Document supprimé:', id);
      return { error: null };
    } catch (error) {
      console.error('❌ Erreur suppression document:', error);
      return { error };
    }
  }

  // ===== NOTIFICATIONS =====
  static async getNotifications(userId: string) {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
      
      if (error) {
        if (handleOptionalTableError(error, 'notifications', 'DataService.getNotifications')) {
          return { data: [], error: null };
        }
        if (isNotificationWriteDenied(error)) {
          if (!notificationAccessDeniedWarned) {
            notificationAccessDeniedWarned = true;
            console.warn(
              'Notifications : accès refusé (RLS / droits). Ajustez les politiques Supabase sur `notifications`.',
            );
          }
          return { data: [], error: null };
        }
        throw error;
      }
      return { data, error: null };
    } catch (error) {
      if (handleOptionalTableError(error, 'notifications', 'DataService.getNotifications.catch')) {
        return { data: [], error: null };
      }
      if (isNotificationWriteDenied(error)) {
        if (!notificationAccessDeniedWarned) {
          notificationAccessDeniedWarned = true;
          console.warn(
            'Notifications : accès refusé (RLS / droits). Ajustez les politiques Supabase sur `notifications`.',
          );
        }
        return { data: [], error: null };
      }
      console.error('Erreur récupération notifications:', error);
      return { data: null, error };
    }
  }

  static async createNotification(notification: any) {
    try {
      const rawUserId = notification.userId || notification.user_id || null;
      if (!rawUserId) {
        return { data: null, error: new Error('userId manquant') };
      }

      // La table notifications pointe vers profiles.id (et non auth.users.id)
      const uuidLike = NOTIF_TARGET_UUID;
      const targetProfileId = await resolveNotifTargetProfileId(String(rawUserId));
      if (!targetProfileId) {
        return { data: null, error: new Error('Profil destinataire introuvable (notifications.user_id doit être un profiles.id)') };
      }

      const entityId =
        typeof notification.entityId === 'string' && uuidLike.test(notification.entityId)
          ? notification.entityId
          : null;

      const createdAt = new Date().toISOString();
      // Pas de .select() : le RETURNING échoue souvent en RLS si le créateur n’est pas le destinataire.
      const { error } = await supabase.from('notifications').insert({
        user_id: targetProfileId,
        message: notification.message || '',
        type: notification.type || 'info',
        module: notification.module || 'system',
        action: notification.action || 'created',
        title: notification.title || 'Notification',
        entity_type: notification.entityType || notification.entity_type || null,
        entity_id: entityId,
        entity_title: notification.entityTitle || notification.entity_title || null,
        created_by: notification.createdBy || notification.created_by || null,
        created_by_name: notification.createdByName || notification.created_by_name || null,
        metadata: notification.metadata || null,
        read: notification.read || false,
        created_at: createdAt,
      });

      if (error) {
        if (isDuplicateNotificationInsert(error)) {
          return { data: null, error: null };
        }
        throw error;
      }
      return { data: { inserted: true, user_id: targetProfileId, created_at: createdAt }, error: null };
    } catch (error) {
      if (isDuplicateNotificationInsert(error)) {
        return { data: null, error: null };
      }
      if (handleOptionalTableError(error, 'notifications', 'DataService.createNotification')) {
        return { data: null, error: null };
      }
      if (isNotificationWriteDenied(error)) {
        if (!notificationAccessDeniedWarned) {
          notificationAccessDeniedWarned = true;
          console.warn(
            'Notifications : accès refusé (RLS / droits). Ajustez les politiques Supabase sur `notifications` ou désactivez les notifications automatiques.',
          );
        }
        return { data: null, error: null };
      }
      console.error('Erreur création notification:', error);
      return { data: null, error };
    }
  }

  static async markNotificationAsRead(id: string) {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('id', id);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur marquage notification:', error);
      return { error };
    }
  }

  // Gestion des rapports de projet
  static async createProjectReport(reportData: any) {
    try {
      const { data, error } = await supabase
        .from('project_reports')
        .insert({
          project_id: reportData.projectId,
          title: reportData.title,
          content: reportData.content,
          type: reportData.type,
          created_by: reportData.createdBy
        })
        .select()
        .single();
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur création rapport:', error);
      return { data: null, error };
    }
  }

  static async getProjectReports(projectId: string) {
    try {
      const { data, error } = await supabase
        .from('project_reports')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération rapports:', error);
      return { data: [], error };
    }
  }

  static async deleteProjectReport(reportId: string) {
    try {
      const { error } = await supabase
        .from('project_reports')
        .delete()
        .eq('id', reportId);
      
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur suppression rapport:', error);
      return { error };
    }
  }

  // ===== JOBS =====
  static async getJobs() {
    try {
      const { data, error } = await supabase
        .from('jobs')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('❌ Erreur récupération jobs:', error);
        return { data: [], error: null }; // Retourner tableau vide au lieu de null
      }
      
      console.log('📊 API GET jobs - Résultat:', data?.length || 0, 'éléments');
      return { data: data || [], error: null };
    } catch (error) {
      console.error('❌ Erreur récupération jobs:', error);
      return { data: [], error };
    }
  }

  static async createJob(job: any) {
    try {
      const { data: currentUser } = await supabase.auth.getUser();
      if (!currentUser.user) {
        throw new Error('Utilisateur non authentifié');
      }

      const jobData = {
        title: job.title,
        company: job.company,
        location: job.location,
        type: job.type,
        description: job.description,
        required_skills: job.requiredSkills || [],
        status: job.status || 'draft',
        sector: job.sector || null,
        experience_level: job.experienceLevel || null,
        remote_work: job.remoteWork || null,
        salary: job.salary || null,
        benefits: job.benefits || null,
        education: job.education || null,
        languages: job.languages || null,
        application_link: job.applicationLink || null,
        application_email: job.applicationEmail || null,
        company_website: job.companyWebsite || null,
        created_by: currentUser.user.id,
        applicants: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('jobs')
        .insert(jobData)
        .select()
        .single();
      
      if (error) throw error;
      
      console.log('✅ Job créé:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur création job:', error);
      return { data: null, error };
    }
  }

  static async updateJob(id: number, updates: any) {
    try {
      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (updates.title !== undefined) updateData.title = updates.title;
      if (updates.company !== undefined) updateData.company = updates.company;
      if (updates.location !== undefined) updateData.location = updates.location;
      if (updates.type !== undefined) updateData.type = updates.type;
      if (updates.description !== undefined) updateData.description = updates.description;
      if (updates.requiredSkills !== undefined) updateData.required_skills = updates.requiredSkills;
      if (updates.status !== undefined) updateData.status = updates.status;
      if (updates.sector !== undefined) updateData.sector = updates.sector;
      if (updates.experienceLevel !== undefined) updateData.experience_level = updates.experienceLevel;
      if (updates.remoteWork !== undefined) updateData.remote_work = updates.remoteWork;
      if (updates.salary !== undefined) updateData.salary = updates.salary;
      if (updates.benefits !== undefined) updateData.benefits = updates.benefits;
      if (updates.education !== undefined) updateData.education = updates.education;
      if (updates.languages !== undefined) updateData.languages = updates.languages;
      if (updates.applicationLink !== undefined) updateData.application_link = updates.applicationLink;
      if (updates.applicationEmail !== undefined) updateData.application_email = updates.applicationEmail;
      if (updates.companyWebsite !== undefined) updateData.company_website = updates.companyWebsite;

      const { data, error } = await supabase
        .from('jobs')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();
      
      if (error) throw error;
      
      console.log('✅ Job mis à jour:', data.id);
      return { data, error: null };
    } catch (error) {
      console.error('❌ Erreur mise à jour job:', error);
      return { data: null, error };
    }
  }

  static async deleteJob(id: number) {
    try {
      const { error } = await supabase
        .from('jobs')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
      
      console.log('✅ Job supprimé:', id);
      return { error: null };
    } catch (error) {
      console.error('❌ Erreur suppression job:', error);
      return { error };
    }
  }

  // ===== ACTIVITY LOGS =====
  static async getActivityLogs(entityType?: string, entityId?: string) {
    try {
      // Construire l'URL avec les filtres Supabase
      let url = 'activity_logs?select=*&order=created_at.desc&limit=100';
      
      if (entityType) {
        url += `&entity_type=eq.${entityType}`;
      }
      
      if (entityId) {
        url += `&entity_id=eq.${entityId}`;
      }

      // Utiliser fetch directement avec le format Supabase
      const baseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://tdwbqgyubigaurnjzbfv.supabase.co';
      const apiKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkd2JxZ3l1YmlnYXVybmp6YmZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjA5ODA2NzEsImV4cCI6MjA3NjU1NjY3MX0.bmGr3gY0GFeJelVIq8xwZJ6xaZhb-L-SAhn6ypg6zzU';
      
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token || apiKey;

      const response = await fetch(`${baseUrl}/rest/v1/${url}`, {
        headers: {
          'apikey': apiKey,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return { data, error: null };
    } catch (error) {
      console.error('Erreur récupération activity logs:', error);
      return { data: null, error };
    }
  }

  // Récupérer l'historique pour une entité spécifique
  static async getEntityActivityHistory(entityType: string, entityId: string) {
    return this.getActivityLogs(entityType, entityId);
  }

  // ===== GESTION DES TAUX DE CHANGE MANUELS =====
  
  /**
   * Récupère tous les taux de change manuels
   */
  static async getManualExchangeRates(
    baseCurrency?: CurrencyCode,
    targetCurrency?: CurrencyCode,
    date?: string
  ) {
    try {
      let query = supabase
        .from('manual_exchange_rates')
        .select('*')
        .order('effective_date', { ascending: false });

      if (baseCurrency) {
        query = query.eq('base_currency', baseCurrency);
      }

      if (targetCurrency) {
        query = query.eq('target_currency', targetCurrency);
      }

      if (date) {
        query = query
          .lte('effective_date', date)
          .or(`end_date.is.null,end_date.gte.${date}`);
      }

      const { data, error } = await query;

      if (error) throw error;

      return (data || []).map((rate: any) => ({
        id: rate.id,
        baseCurrency: rate.base_currency as CurrencyCode,
        targetCurrency: rate.target_currency as CurrencyCode,
        rate: Number(rate.rate),
        effectiveDate: rate.effective_date,
        endDate: rate.end_date || undefined,
        source: rate.source || 'manual',
        notes: rate.notes || undefined,
        createdBy: rate.created_by || undefined,
        createdAt: rate.created_at || undefined,
        updatedAt: rate.updated_at || undefined
      }));
    } catch (error) {
      console.error('❌ Erreur récupération taux manuels:', error);
      return [];
    }
  }

  /**
   * Crée un nouveau taux de change manuel
   */
  static async createManualExchangeRate(rate: {
    baseCurrency: CurrencyCode;
    targetCurrency: CurrencyCode;
    rate: number;
    effectiveDate: string;
    endDate?: string;
    source?: string;
    notes?: string;
  }) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Utilisateur non authentifié');

      const { data, error } = await supabase
        .from('manual_exchange_rates')
        .insert({
          base_currency: rate.baseCurrency,
          target_currency: rate.targetCurrency,
          rate: rate.rate,
          effective_date: rate.effectiveDate,
          end_date: rate.endDate || null,
          source: rate.source || 'manual',
          notes: rate.notes || null,
          created_by: user.id
        })
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.id,
        baseCurrency: data.base_currency as CurrencyCode,
        targetCurrency: data.target_currency as CurrencyCode,
        rate: Number(data.rate),
        effectiveDate: data.effective_date,
        endDate: data.end_date || undefined,
        source: data.source || 'manual',
        notes: data.notes || undefined,
        createdBy: data.created_by || undefined,
        createdAt: data.created_at || undefined,
        updatedAt: data.updated_at || undefined
      };
    } catch (error) {
      console.error('❌ Erreur création taux manuel:', error);
      throw error;
    }
  }

  /**
   * Met à jour un taux de change manuel
   */
  static async updateManualExchangeRate(
    id: string,
    updates: {
      rate?: number;
      effectiveDate?: string;
      endDate?: string;
      source?: string;
      notes?: string;
    }
  ) {
    try {
      const updateData: any = {};
      if (updates.rate !== undefined) updateData.rate = updates.rate;
      if (updates.effectiveDate !== undefined) updateData.effective_date = updates.effectiveDate;
      if (updates.endDate !== undefined) updateData.end_date = updates.endDate || null;
      if (updates.source !== undefined) updateData.source = updates.source;
      if (updates.notes !== undefined) updateData.notes = updates.notes || null;

      const { data, error } = await supabase
        .from('manual_exchange_rates')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      return {
        id: data.id,
        baseCurrency: data.base_currency as CurrencyCode,
        targetCurrency: data.target_currency as CurrencyCode,
        rate: Number(data.rate),
        effectiveDate: data.effective_date,
        endDate: data.end_date || undefined,
        source: data.source || 'manual',
        notes: data.notes || undefined,
        createdBy: data.created_by || undefined,
        createdAt: data.created_at || undefined,
        updatedAt: data.updated_at || undefined
      };
    } catch (error) {
      console.error('❌ Erreur mise à jour taux manuel:', error);
      throw error;
    }
  }

  /**
   * Supprime un taux de change manuel
   */
  static async deleteManualExchangeRate(id: string) {
    try {
      const { error } = await supabase
        .from('manual_exchange_rates')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return { success: true };
    } catch (error) {
      console.error('❌ Erreur suppression taux manuel:', error);
      throw error;
    }
  }
}

export default DataService;
