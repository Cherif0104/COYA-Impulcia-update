import { useState, useEffect, useCallback } from 'react';
import { DashboardSettingsService, DashboardWidgetKey, DASHBOARD_WIDGET_KEYS } from '../services/dashboardSettingsService';
import OrganizationService from '../services/organizationService';

export type DashboardWidgetVisibility = Record<string, boolean>;

export function useDashboardSettings() {
  const [visibility, setVisibility] = useState<DashboardWidgetVisibility>(() => {
    const v: Record<string, boolean> = {};
    DASHBOARD_WIDGET_KEYS.forEach((k) => {
      // Par défaut : cabanes de performance ON, "Analyse intelligente" OFF (remplacée par bloc Power BI)
      v[k] = k === 'intelligent_insights' ? false : true;
    });
    return v;
  });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const orgId = await OrganizationService.getCurrentUserOrganizationId();
    const { data } = await DashboardSettingsService.getSettings(orgId || undefined);
    const v: DashboardWidgetVisibility = {};
    DASHBOARD_WIDGET_KEYS.forEach((k) => {
      const row = data.find((r) => r.widgetKey === k);
      const defaultVal = k === 'intelligent_insights' ? false : true; // analytics_predictif default true
      v[k] = row ? row.enabled : defaultVal;
    });
    setVisibility(v);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const setWidgetEnabled = useCallback(async (widgetKey: DashboardWidgetKey, enabled: boolean) => {
    const orgId = await OrganizationService.getCurrentUserOrganizationId();
    if (!orgId) return;
    await DashboardSettingsService.upsert(orgId, widgetKey, enabled);
    setVisibility((prev) => ({ ...prev, [widgetKey]: enabled }));
  }, []);

  return { visibility, loading, setWidgetEnabled, reload: load };
}
