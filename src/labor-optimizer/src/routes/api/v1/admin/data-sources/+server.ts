import { json, type RequestHandler } from '@sveltejs/kit';
import { getSupabase } from '$lib/server/supabase';

interface SourceStatus {
  source: string;
  table: string;
  lastSync: string | null;
  recordCount: number;
  healthy: boolean;
}

// ---------------------------------------------------------------------------
// GET — Return sync status for each data source
// ---------------------------------------------------------------------------
export const GET: RequestHandler = async () => {
  const sb = getSupabase();

  const queries = [
    { source: 'toast_actuals', table: 'daily_actuals', dateCol: 'synced_at' },
    { source: 'toast_labor', table: 'daily_labor', dateCol: 'synced_at' },
    { source: 'dolce_schedule', table: 'scheduled_labor', dateCol: 'synced_at' },
    { source: 'resy', table: 'daily_reservations', dateCol: 'synced_at' },
    { source: 'weather', table: 'daily_weather', dateCol: 'fetched_at' },
    { source: 'toast_sales_mix', table: 'daily_sales_mix', dateCol: 'synced_at' },
    { source: 'toast_pmix', table: 'daily_pmix', dateCol: 'synced_at' },
    { source: 'toast_hourly', table: 'daily_hourly_sales', dateCol: 'synced_at' },
    { source: 'daily_forecasts', table: 'daily_forecasts', dateCol: 'updated_at' },
    { source: 'daily_labor_targets', table: 'daily_labor_targets', dateCol: 'updated_at' },
    { source: 'dow_weights', table: 'dow_weights', dateCol: 'updated_at' },
  ];

  const results: SourceStatus[] = [];

  const settled = await Promise.allSettled(
    queries.map(async (q) => {
      const [latestRes, countRes] = await Promise.all([
        sb
          .from(q.table)
          .select(q.dateCol)
          .order(q.dateCol, { ascending: false })
          .limit(1)
          .maybeSingle(),
        sb.from(q.table).select('*', { count: 'exact', head: true }),
      ]);

      const lastSync = latestRes.data?.[q.dateCol] ?? null;
      const recordCount = countRes.count ?? 0;
      const healthy = lastSync
        ? Date.now() - new Date(lastSync).getTime() < 25 * 60 * 60 * 1000
        : false;

      return {
        source: q.source,
        table: q.table,
        lastSync,
        recordCount,
        healthy,
      } satisfies SourceStatus;
    })
  );

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      // Table may not exist yet — mark unhealthy with zero records
      results.push({
        source: 'unknown',
        table: 'unknown',
        lastSync: null,
        recordCount: 0,
        healthy: false,
      });
    }
  }

  return json({ sources: results, queriedAt: new Date().toISOString() });
};
