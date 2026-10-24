import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, FOH_POSITIONS, BOH_POSITIONS } from '$lib/server/supabase';

// Map daily_budget column names to dashboard position names
const BUDGET_COL_TO_POSITION: Record<string, string> = {
  server_budget: 'Server',
  bartender_budget: 'Bartender',
  host_budget: 'Host',
  barista_budget: 'Barista',
  support_budget: 'Support',
  training_budget: 'Training',
  line_cooks_budget: 'Line Cooks',
  prep_cooks_budget: 'Prep Cooks',
  pastry_budget: 'Pastry',
  dishwashers_budget: 'Dishwashers',
};

function buildPositionData(dayLabor: any[], dayTargets: any[], budget: any) {
  const allPositions = [...FOH_POSITIONS, ...BOH_POSITIONS];
  return allPositions.map(pos => {
    const laborRows = dayLabor.filter(l => l.mapped_position === pos);
    const actualSum = laborRows.reduce((s: number, l: any) => s + (l.labor_dollars || 0), 0);
    const targetRow = dayTargets.find(t => t.position === pos);
    const budgetCol = Object.entries(BUDGET_COL_TO_POSITION).find(([, p]) => p === pos)?.[0];
    const budgetVal = budget && budgetCol ? (budget[budgetCol] || 0) : 0;
    return {
      position: pos,
      actual: actualSum,
      projected: targetRow?.projected_labor_dollars || 0,
      budget: budgetVal,
    };
  });
}

/** Calculate last day of a given month (1-indexed) */
function lastDayOfMonth(year: number, month: number): string {
  // month is 1-12; Date constructor month is 0-indexed, day 0 = last day of prev month
  const d = new Date(year, month, 0);
  return d.toISOString().split('T')[0];
}

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const locationId = url.searchParams.get('locationId');
  const month = Number(url.searchParams.get('month'));
  const year = Number(url.searchParams.get('year') || new Date().getFullYear());

  if (!locationId) {
    return json({ error: 'locationId required' }, { status: 400 });
  }
  if (!month || month < 1 || month > 12) {
    return json({ error: 'month required (1-12)' }, { status: 400 });
  }

  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = lastDayOfMonth(year, month);

  // Get daily actuals for the month
  const { data: actuals } = await sb
    .from('daily_actuals')
    .select('*')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lte('business_date', endDate)
    .order('business_date');

  // Get daily labor
  const { data: labor } = await sb
    .from('daily_labor')
    .select('business_date, mapped_position, labor_dollars, regular_hours, overtime_hours')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lte('business_date', endDate);

  // Get daily labor targets
  const { data: targets } = await sb
    .from('daily_labor_targets')
    .select('business_date, position, projected_labor_dollars, projected_labor_pct')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lte('business_date', endDate);

  // Get forecasts
  const { data: forecasts } = await sb
    .from('daily_forecasts')
    .select('business_date, manager_revenue, manager_covers, is_override, ai_suggested_revenue')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lte('business_date', endDate);

  // Get daily budgets
  const { data: budgets } = await sb
    .from('daily_budget')
    .select('business_date, budget_revenue, server_budget, bartender_budget, host_budget, barista_budget, support_budget, training_budget, line_cooks_budget, prep_cooks_budget, pastry_budget, dishwashers_budget')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lte('business_date', endDate);

  // Build daily rows
  const days: any[] = [];
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const actual = (actuals || []).find(a => a.business_date === dateStr);
    const forecast = (forecasts || []).find(f => f.business_date === dateStr);
    const dayLabor = (labor || []).filter(l => l.business_date === dateStr);
    const dayTargets = (targets || []).filter(t => t.business_date === dateStr);
    const budget = (budgets || []).find(b => b.business_date === dateStr);

    const fohBudget = budget
      ? (budget.server_budget || 0) + (budget.bartender_budget || 0) + (budget.host_budget || 0)
        + (budget.barista_budget || 0) + (budget.support_budget || 0) + (budget.training_budget || 0)
      : 0;
    const bohBudget = budget
      ? (budget.line_cooks_budget || 0) + (budget.prep_cooks_budget || 0)
        + (budget.pastry_budget || 0) + (budget.dishwashers_budget || 0)
      : 0;

    const fohActual = dayLabor
      .filter(l => FOH_POSITIONS.includes(l.mapped_position as any))
      .reduce((s, l) => s + l.labor_dollars, 0);
    const bohActual = dayLabor
      .filter(l => BOH_POSITIONS.includes(l.mapped_position as any))
      .reduce((s, l) => s + l.labor_dollars, 0);
    const fohProjected = dayTargets
      .filter(t => FOH_POSITIONS.includes(t.position as any))
      .reduce((s, t) => s + t.projected_labor_dollars, 0);
    const bohProjected = dayTargets
      .filter(t => BOH_POSITIONS.includes(t.position as any))
      .reduce((s, t) => s + t.projected_labor_dollars, 0);

    days.push({
      date: dateStr,
      dayOfWeek: d.getDay(),
      dayName: d.toLocaleDateString('en-US', { weekday: 'long' }),
      revenue: actual?.revenue || null,
      budgetRevenue: budget?.budget_revenue || null,
      covers: actual?.covers || null,
      priorYearRevenue: actual?.prior_year_revenue || null,
      priorYearCovers: actual?.prior_year_covers || null,
      forecastRevenue: forecast?.manager_revenue || null,
      forecastCovers: forecast?.manager_covers || null,
      isOverride: forecast?.is_override || false,
      foh: { actual: fohActual, projected: fohProjected, budget: fohBudget, variance: fohActual - fohBudget },
      boh: { actual: bohActual, projected: bohProjected, budget: bohBudget, variance: bohActual - bohBudget },
      totalLabor: {
        actual: fohActual + bohActual,
        projected: fohProjected + bohProjected,
        budget: fohBudget + bohBudget,
        variance: (fohActual + bohActual) - (fohBudget + bohBudget),
      },
      laborByPosition: buildPositionData(dayLabor, dayTargets, budget),
    });
  }

  // Month-to-date totals: only sum days that have actual revenue
  const mtdDays = days.filter(d => d.revenue && d.revenue > 0);
  const totalRevenue = mtdDays.reduce((s, d) => s + (d.revenue || 0), 0);
  const totalBudgetRevenue = mtdDays.reduce((s, d) => s + (d.budgetRevenue || 0), 0);
  const totalForecast = mtdDays.reduce((s, d) => s + (d.forecastRevenue || 0), 0);
  const totalFohActual = mtdDays.reduce((s, d) => s + d.foh.actual, 0);
  const totalBohActual = mtdDays.reduce((s, d) => s + d.boh.actual, 0);
  const totalFohProjected = mtdDays.reduce((s, d) => s + d.foh.projected, 0);
  const totalBohProjected = mtdDays.reduce((s, d) => s + d.boh.projected, 0);
  const totalFohBudget = mtdDays.reduce((s, d) => s + d.foh.budget, 0);
  const totalBohBudget = mtdDays.reduce((s, d) => s + d.boh.budget, 0);
  const totalLaborBudget = totalFohBudget + totalBohBudget;
  const totalCovers = mtdDays.reduce((s, d) => s + (d.covers || 0), 0);

  // Full month totals: actual if exists, else forecast, else budget for revenue;
  // actual if exists, else budget for labor — across ALL days
  const fullMonthRevenue = days.reduce((s, d) => {
    if (d.revenue && d.revenue > 0) return s + d.revenue;
    if (d.forecastRevenue && d.forecastRevenue > 0) return s + d.forecastRevenue;
    return s + (d.budgetRevenue || 0);
  }, 0);
  const fullMonthBudgetRevenue = days.reduce((s, d) => s + (d.budgetRevenue || 0), 0);
  const fullMonthFohLabor = days.reduce((s, d) => {
    if (d.revenue && d.revenue > 0) return s + d.foh.actual;
    return s + d.foh.budget;
  }, 0);
  const fullMonthBohLabor = days.reduce((s, d) => {
    if (d.revenue && d.revenue > 0) return s + d.boh.actual;
    return s + d.boh.budget;
  }, 0);
  const fullMonthFohBudgetLabor = days.reduce((s, d) => s + d.foh.budget, 0);
  const fullMonthBohBudgetLabor = days.reduce((s, d) => s + d.boh.budget, 0);

  return json({
    month: {
      number: month,
      year,
      startDate,
      endDate,
    },
    summary: {
      daysWithActuals: mtdDays.length,
      totalRevenue,
      totalBudgetRevenue,
      budgetRevenueVariance: totalRevenue - totalBudgetRevenue,
      totalForecast,
      revenueVariance: totalRevenue - totalForecast,
      totalCovers,
      totalLaborActual: totalFohActual + totalBohActual,
      totalLaborProjected: totalFohProjected + totalBohProjected,
      totalLaborBudget,
      laborVariance: (totalFohActual + totalBohActual) - totalLaborBudget,
      laborPct: totalRevenue > 0 ? (totalFohActual + totalBohActual) / totalRevenue : 0,
      budgetLaborPct: totalBudgetRevenue > 0 ? totalLaborBudget / totalBudgetRevenue : 0,
      foh: { actual: totalFohActual, projected: totalFohProjected, budget: totalFohBudget },
      boh: { actual: totalBohActual, projected: totalBohProjected, budget: totalBohBudget },
    },
    fullMonthTotals: {
      revenue: fullMonthRevenue,
      budgetRevenue: fullMonthBudgetRevenue,
      labor: fullMonthFohLabor + fullMonthBohLabor,
      budgetLabor: fullMonthFohBudgetLabor + fullMonthBohBudgetLabor,
      fohLabor: fullMonthFohLabor,
      bohLabor: fullMonthBohLabor,
      fohBudgetLabor: fullMonthFohBudgetLabor,
      bohBudgetLabor: fullMonthBohBudgetLabor,
    },
    days,
  });
};
