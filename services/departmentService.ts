import { supabase } from './supabaseService';
import { Department, UserDepartment, ModuleName, DepartmentMemberRole } from '../types';
import { handleOptionalTableError, isTableUnavailable } from './optionalTableGuard';

function mapRowToDepartment(row: any): Department {
  const slugs = row.module_slugs;
  const rawSlugs = Array.isArray(slugs) ? (slugs as string[]) : [];
  const moduleSlugs = rawSlugs.map((s) =>
    s === 'knowledge_base' ? ('coya_drive' as ModuleName) : (s as ModuleName),
  );
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    moduleSlugs,
    sequence: row.sequence ?? 0,
    isActive: row.is_active ?? true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRowToUserDepartment(row: any): UserDepartment {
  return {
    id: row.id,
    userId: row.user_id,
    departmentId: row.department_id,
    roleInDepartment: row.role_in_department as DepartmentMemberRole | string | null | undefined,
    createdAt: row.created_at
  };
}

export function normalizeDepartmentMemberRole(v: string | null | undefined): DepartmentMemberRole {
  if (v === 'supervisor' || v === 'manager' || v === 'member') return v;
  return 'member';
}

/**
 * Règles métier : au moins deux personnes, exactement un superviseur, au moins un manager
 * (un seul rôle par personne : le superviseur n’est pas manager sur la même ligne).
 */
export function validateDepartmentMemberRoster(links: UserDepartment[]): string | null {
  if (!links.length) {
    return 'Ajoutez au moins une personne au département.';
  }
  if (links.length < 2) {
    return 'Au moins deux personnes sont nécessaires : un superviseur et au moins un manager.';
  }
  const roles = links.map((l) => normalizeDepartmentMemberRole(l.roleInDepartment as string | undefined));
  const supCount = roles.filter((r) => r === 'supervisor').length;
  const mgrCount = roles.filter((r) => r === 'manager').length;
  if (supCount !== 1) {
    return 'Désignez exactement un superviseur du département.';
  }
  if (mgrCount < 1) {
    return 'Désignez au moins un manager du département.';
  }
  return null;
}

/** Validation côté formulaire (membres cochés + superviseur + managers) avant enregistrement. */
export function validateDepartmentMemberDraft(
  memberSelection: string[],
  supervisorUserId: string,
  managerUserIds: string[],
): string | null {
  if (memberSelection.length === 0) {
    return 'Ajoutez au moins une personne au département.';
  }
  if (memberSelection.length < 2) {
    return 'Au moins deux personnes sont nécessaires : un superviseur et au moins un manager.';
  }
  if (!supervisorUserId || !memberSelection.includes(supervisorUserId)) {
    return 'Choisissez un superviseur parmi les membres cochés.';
  }
  const managersIn = managerUserIds.filter((id) => memberSelection.includes(id));
  if (managersIn.length < 1) {
    return 'Désignez au moins un manager (cases à cocher) parmi les membres.';
  }
  if (managersIn.includes(supervisorUserId)) {
    return 'Le superviseur ne peut pas être en même temps manager.';
  }
  return null;
}

export class DepartmentService {
  /**
   * Tous les départements actifs (lecture publique via RLS departments_select_public_active).
   * Utilisé en repli sur le formulaire « Devenir utilisateur » si l'org choisie n'a pas de piliers.
   */
  static async getActiveDepartments(): Promise<Department[]> {
    if (isTableUnavailable('departments')) return [];
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('is_active', true)
        .order('sequence', { ascending: true })
        .order('name', { ascending: true });

      if (error) {
        if (handleOptionalTableError(error, 'departments', 'DepartmentService.getActiveDepartments')) {
          return [];
        }
        console.error('❌ Erreur getActiveDepartments:', error);
        return [];
      }
      return (data || []).map(mapRowToDepartment);
    } catch (error) {
      if (handleOptionalTableError(error, 'departments', 'DepartmentService.getActiveDepartments.catch')) {
        return [];
      }
      console.error('❌ Erreur getActiveDepartments:', error);
      return [];
    }
  }

  /**
   * Liste des départements d'une organisation
   */
  static async getDepartmentsByOrganizationId(organizationId: string): Promise<Department[]> {
    if (isTableUnavailable('departments')) return [];
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('organization_id', organizationId)
        .order('sequence', { ascending: true })
        .order('name', { ascending: true });

      if (error) {
        if (handleOptionalTableError(error, 'departments', 'DepartmentService.getDepartmentsByOrganizationId')) {
          return [];
        }
        console.error('❌ Erreur getDepartmentsByOrganizationId:', error);
        return [];
      }
      return (data || []).map(mapRowToDepartment);
    } catch (error) {
      if (handleOptionalTableError(error, 'departments', 'DepartmentService.getDepartmentsByOrganizationId.catch')) {
        return [];
      }
      console.error('❌ Erreur getDepartmentsByOrganizationId:', error);
      return [];
    }
  }

  /**
   * Départements de l'utilisateur connecté (via user_departments)
   * userId = auth user id (profiles.user_id)
   */
  static async getUserDepartments(userId: string): Promise<Department[]> {
    if (isTableUnavailable('user_departments') || isTableUnavailable('departments')) return [];
    try {
      const { data: links, error: linkError } = await supabase
        .from('user_departments')
        .select('department_id')
        .eq('user_id', userId);

      if (linkError) {
        if (handleOptionalTableError(linkError, 'user_departments', 'DepartmentService.getUserDepartments.links')) {
          return [];
        }
        return [];
      }
      if (!links?.length) {
        return [];
      }

      const ids = links.map((l) => l.department_id);
      const { data: depts, error } = await supabase
        .from('departments')
        .select('*')
        .in('id', ids)
        .eq('is_active', true)
        .order('sequence', { ascending: true });

      if (error) {
        if (handleOptionalTableError(error, 'departments', 'DepartmentService.getUserDepartments.departments')) {
          return [];
        }
        console.error('❌ Erreur getUserDepartments (fetch departments):', error);
        return [];
      }
      return (depts || []).map(mapRowToDepartment);
    } catch (error) {
      if (
        handleOptionalTableError(error, 'user_departments', 'DepartmentService.getUserDepartments.catch') ||
        handleOptionalTableError(error, 'departments', 'DepartmentService.getUserDepartments.catch')
      ) {
        return [];
      }
      console.error('❌ Erreur getUserDepartments:', error);
      return [];
    }
  }

  /**
   * Union des module_slugs des départements d'un utilisateur (pour calcul des droits)
   */
  static async getAllowedModuleSlugsForUser(userId: string): Promise<ModuleName[]> {
    const departments = await this.getUserDepartments(userId);
    const set = new Set<ModuleName>();
    departments.forEach((d) => d.moduleSlugs.forEach((m) => set.add(m)));
    return Array.from(set);
  }

  /**
   * Liaisons user_departments pour un utilisateur (liste des départements assignés)
   */
  static async getUserDepartmentLinks(userId: string): Promise<UserDepartment[]> {
    try {
      const { data, error } = await supabase
        .from('user_departments')
        .select('*')
        .eq('user_id', userId);

      if (error) {
        console.error('❌ Erreur getUserDepartmentLinks:', error);
        return [];
      }
      return (data || []).map(mapRowToUserDepartment);
    } catch (error) {
      console.error('❌ Erreur getUserDepartmentLinks:', error);
      return [];
    }
  }

  /**
   * Toutes les liaisons user ↔ département pour une organisation (Workforce Live, organigramme).
   */
  static async listUserDepartmentLinksForOrganization(
    organizationId: string,
  ): Promise<Array<{ userId: string; departmentId: string }>> {
    if (isTableUnavailable('user_departments') || isTableUnavailable('departments')) return [];
    try {
      const depts = await this.getDepartmentsByOrganizationId(organizationId);
      const deptIds = depts.map((d) => d.id).filter(Boolean);
      if (!deptIds.length) return [];

      const { data, error } = await supabase
        .from('user_departments')
        .select('user_id, department_id')
        .in('department_id', deptIds);

      if (error) {
        if (
          handleOptionalTableError(error, 'user_departments', 'DepartmentService.listUserDepartmentLinksForOrganization')
        ) {
          return [];
        }
        console.error('❌ Erreur listUserDepartmentLinksForOrganization:', error);
        return [];
      }
      return (data || []).map((row: any) => ({
        userId: String(row.user_id),
        departmentId: String(row.department_id),
      }));
    } catch (error) {
      if (
        handleOptionalTableError(error, 'user_departments', 'DepartmentService.listUserDepartmentLinksForOrganization.catch')
      ) {
        return [];
      }
      console.error('❌ Erreur listUserDepartmentLinksForOrganization:', error);
      return [];
    }
  }

  /**
   * Assigner un utilisateur à un département
   */
  static async assignUserToDepartment(
    userId: string,
    departmentId: string,
    roleInDepartment?: DepartmentMemberRole | string | null
  ): Promise<boolean> {
    try {
      const { error } = await supabase.from('user_departments').upsert(
        {
          user_id: userId,
          department_id: departmentId,
          role_in_department: roleInDepartment ?? null
        },
        { onConflict: 'user_id,department_id' }
      );
      if (error) {
        console.error('❌ Erreur assignUserToDepartment:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('❌ Erreur assignUserToDepartment:', error);
      return false;
    }
  }

  /**
   * Retirer un utilisateur d'un département
   */
  static async removeUserFromDepartment(userId: string, departmentId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('user_departments')
        .delete()
        .eq('user_id', userId)
        .eq('department_id', departmentId);
      if (error) {
        console.error('❌ Erreur removeUserFromDepartment:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('❌ Erreur removeUserFromDepartment:', error);
      return false;
    }
  }

  /**
   * Mettre à jour les départements assignés à un utilisateur (liste complète)
   */
  static async setUserDepartments(userId: string, departmentIds: string[]): Promise<boolean> {
    try {
      const existing = await this.getUserDepartmentLinks(userId);
      const existingIds = new Set(existing.map((l) => l.departmentId));
      const targetIds = new Set(departmentIds);

      const toAdd = departmentIds.filter((id) => !existingIds.has(id));
      const toRemove = existing.filter((l) => !targetIds.has(l.departmentId));

      for (const id of toAdd) {
        await this.assignUserToDepartment(userId, id, 'member');
      }
      for (const link of toRemove) {
        await this.removeUserFromDepartment(userId, link.departmentId);
      }
      return true;
    } catch (error) {
      console.error('❌ Erreur setUserDepartments:', error);
      return false;
    }
  }

  /**
   * Créer un département
   */
  static async createDepartment(
    organizationId: string,
    payload: { name: string; slug: string; moduleSlugs?: ModuleName[]; sequence?: number }
  ): Promise<Department | null> {
    try {
      const { data, error } = await supabase
        .from('departments')
        .insert({
          organization_id: organizationId,
          name: payload.name,
          slug: payload.slug.toLowerCase().trim(),
          module_slugs: payload.moduleSlugs ?? [],
          sequence: payload.sequence ?? 0,
          is_active: true
        })
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur createDepartment:', error);
        throw error;
      }
      return mapRowToDepartment(data);
    } catch (error) {
      console.error('❌ Erreur createDepartment:', error);
      return null;
    }
  }

  /**
   * Mettre à jour un département
   */
  static async updateDepartment(
    id: string,
    payload: Partial<{ name: string; slug: string; moduleSlugs: ModuleName[]; sequence: number; isActive: boolean }>
  ): Promise<Department | null> {
    try {
      const row: any = {};
      if (payload.name !== undefined) row.name = payload.name;
      if (payload.slug !== undefined) row.slug = payload.slug.toLowerCase().trim();
      if (payload.moduleSlugs !== undefined) row.module_slugs = payload.moduleSlugs;
      if (payload.sequence !== undefined) row.sequence = payload.sequence;
      if (payload.isActive !== undefined) row.is_active = payload.isActive;

      const { data, error } = await supabase
        .from('departments')
        .update(row)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('❌ Erreur updateDepartment:', error);
        throw error;
      }
      return data ? mapRowToDepartment(data) : null;
    } catch (error) {
      console.error('❌ Erreur updateDepartment:', error);
      return null;
    }
  }

  /**
   * Supprimer un département (cascade sur user_departments)
   */
  static async deleteDepartment(id: string): Promise<boolean> {
    try {
      const { error } = await supabase.from('departments').delete().eq('id', id);
      if (error) {
        console.error('❌ Erreur deleteDepartment:', error);
        return false;
      }
      return true;
    } catch (error) {
      console.error('❌ Erreur deleteDepartment:', error);
      return false;
    }
  }

  /**
   * Récupérer un département par id
   */
  static async getDepartmentById(id: string): Promise<Department | null> {
    try {
      const { data, error } = await supabase.from('departments').select('*').eq('id', id).maybeSingle();
      if (error || !data) return null;
      return mapRowToDepartment(data);
    } catch (error) {
      console.error('❌ Erreur getDepartmentById:', error);
      return null;
    }
  }

  /**
   * Liste des user_id (auth) appartenant à un département (pour attribution en masse des droits)
   */
  static async getUserIdsInDepartment(departmentId: string): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('user_departments')
        .select('user_id')
        .eq('department_id', departmentId);
      if (error) return [];
      return (data || []).map((r) => r.user_id);
    } catch (error) {
      console.error('❌ Erreur getUserIdsInDepartment:', error);
      return [];
    }
  }

  /** Toutes les affectations d’un département (rôles locaux inclus). */
  static async getDepartmentMemberLinks(departmentId: string): Promise<UserDepartment[]> {
    try {
      const { data, error } = await supabase.from('user_departments').select('*').eq('department_id', departmentId);
      if (error) {
        console.error('❌ Erreur getDepartmentMemberLinks:', error);
        return [];
      }
      return (data || []).map(mapRowToUserDepartment);
    } catch (error) {
      console.error('❌ Erreur getDepartmentMemberLinks:', error);
      return [];
    }
  }
}

export default DepartmentService;
