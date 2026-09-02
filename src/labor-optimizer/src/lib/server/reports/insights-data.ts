/**
 * Shared data-fetching logic for insights PDF and direct data assembly.
 * Extracted to keep insights-pdf.ts under the 500-line limit.
 */

export interface WtdMetrics {
  wtdRevenue: number;
  wtdBudgetRevenue: number;
  wtdForecastRevenue: number;
  wtdLaborActual: number;
  wtdLaborBudget: number;
  wtdLaborPct: number;
  wtdBudgetLaborPct: number;
}

export interface InsightsData {
  date: string;
  locationName: string;
  sections: {
    revenueSummary: string;
    coversSummary: string;
    compsAndDiscounts: string;
    salesMix: string;
    pmixMovers: string;
    laborVariance: string;
    laborSavings: string;
    hourlyEfficiency: string;
  };
  metrics: {
    revenue: number;
    budgetRevenue: number;
    forecastRevenue: number;
    covers: number;
    avgCheck: number;
    totalLaborActual: number;
    totalLaborProjected: number;
    laborPctOfRevenue: number;
    targetLaborPct: number;
    revVsBudgetDollars: number;
    revVsBudgetPct: number;
    revVsForecastDollars: number;
    revVsForecastPct: number;
    flaggedPositions: Array<{
      position: string;
      actual: number;
      projected: number;
      varianceDollars: number;
      variancePct: number;
    }>;
    salesMixData: Array<{
      category: string;
      revenue: number;
      pct_of_total: number;
    }>;
    pmixData: Array<{
      item_name: string;
      quantity: number;
      revenue: number;
    }>;
    weather: {
      condition: string;
      description: string;
      tempHigh: number | null;
    } | null;
  };
  wtd?: WtdMetrics;
}

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

export function formatDatePretty(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Compute Monday of the week containing the given date string (YYYY-MM-DD). */
export function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

const BUDGET_LABOR_COLS = [
  'server_budget', 'bartender_budget', 'host_budget', 'barista_budget',
  'support_budget', 'training_budget', 'line_cooks_budget', 'prep_cooks_budget',
  'pastry_budget', 'dishwashers_budget',
];

/** Fetch week-to-date revenue, budget, forecast, and labor from Monday through reportDate. */
export async function fetchWtdMetrics(
  sb: any,
  locationId: string,
  reportDate: string,
): Promise<WtdMetrics> {
  const monday = getMondayOfWeek(reportDate);

  const [
    { data: wtdActuals },
    { data: wtdBudgets },
    { data: wtdForecasts },
    { data: wtdLabor },
    { data: wtdBudgetLabor },
  ] = await Promise.all([
    sb.from('daily_actuals').select('revenue').eq('location_id', locationId).gte('business_date', monday).lte('business_date', reportDate),
    sb.from('daily_budget').select('budget_revenue, server_budget, bartender_budget, host_budget, barista_budget, support_budget, training_budget, line_cooks_budget, prep_cooks_budget, pastry_budget, dishwashers_budget').eq('location_id', locationId).gte('business_date', monday).lte('business_date', reportDate),
    sb.from('daily_forecasts').select('manager_revenue, ai_suggested_revenue').eq('location_id', locationId).gte('business_date', monday).lte('business_date', reportDate),
    sb.from('daily_labor').select('labor_dollars').eq('location_id', locationId).gte('business_date', monday).lte('business_date', reportDate),
    sb.from('daily_budget').select('server_budget, bartender_budget, host_budget, barista_budget, support_budget, training_budget, line_cooks_budget, prep_cooks_budget, pastry_budget, dishwashers_budget').eq('location_id', locationId).gte('business_date', monday).lte('business_date', reportDate),
  ]);

  const wtdRevenue = (wtdActuals || []).reduce((s: number, r: any) => s + (r.revenue || 0), 0);
  const wtdBudgetRevenue = (wtdBudgets || []).reduce((s: number, r: any) => s + (r.budget_revenue || 0), 0);
  const wtdForecastRevenue = (wtdForecasts || []).reduce(
    (s: number, r: any) => s + (r.manager_revenue || r.ai_suggested_revenue || 0), 0,
  );
  const wtdLaborActual = (wtdLabor || []).reduce((s: number, r: any) => s + (r.labor_dollars || 0), 0);
  const wtdLaborBudget = (wtdBudgetLabor || []).reduce((s: number, row: any) => {
    return s + BUDGET_LABOR_COLS.reduce((rs: number, col: string) => rs + (row[col] || 0), 0);
  }, 0);

  const wtdLaborPct = wtdRevenue > 0 ? wtdLaborActual / wtdRevenue : 0;
  const wtdBudgetLaborPct = wtdBudgetRevenue > 0 ? wtdLaborBudget / wtdBudgetRevenue : 0;

  return {
    wtdRevenue,
    wtdBudgetRevenue,
    wtdForecastRevenue,
    wtdLaborActual,
    wtdLaborBudget,
    wtdLaborPct,
    wtdBudgetLaborPct,
  };
}

/**
 * Direct data fetch — avoids HTTP circular call in serverless.
 * Mirrors the logic from /api/v1/insights endpoint.
 */
export async function fetchInsightsDataDirect(
  sb: any,
  locationId: string,
  date: string,
  locationName: string,
): Promise<InsightsData> {
  const FOH = ['Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training'];
  const BOH = ['Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'];
  const ALL = [...FOH, ...BOH];

  const [
    { data: actuals },
    { data: budget },
    { data: forecast },
    { data: labor },
    { data: laborTargets },
    { data: salesMixRows },
    { data: pmixRows },
    { data: loc },
  ] = await Promise.all([
    sb.from('daily_actuals').select('*').eq('location_id', locationId).eq('business_date', date).maybeSingle(),
    sb.from('daily_budget').select('*').eq('location_id', locationId).eq('business_date', date).maybeSingle(),
    sb.from('daily_forecasts').select('*').eq('location_id', locationId).eq('business_date', date).maybeSingle(),
    sb.from('daily_labor').select('*').eq('location_id', locationId).eq('business_date', date),
    sb.from('daily_labor_targets').select('*').eq('location_id', locationId).eq('business_date', date),
    sb.from('daily_sales_mix').select('*').eq('location_id', locationId).eq('business_date', date).order('revenue', { ascending: false }),
    sb.from('daily_pmix').select('*').eq('location_id', locationId).eq('business_date', date).order('revenue', { ascending: false }).limit(20),
    sb.from('locations').select('labor_budget_pct').eq('id', locationId).single(),
  ]);

  const revenue = actuals?.revenue ?? 0;
  const covers = actuals?.covers ?? 0;
  const budgetRevenue = budget?.budget_revenue ?? 0;
  const forecastRevenue = forecast?.manager_revenue ?? forecast?.ai_suggested_revenue ?? 0;
  const avgCheck = covers > 0 ? revenue / covers : 0;
  const targetLaborPct = loc?.labor_budget_pct ?? 0.30;

  const laborByPosition: Record<string, number> = {};
  for (const row of labor || []) {
    laborByPosition[row.mapped_position] = (laborByPosition[row.mapped_position] || 0) + row.labor_dollars;
  }

  const targetByPosition: Record<string, number> = {};
  for (const row of laborTargets || []) {
    targetByPosition[row.position] = row.projected_labor_dollars;
  }

  const totalLaborActual = Object.values(laborByPosition).reduce((s, v) => s + v, 0);
  const totalLaborProjected = Object.values(targetByPosition).reduce((s, v) => s + v, 0);
  const laborPctOfRevenue = revenue > 0 ? totalLaborActual / revenue : 0;

  const revVsBudgetDollars = revenue - budgetRevenue;
  const revVsBudgetPct = budgetRevenue > 0 ? revVsBudgetDollars / budgetRevenue : 0;
  const revVsForecastDollars = revenue - forecastRevenue;
  const revVsForecastPct = forecastRevenue > 0 ? revVsForecastDollars / forecastRevenue : 0;

  const flaggedPositions: InsightsData['metrics']['flaggedPositions'] = [];
  for (const pos of ALL) {
    const actual = laborByPosition[pos] || 0;
    const projected = targetByPosition[pos] || 0;
    const varianceDollars = actual - projected;
    const variancePct = revenue > 0 ? Math.abs(varianceDollars) / revenue : 0;
    if (variancePct > 0.015) {
      flaggedPositions.push({ position: pos, actual, projected, varianceDollars, variancePct });
    }
  }

  const revenueSummary = `${formatDatePretty(date)} generated ${fmt(revenue)} in net sales vs budget of ${fmt(budgetRevenue)} (${revVsBudgetDollars >= 0 ? '+' : ''}${fmt(revVsBudgetDollars)}) and forecast of ${fmt(forecastRevenue)}.`;
  const coversSummary = `Covers totaled ${covers.toLocaleString()} with an average check of $${avgCheck.toFixed(2)}.`;
  const salesMix = (salesMixRows && salesMixRows.length > 0)
    ? salesMixRows.map((r: any) => `${r.category}: ${fmt(r.revenue)} (${pct(r.pct_of_total)})`).join(', ')
    : 'Sales mix data not yet available.';
  const pmixMovers = (pmixRows && pmixRows.length > 0)
    ? 'Top sellers: ' + pmixRows.slice(0, 5).map((r: any) => `${r.item_name} (qty ${r.quantity}, ${fmt(r.revenue)})`).join('; ')
    : 'PMIX data not yet available.';

  const laborVariance = flaggedPositions.length === 0
    ? 'All positions within 1.5% of projected targets.'
    : flaggedPositions.map(fp => `${fp.position}: ${fmt(fp.actual)} vs ${fmt(fp.projected)} (${fp.varianceDollars > 0 ? 'over' : 'under'} ${fmt(Math.abs(fp.varianceDollars))})`).join('; ');

  let laborSavings = `Total labor ${pct(laborPctOfRevenue)} of revenue (target ${pct(targetLaborPct)}). `;
  if (laborPctOfRevenue > targetLaborPct) {
    const savingsDollars = (laborPctOfRevenue - targetLaborPct) * revenue;
    laborSavings += `Potential savings of ${fmt(savingsDollars)}.`;
  } else {
    laborSavings += 'Labor under target \u2014 efficient scheduling.';
  }

  const wtd = await fetchWtdMetrics(sb, locationId, date);

  return {
    date,
    locationName,
    sections: {
      revenueSummary,
      coversSummary,
      compsAndDiscounts: '',
      salesMix,
      pmixMovers,
      laborVariance,
      laborSavings,
      hourlyEfficiency: '',
    },
    metrics: {
      revenue,
      budgetRevenue,
      forecastRevenue,
      covers,
      avgCheck,
      totalLaborActual,
      totalLaborProjected,
      laborPctOfRevenue,
      targetLaborPct,
      revVsBudgetDollars,
      revVsBudgetPct,
      revVsForecastDollars,
      revVsForecastPct,
      flaggedPositions,
      salesMixData: salesMixRows || [],
      pmixData: pmixRows || [],
      weather: null,
    },
    wtd,
  };
}
