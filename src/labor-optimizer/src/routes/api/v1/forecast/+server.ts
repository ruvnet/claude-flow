import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 120 };
import {
  generateForecastSuggestion,
  acceptForecast,
  generatePeriodForecasts,
  getTrailing2WeekAvgCheck,
  invalidateSuggestionCache,
} from '$lib/server/domain/forecasting/ai-forecast';
import { submitWeekForecast } from '$lib/server/domain/forecasting/forecast-accept';
import { getModelStats } from '$lib/server/domain/forecasting/forecast-accuracy';
import { getSupabaseService } from '$lib/server/supabase';
import { canUnlockForecast, isValidRole, getHighestRole, type UserRole } from '$lib/roles';
import { invalidateCache } from '$lib/server/cache';
import { fetchBookingPace, fetchEventCallouts, fetchCompetitiveDemand, fetchWowTrend } from '$lib/server/domain/forecasting/forecast-signals';
import { createNotification } from '$lib/server/notifications';

async function resolveUserRole(email: string): Promise<UserRole> {
  const sb = getSupabaseService();
  const roles: UserRole[] = [];

  const { data: gm } = await sb
    .from('user_group_members')
    .select('role')
    .eq('user_email', email);
  for (const r of gm || []) {
    if (r.role && isValidRole(r.role)) roles.push(r.role as UserRole);
  }

  const { data: lu } = await sb
    .from('location_users')
    .select('role')
    .eq('user_email', email);
  for (const r of lu || []) {
    if (r.role && isValidRole(r.role)) roles.push(r.role as UserRole);
  }

  return getHighestRole(roles);
}

export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  const date = url.searchParams.get('date');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  if (!locationId) return json({ error: 'locationId required' }, { status: 400 });

  // Support period+year shorthand → convert to startDate+endDate
  const period = url.searchParams.get('period');
  const year = url.searchParams.get('year');
  let resolvedStart = startDate;
  let resolvedEnd = endDate;
  if (!resolvedStart && period && year) {
    const p = parseInt(period);
    const y = parseInt(year);
    const fyStart = new Date(y - 1, 11, 29); // Dec 29 of prior year
    const pStart = new Date(fyStart);
    pStart.setDate(pStart.getDate() + (p - 1) * 28);
    const pEnd = new Date(pStart);
    pEnd.setDate(pEnd.getDate() + 27);
    resolvedStart = pStart.toISOString().split('T')[0];
    resolvedEnd = pEnd.toISOString().split('T')[0];
  }

  if (resolvedStart && resolvedEnd) {
    const suggestions = await generatePeriodForecasts(locationId, resolvedStart, resolvedEnd);

    // Enrich with locked status + accepted values
    const sb = getSupabaseService();
    const { data: lockData } = await sb
      .from('daily_forecasts')
      .select('business_date, locked, locked_at, locked_by, override_tags, is_override, ai_suggested_revenue, ai_suggested_covers, manager_revenue, manager_covers, accepted_at, accepted_by')
      .eq('location_id', locationId)
      .gte('business_date', resolvedStart)
      .lte('business_date', resolvedEnd);

    const lockMap = new Map<string, { locked: boolean; locked_at: string | null; locked_by: string | null; override_tags: string[] | null; is_override: boolean; acceptedRevenue: number | null; acceptedCovers: number | null; accepted: boolean; acceptedAt: string | null; acceptedByUser: string | null }>();
    for (const row of lockData || []) {
      // manager_revenue is the accepted value; forecast_revenue is the AI suggestion stored at accept time
      const mgrRev = row.manager_revenue ?? row.ai_suggested_revenue ?? null;
      lockMap.set(row.business_date, {
        locked: row.locked ?? false,
        locked_at: row.locked_at,
        locked_by: row.locked_by,
        override_tags: row.override_tags ?? null,
        is_override: row.is_override ?? false,
        acceptedRevenue: mgrRev,
        acceptedCovers: row.manager_covers ?? row.ai_suggested_covers ?? null,
        accepted: row.manager_revenue != null,
        acceptedAt: row.accepted_at ?? null,
        acceptedByUser: row.accepted_by ?? null,
      });
    }

    // Fetch actual revenue for the period
    const { data: actualData } = await sb
      .from('daily_actuals')
      .select('business_date, revenue, prior_year_revenue')
      .eq('location_id', locationId)
      .gte('business_date', resolvedStart)
      .lte('business_date', resolvedEnd);

    const actualMap = new Map<string, { revenue: number | null; pyRevenue: number | null }>();
    for (const row of actualData || []) {
      actualMap.set(row.business_date, {
        revenue: row.revenue ?? null,
        pyRevenue: row.prior_year_revenue ?? null,
      });
    }

    // Fetch budget revenue for the period
    const { data: budgetData } = await sb
      .from('daily_budget')
      .select('business_date, budget_revenue')
      .eq('location_id', locationId)
      .gte('business_date', resolvedStart)
      .lte('business_date', resolvedEnd);

    const budgetMap = new Map<string, number>();
    for (const row of budgetData || []) {
      budgetMap.set(row.business_date, row.budget_revenue ?? 0);
    }

    // Fetch SDLY (Same Day Last Year) — 364 days back for same DOW position
    const pyStart = new Date(resolvedStart + 'T12:00:00');
    pyStart.setDate(pyStart.getDate() - 364);
    const pyEnd = new Date(resolvedEnd + 'T12:00:00');
    pyEnd.setDate(pyEnd.getDate() - 364);
    const { data: pyData } = await sb
      .from('daily_actuals')
      .select('business_date, revenue')
      .eq('location_id', locationId)
      .gte('business_date', pyStart.toISOString().split('T')[0])
      .lte('business_date', pyEnd.toISOString().split('T')[0])
      .gt('revenue', 0);

    const pyMap = new Map<string, number>();
    for (const row of pyData || []) {
      // Map PY date to current date (add 364 days)
      const pyDate = new Date(row.business_date + 'T12:00:00');
      pyDate.setDate(pyDate.getDate() + 364);
      const currentDateStr = pyDate.toISOString().split('T')[0];
      pyMap.set(currentDateStr, row.revenue);
    }

    // Fetch weather data for the period
    const { data: weatherData } = await sb
      .from('daily_weather')
      .select('business_date, temp_high, icon, condition')
      .eq('location_id', locationId)
      .gte('business_date', resolvedStart)
      .lte('business_date', resolvedEnd);

    const weatherMap = new Map<string, { tempHigh: number | null; icon: string | null; condition: string | null }>();
    for (const row of weatherData || []) {
      weatherMap.set(row.business_date, {
        tempHigh: row.temp_high ?? null,
        icon: row.icon ?? null,
        condition: row.condition ?? null,
      });
    }

    // Fetch last 8 same-DOW revenues per day for historical sparkline + percentile ranges
    const allDows = [...new Set(suggestions.map((s: any) => new Date(s.date + 'T12:00:00').getDay()))];
    const histStart = new Date(resolvedStart + 'T12:00:00');
    histStart.setDate(histStart.getDate() - 60); // 8+ weeks back
    const { data: histDowData } = await sb
      .from('daily_actuals')
      .select('business_date, revenue')
      .eq('location_id', locationId)
      .gte('business_date', histStart.toISOString().split('T')[0])
      .lt('business_date', resolvedStart)
      .gt('revenue', 0)
      .order('business_date', { ascending: false });

    // Group by DOW
    const dowHistMap = new Map<number, number[]>();
    for (const r of histDowData || []) {
      const dow = new Date(r.business_date + 'T12:00:00').getDay();
      if (!dowHistMap.has(dow)) dowHistMap.set(dow, []);
      dowHistMap.get(dow)!.push(r.revenue);
    }

    // Enhancement 6-10: parallel data signal queries (resilient — failures don't block)
    const [bpResult, evResult, cdResult, wowResult] = await Promise.allSettled([
      fetchBookingPace(locationId, resolvedStart, resolvedEnd),
      fetchEventCallouts(locationId, resolvedStart, resolvedEnd),
      fetchCompetitiveDemand(locationId, resolvedStart, resolvedEnd),
      fetchWowTrend(locationId, resolvedStart),
    ]);
    const bookingPaceMap = bpResult.status === 'fulfilled' ? bpResult.value : new Map();
    const eventsMap = evResult.status === 'fulfilled' ? evResult.value : new Map();
    const competitiveMap = cdResult.status === 'fulfilled' ? cdResult.value : null;
    const wowTrendMap = wowResult.status === 'fulfilled' ? wowResult.value : new Map();
    // Fetch manager override accuracy from forecast_accuracy
    const accCutoff = new Date();
    accCutoff.setDate(accCutoff.getDate() - 56); // 8 weeks
    const { data: accRows } = await sb
      .from('forecast_accuracy')
      .select('day_of_week, abs_error_pct, error_pct')
      .eq('location_id', locationId)
      .gte('business_date', accCutoff.toISOString().split('T')[0])
      .not('abs_error_pct', 'is', null);

    // Compute per-DOW manager MAPE
    const dowAccMap = new Map<number, { totalAbs: number; count: number }>();
    for (const r of accRows || []) {
      const entry = dowAccMap.get(r.day_of_week) || { totalAbs: 0, count: 0 };
      entry.totalAbs += Number(r.abs_error_pct);
      entry.count++;
      dowAccMap.set(r.day_of_week, entry);
    }

    const enriched = suggestions.map((s: any) => {
      const lock = lockMap.get(s.date);
      const isLocked = lock?.locked ?? false;
      const isAccepted = lock?.accepted ?? false;
      const displayRevenue = ((isLocked || isAccepted) && lock?.acceptedRevenue) ? lock.acceptedRevenue : s.suggestedRevenue;
      const avgCheck = s.avgCheck || 70;
      const displayCovers = avgCheck > 0 ? Math.round(displayRevenue / avgCheck) : s.suggestedCovers;
      const dow = new Date(s.date + 'T12:00:00').getDay();

      // Historical same-DOW revenues (last 8)
      const historicalSameDow = (dowHistMap.get(dow) || []).slice(0, 8);

      // Percentile-based risk range
      const sorted = [...historicalSameDow].sort((a, b) => a - b);
      const p10 = sorted.length >= 3 ? sorted[Math.floor(sorted.length * 0.1)] : Math.round(s.suggestedRevenue * 0.85);
      const p90 = sorted.length >= 3 ? sorted[Math.ceil(sorted.length * 0.9) - 1] : Math.round(s.suggestedRevenue * 1.15);

      // Confidence factors
      const confidenceFactors = [
        { signal: 'Trailing DOW Data', available: (s.components?.trailingDowAvg ?? 0) > 0, impact: 0.2 },
        { signal: 'Prior Year', available: (s.components?.pyAdjusted ?? 0) > 0, impact: 0.15 },
        { signal: 'Momentum', available: (s.components?.momentumRevenue ?? 0) > 0, impact: 0.1 },
        { signal: 'Budget', available: (s.components?.budgetRevenue ?? 0) > 0, impact: 0.05 },
        { signal: 'Weather', available: !!weatherMap.get(s.date), impact: 0.05 },
        { signal: 'Reservations (Resy)', available: (s.components?.reservationEstRevenue ?? 0) > 0, impact: 0.1 },
        { signal: 'Cross-Location', available: (s.components?.crossLocationRevenue ?? 0) > 0, impact: 0.05 },
      ];

      // Manager accuracy for this DOW
      const dowAcc = dowAccMap.get(dow);
      const mgrMape = dowAcc && dowAcc.count >= 2 ? Math.round((dowAcc.totalAbs / dowAcc.count) * 100) / 100 : null;
      const mgrGrade = mgrMape === null ? null : mgrMape <= 5 ? 'A' : mgrMape <= 8 ? 'B' : mgrMape <= 12 ? 'C' : 'D';

      return {
        ...s,
        suggestedRevenue: displayRevenue,
        suggestedCovers: displayCovers,
        managerRevenue: ((isLocked || isAccepted) && lock?.is_override && lock?.acceptedRevenue) ? lock.acceptedRevenue : (isAccepted && lock?.acceptedRevenue ? lock.acceptedRevenue : null),
        accepted: isAccepted,
        locked: isLocked,
        lockedAt: lock?.locked_at ?? null,
        lockedBy: lock?.locked_by ?? null,
        acceptedBy: lock?.acceptedByUser ?? null,
        overridden: lock?.is_override ?? false,
        overrideTags: lock?.override_tags ?? [],
        actualRevenue: actualMap.get(s.date)?.revenue ?? null,
        samePeriodPY: pyMap.get(s.date) ?? pyMap.get(s.date?.split('T')[0]) ?? null,
        // T2W: true trailing 2-week same-DOW average from actual actuals (last 2 occurrences of this DOW)
        trailing2wAvg: (() => {
          const hist = (dowHistMap.get(dow) || []).slice(0, 2);
          return hist.length > 0 ? Math.round(hist.reduce((a, b) => a + b, 0) / hist.length) : (s.components?.trailingDowAvg ?? null);
        })(),
        budgetRevenue: budgetMap.get(s.date) ?? s.components?.budgetRevenue ?? null,
        weatherIcon: weatherMap.get(s.date)?.icon ?? null,
        weatherTempHigh: weatherMap.get(s.date)?.tempHigh ?? null,
        weatherCondition: weatherMap.get(s.date)?.condition ?? null,
        historicalSameDow,
        lowScenario: p10,
        highScenario: p90,
        confidenceFactors,
        managerAccuracy: { mape: mgrMape, grade: mgrGrade },
        bookingPace: bookingPaceMap.get(s.date) ?? null,
        events: eventsMap.get(s.date) ?? [],
        competitiveDemand: competitiveMap?.get(s.date) ?? null,
        wowTrend: wowTrendMap.get(dow) ?? null,
      };
    });

    const modelStats = await getModelStats(locationId);

    // Same Week Last Year (364 days back for same DOW alignment)
    const swlyStart = new Date(resolvedStart + 'T12:00:00');
    swlyStart.setDate(swlyStart.getDate() - 364);
    const swlyEnd = new Date(resolvedEnd + 'T12:00:00');
    swlyEnd.setDate(swlyEnd.getDate() - 364);
    const { data: swlyData } = await sb
      .from('daily_actuals')
      .select('business_date, revenue, covers')
      .eq('location_id', locationId)
      .gte('business_date', swlyStart.toISOString().split('T')[0])
      .lte('business_date', swlyEnd.toISOString().split('T')[0])
      .gt('revenue', 0)
      .order('business_date');

    const sameWeekLastYear = (swlyData || []).map((r: any) => ({
      date: r.business_date,
      dayOfWeek: new Date(r.business_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }),
      revenue: r.revenue,
      covers: r.covers ?? 0,
    }));

    // Trailing weeks (single query for 6 weeks, split into trailing2 + trailing6)
    const tStart = new Date(resolvedStart + 'T12:00:00');
    tStart.setDate(tStart.getDate() - 42);
    const tEnd = new Date(resolvedStart + 'T12:00:00');
    tEnd.setDate(tEnd.getDate() - 1);
    const { data: tData } = await sb
      .from('daily_actuals').select('business_date, revenue, covers')
      .eq('location_id', locationId).gte('business_date', tStart.toISOString().split('T')[0])
      .lte('business_date', tEnd.toISOString().split('T')[0]).gt('revenue', 0).order('business_date');

    function buildWeekSlice(weekNum: number, rows: any[]) {
      const ws = new Date(resolvedStart + 'T12:00:00'); ws.setDate(ws.getDate() - weekNum * 7);
      const we = new Date(ws); we.setDate(we.getDate() + 6);
      const wsStr = ws.toISOString().split('T')[0], weStr = we.toISOString().split('T')[0];
      const days = rows.filter((r: any) => r.business_date >= wsStr && r.business_date <= weStr)
        .map((r: any) => ({ date: r.business_date, dayOfWeek: new Date(r.business_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }), revenue: r.revenue, covers: r.covers ?? 0 }));
      const total = days.reduce((s: number, d: any) => s + d.revenue, 0);
      return { week: -weekNum, days, total, startDate: wsStr, endDate: weStr, weekTotal: total, totalCovers: days.reduce((s: number, d: any) => s + d.covers, 0), dayCount: days.length };
    }
    const allTrailingRows = tData || [];
    const trailing2Weeks = [1, 2].map(w => buildWeekSlice(w, allTrailingRows));
    const trailing6Weeks = [1, 2, 3, 4, 5, 6].map(w => buildWeekSlice(w, allTrailingRows));

    // Persist AI suggestions to daily_forecasts for accuracy tracking.
    // Only save dates where ai_suggested_revenue is not yet set (preserve originals).
    try {
      const existingAiDates = new Set(
        (lockData || []).filter(r => r.ai_suggested_revenue != null).map(r => r.business_date)
      );
      const aiUpserts = suggestions
        .filter((s: any) => s.suggestedRevenue > 0 && !existingAiDates.has(s.date))
        .map((s: any) => ({
          location_id: locationId,
          business_date: s.date,
          ai_suggested_revenue: Math.round(s.suggestedRevenue),
          ai_suggested_covers: s.suggestedCovers ?? null,
          ai_confidence: s.confidence ?? null,
        }));
      if (aiUpserts.length > 0) {
        await sb.from('daily_forecasts')
          .upsert(aiUpserts, { onConflict: 'location_id,business_date' });
      }
    } catch (_) { /* non-critical — don't fail the forecast load */ }

    const allAccRows = accRows || [];
    const overallMape = allAccRows.length >= 3 ? Math.round((allAccRows.reduce((s, r) => s + Number(r.abs_error_pct), 0) / allAccRows.length) * 100) / 100 : null;
    const overallGrade = overallMape === null ? null : overallMape <= 5 ? 'A' : overallMape <= 8 ? 'B' : overallMape <= 12 ? 'C' : 'D';
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const aiVsManager: string[] = [];
    for (const [dow, acc] of dowAccMap.entries()) {
      if (acc.count >= 2 && acc.totalAbs / acc.count > 10) {
        aiVsManager.push(`${dayNames[dow]} overrides avg ${(acc.totalAbs / acc.count).toFixed(1)}% off`);
      }
    }
    const managerAccuracySummary = { mape: overallMape, grade: overallGrade, records: allAccRows.length, notes: aiVsManager };

    return json({ suggestions: enriched, modelStats, managerAccuracySummary, sameWeekLastYear, trailing2Weeks, trailing6Weeks }, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } });
  }

  if (!date) return json({ error: 'date or startDate+endDate required' }, { status: 400 });

  const suggestion = await generateForecastSuggestion(locationId, date);
  return json(suggestion);
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { action, locationId, date, revenue, isOverride, overrideExplanation, overrideTags, acceptedBy, weekStartDate } = body;

  // Handle "submit_week" action -- locks all 7 days and finalizes labor projections
  if (action === 'submit_week') {
    if (!locationId || !weekStartDate) {
      return json({ error: 'locationId and weekStartDate required for submit_week' }, { status: 400 });
    }
    console.log(`[forecast-api] submit_week: location=${locationId}, weekStart=${weekStartDate}, by=${acceptedBy}`);
    const result = await submitWeekForecast(locationId, weekStartDate, acceptedBy || 'manager');
    if (result.error) {
      return json({ error: result.error }, { status: 400 });
    }

    // Notify admins/directors that a forecast was submitted
    try {
      const sbNotif = getSupabaseService();
      const { data: admins } = await sbNotif
        .from('location_users')
        .select('user_email')
        .eq('location_id', locationId)
        .or('role.eq.super_admin,role.eq.admin,role.eq.director');
      const { data: groupAdmins } = await sbNotif
        .from('user_group_members')
        .select('user_email')
        .or('role.eq.super_admin,role.eq.director');
      const allAdmins = [...new Set([
        ...(admins || []).map((u: any) => u.user_email),
        ...(groupAdmins || []).map((u: any) => u.user_email),
      ])].filter(Boolean);
      if (allAdmins.length > 0) {
        await createNotification(allAdmins.map((email: string) => ({
          userEmail: email,
          type: 'forecast_submitted' as const,
          title: `Forecast submitted`,
          body: `Week of ${weekStartDate} by ${acceptedBy || 'manager'}`,
          link: '/dashboard/forecast',
          locationId,
          metadata: { weekStartDate, submittedBy: acceptedBy },
        })));
      }
    } catch (e) {
      console.error('[notifications] forecast_submitted notify error:', e);
    }

    return json({
      submitted: true,
      locked: result.locked,
      weekForecastTotal: result.weekForecastTotal,
      targetsGenerated: result.targetsGenerated,
      bracketUsed: result.bracketUsed,
      acceptedDays: result.acceptedDays,
    });
  }

  if (!locationId || !date || revenue == null) {
    return json({ error: 'locationId, date, revenue required' }, { status: 400 });
  }

  if (isOverride && !overrideExplanation && (!overrideTags || overrideTags.length === 0)) {
    return json({ error: 'overrideTags or overrideExplanation required when isOverride is true' }, { status: 400 });
  }

  // Build explanation from tags for backwards compatibility
  const tags: string[] = overrideTags || [];
  const explanation = overrideExplanation || (tags.length > 0 ? tags.join(', ') : null);

  console.log(`[forecast-api] POST accept: location=${locationId}, date=${date}, revenue=${revenue}, isOverride=${isOverride}, by=${acceptedBy}`);

  // Check if forecast is already locked
  const sb = getSupabaseService();
  const { data: existing } = await sb
    .from('daily_forecasts')
    .select('locked')
    .eq('location_id', locationId)
    .eq('business_date', date)
    .maybeSingle();

  if (existing?.locked) {
    return json({ error: 'Forecast is locked. An admin must unlock it first.' }, { status: 403 });
  }

  const result = await acceptForecast(
    locationId,
    date,
    revenue,
    isOverride || false,
    explanation,
    acceptedBy || 'manager',
  );

  // Invalidate cached suggestion so next load gets fresh data
  invalidateSuggestionCache(locationId, date);

  // Invalidate KPI cache for this location
  invalidateCache('kpi:' + locationId);

  // Store override tags if provided
  if (tags.length > 0) {
    await sb
      .from('daily_forecasts')
      .update({ override_tags: tags })
      .eq('location_id', locationId)
      .eq('business_date', date);
  }

  return json({
    accepted: true,
    locked: result.weekLocked,
    weekLocked: result.weekLocked,
    overrideTags: tags,
    laborTargetsUpdated: (result.targetsGenerated ?? 0) > 0,
    ...result,
  });
};

/** PUT — Unlock a forecast day.
 *  - If the week is NOT fully locked (some days still unlocked), the accepting
 *    user can unlock their own accepted day without admin privileges.
 *  - If the week IS fully locked (all 7 days locked), only Super Admin can unlock.
 */
export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { locationId, date, userEmail } = body;

  if (!locationId || !date || !userEmail) {
    return json({ error: 'locationId, date, and userEmail are required' }, { status: 400 });
  }

  const sb = getSupabaseService();

  // Determine if the whole week is locked by checking all 7 days
  const d = new Date(date + 'T12:00:00');
  const dow = d.getDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekStart = monday.toISOString().split('T')[0];
  const weekEnd = sunday.toISOString().split('T')[0];

  const { data: weekRows } = await sb
    .from('daily_forecasts')
    .select('business_date, locked')
    .eq('location_id', locationId)
    .gte('business_date', weekStart)
    .lte('business_date', weekEnd);

  const lockedCount = (weekRows || []).filter((r) => r.locked).length;
  const weekFullyLocked = lockedCount >= 7;

  if (weekFullyLocked) {
    // Week is fully locked -- require Super Admin
    const unlockRole = await resolveUserRole(userEmail);
    if (!canUnlockForecast(unlockRole)) {
      return json(
        { error: 'Week is fully locked. Only super admins can unlock individual days.' },
        { status: 403 },
      );
    }
  }
  // If NOT fully locked, any authenticated user can unlock their accepted day

  const { error: updateError } = await sb
    .from('daily_forecasts')
    .update({
      locked: false,
      locked_at: null,
      locked_by: null,
      manager_revenue: null,
      manager_covers: null,
      is_override: false,
      override_explanation: null,
      override_tags: null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq('location_id', locationId)
    .eq('business_date', date);

  if (updateError) {
    return json({ error: `Failed to unlock: ${updateError.message}` }, { status: 500 });
  }

  return json({ unlocked: true, date, locationId });
};
