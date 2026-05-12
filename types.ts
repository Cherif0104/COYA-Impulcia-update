

// Liste complète des rôles dans SENEGEL
export type Role = 
  // Rôles de gestion (accès Management Ecosysteia)
  'super_administrator' | 'administrator' | 'manager' | 'supervisor' | 'intern' |
  // RH, paie, recrutement & pilotage d’équipe (étendu)
  'hr_business_partner' | 'hr_officer' | 'recruiter' | 'payroll_specialist' | 'team_lead' |
  // Rôles d'accompagnement et de facilitation
  'trainer' | 'coach' | 'facilitator' | 'partner_facilitator' | 'mentor' |
  // Rôles académiques et jeunesse
  'student' | 'alumni' |
  // Rôles entrepreneurs & partenaires économiques
  'entrepreneur' | 'employer' | 'implementer' | 'funder' |
  // Rôles créatifs et médias
  'publisher' | 'editor' | 'producer' | 'artist';

/** Modules métier + administration (alignés Odoo / départements) */
export type ModuleName =
  | 'dashboard'
  | 'projects'
  | 'goals_okrs'
  | 'planning'
  | 'leave_management'
  | 'comptabilite'
  | 'coya_drive'
  | 'daf_services'
  | 'courses'
  | 'jobs'
  | 'crm_sales'
  | 'qualite'
  | 'rh'
  | 'trinite'
  | 'programme'
  | 'user_management'
  | 'course_management'
  | 'job_management'
  | 'leave_management_admin'
  | 'organization_management'
  | 'department_management'
  | 'postes_management'
  | 'settings'
  | 'logistique'
  | 'studio'
  | 'parc_auto'
  | 'ticket_it'
  | 'messagerie'
  | 'collecte';

/**
 * Variantes physiques d’« exécution » — convergence progressive vers un WorkItem unique (voir docs/adr/001-work-item-canonical-model.md).
 */
export type WorkItemKind =
  | 'task'
  | 'programme_action'
  | 'project_activity'
  | 'planning_slot'
  | 'meeting'
  | 'it_ticket'
  | 'vehicle_request'
  | 'course_session'
  | 'daf_service_request';

/** Référence stable pour orchestration / IA / bus événements */
export interface WorkItemCanonicalRef {
  kind: WorkItemKind;
  /** Table Postgres source (ou vue) pour la persistence actuelle */
  storageTable: string;
  id: string;
  organizationId?: string | null;
}

/** Cartographie indicative tables → concept WorkItem (compléter lors des fusions de modules) */
export const WORK_ITEM_STORAGE_BY_KIND: Record<WorkItemKind, string> = {
  task: 'tasks',
  programme_action: 'programme_actions',
  project_activity: 'project_activities',
  planning_slot: 'planning_slots',
  meeting: 'meetings',
  it_ticket: 'it_tickets',
  vehicle_request: 'vehicle_requests',
  course_session: 'course_sessions',
  daf_service_request: 'daf_service_requests',
};

export type ProfileStatus = 'pending' | 'active' | 'rejected';

/** Poste (fonction / intitulé du poste) – distinct du rôle, extensible comme Odoo */
export interface Poste {
  id: string;
  organizationId?: string | null;
  name: string;
  slug?: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// Organisation pour architecture multi-tenant
export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logoUrl?: string;
  website?: string;
  contactEmail?: string;
  isActive: boolean;
  /** true = organisation mère plateforme (données COYA) ; les autres sont des tenants hébergés */
  isPlatformRoot?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

/** Département (Phase 2) : rattaché à une organisation, liste de modules autorisés */
export interface Department {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  moduleSlugs: ModuleName[];
  sequence: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Rôle fonctionnel au sein d’un département (distinct du rôle plateforme `Role`) */
export type DepartmentMemberRole = 'member' | 'supervisor' | 'manager';

/** Liaison utilisateur (auth user id) ↔ département */
export interface UserDepartment {
  id: string;
  userId: string;
  departmentId: string;
  roleInDepartment?: DepartmentMemberRole | string | null;
  createdAt?: string;
}

// Rôles ayant accès au Management Ecosysteia (seule restriction)
export const MANAGEMENT_ROLES: Role[] = ['super_administrator', 'administrator', 'manager', 'supervisor', 'intern'];

export const RESOURCE_MANAGEMENT_ROLES: Role[] = [
  'super_administrator',
  'administrator',
  'manager',
  'supervisor',
  'trainer',
  'hr_business_partner',
  'hr_officer',
  'recruiter',
  'payroll_specialist',
  'team_lead',
];

// Tous les autres rôles n'ont pas accès au Management Ecosysteia
export const NON_MANAGEMENT_ROLES: Role[] = [
  'trainer', 'coach', 'facilitator', 'partner_facilitator', 'mentor',
  'hr_business_partner', 'hr_officer', 'recruiter', 'payroll_specialist', 'team_lead',
  'student', 'alumni',
  'entrepreneur', 'employer', 'implementer', 'funder',
  'publisher', 'editor', 'producer', 'artist'
];

// Rôles accessibles à l'inscription publique (n'importe qui peut s'inscrire avec ces rôles)
export const PUBLIC_ROLES: Role[] = [
  // Académique & jeunesse
  'student', 'alumni',
  // Professionnel & entrepreneurial
  'entrepreneur', 'employer', 'implementer', 'funder',
  // Créatif
  'publisher', 'editor', 'producer', 'artist',
  // Facilitation externe
  'partner_facilitator'
];

// Rôles réservés à SENEGEL (création uniquement par les admins SENEGEL, pas d'inscription publique)
export const SENEGEL_RESERVED_ROLES: Role[] = [
  // Gestion interne SENEGEL
  'super_administrator', 'administrator', 'manager', 'supervisor', 'intern',
  // Formation interne SENEGEL
  'trainer', 'facilitator', 'coach', 'mentor',
  // RH / paie / recrutement réservés organisation pilote
  'hr_business_partner', 'hr_officer', 'recruiter', 'payroll_specialist', 'team_lead',
];

/**
 * Création d’utilisateur depuis l’admin : ces rôles passent **actifs** tout de suite (rôle effectif = choix).
 * Tout autre rôle (management, formateur, RH, etc.) → compte **pending** + `pending_role` jusqu’à approbation.
 */
export const ROLES_ADMIN_CREATE_ACTIVE_DIRECTLY: Role[] = [
  'student',
  'alumni',
  'entrepreneur',
  'employer',
  'implementer',
  'funder',
  'publisher',
  'editor',
  'producer',
  'artist',
];

export function roleRequiresApprovalWhenCreatedByAdmin(role: Role): boolean {
  return !ROLES_ADMIN_CREATE_ACTIVE_DIRECTLY.includes(role);
}

/** Rôles soumis au workflow d’approbation (aligné sur `roleRequiresApprovalWhenCreatedByAdmin`). */
export const ROLES_REQUIRING_APPROVAL: Role[] = [
  'super_administrator',
  'administrator',
  'manager',
  'supervisor',
  'intern',
  'trainer',
  'coach',
  'facilitator',
  'mentor',
  'partner_facilitator',
  'hr_business_partner',
  'hr_officer',
  'recruiter',
  'payroll_specialist',
  'team_lead',
];

/** Rôles pouvant voir l’équipe au niveau organisation dans Planning (grille + RH intégré) */
export const PLANNING_ORG_SCOPE_ROLES: Role[] = [
  'super_administrator',
  'administrator',
  'manager',
  'supervisor',
  'intern',
  'hr_business_partner',
  'hr_officer',
  'recruiter',
  'payroll_specialist',
  'team_lead',
];

/** Rôles pouvant approuver / refuser les demandes d’échange de créneau (N+1 / pilotage). */
export const PLANNING_SWAP_APPROVER_ROLES: Role[] = [
  'super_administrator',
  'administrator',
  'manager',
  'supervisor',
  'team_lead',
];

export interface ModulePermission {
  id?: string;
  userId: string;
  moduleName: ModuleName;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canApprove: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface User {
  id: string | number; // UUID from Supabase (string) ou legacy number
  profileId?: string; // UUID du profil Supabase (profiles.id) - utilisé pour TimeLog.userId
  name: string;
  fullName?: string; // Alias pour name (utilisé par Supabase)
  email: string;
  avatar: string;
  role: Role;
  skills: string[];
  phone?: string;
  phoneNumber?: string;
  location?: string;
  bio?: string;
  website?: string;
  linkedinUrl?: string;
  githubUrl?: string;
  lastLogin?: string;
  createdAt?: string;
  updatedAt?: string;
  isActive?: boolean; // Statut d'activation de l'utilisateur (true par défaut)
  status?: ProfileStatus;
  pendingRole?: Role | null;
  /** Poste (ex. Directeur Général) – distinct du rôle */
  posteId?: string | null;
  posteName?: string | null;
  reviewComment?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  /** Organisation Supabase (`profiles.organization_id`) — utile affectation département à l’approbation */
  organizationId?: string | null;
}

export type RoleApprovalDecision = 'approved' | 'rejected';

export interface RoleApprovalLog {
  id: string;
  profileId: string;
  requestedRole: Role | string;
  decision: RoleApprovalDecision;
  comment?: string | null;
  decidedAt: string;
  decidedBy: string;
}

export interface FileAttachment {
  fileName: string;
  dataUrl: string;
}

export type EvidenceDocument = FileAttachment;
export type Receipt = FileAttachment;

/** Choix d’une question de quiz (formation / cours) */
export interface CourseQuizChoice {
  id: string;
  label: string;
}

/** Question à choix multiples, définie par le créateur de formation */
export interface CourseQuizQuestion {
  id: string;
  prompt: string;
  /** single = une seule bonne réponse ; multiple = plusieurs cases correctes */
  mode: 'single' | 'multiple';
  choices: CourseQuizChoice[];
  correctChoiceIds: string[];
}

export interface Lesson {
  id: string;
  title: string;
  type: 'video' | 'reading' | 'quiz';
  duration: string;
  icon: string;
  description?: string;
  contentUrl?: string;
  attachments?: EvidenceDocument[];
  externalLinks?: Array<{ label: string; url: string }>;
  /** Stocké en JSON (`quiz`) côté Supabase : ensemble des questions de la leçon */
  quizQuestions?: CourseQuizQuestion[];
}

/** Public ou parcours visuel (couverture, ton) — extensible */
export type CourseAudienceSegment = 'general' | 'incubated' | 'beneficiary';

/** Workflow éditorial avant publication (distinct de `status` draft/published). */
export type CoursePublishWorkflowStatus = 'none' | 'in_review' | 'approved' | 'changes_requested';

/** Session / cohorte d’exécution d’un cours (LMS). */
export type CourseSessionStatus = 'planned' | 'open' | 'closed' | 'cancelled';

/** Rôle dans une cohorte (distinct du `Role` plateforme sur `profiles`). */
export type CohortParticipantRole = 'learner' | 'coach' | 'mentor' | 'trainer' | 'facilitator';

export interface CourseSession {
  id: string;
  organizationId: string;
  courseId: string;
  title: string;
  startsAt?: string | null;
  endsAt?: string | null;
  capacity?: number | null;
  status: CourseSessionStatus;
  /** Cohorte / groupe au niveau programme (promotion transverse). */
  programmeId?: string | null;
  /** Cohorte / groupe au niveau projet (delivery). */
  projectId?: string | null;
  /** Activité programme (`programme_actions`) — maillon « Activités » de la chaîne métier. */
  programmeActionId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Inscription d’un utilisateur à une session (liste aperçu — phase 3 complète). */
export interface CourseSessionEnrollment {
  id: string;
  organizationId: string;
  courseSessionId: string;
  userId: string;
  status: string;
  /** Rôle pédagogique dans la cohorte (facilitateur, apprenant…). */
  cohortRole?: CohortParticipantRole;
  createdAt?: string;
}

/** Attestation / certificat LMS (schéma minimal — émission hors périmètre MVP). */
export type LearningCertificateStatus = 'draft' | 'issued' | 'revoked';

export interface LearningCertificate {
  id: string;
  organizationId: string;
  courseId: string;
  userId: string;
  courseSessionId?: string | null;
  status: LearningCertificateStatus;
  certificateNumber?: string | null;
  issuedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Accès apprenant invité (fenêtre temporelle) — persisté dans `apex_temporary_access`
 * avec jeton hashé et fenêtre de validité.
 */
export interface ApexTemporaryLearnerAccess {
  id: string;
  courseId: string;
  email: string;
  validFrom: string;
  validUntil: string;
  accessToken?: string | null;
  linkedProfileId?: string | null;
   /** Lien direct `/apex/access?token=…` (renvoyé uniquement à la création côté UI). */
  magicLink?: string | null;
  revokedAt?: string | null;
  createdAt?: string | null;
}

/** Gabarit certificat APEX (JSON — génération PDF via service à brancher). */
export interface ApexCertificateTemplate {
  id: string;
  name: string;
  body: Record<string, unknown>;
}

export interface Module {
  id: string;
  title: string;
  lessons: Lesson[];
  evidenceDocuments?: EvidenceDocument[];
  requiresValidation?: boolean;
  unlocksNextModule?: boolean;
}

export interface Course {
  id: string; // UUID from Supabase
  title: string;
  instructor: string;
  instructorId?: string;
  description: string;
  duration: number | string; // En heures ou "6 Weeks" pour compatibilité
  level?: 'beginner' | 'intermediate' | 'advanced';
  category?: string;
  price?: number;
  status?: 'draft' | 'published' | 'archived';
  thumbnailUrl?: string;
  rating?: number;
  studentsCount?: number;
  lessonsCount?: number;
  createdAt?: string;
  updatedAt?: string;
  // Nouveaux champs pour ciblage et liens
  targetStudents?: string[] | null; // Array de user IDs (null = tous les utilisateurs)
  youtubeUrl?: string | null;
  driveUrl?: string | null;
  otherLinks?: Array<{ url: string; type: string; label: string }> | null;
  // Champs pour compatibilité avec l'ancienne structure
  progress?: number; // Progression de l'utilisateur actuel (0-100)
  icon?: string; // Icône par défaut
  modules?: Module[]; // Modules du cours
  completedLessons?: string[]; // Leçons complétées par l'utilisateur
  requiresFinalValidation?: boolean;
  sequentialModules?: boolean;
  courseMaterials?: EvidenceDocument[];
  /** Rattachement optionnel au module Programme (bailleurs, participants, etc.) */
  programmeId?: string | null;
  /** Cible pédagogique / présentation (incubés, bénéficiaires…) */
  audienceSegment?: CourseAudienceSegment | null;
  /** Workflow validation avant publication (colonnes LMS sur `courses`). */
  publishWorkflowStatus?: CoursePublishWorkflowStatus;
  submittedForReviewAt?: string | null;
  reviewedAt?: string | null;
  /** auth.users id du relecteur */
  reviewedBy?: string | null;
  /** Certification / attestation (MVP : flags + table `learning_certificates`). */
  certificationEnabled?: boolean;
  certificationLabel?: string | null;
}

// Source de candidature
export type ApplicationSource = 'online' | 'email' | 'link' | 'direct';

export interface JobApplication {
  id?: number;
  jobId: number;
  userId: string | number;
  userProfileId?: string; // UUID du profil Supabase
  source: ApplicationSource;
  appliedAt: string;
  status?: 'pending' | 'reviewed' | 'shortlisted' | 'rejected' | 'hired';
  matchScore?: number;
}

export interface ApplicationStats {
  total: number;
  bySource: {
    online: number;
    email: number;
    link: number;
    direct: number;
  };
}

export interface Job {
  id: number;
  title: string;
  company: string;
  location: string;
  type: 'Full-time' | 'Part-time' | 'Contract' | 'Freelance' | 'Internship' | 'Temporary' | 'Fixed-term' | 'Permanent' | 'Seasonal' | 'Volunteer';
  postedDate: string;
  description: string;
  requiredSkills: string[];
  applicants: User[];
  status?: 'published' | 'draft' | 'archived';
  // Champs supplémentaires complets
  sector?: string;
  experienceLevel?: 'Entry' | 'Mid' | 'Senior' | 'Executive' | 'Intern' | 'Graduate';
  remoteWork?: 'Remote' | 'Hybrid' | 'On-site';
  salary?: string;
  benefits?: string;
  education?: string;
  languages?: string;
  applicationLink?: string;
  applicationEmail?: string;
  companyWebsite?: string;
  // Statistiques de candidatures
  applicationStats?: ApplicationStats;
  applications?: JobApplication[]; // Liste détaillée des candidatures avec source
}

/** Critères SMART optionnels (Phase 2 – Projets) */
export interface TaskSmartCriteria {
  specific?: string;
  measurable?: string;
  achievable?: string;
  relevant?: string;
  timeBound?: string;
}
/** Notes SWOT optionnelles pour une tâche */
export interface TaskSwotNotes {
  strengths?: string;
  weaknesses?: string;
  opportunities?: string;
  threats?: string;
}

export interface Task {
  id: string;
  /** Activité de terrain (projet) — lien hiérarchique Programme → Projet → Activité → Tâche */
  activityId?: string | null;
  text: string;
  status: 'To Do' | 'In Progress' | 'Completed';
  priority: 'High' | 'Medium' | 'Low';
  assignee?: User;
  assigneeIds?: string[];
  departmentId?: string | null;
  estimatedHours?: number;
  loggedHours?: number;
  dueDate?: string;
  /** Objectif hebdo/jour : date et heure précises (Phase 2) */
  scheduledDate?: string;
  scheduledTime?: string;
  scheduledDurationMinutes?: number;
  /** Critères SMART (optionnel) */
  smartCriteria?: TaskSmartCriteria;
  swotNotes?: TaskSwotNotes;
  /** Gel : dépassement date/heure sans "Réalisé" (Phase 2) */
  isFrozen?: boolean;
  completedAt?: string;
  completedById?: string;
  /** Justificatif obligatoire : au moins une pièce jointe pour "Réalisé" (Phase 2) */
  justificationAttachmentIds?: string[];
  /** Pilotage manager : période, consigne, clôture auto / hors performance */
  taskGovernance?: 'open' | 'done_proven' | 'not_realized' | 'closed_out';
  periodStart?: string;
  periodEnd?: string;
  managerComment?: string;
  proofUrl?: string;
  proofStoragePath?: string;
  /** Impact productivité (0–1) — renseigné lors d’échéance non tenue ou clôture manager */
  productivityPenalty?: number;
}

export interface Risk {
  id: string;
  description: string;
  likelihood: 'High' | 'Medium' | 'Low';
  impact: 'High' | 'Medium' | 'Low';
  mitigationStrategy: string;
  ownerId?: string;
  dueDate?: string;
  status?: 'open' | 'mitigating' | 'closed';
}

export type CurrencyCode = 'USD' | 'EUR' | 'XOF';

export const SUPPORTED_CURRENCIES: CurrencyCode[] = ['USD', 'EUR', 'XOF'];

/** Ligne budgétaire par poste de dépense (Phase 2) */
export interface ProjectBudgetLine {
  id: string;
  label: string;
  plannedAmount: number;
  realAmount?: number;
  currency?: CurrencyCode;
}

export type ProjectStatus = 'Not Started' | 'In Progress' | 'Completed' | 'On Hold' | 'Cancelled';

/** Priorité projet (interface projets) – distincte de la priorité de tâche. */
export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Project {
  id: string;
  title: string;
  description: string;
  status: ProjectStatus;
  /** Priorité métier (mapping vers colonnes `projects.priority`). */
  priority?: ProjectPriority;
  dueDate: string;
  startDate?: string;
  /** Budget agrégé (champ simple côté projets, pour écrans synthèse). */
  budget?: number | null;
  /** Nom client / partenaire associé au projet. */
  clientName?: string | null;
  team: User[];
  tasks: Task[];
  risks: Risk[];
  teamMemberIds?: string[];
  createdById?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
  /** Budget prévisionnel et lignes (Phase 2) */
  budgetPlanned?: number;
  budgetCurrency?: CurrencyCode;
  budgetLines?: ProjectBudgetLine[];
  /** Lien programme (Phase 3 – Programme & Bailleur) */
  programmeId?: string | null;
  programmeName?: string | null;
  programmeBailleurName?: string | null;
}

/** Bailleur (Phase 3 – Programme & Bailleur) */
export interface Bailleur {
  id: string;
  organizationId?: string | null;
  name: string;
  code?: string | null;
  description?: string | null;
  contact?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Activité de terrain rattachée à un projet (niveau intermédiaire avant les tâches) */
export interface ProjectActivity {
  id: string;
  organizationId: string;
  programmeId?: string | null;
  projectId: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  sequence: number;
  /** MEL : indicateur / cible */
  melTargetLabel?: string | null;
  melTargetValue?: number | null;
  melResultValue?: number | null;
  melUnit?: string | null;
  melNotes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type BudgetCascadeScope = 'programme' | 'project' | 'activity' | 'task';

export type BudgetCascadeWorkflowStatus = 'draft' | 'submitted' | 'validated' | 'locked';

/** Agrégation budget cascade (vue SQL ou calcul équivalent). */
export interface BudgetRollupByPostRow {
  programmeId: string;
  expensePostCode: string;
  currency: string;
  totalPlanned: number;
  totalActual: number;
  variancePlannedMinusActual: number;
  lineCount: number;
}

export interface BudgetRollupByScopeRow {
  programmeId: string;
  scopeLevel: BudgetCascadeScope;
  currency: string;
  totalPlanned: number;
  totalActual: number;
  variancePlannedMinusActual: number;
  lineCount: number;
}

/** Soumission formulaire collecte (local, prête pour branchement API). */
export interface DataCollectionSubmission {
  id: string;
  collectionId: string;
  organizationId?: string | null;
  submittedAt: string;
  /** Champs formulaire (email, téléphone, nom, etc.) */
  payload: Record<string, string>;
  syncedToCrm?: boolean;
  crmContactId?: string | null;
}

/** Ligne budgétaire avec cascade Programme → Projet → Activité → Tâche */
export interface BudgetCascadeLine {
  id: string;
  organizationId: string;
  scopeLevel: BudgetCascadeScope;
  programmeId: string;
  projectId?: string | null;
  activityId?: string | null;
  /** Id de la tâche dans le JSON du projet lorsque scopeLevel = task */
  projectTaskId?: string | null;
  parentLineId?: string | null;
  expensePostCode?: string | null;
  label: string;
  plannedAmount: number;
  actualAmount: number;
  currency: string;
  workflowStatus: BudgetCascadeWorkflowStatus;
  createdAt?: string;
  updatedAt?: string;
}

/** Programme (Phase 3) : financé par un bailleur, regroupe projets et lignes budgétaires */
export interface Programme {
  id: string;
  organizationId?: string | null;
  name: string;
  code?: string | null;
  description?: string | null;
  bailleurId?: string | null;
  bailleurName?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  /** Si false, pas de création / mise en avant de projets pour ce programme */
  allowProjects?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type ProgrammeStakeholderType =
  | 'facilitator'
  | 'implementation_partner'
  /** Partenaire opérationnel / exécutant sur le terrain */
  | 'executing_partner'
  | 'donor_contact'
  | 'technical'
  /** Personnel interne COYA (profil plateforme) */
  | 'internal_staff'
  | 'other';

export interface ProgrammeStakeholder {
  id: string;
  programmeId: string;
  stakeholderType: ProgrammeStakeholderType;
  profileId?: string | null;
  externalName?: string | null;
  externalRole?: string | null;
  externalContact?: string | null;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type ProgrammeActionStatus =
  | 'draft'
  | 'pending_validation'
  | 'validated'
  | 'assigned'
  | 'done'
  | 'cancelled'
  | 'not_realized';

export interface ProgrammeAction {
  id: string;
  programmeId: string;
  title: string;
  actionType: string;
  status: ProgrammeActionStatus;
  executorProfileId?: string | null;
  validatedByProfileId?: string | null;
  validatedAt?: string | null;
  dueDate?: string | null;
  /** Début de période (inclusive), format date YYYY-MM-DD */
  periodStart?: string | null;
  /** Fin de période / échéance : au-delà, clôture auto en non réalisé si pas « fait » */
  periodEnd?: string | null;
  /** Preuve externe (URL) lors du marquage réalisé */
  proofUrl?: string | null;
  /** Chemin Storage (capture d’écran) */
  proofStoragePath?: string | null;
  completedByProfileId?: string | null;
  completedAt?: string | null;
  assigneeProfileIds: string[];
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProgrammeDataRow {
  id: string;
  programmeId: string;
  section: string;
  rowData: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProgrammeBailleurLink {
  id: string;
  programmeId: string;
  bailleurId: string;
  bailleurName?: string | null;
  createdAt?: string;
}

/** Ligne budgétaire au niveau programme (poste de dépense) */
export interface ProgrammeBudgetLine {
  id: string;
  programmeId: string;
  label: string;
  plannedAmount: number;
  spentAmount?: number;
  currency?: CurrencyCode;
  createdAt?: string;
  updatedAt?: string;
}

/** Demande de dépense (Phase 2 – circuit dépense) */
export type ExpenseRequestStatus = 'draft' | 'submitted' | 'quoted' | 'validated' | 'rejected' | 'justified';

export interface ExpenseRequest {
  id: string;
  programmeId?: string | null;
  organizationId?: string | null;
  title: string;
  amount: number;
  currency: string;
  status: ExpenseRequestStatus;
  requestedById?: string | null;
  validatedById?: string | null;
  rejectedReason?: string | null;
  justificationComment?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Comptabilité SYSCOHADA (Phase 4) – Plan comptable */
export type ChartAccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

/** Cadre d'usage du compte (both = SYSCOHADA et SYCEBNL) */
export type ChartAccountFramework = 'both' | 'syscohada' | 'sycebnl';

export interface ChartOfAccount {
  id: string;
  organizationId: string;
  code: string;
  label: string;
  accountType: ChartAccountType;
  parentId?: string | null;
  framework?: ChartAccountFramework | null;
  isCashFlowRegister?: boolean;
  isActive: boolean;
  sequence?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Journaux comptables */
export type AccountingJournalType = 'general' | 'bank' | 'cash' | 'sales' | 'purchase' | 'various';

export interface AccountingJournal {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  journalType: AccountingJournalType;
  currency?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Cadre comptable (SYSCOHADA vs SYCEBNL / EBNL) */
export type AccountingFramework = 'syscohada' | 'sycebnl';

/** Statut d'une écriture (audit P2) : brouillon, validée, verrouillée */
export type JournalEntryStatus = 'draft' | 'validated' | 'locked';

/** Type de pièce justificative */
export type AttachmentType = 'file' | 'link' | 'resource';

/** Écriture (pièce) – avec traçabilité / pièces justificatives et statut */
export interface JournalEntry {
  id: string;
  organizationId: string;
  journalId: string;
  entryDate: string;
  reference?: string | null;
  description?: string | null;
  documentNumber?: string | null;
  attachmentType?: AttachmentType | null;
  attachmentUrl?: string | null;
  attachmentStoragePath?: string | null;
  resourceName?: string | null;
  resourceDatabaseUrl?: string | null;
  status?: JournalEntryStatus;
  createdAt?: string;
  updatedAt?: string;
  createdById?: string | null;
  lines?: JournalEntryLine[];
}

/** Rôle métier Comptabilité (audit P2) : viewer, editor, validator, admin */
export type AccountingPermissionRole = 'viewer' | 'editor' | 'validator' | 'admin';

/** Droits Comptabilité par utilisateur (audit P2) */
export interface AccountingPermission {
  id: string;
  organizationId: string;
  userId: string;
  role: AccountingPermissionRole;
  allowedJournalIds?: string[] | null;
  allowedCostCenterIds?: string[] | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Exercice comptable (audit P2) */
export interface FiscalYear {
  id: string;
  organizationId: string;
  label: string;
  dateStart: string;
  dateEnd: string;
  isClosed: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Options Comptabilité par organisation (audit P2) : activer/désactiver sous-modules */
export interface OrganizationAccountingFeatures {
  id: string;
  organizationId: string;
  enableAnalytical: boolean;
  enableBudget: boolean;
  enableFiscal: boolean;
  enableCashFlowReport: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Pièce jointe binaire sur une écriture */
export interface JournalEntryAttachment {
  id: string;
  entryId: string;
  filePath: string;
  name: string;
  mimeType?: string | null;
  fileSize?: number | null;
  createdAt?: string;
}

/** Ligne d'écriture (débit/crédit) – analytique et fiscal */
export interface JournalEntryLine {
  id: string;
  entryId: string;
  accountId: string;
  label?: string | null;
  debit: number;
  credit: number;
  sequence?: number;
  costCenterId?: string | null;
  fiscalCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
  accountCode?: string;
  accountLabel?: string;
  /**
   * Dimensions analytiques transverses (Phase 4+) :
   * rattachements optionnels vers les autres modules COYA.
   * Stockage côté base : colonnes dédiées ou JSON selon migrations ultérieures.
   */
  projectId?: string | null;
  programmeId?: string | null;
  activityId?: string | null;
  vehicleRequestId?: string | null;
  /** Référence canonique WorkItem (tâche/activité/etc.) – voir WorkItemCanonicalRef. */
  workItemRef?: WorkItemCanonicalRef | null;
  /** Métadonnées libres pour passer des informations de rapprochement métier. */
  metadata?: Record<string, unknown> | null;
}

/** Centre de coûts (comptabilité analytique) */
export interface CostCenter {
  id: string;
  organizationId: string;
  code: string;
  label: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Règle fiscale (taux, code) */
export interface FiscalRule {
  id: string;
  organizationId: string;
  code: string;
  label: string;
  rate: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Budget (prévisionnel par exercice, module Comptabilité) */
export interface AccountingBudget {
  id: string;
  organizationId: string;
  name: string;
  fiscalYear: number;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** Ligne de budget (compte + centre optionnel + montant) – Comptabilité */
export interface AccountingBudgetLine {
  id: string;
  budgetId: string;
  accountId: string;
  costCenterId?: string | null;
  amount: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Paramètres comptables organisation (cadre SYSCOHADA/SYCEBNL) */
export interface OrganizationAccountingSettings {
  id: string;
  organizationId: string;
  accountingFramework: AccountingFramework;
  /**
   * Configuration optionnelle du pont factures/dépenses → comptabilité.
   * Persistée en JSONB dans `organization_accounting_settings.bridge_config`.
   */
  bridgeConfig?: {
    /** Compte client (classe 41…) pour les factures clients. */
    invoiceReceivableAccountId?: string | null;
    /** Compte de produits (classe 70…) pour les factures clients. */
    invoiceRevenueAccountId?: string | null;
    /** Compte de TVA collectée (classe 44…) pour les factures clients. */
    invoiceVatAccountId?: string | null;
    /** Journal de ventes à utiliser pour le pont factures. */
    invoiceJournalId?: string | null;
  };
  createdAt?: string;
  updatedAt?: string;
}

/** Lettrage (matching) de lignes comptables */
export interface AccountingMatchingGroup {
  id: string;
  organizationId: string;
  code: string;
  accountId: string;
  matchedAt?: string | null;
  note?: string | null;
  createdById?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lineIds?: string[];
}

/** Rapprochement bancaire / caisse */
export interface AccountingReconciliation {
  id: string;
  organizationId: string;
  journalId: string;
  accountId: string;
  statementReference: string;
  statementDate: string;
  statementBalance: number;
  bookBalance: number;
  variance: number;
  status: 'draft' | 'validated';
  notes?: string | null;
  createdById?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Cloture de periode comptable */
export interface AccountingPeriodClosure {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  closureType: 'month' | 'quarter' | 'semester' | 'year';
  status: 'closed' | 'reopened';
  reason?: string | null;
  closedById?: string | null;
  closedAt?: string | null;
  reopenedById?: string | null;
  reopenedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Bénéficiaire (Phase 3) : thème, cible, secteur, lien programme/projet, optionnellement Collecte */
export interface Beneficiaire {
  id: string;
  organizationId?: string | null;
  programmeId?: string | null;
  projectId?: string | null;
  /** Fiche CRM créée ou liée depuis la collecte terrain */
  crmContactId?: string | null;
  theme?: string | null;
  target?: string | null;
  gender?: string | null;
  sector?: string | null;
  country?: string | null;
  region?: string | null;
  contact?: string | null;
  age?: string | null;
  education?: string | null;
  profession?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Ticket IT (Phase 6) : création → validation manager → envoi IT */
export type TicketITStatus =
  | 'draft'             // brouillon
  | 'pending_validation' // en attente validation manager
  | 'needs_reformulation' // demande de reformulation au demandeur
  | 'validated'         // validé par manager
  | 'sent_to_it'       // envoyé au département IT
  | 'in_progress'      // en cours de traitement
  | 'resolved'         // résolu
  | 'rejected';        // refusé par manager

export type TicketITVisibilityScope = 'self' | 'team' | 'all_users';

export interface TicketIT {
  id: string;
  organizationId?: string | null;
  title: string;
  description: string;
  status: TicketITStatus;
  visibilityScope?: TicketITVisibilityScope;
  broadcastOnCreate?: boolean;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  issueTypeId?: string | null;
  issueTypeName?: string | null;
  createdById: string;
  createdByName?: string;
  createdAt: string;
  updatedAt?: string;
  /** Validation manager */
  validatedById?: string | null;
  validatedByName?: string | null;
  validatedAt?: string | null;
  rejectionReason?: string | null;
  /** Assignation IT */
  assignedToId?: string | null;
  assignedToName?: string | null;
  sentToItAt?: string | null;
  resolvedAt?: string | null;
  resolutionNotes?: string | null;
}

/** Pièce jointe projet (Phase 2.4) : fichier dans Storage + métadonnées en BDD */
export interface ProjectAttachment {
  id: string;
  projectId: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  mimeType?: string;
  uploadedById?: string;
  createdAt: string;
  /** URL signée ou publique pour affichage (remplie par le service) */
  url?: string;
}

/** Barème scoring (Phase 2) : +5 % salarié, +7 % manager qui clôture */
export const TASK_SCORE_PERCENT_EMPLOYEE = 5;
export const TASK_SCORE_PERCENT_MANAGER = 7;
/** Seuils d'évaluation (Phase 2) */
export const SCORING_THRESHOLDS = {
  excellent: 100,
  veryGood: 90,
  good: 80,
  toEncourage: 70,
  insufficient: 60,
  veryInsufficient: 50,
  veryLow: 40,
} as const;

/** Paramètres d'administration du module Projets (Phase 2.4 + Phase 2 scoring) */
export interface ProjectModuleSettings {
  id: string;
  organizationId: string;
  projectTypes: string[];
  statuses: string[];
  alertDelayDays: number;
  taskTemplates: Array<{ title: string; defaultPriority?: string }>;
  /** Scoring : % par tâche réalisée (salarié) / manager qui clôture (Phase 2) */
  taskScorePercent?: number;
  managerScorePercent?: number;
  /** Justificatif obligatoire pour marquer "Réalisé" (Phase 2) */
  requireJustificationForCompletion?: boolean;
  /** Gel auto si date/heure dépassée sans Réalisé (Phase 2) */
  autoFreezeOverdueTasks?: boolean;
  /** Date de démarrage des évaluations / scoring (Phase 14) : seules les tâches réalisées après cette date comptent pour le score */
  evaluationStartDate?: string | null;
  /** SLA RH: nombre de jours avant escalade des congés en attente */
  leavePendingSlaDays?: number;
  /** Alerte budget warning (%) */
  budgetWarningPercent?: number;
  /** Alerte budget critique (%) */
  budgetCriticalPercent?: number;
  /** Ecart autorisé objectif (%). Au-delà -> off-track */
  objectiveOffTrackGapPercent?: number;
  createdAt?: string;
  updatedAt?: string;
}

/** Type de créneau planning (Phase 3) */
export type PlanningSlotType = 'telework' | 'onsite' | 'leave' | 'meeting' | 'modulation' | 'other';

export interface PlanningSlot {
  id: string;
  userId: string;
  slotDate: string;
  slotType: PlanningSlotType;
  startTime?: string;
  endTime?: string;
  meetingId?: string;
  title?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  createdById?: string;
}

export interface KeyResult {
  id: string;
  title: string;
  current: number;
  target: number;
  unit: string;
}

/** Type d'entité pour objectifs SMART transverses (Phase 0.4) */
export type ObjectiveEntityType = 'project' | 'programme' | 'user' | 'department' | 'course' | 'other';

export interface Objective {
  id: string;
  projectId: string; // rétrocompatibilité ; préférer entityType + entityId
  /** Entité liée (SMART transverse) */
  entityType?: ObjectiveEntityType;
  entityId?: string;
  title: string;
  description?: string;
  quarter?: string;
  year?: number;
  ownerId?: string;
  ownerName?: string;
  status?: string;
  progress?: number;
  priority?: string;
  startDate?: string;
  endDate?: string;
  category?: string;
  teamMembers?: string[];
  keyResults: KeyResult[];
  createdAt?: string;
  updatedAt?: string;
}

/** Rattachement métier extensible (projet, programme, formation, émission, etc.) */
export interface DataCollectionAssignment {
  /** Clé stable : `project` | `programme` | `formation` ou clé personnalisée (ex. `emission`). */
  categoryKey: string;
  targetId: string;
  /** Libellé affichage (évite une requête lors des listes). */
  targetLabel?: string;
  /** Uniquement si `categoryKey === 'project'` */
  activityId?: string | null;
}

/** Campagne / stratégie de collecte de données (projet, programme ou formation globale – hors formation RH) */
export interface DataCollection {
  id: string;
  organizationId?: string | null;
  name: string;
  description?: string;
  status?: 'draft' | 'active' | 'archived';
  /**
   * Rattachement générique (prioritaire si présent). Les champs `projectId` / `programmeId` / `formationId`
   * restent synchronisés pour compatibilité (filtres, CRM, backfill).
   */
  assignment?: DataCollectionAssignment | null;
  /** Une seule affectation principale parmi les trois (validation métier côté UI) */
  projectId?: string | null;
  /**
   * Programme cible (mode « programme seul ») ou **dérivé du projet** lorsque `projectId` est défini
   * (pour filtres / rapports sans jointure sur `projects`).
   */
  programmeId?: string | null;
  /** Activité de terrain (optionnel, avec projectId) */
  activityId?: string | null;
  /** Formation globale (ex. cours / offre) – distinct de l’espace formation RH */
  formationId?: string | null;
  linkedToCrm?: boolean;
  /** Collecte d’origine lors d’une réutilisation / duplication */
  reusedFromCollecteId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Cycle commercial / relance (codification CRM — automatisations pilotées depuis Paramètres / webhooks). */
export type CrmContactLifecycleStatus =
  | 'Lead'
  | 'Contacted'
  | 'Unreachable'
  | 'CallbackExpected'
  | 'Prospect'
  | 'Customer';

export interface Contact {
  id: number | string;
  name: string;
  workEmail: string;
  personalEmail?: string;
  company: string;
  status: CrmContactLifecycleStatus;
  workflowStatus?: string | null;
  workflowUpdatedAt?: string | null;
  avatar: string;
  officePhone?: string;
  mobilePhone?: string;
  whatsappNumber?: string;
  /** Catégorie extensible (Client, Partenaire, Bailleur, etc.) – référentiel contact_category */
  categoryId?: string | null;
  categoryName?: string | null;
  createdById?: string;
  createdByName?: string;
  /** Origine métier (ex. collecte_submission, manual) — colonne `source` */
  source?: string | null;
  /** UUID campagne Collecte locale liée à la création */
  sourceCollectionId?: string | null;
  /** UUID soumission Collecte liée à la création */
  sourceSubmissionId?: string | null;
  /** Multi-tenant : colonne `contacts.organization_id` */
  organizationId?: string | null;
  notes?: string | null;
  tags?: string[] | null;
}

export interface Document {
  id: string; // UUID from Supabase
  title: string;
  content: string;
  description?: string; // Description courte du document
  createdAt: string;
  createdBy: string;
  createdById?: string; // UUID du profile qui a créé le document
  updatedAt?: string;
  tags?: string[];
  category?: string;
  isPublic?: boolean;
  /** Partage ciblé si isPublic = false (RLS document_acl_*) */
  sharedProfileIds?: string[];
  sharedDepartmentIds?: string[];
  /** Projets dont les assignés de tâches voient le document */
  sharedProjectIds?: string[];
  viewCount?: number; // Nombre de consultations
  lastViewedAt?: string; // Dernière consultation
  version?: number; // Version du document
  isFavorite?: boolean; // Si l'utilisateur actuel a mis en favori
  thumbnailUrl?: string; // Image de prévisualisation
  attachments?: Array<{ name: string; url: string; type: string; size: number }>; // Pièces jointes
}

/** Statut de présence (pointage) – Phase 4 Bloc 1 + sélecteur post-login COYA.PRO */
export type PresenceStatus =
  | 'online' | 'pause' | 'in_meeting'
  | 'present' | 'absent' | 'pause_coffee' | 'pause_lunch'
  | 'away_mission' | 'brief_team' | 'technical_issue';

/** Session de présence : en ligne, pause, ou en réunion (optionnellement liée à une réunion) */
export interface PresenceSession {
  id: string;
  userId: string; // auth user id (same as profiles.user_id)
  organizationId: string;
  startedAt: string; // ISO
  endedAt?: string | null; // ISO, null = session en cours
  status: PresenceStatus;
  meetingId?: string | null; // FK meetings.id – si "en réunion" non lié = non rémunéré
  pauseMinutes: number;
  hourlyRate?: number | null;
  startedIp?: string | null;
  endedIp?: string | null;
  workMode?: WorkMode;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export type WorkMode = 'office' | 'remote' | 'hybrid';

export interface PresenceStatusEvent {
  id: string;
  presenceSessionId: string;
  organizationId: string;
  userId: string;
  status: PresenceStatus;
  startedAt: string;
  endedAt?: string | null;
  durationMinutes?: number | null;
  /** Durée exacte du segment (fin - début), en secondes */
  durationSeconds?: number | null;
  source?: 'selector' | 'widget' | 'system';
  notes?: string | null;
  createdAt?: string;
}

/** Segment timeline Workforce OS (table `workforce_timeline_segments`) */
export interface WorkforceTimelineSegmentRow {
  id: string;
  organizationId: string;
  createdByUserId: string;
  workerId: string;
  segmentKind: string;
  operationalContext?: string | null;
  deviceRef?: Record<string, unknown> | null;
  startedAt: string;
  endedAt: string;
  sourceClientEventId: string;
  payload: Record<string, unknown>;
  createdAt?: string;
}

export interface HrAttendancePolicy {
  id: string;
  organizationId: string;
  payrollPeriodStartDay: number;
  expectedDailyMinutes: number;
  expectedWorkStartTime: string;
  /** Fin de journée attendue (heure locale), ex. 17:00 — départ avant = anticipé. */
  expectedWorkEndTime?: string;
  /** Fin de plage matin : sans présence utile avant cette heure → absence matin. */
  morningSegmentEndTime?: string;
  lunchStartTime?: string;
  lunchEndTime?: string;
  /** Début effectif de l’obligation d’être présent l’après-midi (souvent = fin pause). */
  afternoonPresenceDeadlineTime?: string;
  monthlyDelayToleranceMinutes: number;
  monthlyUnjustifiedAbsenceToleranceMinutes: number;
  defaultWorkMode: WorkMode;
  enforceOfficeIp: boolean;
  officeIpAllowlist: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** Valeurs formulaire politique présence (champs optionnels intègrent les défauts DB). */
export const HR_ATTENDANCE_POLICY_FORM_DEFAULT: Omit<HrAttendancePolicy, 'id' | 'organizationId'> = {
  payrollPeriodStartDay: 1,
  expectedDailyMinutes: 480,
  expectedWorkStartTime: '09:00:00',
  expectedWorkEndTime: '17:00:00',
  morningSegmentEndTime: '12:00:00',
  lunchStartTime: '13:00:00',
  lunchEndTime: '14:00:00',
  afternoonPresenceDeadlineTime: '14:00:00',
  monthlyDelayToleranceMinutes: 45,
  monthlyUnjustifiedAbsenceToleranceMinutes: 480,
  defaultWorkMode: 'office',
  enforceOfficeIp: false,
  officeIpAllowlist: [],
};

export type HrWorkforceAnomalyKind = 'late_connect' | 'absence_morning' | 'absence_afternoon' | 'early_departure';

export type HrWorkforceManagerDecision = 'pending' | 'authorized' | 'unauthorized' | 'verified';

export interface HrWorkforceAnomaly {
  id: string;
  organizationId: string;
  profileId: string;
  workDate: string;
  anomalyKind: HrWorkforceAnomalyKind;
  minutesValue: number;
  managerDecision: HrWorkforceManagerDecision;
  countsTowardAbsence: boolean;
  notes?: string | null;
  decidedByUserId?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Planning hebdomadaire salarié (surclasse les horaires par défaut) */
export interface EmployeeWorkSchedule {
  id: string;
  organizationId: string;
  profileId: string;
  isoWeekday: number;
  expectedStartTime?: string | null;
  expectedEndTime?: string | null;
  lunchStartTime?: string | null;
  lunchEndTime?: string | null;
  afternoonStartTime?: string | null;
  active: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Politique de présence (Bloc 1.2) – valeurs par défaut ; extensible par organisation plus tard */
export interface PresencePolicy {
  /** Seuil retard en minutes (au-delà = retard comptabilisé) */
  delayThresholdMinutes: number;
  /** Durée max d'une pause en minutes (au-delà = dépassement) */
  maxPauseMinutes: number;
  /** Quota hebdomadaire (ex. 44 h) */
  weeklyHours: number;
  /** Heures de travail effectives comptant pour « 1 jour » (ex. 9 h dans la plage horaire) */
  dailyTargetWorkHours: number;
  /** Début de la plage horaire comptabilisée (heure locale, 0–23), ex. 9 → 09:00 */
  workWindowStartHour: number;
  /** Fin de la plage horaire comptabilisée (heure locale, exclue en fin d’intervalle), ex. 19 → jusqu’à 19:00 */
  workWindowEndHour: number;
  /** @deprecated Utiliser dailyTargetWorkHours (alias historique « max heures / jour ») */
  maxHoursPerDay: number;
}

export const DEFAULT_PRESENCE_POLICY: PresencePolicy = {
  delayThresholdMinutes: 15,
  maxPauseMinutes: 60,
  weeklyHours: 44,
  dailyTargetWorkHours: 9,
  workWindowStartHour: 9,
  workWindowEndHour: 19,
  maxHoursPerDay: 9,
};

/** Pièce jointe RH (URL publique Storage après upload) */
export interface EmployeeHrAttachment {
  url: string;
  name: string;
  uploadedAt?: string;
}

/** Fiche salarié RH (Phase 4 Bloc 1.5) */
export interface Employee {
  id: string;
  organizationId: string;
  profileId: string;
  position?: string | null;
  workMode?: WorkMode | null;
  hourlyRate?: number | null;
  expectedDailyMinutes?: number | null;
  /** Responsable hiérarchique (profil) — utilisé par l’organigramme */
  managerId?: string | null;
  /** Superviseur / mentor (profil) — affiché sur la fiche et l’organigramme */
  mentorId?: string | null;
  cnss?: string | null;
  amo?: string | null;
  indemnities?: string | null;
  leaveRate?: number | null;
  tenureDate?: string | null;
  familySituation?: string | null;
  photoUrl?: string | null;
  cvUrl?: string | null;
  hrAttachments?: EmployeeHrAttachment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface PresencePeriodMetric {
  profileId: string;
  period: 'day' | 'week' | 'month' | 'quarter' | 'year';
  label: string;
  totalMinutes: number;
  totalHours: number;
  expectedHours: number;
  assiduityRate: number;
  hourlyRate?: number | null;
  estimatedAmount?: number | null;
  /** Jours avec activité ≥ seuil (présence journalière) — optionnel, rempli par agrégations récentes */
  workedDayCount?: number;
  /** Moyenne heures / jour effectivement travaillé (jours comptés = workedDayCount) */
  avgHoursPerWorkedDay?: number;
}

/** Une ligne de série journalière temps effectif vs quota (calendrier local). */
export interface PresenceDailyRow {
  dateIso: string;
  workedSeconds: number;
  targetSeconds: number;
  /** 0–100+ (peut dépasser 100 si dépassement quota) */
  ratePct: number;
}

/** Synthèse sur une plage de jours pour un salarié. */
export interface PresencePeriodRollup {
  workedDayCount: number;
  totalWorkedSeconds: number;
  totalTargetSeconds: number;
  avgHoursPerWorkedDay: number;
  assiduityPct: number;
}

/**
 * Heuristique « tendance » : ratio temps réalisé / cible sur la partie **écoulée** de la plage (jours ≤ aujourd’hui local).
 * Ce n’est pas une prévision contractuelle ni du ML.
 */
export interface PresenceProjection {
  /** null si impossible (pas de cible écoulée) */
  projectedAssiduityPct: number | null;
  elapsedDayCount: number;
  totalDayCount: number;
}

/** Ligne de bulletin de paie (rubrique) — persistance `pay_slip_lines` */
export type PaySlipLineSide = 'gain' | 'deduction' | 'info';

export type PayrollRubricType = 'gain' | 'cotisation_sal' | 'cotisation_pat' | 'impot' | 'info';

export interface PaySlipLine {
  id?: string;
  paySlipId?: string;
  organizationId?: string;
  rubriqueCode: string;
  label: string;
  side: PaySlipLineSide;
  amount: number;
  orderIndex: number;
  metadata?: Record<string, unknown> | null;
  ohadaAccountSuggestion?: string | null;
}

/** Bulletin enrichi (lignes + analytique optionnelle) */
export interface PaySlipWithLines {
  id: string;
  organizationId: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  grossAmount: number;
  netAmount: number;
  currencyCode?: string;
  status: 'draft' | 'validated' | 'paid';
  notes?: string;
  projectId?: string | null;
  programmeId?: string | null;
  fundingSource?: string | null;
  createdAt?: string;
  updatedAt?: string;
  lines: PaySlipLine[];
}

/** Définition catalogue rubrique (table `payroll_rubric_definitions`) */
export interface PayrollRubricDefinition {
  id: string;
  organizationId: string;
  code: string;
  labelFr: string;
  labelEn?: string | null;
  rubricType: PayrollRubricType;
  ratePercent?: number | null;
  formula?: string | null;
  ohadaAccountSuggestion?: string | null;
  active: boolean;
  sortOrder: number;
}

/** Une ligne de la matrice période (un salarié + montants par rubrique) */
export interface PayrollMatrixRow {
  profileId: string;
  displayName: string;
  paySlipId: string | null;
  slip: PaySlipWithLines | null;
  slipStatus: 'draft' | 'validated' | 'paid' | 'none';
  currencyCode: string;
  amountsByCode: Record<string, number>;
  paidHours: number;
  grossAmount: number;
  netAmount: number;
}

export interface HrAbsenceEvent {
  id: string;
  organizationId: string;
  profileId: string;
  absenceDate: string;
  durationMinutes: number;
  isAuthorized: boolean;
  reason?: string | null;
  createdById?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TriniteScore {
  id: string;
  organizationId: string;
  profileId: string;
  periodStart: string;
  periodEnd: string;
  ndiguelScore: number;
  yarScore: number;
  barkeScore: number;
  globalScore: number;
  presenceScore: number;
  performanceScore: number;
  objectiveScore: number;
  qualityScore: number;
  sourceSnapshot?: Record<string, any> | null;
  generatedById?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface TimeLog {
  id: string; // UUID from Supabase
  userId: string; // UUID from Supabase (profile.id)
  entityType: 'project' | 'course' | 'task' | 'programme';
  entityId: number | string;
  entityTitle: string;
  date: string;
  duration: number; // in minutes
  description: string;
}

export interface LeaveRequest {
  id: string; // UUID from Supabase
  userId: string; // UUID from Supabase (profile.id)
  userName?: string; // Pour compatibilité affichage (récupéré depuis profiles)
  userAvatar?: string; // Pour compatibilité affichage (récupéré depuis profiles)
  leaveTypeId?: string; // UUID du type de congé (FK → leave_types.id)
  leaveTypeName?: string; // Nom du type de congé pour affichage
  startDate: string; // Format ISO: yyyy-MM-dd
  endDate: string; // Format ISO: yyyy-MM-dd
  reason: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'; // lowercase pour correspondre à Supabase
  approverId?: string; // UUID du profile qui a approuvé/rejeté
  rejectionReason?: string; // Raison du rejet si applicable
  approvalReason?: string; // Motif d'approbation si applicable
  isUrgent?: boolean; // Congé urgent ?
  urgencyReason?: string; // Motif de l'urgence
  managerId?: string; // UUID du manager assigné
  createdAt?: string;
  updatedAt?: string;
}

export interface Invoice {
  id: string; // UUID
  invoiceNumber: string;
  clientName: string;
  amount: number;
  /**
   * Montant de TVA (si connu côté facture). Utilisé pour générer une écriture 3 lignes
   * (client TTC, produit HT, TVA collectée) dans le pont comptable.
   */
  vatAmount?: number;
  /**
   * Montant total TTC (si différent de `amount`).
   * Si présent avec `vatAmount`, permet de dériver la base HT.
   */
  totalAmount?: number;
  currencyCode?: CurrencyCode;
  exchangeRate?: number;
  baseAmountUSD?: number;
  transactionDate?: string;
  dueDate: string;
  status: 'Draft' | 'Sent' | 'Paid' | 'Overdue' | 'Partially Paid';
  receipt?: Receipt;
  paidDate?: string;
  paidAmount?: number; // Montant payé pour les factures partiellement payées
  recurringSourceId?: string; // UUID
  createdById?: string;
  createdByName?: string;
}

export interface Expense {
  id: string; // UUID
  category: string;
  description: string;
  amount: number;
  currencyCode?: CurrencyCode;
  exchangeRate?: number;
  baseAmountUSD?: number;
  transactionDate?: string;
  date: string;
  dueDate?: string;
  receipt?: Receipt;
  status: 'Paid' | 'Unpaid';
  budgetItemId?: string; // UUID
  recurringSourceId?: string; // UUID
  createdById?: string;
  createdByName?: string;
}

export type RecurrenceFrequency = 'Monthly' | 'Quarterly' | 'Annually';

export interface RecurringInvoice {
    id: string; // UUID
    clientName: string;
    amount: number;
    currencyCode?: CurrencyCode;
    exchangeRate?: number;
    baseAmountUSD?: number;
    frequency: RecurrenceFrequency;
    startDate: string;
    endDate?: string;
    lastGeneratedDate: string;
    createdById?: string;
    createdByName?: string;
}

export interface RecurringExpense {
    id: string; // UUID
    category: string;
    description: string;
    amount: number;
    currencyCode?: CurrencyCode;
    exchangeRate?: number;
    baseAmountUSD?: number;
    frequency: RecurrenceFrequency;
    startDate: string;
    endDate?: string;
    lastGeneratedDate: string;
    createdById?: string;
    createdByName?: string;
}

export interface BudgetItem {
    id: string; // UUID
    description: string;
    amount: number;
}

export interface BudgetLine {
    id: string; // UUID
    title: string;
    items: BudgetItem[];
}

export interface Budget {
    id: string; // UUID
    title: string;
    type: 'Project' | 'Office';
    amount: number;
    currencyCode?: CurrencyCode;
    exchangeRate?: number;
    baseAmountUSD?: number;
    startDate: string;
    endDate: string;
    projectId?: string; // UUID
    budgetLines: BudgetLine[];
    createdById?: string;
    createdByName?: string;
}

export interface Meeting {
    id: string | number; // UUID (string) from Supabase ou legacy number
    title: string;
    startTime: string; // ISO string
    endTime: string; // ISO string
    attendees: User[];
    organizerId: string | number; // UUID (string) from Supabase ou legacy number
    description?: string;
    meetingUrl?: string; // Lien Google Meet, Microsoft Teams, etc.
    accessCode?: string; // Code d'accès à la réunion
    meetingPlatform?: string; // 'google_meet', 'microsoft_teams', 'zoom', 'other'
}

/** Hub « Demande mobilité » — entité minimale (brouillon → soumis). */
export type MobilityRequestStatus = 'draft' | 'submitted';
export type MobilityIntentRoute = 'internal' | 'external';
export type MobilityTripType = 'mission' | 'course' | 'autre';

export interface MobilityRequest {
    id: string;
    organizationId: string;
    createdByProfileId: string;
    status: MobilityRequestStatus;
    intentRoute: MobilityIntentRoute | null;
    passengerCount: number;
    tripType: MobilityTripType;
    projectId: string | null;
    programmeId: string | null;
    participantProfileIds: string[];
    title: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
}

export enum Language {
    EN = 'en',
    FR = 'fr',
}

export type Translation = { [key: string]: string };
export type Translations = { [key in Language]: Translation };

export interface AppNotification {
    id: string;
    message: string;
    date: string;
    entityType: 'invoice' | 'expense';
    entityId: number;
    isRead: boolean;
}

export interface AgentMessage {
  role: 'user' | 'ai';
  content: string;
}

export interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}