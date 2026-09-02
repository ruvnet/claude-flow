/**
 * Intraday Toast Sync Cron
 *
 * Runs every hour during service hours (2 PM - 1 AM EST = 7 PM - 6 AM UTC).
 * For each active location with Toast credentials:
 *   1. Fetches today's hourly sales via getHourlySales()
 *   2. Upserts into daily_hourly_sales (same table the daily sync uses)
 *   3. Fetches today's running totals via getDaySummary()
 *   4. Upserts into daily_actuals with current revenue/covers
 *
 * Auth: CRON_SECRET bearer token (same as other crons).
 * Errors are caught per-location so one failure doesn't block others.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';

export const config = { maxDuration: 120 };
import {
  withRetry,
  logCronResult,
  sendCronAlertIfNeeded,
  logCronFailure,
  isVercelCronRetry,
  type CronLocationResult,
} from '$lib/server/cron-helpers';

/** Get today's date string in EST (America/New_York). */
function getTodayEST(): string {
  const now = new Date();
  const estStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  // en-CA gives YYYY-MM-DD format
  return estStr;
}

export const GET: RequestHandler = async ({ request }) => {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isRetry = isVercelCronRetry(request);
  const sb = getSupabaseService();
  const results: CronLocationResult[] = [];
  const todayStr = getTodayEST();

  // Get all active locations with Toast credentials
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('*')
    .eq('is_active', true)
    .not('toast_guid', 'is', null);

  if (locErr || !locations) {
    return json(
      { error: 'Failed to fetch locations', details: locErr?.message },
      { status: 500 },
    );
  }

  for (const loc of locations) {
    if (!loc.toast_client_id || !loc.toast_client_secret || !loc.toast_guid) {
      results.push({
        location: loc.name,
        status: 'skipped',
        reason: 'Missing Toast credentials',
      });
      continue;
    }

    const toastClient = createToastClientFromCredentials({
      clientId: loc.toast_client_id,
      clientSecret: loc.toast_client_secret,
      restaurantGuid: loc.toast_guid,
    });

    // Revenue center filter for shared Toast GUIDs (Little Wing / Vessel)
    const rcFilter: string[] | undefined = loc.revenue_center_filter || undefined;

    try {
      await withRetry(
        async () => {
          const now = new Date().toISOString();

          // --- Hourly sales ---
          const hourlySales = await toastClient.getHourlySales(todayStr, rcFilter);
          if (hourlySales.length > 0) {
            const hourlyRows = hourlySales.map((h) => ({
              location_id: loc.id,
              business_date: todayStr,
              hour_of_day: h.hour,
              revenue: h.revenue,
              covers: h.covers,
              order_count: h.orderCount,
            }));
            await sb
              .from('daily_hourly_sales')
              .upsert(hourlyRows, {
                onConflict: 'location_id,business_date,hour_of_day',
              });
          }

          // --- Day summary (running totals) ---
          const daySummary = await toastClient.getDaySummary(todayStr, rcFilter);
          await sb.from('daily_actuals').upsert(
            {
              location_id: loc.id,
              business_date: todayStr,
              revenue: daySummary.totalRevenue,
              covers: daySummary.totalCovers,
              order_count: daySummary.orderCount,
              total_discounts: daySummary.totalDiscounts,
              total_comps: daySummary.totalComps,
              synced_at: now,
            },
            { onConflict: 'location_id,business_date' },
          );

          results.push({
            location: loc.name,
            status: 'success',
            date: todayStr,
            revenue: daySummary.totalRevenue,
            covers: daySummary.totalCovers,
            hourlyBuckets: hourlySales.length,
          });
        },
        {
          label: `intraday-sync:${loc.name}`,
          maxAttempts: 2,
          delayMs: 5000,
        },
      );
    } catch (err: any) {
      Sentry.captureException(err);
      results.push({
        location: loc.name,
        status: 'error',
        date: todayStr,
        error: err.message,
      });
      await logCronFailure(sb, 'intraday_sync_cron', loc.name, err.message);
    }
  }

  // Log outcome to system_health
  await logCronResult(sb, 'intraday_sync_cron', results);
  if (!isRetry) {
    await sendCronAlertIfNeeded('intraday_sync_cron', results, locations.length);
  }

  return json({ date: todayStr, results });
};
