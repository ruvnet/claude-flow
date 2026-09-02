import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';
import { generatePeriodForecasts } from '$lib/server/domain/forecasting/ai-forecast';

export const config = { maxDuration: 120 };
import { recordLearning } from '$lib/server/domain/record-learning';
import { logCronResult, type CronLocationResult } from '$lib/server/cron-helpers';
import { sendDiagnosticsEmail } from '$lib/server/diagnostics-email';
import { quickCheckYesterday } from '$lib/server/domain/data-integrity';

/**
 * Daily Refresh Cron — 6:00 AM EST (11:00 UTC)
 *
 * Runs after the 5 AM Toast sync and 5:30 AM insights email.
 *   1. Data source health scan (table freshness + API connectivity)
 *   2. System learnings cleanup (>90 days)
 *   3. Infrastructure status checks (Vercel, GitHub Actions, Resend)
 *   4. Daily summary learning (sync results, forecast accuracy milestones)
 *   5. Diagnostics email to rr@methodco.com (data sources, crons, locations)
 */

interface HealthResult {
  component: string;
  status: 'healthy' | 'degraded' | 'down';
  details: Record<string, unknown>;
}

type SB = ReturnType<typeof getSupabaseService>;

function getYesterdayEST(): string {
  const now = new Date();
  const estOffset = -5 * 60;
  const estNow = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
  estNow.setDate(estNow.getDate() - 1);
  return estNow.toISOString().split('T')[0];
}

async function upsertHealth(sb: SB, r: HealthResult): Promise<void> {
  try {
    await sb.from('system_health').upsert(
      { component: r.component, status: r.status, last_check: new Date().toISOString(), details: r.details },
      { onConflict: 'component' },
    );
  } catch (err) {
    console.error(`[daily-refresh] Failed to upsert health for ${r.component}:`, (err as Error).message);
  }
}

function hr(component: string, status: HealthResult['status'], details: Record<string, unknown>): HealthResult {
  return { component, status, details };
}

// ---------------------------------------------------------------------------
// 1. Data Source Health Scan
// ---------------------------------------------------------------------------

async function checkTableFreshness(sb: SB, table: string, component: string, timeCol: string): Promise<HealthResult> {
  try {
    const staleMs = 26 * 60 * 60 * 1000;
    const { data, error } = await sb.from(table).select(timeCol).order(timeCol, { ascending: false }).limit(1).maybeSingle();
    if (error) return hr(component, 'down', { error: error.message, table });
    const lastSync = data?.[timeCol] ? new Date(data[timeCol]).getTime() : 0;
    const isStale = lastSync === 0 || Date.now() - lastSync > staleMs;
    const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
    return hr(component, isStale ? 'degraded' : 'healthy', { table, lastSyncAt: data?.[timeCol] || null, totalRows: count ?? 0, stale: isStale });
  } catch (err: any) {
    return hr(component, 'down', { error: err.message, table });
  }
}

async function checkDataSourceHealth(sb: SB): Promise<HealthResult[]> {
  const results: HealthResult[] = [];

  // Table freshness checks
  const tables = [
    { name: 'daily_actuals', component: 'toast_sync', col: 'synced_at' },
    { name: 'daily_labor', component: 'toast_labor_sync', col: 'synced_at' },
    { name: 'daily_weather', component: 'weather', col: 'synced_at' },
  ];
  for (const t of tables) {
    results.push(await checkTableFreshness(sb, t.name, t.component, t.col));
  }

  // Resy reservations
  try {
    results.push(await checkTableFreshness(sb, 'daily_reservations', 'resy_sync', 'synced_at'));
  } catch {
    results.push(hr('resy_sync', 'degraded', { note: 'daily_reservations table may not exist yet' }));
  }

  // Toast API auth test
  try {
    const { data: loc } = await sb
      .from('locations').select('toast_client_id, toast_client_secret, toast_guid')
      .eq('is_active', true).not('toast_guid', 'is', null).limit(1).maybeSingle();
    if (loc?.toast_client_id && loc?.toast_client_secret && loc?.toast_guid) {
      const client = createToastClientFromCredentials({
        clientId: loc.toast_client_id, clientSecret: loc.toast_client_secret, restaurantGuid: loc.toast_guid,
      });
      await client.getJobs();
      results.push(hr('toast_api', 'healthy', { authTest: 'passed' }));
    } else {
      results.push(hr('toast_api', 'degraded', { note: 'No active location with Toast credentials' }));
    }
  } catch (err: any) {
    results.push(hr('toast_api', 'down', { error: err.message }));
  }

  // Weather API ping
  try {
    const key = process.env.OPENWEATHER_API_KEY;
    if (key) {
      const res = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=New+York&appid=${key}&units=imperial`);
      results.push(hr('weather_api', res.ok ? 'healthy' : 'degraded', { httpStatus: res.status }));
    } else {
      results.push(hr('weather_api', 'degraded', { note: 'OPENWEATHER_API_KEY not set' }));
    }
  } catch (err: any) {
    results.push(hr('weather_api', 'down', { error: err.message }));
  }

  return results;
}

// ---------------------------------------------------------------------------
// 2. System Learnings Cleanup
// ---------------------------------------------------------------------------

async function cleanupLearnings(sb: SB): Promise<{ removed: number; consolidated: number }> {
  let removed = 0;
  let consolidated = 0;

  // Delete learnings older than 90 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const { count } = await sb.from('system_learnings').delete({ count: 'exact' }).lt('created_at', cutoff.toISOString());
  removed = count ?? 0;

  // Consolidate duplicate learnings (same category+source+prefix in last 30 days)
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const { data: recent } = await sb.from('system_learnings')
      .select('id, category, source, confidence, learning')
      .gte('created_at', thirtyDaysAgo.toISOString())
      .order('created_at', { ascending: false });

    if (recent && recent.length > 0) {
      const seen = new Map<string, { id: string; count: number; maxConf: number }>();
      const toDelete: string[] = [];

      for (const row of recent) {
        const key = `${row.category}:${row.source}:${row.learning?.substring(0, 80)}`;
        const existing = seen.get(key);
        if (existing) {
          toDelete.push(row.id);
          existing.count++;
          existing.maxConf = Math.min(1, Math.max(existing.maxConf, row.confidence + 0.1));
        } else {
          seen.set(key, { id: row.id, count: 1, maxConf: row.confidence });
        }
      }

      for (const [, entry] of seen) {
        if (entry.count > 1) {
          await sb.from('system_learnings').update({ confidence: Math.min(1, entry.maxConf) }).eq('id', entry.id);
        }
      }

      if (toDelete.length > 0) {
        for (let i = 0; i < toDelete.length; i += 100) {
          await sb.from('system_learnings').delete().in('id', toDelete.slice(i, i + 100));
        }
        consolidated = toDelete.length;
      }
    }
  } catch { /* non-critical */ }

  return { removed, consolidated };
}

// ---------------------------------------------------------------------------
// 3. Infrastructure Status
// ---------------------------------------------------------------------------

async function checkExternalAPI(
  name: string, url: string, headers: Record<string, string>,
  extractDetails: (body: any) => Record<string, unknown>,
): Promise<HealthResult> {
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return hr(name, 'degraded', { httpStatus: res.status });
    const body = await res.json();
    return hr(name, 'healthy', extractDetails(body));
  } catch (err: any) {
    return hr(name, 'down', { error: err.message });
  }
}

async function checkInfrastructure(): Promise<HealthResult[]> {
  const results: HealthResult[] = [];

  // Vercel
  const vercelToken = process.env.VERCEL_TOKEN;
  const vercelProjectId = process.env.VERCEL_PROJECT_ID;
  if (vercelToken && vercelProjectId) {
    results.push(await checkExternalAPI(
      'vercel',
      `https://api.vercel.com/v6/deployments?projectId=${vercelProjectId}&limit=1&state=READY`,
      { Authorization: `Bearer ${vercelToken}` },
      (body) => {
        const d = body.deployments?.[0];
        return { latestUrl: d?.url || null, state: d?.state || 'unknown', createdAt: d?.created ? new Date(d.created).toISOString() : null };
      },
    ));
  } else {
    results.push(hr('vercel', 'degraded', { note: 'VERCEL_TOKEN or VERCEL_PROJECT_ID not set' }));
  }

  // GitHub Actions
  const ghToken = process.env.GITHUB_TOKEN;
  const ghRepo = process.env.GITHUB_REPO;
  if (ghToken && ghRepo) {
    results.push(await checkExternalAPI(
      'github_actions',
      `https://api.github.com/repos/${ghRepo}/actions/runs?per_page=3&status=completed`,
      { Authorization: `token ${ghToken}`, Accept: 'application/vnd.github+json' },
      (body) => {
        const run = body.workflow_runs?.[0];
        const conclusion = run?.conclusion || 'unknown';
        return { latestRun: run?.name || null, conclusion, runAt: run?.updated_at || null };
      },
    ));
    // Override status based on conclusion
    const last = results[results.length - 1];
    if (last.details.conclusion && last.details.conclusion !== 'success') {
      last.status = 'degraded';
    }
  } else {
    results.push(hr('github_actions', 'degraded', { note: 'GITHUB_TOKEN or GITHUB_REPO not set' }));
  }

  // Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${resendKey}` } });
      results.push(hr('resend', res.ok ? 'healthy' : 'degraded', { httpStatus: res.status }));
    } catch (err: any) {
      results.push(hr('resend', 'down', { error: err.message }));
    }
  } else {
    results.push(hr('resend', 'degraded', { note: 'RESEND_API_KEY not set' }));
  }

  return results;
}

// ---------------------------------------------------------------------------
// 4. Daily Summary Learning
// ---------------------------------------------------------------------------

async function recordDailySummary(sb: SB, yesterday: string): Promise<string[]> {
  const notes: string[] = [];

  // Location sync counts
  const { data: actuals } = await sb.from('daily_actuals').select('location_id').eq('business_date', yesterday).not('revenue', 'is', null);
  const { data: allLocs } = await sb.from('locations').select('id').eq('is_active', true);
  const syncedCount = actuals?.length ?? 0;
  const totalCount = allLocs?.length ?? 0;

  if (syncedCount > 0) {
    notes.push(`${syncedCount}/${totalCount} locations synced for ${yesterday}`);
    if (syncedCount < totalCount) {
      await recordLearning({
        category: 'forecast',
        learning: `Daily sync gap: only ${syncedCount}/${totalCount} locations had revenue data for ${yesterday}`,
        source: 'daily_refresh_cron', confidence: 0.9,
      });
    }
  }

  // Forecast accuracy milestones (MAPE < 5%)
  try {
    const { data: rows } = await sb.from('forecast_accuracy').select('location_id, mape').eq('business_date', yesterday).not('mape', 'is', null);
    if (rows) {
      for (const row of rows) {
        if (row.mape !== null && row.mape < 5) {
          const { data: loc } = await sb.from('locations').select('name').eq('id', row.location_id).maybeSingle();
          const msg = `Forecast accuracy milestone: ${loc?.name || row.location_id} MAPE ${row.mape.toFixed(1)}% (below 5%)`;
          notes.push(msg);
          await recordLearning({ locationId: row.location_id, category: 'forecast', learning: msg, source: 'daily_refresh_cron', confidence: 0.95 });
        }
      }
    }
  } catch { /* forecast_accuracy table may not exist yet */ }

  // DOW weight adaptations from Sunday runs
  try {
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const { data: adaptations } = await sb.from('system_learnings').select('learning')
      .eq('source', 'dow_weight_adapter').gte('created_at', oneDayAgo.toISOString()).limit(5);
    if (adaptations && adaptations.length > 0) {
      notes.push(`${adaptations.length} DOW weight adaptation(s) recorded in last 24h`);
    }
  } catch { /* non-critical */ }

  return notes;
}

// ---------------------------------------------------------------------------
// Main Handler
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ request }) => {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const yesterday = getYesterdayEST();
  const healthChecks: HealthResult[] = [];
  let learningsCleanup = { removed: 0, consolidated: 0 };
  let dailySummary: string[] = [];
  const errors: string[] = [];

  // 1. Data source health scan — failures logged, never crash
  try {
    const dataHealth = await checkDataSourceHealth(sb);
    healthChecks.push(...dataHealth);
    for (const h of dataHealth) await upsertHealth(sb, h);
  } catch (err: any) {
    Sentry.captureException(err);
    const errResult = hr('data_source_scan', 'down', { error: err.message });
    healthChecks.push(errResult);
    await upsertHealth(sb, errResult);
    errors.push(`Data source scan: ${err.message}`);
  }

  // 2. System learnings cleanup — failures logged, never crash
  try {
    learningsCleanup = await cleanupLearnings(sb);
  } catch (err: any) {
    errors.push(`Learnings cleanup: ${(err as Error).message}`);
  }

  // 3. Infrastructure status — failures logged, never crash
  try {
    const infraHealth = await checkInfrastructure();
    healthChecks.push(...infraHealth);
    for (const h of infraHealth) await upsertHealth(sb, h);
  } catch (err: any) {
    Sentry.captureException(err);
    const errResult = hr('infra_check', 'down', { error: err.message });
    healthChecks.push(errResult);
    await upsertHealth(sb, errResult);
    errors.push(`Infrastructure check: ${err.message}`);
  }

  // 4. Daily summary learning — failures logged, never crash
  try {
    dailySummary = await recordDailySummary(sb, yesterday);
  } catch (err: any) {
    errors.push(`Daily summary: ${(err as Error).message}`);
  }

  // 5. Quick data integrity check — alert on missing yesterday data
  let integrityAlerts = 0;
  try {
    const integrityResults = await quickCheckYesterday();
    for (const loc of integrityResults) {
      if (loc.missingRevenue || loc.missingLabor) {
        integrityAlerts++;
        const missing = [
          loc.missingRevenue ? 'revenue' : null,
          loc.missingLabor ? 'labor' : null,
        ].filter(Boolean).join(' and ');
        await recordLearning({
          locationId: loc.locationId,
          category: 'forecast',
          learning: `Data integrity alert: ${loc.locationName} missing ${missing} for ${yesterday}. Toast sync may have failed.`,
          source: 'daily_refresh_cron',
          confidence: 0.95,
        });
      }
    }
    if (integrityAlerts > 0) {
      dailySummary.push(`Data integrity: ${integrityAlerts} location(s) missing yesterday's data`);
    }
  } catch (err: any) {
    errors.push(`Integrity check: ${(err as Error).message}`);
  }

  // 6. Pre-generate missing forecasts for current period — failures logged, never crash
  let forecastsGenerated = 0;
  try {
    const today = new Date();
    // Determine current FY2026 period (FY starts Dec 29 of prior year)
    const fyStart = new Date(today.getFullYear() - 1, 11, 29); // Dec 29 prior year
    const daysSinceStart = Math.floor((today.getTime() - fyStart.getTime()) / 86400000);
    const currentPeriod = Math.min(13, Math.max(1, Math.floor(daysSinceStart / 28) + 1));
    const periodStart = new Date(fyStart);
    periodStart.setDate(periodStart.getDate() + (currentPeriod - 1) * 28);
    const periodEnd = new Date(periodStart);
    periodEnd.setDate(periodEnd.getDate() + 27);
    const pStart = periodStart.toISOString().split('T')[0];
    const pEnd = periodEnd.toISOString().split('T')[0];

    const { data: activeLocs } = await sb.from('locations').select('id, name').eq('is_active', true);
    for (const loc of activeLocs || []) {
      const { count } = await sb.from('daily_forecasts').select('*', { count: 'exact', head: true })
        .eq('location_id', loc.id).gte('business_date', pStart).lte('business_date', pEnd);
      if ((count ?? 0) < 14) {
        // Less than half the period has AI suggestions — generate and persist to DB
        const suggestions = await generatePeriodForecasts(loc.id, pStart, pEnd).catch(() => null);
        if (suggestions && suggestions.length > 0) {
          const now = new Date().toISOString();
          const rows = suggestions.map((s) => ({
            location_id: loc.id,
            business_date: s.date,
            ai_suggested_revenue: s.suggestedRevenue,
            ai_suggested_covers: s.suggestedCovers,
            ai_confidence: s.confidence,
            ai_reasoning: s.reasoning,
            forecast_weights: s.weights,
          }));
          // Only insert where no row exists yet (don't overwrite manager-accepted forecasts)
          await sb.from('daily_forecasts').upsert(rows, {
            onConflict: 'location_id,business_date',
            ignoreDuplicates: true,
          }).catch(() => null);
          forecastsGenerated += rows.length;
        }
      }
    }
  } catch (err: any) {
    errors.push(`Forecast pre-gen: ${(err as Error).message}`);
  }

  // 7. Diagnostics email — failures logged, never crash
  let diagnosticsEmail = { sent: false, alertCount: 0 };
  try {
    diagnosticsEmail = await sendDiagnosticsEmail();
  } catch (err: any) {
    errors.push(`Diagnostics email: ${(err as Error).message}`);
  }
  // Determine overall cron health based on check results
  const downCount = healthChecks.filter((h) => h.status === 'down').length;
  const cronStatus: HealthResult['status'] =
    downCount > healthChecks.length / 2 ? 'degraded' : errors.length > 0 ? 'degraded' : 'healthy';

  // Record that this cron ran (always, even on partial failure)
  await upsertHealth(sb, hr('daily_refresh_cron', cronStatus, {
    ranAt: new Date().toISOString(), yesterday,
    checks: healthChecks.length, learningsRemoved: learningsCleanup.removed,
    learningsConsolidated: learningsCleanup.consolidated, summaryNotes: dailySummary.length,
    diagnosticsEmailSent: diagnosticsEmail.sent, diagnosticsAlerts: diagnosticsEmail.alertCount,
    integrityAlerts,
    errors: errors.length > 0 ? errors : undefined,
  }));

  // Log to the shared cron-result tracking system
  const cronResults: CronLocationResult[] = [{
    location: 'system',
    status: errors.length > 0 ? 'partial' : 'success',
    error: errors.length > 0 ? errors.join('; ') : undefined,
  }];
  await logCronResult(sb, 'daily_refresh_cron', cronResults);

  return json({ ok: true, date: yesterday, healthChecks, learningsCleanup, dailySummary, diagnosticsEmail, forecastsGenerated, errors });
};
