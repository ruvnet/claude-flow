import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

/**
 * GET /api/v1/admin/cron-status
 *
 * Returns the last run status of each HELIXO cron job by querying
 * system_health for cron-related entries. Used by the admin dashboard
 * and Data Source Map page.
 *
 * Response shape:
 *   { crons: CronStatus[] }
 */

interface CronStatus {
  name: string;
  label: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  lastRun: string | null;
  details: Record<string, unknown>;
}

const CRON_COMPONENTS: { component: string; label: string }[] = [
  { component: 'toast_sync_cron', label: 'Toast POS Sync' },
  { component: 'daily_insights_email_cron', label: 'Daily Insights Email' },
  { component: 'daily_refresh_cron', label: 'Daily Refresh & Health' },
  { component: 'data_integrity_cron', label: 'Data Integrity Check' },
  { component: 'intraday_sync_cron', label: 'Intraday Toast Sync' },
  { component: 'google_sync_cron', label: 'Google Reviews Sync' },
  { component: 'yelp_sync_cron', label: 'Yelp Reviews Sync' },
  { component: 'nps_rollup_cron', label: 'NPS Rollup' },
  { component: 'competitive_scan_cron', label: 'Competitive Scan' },
];

export const GET: RequestHandler = async () => {
  const sb = getSupabaseService();

  const { data: rows, error } = await sb
    .from('system_health')
    .select('component, status, last_check, details')
    .in(
      'component',
      CRON_COMPONENTS.map((c) => c.component),
    );

  if (error) {
    return json({ error: 'Failed to query system_health', details: error.message }, { status: 500 });
  }

  const rowMap = new Map<string, (typeof rows)[number]>();
  for (const row of rows ?? []) {
    rowMap.set(row.component, row);
  }

  const crons: CronStatus[] = CRON_COMPONENTS.map((c) => {
    const row = rowMap.get(c.component);
    if (!row) {
      return { name: c.component, label: c.label, status: 'unknown' as const, lastRun: null, details: {} };
    }
    return {
      name: c.component,
      label: c.label,
      status: row.status as CronStatus['status'],
      lastRun: row.last_check,
      details: (row.details as Record<string, unknown>) ?? {},
    };
  });

  return json({ crons });
};
