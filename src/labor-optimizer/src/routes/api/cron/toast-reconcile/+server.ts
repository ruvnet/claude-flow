/**
 * Toast Reconciliation Cron
 *
 * Runs 4× daily (every 3 hours). For each active location:
 *   1. Fetches getDaySummary from Toast for the trailing 7 days
 *   2. Compares to daily_actuals in Supabase
 *   3. If discrepancy > $50 OR > 1% of Toast revenue, re-syncs that date automatically
 *   4. Logs results to system_health
 *
 * Schedule (vercel.json): "0 8,12,16,20 * * *" UTC ≈ 4 AM, 8 AM, 12 PM, 4 PM ET
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';
import { logCronResult, type CronLocationResult } from '$lib/server/cron-helpers';

export const config = { maxDuration: 120 };

const DISCREPANCY_THRESHOLD_ABS  = 50;   // $50 absolute gap triggers re-sync
const DISCREPANCY_THRESHOLD_PCT  = 0.01; // 1% relative gap triggers re-sync

function getTrailing7Days(): string[] {
  const dates: string[] = [];
  const now = new Date();
  // Use ET date for business date alignment
  const etDateStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
  const today = new Date(etDateStr + 'T12:00:00Z');

  for (let i = 1; i <= 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

export const GET: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const dates = getTrailing7Days();
  const runAt = new Date().toISOString();

  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('id, name, toast_guid, toast_client_id, toast_client_secret, revenue_center_filter, closed_days_of_week')
    .eq('is_active', true);

  if (locErr || !locations?.length) {
    return json({ error: 'Failed to load locations' }, { status: 500 });
  }

  const summary: {
    location: string;
    datesChecked: number;
    discrepancies: { date: string; toast: number; db: number; gap: number; resynced: boolean }[];
    errors: string[];
  }[] = [];

  const cronResults: CronLocationResult[] = [];

  for (const loc of locations) {
    if (!loc.toast_guid || !loc.toast_client_id || !loc.toast_client_secret) continue;

    const locSummary = { location: loc.name, datesChecked: 0, discrepancies: [] as any[], errors: [] as string[] };

    try {
      const toastClient = createToastClientFromCredentials({
        clientId: loc.toast_client_id,
        clientSecret: loc.toast_client_secret,
        restaurantGuid: loc.toast_guid,
      });

      const rcFilter: string[] | undefined = loc.revenue_center_filter || undefined;
      const closedDays: number[] = loc.closed_days_of_week || [];

      for (const date of dates) {
        const dow = new Date(date + 'T12:00:00Z').getUTCDay();
        if (closedDays.includes(dow)) continue;

        locSummary.datesChecked++;

        // Fetch from Toast
        let toastRevenue: number | null = null;
        try {
          const daySummary = await toastClient.getDaySummary(date, rcFilter);
          toastRevenue = daySummary.totalRevenue;
        } catch (e: any) {
          locSummary.errors.push(`Toast fetch ${date}: ${e.message}`);
          continue;
        }

        // Fetch from DB
        const { data: actual } = await sb
          .from('daily_actuals')
          .select('revenue')
          .eq('location_id', loc.id)
          .eq('business_date', date)
          .maybeSingle();

        const dbRevenue = actual?.revenue != null ? Number(actual.revenue) : null;

        // Compare
        if (toastRevenue === null) continue;

        const gap = Math.abs(toastRevenue - (dbRevenue ?? 0));
        const pctGap = toastRevenue > 0 ? gap / toastRevenue : 0;
        const hasDiscrepancy = (dbRevenue === null) || (gap > DISCREPANCY_THRESHOLD_ABS && pctGap > DISCREPANCY_THRESHOLD_PCT);

        if (hasDiscrepancy) {
          let resynced = false;

          // Auto re-sync: upsert the correct Toast value
          try {
            const now = new Date().toISOString();
            // Fetch full day summary again (already have it — use toastRevenue + full fields)
            const daySummary = await toastClient.getDaySummary(date, rcFilter);
            await sb.from('daily_actuals').upsert(
              {
                location_id: loc.id,
                business_date: date,
                revenue: daySummary.totalRevenue,
                covers: daySummary.totalCovers,
                order_count: daySummary.orderCount,
                total_discounts: daySummary.totalDiscounts,
                total_comps: daySummary.totalComps,
                synced_at: now,
              },
              { onConflict: 'location_id,business_date' },
            );

            // Re-sync hourly sales too
            if (daySummary.hourlySales.length > 0) {
              const hourlyRows = daySummary.hourlySales.map((h) => ({
                location_id: loc.id,
                business_date: date,
                hour_of_day: h.hour,
                revenue: h.revenue,
                covers: h.covers,
                order_count: h.orderCount,
              }));
              await sb.from('daily_hourly_sales').upsert(hourlyRows, {
                onConflict: 'location_id,business_date,hour_of_day',
              });
            }

            resynced = true;
          } catch (resyncErr: any) {
            locSummary.errors.push(`Re-sync ${date}: ${resyncErr.message}`);
          }

          locSummary.discrepancies.push({
            date,
            toast: toastRevenue,
            db: dbRevenue ?? 0,
            gap: Math.round(gap * 100) / 100,
            resynced,
          });
        }
      }
    } catch (e: any) {
      locSummary.errors.push(`Location error: ${e.message}`);
    }

    summary.push(locSummary);

    const totalGap = locSummary.discrepancies.reduce((s, d) => s + d.gap, 0);
    cronResults.push({
      locationId: loc.id,
      locationName: loc.name,
      status: locSummary.errors.length > 0 ? 'error' : 'success',
      details: {
        datesChecked: locSummary.datesChecked,
        discrepanciesFound: locSummary.discrepancies.length,
        resynced: locSummary.discrepancies.filter(d => d.resynced).length,
        totalGapCorrected: Math.round(totalGap * 100) / 100,
      },
      error: locSummary.errors[0],
    });
  }

  // Log to system_health
  const totalDiscrepancies = summary.reduce((s, l) => s + l.discrepancies.length, 0);
  const totalResynced = summary.reduce((s, l) => s + l.discrepancies.filter(d => d.resynced).length, 0);

  await sb.from('system_health').upsert(
    {
      component: 'toast_reconcile_cron',
      status: totalDiscrepancies === 0 ? 'healthy' : 'degraded',
      last_check: runAt,
      details: {
        datesChecked: dates,
        locationsChecked: summary.length,
        totalDiscrepancies,
        totalResynced,
        summary: summary.map(l => ({
          location: l.location,
          discrepancies: l.discrepancies.length,
          resynced: l.discrepancies.filter(d => d.resynced).length,
          errors: l.errors.length,
        })),
      },
    },
    { onConflict: 'component' },
  );

  await logCronResult(sb, 'toast_reconcile_cron', cronResults);

  return json({
    ok: true,
    ranAt: runAt,
    datesChecked: dates,
    locationsChecked: summary.length,
    totalDiscrepancies,
    totalResynced,
    summary,
  });
};
