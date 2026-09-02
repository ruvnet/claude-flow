import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';
import { recordForecastAccuracy } from '$lib/server/domain/forecasting/forecast-accuracy';
import { adaptDOWWeights } from '$lib/server/domain/forecasting/labor-projection';
import { invalidateSuggestionCache } from '$lib/server/domain/forecasting/ai-forecast';
import { syncWeather } from '$lib/server/integrations/weather/weather-service';
import { recordLearning } from '$lib/server/domain/record-learning';
import { learnShiftPatterns } from '$lib/server/domain/staffing/shift-patterns';
import { invalidateCache } from '$lib/server/cache';
import {
  withRetry,
  logCronResult,
  sendCronAlertIfNeeded,
  logCronFailure,
  isVercelCronRetry,
  type CronLocationResult,
} from '$lib/server/cron-helpers';

export const config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request, url }) => {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isRetry = isVercelCronRetry(request);
  const sb = getSupabaseService();
  const results: CronLocationResult[] = [];

  // Support backfill: ?from=2026-03-01&to=2026-03-24 or ?date=2026-03-24
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');
  const dateParam = url.searchParams.get('date');

  const dates: string[] = [];
  if (fromParam && toParam) {
    const start = new Date(fromParam);
    const end = new Date(toParam);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
  } else if (dateParam) {
    dates.push(dateParam);
  } else {
    // Use America/New_York (handles EST/EDT automatically — no hardcoded offset)
    const now = new Date();
    const etParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
    const etHour = parseInt(etParts.find(p => p.type === 'hour')!.value);
    const etDateStr = `${etParts.find(p => p.type === 'year')!.value}-${etParts.find(p => p.type === 'month')!.value}-${etParts.find(p => p.type === 'day')!.value}`;

    if (etHour >= 18) {
      // Evening run (~10 PM ET) — pull today's in-progress data
      dates.push(etDateStr);
    } else {
      // Morning run (~5–6 AM ET) — pull yesterday's final data
      const yesterday = new Date(etDateStr + 'T12:00:00');
      yesterday.setDate(yesterday.getDate() - 1);
      dates.push(yesterday.toISOString().split('T')[0]);

      // DAILY safety net: always re-sync 2 days ago to catch any partial/missed
      // data from a prior cron failure or timeout (e.g. Saturday dinner service
      // captured only by evening run, then Sunday morning cron timed out).
      const twoDaysAgo = new Date(etDateStr + 'T12:00:00');
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      dates.push(twoDaysAgo.toISOString().split('T')[0]);
    }
  }

  // Get all active locations
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('*')
    .eq('is_active', true)
    .not('toast_guid', 'is', null);

  if (locErr || !locations) {
    return json({ error: 'Failed to fetch locations', details: locErr?.message }, { status: 500 });
  }

  // Process locations in parallel batches of 4 to fit within 120s timeout
  // (11 locations × ~10s each = 110s sequential; 3 batches of 4 × 10s = 30s parallel)
  const BATCH_SIZE = 4;
  const validLocations = locations.filter(
    (loc: any) => loc.toast_client_id && loc.toast_client_secret && loc.toast_guid,
  );
  const skippedLocations = locations.filter(
    (loc: any) => !loc.toast_client_id || !loc.toast_client_secret || !loc.toast_guid,
  );
  for (const loc of skippedLocations) {
    results.push({ location: loc.name, status: 'skipped', reason: 'Missing Toast credentials' });
  }

  for (let batchStart = 0; batchStart < validLocations.length; batchStart += BATCH_SIZE) {
    const batch = validLocations.slice(batchStart, batchStart + BATCH_SIZE);
    const batchResults = await Promise.allSettled(batch.map(async (loc: any) => {

    const toastClient = createToastClientFromCredentials({
      clientId: loc.toast_client_id,
      clientSecret: loc.toast_client_secret,
      restaurantGuid: loc.toast_guid,
    });

    // Revenue center filter: used when multiple locations share one Toast GUID
    const rcFilter: string[] | undefined = loc.revenue_center_filter || undefined;

    // Get job mapping for this location (once per location)
    const { data: mappings } = await sb
      .from('toast_job_mapping')
      .select('toast_job_name, dashboard_position')
      .eq('location_id', loc.id);
    const mapLookup: Record<string, string> = {};
    for (const m of (mappings || [])) {
      mapLookup[m.toast_job_name] = m.dashboard_position;
    }

    // Closed days: skip sync on days the location is known to be closed
    const closedDays: number[] = loc.closed_days_of_week || [];

    for (const syncDate of dates) {
      // Skip if the location is closed on this day of the week
      const syncDow = new Date(syncDate + 'T12:00:00Z').getUTCDay();
      if (closedDays.includes(syncDow)) {
        results.push({ location: loc.name, status: 'skipped', reason: `Closed on ${syncDate}` });
        continue;
      }

      try {
        // Wrap the full location+date sync in a retry (1 retry after 5s)
        await withRetry(async () => {
          const daySummary = await toastClient.getDaySummary(syncDate, rcFilter);
          const now = new Date().toISOString();

          await sb.from('daily_actuals').upsert({
            location_id: loc.id, business_date: syncDate,
            revenue: daySummary.totalRevenue, covers: daySummary.totalCovers,
            order_count: daySummary.orderCount, total_discounts: daySummary.totalDiscounts,
            total_comps: daySummary.totalComps, synced_at: now,
          }, { onConflict: 'location_id,business_date' });

          if (daySummary.salesMix.length > 0) {
            const mixRows = daySummary.salesMix.map(m => ({
              location_id: loc.id, business_date: syncDate,
              category: m.category, revenue: m.revenue,
              item_count: m.itemCount, pct_of_total: m.pctOfTotal, synced_at: now,
            }));
            await sb.from('daily_sales_mix').upsert(mixRows, { onConflict: 'location_id,business_date,category' });
          }

          if (daySummary.pmix.length > 0) {
            const pmixRows = daySummary.pmix.slice(0, 100).map(p => ({
              location_id: loc.id, business_date: syncDate,
              item_name: p.itemName, item_guid: p.itemGuid, category: p.category,
              quantity: p.quantity, revenue: p.revenue, avg_price: p.avgPrice, synced_at: now,
            }));
            await sb.from('daily_pmix').upsert(pmixRows, { onConflict: 'location_id,business_date,item_name' });
          }

          // Hourly sales — computed inside getDaySummary, no extra API calls
          if (daySummary.hourlySales.length > 0) {
            const hourlyRows = daySummary.hourlySales.map(h => ({
              location_id: loc.id, business_date: syncDate,
              hour_of_day: h.hour, revenue: h.revenue, covers: h.covers, order_count: h.orderCount,
            }));
            await sb.from('daily_hourly_sales').upsert(hourlyRows, { onConflict: 'location_id,business_date,hour_of_day' });
          }

          // Dining metrics — computed inside getDaySummary, no extra API calls
          if (daySummary.diningMetrics.totalOrders > 0 && daySummary.diningMetrics.avgDwellMinutes > 0) {
            await sb.from('daily_dining_metrics').upsert({
              location_id: loc.id, business_date: syncDate,
              avg_dwell_minutes: daySummary.diningMetrics.avgDwellMinutes,
              avg_turns_per_seat: daySummary.diningMetrics.avgTurnsPerSeat,
              total_orders: daySummary.diningMetrics.totalOrders,
              avg_party_size: daySummary.diningMetrics.avgPartySize,
              peak_hour_turns: daySummary.diningMetrics.peakHourTurns, synced_at: now,
            }, { onConflict: 'location_id,business_date' });
          }

          const laborByJob = await toastClient.getLaborByJob(syncDate);

          // ── Pastry labor allocation rule (Le Supreme shared pastry team) ──
          // Le Supreme's Pastry labor from Toast is shared across 3 locations:
          //   70% stays on Le Supreme, 25% allocated to Anthology, 5% to HIROKI-SAN Detroit
          const LE_SUPREME_ID = 'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce';
          const PASTRY_ALLOC_TARGETS = [
            { locationId: '84f4ea7f-722d-4296-894b-6ecfe389b2d5', pct: 0.25 }, // Anthology
            { locationId: 'b4035001-0928-4ada-a0f0-f2a272393147', pct: 0.05 }, // HIROKI-SAN Detroit
          ];

          const unmappedJobs: string[] = [];
          for (const job of laborByJob) {
            const mappedPosition = mapLookup[job.jobTitle] || 'EXCLUDE';
            if (mappedPosition === 'EXCLUDE') {
              if (!mapLookup[job.jobTitle]) {
                unmappedJobs.push(`${job.jobTitle} ($${job.laborDollars.toFixed(0)})`);
              }
              continue;
            }

            let laborDollars = Math.round(job.laborDollars * 100) / 100;
            let regularHours = Math.round(job.regularHours * 100) / 100;
            let overtimeHours = Math.round(job.overtimeHours * 100) / 100;

            // If this is Le Supreme Pastry, allocate 30% to other locations
            if (loc.id === LE_SUPREME_ID && mappedPosition === 'Pastry') {
              const fullDollars = laborDollars;
              const fullRegHours = regularHours;
              const fullOtHours = overtimeHours;

              // Le Supreme keeps 70%
              laborDollars = Math.round(fullDollars * 0.70 * 100) / 100;
              regularHours = Math.round(fullRegHours * 0.70 * 100) / 100;
              overtimeHours = Math.round(fullOtHours * 0.70 * 100) / 100;

              // Allocate to Anthology (25%) and HIROKI-SAN (5%)
              for (const target of PASTRY_ALLOC_TARGETS) {
                await sb.from('daily_labor').upsert({
                  location_id: target.locationId, business_date: syncDate,
                  toast_job_name: `Pastry (from Le Supreme ${Math.round(target.pct * 100)}%)`,
                  mapped_position: 'Pastry',
                  labor_dollars: Math.round(fullDollars * target.pct * 100) / 100,
                  regular_hours: Math.round(fullRegHours * target.pct * 100) / 100,
                  overtime_hours: Math.round(fullOtHours * target.pct * 100) / 100,
                  synced_at: now,
                }, { onConflict: 'location_id,business_date,toast_job_name' });
              }
            }

            await sb.from('daily_labor').upsert({
              location_id: loc.id, business_date: syncDate,
              toast_job_name: job.jobTitle, mapped_position: mappedPosition,
              labor_dollars: laborDollars, regular_hours: regularHours, overtime_hours: overtimeHours, synced_at: now,
            }, { onConflict: 'location_id,business_date,toast_job_name' });
          }

          // Data quality check: warn if revenue is suspiciously low vs historical average
          if (daySummary.totalRevenue < 100) {
            const dow = new Date(syncDate + 'T12:00:00').getDay();
            const fourWeeksAgo = new Date(syncDate + 'T12:00:00');
            fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
            const { data: histRows } = await sb.from('daily_actuals')
              .select('revenue').eq('location_id', loc.id)
              .gte('business_date', fourWeeksAgo.toISOString().split('T')[0])
              .lt('business_date', syncDate).gt('revenue', 0);
            const sameDowHist = (histRows || []).filter(r =>
              new Date((r as any).business_date + 'T12:00:00').getDay() === dow
            );
            const histAvg = sameDowHist.length > 0
              ? sameDowHist.reduce((s: number, r: any) => s + Number(r.revenue), 0) / sameDowHist.length : 0;
            if (histAvg > 1000) {
              console.warn(`[Toast] DATA QUALITY: ${loc.name} ${syncDate} returned $${daySummary.totalRevenue} but historical ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dow]} avg is $${Math.round(histAvg).toLocaleString()}. Orders fetched: ${daySummary.orderCount}`);
            }
          }

          // Invalidate forecast cache so next load picks up new actuals
          invalidateSuggestionCache(loc.id, syncDate);

          try { await recordForecastAccuracy(loc.id, syncDate); } catch (_) { /* non-critical */ }

          if (unmappedJobs.length > 0) {
            console.warn(`[Toast] ${loc.name} ${syncDate}: ${unmappedJobs.length} unmapped jobs (no mapping → skipped labor): ${unmappedJobs.join(', ')}`);
          }

          const laborTotal = laborByJob
            .filter(j => mapLookup[j.jobTitle] && mapLookup[j.jobTitle] !== 'EXCLUDE')
            .reduce((s, j) => s + j.laborDollars, 0);

          results.push({
            location: loc.name, status: 'success', date: syncDate,
            revenue: daySummary.totalRevenue, covers: daySummary.totalCovers,
            laborEntries: laborByJob.length,
            laborDollars: Math.round(laborTotal),
            unmappedJobs: unmappedJobs.length > 0 ? unmappedJobs : undefined,
            salesMixCategories: daySummary.salesMix.length,
            pmixItems: daySummary.pmix.length, hourlyBuckets: 'synced',
          });
        }, { label: `toast-sync:${loc.name}:${syncDate}`, maxAttempts: 2, delayMs: 5000 });
      } catch (err: any) {
        Sentry.captureException(err);
        results.push({ location: loc.name, status: 'error', date: syncDate, error: err.message });
        await logCronFailure(sb, 'toast_sync_cron', loc.name, err.message);
      }
    }
    }));

    // Collect results from settled promises (failures already caught per-location above)
    for (const settled of batchResults) {
      if (settled.status === 'rejected') {
        console.error('[Toast] Batch promise rejected:', settled.reason);
      }
    }
  }

  // Invalidate dashboard caches after upserting actuals
  invalidateCache('kpi:');
  invalidateCache('exec:');
  invalidateCache('comparison:');

  // Log cron outcome to system_health and send alert if >50% failed
  await logCronResult(sb, 'toast_sync_cron', results);
  if (!isRetry) {
    await sendCronAlertIfNeeded('toast_sync_cron', results, locations.length);
  }

  // Write per-location error rows to system_health so the health endpoint surfaces them
  const failedResults = results.filter(r => r.status === 'error');
  if (failedResults.length > 0) {
    try {
      await sb.from('system_health').insert({
        component: 'toast-sync',
        status: 'error',
        message: `${failedResults.length} location(s) failed during sync`,
        details: { failedLocations: failedResults.map(r => ({ location: r.location, error: r.error, date: r.date })) },
        checked_at: new Date().toISOString(),
      });
    } catch (_) { /* non-critical — don't fail the sync response */ }
  }

  // Sync weather for each location (non-critical)
  const weatherResults: any[] = [];
  for (const loc of locations) {
    try {
      const weatherResult = await syncWeather(loc.id);
      if (weatherResult.daysUpserted > 0) {
        weatherResults.push({ location: loc.name, days: weatherResult.daysUpserted });
      }
    } catch (_) { /* non-critical — don't fail sync */ }
  }

  // After sync, if today is Sunday (end of week), adapt DOW weights from actuals
  const now = new Date();
  const estOffset = -5 * 60;
  const estNow = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
  if (estNow.getDay() === 0) {
    const adaptResults: any[] = [];
    for (const loc of locations) {
      try {
        const adaptation = await adaptDOWWeights(loc.id);
        if (adaptation.changes.length > 0) {
          adaptResults.push({
            location: loc.name,
            positionsUpdated: adaptation.positionsUpdated,
            weeksAnalyzed: adaptation.weeksAnalyzed,
            changesCount: adaptation.changes.length,
          });
          await recordLearning({
            locationId: loc.id,
            category: 'labor',
            learning: `Weekly DOW weight adaptation: ${adaptation.changes.length} weight changes across ${adaptation.positionsUpdated} positions based on ${adaptation.weeksAnalyzed}-week actuals`,
            source: 'dow_weight_adapter',
            confidence: 0.8,
          });
        }
      } catch (_) { /* non-critical */ }
    }
    // Learn shift start patterns from Toast time entries (weekly, like DOW weights)
    const shiftPatternResults: any[] = [];
    for (const loc of locations) {
      try {
        const patternResult = await learnShiftPatterns(loc.id, 30);
        if (patternResult.patternsUpserted > 0) {
          shiftPatternResults.push({
            location: loc.name,
            patterns: patternResult.patternsUpserted,
            entries: patternResult.entriesAnalyzed,
          });
          await recordLearning({
            locationId: loc.id,
            category: 'labor',
            learning: `Weekly shift pattern learning: ${patternResult.patternsUpserted} patterns from ${patternResult.entriesAnalyzed} time entries`,
            source: 'shift_pattern_learner',
            confidence: 0.8,
          });
        }
      } catch (_) { /* non-critical */ }
    }

    return json({ synced: dates, results, weatherResults, dowWeightAdaptation: adaptResults, shiftPatternLearning: shiftPatternResults });
  }

  return json({ synced: dates, results, weatherResults });
};
