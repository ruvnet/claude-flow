import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { FOH_POSITIONS, BOH_POSITIONS } from '$lib/server/supabase';
import { getCached, setCache } from '$lib/server/cache';

interface LocationComparison {
  rank: number;
  locationId: string;
  locationName: string;
  city: string;
  revenue: { actual: number; budget: number; varPct: number };
  covers: { actual: number; budget: number };
  avgCheck: number;
  fohLaborPct: { actual: number; target: number };
  bohLaborPct: { actual: number; target: number };
  totalLaborPct: { actual: number; target: number; varPct: number };
  forecastAccuracy: number;
  trendDirection: 'up' | 'down' | 'flat';
}

function periodDates(period: number, year: number): { start: string; end: string } {
  const fyStart = new Date(year - 1, 11, 29);
  const pStart = new Date(fyStart);
  pStart.setDate(pStart.getDate() + (period - 1) * 28);
  const pEnd = new Date(pStart);
  pEnd.setDate(pEnd.getDate() + 27);
  return {
    start: pStart.toISOString().split('T')[0],
    end: pEnd.toISOString().split('T')[0],
  };
}

function weekDates(periodStart: string, week: number): { start: string; end: string } {
  const s = new Date(periodStart + 'T12:00:00');
  s.setDate(s.getDate() + (week - 1) * 7);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return {
    start: s.toISOString().split('T')[0],
    end: e.toISOString().split('T')[0],
  };
}

export const GET: RequestHandler = async ({ url }) => {
  const period = parseInt(url.searchParams.get('period') || '4');
  const week = parseInt(url.searchParams.get('week') || '0'); // 0 = full period
  const year = parseInt(url.searchParams.get('year') || '2026');

  // Check cache (5 minute TTL)
  const cacheKey = `comparison:${period}:${week}:${year}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return json(cached);

  const sb = getSupabaseService();

  // Get all active locations
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('id, name, city, labor_budget_pct')
    .eq('is_active', true)
    .order('name');

  if (locErr || !locations || locations.length === 0) {
    return json({ error: 'No active locations found' }, { status: 404 });
  }

  // Determine date range
  const { start: periodStart, end: periodEnd } = periodDates(period, year);
  let startDate = periodStart;
  let endDate = periodEnd;

  if (week >= 1 && week <= 4) {
    const wd = weekDates(periodStart, week);
    startDate = wd.start;
    endDate = wd.end;
  }

  // Determine prior week dates for trend
  const priorStart = new Date(startDate + 'T12:00:00');
  const priorEnd = new Date(endDate + 'T12:00:00');
  const rangeDays = Math.round((priorEnd.getTime() - priorStart.getTime()) / 86400000) + 1;
  priorStart.setDate(priorStart.getDate() - rangeDays);
  priorEnd.setDate(priorEnd.getDate() - rangeDays);
  const priorStartStr = priorStart.toISOString().split('T')[0];
  const priorEndStr = priorEnd.toISOString().split('T')[0];

  const locationIds = locations.map((l: any) => l.id);

  // Fetch all data in parallel across all locations
  const [
    { data: actuals },
    { data: budgets },
    { data: labor },
    { data: laborTargets },
    { data: forecasts },
    { data: priorActuals },
  ] = await Promise.all([
    sb.from('daily_actuals')
      .select('location_id, business_date, revenue, covers')
      .in('location_id', locationIds)
      .gte('business_date', startDate)
      .lte('business_date', endDate),
    sb.from('daily_budget')
      .select('location_id, budget_revenue')
      .in('location_id', locationIds)
      .gte('business_date', startDate)
      .lte('business_date', endDate),
    sb.from('daily_labor')
      .select('location_id, mapped_position, labor_dollars')
      .in('location_id', locationIds)
      .gte('business_date', startDate)
      .lte('business_date', endDate),
    sb.from('daily_labor_targets')
      .select('location_id, position, projected_labor_dollars')
      .in('location_id', locationIds)
      .gte('business_date', startDate)
      .lte('business_date', endDate),
    sb.from('daily_forecasts')
      .select('location_id, manager_revenue, ai_suggested_revenue, business_date')
      .in('location_id', locationIds)
      .gte('business_date', startDate)
      .lte('business_date', endDate),
    sb.from('daily_actuals')
      .select('location_id, revenue')
      .in('location_id', locationIds)
      .gte('business_date', priorStartStr)
      .lte('business_date', priorEndStr),
  ]);

  // Aggregate by location
  const agg: Record<string, {
    rev: number; budRev: number; covers: number; budCovers: number;
    fohLabor: number; bohLabor: number; totalLabor: number;
    fohTarget: number; bohTarget: number; totalTarget: number;
    fcDays: number; fcErrorSum: number;
    priorRev: number;
  }> = {};

  for (const id of locationIds) {
    agg[id] = {
      rev: 0, budRev: 0, covers: 0, budCovers: 0,
      fohLabor: 0, bohLabor: 0, totalLabor: 0,
      fohTarget: 0, bohTarget: 0, totalTarget: 0,
      fcDays: 0, fcErrorSum: 0, priorRev: 0,
    };
  }

  for (const r of actuals || []) {
    const a = agg[r.location_id];
    if (!a) continue;
    a.rev += r.revenue || 0;
    a.covers += r.covers || 0;
  }

  for (const r of budgets || []) {
    const a = agg[r.location_id];
    if (!a) continue;
    a.budRev += r.budget_revenue || 0;
  }

  for (const r of labor || []) {
    const a = agg[r.location_id];
    if (!a) continue;
    const pos = r.mapped_position as string;
    const dollars = r.labor_dollars || 0;
    a.totalLabor += dollars;
    if ((FOH_POSITIONS as string[]).includes(pos)) a.fohLabor += dollars;
    if ((BOH_POSITIONS as string[]).includes(pos)) a.bohLabor += dollars;
  }

  for (const r of laborTargets || []) {
    const a = agg[r.location_id];
    if (!a) continue;
    const pos = r.position as string;
    const dollars = r.projected_labor_dollars || 0;
    a.totalTarget += dollars;
    if ((FOH_POSITIONS as string[]).includes(pos)) a.fohTarget += dollars;
    if ((BOH_POSITIONS as string[]).includes(pos)) a.bohTarget += dollars;
  }

  // Build per-date actual map for forecast accuracy (reuse actuals which now includes business_date)
  const actualDateMap: Record<string, number> = {};
  for (const r of actuals || []) {
    if (r.revenue && r.revenue > 0) {
      actualDateMap[`${r.location_id}|${r.business_date}`] = r.revenue;
    }
  }

  for (const r of forecasts || []) {
    const forecastRev = r.manager_revenue || r.ai_suggested_revenue || 0;
    const actualRev = actualDateMap[`${r.location_id}|${r.business_date}`];
    if (forecastRev > 0 && actualRev && actualRev > 0) {
      const a = agg[r.location_id];
      if (!a) continue;
      a.fcDays += 1;
      a.fcErrorSum += Math.abs(forecastRev - actualRev) / actualRev;
    }
  }

  for (const r of priorActuals || []) {
    const a = agg[r.location_id];
    if (!a) continue;
    a.priorRev += r.revenue || 0;
  }

  // Build comparison rows
  const locMap = new Map(locations.map((l: any) => [l.id, l]));
  const rows: LocationComparison[] = [];

  for (const id of locationIds) {
    const loc = locMap.get(id);
    if (!loc) continue;
    const a = agg[id];
    const targetPct = loc.labor_budget_pct || 0.30;

    const revVarPct = a.budRev > 0 ? (a.rev - a.budRev) / a.budRev : 0;
    const fohPct = a.rev > 0 ? a.fohLabor / a.rev : 0;
    const bohPct = a.rev > 0 ? a.bohLabor / a.rev : 0;
    const totalPct = a.rev > 0 ? a.totalLabor / a.rev : 0;
    const fohTargetPct = a.rev > 0 ? a.fohTarget / a.rev : 0;
    const bohTargetPct = a.rev > 0 ? a.bohTarget / a.rev : 0;
    const totalTargetPct = a.rev > 0 ? a.totalTarget / a.rev : targetPct;
    const laborVarPct = totalPct - totalTargetPct;

    const mape = a.fcDays > 0 ? a.fcErrorSum / a.fcDays : 0;
    const accuracyScore = Math.max(0, Math.round((1 - mape) * 100));

    let trend: 'up' | 'down' | 'flat' = 'flat';
    if (a.priorRev > 0) {
      const change = (a.rev - a.priorRev) / a.priorRev;
      if (change > 0.02) trend = 'up';
      else if (change < -0.02) trend = 'down';
    }

    rows.push({
      rank: 0,
      locationId: id,
      locationName: loc.name,
      city: loc.city || '',
      revenue: { actual: a.rev, budget: a.budRev, varPct: revVarPct },
      covers: { actual: a.covers, budget: a.budCovers },
      avgCheck: a.covers > 0 ? a.rev / a.covers : 0,
      fohLaborPct: { actual: fohPct, target: fohTargetPct },
      bohLaborPct: { actual: bohPct, target: bohTargetPct },
      totalLaborPct: { actual: totalPct, target: totalTargetPct, varPct: laborVarPct },
      forecastAccuracy: accuracyScore,
      trendDirection: trend,
    });
  }

  // Sort by revenue descending and assign rank
  rows.sort((a, b) => b.revenue.actual - a.revenue.actual);
  rows.forEach((r, i) => (r.rank = i + 1));

  // Build city clusters
  const cityMap = new Map<string, typeof rows>();
  for (const r of rows) {
    const city = r.city || 'Unknown';
    if (!cityMap.has(city)) cityMap.set(city, []);
    cityMap.get(city)!.push(r);
  }

  const cityClusters = Array.from(cityMap.entries()).map(([city, locs]) => ({
    city,
    locationCount: locs.length,
    totalRevenue: locs.reduce((s, l) => s + l.revenue.actual, 0),
    totalBudget: locs.reduce((s, l) => s + l.revenue.budget, 0),
    avgLaborPct: locs.reduce((s, l) => s + l.totalLaborPct.actual, 0) / locs.length,
    avgForecastAccuracy: locs.reduce((s, l) => s + l.forecastAccuracy, 0) / locs.length,
    locations: locs.map((l) => l.locationName),
  })).sort((a, b) => b.totalRevenue - a.totalRevenue);

  const responseData = {
    period,
    week: week || 'full',
    year,
    startDate,
    endDate,
    locations: rows,
    cityClusters,
  };
  setCache(cacheKey, responseData, 30); // 30s — Vercel Lambdas don't share memory
  return json(responseData, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } });
};
