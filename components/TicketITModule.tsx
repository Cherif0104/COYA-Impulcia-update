import React, { useState, useEffect, useCallback, useMemo } from 'react';
import StructuredModulePage from './common/StructuredModulePage';
import ModuleRichHub from './common/ModuleRichHub';
import { useLocalization } from '../contexts/LocalizationContext';
import { useAuth } from '../contexts/AuthContextSupabase';
import {
  Language,
  TicketIT,
  TicketITStatus,
  TicketITVisibilityScope,
  MANAGEMENT_ROLES,
  Role,
  Employee,
} from '../types';
import * as ticketItService from '../services/ticketItService';
import ConfirmationModal from './common/ConfirmationModal';
import ExtensibleSelect from './common/ExtensibleSelect';
import OrganizationService from '../services/organizationService';
import DataAdapter from '../services/dataAdapter';
import { FileService } from '../services/fileService';
import { NotificationService } from '../services/notificationService';
import { DataService } from '../services/dataService';

const STATUS_LABELS_FR: Record<TicketITStatus, string> = {
  draft: 'Brouillon',
  pending_validation: 'En attente validation',
  needs_reformulation: 'Reformulation demandée',
  validated: 'Validé',
  sent_to_it: 'Envoyé à l\'IT',
  in_progress: 'En cours',
  resolved: 'Résolu',
  rejected: 'Refusé',
};
const STATUS_LABELS_EN: Record<TicketITStatus, string> = {
  draft: 'Draft',
  pending_validation: 'Pending validation',
  needs_reformulation: 'Reformulation requested',
  validated: 'Validated',
  sent_to_it: 'Sent to IT',
  in_progress: 'In progress',
  resolved: 'Resolved',
  rejected: 'Rejected',
};

const PRIORITY_LABELS_FR = { low: 'Basse', medium: 'Moyenne', high: 'Haute', critical: 'Critique' };
const PRIORITY_LABELS_EN = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
const SCOPE_LABELS_FR: Record<TicketITVisibilityScope, string> = {
  self: 'Moi uniquement',
  team: 'Mon équipe',
  all_users: 'Tous les utilisateurs',
};
const SCOPE_LABELS_EN: Record<TicketITVisibilityScope, string> = {
  self: 'Only me',
  team: 'My team',
  all_users: 'All users',
};

/** Phase 6 – Ticket IT : création → validation manager → envoi IT */
const TicketITModule: React.FC = () => {
  const { language } = useLocalization();
  const { user: currentUser } = useAuth();
  const isFr = language === Language.FR;
  const statusLabels = isFr ? STATUS_LABELS_FR : STATUS_LABELS_EN;
  const priorityLabels = isFr ? PRIORITY_LABELS_FR : PRIORITY_LABELS_EN;
  const scopeLabels = isFr ? SCOPE_LABELS_FR : SCOPE_LABELS_EN;

  const [tickets, setTickets] = useState<TicketIT[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<TicketITStatus | ''>('');
  const [selectedTicket, setSelectedTicket] = useState<TicketIT | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createPriority, setCreatePriority] = useState<TicketIT['priority']>('medium');
  const [createIssueTypeId, setCreateIssueTypeId] = useState('');
  const [createVisibilityScope, setCreateVisibilityScope] = useState<TicketITVisibilityScope>('self');
  const [createBroadcastOnCreate, setCreateBroadcastOnCreate] = useState(false);
  const [createScreenshot, setCreateScreenshot] = useState<File | null>(null);
  const [createValidationErrors, setCreateValidationErrors] = useState<string[]>([]);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectModalTicket, setRejectModalTicket] = useState<TicketIT | null>(null);
  const [reformulateComment, setReformulateComment] = useState('');
  const [reformulateModalTicket, setReformulateModalTicket] = useState<TicketIT | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');
  const [resolveModalTicket, setResolveModalTicket] = useState<TicketIT | null>(null);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignUserName, setAssignUserName] = useState('');
  const [assignModalTicket, setAssignModalTicket] = useState<TicketIT | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [intervenantProfileIds, setIntervenantProfileIds] = useState<string[]>([]);
  const [organizationProfiles, setOrganizationProfiles] = useState<Array<{ id: string; fullName?: string | null; role?: string | null }>>([]);

  const currentProfileId = useMemo(() => {
    if (!currentUser) return null;
    return String((currentUser as any).profileId || currentUser.id);
  }, [currentUser]);

  const isSuperAdmin = useMemo(() => currentUser?.role === 'super_administrator', [currentUser?.role]);
  const isAdmin = useMemo(() => currentUser?.role === 'administrator', [currentUser?.role]);

  const loadTickets = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const list = await ticketItService.listTicketsIT({
        organizationId: (currentUser as any).organizationId ?? null,
        createdById: undefined,
        assignedToId: undefined,
        status: statusFilter || undefined,
      });
      // Visibilité :
      // - Super admin : tout
      // - Créateur : ses tickets
      // - Manager (ligne) : tickets des personnes qu'il encadre (via Employee.managerId)
      // - Assigné : tickets qui lui sont assignés
      if (isSuperAdmin) {
        setTickets(list);
      } else {
        const managedProfileIds = new Set<string>();
        if (currentProfileId && employees.length > 0) {
          employees.forEach((e) => {
            if (e.managerId && String(e.managerId) === currentProfileId) managedProfileIds.add(String(e.profileId));
          });
        }
        const filtered = list.filter((t) => {
          const creatorId = String(t.createdById);
          const isMine = currentProfileId ? creatorId === currentProfileId : false;
          const isManaged = managedProfileIds.has(creatorId);
          const isMineAssigned = currentProfileId && t.assignedToId ? String(t.assignedToId) === currentProfileId : false;
          const isGlobalIncident = (t.visibilityScope || 'self') === 'all_users' || !!t.broadcastOnCreate;
          return isMine || isManaged || isMineAssigned || isGlobalIncident;
        });
        setTickets(filtered);
      }
    } catch (e: any) {
      setError(e?.message || 'Erreur chargement tickets');
    } finally {
      setLoading(false);
    }
  }, [currentUser, statusFilter, isSuperAdmin, currentProfileId, employees]);

  useEffect(() => {
    loadTickets();
  }, [loadTickets]);

  useEffect(() => {
    const run = async () => {
      try {
        const org = await OrganizationService.getCurrentUserOrganizationId();
        if (org) setOrganizationId(org);
        const list = await DataAdapter.listEmployees(org ?? undefined);
        setEmployees(list ?? []);
      } catch {
        setEmployees([]);
      }
    };
    run();
  }, []);

  useEffect(() => {
    const loadIntervenants = async () => {
      if (!currentUser) {
        setIntervenantProfileIds([]);
        return;
      }
      try {
        const { data } = await DataService.getProfiles();
        const currentOrg = organizationId || (currentUser as any).organizationId || null;
        const orgProfiles = (data || [])
          .filter((p: any) => (!currentOrg || p.organization_id === currentOrg) && !!p.id)
          .map((p: any) => ({
            id: String(p.id),
            fullName: p.full_name ?? null,
            role: p.role ?? null,
          }));
        setOrganizationProfiles(orgProfiles);
        const ids = orgProfiles
          .filter((p) => ['super_administrator', 'administrator', 'manager'].includes(String(p.role || '')))
          .map((p) => p.id);
        setIntervenantProfileIds(Array.from(new Set(ids)));
      } catch {
        setOrganizationProfiles([]);
        setIntervenantProfileIds([]);
      }
    };
    loadIntervenants();
  }, [currentUser, organizationId]);

  useEffect(() => {
    if (selectedTicket) {
      ticketItService.getTicketIT(selectedTicket.id).then((t) => t && setSelectedTicket(t)).catch(() => {});
    }
  }, [selectedTicket?.id]);

  const isManager = useMemo(
    () => currentUser?.role && MANAGEMENT_ROLES.includes(currentUser.role as Role),
    [currentUser]
  );
  const isCreator = (t: TicketIT) =>
    currentProfileId && String(t.createdById) === currentProfileId;
  const isAssigned = (t: TicketIT) =>
    currentProfileId && t.assignedToId && String(t.assignedToId) === currentProfileId;

  const isLineManagerFor = useCallback((t: TicketIT) => {
    if (!currentProfileId) return false;
    const emp = employees.find((e) => String(e.profileId) === String(t.createdById));
    return !!(emp?.managerId && String(emp.managerId) === currentProfileId);
  }, [employees, currentProfileId]);

  const canReview = (t: TicketIT) =>
    t.status === 'pending_validation' && (isSuperAdmin || isAdmin || isLineManagerFor(t));
  const canValidate = (t: TicketIT) => canReview(t);
  const canReject = (t: TicketIT) => canReview(t);
  const canSendToIt = (t: TicketIT) =>
    t.status === 'validated' && (isSuperAdmin || isManager);
  const canAssignOrProgress = (t: TicketIT) =>
    (t.status === 'sent_to_it' || t.status === 'in_progress') && (isManager || isAssigned(t));
  const canResolve = (t: TicketIT) =>
    t.status === 'in_progress' && (isManager || isAssigned(t));

  const dueHoursForPriority = (p?: TicketIT['priority']) => {
    if (p === 'critical') return 6;
    if (p === 'high') return 24;
    if (p === 'medium') return 48;
    return 72;
  };

  const getIntervenantRecipients = (excludeCreator = true) => {
    const creator = currentProfileId ? String(currentProfileId) : '';
    return intervenantProfileIds.filter((id) => id && (!excludeCreator || id !== creator));
  };

  const getScopeRecipients = (ticket: TicketIT): string[] => {
    const scope = ticket.visibilityScope || 'self';
    const creatorId = String(ticket.createdById || '');
    if (!creatorId) return [];
    if (scope === 'self') return [creatorId];
    if (scope === 'all_users') return organizationProfiles.map((p) => p.id);

    const creatorEmployee = employees.find((e) => String(e.profileId) === creatorId);
    const managerId = creatorEmployee?.managerId ? String(creatorEmployee.managerId) : null;
    if (!managerId) return [creatorId];
    const teamIds = employees
      .filter((e) => e.managerId && String(e.managerId) === managerId)
      .map((e) => String(e.profileId));
    return Array.from(new Set([creatorId, managerId, ...teamIds]));
  };

  const dedupeIds = (ids: string[]) => Array.from(new Set(ids.filter(Boolean)));

  const notifyIntervenantsOnSubmission = async (ticket: TicketIT) => {
    const recipients = dedupeIds([
      ...getIntervenantRecipients(),
      ...(ticket.broadcastOnCreate || ticket.visibilityScope === 'all_users' || ticket.visibilityScope === 'team'
        ? getScopeRecipients(ticket)
        : []),
    ]);
    if (recipients.length === 0) return;
    await NotificationService.notifyUsers(
      recipients,
      'warning',
      'ticket_it',
      'submitted',
      isFr ? 'Nouveau ticket à valider' : 'New ticket to review',
      isFr
        ? `${ticket.createdByName || ticket.createdById} a soumis le ticket "${ticket.title}".`
        : `${ticket.createdByName || ticket.createdById} submitted ticket "${ticket.title}".`,
      {
        entityType: 'ticket_it',
        entityId: ticket.id,
        entityTitle: ticket.title,
        metadata: { status: 'pending_validation', visibilityScope: ticket.visibilityScope || 'self' },
      }
    );
  };

  const notifyRequester = async (
    ticket: TicketIT,
    type: 'success' | 'warning' | 'error',
    action: 'approved' | 'requested_changes' | 'rejected',
    title: string,
    message: string,
  ) => {
    if (!ticket.createdById) return;
    await NotificationService.createNotification(String(ticket.createdById), type, 'ticket_it', action, title, message, {
      entityType: 'ticket_it',
      entityId: ticket.id,
      entityTitle: ticket.title,
    });
  };

  const notifyResolutionAudience = async (ticket: TicketIT) => {
    const extra =
      ticket.visibilityScope === 'all_users'
        ? organizationProfiles.map((p) => p.id)
        : ticket.visibilityScope === 'team'
          ? getScopeRecipients(ticket)
          : [];
    const recipients = dedupeIds([
      ...getIntervenantRecipients(false),
      ...extra,
      String(ticket.createdById || ''),
      String(ticket.assignedToId || ''),
    ]);
    if (recipients.length === 0) return;
    await NotificationService.notifyUsers(
      recipients,
      'success',
      'ticket_it',
      'completed',
      isFr ? 'Incident résolu' : 'Incident resolved',
      isFr ? `Le ticket "${ticket.title}" est marqué comme résolu.` : `Ticket "${ticket.title}" is marked as resolved.`,
      { entityType: 'ticket_it', entityId: ticket.id, entityTitle: ticket.title }
    );
  };

  const computeSla = (t: TicketIT) => {
    const startAt = t.validatedAt || t.sentToItAt || null;
    if (!startAt) return null;
    const startMs = new Date(startAt).getTime();
    const dueMs = startMs + dueHoursForPriority(t.priority) * 60 * 60 * 1000;
    const remainingMs = dueMs - Date.now();
    return { dueMs, remainingMs, overdue: remainingMs < 0 };
  };

  const formatRemaining = (ms: number) => {
    const abs = Math.abs(ms);
    const h = Math.floor(abs / (60 * 60 * 1000));
    const m = Math.floor((abs % (60 * 60 * 1000)) / (60 * 1000));
    if (h <= 0) return `${m}m`;
    return `${h}h ${m}m`;
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser || !createTitle.trim()) return;
    const errs: string[] = [];
    if (!createDescription.trim() || createDescription.trim().length < 30) {
      errs.push(isFr ? 'La description doit être claire (minimum 30 caractères).' : 'Description must be clear (min 30 chars).');
    }
    if (!createScreenshot) {
      errs.push(isFr ? 'Une capture d’écran est obligatoire.' : 'A screenshot is required.');
    }
    if (errs.length > 0) {
      setCreateValidationErrors(errs);
      return;
    }
    setCreateValidationErrors([]);
    setCreateSubmitting(true);
    try {
      const creatorId = String((currentUser as any).profileId || currentUser.id);
      const created = await ticketItService.createTicketIT({
        organizationId: (currentUser as any).organizationId ?? null,
        title: createTitle.trim(),
        description: createDescription.trim(),
        priority: createPriority,
        issueTypeId: createIssueTypeId || null,
        visibilityScope: createVisibilityScope,
        broadcastOnCreate: createBroadcastOnCreate,
        createdById: creatorId,
        createdByName: (currentUser as any).fullName || (currentUser as any).name || undefined,
      });

      // Upload capture d'écran (bucket documents) et ajout du lien dans la description
      if (createScreenshot) {
        const path = `ticket-it/${created.id}/${Date.now()}-${createScreenshot.name}`;
        const { data } = await FileService.uploadFile('documents', createScreenshot, path);
        if (data?.url) {
          const appended = `${created.description}\n\nCapture: ${data.url}`;
          await ticketItService.updateTicketIT(created.id, { description: appended });
          created.description = appended;
        }
      }

      setTickets((prev) => [created, ...prev]);
      setCreateTitle('');
      setCreateDescription('');
      setCreatePriority('medium');
      setCreateIssueTypeId('');
      setCreateVisibilityScope('self');
      setCreateBroadcastOnCreate(false);
      setCreateScreenshot(null);
      setShowCreateForm(false);
      setSelectedTicket(created);
    } catch (e: any) {
      setError(e?.message || 'Erreur création');
    } finally {
      setCreateSubmitting(false);
    }
  };

  const submitForValidation = async (t: TicketIT) => {
    setActionLoading(true);
    try {
      await ticketItService.updateTicketIT(t.id, { status: 'pending_validation', rejectionReason: null });
      const submittedTicket = { ...t, status: 'pending_validation' as TicketITStatus };
      await notifyIntervenantsOnSubmission(submittedTicket);
      await loadTickets();
      setSelectedTicket((prev) => (prev?.id === t.id ? { ...prev, status: 'pending_validation', rejectionReason: null } : prev));
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const validateTicket = async (t: TicketIT) => {
    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      await ticketItService.updateTicketIT(t.id, {
        status: 'validated',
        validatedById: currentProfileId,
        validatedByName: (currentUser as any).fullName || (currentUser as any).name || null,
        validatedAt: now,
        rejectionReason: null,
      });
      await notifyRequester(
        t,
        'success',
        'approved',
        isFr ? 'Ticket accepté' : 'Ticket accepted',
        isFr
          ? `Votre ticket "${t.title}" a été accepté. Le délai de traitement démarre maintenant.`
          : `Your ticket "${t.title}" has been accepted. Resolution SLA starts now.`
      );
      await NotificationService.notifyUsers(
        getIntervenantRecipients(false),
        'success',
        'ticket_it',
        'approved',
        isFr ? 'Ticket accepté' : 'Ticket accepted',
        isFr ? `Le ticket "${t.title}" a été accepté et peut passer au traitement.` : `Ticket "${t.title}" has been accepted and can move to processing.`,
        { entityType: 'ticket_it', entityId: t.id, entityTitle: t.title }
      );
      await loadTickets();
      setSelectedTicket((prev) =>
        prev?.id === t.id ? { ...prev, status: 'validated', validatedAt: now, rejectionReason: null } : prev
      );
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const rejectTicket = async () => {
    if (!rejectModalTicket) return;
    setActionLoading(true);
    try {
      await ticketItService.updateTicketIT(rejectModalTicket.id, {
        status: 'rejected',
        validatedById: currentProfileId,
        validatedByName: (currentUser as any).fullName || (currentUser as any).name || null,
        validatedAt: new Date().toISOString(),
        rejectionReason: rejectReason.trim() || null,
      });
      await notifyRequester(
        rejectModalTicket,
        'error',
        'rejected',
        isFr ? 'Ticket rejeté' : 'Ticket rejected',
        isFr
          ? `Votre ticket "${rejectModalTicket.title}" a été rejeté.${rejectReason.trim() ? ` Motif: ${rejectReason.trim()}` : ''}`
          : `Your ticket "${rejectModalTicket.title}" was rejected.${rejectReason.trim() ? ` Reason: ${rejectReason.trim()}` : ''}`
      );
      await NotificationService.notifyUsers(
        getIntervenantRecipients(false),
        'warning',
        'ticket_it',
        'rejected',
        isFr ? 'Ticket rejeté' : 'Ticket rejected',
        isFr ? `Le ticket "${rejectModalTicket.title}" a été rejeté.` : `Ticket "${rejectModalTicket.title}" was rejected.`,
        { entityType: 'ticket_it', entityId: rejectModalTicket.id, entityTitle: rejectModalTicket.title }
      );
      await loadTickets();
      setSelectedTicket((prev) =>
        prev?.id === rejectModalTicket.id ? { ...prev, status: 'rejected', rejectionReason: rejectReason.trim() || null } : prev
      );
      setRejectModalTicket(null);
      setRejectReason('');
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const requestReformulation = async () => {
    if (!reformulateModalTicket) return;
    const comment = reformulateComment.trim();
    if (!comment) {
      setError(isFr ? 'Veuillez ajouter un commentaire de reformulation.' : 'Please add a reformulation comment.');
      return;
    }
    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      await ticketItService.updateTicketIT(reformulateModalTicket.id, {
        status: 'needs_reformulation',
        validatedById: currentProfileId,
        validatedByName: (currentUser as any).fullName || (currentUser as any).name || null,
        validatedAt: now,
        rejectionReason: comment,
      });
      await notifyRequester(
        reformulateModalTicket,
        'warning',
        'requested_changes',
        isFr ? 'Reformulation demandée' : 'Reformulation requested',
        isFr
          ? `Votre ticket "${reformulateModalTicket.title}" doit être reformulé. Commentaire: ${comment}`
          : `Your ticket "${reformulateModalTicket.title}" needs reformulation. Comment: ${comment}`
      );
      await NotificationService.notifyUsers(
        getIntervenantRecipients(false),
        'info',
        'ticket_it',
        'requested_changes',
        isFr ? 'Reformulation demandée' : 'Reformulation requested',
        isFr ? `Reformulation demandée pour "${reformulateModalTicket.title}".` : `Reformulation requested for "${reformulateModalTicket.title}".`,
        { entityType: 'ticket_it', entityId: reformulateModalTicket.id, entityTitle: reformulateModalTicket.title }
      );
      await loadTickets();
      setSelectedTicket((prev) =>
        prev?.id === reformulateModalTicket.id
          ? { ...prev, status: 'needs_reformulation', rejectionReason: comment, validatedAt: now }
          : prev
      );
      setReformulateModalTicket(null);
      setReformulateComment('');
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const sendToIt = async (t: TicketIT) => {
    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      await ticketItService.updateTicketIT(t.id, {
        status: 'sent_to_it',
        sentToItAt: now,
      });
      await loadTickets();
      setSelectedTicket((prev) =>
        prev?.id === t.id ? { ...prev, status: 'sent_to_it', sentToItAt: now } : prev
      );
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const assignTicket = async () => {
    if (!assignModalTicket) return;
    setActionLoading(true);
    try {
      await ticketItService.updateTicketIT(assignModalTicket.id, {
        assignedToId: assignUserId.trim() || null,
        assignedToName: assignUserName.trim() || null,
      });
      await loadTickets();
      setSelectedTicket((prev) =>
        prev?.id === assignModalTicket.id
          ? { ...prev, assignedToId: assignUserId || null, assignedToName: assignUserName || null }
          : prev
      );
      setAssignModalTicket(null);
      setAssignUserId('');
      setAssignUserName('');
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const markInProgress = async (t: TicketIT) => {
    setActionLoading(true);
    try {
      await ticketItService.updateTicketIT(t.id, { status: 'in_progress' });
      await loadTickets();
      setSelectedTicket((prev) => (prev?.id === t.id ? { ...prev, status: 'in_progress' } : prev));
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const resolveTicket = async () => {
    if (!resolveModalTicket) return;
    setActionLoading(true);
    try {
      const now = new Date().toISOString();
      await ticketItService.updateTicketIT(resolveModalTicket.id, {
        status: 'resolved',
        resolvedAt: now,
        resolutionNotes: resolveNotes.trim() || null,
      });
      await notifyResolutionAudience(resolveModalTicket);
      await loadTickets();
      setSelectedTicket((prev) =>
        prev?.id === resolveModalTicket.id ? { ...prev, status: 'resolved', resolvedAt: now } : prev
      );
      setResolveModalTicket(null);
      setResolveNotes('');
    } catch (e: any) {
      setError(e?.message || 'Erreur');
    } finally {
      setActionLoading(false);
    }
  };

  const ticketHubMetrics = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter((t) => t.status !== 'resolved' && t.status !== 'rejected').length;
    const resolved = tickets.filter((t) => t.status === 'resolved').length;
    const critical = tickets.filter((t) => t.priority === 'critical').length;
    return { total, open, resolved, critical };
  }, [tickets]);

  const sections = [
    {
      key: 'workflow',
      titleFr: 'Workflow',
      titleEn: 'Workflow',
      icon: 'fas fa-route',
      content: (
        <p className="text-slate-600 text-sm">
          {isFr
            ? 'Création par l’utilisateur → validation obligatoire (manager/admin/super admin). Le reviewer peut accepter, rejeter, ou demander reformulation avec commentaire. Le SLA démarre à l’acceptation.'
            : 'Created by user → mandatory validation (manager/admin/super admin). Reviewer can accept, reject, or request reformulation with comment. SLA starts on acceptance.'}
        </p>
      ),
    },
    {
      key: 'droits',
      titleFr: 'Droits',
      titleEn: 'Rights',
      icon: 'fas fa-user-shield',
      content: (
        <p className="text-slate-600 text-sm">
          {isFr
            ? 'Créateur : créer + capture + soumettre/re-soumettre. Manager/Admin/Super admin : accepter, rejeter ou demander reformulation. IT : assigner, traiter, résoudre.'
            : 'Creator: create + screenshot + submit/resubmit. Manager/Admin/Super admin: accept, reject or request reformulation. IT: assign, process, resolve.'}
        </p>
      ),
    },
  ];

  return (
    <StructuredModulePage
      moduleKey="ticket_it"
      titleFr="Ticket IT"
      titleEn="IT Ticket"
      descriptionFr="Panne ou problème technique : création → validation manager → envoi IT. Droits par rôle."
      descriptionEn="Breakdown or technical issue: create → manager validation → send to IT. Rights by role."
      icon="fas fa-ticket-alt"
      sections={sections}
    >
      {error && (
        <div className="mb-4 p-3 rounded-coya bg-red-100 text-red-800 text-sm" role="alert">
          {error}
        </div>
      )}

      <ModuleRichHub
        isFr={isFr}
        metrics={[
          {
            labelFr: 'Tickets total',
            labelEn: 'Total tickets',
            value: String(ticketHubMetrics.total),
            hintFr: 'Organisation courante',
            hintEn: 'Current organization',
          },
          {
            labelFr: 'Ouverts / en cours',
            labelEn: 'Open / in flight',
            value: String(ticketHubMetrics.open),
            hintFr: 'Hors résolu ou refusé',
            hintEn: 'Excluding resolved or rejected',
          },
          {
            labelFr: 'Résolus',
            labelEn: 'Resolved',
            value: String(ticketHubMetrics.resolved),
            hintFr: 'Historique SLA',
            hintEn: 'SLA history',
          },
          {
            labelFr: 'Priorité critique',
            labelEn: 'Critical priority',
            value: String(ticketHubMetrics.critical),
            hintFr: 'File express IT',
            hintEn: 'Express IT queue',
          },
        ]}
        sections={[
          {
            key: 'it',
            titleFr: 'Couloir IT & collaboration',
            titleEn: 'IT corridor & collaboration',
            icon: 'fas fa-headset',
            bulletsFr: [
              'Messagerie : canaux d’incident et escalade rapide.',
              'Drive : pièces jointes et preuves conservées hors ticket.',
              'Paramètres : types de panne extensibles (référentiel).',
            ],
            bulletsEn: [
              'Messaging: incident channels and quick escalation.',
              'Drive: attachments and evidence kept outside the ticket.',
              'Settings: extensible issue types (referential).',
            ],
          },
        ]}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="rounded-coya border border-coya-border bg-coya-card px-3 py-2 text-sm text-coya-text"
          value={statusFilter}
          onChange={(e) => setStatusFilter((e.target.value || '') as TicketITStatus | '')}
        >
          <option value="">{isFr ? 'Tous les statuts' : 'All statuses'}</option>
          {(Object.keys(statusLabels) as TicketITStatus[]).map((s) => (
            <option key={s} value={s}>{statusLabels[s]}</option>
          ))}
        </select>
        {currentUser && (
          <button
            type="button"
            className="rounded-coya bg-coya-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            onClick={() => setShowCreateForm(true)}
          >
            {isFr ? 'Nouveau ticket' : 'New ticket'}
          </button>
        )}
        <button
          type="button"
          className="rounded-coya border border-coya-border bg-coya-card px-3 py-2 text-sm text-coya-text hover:bg-coya-bg"
          onClick={loadTickets}
          disabled={loading}
        >
          {loading ? (isFr ? 'Chargement…' : 'Loading…') : (isFr ? 'Rafraîchir' : 'Refresh')}
        </button>
      </div>

      {showCreateForm && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {isFr ? 'Créer un ticket' : 'Create ticket'}
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            {createValidationErrors.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <ul className="list-disc list-inside space-y-1">
                  {createValidationErrors.map((m, idx) => <li key={idx}>{m}</li>)}
                </ul>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{isFr ? 'Titre' : 'Title'}</label>
              <input
                type="text"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-slate-400"
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                required
                placeholder={isFr ? 'Résumé du problème' : 'Summary of the issue'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{isFr ? 'Description (claire)' : 'Description (clear)'}</label>
              <textarea
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900 min-h-[110px] focus:ring-2 focus:ring-slate-400"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder={isFr ? 'Détails…' : 'Details…'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{isFr ? 'Capture d’écran (obligatoire)' : 'Screenshot (required)'}</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCreateScreenshot(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-xl file:border-0 file:bg-slate-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-slate-800"
                required
              />
              <p className="text-xs text-slate-500 mt-1">
                {isFr ? 'La capture est uploadée dans Storage (bucket documents) et le lien est ajouté au ticket.' : 'Screenshot is uploaded to Storage (documents bucket) and link is attached.'}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{isFr ? 'Priorité (SLA 6–72h)' : 'Priority (SLA 6–72h)'}</label>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
                value={createPriority}
                onChange={(e) => setCreatePriority(e.target.value as TicketIT['priority'])}
              >
                {(Object.keys(priorityLabels) as Array<keyof typeof priorityLabels>).map((p) => (
                  <option key={p} value={p}>{priorityLabels[p]}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                {isFr ? `Délai cible: ${dueHoursForPriority(createPriority)}h (selon priorité).` : `Target time: ${dueHoursForPriority(createPriority)}h (by priority).`}
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{isFr ? 'Portée de l’incident' : 'Incident scope'}</label>
              <select
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-slate-900"
                value={createVisibilityScope}
                onChange={(e) => setCreateVisibilityScope(e.target.value as TicketITVisibilityScope)}
              >
                {(Object.keys(scopeLabels) as TicketITVisibilityScope[]).map((s) => (
                  <option key={s} value={s}>{scopeLabels[s]}</option>
                ))}
              </select>
              <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={createBroadcastOnCreate}
                  onChange={(e) => setCreateBroadcastOnCreate(e.target.checked)}
                />
                {isFr ? 'Diffuser à tous dès la soumission (anti-doublon incident)' : 'Broadcast to all on submission (incident dedup)'}
              </label>
            </div>
            <ExtensibleSelect
              entityType="ticket_issue_type"
              value={createIssueTypeId}
              onChange={(id) => setCreateIssueTypeId(id)}
              organizationId={organizationId}
              canCreate={true}
              canEdit={true}
              label={isFr ? 'Type de panne' : 'Issue type'}
              placeholder={isFr ? '— Choisir —' : '— Select —'}
            />
            <div className="flex gap-2">
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-slate-800"
                disabled={createSubmitting}
              >
                {createSubmitting ? (isFr ? 'Création…' : 'Creating…') : (isFr ? 'Créer (brouillon)' : 'Create (draft)')}
              </button>
              <button
                type="button"
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
                onClick={() => setShowCreateForm(false)}
              >
                {isFr ? 'Annuler' : 'Cancel'}
              </button>
            </div>
          </form>
        </div>
      )}

      {selectedTicket ? (
        <div className="mb-6 rounded-coya border border-coya-border bg-coya-card p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-semibold text-coya-text">{selectedTicket.title}</h2>
              <p className="text-sm text-coya-text-muted mt-1">
                #{selectedTicket.id.slice(0, 8)} · {statusLabels[selectedTicket.status]} · {priorityLabels[selectedTicket.priority || 'medium']}
              </p>
            </div>
            <button
              type="button"
              className="text-coya-text-muted hover:text-coya-text"
              onClick={() => setSelectedTicket(null)}
              aria-label={isFr ? 'Fermer' : 'Close'}
            >
              <i className="fas fa-times" />
            </button>
          </div>
          <div className="prose prose-sm text-coya-text mb-4">
            <p className="whitespace-pre-wrap">{selectedTicket.description || '—'}</p>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-coya-text-muted mb-4">
            <dt>{isFr ? 'Créé par' : 'Created by'}</dt>
            <dd>{selectedTicket.createdByName || selectedTicket.createdById}</dd>
            <dt>{isFr ? 'Créé le' : 'Created at'}</dt>
            <dd>{selectedTicket.createdAt ? new Date(selectedTicket.createdAt).toLocaleString() : '—'}</dd>
            <dt>{isFr ? 'Portée' : 'Scope'}</dt>
            <dd>{scopeLabels[selectedTicket.visibilityScope || 'self']}</dd>
            {selectedTicket.validatedAt && (
              <>
                <dt>{isFr ? 'Validé / refusé le' : 'Validated at'}</dt>
                <dd>{new Date(selectedTicket.validatedAt).toLocaleString()}</dd>
                {selectedTicket.validatedByName && (
                  <>
                    <dt>{isFr ? 'Par' : 'By'}</dt>
                    <dd>{selectedTicket.validatedByName}</dd>
                  </>
                )}
              </>
            )}
            {selectedTicket.assignedToName && (
              <>
                <dt>{isFr ? 'Assigné à' : 'Assigned to'}</dt>
                <dd>{selectedTicket.assignedToName}</dd>
              </>
            )}
            {selectedTicket.resolvedAt && (
              <>
                <dt>{isFr ? 'Résolu le' : 'Resolved at'}</dt>
                <dd>{new Date(selectedTicket.resolvedAt).toLocaleString()}</dd>
                {selectedTicket.resolutionNotes && (
                  <>
                    <dt>{isFr ? 'Notes de résolution' : 'Resolution notes'}</dt>
                    <dd className="text-coya-text">{selectedTicket.resolutionNotes}</dd>
                  </>
                )}
              </>
            )}
            {selectedTicket.rejectionReason && (
              <>
                <dt>{isFr ? 'Commentaire de revue' : 'Review comment'}</dt>
                <dd className="text-coya-text">{selectedTicket.rejectionReason}</dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            {(selectedTicket.status === 'draft' || selectedTicket.status === 'needs_reformulation') && isCreator(selectedTicket) && (
              <button
                type="button"
                className="rounded-coya bg-coya-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={() => submitForValidation(selectedTicket)}
                disabled={actionLoading}
              >
                {selectedTicket.status === 'needs_reformulation'
                  ? (isFr ? 'Re-soumettre après reformulation' : 'Resubmit after reformulation')
                  : (isFr ? 'Soumettre en validation' : 'Submit for validation')}
              </button>
            )}
            {canValidate(selectedTicket) && (
              <>
                <button
                  type="button"
                  className="rounded-coya bg-green-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  onClick={() => validateTicket(selectedTicket)}
                  disabled={actionLoading}
                >
                  {isFr ? 'Valider' : 'Validate'}
                </button>
              </>
            )}
            {canReject(selectedTicket) && (
              <>
                <button
                  type="button"
                  className="rounded-coya border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-amber-800 disabled:opacity-50"
                  onClick={() => { setReformulateModalTicket(selectedTicket); setReformulateComment(''); }}
                  disabled={actionLoading}
                >
                  {isFr ? 'Demander reformulation' : 'Request reformulation'}
                </button>
                <button
                  type="button"
                  className="rounded-coya bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  onClick={() => { setRejectModalTicket(selectedTicket); setRejectReason(''); }}
                  disabled={actionLoading}
                >
                  {isFr ? 'Rejeter' : 'Reject'}
                </button>
              </>
            )}
            {canSendToIt(selectedTicket) && (
              <button
                type="button"
                className="rounded-coya bg-coya-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={() => sendToIt(selectedTicket)}
                disabled={actionLoading}
              >
                {isFr ? 'Envoyer à l\'IT' : 'Send to IT'}
              </button>
            )}
            {selectedTicket.status === 'sent_to_it' && canAssignOrProgress(selectedTicket) && (
              <>
                <button
                  type="button"
                  className="rounded-coya border border-coya-border px-3 py-1.5 text-sm text-coya-text"
                  onClick={() => { setAssignModalTicket(selectedTicket); setAssignUserId(selectedTicket.assignedToId || ''); setAssignUserName(selectedTicket.assignedToName || ''); }}
                  disabled={actionLoading}
                >
                  {isFr ? 'Assigner' : 'Assign'}
                </button>
                <button
                  type="button"
                  className="rounded-coya bg-coya-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  onClick={() => markInProgress(selectedTicket)}
                  disabled={actionLoading}
                >
                  {isFr ? 'Prendre en charge' : 'Take in progress'}
                </button>
              </>
            )}
            {selectedTicket.status === 'in_progress' && canAssignOrProgress(selectedTicket) && (
              <button
                type="button"
                className="rounded-coya border border-coya-border px-3 py-1.5 text-sm text-coya-text"
                onClick={() => { setAssignModalTicket(selectedTicket); setAssignUserId(selectedTicket.assignedToId || ''); setAssignUserName(selectedTicket.assignedToName || ''); }}
                disabled={actionLoading}
              >
                {isFr ? 'Réassigner' : 'Reassign'}
              </button>
            )}
            {canResolve(selectedTicket) && (
              <button
                type="button"
                className="rounded-coya bg-green-600 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                onClick={() => { setResolveModalTicket(selectedTicket); setResolveNotes(''); }}
                disabled={actionLoading}
              >
                {isFr ? 'Marquer résolu' : 'Mark resolved'}
              </button>
            )}
          </div>
        </div>
      ) : null}

      <div className="rounded-coya border border-coya-border bg-coya-card overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-coya-bg text-coya-text-muted">
            <tr>
              <th className="p-3 font-medium">{isFr ? 'Titre' : 'Title'}</th>
              <th className="p-3 font-medium">{isFr ? 'Statut' : 'Status'}</th>
              <th className="p-3 font-medium">{isFr ? 'Priorité' : 'Priority'}</th>
              <th className="p-3 font-medium">{isFr ? 'SLA' : 'SLA'}</th>
              <th className="p-3 font-medium">{isFr ? 'Créé le' : 'Created'}</th>
              <th className="p-3 font-medium">{isFr ? 'Créé par' : 'Created by'}</th>
            </tr>
          </thead>
          <tbody className="text-coya-text">
            {loading ? (
              <tr><td colSpan={6} className="p-4 text-center text-coya-text-muted">{isFr ? 'Chargement…' : 'Loading…'}</td></tr>
            ) : tickets.length === 0 ? (
              <tr><td colSpan={6} className="p-4 text-center text-coya-text-muted">{isFr ? 'Aucun ticket' : 'No tickets'}</td></tr>
            ) : (
              tickets.map((t) => (
                <tr
                  key={t.id}
                  className="border-t border-coya-border hover:bg-coya-bg/50 cursor-pointer"
                  onClick={() => setSelectedTicket(t)}
                >
                  <td className="p-3 font-medium">{t.title}</td>
                  <td className="p-3">{statusLabels[t.status]}</td>
                  <td className="p-3">{priorityLabels[t.priority || 'medium']}</td>
                  <td className="p-3">
                    {(() => {
                      const sla = computeSla(t);
                      if (!sla) {
                        return (
                          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                            {isFr ? 'Démarre après acceptation' : 'Starts after acceptance'}
                          </span>
                        );
                      }
                      const text = sla.overdue
                        ? (isFr ? `En retard (${formatRemaining(sla.remainingMs)})` : `Overdue (${formatRemaining(sla.remainingMs)})`)
                        : (isFr ? `Reste ${formatRemaining(sla.remainingMs)}` : `Remaining ${formatRemaining(sla.remainingMs)}`);
                      return (
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${sla.overdue ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-700'}`}>
                          {text}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="p-3">{t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '—'}</td>
                  <td className="p-3">{t.createdByName || t.createdById}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {rejectModalTicket && (
        <ConfirmationModal
          title={isFr ? 'Refuser le ticket' : 'Reject ticket'}
          message={isFr ? 'Indiquez le motif de refus (optionnel).' : 'Provide rejection reason (optional).'}
          confirmLabel={isFr ? 'Refuser' : 'Reject'}
          cancelLabel={isFr ? 'Annuler' : 'Cancel'}
          onConfirm={rejectTicket}
          onCancel={() => { setRejectModalTicket(null); setRejectReason(''); }}
          variant="danger"
          isLoading={actionLoading}
        >
          <textarea
            className="mt-2 w-full rounded-coya border border-coya-border bg-coya-bg px-3 py-2 text-coya-text min-h-[80px]"
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder={isFr ? 'Motif…' : 'Reason…'}
          />
        </ConfirmationModal>
      )}

      {reformulateModalTicket && (
        <ConfirmationModal
          title={isFr ? 'Demander une reformulation' : 'Request reformulation'}
          message={isFr ? 'Ajoutez une précision pour le demandeur (obligatoire).' : 'Add clarification for requester (required).'}
          confirmLabel={isFr ? 'Envoyer la demande' : 'Send request'}
          cancelLabel={isFr ? 'Annuler' : 'Cancel'}
          onConfirm={requestReformulation}
          onCancel={() => { setReformulateModalTicket(null); setReformulateComment(''); }}
          variant="warning"
          isLoading={actionLoading}
        >
          <textarea
            className="mt-2 w-full rounded-coya border border-coya-border bg-coya-bg px-3 py-2 text-coya-text min-h-[80px]"
            value={reformulateComment}
            onChange={(e) => setReformulateComment(e.target.value)}
            placeholder={isFr ? 'Ex: Merci de préciser l’étape, l’écran et le message d’erreur exact.' : 'E.g. Please specify step, screen, and exact error message.'}
          />
        </ConfirmationModal>
      )}

      {resolveModalTicket && (
        <ConfirmationModal
          title={isFr ? 'Marquer comme résolu' : 'Mark as resolved'}
          message={isFr ? 'Notes de résolution (optionnel).' : 'Resolution notes (optional).'}
          confirmLabel={isFr ? 'Résoudre' : 'Resolve'}
          cancelLabel={isFr ? 'Annuler' : 'Cancel'}
          onConfirm={resolveTicket}
          onCancel={() => { setResolveModalTicket(null); setResolveNotes(''); }}
          variant="primary"
          isLoading={actionLoading}
        >
          <textarea
            className="mt-2 w-full rounded-coya border border-coya-border bg-coya-bg px-3 py-2 text-coya-text min-h-[80px]"
            value={resolveNotes}
            onChange={(e) => setResolveNotes(e.target.value)}
            placeholder={isFr ? 'Notes…' : 'Notes…'}
          />
        </ConfirmationModal>
      )}

      {assignModalTicket && (
        <ConfirmationModal
          title={isFr ? 'Assigner le ticket' : 'Assign ticket'}
          message={isFr ? 'ID et nom de l\'utilisateur assigné (saisie manuelle).' : 'Assigned user ID and name (manual).'}
          confirmLabel={isFr ? 'Enregistrer' : 'Save'}
          cancelLabel={isFr ? 'Annuler' : 'Cancel'}
          onConfirm={assignTicket}
          onCancel={() => { setAssignModalTicket(null); setAssignUserId(''); setAssignUserName(''); }}
          variant="primary"
          isLoading={actionLoading}
        >
          <div className="mt-2 space-y-2">
            <input
              type="text"
              className="w-full rounded-coya border border-coya-border bg-coya-bg px-3 py-2 text-coya-text"
              value={assignUserId}
              onChange={(e) => setAssignUserId(e.target.value)}
              placeholder="User ID"
            />
            <input
              type="text"
              className="w-full rounded-coya border border-coya-border bg-coya-bg px-3 py-2 text-coya-text"
              value={assignUserName}
              onChange={(e) => setAssignUserName(e.target.value)}
              placeholder={isFr ? 'Nom affiché' : 'Display name'}
            />
          </div>
        </ConfirmationModal>
      )}
    </StructuredModulePage>
  );
};

export default TicketITModule;
