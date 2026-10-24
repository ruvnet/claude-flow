/**
 * Hourly Revenue Curves — intra-day revenue pattern modeling per location per DOW.
 *
 * Queries daily_hourly_sales for the last 8 weeks of the same DOW to build a
 * normalized % distribution (e.g., hour 17 = 8%, hour 19 = 22%).
 * Caches results in hourly_revenue_curves table.
 */

import { getSupabaseService } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HourlyCurvePoint {
  hour: number;
  pctOfDaily: number;
  sampleCount: number;
}

export interface IntradayProjection {
  currentHour: number;
  revenueSoFar: number;
  projectedFinalRevenue: number;
  curveCompletionPct: number;
  remainingCurve: HourlyCurvePoint[];
}

export interface AnomalyResult {
  isAnomaly: boolean;
  direction: 'ahead' | 'behind' | 'on_track';
  magnitude: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOOKBACK_WEEKS = 8;
const ANOMALY_THRESHOLD = 0.15; // 15% deviation triggers anomaly
const CURVE_CACHE_TTL_HOURS = 24;

// In-memory cache to avoid repeated DB reads within a request cycle
const curveCache = new Map<string, { points: HourlyCurvePoint[]; fetchedAt: number }>();

function cacheKey(locationId: string, dow: number): string {
  return `${locationId}:${dow}`;
}

// ---------------------------------------------------------------------------
// Core: Build hourly curve from historical data
// ---------------------------------------------------------------------------

/**
 * Build a normalized hourly revenue curve from the last 8 weeks of the same DOW.
 * Returns 24 entries (hours 0-23) with pctOfDaily summing to ~1.0.
 */
async function buildCurveFromHistory(
  locationId: string,
  dayOfWeek: number,
): Promise<HourlyCurvePoint[]> {
  const sb = getSupabaseService();

  // Compute the 8 most recent dates matching this DOW
  const today = new Date();
  const targetDates: string[] = [];
  const cursor = new Date(today);
  // Walk backwards to find matching DOW dates
  cursor.setDate(cursor.getDate() - 1); // start from yesterday
  while (targetDates.length < LOOKBACK_WEEKS * 1) {
    if (cursor.getDay() === dayOfWeek) {
      targetDates.push(cursor.toISOString().split('T')[0]);
    }
    cursor.setDate(cursor.getDate() - 1);
    // Safety: don't go back more than 120 days
    if (targetDates.length === 0 && today.getTime() - cursor.getTime() > 120 * 86400000) break;
    if (targetDates.length >= LOOKBACK_WEEKS) break;
  }

  if (targetDates.length === 0) {
    return buildFlatCurve();
  }

  // Query all hourly sales for these dates
  const { data: hourlyData, error } = await sb
    .from('daily_hourly_sales')
    .select('business_date, hour_of_day, revenue')
    .eq('location_id', locationId)
    .in('business_date', targetDates)
    .gt('revenue', 0);

  if (error || !hourlyData || hourlyData.length === 0) {
    return buildFlatCurve();
  }

  // Group by date to get daily totals, then compute per-hour percentages
  const dailyTotals = new Map<string, number>();
  for (const row of hourlyData) {
    const current = dailyTotals.get(row.business_date) || 0;
    dailyTotals.set(row.business_date, current + (row.revenue || 0));
  }

  // For each hour, average the pct_of_daily across all sample days
  const hourSums = new Map<number, { totalPct: number; count: number }>();
  for (let h = 0; h < 24; h++) {
    hourSums.set(h, { totalPct: 0, count: 0 });
  }

  for (const row of hourlyData) {
    const dayTotal = dailyTotals.get(row.business_date) || 0;
    if (dayTotal <= 0) continue;
    const pct = (row.revenue || 0) / dayTotal;
    const entry = hourSums.get(row.hour_of_day)!;
    entry.totalPct += pct;
    entry.count += 1;
  }

  const sampleDayCount = dailyTotals.size;
  const curve: HourlyCurvePoint[] = [];
  for (let h = 0; h < 24; h++) {
    const entry = hourSums.get(h)!;
    curve.push({
      hour: h,
      pctOfDaily: entry.count > 0 ? entry.totalPct / sampleDayCount : 0,
      sampleCount: entry.count,
    });
  }

  // Normalize to ensure sum = 1.0
  const totalPct = curve.reduce((s, c) => s + c.pctOfDaily, 0);
  if (totalPct > 0 && Math.abs(totalPct - 1.0) > 0.001) {
    for (const point of curve) {
      point.pctOfDaily = point.pctOfDaily / totalPct;
    }
  }

  return curve;
}

/** Flat curve when no historical data is available (uniform distribution). */
function buildFlatCurve(): HourlyCurvePoint[] {
  // Typical restaurant hours: 10am-11pm gets equal share
  const curve: HourlyCurvePoint[] = [];
  const openHours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  const pctPerHour = 1.0 / openHours.length;
  for (let h = 0; h < 24; h++) {
    curve.push({
      hour: h,
      pctOfDaily: openHours.includes(h) ? pctPerHour : 0,
      sampleCount: 0,
    });
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Cache management: store/retrieve from hourly_revenue_curves table
// ---------------------------------------------------------------------------

async function persistCurve(
  locationId: string,
  dayOfWeek: number,
  curve: HourlyCurvePoint[],
): Promise<void> {
  const sb = getSupabaseService();
  const rows = curve.map((c) => ({
    location_id: locationId,
    day_of_week: dayOfWeek,
    hour: c.hour,
    pct_of_daily: c.pctOfDaily,
    sample_count: c.sampleCount,
    updated_at: new Date().toISOString(),
  }));

  // Upsert — if the table doesn't exist yet, this will fail gracefully
  try {
    await sb.from('hourly_revenue_curves').upsert(rows, {
      onConflict: 'location_id,day_of_week,hour',
    });
  } catch (err) {
    console.warn('[HourlyCurves] Failed to persist curve:', (err as Error).message);
  }
}

async function loadCachedCurve(
  locationId: string,
  dayOfWeek: number,
): Promise<HourlyCurvePoint[] | null> {
  const sb = getSupabaseService();

  try {
    const { data, error } = await sb
      .from('hourly_revenue_curves')
      .select('hour, pct_of_daily, sample_count, updated_at')
      .eq('location_id', locationId)
      .eq('day_of_week', dayOfWeek)
      .order('hour', { ascending: true });

    if (error || !data || data.length === 0) return null;

    // Check staleness
    const newestUpdate = new Date(data[0].updated_at);
    const ageHours = (Date.now() - newestUpdate.getTime()) / (1000 * 60 * 60);
    if (ageHours > CURVE_CACHE_TTL_HOURS) return null;

    return data.map((row) => ({
      hour: row.hour,
      pctOfDaily: Number(row.pct_of_daily),
      sampleCount: row.sample_count,
    }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the hourly revenue distribution curve for a location on a given DOW.
 * Returns cached version if fresh, otherwise rebuilds from historical data.
 */
export async function getHourlyCurve(
  locationId: string,
  dayOfWeek: number,
): Promise<HourlyCurvePoint[]> {
  // Check in-memory cache first
  const key = cacheKey(locationId, dayOfWeek);
  const cached = curveCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CURVE_CACHE_TTL_HOURS * 3600000) {
    return cached.points;
  }

  // Check DB cache
  const dbCached = await loadCachedCurve(locationId, dayOfWeek);
  if (dbCached) {
    curveCache.set(key, { points: dbCached, fetchedAt: Date.now() });
    return dbCached;
  }

  // Build fresh from historical data
  const curve = await buildCurveFromHistory(locationId, dayOfWeek);

  // Persist to DB and memory cache
  await persistCurve(locationId, dayOfWeek, curve);
  curveCache.set(key, { points: curve, fetchedAt: Date.now() });

  return curve;
}

/**
 * Given actuals through currentHour, project the final daily revenue total
 * using the hourly curve.
 *
 * Logic: revenueSoFar / curvePctCompleted = projectedTotal
 * e.g., if curve says hours 0-14 = 30% of daily, and we've done $3000,
 * then projected total = $3000 / 0.30 = $10,000
 */
export async function predictFinalRevenue(
  locationId: string,
  currentHour: number,
  revenueSoFar: number,
): Promise<IntradayProjection> {
  const today = new Date();
  const dow = today.getDay();
  const curve = await getHourlyCurve(locationId, dow);

  // Sum the curve % for hours 0 through currentHour (inclusive)
  const curveCompletionPct = curve
    .filter((c) => c.hour <= currentHour)
    .reduce((s, c) => s + c.pctOfDaily, 0);

  // Remaining curve points
  const remainingCurve = curve.filter((c) => c.hour > currentHour);

  // Avoid division by zero — if we're past all active hours or pct is 0
  let projectedFinalRevenue: number;
  if (curveCompletionPct <= 0.01) {
    // Too early in the day or no curve data for these hours
    projectedFinalRevenue = revenueSoFar;
  } else if (curveCompletionPct >= 0.99) {
    // Day is essentially complete
    projectedFinalRevenue = revenueSoFar;
  } else {
    projectedFinalRevenue = revenueSoFar / curveCompletionPct;
  }

  return {
    currentHour,
    revenueSoFar,
    projectedFinalRevenue: Math.round(projectedFinalRevenue),
    curveCompletionPct: Math.round(curveCompletionPct * 1000) / 1000,
    remainingCurve,
  };
}

/**
 * Detect whether current intraday revenue is anomalous relative to the
 * forecasted daily total.
 *
 * Compares actual revenue so far against what the curve predicts should
 * have been earned by currentHour, given the forecastedTotal.
 */
export async function detectAnomaly(
  locationId: string,
  currentHour: number,
  revenueSoFar: number,
  forecastedTotal: number,
): Promise<AnomalyResult> {
  const today = new Date();
  const dow = today.getDay();
  const curve = await getHourlyCurve(locationId, dow);

  // What the curve says we should have earned by now
  const expectedPctByNow = curve
    .filter((c) => c.hour <= currentHour)
    .reduce((s, c) => s + c.pctOfDaily, 0);

  const expectedRevByNow = forecastedTotal * expectedPctByNow;

  if (expectedRevByNow <= 0) {
    return {
      isAnomaly: false,
      direction: 'on_track',
      magnitude: 0,
      message: 'Too early in the day for meaningful anomaly detection.',
    };
  }

  const variance = (revenueSoFar - expectedRevByNow) / expectedRevByNow;
  const absVariance = Math.abs(variance);
  const isAnomaly = absVariance >= ANOMALY_THRESHOLD;

  let direction: 'ahead' | 'behind' | 'on_track';
  if (variance >= ANOMALY_THRESHOLD) {
    direction = 'ahead';
  } else if (variance <= -ANOMALY_THRESHOLD) {
    direction = 'behind';
  } else {
    direction = 'on_track';
  }

  const pctStr = `${Math.round(absVariance * 100)}%`;
  let message: string;
  if (direction === 'ahead') {
    message = `Tracking ${pctStr} above forecast through hour ${currentHour}. Consider adding staff for upcoming service.`;
  } else if (direction === 'behind') {
    message = `Tracking ${pctStr} below forecast through hour ${currentHour}. Consider adjusting staffing down.`;
  } else {
    message = `On track with forecast through hour ${currentHour}.`;
  }

  return {
    isAnomaly,
    direction,
    magnitude: Math.round(variance * 1000) / 1000,
    message,
  };
}

/**
 * Get today's actual hourly revenue from daily_hourly_sales.
 * Returns total revenue accumulated through the given hour.
 */
export async function getTodayActualRevenue(
  locationId: string,
  throughHour?: number,
): Promise<{ totalRevenue: number; hourlyBreakdown: { hour: number; revenue: number }[] }> {
  const sb = getSupabaseService();
  const todayStr = new Date().toISOString().split('T')[0];

  let query = sb
    .from('daily_hourly_sales')
    .select('hour_of_day, revenue')
    .eq('location_id', locationId)
    .eq('business_date', todayStr)
    .order('hour_of_day', { ascending: true });

  if (throughHour !== undefined) {
    query = query.lte('hour_of_day', throughHour);
  }

  const { data, error } = await query;

  if (error || !data) {
    return { totalRevenue: 0, hourlyBreakdown: [] };
  }

  const hourlyBreakdown = data.map((row) => ({
    hour: row.hour_of_day,
    revenue: row.revenue || 0,
  }));

  const totalRevenue = hourlyBreakdown.reduce((s, h) => s + h.revenue, 0);

  return { totalRevenue, hourlyBreakdown };
}

/**
 * Suggest a staffing action based on anomaly detection.
 */
export function suggestAction(
  anomaly: AnomalyResult,
  projectedRevenue: number,
  forecastedRevenue: number,
): string {
  const revDiff = projectedRevenue - forecastedRevenue;
  const absDiff = Math.abs(revDiff);
  const fmtDiff = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(absDiff);

  if (!anomaly.isAnomaly) {
    return 'No action needed — revenue is tracking in line with forecast.';
  }

  if (anomaly.direction === 'ahead') {
    const pct = Math.round(anomaly.magnitude * 100);
    if (pct >= 25) {
      return `Consider adding 2+ servers for dinner — tracking ${pct}% above forecast (+${fmtDiff} projected).`;
    }
    return `Consider adding 1 server for dinner — tracking ${pct}% above forecast (+${fmtDiff} projected).`;
  }

  // behind
  const pct = Math.round(Math.abs(anomaly.magnitude) * 100);
  if (pct >= 25) {
    return `Consider cutting 1-2 servers — tracking ${pct}% below forecast (-${fmtDiff} projected). Review reservations.`;
  }
  return `Monitor closely — tracking ${pct}% below forecast (-${fmtDiff} projected).`;
}
