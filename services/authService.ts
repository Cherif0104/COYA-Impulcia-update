import { supabase, createEphemeralSupabaseClient } from './supabaseService';
import { User, Role, ProfileStatus, roleRequiresApprovalWhenCreatedByAdmin } from '../types';
import { getPrimaryOrganizationId } from '../constants/platformTenant';
const DEFAULT_ROLE: Role = 'student';
const STORAGE_ROLE_MAP: Record<string, Role> = {
  partner: 'partner_facilitator'
};

const UI_TO_STORAGE_ROLE: Record<Role, string> = {
  super_administrator: 'super_administrator',
  administrator: 'administrator',
  manager: 'manager',
  supervisor: 'supervisor',
  intern: 'intern',
  hr_business_partner: 'hr_business_partner',
  hr_officer: 'hr_officer',
  recruiter: 'recruiter',
  payroll_specialist: 'payroll_specialist',
  team_lead: 'team_lead',
  trainer: 'trainer',
  coach: 'coach',
  facilitator: 'facilitator',
  partner_facilitator: 'partner',
  mentor: 'mentor',
  student: 'student',
  alumni: 'alumni',
  entrepreneur: 'entrepreneur',
  employer: 'employer',
  implementer: 'implementer',
  funder: 'funder',
  publisher: 'publisher',
  editor: 'editor',
  producer: 'producer',
  artist: 'artist',
};

const DB_ALLOWED_ROLES = new Set<string>([
  'super_administrator', 'administrator', 'manager', 'supervisor', 'intern',
  'hr_business_partner', 'hr_officer', 'recruiter', 'payroll_specialist', 'team_lead',
  'trainer', 'coach', 'facilitator', 'mentor',
  'student', 'learner', 'alumni',
  'entrepreneur', 'employer', 'implementer', 'funder',
  'publisher', 'editor', 'producer', 'artist',
  'partner', 'supplier', 'service_provider',
  'ai_coach', 'ai_developer', 'ai_analyst',
]);

const normalizeRoleForStorageValue = (role?: string | null): string => {
  const fallbackStorageRole = UI_TO_STORAGE_ROLE[DEFAULT_ROLE];

  if (!role) {
    return fallbackStorageRole;
  }

  const lower = role.toLowerCase().trim();
  const mappedFromUi = (UI_TO_STORAGE_ROLE as Record<string, string>)[lower];
  const normalized = mappedFromUi || lower;

  if (DB_ALLOWED_ROLES.has(normalized)) {
    return normalized;
  }

  return fallbackStorageRole;
};

const mapRoleFromStorageValue = (role: string | null | undefined): Role => {
  if (!role) return DEFAULT_ROLE;
  const lower = role.toLowerCase();
  const mapped = STORAGE_ROLE_MAP[lower];
  if (mapped) return mapped;
  return (Object.keys(UI_TO_STORAGE_ROLE) as Role[]).includes(lower as Role) ? (lower as Role) : DEFAULT_ROLE;
};

const sanitizeFullName = (fullName?: string | null, email?: string | null) => {
  if (fullName && fullName.trim().length > 0) {
    return fullName.trim();
  }
  return email || 'Utilisateur';
};

/**
 * Mot de passe provisoire pour une demande d'accès (le demandeur ne le connaît pas :
 * après validation, il définit son mot de passe via « Mot de passe oublié » ou « Reset MDP »).
 */
const generateAccessRequestPassword = (): string => {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const digits = '23456789';
  const symbols = '!@#$%&*?';
  const all = upper + lower + digits + symbols;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
  for (let i = 0; i < 12; i += 1) pwd += pick(all);
  return pwd
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
};

export interface AuthUser {
  id: string;
  email: string;
  full_name: string;
  role: string;
  avatar_url?: string;
  phone_number?: string;
  organization_id?: string;
  status?: ProfileStatus;
  pending_role?: string | null;
  /** Poste (ex. Directeur Général) – distinct du rôle */
  poste_id?: string | null;
  poste_name?: string | null;
  review_comment?: string | null;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
  requested_role?: string | null;
}

export interface SignUpData {
  email: string;
  password: string;
  full_name: string;
  phone_number?: string;
  role?: string;
  organization_id?: string; // optionnel: permet de choisir une organisation partenaire au signup
  /** Référentiel postes (table `postes`) — optionnel si aucun poste défini pour l’org */
  poste_id?: string | null;
}

export interface SignInData {
  email: string;
  password: string;
}

export interface AccessRequestData {
  full_name: string;
  email: string;
  phone_number?: string;
  /** Organisation cible (sinon organisation principale par défaut). */
  organization_id?: string;
  /** Pilier souhaité = département (`departments.id`) — pré-remplit l’approbation admin. */
  requested_department_id?: string | null;
  /** Poste/fonction souhaité (texte libre). */
  requested_poste?: string | null;
}

// Service d'authentification Supabase
export class AuthService {
  static mapStoredRoleToUi(role: string | null | undefined): Role {
    return mapRoleFromStorageValue(role);
  }

  static normalizeRoleForStorage(role?: string | null): string {
    return normalizeRoleForStorageValue(role);
  }

  static getDefaultOrganizationId() {
    return getPrimaryOrganizationId();
  }

  // Vérifier si un rôle management existe déjà
  static async checkRoleAvailability(role: string): Promise<{ available: boolean; error?: string }> {
    try {
      // Tous les rôles sont autorisés. La validation éventuelle est gérée par le workflow d'approbation.
      return { available: true };
    } catch (error) {
      console.error('Erreur vérification disponibilité rôle:', error);
      return { available: true }; // En cas d'erreur, on autorise par sécurité
    }
  }

  // Inscription
  static async signUp(data: SignUpData) {
    try {
      // Vérifier la disponibilité du rôle avant l'inscription
      const uiRole = (data.role as Role) || DEFAULT_ROLE;
      const storageRole = this.normalizeRoleForStorage(uiRole);
      /** Toute inscription reste en attente jusqu’à validation par un administrateur (rôle effectif minimal jusqu’à approbation). */
      const approvalRequired = true;
      const targetStatus: ProfileStatus = 'pending';
      const pendingRole = storageRole;
      const storedBaseRole = this.normalizeRoleForStorage(DEFAULT_ROLE);
      const metadataRole = this.mapStoredRoleToUi(storedBaseRole);
      const roleCheck = await this.checkRoleAvailability(uiRole);
      
      if (!roleCheck.available) {
        const error = new Error(roleCheck.error || 'Rôle non disponible');
        return { user: null, error };
      }

      // Déterminer l'organization_id AVANT l'appel signUp
      const organizationId = (data.organization_id && data.organization_id.trim()) || getPrimaryOrganizationId();

      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: undefined, // Pas de redirection email
          data: {
            full_name: data.full_name,
            phone_number: data.phone_number,
            role: metadataRole,
            requested_role: uiRole,
            status: targetStatus,
            organization_id: organizationId
          }
        },
        // Confirmer automatiquement l'email pour le développement
        // En production, vous devriez activer la confirmation par email
      });

      if (authError) throw authError;

      if (authData.user) {
        // ═══════════════════════════════════════════════════════════
        // LOGIQUE MULTI-TENANT
        // ═══════════════════════════════════════════════════════════
        // Les inscriptions publiques rejoignent SENEGEL (organisation principale)
        // Les organisations partenaires nécessitent une invitation
        // ═══════════════════════════════════════════════════════════
        
        // Créer le profil utilisateur
        const { error: profileError } = await supabase
          .from('profiles')
          .insert({
            user_id: authData.user.id,
            email: data.email,
            full_name: data.full_name,
            phone_number: data.phone_number,
            role: storedBaseRole,
            organization_id: organizationId,
            status: targetStatus,
            pending_role: pendingRole
          });

        if (profileError) {
          console.error('Erreur création profil:', profileError);
          // Ne pas faire échouer l'inscription pour cette erreur
        }
      }

      return { user: authData.user, error: null };
    } catch (error) {
      console.error('Erreur inscription:', error);
      return { user: null, error };
    }
  }

  /**
   * Inscription depuis l’interface admin : même logique que `signUp`, mais via un client
   * Supabase sans persistance pour ne pas remplacer la session du navigateur de l’administrateur.
   */
  static async signUpIsolated(data: SignUpData) {
    try {
      const uiRole = (data.role as Role) || DEFAULT_ROLE;
      const storageRequested = this.normalizeRoleForStorage(uiRole);
      const needsApproval = roleRequiresApprovalWhenCreatedByAdmin(uiRole);
      const targetStatus: ProfileStatus = needsApproval ? 'pending' : 'active';
      const pendingRole = needsApproval ? storageRequested : null;
      const storedBaseRole = needsApproval
        ? this.normalizeRoleForStorage(DEFAULT_ROLE)
        : storageRequested;
      const metadataRole = this.mapStoredRoleToUi(storedBaseRole);
      const roleCheck = await this.checkRoleAvailability(uiRole);
      if (!roleCheck.available) {
        const error = new Error(roleCheck.error || 'Rôle non disponible');
        return { user: null, error };
      }
      const organizationId = (data.organization_id && data.organization_id.trim()) || getPrimaryOrganizationId();
      const posteId =
        data.poste_id && String(data.poste_id).trim() !== '' ? String(data.poste_id).trim() : null;
      const client = createEphemeralSupabaseClient();

      const { data: authData, error: authError } = await client.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          emailRedirectTo: undefined,
          data: {
            full_name: data.full_name,
            phone_number: data.phone_number,
            role: metadataRole,
            requested_role: uiRole,
            status: targetStatus,
            organization_id: organizationId,
          },
        },
      });

      if (authError) throw authError;

      if (authData.user) {
        const { error: profileError } = await client.from('profiles').insert({
          user_id: authData.user.id,
          email: data.email,
          full_name: data.full_name,
          phone_number: data.phone_number,
          role: storedBaseRole,
          organization_id: organizationId,
          status: targetStatus,
          pending_role: pendingRole,
          poste_id: posteId,
        });

        if (profileError) {
          console.error('Erreur création profil (isolated):', profileError);
        }
      }

      return { user: authData.user, error: null };
    } catch (error) {
      console.error('Erreur inscription isolée:', error);
      return { user: null, error };
    }
  }

  /**
   * Demande d'accès self-service ("Devenir utilisateur") depuis la page de connexion.
   * Crée un profil en `status: 'pending'` via un client éphémère (n'affecte pas la session
   * du navigateur) et stocke le pilier/poste souhaités (best-effort) pour l'approbation admin.
   * Le rôle effectif reste minimal (DEFAULT_ROLE) jusqu'à validation.
   */
  static async requestAccess(data: AccessRequestData) {
    try {
      const storedBaseRole = this.normalizeRoleForStorage(DEFAULT_ROLE);
      const metadataRole = this.mapStoredRoleToUi(storedBaseRole);
      const targetStatus: ProfileStatus = 'pending';
      const organizationId =
        (data.organization_id && data.organization_id.trim()) || getPrimaryOrganizationId();
      const fullName = sanitizeFullName(data.full_name, data.email);
      const password = generateAccessRequestPassword();
      const client = createEphemeralSupabaseClient();

      const { data: authData, error: authError } = await client.auth.signUp({
        email: data.email,
        password,
        options: {
          emailRedirectTo: undefined,
          data: {
            full_name: fullName,
            phone_number: data.phone_number,
            role: metadataRole,
            requested_role: this.mapStoredRoleToUi(storedBaseRole),
            status: targetStatus,
            organization_id: organizationId,
          },
        },
      });

      if (authError) throw authError;

      if (authData.user) {
        const { error: profileError } = await client.from('profiles').insert({
          user_id: authData.user.id,
          email: data.email,
          full_name: fullName,
          phone_number: data.phone_number,
          role: storedBaseRole,
          organization_id: organizationId,
          status: targetStatus,
          pending_role: storedBaseRole,
        });

        if (profileError) {
          console.error('Erreur création profil (demande accès):', profileError);
          throw profileError;
        }

        // Champs additionnels best-effort (colonnes ajoutées par la migration dédiée).
        const extras: Record<string, unknown> = {};
        if (data.requested_department_id) extras.requested_department_id = data.requested_department_id;
        if (data.requested_poste && data.requested_poste.trim()) {
          extras.requested_poste = data.requested_poste.trim();
        }
        if (Object.keys(extras).length > 0) {
          const { error: extraError } = await client
            .from('profiles')
            .update(extras)
            .eq('user_id', authData.user.id);
          if (extraError) {
            console.warn(
              '⚠️ Demande d’accès : champs requested_* non enregistrés (migration à appliquer ?).',
              extraError.message,
            );
          }
        }

        // Le compte reste en attente : on ne conserve aucune session.
        try {
          await client.auth.signOut();
        } catch {
          /* ignore */
        }
      }

      return { user: authData.user, error: null };
    } catch (error) {
      console.error('Erreur demande d’accès:', error);
      return { user: null, error };
    }
  }

  // Connexion - Utilise uniquement Supabase Auth
  static async signIn(data: SignInData) {
    try {
      console.log('🔍 AuthService.signIn appelé avec:', { email: data.email, password: '***' });
      
      // Authentification Supabase uniquement
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password
      });

      if (authError) {
        console.error('❌ Erreur Supabase Auth:', authError);
        return { user: null, error: authError };
      }

      if (!authData.user) {
        console.log('❌ Aucun utilisateur retourné par Supabase');
        return { user: null, error: new Error('Aucun utilisateur trouvé. Vérifiez vos identifiants ou créez un compte.') };
      }

      console.log('👤 Utilisateur Supabase trouvé:', authData.user.id);
      
      // Récupérer le profil utilisateur depuis la table profiles
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', authData.user.id)
        .maybeSingle();

      if (profileError) {
        console.error('❌ Erreur récupération profil:', profileError);
        // Si le profil n'existe pas, créer un profil basique depuis les metadata
        if (profileError.code === 'PGRST116') {
          console.log('⚠️ Profil non trouvé, création depuis metadata...');
          const storageRole = this.normalizeRoleForStorage(authData.user.user_metadata?.role);
          const { data: newProfile, error: createError } = await supabase
            .from('profiles')
            .insert({
              user_id: authData.user.id,
              email: authData.user.email || '',
              full_name: sanitizeFullName(authData.user.user_metadata?.full_name, authData.user.email),
              role: storageRole,
              phone_number: authData.user.user_metadata?.phone_number || null,
              organization_id: authData.user.user_metadata?.organization_id || getPrimaryOrganizationId(),
              is_active: true,
              status: 'active'
            })
            .select()
            .single();

          if (createError) {
            console.error('❌ Erreur création profil:', createError);
            return { user: null, error: createError };
          }

          // Mettre à jour la dernière connexion
          await supabase
            .from('profiles')
            .update({ last_login: new Date().toISOString() })
            .eq('user_id', authData.user.id);

          console.log('✅ Profil créé et authentification réussie !');
          return { 
            user: {
              id: authData.user.id,
              email: newProfile.email,
              full_name: newProfile.full_name,
              role: this.mapStoredRoleToUi(newProfile.role),
              avatar_url: newProfile.avatar_url || '',
              organization_id: newProfile.organization_id || getPrimaryOrganizationId(),
              status: (newProfile.status as ProfileStatus) || 'active',
              pending_role: newProfile.pending_role || null,
              poste_id: newProfile.poste_id ?? null,
              poste_name: newProfile.poste_name ?? null,
              review_comment: newProfile.review_comment || null,
              reviewed_at: newProfile.reviewed_at || null,
              reviewed_by: newProfile.reviewed_by || null
            }, 
            error: null 
          };
        }
        return { user: null, error: profileError };
      }

      const effectiveProfile = profile || await (async () => {
        const storageRole = this.normalizeRoleForStorage(authData.user.user_metadata?.role);
        const { data: createdProfile, error: createError } = await supabase
          .from('profiles')
          .insert({
            user_id: authData.user.id,
            email: authData.user.email || '',
            full_name: sanitizeFullName(authData.user.user_metadata?.full_name, authData.user.email),
            role: storageRole,
            phone_number: authData.user.user_metadata?.phone_number || null,
            organization_id: authData.user.user_metadata?.organization_id || getPrimaryOrganizationId(),
            is_active: true
          })
          .select()
          .single();

        if (createError) throw createError;
        return createdProfile;
      })();

      await supabase
        .from('profiles')
        .update({ last_login: new Date().toISOString(), organization_id: effectiveProfile.organization_id || getPrimaryOrganizationId() })
        .eq('user_id', authData.user.id);

      console.log('✅ Authentification Supabase réussie !');
      return { 
        user: {
          id: authData.user.id,
          email: effectiveProfile.email,
          full_name: effectiveProfile.full_name,
          role: this.mapStoredRoleToUi(effectiveProfile.role),
          avatar_url: effectiveProfile.avatar_url || '',
          organization_id: effectiveProfile.organization_id || getPrimaryOrganizationId(),
          status: (effectiveProfile.status as ProfileStatus) || 'active',
          pending_role: effectiveProfile.pending_role || null,
          poste_id: effectiveProfile.poste_id ?? null,
          poste_name: effectiveProfile.poste_name ?? null,
          review_comment: effectiveProfile.review_comment || null,
          reviewed_at: effectiveProfile.reviewed_at || null,
          reviewed_by: effectiveProfile.reviewed_by || null
        }, 
        error: null 
      };
    } catch (error) {
      console.error('💥 Erreur dans AuthService.signIn:', error);
      return { user: null, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  // Déconnexion
  static async signOut() {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur déconnexion:', error);
      return { error };
    }
  }

  // Récupérer l'utilisateur actuel
  static async getCurrentUser() {
    try {
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error) throw error;
      if (!user) return { user: null, error: null };

      // Récupérer le profil
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (profileError) {
        // Ne pas logger l'erreur si c'est juste un profil manquant
        if (profileError.code !== 'PGRST116') {
          console.error('Erreur récupération profil:', profileError);
        }
        return { user: null, error: profileError };
      }

      return {
        user: {
          id: user.id,
          email: profile.email,
          full_name: profile.full_name,
          role: this.mapStoredRoleToUi(profile.role),
          avatar_url: profile.avatar_url,
          organization_id: profile.organization_id || getPrimaryOrganizationId(),
          status: (profile.status as ProfileStatus) || 'active',
          pending_role: profile.pending_role || null,
          poste_id: profile.poste_id ?? null,
          poste_name: profile.poste_name ?? null,
          review_comment: profile.review_comment || null,
          reviewed_at: profile.reviewed_at || null,
          reviewed_by: profile.reviewed_by || null
        },
        error: null
      };
    } catch (error) {
      console.error('Erreur récupération utilisateur:', error);
      return { user: null, error };
    }
  }

  // Écouter les changements d'authentification
  static onAuthStateChange(callback: (user: AuthUser | null) => void) {
    return supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        // Récupérer le profil
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .single();

        if (profile) {
          callback({
            id: session.user.id,
            email: profile.email,
            full_name: profile.full_name,
            role: AuthService.mapStoredRoleToUi(profile.role),
            avatar_url: profile.avatar_url,
            organization_id: profile.organization_id || getPrimaryOrganizationId(),
            status: (profile.status as ProfileStatus) || 'active',
            pending_role: profile.pending_role || null,
            poste_id: profile.poste_id ?? null,
            poste_name: profile.poste_name ?? null
          });
        } else {
          callback(null);
        }
      } else {
        callback(null);
      }
    });
  }

  // Mettre à jour le profil
  static async updateProfile(userId: string, updates: Partial<AuthUser>) {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          ...updates,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur mise à jour profil:', error);
      return { error };
    }
  }

  // Réinitialiser le mot de passe
  static async resetPassword(email: string) {
    try {
      const { getPasswordRecoveryRedirectUrl } = await import('../utils/authRecoveryUrl');
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: getPasswordRecoveryRedirectUrl(),
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur réinitialisation mot de passe:', error);
      return { error };
    }
  }

  // Changer le mot de passe
  static async updatePassword(newPassword: string) {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });
      if (error) throw error;
      return { error: null };
    } catch (error) {
      console.error('Erreur changement mot de passe:', error);
      return { error };
    }
  }
}

export default AuthService;
