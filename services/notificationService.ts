import { supabase } from './supabaseService';
import { RealtimeService } from './realtimeService';
import { DataService } from './dataService';
import { triggerNotification as novuTrigger } from './novuService';

export interface Notification {
  id: string;
  userId: string;
  type: 'info' | 'success' | 'warning' | 'error';
  module: string;
  action: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  entityTitle?: string;
  createdBy?: string;
  createdByName?: string;
  read: boolean;
  readAt?: string;
  metadata?: any;
  createdAt: string;
}

export type NotificationType = 'info' | 'success' | 'warning' | 'error';
export type NotificationModule =
  | 'project'
  | 'invoice'
  | 'expense'
  | 'course'
  | 'goal'
  | 'planning'
  | 'leave'
  | 'knowledge'
  | 'user'
  | 'system'
  | 'ticket_it'
  | 'messagerie';
export type NotificationAction = 'created' | 'updated' | 'deleted' | 'approved' | 'rejected' | 'assigned' | 'completed' | 'reminder' | 'submitted' | 'requested_changes';

export class NotificationService {
  private static channels: Map<string, any> = new Map();

  /** Profil expéditeur (created_by) — une seule requête par session pour ce chemin. */
  private static senderProfilePromise: Promise<{ id: string; full_name: string | null } | null> | null = null;

  private static async getSenderProfileOnce(): Promise<{ id: string; full_name: string | null } | null> {
    if (this.senderProfilePromise) return this.senderProfilePromise;
    this.senderProfilePromise = (async () => {
      try {
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser) return null;
        const { data: profile } = await supabase
          .from('profiles')
          .select('id, full_name')
          .eq('user_id', currentUser.id)
          .single();
        return profile?.id ? { id: profile.id, full_name: profile.full_name ?? null } : null;
      } catch {
        return null;
      }
    })();
    return this.senderProfilePromise;
  }

  // Créer une notification
  static async createNotification(
    userId: string,
    type: NotificationType,
    module: NotificationModule,
    action: NotificationAction,
    title: string,
    message: string,
    options?: {
      entityType?: string;
      entityId?: string;
      entityTitle?: string;
      metadata?: any;
    }
  ): Promise<Notification | null> {
    try {
      // RPC create_notification : désactivé par défaut (évite 404 console si non déployée).
      // Pour l’activer : VITE_USE_CREATE_NOTIFICATION_RPC=true + RPC déployée sur Supabase.
      const useRpc = typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_USE_CREATE_NOTIFICATION_RPC === 'true';
      if (useRpc) {
        try {
          const { data: rpcResult, error: rpcError } = await supabase.rpc('create_notification', {
            p_user_id: userId,
            p_type: type,
            p_module: module,
            p_action: action,
            p_title: title,
            p_message: message,
            p_entity_type: options?.entityType || null,
            p_entity_id: options?.entityId || null,
            p_entity_title: options?.entityTitle || null,
            p_metadata: options?.metadata || null,
          });

          if (!rpcError && rpcResult) {
            const { data: notification } = await supabase.from('notifications').select('*').eq('id', rpcResult).single();
            if (notification) return this.mapNotification(notification);
          }
        } catch {
          /* continuer vers INSERT direct */
        }
      }

      // INSERT direct (chemin principal) — created_by : un seul fetch profil par session
      let createdByProfileId: string | null = null;
      let createdByName: string | null = null;
      const sender = await this.getSenderProfileOnce();
      if (sender) {
        createdByProfileId = sender.id;
        createdByName = sender.full_name;
      }

      const { data: ins, error: insErr } = await DataService.createNotification({
        userId,
        message,
        type,
        module,
        action,
        title,
        entityType: options?.entityType,
        entityId: options?.entityId,
        entityTitle: options?.entityTitle,
        metadata: options?.metadata,
        read: false,
        createdBy: createdByProfileId,
        createdByName,
      });
      if (insErr) throw insErr;
      const createdAt = (ins as { created_at?: string })?.created_at || new Date().toISOString();
      const resolvedUserId = (ins as { user_id?: string })?.user_id || userId;
      const notification: Notification = {
        id: '',
        userId: resolvedUserId,
        type,
        module,
        action,
        title,
        message,
        entityType: options?.entityType,
        entityId: options?.entityId,
        entityTitle: options?.entityTitle,
        createdBy: createdByProfileId || undefined,
        createdByName: createdByName || undefined,
        read: false,
        metadata: options?.metadata,
        createdAt,
      };

      // Déclencher Novu en parallèle (fire-and-forget, ne bloque pas la notification Supabase)
      novuTrigger(`coya.${module}.${action}`, userId, {
        title,
        message,
        entityType: options?.entityType,
        entityId: options?.entityId,
        entityTitle: options?.entityTitle,
      }).catch(() => {
        // Novu est optionnel — une erreur ne doit pas faire échouer la notification
      });

      return notification;
    } catch (error: any) {
      console.error('Erreur création notification:', error);
      return null;
    }
  }

  // Notifier plusieurs utilisateurs
  static async notifyUsers(
    userIds: string[],
    type: NotificationType,
    module: NotificationModule,
    action: NotificationAction,
    title: string,
    message: string,
    options?: {
      entityType?: string;
      entityId?: string;
      entityTitle?: string;
      metadata?: any;
    }
  ): Promise<number> {
    try {
      const unique = Array.from(new Set(userIds.filter(Boolean)));
      const concurrency = 6;
      let ok = 0;
      for (let i = 0; i < unique.length; i += concurrency) {
        const chunk = unique.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          chunk.map((userId) =>
            this.createNotification(userId, type, module, action, title, message, options)
          )
        );
        ok += results.filter((r) => r.status === 'fulfilled').length;
      }
      return ok;
    } catch (error) {
      console.error('Erreur notification multiple:', error);
      return 0;
    }
  }

  // Récupérer les notifications d'un utilisateur
  static async getUserNotifications(
    userId: string,
    options?: {
      unreadOnly?: boolean;
      limit?: number;
      module?: string;
      offset?: number;
    }
  ): Promise<Notification[]> {
    try {
      let query = supabase
        .from('notifications')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (options?.unreadOnly) {
        query = query.eq('read', false);
      }

      if (options?.module) {
        query = query.eq('module', options.module);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      if (options?.offset) {
        query = query.range(options.offset, options.offset + (options.limit || 50) - 1);
      }

      const { data, error } = await query;

      if (error) throw error;
      return (data || []).map(n => this.mapNotification(n));
    } catch (error) {
      console.error('Erreur récupération notifications:', error);
      return [];
    }
  }

  // Compter les notifications non lues
  static async getUnreadCount(userId: string): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('read', false);

      if (error) throw error;
      return count || 0;
    } catch (error) {
      console.error('Erreur comptage notifications:', error);
      return 0;
    }
  }

  // Marquer une notification comme lue
  static async markAsRead(notificationId: string): Promise<boolean> {
    try {
      // RPC optionnelle (évite un 404 réseau si la fonction n’est pas déployée sur Supabase)
      const useRpc = import.meta.env.VITE_USE_MARK_NOTIFICATION_READ_RPC === 'true';
      if (useRpc) {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('mark_notification_read', {
          p_notification_id: notificationId
        });
        if (!rpcError && rpcResult) {
          return true;
        }
      }

      // Fallback: UPDATE direct
      const { error } = await supabase
        .from('notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Erreur marquage notification lue:', error);
      return false;
    }
  }

  // Marquer toutes les notifications comme lues
  static async markAllAsRead(userId: string): Promise<number> {
    try {
      // RPC optionnelle (évite un 404 réseau si la fonction n’est pas déployée sur Supabase)
      const useRpc = import.meta.env.VITE_USE_MARK_ALL_NOTIFICATIONS_RPC === 'true';
      if (useRpc) {
        const { data: rpcResult, error: rpcError } = await supabase.rpc('mark_all_notifications_read');
        if (!rpcError && rpcResult != null && Number(rpcResult) >= 0) {
          return Number(rpcResult);
        }
      }

      const { data, error } = await supabase
        .from('notifications')
        .update({ read: true, read_at: new Date().toISOString() })
        .eq('user_id', userId)
        .eq('read', false)
        .select();

      if (error) throw error;
      return data?.length || 0;
    } catch (error) {
      console.error('Erreur marquage toutes notifications lues:', error);
      return 0;
    }
  }

  // Supprimer une notification
  static async deleteNotification(notificationId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('notifications')
        .delete()
        .eq('id', notificationId);

      if (error) throw error;
      return true;
    } catch (error) {
      console.error('Erreur suppression notification:', error);
      return false;
    }
  }

  // S'abonner aux notifications en temps réel
  static subscribeToNotifications(
    userId: string,
    callback: (notification: Notification) => void
  ): () => void {
    // S'abonner via RealtimeService
    const channel = RealtimeService.subscribeToNotifications(userId, (payload) => {
      if (payload.eventType === 'INSERT' && payload.new) {
        const notification = this.mapNotification(payload.new);
        callback(notification);
      }
    });

    const channelKey = `notifications:${userId}`;
    this.channels.set(channelKey, channel);

    // Retourner une fonction pour se désabonner
    return () => {
      if (channel) {
        RealtimeService.unsubscribe(channel);
        this.channels.delete(channelKey);
      }
    };
  }

  // Se désabonner de toutes les notifications
  static unsubscribeAll() {
    this.channels.forEach(channel => {
      RealtimeService.unsubscribe(channel);
    });
    this.channels.clear();
  }

  // Mapper les données Supabase vers Notification
  private static mapNotification(data: any): Notification {
    return {
      id: data.id,
      userId: data.user_id,
      type: data.type,
      module: data.module,
      action: data.action,
      title: data.title,
      message: data.message,
      entityType: data.entity_type,
      entityId: data.entity_id,
      entityTitle: data.entity_title,
      createdBy: data.created_by,
      createdByName: data.created_by_name,
      read: data.read || false,
      readAt: data.read_at,
      metadata: data.metadata,
      createdAt: data.created_at
    };
  }

  // Règles de notification par module et action
  static getNotificationRules() {
    return {
      project: {
        created: {
          type: 'info' as NotificationType,
          notifyTeam: true,
          notifyOwner: false
        },
        updated: {
          type: 'info' as NotificationType,
          notifyTeam: true,
          notifyOwner: false
        },
        deleted: {
          type: 'warning' as NotificationType,
          notifyTeam: true,
          notifyOwner: true
        },
        assigned: {
          type: 'info' as NotificationType,
          notifyAssignee: true
        }
      },
      invoice: {
        created: {
          type: 'success' as NotificationType,
          notifyOwner: true
        },
        updated: {
          type: 'info' as NotificationType,
          notifyOwner: true
        },
        paid: {
          type: 'success' as NotificationType,
          notifyOwner: true
        },
        overdue: {
          type: 'warning' as NotificationType,
          notifyOwner: true
        }
      },
      leave: {
        created: {
          type: 'info' as NotificationType,
          notifyManager: true
        },
        approved: {
          type: 'success' as NotificationType,
          notifyRequester: true
        },
        rejected: {
          type: 'error' as NotificationType,
          notifyRequester: true
        }
      },
      course: {
        created: {
          type: 'info' as NotificationType,
          notifyAll: false,
          notifyStudents: true
        },
        assigned: {
          type: 'info' as NotificationType,
          notifyAssignee: true
        },
        completed: {
          type: 'success' as NotificationType,
          notifyInstructor: true,
          notifyStudent: true
        }
      },
      goal: {
        created: {
          type: 'info' as NotificationType,
          notifyOwner: true
        },
        updated: {
          type: 'info' as NotificationType,
          notifyOwner: true
        },
        completed: {
          type: 'success' as NotificationType,
          notifyOwner: true,
          notifyTeam: true
        }
      }
    };
  }
}

export default NotificationService;

