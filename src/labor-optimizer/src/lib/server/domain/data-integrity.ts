/**
 * Data Integrity Scanner & Auto-Healer
 *
 * Scans all active HELIXO locations for data gaps (revenue, labor, weather,
 * budget, forecasts) and automatically triggers backfills where possible.
 *
 * Runs daily at 6:30 AM EST via /api/cron/data-integrity.
 */

import { getSupabaseService } from '$lib/server/supabase';
import { syncWeather } from '$lib/server/integrations/weather/weather-service';
import { recordLearning } from '$lib/server/domain/record-learning';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateGap {
  date: string;
  healed: boolean;
  error?: string;
}

export interface LocationReport {
  locationId: string;
  locationName: string;
  revenueGaps: DateGap[];
  laborGaps: DateGap[];
  weatherGaps: number;
  budgetGaps: number;
  forecastGaps: number;
  healedCount: number;
  status: 'healthy' | 'healing' | 'gaps_remaining';
}

export interface IntegrityReport {
  scannedAt: string;
  locations: LocationReport[];
  totalGaps: number;
  autoHealed: number;
  persistentGaps: number;
}

interface ScanOptions {
  dryRun?: boolean;
  locationId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const P1_START = '2025-12-29';
const WEATHER_START = '2025-01-01';
const LOCATIONS_WITHOUT_BUDGETS = ['Little Wing', 'Vessel', 'Anthology'];
const BACKFILL_BATCH_SIZE = 3;
const MAX_BACKFILL_RETRIES = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getYesterdayEST(): string {
  const now = new Date();
  const estOffset = -5 * 60;
  const estNow = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
  estNow.setDate(estNow.getDate() - 1);
  return estNow.toISOString().split('T')[0];
}

function getTodayEST(): string {
  const now = new Date();
  const estOffset = -5 * 60;
  const estNow = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
  return estNow.toISOString().split('T')[0];
}

function dateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const s = new Date(start + 'T12:00:00Z');
  const e = new Date(end + 'T12:00:00Z');
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  return dates;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Closed-day detection
// ---------------------------------------------------------------------------

type SB = ReturnType<typeof getSupabaseService>;

/**
 * Build a set of DOW numbers (0=Sun..6=Sat) that have NEVER had revenue
 * for this location. If a DOW has zero revenue on every occurrence, the
 * restaurant is assumed closed that day.
 */
async function getClosedDays(sb: SB, locationId: string): Promise<Set<number>> {
  const closed = new Set<number>();
  try {
    // Pull all daily_actuals for this location with revenue > 0
    const { data: rows } = await sb
      .from('daily_actuals')
      .select('business_date')
      .eq('location_id', locationId)
      .gt('revenue', 0);

    if (!rows || rows.length === 0) return closed;

    // Track which DOWs have ever had revenue
    const dowsWithRevenue = new Set<number>();
    for (const row of rows) {
      const d = new Date(row.business_date + 'T12:00:00Z');
      dowsWithRevenue.add(d.getDay());
    }

    // Any DOW not represented is closed (only if we have meaningful data)
    if (rows.length >= 14) {
      for (let dow = 0; dow < 7; dow++) {
        if (!dowsWithRevenue.has(dow)) closed.add(dow);
      }
    }
  } catch {
    // Non-critical — assume no closed days
  }
  return closed;
}

// ---------------------------------------------------------------------------
// Gap detection
// ---------------------------------------------------------------------------

async function findRevenueGaps(
  sb: SB,
  locationId: string,
  closedDays: Set<number>,
): Promise<string[]> {
  const yesterday = getYesterdayEST();
  const allDates = dateRange(P1_START, yesterday);

  // Fetch all dates that have revenue
  const { data: rows } = await sb
    .from('daily_actuals')
    .select('business_date')
    .eq('location_id', locationId)
    .gt('revenue', 0)
    .gte('business_date', P1_START)
    .lte('business_date', yesterday);

  const existingDates = new Set((rows || []).map((r) => r.business_date));

  return allDates.filter((date) => {
    if (existingDates.has(date)) return false;
    const dow = new Date(date + 'T12:00:00Z').getDay();
    return !closedDays.has(dow);
  });
}

async function findLaborGaps(sb: SB, locationId: string): Promise<string[]> {
  // Dates that have revenue but no labor
  const yesterday = getYesterdayEST();

  const { data: revenueDates } = await sb
    .from('daily_actuals')
    .select('business_date')
    .eq('location_id', locationId)
    .gt('revenue', 0)
    .gte('business_date', P1_START)
    .lte('business_date', yesterday);

  if (!revenueDates || revenueDates.length === 0) return [];

  const { data: laborDates } = await sb
    .from('daily_labor')
    .select('business_date')
    .eq('location_id', locationId)
    .gte('business_date', P1_START)
    .lte('business_date', yesterday);

  const laborSet = new Set((laborDates || []).map((r) => r.business_date));

  return revenueDates
    .map((r) => r.business_date)
    .filter((d) => !laborSet.has(d));
}

async function countWeatherGaps(sb: SB, locationId: string): Promise<number> {
  const today = getTodayEST();
  const allDates = dateRange(WEATHER_START, today);

  const { count } = await sb
    .from('daily_weather')
    .select('*', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .gte('business_date', WEATHER_START)
    .lte('business_date', today);

  return Math.max(0, allDates.length - (count ?? 0));
}

async function countBudgetGaps(sb: SB, locationId: string): Promise<number> {
  // Check fiscal year range from periods table
  const { data: periods } = await sb
    .from('periods')
    .select('start_date, end_date')
    .eq('location_id', locationId)
    .order('start_date', { ascending: true });

  if (!periods || periods.length === 0) return 0;

  const fyStart = periods[0].start_date;
  const fyEnd = periods[periods.length - 1].end_date;
  const allDates = dateRange(fyStart, fyEnd);

  const { count } = await sb
    .from('daily_budget')
    .select('*', { count: 'exact', head: true })
    .eq('location_id', locationId)
    .gte('business_date', fyStart)
    .lte('business_date', fyEnd);

  return Math.max(0, allDates.length - (count ?? 0));
}

async function countForecastGaps(sb: SB, locationId: string): Promise<number> {
  // Check P4+ (current and future periods)
  const today = getTodayEST();

  const { data: periods } = await sb
    .from('periods')
    .select('start_date, end_date, period_number')
    .eq('location_id', locationId)
    .gte('period_number', 4)
    .order('start_date', { ascending: true });

  if (!periods || periods.length === 0) return 0;

  // Only check periods that include today or future
  const relevantPeriods = periods.filter((p) => p.end_date >= today);
  if (relevantPeriods.length === 0) return 0;

  let totalGaps = 0;
  for (const period of relevantPeriods) {
    const periodDates = dateRange(period.start_date, period.end_date);
    const { count } = await sb
      .from('daily_forecasts')
      .select('*', { count: 'exact', head: true })
      .eq('location_id', locationId)
      .gte('business_date', period.start_date)
      .lte('business_date', period.end_date);

    totalGaps += Math.max(0, periodDates.length - (count ?? 0));
  }

  return totalGaps;
}

// ---------------------------------------------------------------------------
// Auto-healing
// ---------------------------------------------------------------------------

async function healRevenueAndLabor(
  locationId: string,
  gapDates: string[],
  dryRun: boolean,
): Promise<DateGap[]> {
  if (dryRun || gapDates.length === 0) {
    return gapDates.map((date) => ({ date, healed: false }));
  }

  const cronSecret = process.env.CRON_SECRET;
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.PUBLIC_BASE_URL || 'https://helixokpi.com';

  const results: DateGap[] = [];
  const failureCounts = new Map<string, number>();

  // Process in batches of BACKFILL_BATCH_SIZE days
  for (let i = 0; i < gapDates.length; i += BACKFILL_BATCH_SIZE) {
    const batch = gapDates.slice(i, i + BACKFILL_BATCH_SIZE);
    const startDate = batch[0];
    const endDate = batch[batch.length - 1];

    let success = false;
    for (let attempt = 1; attempt <= MAX_BACKFILL_RETRIES; attempt++) {
      try {
        const res = await fetch(`${baseUrl}/api/v1/admin/backfill`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${cronSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            locationId,
            startDate,
            endDate,
            includeLabor: true,
            includeRevenue: true,
          }),
        });

        if (res.ok) {
          const body = await res.json();
          const successDates = new Set(
            (body.results || [])
              .filter((r: any) => r.status === 'success')
              .map((r: any) => r.date),
          );
          for (const date of batch) {
            results.push({ date, healed: successDates.has(date) });
          }
          success = true;
          break;
        } else {
          const errText = await res.text();
          console.warn(
            `[data-integrity] Backfill attempt ${attempt}/${MAX_BACKFILL_RETRIES} ` +
            `failed for ${locationId} ${startDate}-${endDate}: ${res.status} ${errText}`,
          );
        }
      } catch (err: any) {
        console.warn(
          `[data-integrity] Backfill attempt ${attempt}/${MAX_BACKFILL_RETRIES} ` +
          `error for ${locationId} ${startDate}-${endDate}: ${err.message}`,
        );
      }

      if (attempt < MAX_BACKFILL_RETRIES) {
        await sleep(3000 * attempt);
      }
    }

    if (!success) {
      for (const date of batch) {
        const count = (failureCounts.get(date) || 0) + 1;
        failureCounts.set(date, count);
        results.push({
          date,
          healed: false,
          error: `Failed after ${MAX_BACKFILL_RETRIES} attempts`,
        });
      }
    }

    // Small delay between batches to avoid overloading Toast API
    if (i + BACKFILL_BATCH_SIZE < gapDates.length) {
      await sleep(1000);
    }
  }

  return results;
}

async function healWeather(locationId: string, gapCount: number, dryRun: boolean): Promise<number> {
  if (dryRun || gapCount === 0) return 0;

  try {
    const result = await syncWeather(locationId);
    return result.daysUpserted;
  } catch (err: any) {
    console.warn(`[data-integrity] Weather sync failed for ${locationId}: ${err.message}`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Main scanner
// ---------------------------------------------------------------------------

export async function scanAndHeal(options: ScanOptions = {}): Promise<IntegrityReport> {
  const { dryRun = false, locationId: filterLocationId } = options;
  const sb = getSupabaseService();
  const scannedAt = new Date().toISOString();

  // Get all active locations
  let query = sb
    .from('locations')
    .select('id, name, toast_guid')
    .eq('is_active', true);

  if (filterLocationId) {
    query = query.eq('id', filterLocationId);
  }

  const { data: locations, error: locErr } = await query;

  if (locErr || !locations) {
    console.error('[data-integrity] Failed to fetch locations:', locErr?.message);
    return { scannedAt, locations: [], totalGaps: 0, autoHealed: 0, persistentGaps: 0 };
  }

  const reports: LocationReport[] = [];
  let totalGaps = 0;
  let autoHealed = 0;
  let persistentGaps = 0;

  for (const loc of locations) {
    console.log(`[data-integrity] Scanning ${loc.name}...`);

    const report: LocationReport = {
      locationId: loc.id,
      locationName: loc.name,
      revenueGaps: [],
      laborGaps: [],
      weatherGaps: 0,
      budgetGaps: 0,
      forecastGaps: 0,
      healedCount: 0,
      status: 'healthy',
    };

    try {
      // 1. Revenue gaps (only for locations with Toast)
      if (loc.toast_guid) {
        const closedDays = await getClosedDays(sb, loc.id);
        const revGapDates = await findRevenueGaps(sb, loc.id, closedDays);

        if (revGapDates.length > 0) {
          report.revenueGaps = await healRevenueAndLabor(loc.id, revGapDates, dryRun);
        }
      }

      // 2. Labor gaps
      if (loc.toast_guid) {
        const laborGapDates = await findLaborGaps(sb, loc.id);

        // Filter out dates already being healed by revenue backfill
        const alreadyHealing = new Set(report.revenueGaps.map((g) => g.date));
        const laborOnlyGaps = laborGapDates.filter((d) => !alreadyHealing.has(d));

        if (laborOnlyGaps.length > 0) {
          report.laborGaps = await healRevenueAndLabor(loc.id, laborOnlyGaps, dryRun);
        }
      }

      // 3. Weather gaps
      report.weatherGaps = await countWeatherGaps(sb, loc.id);
      if (report.weatherGaps > 0) {
        const healed = await healWeather(loc.id, report.weatherGaps, dryRun);
        if (healed > 0) report.weatherGaps = Math.max(0, report.weatherGaps - healed);
      }

      // 4. Budget gaps (advisory only for applicable locations)
      const skipBudget = LOCATIONS_WITHOUT_BUDGETS.includes(loc.name);
      if (!skipBudget) {
        report.budgetGaps = await countBudgetGaps(sb, loc.id);
      }

      // 5. Forecast gaps (advisory only)
      report.forecastGaps = await countForecastGaps(sb, loc.id);

      // Tally results
      const revHealed = report.revenueGaps.filter((g) => g.healed).length;
      const laborHealed = report.laborGaps.filter((g) => g.healed).length;
      report.healedCount = revHealed + laborHealed;

      const locGaps =
        report.revenueGaps.length +
        report.laborGaps.length +
        report.weatherGaps +
        report.budgetGaps +
        report.forecastGaps;

      const locPersistent =
        report.revenueGaps.filter((g) => !g.healed && g.error).length +
        report.laborGaps.filter((g) => !g.healed && g.error).length;

      totalGaps += locGaps;
      autoHealed += report.healedCount;
      persistentGaps += locPersistent;

      if (locGaps === 0) {
        report.status = 'healthy';
      } else if (report.healedCount > 0 && locPersistent === 0) {
        report.status = 'healing';
      } else {
        report.status = 'gaps_remaining';
      }
    } catch (err: any) {
      console.error(`[data-integrity] Error scanning ${loc.name}:`, err.message);
      report.status = 'gaps_remaining';

      await recordLearning({
        locationId: loc.id,
        category: 'forecast',
        learning: `Data integrity scan error: ${err.message}`,
        source: 'data_integrity_scanner',
        confidence: 0.9,
      });
    }

    reports.push(report);
  }

  return { scannedAt, locations: reports, totalGaps, autoHealed, persistentGaps };
}

// ---------------------------------------------------------------------------
// Quick check (detection only, no healing)
// ---------------------------------------------------------------------------

export interface QuickCheckResult {
  locationId: string;
  locationName: string;
  missingRevenue: boolean;
  missingLabor: boolean;
}

/**
 * Quick check for yesterday's data across all locations.
 * Used by the daily-refresh cron for fast alerting without triggering backfills.
 */
export async function quickCheckYesterday(): Promise<QuickCheckResult[]> {
  const sb = getSupabaseService();
  const yesterday = getYesterdayEST();
  const results: QuickCheckResult[] = [];

  const { data: locations } = await sb
    .from('locations')
    .select('id, name, toast_guid')
    .eq('is_active', true)
    .not('toast_guid', 'is', null);

  if (!locations) return results;

  // Batch-fetch yesterday's data
  const { data: actuals } = await sb
    .from('daily_actuals')
    .select('location_id, revenue')
    .eq('business_date', yesterday)
    .gt('revenue', 0);

  const { data: labor } = await sb
    .from('daily_labor')
    .select('location_id')
    .eq('business_date', yesterday);

  const actualsSet = new Set((actuals || []).map((r) => r.location_id));
  const laborSet = new Set((labor || []).map((r) => r.location_id));

  for (const loc of locations) {
    results.push({
      locationId: loc.id,
      locationName: loc.name,
      missingRevenue: !actualsSet.has(loc.id),
      missingLabor: !laborSet.has(loc.id),
    });
  }

  return results;
}
