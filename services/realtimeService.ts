import { supabase } from './supabaseService';
import { RealtimeChannel } from '@supabase/supabase-js';

// Service temps réel Supabase
export class RealtimeService {
  private channels: Map<string, RealtimeChannel> = new Map();

  // S'abonner aux changements d'une table
  static subscribeToTable(
    table: string,
    callback: (payload: any) => void,
    filter?: string
  ) {
    const channelName = `realtime:${table}${filter ? `:${filter}` : ''}`;
    
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: table,
          filter: filter
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux notifications
  static subscribeToNotifications(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux projets
  static subscribeToProjects(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`projects:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
          filter: `owner_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux tâches d'un projet
  static subscribeToProjectTasks(
    projectId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`project-tasks:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'projects',
          filter: `id=eq.${projectId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux factures
  static subscribeToInvoices(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`invoices:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'invoices',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux dépenses
  static subscribeToExpenses(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`expenses:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'expenses',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux contacts
  static subscribeToContacts(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`contacts:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'contacts',
          filter: `created_by=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux logs de temps
  static subscribeToTimeLogs(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`time-logs:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_logs',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux demandes de congés
  static subscribeToLeaveRequests(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`leave-requests:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'leave_requests',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux cours
  static subscribeToCourses(
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel('courses')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'courses'
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux objectifs
  static subscribeToObjectives(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`objectives:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'objectives',
          filter: `owner_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux documents
  static subscribeToDocuments(
    userId: string,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`documents:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'knowledge_articles',
          filter: `user_id=eq.${userId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux offres d'emploi (pour mettre à jour le nombre de candidats)
  static subscribeToJobs(
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel('jobs-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'jobs'
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner aux candidatures (job_applications) pour mettre à jour en temps réel
  static subscribeToJobApplications(
    jobId: number,
    callback: (payload: any) => void
  ) {
    const channel = supabase
      .channel(`job-applications:${jobId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_applications',
          filter: `job_id=eq.${jobId}`
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // S'abonner à toutes les candidatures pour un utilisateur (employeur)
  static subscribeToAllJobApplications(
    userId: string,
    callback: (payload: any) => void
  ) {
    // Note: Cette méthode nécessite une jointure ou un trigger pour filtrer par créateur du job
    // Pour l'instant, on s'abonne à toutes les candidatures
    const channel = supabase
      .channel(`all-job-applications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'job_applications'
        },
        callback
      )
      .subscribe();

    return channel;
  }

  // Se désabonner d'un canal
  static unsubscribe(channel: RealtimeChannel) {
    supabase.removeChannel(channel);
  }

  // Se désabonner de tous les canaux
  static unsubscribeAll() {
    supabase.removeAllChannels();
  }

  // Abonnement read models par project_id
  static subscribeToProjectReadModel(
    table: 'project_tasks_read_model' | 'project_risks_read_model',
    projectId: string,
    callback: (payload: any) => void,
  ) {
    const channel = supabase
      .channel(`${table}:${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table,
          filter: `project_id=eq.${projectId}`,
        },
        callback,
      )
      .subscribe();
    return channel;
  }

  // Obtenir le statut de la connexion temps réel
  static getConnectionStatus() {
    return supabase.getChannels();
  }

  // Envoyer un message de broadcast (pour les notifications personnalisées)
  static async broadcastMessage(
    channel: string,
    event: string,
    payload: any
  ) {
    try {
      const status = await supabase.channel(channel).send({
        type: 'broadcast',
        event,
        payload,
      });

      if (status !== 'ok') {
        throw new Error(`Supabase Realtime broadcast failed with status: ${status}`);
      }
      return { error: null };
    } catch (error) {
      console.error('Erreur broadcast:', error);
      return { error };
    }
  }

  // S'abonner aux messages de broadcast
  static subscribeToBroadcast(
    channel: string,
    event: string,
    callback: (payload: any) => void
  ) {
    const realtimeChannel = supabase
      .channel(channel)
      .on('broadcast', { event: event }, callback)
      .subscribe();

    return realtimeChannel;
  }
}

// Export simple pour compatibilité avec l'import existant
export const realtimeService = {
  subscribeToTable: RealtimeService.subscribeToTable,
  unsubscribeFromTable: RealtimeService.unsubscribe,
  unsubscribeAll: RealtimeService.unsubscribeAll,
  getConnectionStatus: RealtimeService.getConnectionStatus,
  broadcastMessage: RealtimeService.broadcastMessage,
  subscribeToBroadcast: RealtimeService.subscribeToBroadcast,
};

export default RealtimeService;
