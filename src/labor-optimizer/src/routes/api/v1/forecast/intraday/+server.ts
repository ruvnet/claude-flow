/**
 * Intraday Forecast Intelligence API
 *
 * GET /api/v1/forecast/intraday?locationId=xxx
 *
 * Returns real-time intraday revenue tracking with projection, anomaly detection,
 * and suggested staffing actions based on hourly revenue curves.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import {
  getHourlyCurve,
  predictFinalRevenue,
  detectAnomaly,
  getTodayActualRevenue,
  suggestAction,
  type HourlyCurvePoint,
} from '$lib/server/domain/forecasting/hourly-curves';

export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  if (!locationId) {
    return json({ error: 'locationId required' }, { status: 400 });
  }

  const sb = getSupabaseService();
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentHour = now.getHours();
  const dow = now.getDay();

  // 1. Get today's forecast (the accepted/AI-suggested revenue)
  const { data: forecastRow } = await sb
    .from('daily_forecasts')
    .select('ai_suggested_revenue, manager_revenue, ai_suggested_covers, manager_covers')
    .eq('location_id', locationId)
    .eq('business_date', todayStr)
    .maybeSingle();

  const forecastedRevenue = forecastRow?.manager_revenue
    ?? forecastRow?.ai_suggested_revenue
    ?? 0;
  const forecastedCovers = forecastRow?.manager_covers
    ?? forecastRow?.ai_suggested_covers
    ?? 0;

  // 2. Get today's actual revenue through current hour
  const { totalRevenue: revenueSoFar, hourlyBreakdown } =
    await getTodayActualRevenue(locationId, currentHour);

  // 2b. Get last sync timestamp from today's hourly data
  const { data: lastSyncRow } = await sb
    .from('daily_actuals')
    .select('synced_at')
    .eq('location_id', locationId)
    .eq('business_date', todayStr)
    .maybeSingle();
  const lastSyncedAt: string | null = lastSyncRow?.synced_at ?? null;

  // 3. Get the hourly curve for this DOW
  const curve = await getHourlyCurve(locationId, dow);

  // 4. Project final daily revenue
  const projection = await predictFinalRevenue(locationId, currentHour, revenueSoFar);

  // 5. Detect anomalies
  const anomaly = forecastedRevenue > 0
    ? await detectAnomaly(locationId, currentHour, revenueSoFar, forecastedRevenue)
    : {
        isAnomaly: false,
        direction: 'on_track' as const,
        magnitude: 0,
        message: 'No forecast available for today.',
      };

  // 6. Compute variance to original forecast
  const varianceToForecast = forecastedRevenue > 0
    ? (projection.projectedFinalRevenue - forecastedRevenue) / forecastedRevenue
    : 0;

  // 7. Suggested action
  const action = forecastedRevenue > 0
    ? suggestAction(anomaly, projection.projectedFinalRevenue, forecastedRevenue)
    : 'No forecast set for today — accept a forecast to enable intraday tracking.';

  // 8. Compute expected revenue by hour for chart overlay
  const expectedByHour = curve.map((c: HourlyCurvePoint) => ({
    hour: c.hour,
    expectedRevenue: Math.round(forecastedRevenue * c.pctOfDaily),
    pctOfDaily: c.pctOfDaily,
  }));

  // 9. Compute cumulative expected vs actual for progress tracking
  const cumulativeExpected = curve.reduce((acc, c) => {
    if (c.hour <= currentHour) return acc + forecastedRevenue * c.pctOfDaily;
    return acc;
  }, 0);

  return json({
    locationId,
    date: todayStr,
    currentHour,
    dayOfWeek: dow,

    // Actuals
    revenueSoFar: Math.round(revenueSoFar),
    hourlyBreakdown,

    // Forecast reference
    forecastedRevenue: Math.round(forecastedRevenue),
    forecastedCovers,

    // Projection
    projectedFinalRevenue: projection.projectedFinalRevenue,
    curveCompletionPct: projection.curveCompletionPct,

    // Variance
    varianceToForecast: Math.round(varianceToForecast * 1000) / 10, // e.g., 15.2 (percent)
    varianceDirection: varianceToForecast >= 0 ? 'above' : 'below',

    // Anomaly
    anomaly,

    // Action
    suggestedAction: action,

    // Curve data for charts
    expectedByHour,
    expectedRevenueThroughNow: Math.round(cumulativeExpected),

    // Sync metadata
    lastSyncedAt,
  });
};
