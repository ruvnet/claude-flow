import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/server/supabase';
import { getCached, setCache } from '$lib/server/cache';

/**
 * Executive Summary API — portfolio-level KPIs for CEO view.
 * GET /api/v1/executive-summary?period=4&year=2026
 */

// Location-to-city mapping for HELIXO portfolio
const LOCATION_CITY: Record<string, string> = {
  'lowland': 'Charleston',
  'rosemary rose': 'Charleston',
  'le supreme': 'Wilmington',
  'bar rotunda': 'Wilmington',
  'hiroki-san': 'Detroit',
  'kamper': 'Detroit',
  'anthology': 'Detroit',
  'mulherin': 'Philadelphia',
  'hiroki philadelphia': 'Philadelphia',
  'hiroki phila': 'Philadelphia',
  'quoin': 'Wilmington',
  'little wing': 'Baltimore',
  'vessel': 'Baltimore',
  'simmer down': 'Wilmington',
};

function inferCity(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, city] of Object.entries(LOCATION_CITY)) {
    if (lower.includes(key)) return city;
  }
  // Timezone fallback
  return 'Other';
}

function getPeriodDates(period: number, year: number): { start: string; end: string } {
  const fyStart = new Date(year - 1, 11, 29); // Dec 29 of prior year
  const pStart = new Date(fyStart);
  pStart.setDate(pStart.getDate() + (period - 1) * 28);
  const pEnd = new Date(pStart);
  pEnd.setDate(pEnd.getDate() + 27);
  return {
    start: pStart.toISOString().split('T')[0],
    end: pEnd.toISOString().split('T')[0],
  };
}

function getMondayOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(now);
  monday.setDate(monday.getDate() - diff);
  return monday.toISOString().split('T')[0];
}

function getToday(): string {
  return new Date().toISOString().split('T')[0];
}

interface LocationSummary {
  id: string;
  name: string;
  city: string;
  type: string;
  laborBudgetPct: number;
  wtdRevenue: number;
  wtdBudgetRevenue: number;
  wtdVarPct: number;
  ptdRevenue: number;
  ptdBudgetRevenue: number;
  ytdRevenue: number;
  ytdPYRevenue: number;
  wtdLaborDollars: number;
  wtdLaborPct: number;
  targetLaborPct: number;
  forecastAccuracyScore: number | null;
  status: 'up' | 'down' | 'flat';
}

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const period = parseInt(url.searchParams.get('period') || '0');
  const year = parseInt(url.searchParams.get('year') || '2026');

  // Check cache (5 minute TTL)
  const cacheKey = `exec:${period}:${year}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return json(cached);

  // Get all active locations
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('id, name, type, city, timezone, labor_budget_pct, is_active')
    .eq('is_active', true)
    .order('name');

  if (locErr || !locations || locations.length === 0) {
    return json({ error: locErr?.message || 'No active locations' }, { status: 500 });
  }

  const locationIds = locations.map((l: any) => l.id);
  const today = getToday();
  const mondayWTD = getMondayOfCurrentWeek();

  // Period date range
  let periodStart = '';
  let periodEnd = '';
  if (period > 0) {
    const pd = getPeriodDates(period, year);
    periodStart = pd.start;
    periodEnd = pd.end;
  }

  // YTD: from fiscal year start (Dec 29 of prior year) to today
  const fyStart = new Date(year - 1, 11, 29).toISOString().split('T')[0];

  // Fetch all data in parallel across all locations
  const [
    { data: wtdActuals },
    { data: wtdBudgets },
    { data: wtdLabor },
    { data: ptdActuals },
    { data: ptdBudgets },
    { data: ytdActuals },
    { data: forecastAccRows },
    { data: pendingSchedules },
    { data: laborTargetsWtd },
  ] = await Promise.all([
    // WTD actuals
    sb.from('daily_actuals')
      .select('location_id, revenue')
      .in('location_id', locationIds)
      .gte('business_date', mondayWTD)
      .lte('business_date', today),
    // WTD budget
    sb.from('daily_budget')
      .select('location_id, budget_revenue, server_budget, bartender_budget, host_budget, barista_budget, support_budget, training_budget, line_cooks_budget, prep_cooks_budget, pastry_budget, dishwashers_budget')
      .in('location_id', locationIds)
      .gte('business_date', mondayWTD)
      .lte('business_date', today),
    // WTD labor
    sb.from('daily_labor')
      .select('location_id, labor_dollars')
      .in('location_id', locationIds)
      .gte('business_date', mondayWTD)
      .lte('business_date', today),
    // PTD actuals (if period specified)
    period > 0
      ? sb.from('daily_actuals')
          .select('location_id, revenue')
          .in('location_id', locationIds)
          .gte('business_date', periodStart)
          .lte('business_date', today < periodEnd ? today : periodEnd)
      : Promise.resolve({ data: [] }),
    // PTD budget
    period > 0
      ? sb.from('daily_budget')
          .select('location_id, budget_revenue')
          .in('location_id', locationIds)
          .gte('business_date', periodStart)
          .lte('business_date', today < periodEnd ? today : periodEnd)
      : Promise.resolve({ data: [] }),
    // YTD actuals + PY
    sb.from('daily_actuals')
      .select('location_id, revenue, prior_year_revenue')
      .in('location_id', locationIds)
      .gte('business_date', fyStart)
      .lte('business_date', today),
    // Forecast accuracy (last 28 days)
    sb.from('forecast_accuracy')
      .select('location_id, score')
      .in('location_id', locationIds)
      .gte('business_date', new Date(Date.now() - 28 * 86400000).toISOString().split('T')[0])
      .lte('business_date', today),
    // Pending schedules
    sb.from('schedule_submissions')
      .select('location_id, status')
      .in('location_id', locationIds)
      .eq('status', 'pending'),
    // WTD labor targets
    sb.from('daily_labor_targets')
      .select('location_id, projected_labor_dollars')
      .in('location_id', locationIds)
      .gte('business_date', mondayWTD)
      .lte('business_date', today),
  ]);

  // Aggregate helper
  function sumBy(rows: any[] | null, locId: string, field: string): number {
    if (!rows) return 0;
    return rows
      .filter((r: any) => r.location_id === locId)
      .reduce((s: number, r: any) => s + (Number(r[field]) || 0), 0);
  }

  const BUDGET_LABOR_COLS = [
    'server_budget', 'bartender_budget', 'host_budget', 'barista_budget',
    'support_budget', 'training_budget', 'line_cooks_budget', 'prep_cooks_budget',
    'pastry_budget', 'dishwashers_budget',
  ];

  function sumBudgetLabor(rows: any[] | null, locId: string): number {
    if (!rows) return 0;
    return rows
      .filter((r: any) => r.location_id === locId)
      .reduce((s: number, row: any) => {
        return s + BUDGET_LABOR_COLS.reduce((rs: number, col: string) => rs + (Number(row[col]) || 0), 0);
      }, 0);
  }

  function avgScore(rows: any[] | null, locId: string): number | null {
    if (!rows) return null;
    const locRows = rows.filter((r: any) => r.location_id === locId && r.score != null);
    if (locRows.length === 0) return null;
    return locRows.reduce((s: number, r: any) => s + r.score, 0) / locRows.length;
  }

  // Helper: get dates with actual revenue for a location
  function datesWithActuals(rows: any[] | null, locId: string): Set<string> {
    if (!rows) return new Set();
    return new Set(
      rows.filter((r: any) => r.location_id === locId && Number(r.revenue) > 0)
           .map((r: any) => r.business_date)
    );
  }
  // Sum budget only for dates that have actuals (prevents inflated budget vs revenue)
  function sumBudgetForActualDates(budgetRows: any[] | null, locId: string, field: string, actualDates: Set<string>): number {
    if (!budgetRows) return 0;
    return budgetRows
      .filter((r: any) => r.location_id === locId && actualDates.has(r.business_date))
      .reduce((s: number, r: any) => s + (Number(r[field]) || 0), 0);
  }

  // Build per-location summaries
  const leaderboard: LocationSummary[] = locations.map((loc: any) => {
    const wtdActualDates = datesWithActuals(wtdActuals, loc.id);
    const ptdActualDates = datesWithActuals(ptdActuals, loc.id);
    const wtdRev = sumBy(wtdActuals, loc.id, 'revenue');
    const wtdBudRev = sumBudgetForActualDates(wtdBudgets, loc.id, 'budget_revenue', wtdActualDates);
    const wtdLab = sumBy(wtdLabor, loc.id, 'labor_dollars');
    const ptdRev = sumBy(ptdActuals, loc.id, 'revenue');
    const ptdBudRev = sumBudgetForActualDates(ptdBudgets, loc.id, 'budget_revenue', ptdActualDates);
    const ytdRev = sumBy(ytdActuals, loc.id, 'revenue');
    const ytdPY = sumBy(ytdActuals, loc.id, 'prior_year_revenue');
    const wtdVarPct = wtdBudRev > 0 ? (wtdRev - wtdBudRev) / wtdBudRev : 0;
    const wtdLaborPct = wtdRev > 0 ? wtdLab / wtdRev : 0;
    const accScore = avgScore(forecastAccRows, loc.id);

    let status: 'up' | 'down' | 'flat' = 'flat';
    if (wtdVarPct > 0.02) status = 'up';
    else if (wtdVarPct < -0.02) status = 'down';

    return {
      id: loc.id,
      name: loc.name,
      city: loc.city || inferCity(loc.name),
      type: loc.type || 'restaurant',
      laborBudgetPct: loc.labor_budget_pct || 0.30,
      wtdRevenue: wtdRev,
      wtdBudgetRevenue: wtdBudRev,
      wtdVarPct,
      ptdRevenue: ptdRev,
      ptdBudgetRevenue: ptdBudRev,
      ytdRevenue: ytdRev,
      ytdPYRevenue: ytdPY,
      wtdLaborDollars: wtdLab,
      wtdLaborPct,
      targetLaborPct: loc.labor_budget_pct || 0.30,
      forecastAccuracyScore: accScore,
      status,
    };
  });

  // Sort by WTD revenue descending
  leaderboard.sort((a, b) => b.wtdRevenue - a.wtdRevenue);

  // Portfolio totals
  const totalWTDRevenue = leaderboard.reduce((s, l) => s + l.wtdRevenue, 0);
  const totalWTDBudget = leaderboard.reduce((s, l) => s + l.wtdBudgetRevenue, 0);
  const totalPTDRevenue = leaderboard.reduce((s, l) => s + l.ptdRevenue, 0);
  const totalPTDBudget = leaderboard.reduce((s, l) => s + l.ptdBudgetRevenue, 0);
  const totalYTDRevenue = leaderboard.reduce((s, l) => s + l.ytdRevenue, 0);
  const totalYTDPY = leaderboard.reduce((s, l) => s + l.ytdPYRevenue, 0);
  const totalWTDLabor = leaderboard.reduce((s, l) => s + l.wtdLaborDollars, 0);
  const portfolioLaborPct = totalWTDRevenue > 0 ? totalWTDLabor / totalWTDRevenue : 0;
  const avgTargetLaborPct = leaderboard.length > 0
    ? leaderboard.reduce((s, l) => s + l.targetLaborPct, 0) / leaderboard.length
    : 0.30;

  const accScores = leaderboard.filter(l => l.forecastAccuracyScore != null);
  const portfolioForecastAccuracy = accScores.length > 0
    ? accScores.reduce((s, l) => s + (l.forecastAccuracyScore || 0), 0) / accScores.length
    : null;

  // City summaries
  const cityMap = new Map<string, LocationSummary[]>();
  for (const loc of leaderboard) {
    const arr = cityMap.get(loc.city) || [];
    arr.push(loc);
    cityMap.set(loc.city, arr);
  }

  const citySummaries = Array.from(cityMap.entries()).map(([city, locs]) => {
    const totalRev = locs.reduce((s, l) => s + l.wtdRevenue, 0);
    const avgLabor = locs.length > 0
      ? locs.reduce((s, l) => s + l.wtdLaborPct, 0) / locs.length
      : 0;
    const sorted = [...locs].sort((a, b) => b.wtdRevenue - a.wtdRevenue);
    return {
      city,
      locationCount: locs.length,
      totalRevenue: totalRev,
      avgLaborPct: avgLabor,
      bestPerformer: sorted[0]?.name || '-',
      worstPerformer: sorted[sorted.length - 1]?.name || '-',
    };
  }).sort((a, b) => b.totalRevenue - a.totalRevenue);

  // Alerts
  const laborAlerts = leaderboard
    .filter(l => l.wtdLaborPct > l.targetLaborPct + 0.02)
    .map(l => ({
      location: l.name,
      laborPct: l.wtdLaborPct,
      targetPct: l.targetLaborPct,
      overBy: l.wtdLaborPct - l.targetLaborPct,
    }));

  const forecastAlerts = leaderboard
    .filter(l => l.forecastAccuracyScore != null && (l.forecastAccuracyScore || 0) < 70)
    .map(l => ({
      location: l.name,
      score: l.forecastAccuracyScore,
    }));

  const pendingCount = (pendingSchedules || []).length;
  const pendingByLocation = new Map<string, number>();
  for (const ps of pendingSchedules || []) {
    const current = pendingByLocation.get(ps.location_id) || 0;
    pendingByLocation.set(ps.location_id, current + 1);
  }

  const responseData = {
    portfolio: {
      totalWTDRevenue,
      totalWTDBudget,
      wtdVarPct: totalWTDBudget > 0 ? (totalWTDRevenue - totalWTDBudget) / totalWTDBudget : 0,
      totalPTDRevenue,
      totalPTDBudget,
      ptdVarPct: totalPTDBudget > 0 ? (totalPTDRevenue - totalPTDBudget) / totalPTDBudget : 0,
      totalYTDRevenue,
      totalYTDPY,
      ytdVarPct: totalYTDPY > 0 ? (totalYTDRevenue - totalYTDPY) / totalYTDPY : 0,
      portfolioLaborPct,
      avgTargetLaborPct,
      portfolioForecastAccuracy,
      activeLocations: locations.length,
    },
    leaderboard,
    citySummaries,
    alerts: {
      laborOverTarget: laborAlerts,
      lowForecastAccuracy: forecastAlerts,
      pendingSchedules: pendingCount,
      pendingByLocation: Object.fromEntries(pendingByLocation),
    },
    meta: {
      period,
      year,
      wtdStart: mondayWTD,
      today,
      periodStart: periodStart || null,
      periodEnd: periodEnd || null,
      fyStart,
    },
  };
  setCache(cacheKey, responseData, 30); // 30s — Vercel Lambdas don't share memory
  return json(responseData, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } });
};
