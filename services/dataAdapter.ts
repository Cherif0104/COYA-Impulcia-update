import { DataService } from './dataService';
import { AuthService } from './authService';
import * as programmeService from './programmeService';
import { listTasksForProjects, mergeSqlTasksWithJsonTasks, syncProjectTasksFromUi } from './taskTableService';
import OrganizationService from './organizationService';
import { supabase } from './supabaseService';
import { handleOptionalTableError } from './optionalTableGuard';
import { effectiveInvoiceStatusFromRow } from './invoiceDerivedStatus';
import {
  Course,
  CourseAudienceSegment,
  CohortParticipantRole,
  CoursePublishWorkflowStatus,
  CourseSession,
  CourseSessionEnrollment,
  CourseSessionStatus,
  Job,
  Project,
  Task,
  Objective,
  KeyResult,
  Contact,
  CrmContactLifecycleStatus,
  Document,
  User,
  TimeLog,
  LeaveRequest,
  Invoice,
  Expense,
  RecurringInvoice,
  RecurringExpense,
  RecurrenceFrequency,
  Budget,
  Meeting,
  Role,
  CurrencyCode,
  PresenceSession,
  Employee,
  ProjectAttachment,
  ProjectModuleSettings,
  PlanningSlot,
  PresenceStatusEvent,
  HrAttendancePolicy,
  HrWorkforceAnomaly,
  WorkforceTimelineSegmentRow,
  EmployeeWorkSchedule,
  ProjectStatus,
} from '../types';
import { verboseLogs } from './verboseLog';

const vlog = (...args: unknown[]) => {
  if (verboseLogs()) console.log(...args);
};

/**
 * Couche pivot « migration progressive » : la majorité des écrans passent encore par `DataAdapter`
 * pour lecture/écriture Supabase + garde-fous optionnels (`optionalTableGuard`).
 *
 * Périmètre cible :
 * - **DataService** : accès Postgres / RPC bas niveau, réutilisable hors UI.
 * - **Services métier** (`programmeService`, `taskTableService`, …) : règles domaine + requêtes ciblées.
 * - **Read models UI** (`projectCockpitReadModel`, …) : agrégats à partir des props / réponses déjà chargées.
 * Nouvelles fonctionnalités : préférer un service métier ou un read model ; n’étendre `DataAdapter` que
 * pour garder un point d’entrée unique le temps de la migration.
 *
 * Roadmap transverse : membership projet + RLS strict, bus d’événements métier (voir `workflowEngine.ts`).
 */
export class DataAdapter {
  private static useSupabase = true; // Activé pour la persistance

  private static courseWorkflowFieldsFromRow(row: Record<string, unknown>) {
    return {
      publishWorkflowStatus: (row.publish_workflow_status as CoursePublishWorkflowStatus) ?? 'none',
      submittedForReviewAt: (row.submitted_for_review_at as string | null) ?? null,
      reviewedAt: (row.reviewed_at as string | null) ?? null,
      reviewedBy: (row.reviewed_by as string | null) ?? null,
      certificationEnabled: !!(row.certification_enabled ?? false),
      certificationLabel: (row.certification_label as string | null) ?? null,
    };
  }

  private static mapCourseModulesFromSupabaseRows(moduleRows: any[]) {
    return (moduleRows || []).map((module: any) => ({
      id: module.id,
      title: module.title || 'Module',
      description: module.description || '',
      lessons: (module.lessons || []).map((lesson: any) => ({
        id: lesson.id || `lesson-${lesson.order_index}`,
        title: lesson.title || 'Leçon',
        type: lesson.type || 'video',
        duration: lesson.duration || '0 min',
        icon: lesson.icon || 'fas fa-play-circle',
        description: lesson.description || '',
        contentUrl: lesson.content_url || undefined,
        attachments: lesson.attachments || [],
        externalLinks: lesson.external_links || [],
        quizQuestions: Array.isArray(lesson.quiz?.questions) ? lesson.quiz.questions : [],
      })),
      evidenceDocuments: module.evidence_documents || [],
      requiresValidation: module.requires_validation ?? false,
      unlocksNextModule: module.unlocks_next_module ?? true,
    }));
  }

  private static mapProfileToUser(profile: any): User {
    if (!profile) {
      throw new Error('Profil Supabase invalide');
    }

    const id = profile.user_id || profile.id;
    return {
      id,
      profileId: profile.id,
      name: profile.full_name,
      fullName: profile.full_name,
      email: profile.email,
      role: AuthService.mapStoredRoleToUi(profile.role),
      avatar: profile.avatar_url || '',
      phone: profile.phone_number || '',
      phoneNumber: profile.phone_number || '',
      skills: profile.skills || [],
      bio: profile.bio || '',
      location: profile.location || '',
      website: profile.website || '',
      linkedinUrl: profile.linkedin_url || '',
      githubUrl: profile.github_url || '',
      isActive: profile.is_active ?? true,
      lastLogin: profile.last_login || new Date().toISOString(),
      createdAt: profile.created_at || new Date().toISOString(),
      updatedAt: profile.updated_at || new Date().toISOString(),
      status: (profile.status as any) || 'active',
      pendingRole: profile.pending_role ? AuthService.mapStoredRoleToUi(profile.pending_role) : null,
      reviewComment: profile.review_comment || null,
      reviewedAt: profile.reviewed_at || null,
      reviewedBy: profile.reviewed_by || null,
      organizationId: profile.organization_id ?? null,
      requestedDepartmentId: profile.requested_department_id ?? null,
      requestedPoste: profile.requested_poste ?? null,
      passwordChanged: profile.password_changed ?? false,
    };
  }

  // Helper pour mapper les statuts de contact
  private static mapContactStatus(status: string | undefined): CrmContactLifecycleStatus {
    const statusMap: Record<string, CrmContactLifecycleStatus> = {
      lead: 'Lead',
      active: 'Contacted',
      inactive: 'Contacted',
      customer: 'Customer',
      prospect: 'Prospect',
      contacted: 'Contacted',
      unreachable: 'Unreachable',
      callback_expected: 'CallbackExpected',
      callbackexpected: 'CallbackExpected',
    };
    return statusMap[status?.toLowerCase() || ''] || 'Lead';
  }

  private static mapContactFromDb(contact: any, index?: number): Contact {
    const idx = index ?? 0;
    return {
      id: contact.id ?? idx + 1,
      name: `${contact.first_name || ''} ${contact.last_name || ''}`.trim() || 'Contact sans nom',
      workEmail: contact.email || '',
      company: contact.company || 'N/A',
      status: this.mapContactStatus(contact.status),
      workflowStatus: contact.workflow_status ?? undefined,
      workflowUpdatedAt: contact.workflow_updated_at ?? undefined,
      avatar: `https://picsum.photos/seed/${contact.id || idx}/100/100`,
      officePhone: contact.phone || undefined,
      mobilePhone: contact.phone || undefined,
      whatsappNumber: contact.phone || undefined,
      personalEmail: undefined,
      categoryId: contact.category_id || undefined,
      categoryName: undefined,
      createdById: contact.created_by || undefined,
      createdByName: contact.created_by_name || undefined,
      source: contact.source ?? undefined,
      sourceCollectionId: contact.source_collection_id ?? undefined,
      sourceSubmissionId: contact.source_submission_id ?? undefined,
      organizationId: contact.organization_id != null ? String(contact.organization_id) : undefined,
      notes: contact.notes ?? undefined,
      tags: Array.isArray(contact.tags) ? contact.tags : undefined,
    };
  }

  static async searchInstructors(searchTerm: string, roles?: string[]): Promise<User[]> {
    if (!this.useSupabase) {
      return [];
    }

    try {
      const defaultRoles = roles && roles.length > 0
        ? roles
        : ['trainer', 'coach', 'mentor', 'facilitator', 'partner_facilitator', 'administrator', 'manager', 'supervisor', 'super_administrator'];

      const { data, error } = await DataService.searchInstructors(searchTerm, defaultRoles);

      if (error) throw error;

      return (data || []).map((profile: any) => ({
        id: profile.user_id || profile.id,
        profileId: profile.id,
        name: profile.full_name || profile.email || 'Utilisateur',
        fullName: profile.full_name || profile.email || 'Utilisateur',
        email: profile.email || '',
        avatar: profile.avatar_url || '',
        role: (profile.role || 'trainer') as Role,
        skills: [],
        phone: profile.phone_number || undefined,
        location: profile.location || undefined,
        isActive: profile.is_active !== false
      }));
    } catch (error) {
      console.error('❌ Erreur recherche instructeurs:', error);
      return [];
    }
  }

  // ===== PROJECTS =====
  static async getProjects(): Promise<Project[]> {
    if (this.useSupabase) {
      try {
        vlog('🔍 DataAdapter.getProjects - Appel DataService.getProjects()');
        const { data, error } = await DataService.getProjects();
        
        if (error) {
          console.error('❌ Erreur DataService.getProjects:', error);
          return []; // Retourner tableau vide au lieu de throw
        }
        
        vlog('📊 Données brutes Supabase:', data?.length || 0, 'projets');
        const orgId = (data && data[0]) ? (data[0] as any).organization_id : null;
        const programmeIds = new Set<string>();
        (data || []).forEach((p: any) => { if (p.programme_id) programmeIds.add(p.programme_id); });
        let programmeMap: Record<string, { name: string; bailleurName?: string | null }> = {};
        try {
          const programmes = await programmeService.listProgrammes(orgId || undefined);
          programmes.forEach(pr => {
            if (programmeIds.has(pr.id)) programmeMap[pr.id] = { name: pr.name, bailleurName: pr.bailleurName ?? null };
          });
        } catch (_) { /* ignore */ }

        const rawRows = (data || []) as any[];
        let tasksByProject: Record<string, Task[]> = {};
        try {
          tasksByProject = await listTasksForProjects(rawRows.map((p) => String(p.id)));
        } catch (_) {
          tasksByProject = {};
        }

        // Convertir les données Supabase vers le format attendu
        const projects = await Promise.all(
          rawRows.map(async (project: any) => {
            // Récupérer les utilisateurs de l'équipe
            let team: any[] = [];
            if (project.team_members && project.team_members.length > 0) {
              const { data: teamProfiles } = await DataService.getUsersByIds(project.team_members);
              team = (teamProfiles || []).map((user: any) => ({
                id: user.user_id || user.id,
                name: user.full_name,
                fullName: user.full_name,
                email: user.email,
                role: user.role,
                avatar: user.avatar_url || '',
                phone: user.phone_number || '',
                phoneNumber: user.phone_number || '',
                skills: user.skills || [],
                location: user.location || '',
                isActive: user.is_active !== false
              }));
            }
            const prog = project.programme_id ? programmeMap[project.programme_id] : null;
            const rawStatus = (project.status || 'not_started').toLowerCase();
            const statusDisplay: ProjectStatus =
              rawStatus === 'completed'
                ? 'Completed'
                : rawStatus === 'cancelled'
                ? 'Cancelled'
                : rawStatus === 'on_hold'
                ? 'On Hold'
                : rawStatus === 'in_progress' || rawStatus === 'active'
                ? 'In Progress'
                : 'Not Started';
            const dbTasks = tasksByProject[String(project.id)] || [];
            const jsonTasks = (project.tasks || []) as Task[];
            const tasks =
              dbTasks.length > 0 ? mergeSqlTasksWithJsonTasks(dbTasks, jsonTasks) : jsonTasks;
            return {
              id: project.id,
              title: project.name,
              description: project.description || '',
              status: statusDisplay,
              priority: project.priority || 'medium',
              dueDate: project.end_date,
              startDate: project.start_date,
              budget: project.budget,
              clientName: project.client || '',
              team,
              teamMemberIds: Array.isArray(project.team_members) ? project.team_members.map((memberId: any) => String(memberId)) : [],
              tasks,
              risks: project.risks || [],
              createdById: project.created_by_id || project.owner_id || null,
              createdByName: project.created_by_name || null,
              createdAt: project.created_at || new Date().toISOString(),
              updatedAt: project.updated_at || new Date().toISOString(),
              programmeId: project.programme_id || null,
              programmeName: prog?.name ?? null,
              programmeBailleurName: prog?.bailleurName ?? null
            };
          })
        );

        vlog('✅ DataAdapter.getProjects - Projets convertis:', projects.length);
        return projects;
      } catch (error) {
        console.error('❌ Erreur Supabase, retour tableau vide:', error);
        return []; // Pas de fallback vers mockProjects
      }
    }
    vlog('⚠️ DataAdapter.getProjects - useSupabase=false, retour vide (pas de données locales fictives)');
    return [];
  }

  static async createProject(project: Partial<Project>): Promise<Project | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createProject(project);
        if (error) throw error;
        if (data) {
          try {
            const orgId = await OrganizationService.getCurrentUserOrganizationId();
            const { data: { user } } = await supabase.auth.getUser();
            const initialTasks = project.tasks || data.tasks || [];
            if (orgId && data.id) {
              await syncProjectTasksFromUi(orgId, String(data.id), initialTasks, user?.id ?? null);
            }
          } catch (syncErr) {
            console.warn('DataAdapter.createProject - sync tasks table:', syncErr);
          }
          // Récupérer les utilisateurs de l'équipe
          let team: any[] = [];
          if (data.team_members && data.team_members.length > 0) {
            const { data: teamData } = await DataService.getUsersByIds(data.team_members);
            team = teamData?.map(user => ({
              id: user.user_id || crypto.randomUUID(),
              name: user.full_name,
              email: user.email,
              role: user.role,
              avatar: '', // Pas d'avatar pour l'instant
              phoneNumber: user.phone_number || '',
              skills: [],
              bio: '',
              location: '',
              website: '',
              linkedinUrl: '',
              githubUrl: '',
              isActive: true,
              lastLogin: new Date().toISOString(),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            })) || [];
          }
          
          return {
            id: data.id,
            title: data.name,
            description: data.description || '',
            status: data.status || 'Not Started',
            priority: data.priority || 'medium',
            dueDate: data.end_date,
            startDate: data.start_date,
            budget: data.budget,
            clientName: data.client || '',
            team,
            teamMemberIds: Array.isArray(data.team_members) ? data.team_members.map((memberId: any) => String(memberId)) : [],
            tasks: data.tasks || [],
            risks: data.risks || [],
            createdById: data.created_by_id || data.owner_id || null,
            createdByName: data.created_by_name || null,
            createdAt: data.created_at || new Date().toISOString(),
            updatedAt: data.updated_at || new Date().toISOString(),
            programmeId: (data as any).programme_id ?? null
          };
        }
        return null;
      } catch (error) {
        console.warn('Erreur Supabase création projet:', error);
        return null;
      }
    }
    return null;
  }

  static async updateProject(project: Project): Promise<boolean> {
    if (this.useSupabase) {
      try {
        vlog('🔄 DataAdapter.updateProject - Mise à jour projet ID:', project.id);
        
        // Convertir le projet vers le format Supabase
        const teamMemberIds = project.team?.map(member => {
          const memberId = member.id;
          // Si c'est déjà un UUID valide, l'utiliser tel quel
          if (memberId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(memberId))) {
            return String(memberId);
          }
          // Générer un vrai UUID
          return crypto.randomUUID();
        }) || [];

        const supabaseProject = {
          name: project.title,
          description: project.description,
          status: project.status,
          priority: project.priority,
          end_date: project.dueDate,
          start_date: project.startDate,
          budget: project.budget,
          client: project.clientName,
          team_members: teamMemberIds,
          tasks: project.tasks || [],
          risks: project.risks || [],
          updated_at: new Date().toISOString()
        };

        const { error } = await DataService.updateProject(project.id.toString(), {
          title: project.title,
          description: project.description,
          status: project.status,
          priority: project.priority,
          startDate: project.startDate,
          dueDate: project.dueDate,
          budget: project.budget,
          clientName: project.clientName,
          team: project.team,
          tasks: project.tasks || [],
          risks: project.risks || [],
          programmeId: project.programmeId ?? null
        });
        if (error) throw error;

        try {
          const orgId = await OrganizationService.getCurrentUserOrganizationId();
          const { data: { user } } = await supabase.auth.getUser();
          if (orgId) {
            await syncProjectTasksFromUi(orgId, String(project.id), project.tasks || [], user?.id ?? null);
          }
        } catch (syncErr) {
          console.warn('DataAdapter.updateProject - sync tasks table:', syncErr);
        }

        vlog('✅ DataAdapter.updateProject - Projet mis à jour avec succès');
        return true;
      } catch (error) {
        console.error('❌ Erreur mise à jour projet:', error);
        return false;
      }
    }
    vlog('⚠️ DataAdapter.updateProject - useSupabase=false, abandon');
    return false;
  }

  static async deleteProject(projectId: string | number): Promise<boolean> {
    if (this.useSupabase) {
      try {
        vlog('🔄 DataAdapter.deleteProject - Suppression projet ID:', projectId);
        
        const { error } = await DataService.deleteProject(String(projectId));
        if (error) throw error;
        
        vlog('✅ DataAdapter.deleteProject - Projet supprimé avec succès');
        return true;
      } catch (error) {
        console.error('❌ Erreur suppression projet:', error);
        return false;
      }
    }
    vlog('⚠️ DataAdapter.deleteProject - useSupabase=false, abandon');
    return false;
  }

  // ===== INVOICES =====
  static async getInvoices(): Promise<Invoice[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getInvoices();
        if (error) throw error;

        const invoiceRows = Array.isArray(data) ? data : [];
        const invoices = invoiceRows.map((invoice: any) => {
          let normalizedStatus: Invoice['status'] = 'Draft';
          const status = effectiveInvoiceStatusFromRow(invoice);
          if (status === 'sent') normalizedStatus = 'Sent';
          else if (status === 'paid') normalizedStatus = 'Paid';
          else if (status === 'overdue') normalizedStatus = 'Overdue';
          else if (status === 'partially_paid') normalizedStatus = 'Partially Paid';
          else normalizedStatus = 'Draft';

          return {
            id: invoice.id,
            invoiceNumber: invoice.invoice_number || invoice.number || '',
            clientName: invoice.client_name || '',
            amount: Number(invoice.amount) || 0,
            vatAmount: invoice.tax != null ? Number(invoice.tax) : undefined,
            totalAmount: invoice.total != null ? Number(invoice.total) : undefined,
            currencyCode: (invoice.currency_code || 'USD') as CurrencyCode,
            exchangeRate: invoice.exchange_rate ? Number(invoice.exchange_rate) : undefined,
            baseAmountUSD: invoice.base_amount_usd ? Number(invoice.base_amount_usd) : undefined,
            transactionDate: invoice.transaction_date || invoice.due_date || undefined,
            dueDate: invoice.due_date || '',
            status: normalizedStatus,
            receipt: invoice.receipt_file_name && invoice.receipt_data_url
              ? {
                  fileName: invoice.receipt_file_name,
                  dataUrl: invoice.receipt_data_url,
                }
              : undefined,
            paidDate: invoice.paid_date || undefined,
            paidAmount: invoice.paid_amount ? Number(invoice.paid_amount) : undefined,
            recurringSourceId: invoice.recurring_source_id || undefined,
            createdById: invoice.user_id || invoice.created_by || undefined,
            createdByName: invoice.created_by_name || undefined,
          };
        }) || [];
        
        return invoices;
      } catch (error) {
        console.error('❌ Erreur Supabase factures:', error);
        return [];
      }
    }
    return [];
  }

  static async createInvoice(invoice: Partial<Invoice>): Promise<Invoice | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createInvoice(invoice);
        
        if (error) {
          console.error('❌ DataService.createInvoice - Erreur:', error);
          throw error;
        }
        
        if (!data) {
          console.error('❌ DataAdapter.createInvoice - Pas de données retournées par DataService');
          return null;
        }

        let normalizedStatus: Invoice['status'] = 'Draft';
        const status = effectiveInvoiceStatusFromRow(data);
        if (status === 'sent') normalizedStatus = 'Sent';
        else if (status === 'paid') normalizedStatus = 'Paid';
        else if (status === 'overdue') normalizedStatus = 'Overdue';
        else if (status === 'partially_paid') normalizedStatus = 'Partially Paid';
        else normalizedStatus = 'Draft';

        const convertedInvoice: Invoice = {
          id: data.id,
          invoiceNumber: data.number || data.invoice_number || '',
          clientName: data.client_name || '',
          amount: Number(data.amount) || 0,
          vatAmount: data.tax != null ? Number(data.tax) : undefined,
          totalAmount: data.total != null ? Number(data.total) : undefined,
          currencyCode: (data.currency_code || 'USD') as CurrencyCode,
          exchangeRate: data.exchange_rate ? Number(data.exchange_rate) : undefined,
          baseAmountUSD: data.base_amount_usd ? Number(data.base_amount_usd) : undefined,
          transactionDate: data.transaction_date || data.due_date || undefined,
          dueDate: data.due_date || '',
          status: normalizedStatus,
          receipt: data.receipt_file_name && data.receipt_data_url
            ? {
                fileName: data.receipt_file_name,
                dataUrl: data.receipt_data_url,
              }
            : undefined,
          paidDate: data.paid_date || undefined,
          paidAmount: data.paid_amount ? Number(data.paid_amount) : undefined,
          recurringSourceId: data.recurring_source_id || undefined,
          createdById: data.user_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined,
        };
        
        return convertedInvoice;
      } catch (error: any) {
        console.error('❌ Erreur Supabase création facture:', error);
        
        // Détecter l'erreur de contrainte CHECK pour paiement partiel
        if (error?.code === '23514' && error?.message?.includes('invoices_status_check')) {
          const errorMessage = `❌ ERREUR : La contrainte CHECK sur la table invoices ne permet pas encore le statut 'partially_paid'.
          
🔧 ACTION REQUISE (2 minutes) :
1. Aller sur https://supabase.com/dashboard
2. Ouvrir "SQL Editor" → "New query"
3. Copier-coller ce script :

ALTER TABLE invoices 
DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE invoices
ADD CONSTRAINT invoices_status_check 
CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'partially_paid') OR status IS NULL);

4. Cliquer "Run"
5. Recharger cette page et réessayer

📄 Voir aussi : docs/ACTIVER-PAIEMENT-PARTIEL.md`;
          
          console.error(errorMessage);
          throw new Error(errorMessage);
        }
        
        return null;
      }
    }
    return null;
  }

  static async updateInvoice(id: string, updates: Partial<Invoice>): Promise<Invoice | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.updateInvoice(id, updates);
        if (error) throw error;
        
        if (!data) return null;

        let normalizedStatus: Invoice['status'] = 'Draft';
        const status = effectiveInvoiceStatusFromRow(data);
        if (status === 'sent') normalizedStatus = 'Sent';
        else if (status === 'paid') normalizedStatus = 'Paid';
        else if (status === 'overdue') normalizedStatus = 'Overdue';
        else if (status === 'partially_paid') normalizedStatus = 'Partially Paid';
        else normalizedStatus = 'Draft';

        return {
          id: data.id,
          invoiceNumber: data.invoice_number || data.number || '',
          clientName: data.client_name || '',
          amount: Number(data.amount) || 0,
          vatAmount: data.tax != null ? Number(data.tax) : undefined,
          totalAmount: data.total != null ? Number(data.total) : undefined,
          dueDate: data.due_date || '',
          status: normalizedStatus,
          receipt: data.receipt_file_name && data.receipt_data_url
            ? {
                fileName: data.receipt_file_name,
                dataUrl: data.receipt_data_url,
              }
            : undefined,
          paidDate: data.paid_date || undefined,
          paidAmount: data.paid_amount ? Number(data.paid_amount) : undefined,
          recurringSourceId: data.recurring_source_id || undefined,
          createdById: data.user_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined,
        };
      } catch (error) {
        console.error('❌ Erreur Supabase mise à jour facture:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteInvoice(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteInvoice(id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error('❌ Erreur Supabase suppression facture:', error);
        return false;
      }
    }
    return false;
  }

  // ===== EXPENSES =====
  static async getExpenses(): Promise<Expense[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getExpenses();
        if (error) throw error;
        return data?.map((expense: any) => {
          // Normaliser le status
          let normalizedStatus: Expense['status'] = 'Unpaid';
          const status = expense.status?.toLowerCase() || 'unpaid';
          if (status === 'paid') normalizedStatus = 'Paid';
          else normalizedStatus = 'Unpaid';

          return {
          id: expense.id,
            category: expense.category || '',
            description: expense.description || expense.title || '',
            amount: Number(expense.amount) || 0,
            currencyCode: (expense.currency_code || 'USD') as CurrencyCode,
            exchangeRate: expense.exchange_rate ? Number(expense.exchange_rate) : undefined,
            baseAmountUSD: expense.base_amount_usd ? Number(expense.base_amount_usd) : undefined,
            transactionDate: expense.transaction_date || expense.date || undefined,
            date: expense.date || '',
            dueDate: expense.due_date || undefined,
            receipt: expense.receipt_file_name && expense.receipt_data_url ? {
              fileName: expense.receipt_file_name,
              dataUrl: expense.receipt_data_url
            } : undefined,
            status: normalizedStatus,
            budgetItemId: expense.budget_item_id || undefined,
            recurringSourceId: expense.recurring_source_id || undefined,
            createdById: expense.user_id || expense.created_by || undefined,
            createdByName: expense.created_by_name || undefined
          };
        }) || [];
      } catch (error) {
        console.error('❌ Erreur Supabase dépenses:', error);
        return [];
      }
    }
    return [];
  }

  static async createExpense(expense: Partial<Expense>): Promise<Expense | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createExpense(expense);
        if (error) throw error;
        
        if (!data) return null;

        // Normaliser le status
        let normalizedStatus: Expense['status'] = 'Unpaid';
        const status = data.status?.toLowerCase() || 'unpaid';
        if (status === 'paid') normalizedStatus = 'Paid';
        else normalizedStatus = 'Unpaid';

        return {
          id: data.id,
          category: data.category || '',
          description: data.description || data.title || '',
          amount: Number(data.amount) || 0,
          currencyCode: (data.currency_code || 'USD') as CurrencyCode,
          exchangeRate: data.exchange_rate ? Number(data.exchange_rate) : undefined,
          baseAmountUSD: data.base_amount_usd ? Number(data.base_amount_usd) : undefined,
          transactionDate: data.transaction_date || data.date || undefined,
          date: data.date || '',
          dueDate: data.due_date || undefined,
          receipt: data.receipt_file_name && data.receipt_data_url ? {
            fileName: data.receipt_file_name,
            dataUrl: data.receipt_data_url
          } : undefined,
          status: normalizedStatus,
          budgetItemId: data.budget_item_id || undefined,
          recurringSourceId: data.recurring_source_id || undefined,
          createdById: data.user_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase création dépense:', error);
        return null;
      }
    }
    return null;
  }

  static async updateExpense(id: string, updates: Partial<Expense>): Promise<Expense | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.updateExpense(id, updates);
        if (error) throw error;
        
        if (!data) return null;

        // Normaliser le status
        let normalizedStatus: Expense['status'] = 'Unpaid';
        const status = data.status?.toLowerCase() || 'unpaid';
        if (status === 'paid') normalizedStatus = 'Paid';
        else normalizedStatus = 'Unpaid';

        return {
          id: data.id,
          category: data.category || '',
          description: data.description || data.title || '',
          amount: Number(data.amount) || 0,
          currencyCode: (data.currency_code || 'USD') as CurrencyCode,
          exchangeRate: data.exchange_rate ? Number(data.exchange_rate) : undefined,
          baseAmountUSD: data.base_amount_usd ? Number(data.base_amount_usd) : undefined,
          transactionDate: data.transaction_date || data.date || undefined,
          date: data.date || '',
          dueDate: data.due_date || undefined,
          receipt: data.receipt_file_name && data.receipt_data_url ? {
            fileName: data.receipt_file_name,
            dataUrl: data.receipt_data_url
          } : undefined,
          status: normalizedStatus,
          budgetItemId: data.budget_item_id || undefined,
          recurringSourceId: data.recurring_source_id || undefined,
          createdById: data.user_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase mise à jour dépense:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteExpense(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteExpense(id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error('❌ Erreur Supabase suppression dépense:', error);
        return false;
      }
    }
    return false;
  }

  // ===== RECURRING INVOICES =====
  static async getRecurringInvoices(): Promise<RecurringInvoice[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getRecurringInvoices();
        if (error) throw error;
        return data?.map((item: any) => {
          // Normaliser la fréquence
          let normalizedFrequency: RecurrenceFrequency = 'Monthly';
          const freq = item.frequency?.toLowerCase() || 'monthly';
          if (freq === 'quarterly') normalizedFrequency = 'Quarterly';
          else if (freq === 'annually') normalizedFrequency = 'Annually';
          else normalizedFrequency = 'Monthly';

          return {
            id: item.id,
            clientName: item.client_name || '',
            amount: Number(item.amount) || 0,
            currencyCode: (item.currency_code || 'USD') as CurrencyCode,
            exchangeRate: item.exchange_rate ? Number(item.exchange_rate) : undefined,
            baseAmountUSD: item.base_amount_usd ? Number(item.base_amount_usd) : undefined,
            frequency: normalizedFrequency,
            startDate: item.start_date || '',
            endDate: item.end_date || undefined,
            lastGeneratedDate: item.last_generated_date || '',
            createdById: item.owner_id || item.created_by || undefined,
            createdByName: item.created_by_name || undefined
          };
        }) || [];
      } catch (error) {
        console.error('❌ Erreur Supabase factures récurrentes:', error);
        return [];
      }
    }
    return [];
  }

  static async createRecurringInvoice(recurringInvoice: Partial<RecurringInvoice>): Promise<RecurringInvoice | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createRecurringInvoice(recurringInvoice);
        if (error) throw error;
        
        if (!data) return null;

        // Normaliser la fréquence
        let normalizedFrequency: RecurrenceFrequency = 'Monthly';
        const freq = data.frequency?.toLowerCase() || 'monthly';
        if (freq === 'quarterly') normalizedFrequency = 'Quarterly';
        else if (freq === 'annually') normalizedFrequency = 'Annually';
        else normalizedFrequency = 'Monthly';

        return {
          id: data.id,
          clientName: data.client_name || '',
          amount: Number(data.amount) || 0,
          currencyCode: (data.currency_code || 'USD') as CurrencyCode,
          exchangeRate: data.exchange_rate ? Number(data.exchange_rate) : undefined,
          baseAmountUSD: data.base_amount_usd ? Number(data.base_amount_usd) : undefined,
          frequency: normalizedFrequency,
          startDate: data.start_date || '',
          endDate: data.end_date || undefined,
          lastGeneratedDate: data.last_generated_date || '',
          createdById: data.owner_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase création facture récurrente:', error);
        return null;
      }
    }
    return null;
  }

  static async updateRecurringInvoice(id: string, updates: Partial<RecurringInvoice>): Promise<RecurringInvoice | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.updateRecurringInvoice(id, updates);
        if (error) throw error;
        
        if (!data) return null;

        // Normaliser la fréquence
        let normalizedFrequency: RecurrenceFrequency = 'Monthly';
        const freq = data.frequency?.toLowerCase() || 'monthly';
        if (freq === 'quarterly') normalizedFrequency = 'Quarterly';
        else if (freq === 'annually') normalizedFrequency = 'Annually';
        else normalizedFrequency = 'Monthly';

        return {
          id: data.id,
          clientName: data.client_name || '',
          amount: Number(data.amount) || 0,
          currencyCode: (data.currency_code || 'USD') as CurrencyCode,
          exchangeRate: data.exchange_rate ? Number(data.exchange_rate) : undefined,
          baseAmountUSD: data.base_amount_usd ? Number(data.base_amount_usd) : undefined,
          frequency: normalizedFrequency,
          startDate: data.start_date || '',
          endDate: data.end_date || undefined,
          lastGeneratedDate: data.last_generated_date || '',
          createdById: data.owner_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase mise à jour facture récurrente:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteRecurringInvoice(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteRecurringInvoice(id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error('❌ Erreur Supabase suppression facture récurrente:', error);
        return false;
      }
    }
    return false;
  }

  // ===== RECURRING EXPENSES =====
  static async getRecurringExpenses(): Promise<RecurringExpense[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getRecurringExpenses();
        if (error) throw error;
        return data?.map((item: any) => {
          // Normaliser la fréquence
          let normalizedFrequency: RecurrenceFrequency = 'Monthly';
          const freq = item.frequency?.toLowerCase() || 'monthly';
          if (freq === 'quarterly') normalizedFrequency = 'Quarterly';
          else if (freq === 'annually') normalizedFrequency = 'Annually';
          else normalizedFrequency = 'Monthly';

          return {
            id: item.id,
            category: item.category || '',
            description: item.description || '',
            amount: Number(item.amount) || 0,
            currencyCode: (item.currency_code || 'USD') as CurrencyCode,
            exchangeRate: item.exchange_rate ? Number(item.exchange_rate) : undefined,
            baseAmountUSD: item.base_amount_usd ? Number(item.base_amount_usd) : undefined,
            frequency: normalizedFrequency,
            startDate: item.start_date || '',
            endDate: item.end_date || undefined,
            lastGeneratedDate: item.last_generated_date || '',
            createdById: item.owner_id || item.created_by || undefined,
            createdByName: item.created_by_name || undefined
          };
        }) || [];
      } catch (error) {
        console.error('❌ Erreur Supabase dépenses récurrentes:', error);
        return [];
      }
    }
    return [];
  }

  static async createRecurringExpense(recurringExpense: Partial<RecurringExpense>): Promise<RecurringExpense | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createRecurringExpense(recurringExpense);
        if (error) throw error;
        
        if (!data) return null;

        // Normaliser la fréquence
        let normalizedFrequency: RecurrenceFrequency = 'Monthly';
        const freq = data.frequency?.toLowerCase() || 'monthly';
        if (freq === 'quarterly') normalizedFrequency = 'Quarterly';
        else if (freq === 'annually') normalizedFrequency = 'Annually';
        else normalizedFrequency = 'Monthly';

        return {
          id: data.id,
          category: data.category || '',
          description: data.description || '',
          amount: Number(data.amount) || 0,
          currencyCode: (data.currency_code || 'USD') as CurrencyCode,
          exchangeRate: data.exchange_rate ? Number(data.exchange_rate) : undefined,
          baseAmountUSD: data.base_amount_usd ? Number(data.base_amount_usd) : undefined,
          frequency: normalizedFrequency,
          startDate: data.start_date || '',
          endDate: data.end_date || undefined,
          lastGeneratedDate: data.last_generated_date || '',
          createdById: data.owner_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase création dépense récurrente:', error);
        return null;
      }
    }
    return null;
  }

  static async updateRecurringExpense(id: string, updates: Partial<RecurringExpense>): Promise<RecurringExpense | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.updateRecurringExpense(id, updates);
        if (error) throw error;
        
        if (!data) return null;

        // Normaliser la fréquence
        let normalizedFrequency: RecurrenceFrequency = 'Monthly';
        const freq = data.frequency?.toLowerCase() || 'monthly';
        if (freq === 'quarterly') normalizedFrequency = 'Quarterly';
        else if (freq === 'annually') normalizedFrequency = 'Annually';
        else normalizedFrequency = 'Monthly';

        return {
          id: data.id,
          category: data.category || '',
          description: data.description || '',
          amount: Number(data.amount) || 0,
          currencyCode: (data.currency_code || 'USD') as CurrencyCode,
          exchangeRate: data.exchange_rate ? Number(data.exchange_rate) : undefined,
          baseAmountUSD: data.base_amount_usd ? Number(data.base_amount_usd) : undefined,
          frequency: normalizedFrequency,
          startDate: data.start_date || '',
          endDate: data.end_date || undefined,
          lastGeneratedDate: data.last_generated_date || '',
          createdById: data.owner_id || data.created_by || undefined,
          createdByName: data.created_by_name || undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase mise à jour dépense récurrente:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteRecurringExpense(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteRecurringExpense(id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error('❌ Erreur Supabase suppression dépense récurrente:', error);
        return false;
      }
    }
    return false;
  }

  // ===== BUDGETS =====
  static async getBudgets(): Promise<Budget[]> {
    if (this.useSupabase) {
      try {
        const budgetsResult = await DataService.getBudgets();
        if (budgetsResult.error) throw budgetsResult.error;

        const budgets = budgetsResult.data || [];
        
        // Pour chaque budget, récupérer les budget_lines et budget_items
        const budgetsWithLines = await Promise.all(
          budgets.map(async (budget: any) => {
            let lines: any[] = [];
            try {
              const linesResult = await DataService.getBudgetLines(budget.id);
              lines = linesResult.data || [];
            } catch (error: any) {
              // Si l'erreur est 400 (format UUID ou filtre), ignorer silencieusement
              if (error?.message?.includes('400') || error?.status === 400) {
                console.warn(`⚠️ Impossible de récupérer les lignes de budget ${budget.id}:`, error.message);
              } else {
                console.error(`❌ Erreur récupération budget_lines pour ${budget.id}:`, error);
              }
              lines = [];
            }

            // Pour chaque ligne, récupérer les items
            const linesWithItems = await Promise.all(
              lines.map(async (line: any) => {
                let items: any[] = [];
                try {
                  const itemsResult = await DataService.getBudgetItems(line.id);
                  items = itemsResult.data || [];
                } catch (error: any) {
                  // Si l'erreur est 400, ignorer silencieusement
                  if (error?.message?.includes('400') || error?.status === 400) {
                    console.warn(`⚠️ Impossible de récupérer les items de ligne ${line.id}:`, error.message);
                  } else {
                    console.error(`❌ Erreur récupération budget_items pour ${line.id}:`, error);
                  }
                  items = [];
                }

                return {
                  id: line.id,
                  title: line.title || '',
                  items: items.map((item: any) => ({
                    id: item.id,
                    description: item.description || '',
                    amount: Number(item.amount) || 0
                  }))
                };
              })
            );

            // Normaliser le type
            let normalizedType: 'Project' | 'Office' = 'Project';
            const type = budget.type?.toLowerCase() || 'project';
            if (type === 'office') normalizedType = 'Office';
            else normalizedType = 'Project';

            return {
              id: budget.id,
              title: budget.title || '',
              type: normalizedType,
              amount: Number(budget.amount) || 0,
              currencyCode: (budget.currency_code || 'USD') as CurrencyCode,
              exchangeRate: budget.exchange_rate ? Number(budget.exchange_rate) : undefined,
              baseAmountUSD: budget.base_amount_usd ? Number(budget.base_amount_usd) : undefined,
              startDate: budget.start_date || '',
              endDate: budget.end_date || '',
              projectId: budget.project_id || undefined,
              budgetLines: linesWithItems,
              createdById: budget.owner_id || undefined,
              createdByName: budget.created_by_name || undefined
            };
          })
        );

        return budgetsWithLines;
      } catch (error) {
        console.error('❌ Erreur Supabase budgets:', error);
        return [];
      }
    }
    return [];
  }

  static async createBudget(budget: Partial<Budget>): Promise<Budget | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createBudget(budget);
        if (error) throw error;
        
        if (!data) return null;

        // Recharger le budget complet avec ses lignes et items
        const fullBudget = await this.getBudgets();
        return fullBudget.find(b => b.id === data.id) || null;
      } catch (error) {
        console.error('❌ Erreur Supabase création budget:', error);
        return null;
      }
    }
    return null;
  }

  static async updateBudget(id: string, updates: Partial<Budget>): Promise<Budget | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.updateBudget(id, updates);
        if (error) throw error;
        
        if (!data) return null;

        // Recharger le budget complet avec ses lignes et items
        const fullBudget = await this.getBudgets();
        return fullBudget.find(b => b.id === id) || null;
      } catch (error) {
        console.error('❌ Erreur Supabase mise à jour budget:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteBudget(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteBudget(id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error('❌ Erreur Supabase suppression budget:', error);
        return false;
      }
    }
    return false;
  }

  // ===== CONTACTS =====
  static async getContacts(): Promise<Contact[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getContacts();
        if (error) throw error;
        return data?.map((contact: any, index: number) => this.mapContactFromDb(contact, index)) || [];
      } catch (error) {
        console.warn('Erreur Supabase contacts:', error);
        return [];
      }
    }
    return [];
  }

  static async createContact(contact: Partial<Contact>): Promise<Contact | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createContact(contact);
        if (error) throw error;
        return data ? this.mapContactFromDb(data) : null;
      } catch (error) {
        console.warn('Erreur Supabase création contact:', error);
        return null;
      }
    }
    return null;
  }

  static async updateContact(id: string | number, updates: Contact): Promise<Contact | null> {
    if (this.useSupabase) {
      try {
        const sid = String(id);
        const { data, error } = await DataService.updateContact(sid, updates);
        if (error) throw error;
        return data ? this.mapContactFromDb(data) : null;
      } catch (error) {
        console.warn('Erreur Supabase mise à jour contact:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteContact(id: string | number): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteContact(String(id));
        if (error) throw error;
        return true;
      } catch (error) {
        console.warn('Erreur Supabase suppression contact:', error);
        return false;
      }
    }
    return false;
  }

  // ===== COURSES =====
  static async getCourses(): Promise<Course[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getCourses();
        if (error) throw error;

        const courseRows = data || [];
        const courseIds = courseRows.map((c: any) => String(c.id)).filter(Boolean);
        const { data: flatModules, error: modulesError } =
          await DataService.getCourseModulesForCourseIds(courseIds);
        if (modulesError) throw modulesError;

        const grouped = new Map<string, any[]>();
        for (const row of flatModules || []) {
          const cid = String((row as any).course_id);
          if (!grouped.has(cid)) grouped.set(cid, []);
          grouped.get(cid)!.push(row);
        }
        for (const list of grouped.values()) {
          list.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
        }

        const courses = courseRows.map((course: any) => {
          const rawMods = grouped.get(String(course.id)) || [];
          const modules = DataAdapter.mapCourseModulesFromSupabaseRows(rawMods);

          return {
            id: course.id,
            title: course.title || '',
            description: course.description || '',
            instructor: course.instructor || '',
            instructorId: course.instructor_id || null,
            duration: course.duration ? `${Math.ceil(course.duration / 40)} Weeks` : '0 Weeks',
            level: course.level || 'beginner',
            category: course.category || '',
            price: course.price || 0,
            status: course.status || 'draft',
            thumbnailUrl: course.thumbnail_url || undefined,
            rating: course.rating || 0,
            studentsCount: course.students_count || 0,
            lessonsCount: course.lessons_count || 0,
            createdAt: course.created_at ? new Date(course.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
            updatedAt: course.updated_at ? new Date(course.updated_at).toISOString().split('T')[0] : undefined,
            targetStudents: course.target_students || null,
            youtubeUrl: course.youtube_url || null,
            driveUrl: course.drive_url || null,
            otherLinks: course.other_links || null,
            requiresFinalValidation: course.requires_final_validation ?? false,
            sequentialModules: course.sequential_modules ?? false,
            courseMaterials: course.course_materials || [],
            programmeId: course.programme_id ?? null,
            audienceSegment: (course.audience_segment as CourseAudienceSegment | null) ?? null,
            ...DataAdapter.courseWorkflowFieldsFromRow(course),
            icon: course.category === 'Marketing' ? 'fas fa-bullhorn' :
                  course.category === 'Business' ? 'fas fa-briefcase' :
                  course.category === 'Technology' ? 'fas fa-laptop-code' :
                  'fas fa-book',
            progress: 0,
            modules,
          };
        });

        return courses;
      } catch (error) {
        console.error('❌ Erreur Supabase cours:', error);
        return [];
      }
    }
    return [];
  }

  static async createCourse(course: Partial<Course>): Promise<Course | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createCourse(course);
        if (error) throw error;
        
        if (!data) return null;

        const modulesResponse = await DataService.getCourseModules(data.id);
        const modules = (modulesResponse.data || []).map((module: any) => ({
          id: module.id,
          title: module.title || 'Module',
          lessons: (module.lessons || []).map((lesson: any) => ({
            id: lesson.id || `lesson-${lesson.order_index}`,
            title: lesson.title || 'Leçon',
            type: lesson.type || 'video',
            duration: lesson.duration || '0 min',
            icon: lesson.icon || 'fas fa-play-circle',
            description: lesson.description || '',
            contentUrl: lesson.content_url || undefined,
            attachments: lesson.attachments || [],
            externalLinks: lesson.external_links || [],
            quizQuestions: Array.isArray(lesson.quiz?.questions) ? lesson.quiz.questions : [],
          })),
          evidenceDocuments: module.evidence_documents || [],
          requiresValidation: module.requires_validation ?? false,
          unlocksNextModule: module.unlocks_next_module ?? false
        }));

        return {
          id: data.id,
          title: data.title || '',
          description: data.description || '',
          instructor: data.instructor || '',
          instructorId: data.instructor_id || null,
          duration: data.duration ? `${Math.ceil(data.duration / 40)} Weeks` : '0 Weeks',
          level: data.level || 'beginner',
          category: data.category || '',
          price: data.price || 0,
          status: data.status || 'draft',
          thumbnailUrl: data.thumbnail_url || undefined,
          rating: data.rating || 0,
          studentsCount: data.students_count || 0,
          lessonsCount: data.lessons_count || 0,
          createdAt: data.created_at ? new Date(data.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          updatedAt: data.updated_at ? new Date(data.updated_at).toISOString().split('T')[0] : undefined,
          targetStudents: data.target_students || null,
          youtubeUrl: data.youtube_url || null,
          driveUrl: data.drive_url || null,
          otherLinks: data.other_links || null,
          requiresFinalValidation: data.requires_final_validation ?? false,
          sequentialModules: data.sequential_modules ?? false,
          courseMaterials: data.course_materials || [],
          programmeId: data.programme_id ?? null,
          audienceSegment: (data.audience_segment as CourseAudienceSegment | null) ?? null,
          ...DataAdapter.courseWorkflowFieldsFromRow(data),
          icon: 'fas fa-book',
          progress: 0,
          modules
        };
      } catch (error) {
        console.error('❌ Erreur Supabase création cours:', error);
        return null;
      }
    }
    return null;
  }

  static async updateCourse(id: string, updates: Partial<Course>): Promise<Course | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.updateCourse(id, updates);
        if (error) throw error;
        
        if (!data) return null;

        const modulesResponse = await DataService.getCourseModules(data.id);
        const modules = (modulesResponse.data || []).map((module: any) => ({
          id: module.id,
          title: module.title || 'Module',
          lessons: (module.lessons || []).map((lesson: any) => ({
            id: lesson.id || `lesson-${lesson.order_index}`,
            title: lesson.title || 'Leçon',
            type: lesson.type || 'video',
            duration: lesson.duration || '0 min',
            icon: lesson.icon || 'fas fa-play-circle',
            description: lesson.description || '',
            contentUrl: lesson.content_url || undefined,
            attachments: lesson.attachments || [],
            externalLinks: lesson.external_links || [],
            quizQuestions: Array.isArray(lesson.quiz?.questions) ? lesson.quiz.questions : [],
          })),
          evidenceDocuments: module.evidence_documents || [],
          requiresValidation: module.requires_validation ?? false,
          unlocksNextModule: module.unlocks_next_module ?? false
        }));

        return {
          id: data.id,
          title: data.title || '',
          description: data.description || '',
          instructor: data.instructor || '',
          instructorId: data.instructor_id || updates.instructorId || null,
          duration: data.duration ? `${Math.ceil(data.duration / 40)} Weeks` : '0 Weeks',
          level: data.level || 'beginner',
          category: data.category || '',
          price: data.price || 0,
          status: data.status || 'draft',
          thumbnailUrl: data.thumbnail_url || undefined,
          rating: data.rating || 0,
          studentsCount: data.students_count || 0,
          lessonsCount: data.lessons_count || 0,
          createdAt: data.created_at ? new Date(data.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          updatedAt: data.updated_at ? new Date(data.updated_at).toISOString().split('T')[0] : undefined,
          targetStudents: data.target_students || null,
          youtubeUrl: data.youtube_url || null,
          driveUrl: data.drive_url || null,
          otherLinks: data.other_links || null,
          requiresFinalValidation: data.requires_final_validation ?? false,
          sequentialModules: data.sequential_modules ?? false,
          courseMaterials: data.course_materials || [],
          programmeId: data.programme_id ?? null,
          audienceSegment: (data.audience_segment as CourseAudienceSegment | null) ?? null,
          ...DataAdapter.courseWorkflowFieldsFromRow(data),
          icon: 'fas fa-book',
          progress: 0,
          modules
        };
      } catch (error) {
        console.error('❌ Erreur Supabase mise à jour cours:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteCourse(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteCourse(id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error('❌ Erreur Supabase suppression cours:', error);
        return false;
      }
    }
    return false;
  }

  private static mapCourseSessionFromDb(row: Record<string, unknown>): CourseSession {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      courseId: String(row.course_id),
      title: (row.title as string) || '',
      startsAt: (row.starts_at as string) ?? null,
      endsAt: (row.ends_at as string) ?? null,
      capacity: row.capacity != null ? Number(row.capacity) : null,
      status: (row.status as CourseSessionStatus) || 'planned',
      programmeId: row.programme_id != null ? String(row.programme_id) : null,
      projectId: row.project_id != null ? String(row.project_id) : null,
      programmeActionId: row.programme_action_id != null ? String(row.programme_action_id) : null,
      createdAt: row.created_at as string | undefined,
      updatedAt: row.updated_at as string | undefined,
    };
  }

  private static mapCourseSessionEnrollmentFromDb(row: Record<string, unknown>): CourseSessionEnrollment {
    return {
      id: String(row.id),
      organizationId: String(row.organization_id),
      courseSessionId: String(row.course_session_id),
      userId: String(row.user_id),
      status: (row.status as string) || 'enrolled',
      cohortRole: (row.cohort_role as CohortParticipantRole) || 'learner',
      createdAt: row.created_at as string | undefined,
    };
  }

  static async listCourseSessionsForCourse(courseId: string): Promise<CourseSession[]> {
    if (!this.useSupabase) return [];
    try {
      const { data, error } = await DataService.listCourseSessionsByCourseId(courseId);
      if (error) throw error;
      return (data || []).map((r: Record<string, unknown>) => DataAdapter.mapCourseSessionFromDb(r));
    } catch {
      return [];
    }
  }

  static async listCourseSessionEnrollmentsForSession(courseSessionId: string): Promise<CourseSessionEnrollment[]> {
    if (!this.useSupabase) return [];
    try {
      const { data, error } = await DataService.listCourseSessionEnrollments(courseSessionId);
      if (error) throw error;
      return (data || []).map((r: Record<string, unknown>) => DataAdapter.mapCourseSessionEnrollmentFromDb(r));
    } catch {
      return [];
    }
  }

  static async createCourseSessionForCourse(params: {
    organizationId: string;
    courseId: string;
    title: string;
    startsAt?: string | null;
    endsAt?: string | null;
    capacity?: number | null;
    status?: CourseSessionStatus;
    programmeId?: string | null;
    projectId?: string | null;
    programmeActionId?: string | null;
  }): Promise<CourseSession | null> {
    if (!this.useSupabase) return null;
    const { data, error } = await DataService.insertCourseSession({
      organizationId: params.organizationId,
      courseId: params.courseId,
      title: params.title,
      startsAt: params.startsAt,
      endsAt: params.endsAt,
      capacity: params.capacity,
      status: params.status,
      programmeId: params.programmeId,
      projectId: params.projectId,
      programmeActionId: params.programmeActionId,
    });
    if (error || !data) return null;
    return DataAdapter.mapCourseSessionFromDb(data as Record<string, unknown>);
  }

  static async updateCourseSessionById(
    id: string,
    updates: Partial<
      Pick<
        CourseSession,
        | 'title'
        | 'startsAt'
        | 'endsAt'
        | 'capacity'
        | 'status'
        | 'programmeId'
        | 'projectId'
        | 'programmeActionId'
      >
    >,
  ): Promise<CourseSession | null> {
    if (!this.useSupabase) return null;
    const { data, error } = await DataService.updateCourseSession(id, {
      title: updates.title,
      startsAt: updates.startsAt,
      endsAt: updates.endsAt,
      capacity: updates.capacity,
      status: updates.status,
      programmeId: updates.programmeId,
      projectId: updates.projectId,
      programmeActionId: updates.programmeActionId,
    });
    if (error || !data) return null;
    return DataAdapter.mapCourseSessionFromDb(data as Record<string, unknown>);
  }

  static async deleteCourseSessionById(id: string): Promise<boolean> {
    if (!this.useSupabase) return false;
    const { error } = await DataService.deleteCourseSession(id);
    return !error;
  }

  /** Nombre d’inscriptions cohorte pour un cours (toutes sessions). */
  static async countCourseSessionEnrollmentsForCourse(courseId: string): Promise<number> {
    if (!this.useSupabase) return 0;
    try {
      const { count, error } = await DataService.countCourseSessionEnrollmentsByCourseId(courseId);
      if (error) throw error;
      return count ?? 0;
    } catch {
      return 0;
    }
  }

  // ===== OBJECTIVES =====
  static async getObjectives(): Promise<Objective[]> {
    if (this.useSupabase) {
      try {
        vlog('🔍 DataAdapter.getObjectives - Appel DataService.getObjectives()');
        const { data, error } = await DataService.getObjectives();
        
        if (error) {
          console.error('❌ Erreur DataService.getObjectives:', error);
          return []; // Retourner tableau vide au lieu de throw
        }
        
        vlog('📊 Données brutes Supabase objectives:', data?.length || 0, 'objectifs');
        
        const objectives =
          (data || []).map((objective: any) => ({
          id: objective.id,
          title: objective.title,
          description: objective.description,
          quarter: objective.quarter,
          year: objective.year,
          ownerId: objective.owner_id != null ? String(objective.owner_id) : undefined,
          status: objective.status || 'active',
          progress: Number(objective.progress ?? 0) * 100, // Convertir en pourcentage (0-100)
          priority: objective.priority || 'Medium',
          startDate: objective.start_date,
          endDate: objective.end_date,
          category: objective.category,
          ownerName: objective.owner_name,
          teamMembers: objective.team_members || [],
          keyResults: objective.key_results || [], // Mapper les key_results JSONB
          createdAt: objective.created_at || new Date().toISOString(),
          updatedAt: objective.updated_at || new Date().toISOString(),
          entityType: (objective.entity_type as Objective['entityType']) || undefined,
          entityId: objective.entity_id != null ? String(objective.entity_id) : undefined,
          // project_id explicite ; sinon entity_id seulement si l’objectif est rattaché à un projet (évite de confondre avec entity user)
          projectId:
            objective.project_id ||
            (!objective.entity_type || String(objective.entity_type) === 'project'
              ? objective.entity_id != null
                ? String(objective.entity_id)
                : ''
              : ''),
        })) || [];
        
        vlog('✅ DataAdapter.getObjectives - Objectifs convertis:', objectives.length);
        return objectives;
      } catch (error) {
        console.error('❌ Erreur Supabase objectifs:', error);
        return [];
      }
    }
    return [];
  }

  static async createObjective(objective: Omit<Objective, 'id'>): Promise<Objective | null> {
    if (this.useSupabase) {
      try {
        vlog('🔄 DataAdapter.createObjective - Création objectif:', objective.title);
        
        // Calculer la progression automatiquement
        const calculateProgress = (keyResults: KeyResult[]): number => {
          if (keyResults.length === 0) return 0;
          const totalProgress = keyResults.reduce((sum, kr) => {
            if (kr.target === 0) return sum;
            return sum + Math.min((kr.current / kr.target), 1);
          }, 0);
          return Math.min((totalProgress / keyResults.length) * 100, 100);
        };

        const progress = calculateProgress(objective.keyResults || []);
        
        const objectiveData = {
          title: objective.title,
          description: objective.description,
          quarter: objective.quarter,
          year: objective.year,
          ownerId: objective.ownerId,
          status: objective.status || 'active',
          progress: progress / 100, // Convertir en décimal pour Supabase (0-1)
          priority: objective.priority || 'Medium',
          startDate: objective.startDate,
          endDate: objective.endDate,
          category: objective.category,
          ownerName: objective.ownerName,
          teamMembers: objective.teamMembers || [],
          keyResults: objective.keyResults || [],
          projectId: objective.projectId
        };
        
        const { data, error } = await DataService.createObjective(objectiveData);
        
        if (error) {
          console.error('❌ Erreur création objectif:', error);
          throw error;
        }
        
        vlog('✅ DataAdapter.createObjective - Objectif créé:', data?.id);
        
        // Convertir la réponse Supabase vers le format app
        return {
          id: data.id,
          title: data.title,
          description: data.description,
          quarter: data.quarter,
          year: data.year,
          ownerId: data.owner_id,
          status: data.status || 'active',
          progress: (data.progress || 0) * 100, // Convertir en pourcentage (0-100)
          priority: data.priority || 'Medium',
          startDate: data.start_date,
          endDate: data.end_date,
          category: data.category,
          ownerName: data.owner_name,
          teamMembers: data.team_members || [],
          keyResults: data.key_results || [],
          createdAt: data.created_at || new Date().toISOString(),
          updatedAt: data.updated_at || new Date().toISOString(),
          projectId: objective.projectId
        };
      } catch (error) {
        console.error('❌ Erreur DataAdapter.createObjective:', error);
        throw error;
      }
    }
    return null;
  }

  static async updateObjective(id: string, updates: Partial<Objective>): Promise<Objective | null> {
    if (this.useSupabase) {
      try {
        vlog('🔄 DataAdapter.updateObjective - Mise à jour objectif ID:', id);
        
        // Calculer la progression automatiquement si les keyResults sont mis à jour
        let progress = updates.progress;
        if (updates.keyResults && updates.keyResults.length > 0) {
          const calculateProgress = (keyResults: KeyResult[]): number => {
            if (keyResults.length === 0) return 0;
            const totalProgress = keyResults.reduce((sum, kr) => {
              if (kr.target === 0) return sum;
              return sum + Math.min((kr.current / kr.target), 1);
            }, 0);
            return Math.min((totalProgress / keyResults.length) * 100, 100);
          };
          progress = calculateProgress(updates.keyResults);
        }
        
        const updateData = {
          ...updates,
          progress: progress !== undefined ? progress / 100 : updates.progress // Convertir en décimal pour Supabase (0-1)
        };
        
        const { data, error } = await DataService.updateObjective(id, updateData);
        
        if (error) {
          console.error('❌ Erreur mise à jour objectif:', error);
          throw error;
        }
        
        vlog('✅ DataAdapter.updateObjective - Objectif mis à jour:', id);
        
        // Convertir la réponse Supabase vers le format app
        return {
          id: data.id,
          title: data.title,
          description: data.description,
          quarter: data.quarter,
          year: data.year,
          ownerId: data.owner_id,
          status: data.status || 'active',
          progress: (data.progress || 0) * 100, // Convertir en pourcentage (0-100)
          priority: data.priority || 'Medium',
          startDate: data.start_date,
          endDate: data.end_date,
          category: data.category,
          ownerName: data.owner_name,
          teamMembers: data.team_members || [],
          keyResults: data.key_results || [],
          createdAt: data.created_at || new Date().toISOString(),
          updatedAt: data.updated_at || new Date().toISOString(),
          projectId: updates.projectId || "1"
        };
      } catch (error) {
        console.error('❌ Erreur DataAdapter.updateObjective:', error);
        throw error;
      }
    }
    return null;
  }

  static async deleteObjective(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        vlog('🔄 DataAdapter.deleteObjective - Suppression objectif ID:', id);
        
        const { error } = await DataService.deleteObjective(id);
        
        if (error) {
          console.error('❌ Erreur suppression objectif:', error);
          throw error;
        }
        
        vlog('✅ DataAdapter.deleteObjective - Objectif supprimé:', id);
        return true;
      } catch (error) {
        console.error('❌ Erreur DataAdapter.deleteObjective:', error);
        throw error;
      }
    }
    return false;
  }

  // ===== DOCUMENTS (KNOWLEDGE BASE) =====
  static async getDocuments(): Promise<Document[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getDocuments();
        if (error) throw error;
        
        return data?.map((doc: any) => ({
          id: doc.id,
          title: doc.title || '',
          content: doc.content || '',
          description: doc.description || undefined,
          createdAt: doc.created_at ? new Date(doc.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          createdBy: doc.created_by_name || 'Unknown',
          createdById: doc.created_by_id || undefined,
          updatedAt: doc.updated_at ? new Date(doc.updated_at).toISOString().split('T')[0] : undefined,
          tags: Array.isArray(doc.tags) ? doc.tags : undefined,
          category: doc.category || undefined,
          isPublic: doc.is_public ?? false,
          viewCount: doc.view_count || 0,
          lastViewedAt: doc.last_viewed_at ? new Date(doc.last_viewed_at).toISOString() : undefined,
          version: doc.version || 1,
          isFavorite: doc.is_favorite || false,
          thumbnailUrl: doc.thumbnail_url || undefined,
          attachments: Array.isArray(doc.attachments) ? doc.attachments : undefined
        })) || [];
      } catch (error) {
        console.error('❌ Erreur Supabase documents:', error);
        return [];
      }
    }
    return [];
  }

  static async getDocumentById(id: string): Promise<Document | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getDocumentById(id);
        if (error) throw error;
        if (!data) return null;
        const doc = data as any;
        return {
          id: doc.id,
          title: doc.title || '',
          content: doc.content || '',
          description: doc.description || undefined,
          createdAt: doc.created_at ? new Date(doc.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          createdBy: doc.created_by_name || 'Unknown',
          createdById: doc.created_by_id || undefined,
          updatedAt: doc.updated_at ? new Date(doc.updated_at).toISOString().split('T')[0] : undefined,
          tags: Array.isArray(doc.tags) ? doc.tags : undefined,
          category: doc.category || undefined,
          isPublic: doc.is_public ?? false,
          viewCount: doc.view_count || 0,
          lastViewedAt: doc.last_viewed_at ? new Date(doc.last_viewed_at).toISOString() : undefined,
          version: doc.version || 1,
          thumbnailUrl: doc.thumbnail_url || undefined,
          attachments: Array.isArray(doc.attachments) ? doc.attachments : undefined,
        };
      } catch (error) {
        console.error('❌ Erreur Supabase document par id:', error);
        return null;
      }
    }
    return null;
  }

  static async createDocument(document: Partial<Document>): Promise<Document | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.createDocument(document);
        if (error) throw error;
        
        if (!data) return null;

        return {
          id: data.id,
          title: data.title || '',
          content: data.content || '',
          description: data.description || undefined,
          createdAt: data.created_at ? new Date(data.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          createdBy: data.created_by_name || 'Unknown',
          createdById: data.created_by_id || undefined,
          updatedAt: data.updated_at ? new Date(data.updated_at).toISOString().split('T')[0] : undefined,
          tags: Array.isArray(data.tags) ? data.tags : undefined,
          category: data.category || undefined,
          isPublic: data.is_public ?? false,
          viewCount: data.view_count || 0,
          lastViewedAt: data.last_viewed_at ? new Date(data.last_viewed_at).toISOString() : undefined,
          version: data.version || 1,
          isFavorite: data.is_favorite || false,
          thumbnailUrl: data.thumbnail_url || undefined,
          attachments: Array.isArray(data.attachments) ? data.attachments : undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase création document:', error);
        return null;
      }
    }
    return null;
  }

  static async updateDocument(id: string, updates: Partial<Document>): Promise<Document | null> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.updateDocument(id, updates);
        if (error) throw error;
        
        if (!data) return null;

        return {
          id: data.id,
          title: data.title || '',
          content: data.content || '',
          description: data.description || undefined,
          createdAt: data.created_at ? new Date(data.created_at).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          createdBy: data.created_by_name || 'Unknown',
          createdById: data.created_by_id || undefined,
          updatedAt: data.updated_at ? new Date(data.updated_at).toISOString().split('T')[0] : undefined,
          tags: Array.isArray(data.tags) ? data.tags : undefined,
          category: data.category || undefined,
          isPublic: data.is_public ?? false,
          viewCount: data.view_count || 0,
          lastViewedAt: data.last_viewed_at ? new Date(data.last_viewed_at).toISOString() : undefined,
          version: data.version || 1,
          isFavorite: data.is_favorite || false,
          thumbnailUrl: data.thumbnail_url || undefined,
          attachments: Array.isArray(data.attachments) ? data.attachments : undefined
        };
      } catch (error) {
        console.error('❌ Erreur Supabase mise à jour document:', error);
        return null;
      }
    }
    return null;
  }

  static async deleteDocument(id: string): Promise<boolean> {
    if (this.useSupabase) {
      try {
        const { error } = await DataService.deleteDocument(id);
        if (error) throw error;
        return true;
      } catch (error) {
        console.error('❌ Erreur Supabase suppression document:', error);
        return false;
      }
    }
    return false;
  }

  // ===== TIME LOGS =====
  static async getTimeLogs(): Promise<TimeLog[]> {
    vlog('🔍 DataAdapter.getTimeLogs - Appel DataService.getTimeLogs()');
      try {
        const { data, error } = await DataService.getTimeLogs();
        if (error) throw error;
      
      vlog('📊 Données brutes Supabase time_logs:', data?.length || 0, 'logs');
      
      const timeLogs: TimeLog[] = (data || []).map((log: any) => ({
        id: log.id || '', // UUID string
        userId: log.user_id || '', // UUID string (profile.id)
        entityType: (log.entity_type || 'project') as 'project' | 'course' | 'task',
        entityId: log.entity_id || log.project_id || log.course_id || '',
        entityTitle: log.entity_title || '',
        date: log.date || new Date().toISOString().split('T')[0],
        duration: log.duration || (log.hours ? log.hours * 60 : 0), // Convertir heures en minutes
        description: log.description || ''
      }));
      
      vlog('✅ DataAdapter.getTimeLogs - Logs convertis:', timeLogs.length);
      return timeLogs;
      } catch (error) {
      console.error('❌ Erreur DataAdapter.getTimeLogs:', error);
      return [];
    }
  }

  // ===== PRESENCE SESSIONS (Phase 4 Bloc 1) =====
  static async getPresenceSessions(params?: { userId?: string; organizationId?: string; from?: string; to?: string }): Promise<PresenceSession[]> {
    try {
      const { data, error } = await DataService.getPresenceSessions(params);
      if (error) throw error;
      return data || [];
    } catch (e) {
      if (handleOptionalTableError(e, 'presence_sessions', 'DataAdapter.getPresenceSessions')) {
        return [];
      }
      console.error('❌ DataAdapter.getPresenceSessions:', e);
      return [];
    }
  }

  static async getCurrentPresenceSession(userId: string): Promise<PresenceSession | null> {
    try {
      const { data, error } = await DataService.getCurrentPresenceSession(userId);
      if (error) throw error;
      return data ?? null;
    } catch (e) {
      console.error('❌ DataAdapter.getCurrentPresenceSession:', e);
      return null;
    }
  }

  static async createPresenceSession(session: Partial<PresenceSession>): Promise<PresenceSession | null> {
    try {
      const { data, error } = await DataService.createPresenceSession(session);
      if (error) throw error;
      return data ?? null;
    } catch (e) {
      console.error('❌ DataAdapter.createPresenceSession:', e);
      return null;
    }
  }

  static async updatePresenceSession(id: string, updates: Partial<PresenceSession>): Promise<PresenceSession | null> {
    try {
      const { data, error } = await DataService.updatePresenceSession(id, updates);
      if (error) throw error;
      return data ?? null;
    } catch (e) {
      console.error('❌ DataAdapter.updatePresenceSession:', e);
      return null;
    }
  }

  static async listPresenceStatusEvents(params: {
    organizationId?: string;
    userId?: string;
    sessionId?: string;
    from?: string;
    to?: string;
    defaultRecentWindow?: boolean;
  }): Promise<PresenceStatusEvent[]> {
    try {
      const { data, error } = await DataService.listPresenceStatusEvents(params);
      if (error) throw error;
      return data || [];
    } catch (e) {
      if (handleOptionalTableError(e, 'presence_status_events', 'DataAdapter.listPresenceStatusEvents')) {
        return [];
      }
      console.error('❌ DataAdapter.listPresenceStatusEvents:', e);
      return [];
    }
  }

  static async listEmployees(organizationId?: string | null): Promise<Employee[]> {
    try {
      return await DataService.listEmployees(organizationId);
    } catch (e) {
      console.error('❌ DataAdapter.listEmployees:', e);
      return [];
    }
  }

  static async getEmployeeByProfileId(profileId: string): Promise<Employee | null> {
    try {
      const { data, error } = await DataService.getEmployeeByProfileId(profileId);
      if (error) throw error;
      return data ?? null;
    } catch (e) {
      if (handleOptionalTableError(e, 'employees', 'DataAdapter.getEmployeeByProfileId')) {
        return null;
      }
      console.error('❌ DataAdapter.getEmployeeByProfileId:', e);
      return null;
    }
  }

  static async upsertEmployee(employee: Partial<Employee>): Promise<{ data: Employee | null; error: string | null }> {
    try {
      const { data, error } = await DataService.upsertEmployee(employee);
      if (error) {
        const msg =
          typeof (error as any)?.message === 'string'
            ? (error as any).message
            : typeof error === 'string'
              ? error
              : 'Erreur enregistrement salarié';
        console.error('❌ DataAdapter.upsertEmployee:', error);
        return { data: null, error: msg };
      }
      return { data: data ?? null, error: null };
    } catch (e: any) {
      console.error('❌ DataAdapter.upsertEmployee:', e);
      return { data: null, error: typeof e?.message === 'string' ? e.message : 'Erreur enregistrement salarié' };
    }
  }

  static async uploadEmployeeHrFile(params: {
    organizationId: string;
    employeeProfileId: string;
    file: File;
    subfolder: 'photo' | 'cv' | 'documents';
  }): Promise<{ publicUrl: string | null; error: string | null }> {
    try {
      const { publicUrl, error } = await DataService.uploadEmployeeHrFile(params);
      if (error) {
        const msg = typeof (error as any)?.message === 'string' ? (error as any).message : String(error);
        return { publicUrl: null, error: msg };
      }
      return { publicUrl, error: null };
    } catch (e: any) {
      return { publicUrl: null, error: typeof e?.message === 'string' ? e.message : 'Upload impossible' };
    }
  }

  static async getHrAttendancePolicy(organizationId?: string | null): Promise<HrAttendancePolicy | null> {
    try {
      const { data, error } = await DataService.getHrAttendancePolicy(organizationId);
      if (error) throw error;
      return data ?? null;
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_attendance_policies', 'DataAdapter.getHrAttendancePolicy')) {
        return null;
      }
      console.error('❌ DataAdapter.getHrAttendancePolicy:', e);
      return null;
    }
  }

  static async upsertHrAttendancePolicy(policy: Partial<HrAttendancePolicy>): Promise<HrAttendancePolicy | null> {
    try {
      const { data, error } = await DataService.upsertHrAttendancePolicy(policy);
      if (error) throw error;
      return data ?? null;
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_attendance_policies', 'DataAdapter.upsertHrAttendancePolicy')) {
        return null;
      }
      console.error('❌ DataAdapter.upsertHrAttendancePolicy:', e);
      return null;
    }
  }

  static async listEmployeeWorkSchedules(params: {
    profileId?: string;
    organizationId?: string;
    isoWeekday?: number;
    activeOnly?: boolean;
    forDate?: string;
  }): Promise<EmployeeWorkSchedule[]> {
    try {
      const { data, error } = await DataService.listEmployeeWorkSchedules(params);
      if (error) throw error;
      return data ?? [];
    } catch (e) {
      if (handleOptionalTableError(e, 'employee_work_schedules', 'DataAdapter.listEmployeeWorkSchedules')) {
        return [];
      }
      console.error('❌ DataAdapter.listEmployeeWorkSchedules:', e);
      return [];
    }
  }

  static async listHrWorkforceAnomalies(params: {
    organizationId: string;
    profileId?: string;
    fromDate?: string;
    toDate?: string;
  }): Promise<HrWorkforceAnomaly[]> {
    try {
      const { data, error } = await DataService.listHrWorkforceAnomalies(params);
      if (error) throw error;
      return data ?? [];
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_workforce_anomalies', 'DataAdapter.listHrWorkforceAnomalies')) {
        return [];
      }
      console.error('❌ DataAdapter.listHrWorkforceAnomalies:', e);
      return [];
    }
  }

  static async upsertHrWorkforceAnomaly(
    row: Omit<HrWorkforceAnomaly, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<HrWorkforceAnomaly | null> {
    try {
      const { data, error } = await DataService.upsertHrWorkforceAnomaly(row);
      if (error) throw error;
      return data ?? null;
    } catch (e) {
      if (handleOptionalTableError(e, 'hr_workforce_anomalies', 'DataAdapter.upsertHrWorkforceAnomaly')) {
        return null;
      }
      console.error('❌ DataAdapter.upsertHrWorkforceAnomaly:', e);
      return null;
    }
  }

  static async createTimeLog(timeLog: Omit<TimeLog, 'id' | 'userId'>): Promise<TimeLog> {
    vlog('🔄 DataAdapter.createTimeLog - Création log:', timeLog.entityTitle);
    try {
      const result = await DataService.createTimeLog(timeLog);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.createTimeLog:', result.error);
        throw result.error;
      }
      
      if (!result.data) {
        throw new Error('Aucune donnée retournée lors de la création du time log');
      }
      
      // Convertir le résultat en TimeLog (utiliser directement les UUIDs comme strings)
      const newLog: TimeLog = {
        id: result.data.id || '', // UUID string
        userId: result.data.user_id || '', // UUID string (profile.id)
        entityType: (result.data.entity_type || 'project') as 'project' | 'course' | 'task',
        entityId: result.data.entity_id || result.data.project_id || result.data.course_id || '',
        entityTitle: result.data.entity_title || '',
        date: result.data.date || new Date().toISOString().split('T')[0],
        duration: result.data.duration || (result.data.hours ? result.data.hours * 60 : 0),
        description: result.data.description || ''
      };
      
      vlog('✅ DataAdapter.createTimeLog - Log créé:', newLog.id);
      return newLog;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.createTimeLog:', error);
      throw error;
    }
  }

  static async updateTimeLog(id: string, updates: Partial<TimeLog>): Promise<TimeLog> {
    vlog('🔄 DataAdapter.updateTimeLog - Mise à jour log ID:', id);
    try {
      const result = await DataService.updateTimeLog(id, updates);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.updateTimeLog:', result.error);
        throw result.error;
      }
      
      if (!result.data) {
        throw new Error('Aucune donnée retournée lors de la mise à jour du time log');
      }
      
      const updatedLog: TimeLog = {
        id: result.data.id || '', // UUID string
        userId: result.data.user_id || '', // UUID string (profile.id)
        entityType: (result.data.entity_type || 'project') as 'project' | 'course' | 'task',
        entityId: result.data.entity_id || result.data.project_id || result.data.course_id || '',
        entityTitle: result.data.entity_title || '',
        date: result.data.date || new Date().toISOString().split('T')[0],
        duration: result.data.duration || (result.data.hours ? result.data.hours * 60 : 0),
        description: result.data.description || ''
      };
      
      vlog('✅ DataAdapter.updateTimeLog - Log mis à jour:', updatedLog.id);
      return updatedLog;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.updateTimeLog:', error);
      throw error;
    }
  }

  static async deleteTimeLog(id: string): Promise<void> {
    vlog('🔄 DataAdapter.deleteTimeLog - Suppression log ID:', id);
    try {
      const result = await DataService.deleteTimeLog(id);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.deleteTimeLog:', result.error);
        throw result.error;
      }
      vlog('✅ DataAdapter.deleteTimeLog - Log supprimé');
    } catch (error) {
      console.error('❌ Erreur DataAdapter.deleteTimeLog:', error);
      throw error;
    }
  }

  static async listMyWorkforceTimelineSegmentsForDay(day: Date | string): Promise<WorkforceTimelineSegmentRow[]> {
    const { data, error } = await DataService.listMyWorkforceTimelineSegmentsForDay(day);
    if (error) {
      console.warn('DataAdapter.listMyWorkforceTimelineSegmentsForDay:', error);
      return [];
    }
    return data ?? [];
  }

  // ===== LEAVE REQUESTS =====
  static async getLeaveRequests(): Promise<LeaveRequest[]> {
    vlog('🔍 DataAdapter.getLeaveRequests - Appel DataService.getLeaveRequests()');
      try {
        const { data, error } = await DataService.getLeaveRequests();
        if (error) throw error;
      
      vlog('📊 Données brutes Supabase leave_requests:', data?.length || 0, 'demandes');
      
      if (!data || data.length === 0) {
        return [];
      }

      // Récupérer tous les profils nécessaires pour mapper userName et userAvatar
      const userIds = [...new Set(data.map(r => r.user_id))];
      const { data: profiles } = await DataService.getProfiles();
      const profileRows = (profiles || []) as Array<{ id: string; full_name?: string | null; avatar_url?: string | null }>;
      const profilesMap = new Map<string, { id: string; full_name?: string | null; avatar_url?: string | null }>(
        profileRows.map((p) => [p.id, p]),
      );

      const leaveRequests: LeaveRequest[] = (data || []).map((request: any) => {
        const profile = profilesMap.get(request.user_id as string);
        return {
          id: request.id || '', // UUID string
          userId: request.user_id || '', // UUID string (profile.id)
          userName: profile?.full_name || 'Utilisateur inconnu',
          userAvatar: profile?.avatar_url || '',
          leaveTypeId: request.leave_type_id || undefined,
          leaveTypeName: request.leave_type || undefined,
          startDate: request.start_date || '',
          endDate: request.end_date || '',
          reason: request.reason || '',
          status: (request.status || 'pending').toLowerCase() as 'pending' | 'approved' | 'rejected' | 'cancelled',
          approverId: request.approver_id || undefined,
          rejectionReason: request.rejection_reason || undefined,
          approvalReason: request.approval_reason || undefined,
          isUrgent: request.is_urgent || false,
          urgencyReason: request.urgency_reason || undefined,
          managerId: request.manager_id || undefined,
          createdAt: request.created_at || new Date().toISOString(),
          updatedAt: request.updated_at || new Date().toISOString()
        };
      });
      
      vlog('✅ DataAdapter.getLeaveRequests - Demandes converties:', leaveRequests.length);
      return leaveRequests;
      } catch (error) {
      console.error('❌ Erreur DataAdapter.getLeaveRequests:', error);
      return [];
    }
  }

  static async createLeaveRequest(leaveRequest: Omit<LeaveRequest, 'id' | 'userId' | 'status' | 'createdAt' | 'updatedAt'>): Promise<LeaveRequest> {
    vlog('🔄 DataAdapter.createLeaveRequest - Création demande:', leaveRequest.leaveTypeName || 'congé');
    try {
      const result = await DataService.createLeaveRequest(leaveRequest);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.createLeaveRequest:', result.error);
        throw result.error;
      }
      
      if (!result.data) {
        throw new Error('Aucune donnée retournée lors de la création de la demande de congé');
      }

      // Récupérer le profil pour avoir userName et userAvatar
      const { data: profiles } = await DataService.getProfiles();
      const profile = profiles?.find(p => p.id === result.data.user_id);

      const newRequest: LeaveRequest = {
        id: result.data.id || '', // UUID string
        userId: result.data.user_id || '', // UUID string (profile.id)
        userName: profile?.full_name || '',
        userAvatar: profile?.avatar_url || '',
        leaveTypeId: result.data.leave_type_id || undefined,
        leaveTypeName: result.data.leave_type || undefined,
        startDate: result.data.start_date || '',
        endDate: result.data.end_date || '',
        reason: result.data.reason || '',
        status: (result.data.status || 'pending').toLowerCase() as 'pending' | 'approved' | 'rejected' | 'cancelled',
        approverId: result.data.approver_id || undefined,
        rejectionReason: result.data.rejection_reason || undefined,
        approvalReason: result.data.approval_reason || undefined,
        isUrgent: result.data.is_urgent || false,
        urgencyReason: result.data.urgency_reason || undefined,
        managerId: result.data.manager_id || undefined,
        createdAt: result.data.created_at || new Date().toISOString(),
        updatedAt: result.data.updated_at || new Date().toISOString()
      };
      
      vlog('✅ DataAdapter.createLeaveRequest - Demande créée:', newRequest.id);
      return newRequest;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.createLeaveRequest:', error);
      throw error;
    }
  }

  static async updateLeaveRequest(id: string, updates: Partial<LeaveRequest>): Promise<LeaveRequest> {
    vlog('🔄 DataAdapter.updateLeaveRequest - Mise à jour demande ID:', id);
    try {
      const result = await DataService.updateLeaveRequest(id, updates);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.updateLeaveRequest:', result.error);
        throw result.error;
      }
      
      if (!result.data) {
        throw new Error('Aucune donnée retournée lors de la mise à jour de la demande de congé');
      }

      // Récupérer le profil pour avoir userName et userAvatar
      const { data: profiles } = await DataService.getProfiles();
      const profile = profiles?.find(p => p.id === result.data.user_id);

      const updatedRequest: LeaveRequest = {
        id: result.data.id || '',
        userId: result.data.user_id || '',
        userName: profile?.full_name || '',
        userAvatar: profile?.avatar_url || '',
        leaveTypeId: result.data.leave_type_id || undefined,
        leaveTypeName: result.data.leave_type || undefined,
        startDate: result.data.start_date || '',
        endDate: result.data.end_date || '',
        reason: result.data.reason || '',
        status: (result.data.status || 'pending').toLowerCase() as 'pending' | 'approved' | 'rejected' | 'cancelled',
        approverId: result.data.approver_id || undefined,
        rejectionReason: result.data.rejection_reason || undefined,
        approvalReason: result.data.approval_reason || undefined,
        createdAt: result.data.created_at || new Date().toISOString(),
        updatedAt: result.data.updated_at || new Date().toISOString()
      };
      
      vlog('✅ DataAdapter.updateLeaveRequest - Demande mise à jour:', updatedRequest.id);
      return updatedRequest;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.updateLeaveRequest:', error);
      throw error;
    }
  }

  static async deleteLeaveRequest(id: string): Promise<void> {
    vlog('🔄 DataAdapter.deleteLeaveRequest - Suppression demande ID:', id);
    try {
      const result = await DataService.deleteLeaveRequest(id);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.deleteLeaveRequest:', result.error);
        throw result.error;
      }
      vlog('✅ DataAdapter.deleteLeaveRequest - Demande supprimée');
    } catch (error) {
      console.error('❌ Erreur DataAdapter.deleteLeaveRequest:', error);
      throw error;
    }
  }

  static async getLeaveTypes() {
    vlog('🔍 DataAdapter.getLeaveTypes - Appel DataService.getLeaveTypes()');
    try {
      const result = await DataService.getLeaveTypes();
      if (result.error) throw result.error;
      return result.data || [];
    } catch (error) {
      console.error('❌ Erreur DataAdapter.getLeaveTypes:', error);
      return [];
    }
  }

  // ===== USERS =====
  static async getUsers(): Promise<User[]> {
    if (this.useSupabase) {
      try {
        const { data, error } = await DataService.getProfiles();
        if (error) throw error;
        
        // Convertir les profils Supabase en User
        return (data || []).map((profile: any) => this.mapProfileToUser(profile));
      } catch (error) {
        console.error('Erreur récupération utilisateurs:', error);
        return [];
      }
    }
    return [];
  }

  static async toggleUserActive(userId: string | number, isActive: boolean): Promise<boolean> {
    if (this.useSupabase) {
      try {
        vlog('🔄 DataAdapter.toggleUserActive - Toggle user active:', { userId, isActive });
        
        const { data, error } = await DataService.toggleUserActive(userId, isActive);
        if (error) {
          console.error('❌ Erreur DataAdapter.toggleUserActive:', error);
          throw error;
        }
        
        vlog('✅ DataAdapter.toggleUserActive - User active status updated:', { userId, isActive });
        return true;
      } catch (error) {
        console.error('❌ Erreur DataAdapter.toggleUserActive:', error);
        throw error;
      }
    }
    return false;
  }

  static async deleteUser(userId: string | number): Promise<boolean> {
    if (this.useSupabase) {
      try {
        vlog('🔄 DataAdapter.deleteUser - Delete user:', { userId });
        
        const { success, error } = await DataService.deleteUser(userId);
        if (error) {
          console.error('❌ Erreur DataAdapter.deleteUser:', error);
          throw error;
        }
        
        vlog('✅ DataAdapter.deleteUser - User deleted:', { userId });
        return success;
      } catch (error) {
        console.error('❌ Erreur DataAdapter.deleteUser:', error);
        throw error;
      }
    }
    return false;
  }

  static async getPendingProfiles(): Promise<User[]> {
    if (!this.useSupabase) return [];
    try {
      const { data, error } = await DataService.getPendingProfiles();
      if (error) throw error;
      return (data || []).map((profile: any) => this.mapProfileToUser(profile));
    } catch (error) {
      console.error('❌ Erreur récupération profils en attente:', error);
      return [];
    }
  }

  static async approvePendingProfile(
    profileId: string,
    approverId: string,
    comment?: string,
    departmentId?: string | null
  ): Promise<{ user: User | null; departmentAssignmentFailed: boolean; provisionedPassword?: string }> {
    if (!this.useSupabase) return { user: null, departmentAssignmentFailed: false };
    try {
      const result = await DataService.approveProfileRole({ profileId, approverId, comment, departmentId });
      if (result.error) throw result.error;
      if (!result.data) {
        throw new Error(
          'Aucun profil renvoyé après approbation (vérifiez RLS sur `profiles` ou que l’UUID profil est bien celui de la table `profiles.id`).',
        );
      }
      return {
        user: this.mapProfileToUser(result.data),
        departmentAssignmentFailed: Boolean((result as any).departmentAssignmentFailed),
        provisionedPassword: (result as any).provisionedPassword as string | undefined,
      };
    } catch (error) {
      console.error('❌ Erreur approbation profil:', error);
      throw error;
    }
  }

  static async rejectPendingProfile(profileId: string, approverId: string, comment?: string): Promise<User | null> {
    if (!this.useSupabase) return null;
    try {
      const { data, error } = await DataService.rejectProfileRole({ profileId, approverId, comment });
      if (error) throw error;
      if (!data) return null;
      return this.mapProfileToUser(data);
    } catch (error) {
      console.error('❌ Erreur rejet profil:', error);
      throw error;
    }
  }

  // ===== MEETINGS =====
  static async getMeetings(): Promise<Meeting[]> {
    vlog('🔍 DataAdapter.getMeetings - Appel DataService.getMeetings()');
    try {
      const { data, error } = await DataService.getMeetings();
      if (error) throw error;
      
      vlog('📊 Données brutes Supabase meetings:', data?.length || 0, 'meetings');
      
      // Pour mapper les meetings, on garde les UUIDs tels quels (pas de conversion en number)
      const meetings: Meeting[] = (data || []).map((meeting: any) => ({
        id: meeting.id || '', // Garder l'UUID tel quel
        title: meeting.title || '',
        description: meeting.description || '',
        startTime: meeting.start_time || new Date().toISOString(),
        endTime: meeting.end_time || new Date().toISOString(),
        organizerId: meeting.organizer_id || '', // Garder l'UUID tel quel
        attendees: Array.isArray(meeting.attendees) ? meeting.attendees.map((id: any) => ({
          id: typeof id === 'string' ? id : String(id), // Garder l'UUID tel quel
          name: 'Utilisateur', // À récupérer depuis les profils si nécessaire
          email: '',
          avatar: '',
          role: 'user' as any
        })) : [],
        meetingUrl: meeting.meeting_url || undefined,
        accessCode: meeting.access_code || undefined,
        meetingPlatform: meeting.meeting_platform || undefined
      }));
      
      vlog('✅ DataAdapter.getMeetings - Meetings convertis:', meetings.length);
      return meetings;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.getMeetings:', error);
      return [];
    }
  }

  static async createMeeting(meeting: Omit<Meeting, 'id'>): Promise<Meeting> {
    vlog('🔄 DataAdapter.createMeeting - Création meeting:', meeting.title);
    try {
      const result = await DataService.createMeeting(meeting);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.createMeeting:', result.error);
        throw result.error;
      }
      
      const newMeeting: Meeting = {
        id: result.data.id || '', // Garder l'UUID tel quel
        title: result.data.title || '',
        description: result.data.description || '',
        startTime: result.data.start_time || new Date().toISOString(),
        endTime: result.data.end_time || new Date().toISOString(),
        organizerId: result.data.organizer_id || '', // Garder l'UUID tel quel
        attendees: Array.isArray(result.data.attendees) ? result.data.attendees.map((id: any) => ({
          id: typeof id === 'string' ? id : String(id), // Garder l'UUID tel quel
          name: 'Utilisateur',
          email: '',
          avatar: '',
          role: 'user' as any
        })) : [],
        meetingUrl: result.data.meeting_url || undefined,
        accessCode: result.data.access_code || undefined,
        meetingPlatform: result.data.meeting_platform || undefined
      };
      
      vlog('✅ DataAdapter.createMeeting - Meeting créé:', newMeeting.id);
      return newMeeting;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.createMeeting:', error);
      throw error;
    }
  }

  static async updateMeeting(meeting: Meeting): Promise<Meeting> {
    vlog('🔄 DataAdapter.updateMeeting - Mise à jour meeting ID:', meeting.id);
    try {
      // Convertir l'ID number en string UUID approximatif (on garde le format original si possible)
      const meetingId = typeof meeting.id === 'string' ? meeting.id : String(meeting.id);
      
      const result = await DataService.updateMeeting(meetingId, meeting);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.updateMeeting:', result.error);
        throw result.error;
      }
      
      const updatedMeeting: Meeting = {
        id: result.data.id || meeting.id, // Garder l'UUID tel quel
        title: result.data.title || '',
        description: result.data.description || '',
        startTime: result.data.start_time || new Date().toISOString(),
        endTime: result.data.end_time || new Date().toISOString(),
        organizerId: result.data.organizer_id || meeting.organizerId, // Garder l'UUID tel quel
        attendees: Array.isArray(result.data.attendees) ? result.data.attendees.map((id: any) => ({
          id: typeof id === 'string' ? id : String(id), // Garder l'UUID tel quel
          name: 'Utilisateur',
          email: '',
          avatar: '',
          role: 'user' as any
        })) : [],
        meetingUrl: result.data.meeting_url || undefined,
        accessCode: result.data.access_code || undefined,
        meetingPlatform: result.data.meeting_platform || undefined
      };
      
      vlog('✅ DataAdapter.updateMeeting - Meeting mis à jour:', updatedMeeting.id);
      return updatedMeeting;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.updateMeeting:', error);
      throw error;
    }
  }

  static async deleteMeeting(id: string | number): Promise<void> {
    vlog('🔄 DataAdapter.deleteMeeting - Suppression meeting ID:', id);
    try {
      const meetingId = String(id); // Convertir en string pour Supabase
      const result = await DataService.deleteMeeting(meetingId);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.deleteMeeting:', result.error);
        throw result.error;
      }
      vlog('✅ DataAdapter.deleteMeeting - Meeting supprimé');
    } catch (error) {
      console.error('❌ Erreur DataAdapter.deleteMeeting:', error);
      throw error;
    }
  }

  // Gestion des rapports de projet
  static async createProjectReport(reportData: any) {
    vlog('🔍 DataAdapter.createProjectReport - Appel DataService.createProjectReport()');
    const result = await DataService.createProjectReport(reportData);
    if (result.error) {
      console.error('❌ Erreur DataAdapter.createProjectReport:', result.error);
      throw result.error;
    }
    vlog('✅ DataAdapter.createProjectReport - Rapport créé:', result.data);
    return result.data;
  }

  static async getProjectReports(projectId: string) {
    vlog('🔍 DataAdapter.getProjectReports - Appel DataService.getProjectReports()');
    const result = await DataService.getProjectReports(projectId);
    if (result.error) {
      console.error('❌ Erreur DataAdapter.getProjectReports:', result.error);
      throw result.error;
    }
    vlog('✅ DataAdapter.getProjectReports - Rapports récupérés:', result.data.length);
    return result.data;
  }

  static async getProjectAttachments(projectId: string): Promise<ProjectAttachment[]> {
    const { data, error } = await DataService.getProjectAttachments(projectId);
    if (error) return [];
    return (data || []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      fileName: row.file_name,
      filePath: row.file_path,
      fileSize: row.file_size || 0,
      mimeType: row.mime_type,
      uploadedById: row.uploaded_by_id,
      createdAt: row.created_at || row.uploaded_at
    }));
  }

  static async uploadProjectAttachment(projectId: string, file: File): Promise<ProjectAttachment | null> {
    const { data, error } = await DataService.uploadProjectAttachment(projectId, file);
    if (error || !data) return null;
    return {
      id: data.id,
      projectId: data.project_id,
      fileName: data.file_name,
      filePath: data.file_path,
      fileSize: data.file_size || 0,
      mimeType: data.mime_type,
      uploadedById: data.uploaded_by_id,
      createdAt: data.created_at || data.uploaded_at
    };
  }

  static async deleteProjectAttachment(attachmentId: string): Promise<void> {
    const result = await DataService.deleteProjectAttachment(attachmentId);
    if (result.error) throw result.error;
  }

  static async getProjectAttachmentDownloadUrl(filePath: string): Promise<string | null> {
    return await DataService.getProjectAttachmentUrl(filePath, 60);
  }

  static async getProjectModuleSettings(): Promise<ProjectModuleSettings | null> {
    const { data, error } = await DataService.getProjectModuleSettings();
    if (error || !data) return null;
    return {
      id: data.id,
      organizationId: data.organization_id,
      projectTypes: Array.isArray(data.project_types) ? data.project_types : [],
      statuses: Array.isArray(data.statuses) ? data.statuses : [],
      alertDelayDays: data.alert_delay_days ?? 3,
      taskTemplates: Array.isArray(data.task_templates) ? data.task_templates : [],
      taskScorePercent: data.task_score_percent ?? undefined,
      managerScorePercent: data.manager_score_percent ?? undefined,
      requireJustificationForCompletion: data.require_justification_for_completion ?? undefined,
      autoFreezeOverdueTasks: data.auto_freeze_overdue_tasks ?? undefined,
      evaluationStartDate: data.evaluation_start_date ?? null,
      leavePendingSlaDays: data.leave_pending_sla_days ?? undefined,
      budgetWarningPercent: data.budget_warning_percent ?? undefined,
      budgetCriticalPercent: data.budget_critical_percent ?? undefined,
      objectiveOffTrackGapPercent: data.objective_offtrack_gap_percent ?? undefined,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
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
  }): Promise<ProjectModuleSettings | null> {
    const { data, error } = await DataService.upsertProjectModuleSettings(settings);
    if (error || !data) return null;
    return {
      id: data.id,
      organizationId: data.organization_id,
      projectTypes: Array.isArray(data.project_types) ? data.project_types : [],
      statuses: Array.isArray(data.statuses) ? data.statuses : [],
      alertDelayDays: data.alert_delay_days ?? 3,
      taskTemplates: Array.isArray(data.task_templates) ? data.task_templates : [],
      taskScorePercent: data.task_score_percent ?? undefined,
      managerScorePercent: data.manager_score_percent ?? undefined,
      requireJustificationForCompletion: data.require_justification_for_completion ?? undefined,
      autoFreezeOverdueTasks: data.auto_freeze_overdue_tasks ?? undefined,
      evaluationStartDate: data.evaluation_start_date ?? null,
      leavePendingSlaDays: data.leave_pending_sla_days ?? undefined,
      budgetWarningPercent: data.budget_warning_percent ?? undefined,
      budgetCriticalPercent: data.budget_critical_percent ?? undefined,
      objectiveOffTrackGapPercent: data.objective_offtrack_gap_percent ?? undefined,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  }

  // ===== PLANNING SLOTS (Phase 3) =====
  private static mapPlanningSlotRow(row: any): PlanningSlot {
    return {
      id: row.id,
      userId: row.user_id,
      slotDate: row.slot_date,
      slotType: row.slot_type,
      startTime: row.start_time,
      endTime: row.end_time,
      meetingId: row.meeting_id,
      title: row.title,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdById: row.created_by_id
    };
  }

  static async getPlanningSlots(params: { dateFrom: string; dateTo: string; userId?: string; userIds?: string[] }): Promise<PlanningSlot[]> {
    const { data, error } = await DataService.getPlanningSlots(params);
    if (error) return [];
    return (data || []).map((row: any) => this.mapPlanningSlotRow(row));
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
  }): Promise<PlanningSlot | null> {
    const { data, error } = await DataService.createPlanningSlot(slot);
    if (error || !data) return null;
    return this.mapPlanningSlotRow(data);
  }

  static async updatePlanningSlot(id: string, updates: Partial<PlanningSlot>): Promise<PlanningSlot | null> {
    const payload: Record<string, unknown> = {};
    if (updates.userId !== undefined) payload.userId = updates.userId;
    if (updates.slotDate !== undefined) payload.slotDate = updates.slotDate;
    if (updates.slotType !== undefined) payload.slotType = updates.slotType;
    if (updates.startTime !== undefined) payload.startTime = updates.startTime;
    if (updates.endTime !== undefined) payload.endTime = updates.endTime;
    if (updates.meetingId !== undefined) payload.meetingId = updates.meetingId;
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.notes !== undefined) payload.notes = updates.notes;
    const { data, error } = await DataService.updatePlanningSlot(id, payload as any);
    if (error || !data) return null;
    return this.mapPlanningSlotRow(data);
  }

  static async deletePlanningSlot(id: string): Promise<void> {
    const result = await DataService.deletePlanningSlot(id);
    if (result.error) throw result.error;
  }

  static async deletePlanningSlotsByNotesPrefix(prefix: string): Promise<number> {
    const { deleted, error } = await DataService.deletePlanningSlotsByNotesPrefix(prefix);
    if (error) return 0;
    return deleted;
  }

  // ===== WFM: OPEN SHIFTS / SWAPS =====
  static async getOpenShifts(params: { dateFrom?: string; dateTo?: string; status?: string }): Promise<any[]> {
    const { data, error } = await DataService.getOpenShifts(params);
    if (error) return [];
    return data || [];
  }

  static async takeOpenShift(openShiftId: string, assigneeUserId: string): Promise<any | null> {
    const { data, error } = await DataService.takeOpenShift(openShiftId, assigneeUserId);
    if (error || !data) return null;
    return data;
  }

  static async getSwapRequests(params: { status?: string; dateFrom?: string; dateTo?: string }): Promise<any[]> {
    const { data, error } = await DataService.getSwapRequests(params);
    if (error) return [];
    return data || [];
  }

  static async createSwapRequest(payload: any): Promise<any | null> {
    const { data, error } = await DataService.createSwapRequest(payload);
    if (error || !data) return null;
    return data;
  }

  static async updateSwapRequest(id: string, updates: any): Promise<any | null> {
    const { data, error } = await DataService.updateSwapRequest(id, updates);
    if (error || !data) return null;
    return data;
  }

  static async deleteProjectReport(reportId: string) {
    vlog('🔍 DataAdapter.deleteProjectReport - Appel DataService.deleteProjectReport()');
    const result = await DataService.deleteProjectReport(reportId);
    if (result.error) {
      console.error('❌ Erreur DataAdapter.deleteProjectReport:', result.error);
      throw result.error;
    }
    vlog('✅ DataAdapter.deleteProjectReport - Rapport supprimé');
  }

  // ===== JOBS =====
  static async getJobs(): Promise<Job[]> {
    if (this.useSupabase) {
      try {
        vlog('🔍 DataAdapter.getJobs - Appel DataService.getJobs()');
        const { data, error } = await DataService.getJobs();
        
        if (error) {
          console.error('❌ Erreur DataService.getJobs:', error);
          return []; // Retourner tableau vide au lieu de throw
        }
        
        vlog('📊 Données brutes Supabase jobs:', data?.length || 0, 'emplois');
        
        // Convertir les données Supabase vers le format attendu
        const jobs = (data || []).map((job: any) => ({
          id: job.id,
          title: job.title || '',
          company: job.company || '',
          location: job.location || '',
          type: job.type || 'Full-time' as any,
          postedDate: new Date(job.created_at || Date.now()).toLocaleDateString('fr-FR'),
          description: job.description || '',
          requiredSkills: job.required_skills || [],
          applicants: [],
          status: job.status as any,
          sector: job.sector,
          experienceLevel: job.experience_level as any,
          remoteWork: job.remote_work as any,
          salary: job.salary,
          benefits: job.benefits,
          education: job.education,
          languages: job.languages,
          applicationLink: job.application_link,
          applicationEmail: job.application_email,
          companyWebsite: job.company_website
        }));
        
        vlog('✅ DataAdapter.getJobs - Jobs convertis:', jobs.length);
        return jobs;
      } catch (error) {
        console.error('❌ Erreur Supabase, retour tableau vide:', error);
        return []; // Pas de fallback vers mockJobs
      }
    }
    vlog('⚠️ DataAdapter.getJobs - useSupabase=false, retour vide');
    return [];
  }

  static async createJob(job: Partial<Job>): Promise<Job> {
    vlog('🔄 DataAdapter.createJob - Création job');
    try {
      const result = await DataService.createJob(job);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.createJob:', result.error);
        throw result.error;
      }
      
      const newJob: Job = {
        id: result.data.id,
        title: result.data.title || '',
        company: result.data.company || '',
        location: result.data.location || '',
        type: result.data.type || 'Full-time' as any,
        postedDate: new Date(result.data.created_at || Date.now()).toLocaleDateString('fr-FR'),
        description: result.data.description || '',
        requiredSkills: result.data.required_skills || [],
        applicants: [],
        status: result.data.status as any,
        sector: result.data.sector,
        experienceLevel: result.data.experience_level as any,
        remoteWork: result.data.remote_work as any,
        salary: result.data.salary,
        benefits: result.data.benefits,
        education: result.data.education,
        languages: result.data.languages,
        applicationLink: result.data.application_link,
        applicationEmail: result.data.application_email,
        companyWebsite: result.data.company_website
      };
      
      vlog('✅ DataAdapter.createJob - Job créé:', newJob.id);
      return newJob;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.createJob:', error);
      throw error;
    }
  }

  static async updateJob(job: Job): Promise<Job> {
    vlog('🔄 DataAdapter.updateJob - Mise à jour job ID:', job.id);
    try {
      const result = await DataService.updateJob(job.id, job);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.updateJob:', result.error);
        throw result.error;
      }
      
      const updatedJob: Job = {
        ...job,
        ...result.data
      };
      
      vlog('✅ DataAdapter.updateJob - Job mis à jour:', updatedJob.id);
      return updatedJob;
    } catch (error) {
      console.error('❌ Erreur DataAdapter.updateJob:', error);
      throw error;
    }
  }

  static async deleteJob(id: number): Promise<void> {
    vlog('🔄 DataAdapter.deleteJob - Suppression job ID:', id);
    try {
      const result = await DataService.deleteJob(id);
      if (result.error) {
        console.error('❌ Erreur DataAdapter.deleteJob:', result.error);
        throw result.error;
      }
      vlog('✅ DataAdapter.deleteJob - Job supprimé');
    } catch (error) {
      console.error('❌ Erreur DataAdapter.deleteJob:', error);
      throw error;
    }
  }
}

export default DataAdapter;
