import React, { useEffect, useState } from 'react';
import AuditLogService, { AuditLogEntry } from '../services/auditLogService';
import { useLocalization } from '../contexts/LocalizationContext';

const PAGE_SIZE = 30;

interface ActivityLogsPageProps {
  onNavigate?: (entityType: string, entityId?: string, metadata?: Record<string, any>) => void;
}

const ActivityLogsPage: React.FC<ActivityLogsPageProps> = ({ onNavigate }) => {
  const { t } = useLocalization();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Fonction pour formater les valeurs de manière lisible
  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return '-';
    if (typeof value === 'boolean') return value ? t('yes') || 'Oui' : t('no') || 'Non';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      // Format de date ISO
      try {
        const date = new Date(value);
        return date.toLocaleDateString('fr-FR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {
        return value;
      }
    }
    return String(value);
  };

  const loadLogs = async (reset = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const offset = reset ? 0 : page * PAGE_SIZE;
      const result = await AuditLogService.getLogs({
        module: moduleFilter !== 'all' ? moduleFilter : undefined,
        action: actionFilter !== 'all' ? (actionFilter as any) : undefined,
        limit: PAGE_SIZE,
        offset
      });
      setLogs(reset ? result : [...logs, ...result]);
      setHasMore(result.length === PAGE_SIZE);
      if (reset) setPage(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleFilter, actionFilter]);

  const actions = ['create', 'update', 'delete', 'export', 'notification'];

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('activity_history') || 'Historique des activités'}</h1>
          <p className="text-sm text-gray-500">{t('activity_history_subtitle') || 'Suivi complet des actions réalisées dans la plateforme.'}</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={moduleFilter} onChange={(e) => { setModuleFilter(e.target.value); }} className="px-3 py-2 border rounded-lg text-sm">
            <option value="all">{t('all_modules') || 'Tous les modules'}</option>
            <option value="project">Project</option>
            <option value="planning">Planning</option>
            <option value="goal">Goals</option>
            <option value="comptabilite">Comptabilité</option>
          </select>
          <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="all">{t('all_actions') || 'Toutes les actions'}</option>
            {actions.map(action => (
              <option key={action} value={action}>{action}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-3">
        {logs.map(log => {
          const isExpanded = expandedLogId === log.id;
          const canNavigate = log.entityType && log.entityId && onNavigate;
          
          return (
            <div key={log.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-gray-900">{log.actorName || log.actorEmail || t('system') || 'Système'}</p>
                    <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                      {log.action} • {log.module}
                    </span>
                  </div>
                  {log.metadata?.summary && (
                    <p className="text-sm text-gray-600 mt-1">{log.metadata.summary}</p>
                  )}
                  {log.entityType && log.entityId && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-gray-500">
                        {log.entityType}: {log.entityId}
                      </span>
                      {canNavigate && (
                        <button
                          onClick={() => onNavigate(log.entityType!, log.entityId, log.metadata)}
                          className="text-xs text-emerald-600 hover:text-emerald-800 font-medium flex items-center gap-1"
                        >
                          <i className="fas fa-external-link-alt"></i>
                          {t('view_entity') || 'Voir l\'entité'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <span className="text-xs text-gray-400 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString('fr-FR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit'
                    })}
                  </span>
                  {(log.metadata && Object.keys(log.metadata).length > 0) && (
                    <button
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedLogId(null);
                        } else {
                          setExpandedLogId(log.id);
                        }
                      }}
                      className="text-xs text-gray-500 hover:text-emerald-600"
                      title={t('view_details') || 'Voir les détails'}
                    >
                      <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                    </button>
                  )}
                </div>
              </div>
              
              {isExpanded && log.metadata && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">{t('action_details') || 'Détails de l\'action'}</h4>
                  
                  {log.metadata.summary && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 mb-1">{t('summary') || 'Résumé'}</p>
                      <p className="text-sm text-gray-700">{log.metadata.summary}</p>
                    </div>
                  )}
                  
                  {(log.metadata.diff || (log.metadata.old_value && log.metadata.new_value)) && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 mb-2">{t('changes') || 'Modifications'}</p>
                      <div className="space-y-2">
                        {(() => {
                          // Gérer le format diff: { field: { old: value, new: value } }
                          if (log.metadata.diff) {
                            return Object.entries(log.metadata.diff).map(([key, diffObj]: [string, any]) => {
                              if (!diffObj || typeof diffObj !== 'object') return null;
                              const oldVal = diffObj.old;
                              const newVal = diffObj.new;
                              if (oldVal === newVal) return null;
                              return (
                                <div key={key} className="bg-gray-50 rounded p-2">
                                  <p className="text-xs font-medium text-gray-600 mb-1 capitalize">{key.replace(/_/g, ' ')}</p>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <p className="text-red-600 font-medium mb-1">{t('before') || 'Avant'}</p>
                                      <p className="text-gray-700 bg-red-50 p-1 rounded break-words">
                                        {formatValue(oldVal)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-green-600 font-medium mb-1">{t('after') || 'Après'}</p>
                                      <p className="text-gray-700 bg-green-50 p-1 rounded break-words">
                                        {formatValue(newVal)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          }
                          // Gérer le format old_value/new_value: { old_value: {...}, new_value: {...} }
                          if (log.metadata.old_value && log.metadata.new_value) {
                            const oldValue = log.metadata.old_value;
                            const newValue = log.metadata.new_value;
                            const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
                            return Array.from(allKeys).map(key => {
                              const oldVal = oldValue[key];
                              const newVal = newValue[key];
                              if (oldVal === newVal) return null;
                              return (
                                <div key={key} className="bg-gray-50 rounded p-2">
                                  <p className="text-xs font-medium text-gray-600 mb-1 capitalize">{key.replace(/_/g, ' ')}</p>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                      <p className="text-red-600 font-medium mb-1">{t('before') || 'Avant'}</p>
                                      <p className="text-gray-700 bg-red-50 p-1 rounded break-words">
                                        {formatValue(oldVal)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-green-600 font-medium mb-1">{t('after') || 'Après'}</p>
                                      <p className="text-gray-700 bg-green-50 p-1 rounded break-words">
                                        {formatValue(newVal)}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          }
                          return null;
                        })()}
                      </div>
                    </div>
                  )}
                  
                  {log.metadata.amount && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 mb-1">{t('amount') || 'Montant'}</p>
                      <p className="text-sm text-gray-700">{log.metadata.amount}</p>
                    </div>
                  )}
                  
                  {log.metadata.currency && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 mb-1">{t('currency') || 'Devise'}</p>
                      <p className="text-sm text-gray-700">{log.metadata.currency}</p>
                    </div>
                  )}
                  
                  {log.metadata.transactionDate && (
                    <div className="mb-3">
                      <p className="text-xs font-medium text-gray-500 mb-1">{t('transaction_date') || 'Date de transaction'}</p>
                      <p className="text-sm text-gray-700">{log.metadata.transactionDate}</p>
                    </div>
                  )}
                  
                  {Object.keys(log.metadata).filter(k => !['summary', 'old_value', 'new_value', 'diff', 'amount', 'currency', 'transactionDate', 'route', 'tab', 'autoOpenEntityId'].includes(k)).length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs font-medium text-gray-500 mb-2">{t('other_metadata') || 'Autres métadonnées'}</p>
                      <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto">
                        {JSON.stringify(
                          Object.fromEntries(
                            Object.entries(log.metadata).filter(([k]) => 
                              !['summary', 'old_value', 'new_value', 'diff', 'amount', 'currency', 'transactionDate', 'route', 'tab', 'autoOpenEntityId'].includes(k)
                            )
                          ),
                          null,
                          2
                        )}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {logs.length === 0 && !loading && (
          <p className="text-sm text-gray-500">{t('no_history') || 'Aucune activité enregistrée.'}</p>
        )}
        {loading && (
          <div className="text-center text-gray-500">
            <i className="fas fa-spinner fa-spin mr-2" />
            {t('loading') || 'Chargement...'}
          </div>
        )}
      </div>

      {hasMore && !loading && (
        <div className="mt-4 text-center">
          <button
            onClick={() => {
              setPage(prev => prev + 1);
              loadLogs();
            }}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg"
          >
            {t('load_more') || 'Charger plus'}
          </button>
        </div>
      )}
    </div>
  );
};

export default ActivityLogsPage;

