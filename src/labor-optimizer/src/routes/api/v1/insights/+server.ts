import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getSupabase,
  FOH_POSITIONS,
  BOH_POSITIONS,
  ALL_POSITIONS,
  type DashboardPosition,
} from '$lib/server/supabase';
import { getWeatherForDate } from '$lib/server/integrations/weather/weather-service';
import { getReservationsForDate } from '$lib/server/integrations/resy/resy-service';

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

function fmt(n: number): string {
  return '$' + Math.round(n).toLocaleString();
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function sign(n: number): string {
  return n >= 0 ? '+' : '';
}

function dayName(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long' });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split('T')[0];
}

interface PositionVariance {
  position: string;
  actual: number;
  projected: number;
  varianceDollars: number;
  variancePct: number;
}

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const locationId = url.searchParams.get('locationId');
  const date = url.searchParams.get('date');

  if (!locationId || !date) {
    return json({ error: 'locationId and date (YYYY-MM-DD) are required' }, { status: 400 });
  }

  // Fetch all data in parallel
  const dateObj = new Date(date + 'T12:00:00');
  const priorDate = new Date(dateObj);
  priorDate.setDate(priorDate.getDate() - 1);
  const priorDateStr = priorDate.toISOString().split('T')[0];

  const [
    { data: actuals },
    { data: budget },
    { data: forecast },
    { data: labor },
    { data: laborTargets },
    { data: salesMixRows },
    { data: pmixRows },
    { data: priorPmixRows },
    { data: hourlyRows },
  ] = await Promise.all([
    sb.from('daily_actuals').select('*').eq('location_id', locationId).eq('business_date', date).maybeSingle(),
    sb.from('daily_budget').select('*').eq('location_id', locationId).eq('business_date', date).maybeSingle(),
    sb.from('daily_forecasts').select('*').eq('location_id', locationId).eq('business_date', date).maybeSingle(),
    sb.from('daily_labor').select('*').eq('location_id', locationId).eq('business_date', date),
    sb.from('daily_labor_targets').select('*').eq('location_id', locationId).eq('business_date', date),
    sb.from('daily_sales_mix').select('*').eq('location_id', locationId).eq('business_date', date).order('revenue', { ascending: false }),
    sb.from('daily_pmix').select('*').eq('location_id', locationId).eq('business_date', date).order('revenue', { ascending: false }).limit(20),
    sb.from('daily_pmix').select('item_name, quantity, revenue').eq('location_id', locationId).eq('business_date', priorDateStr),
    sb.from('daily_hourly_sales').select('*').eq('location_id', locationId).eq('business_date', date).order('hour_of_day', { ascending: true }),
  ]);

  // Fetch weather and reservation data (non-blocking)
  const [weatherData, resoData] = await Promise.all([
    getWeatherForDate(locationId, date).catch(() => null),
    getReservationsForDate(locationId, date).catch(() => null),
  ]);

  // Extract values with safe defaults
  const revenue = actuals?.revenue ?? 0;
  const covers = actuals?.covers ?? 0;
  const priorYearRevenue = actuals?.prior_year_revenue ?? null;
  const budgetRevenue = budget?.budget_revenue ?? 0;
  const forecastRevenue = forecast?.manager_revenue ?? forecast?.ai_suggested_revenue ?? 0;
  const sameWeekPYRevenue = actuals?.prior_year_revenue ?? 0;
  const totalDiscounts = actuals?.total_discounts ?? 0;
  const totalComps = actuals?.total_comps ?? 0;
  const discountPct = revenue > 0 ? totalDiscounts / revenue : 0;
  const compPct = revenue > 0 ? totalComps / revenue : 0;

  // Average check
  const avgCheck = covers > 0 ? revenue / covers : 0;
  const budgetAvgCheck = budgetRevenue > 0 && budget
    ? budgetRevenue / (covers || 1) // approximate budget avg check
    : 0;

  // Labor by position
  const laborByPosition: Record<string, number> = {};
  for (const row of labor || []) {
    const pos = row.mapped_position as string;
    laborByPosition[pos] = (laborByPosition[pos] || 0) + row.labor_dollars;
  }

  const targetByPosition: Record<string, number> = {};
  for (const row of laborTargets || []) {
    targetByPosition[row.position] = row.projected_labor_dollars;
  }

  const budgetByPosition: Record<string, number> = {};
  if (budget) {
    for (const [col, pos] of Object.entries(BUDGET_COL_TO_POSITION)) {
      budgetByPosition[pos] = budget[col] ?? 0;
    }
  }

  // Calculate total labor
  const totalLaborActual = Object.values(laborByPosition).reduce((s, v) => s + v, 0);
  const totalLaborProjected = Object.values(targetByPosition).reduce((s, v) => s + v, 0);
  const laborPctOfRevenue = revenue > 0 ? totalLaborActual / revenue : 0;

  // FOH / BOH splits
  const fohActual = FOH_POSITIONS.reduce((s, p) => s + (laborByPosition[p] || 0), 0);
  const bohActual = BOH_POSITIONS.reduce((s, p) => s + (laborByPosition[p] || 0), 0);
  const fohProjected = FOH_POSITIONS.reduce((s, p) => s + (targetByPosition[p] || 0), 0);
  const bohProjected = BOH_POSITIONS.reduce((s, p) => s + (targetByPosition[p] || 0), 0);

  // Flag positions with variance > 1.5% of revenue
  const flaggedPositions: PositionVariance[] = [];
  for (const pos of ALL_POSITIONS) {
    const actual = laborByPosition[pos] || 0;
    const projected = targetByPosition[pos] || 0;
    const varianceDollars = actual - projected;
    const variancePct = revenue > 0 ? Math.abs(varianceDollars) / revenue : 0;
    if (variancePct > 0.015) {
      flaggedPositions.push({
        position: pos,
        actual,
        projected,
        varianceDollars,
        variancePct,
      });
    }
  }

  // Revenue variances
  const revVsBudgetDollars = revenue - budgetRevenue;
  const revVsBudgetPct = budgetRevenue > 0 ? revVsBudgetDollars / budgetRevenue : 0;
  const revVsForecastDollars = revenue - forecastRevenue;
  const revVsForecastPct = forecastRevenue > 0 ? revVsForecastDollars / forecastRevenue : 0;
  const revVsPYDollars = revenue - sameWeekPYRevenue;
  const revVsPYPct = sameWeekPYRevenue > 0 ? revVsPYDollars / sameWeekPYRevenue : 0;

  // Target labor pct (from location settings or default 30%)
  const { data: location } = await sb
    .from('locations')
    .select('labor_budget_pct')
    .eq('id', locationId)
    .single();
  const targetLaborPct = location?.labor_budget_pct ?? 0.30;

  // --- Build narrative sections ---

  const formattedDate = formatDate(date);
  const dayOfWeek = dayName(date);

  // Revenue Summary
  let revenueSummary = `${formattedDate} generated ${fmt(revenue)} in net sales, `;
  revenueSummary += `${sign(revVsBudgetDollars)}${fmt(Math.abs(revVsBudgetDollars))} (${sign(revVsBudgetPct)}${pct(Math.abs(revVsBudgetPct))}) vs budget of ${fmt(budgetRevenue)}`;
  revenueSummary += ` and ${sign(revVsForecastDollars)}${fmt(Math.abs(revVsForecastDollars))} vs forecast of ${fmt(forecastRevenue)}. `;
  if (sameWeekPYRevenue > 0) {
    revenueSummary += `Compared to the same week prior year (${fmt(sameWeekPYRevenue)}), sales were ${revVsPYDollars >= 0 ? 'up' : 'down'} ${pct(Math.abs(revVsPYPct))}. `;
  }
  if (priorYearRevenue !== null && priorYearRevenue > 0) {
    const pyVar = revenue - priorYearRevenue;
    const pyPct = pyVar / priorYearRevenue;
    revenueSummary += `Same day last year: ${fmt(priorYearRevenue)} (${pyVar >= 0 ? 'up' : 'down'} ${pct(Math.abs(pyPct))}). `;
  }
  if (weatherData && weatherData.condition) {
    const tempHigh = Number(weatherData.temp_high) || 0;
    const precip = Number(weatherData.precipitation_pct) || 0;
    const isAdverse = precip > 40 || ['Rain', 'Thunderstorm', 'Snow'].includes(weatherData.condition);
    const impactNote = isAdverse ? ' Weather may have impacted traffic.' : '';
    revenueSummary += `Weather: ${weatherData.description || weatherData.condition}, high ${Math.round(tempHigh)}°F.${impactNote} `;
  }
  revenueSummary += revenue >= budgetRevenue
    ? 'Strong performance above budget.'
    : `Below budget target by ${pct(Math.abs(revVsBudgetPct))}.`;

  // Covers & Check
  let coversSummary = `Covers totaled ${covers.toLocaleString()} with an average check of ${fmt(avgCheck)}. `;
  if (resoData && resoData.booked_covers > 0) {
    const avgPSize = resoData.avg_party_size ? ` with avg party size of ${Number(resoData.avg_party_size).toFixed(1)}` : '';
    coversSummary += `Resy shows ${resoData.booked_covers} booked covers${avgPSize}. `;
    if (resoData.walkin_covers > 0) {
      coversSummary += `Walk-ins: ${resoData.walkin_covers} covers. `;
    }
    if (resoData.no_show_count > 0) {
      coversSummary += `No-shows: ${resoData.no_show_count}. `;
    }
  }
  if (budgetAvgCheck > 0) {
    const checkDiff = avgCheck - budgetAvgCheck;
    coversSummary += checkDiff >= 0
      ? `Check average exceeded budget by ${fmt(checkDiff)}, driven by higher per-guest spend.`
      : `Check average was ${fmt(Math.abs(checkDiff))} below budget target.`;
  }

  // Sales Mix — real data from daily_sales_mix
  let salesMix = '';
  if (salesMixRows && salesMixRows.length > 0) {
    const parts = salesMixRows.map((r: any) =>
      `${r.category}: ${fmt(r.revenue)} (${pct(r.pct_of_total)})`
    );
    salesMix = `Sales mix breakdown: ${parts.join(', ')}.`;
  } else {
    salesMix = 'Sales mix data not yet available for this date. Data populates after the next Toast sync.';
  }

  // PMIX Movers — real data from daily_pmix + prior day comparison
  let pmixMovers = '';
  if (pmixRows && pmixRows.length > 0) {
    // Top 5 sellers by revenue
    const topSellers = pmixRows.slice(0, 5).map((r: any) =>
      `${r.item_name} (qty ${r.quantity}, ${fmt(r.revenue)})`
    );
    pmixMovers = `Top sellers: ${topSellers.join('; ')}.`;

    // Compute movers vs prior day
    if (priorPmixRows && priorPmixRows.length > 0) {
      const priorMap: Record<string, { quantity: number; revenue: number }> = {};
      for (const pr of priorPmixRows) {
        priorMap[pr.item_name] = { quantity: pr.quantity, revenue: pr.revenue };
      }
      const movers: { name: string; changePct: number }[] = [];
      for (const cur of pmixRows) {
        const prior = priorMap[cur.item_name];
        if (prior && prior.quantity > 0) {
          const changePct = (cur.quantity - prior.quantity) / prior.quantity;
          if (Math.abs(changePct) > 0.15) { // Only show >15% swings
            movers.push({ name: cur.item_name, changePct });
          }
        }
      }
      movers.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
      const topMovers = movers.slice(0, 4);
      if (topMovers.length > 0) {
        const moverParts = topMovers.map(m =>
          `${m.name} ${m.changePct >= 0 ? 'up' : 'down'} ${pct(Math.abs(m.changePct))}`
        );
        pmixMovers += ` Biggest movers vs prior day: ${moverParts.join('; ')}.`;
      }
    }
  } else {
    pmixMovers = 'PMIX data not yet available for this date. Data populates after the next Toast sync.';
  }

  // Labor Variance
  let laborVariance = '';
  if (flaggedPositions.length === 0) {
    laborVariance = 'All positions came in within 1.5% of projected labor targets. No significant position-level variances to report.';
  } else {
    const lines = flaggedPositions.map((fp) => {
      const direction = fp.varianceDollars > 0 ? 'over' : 'under';
      const suggestion = fp.varianceDollars > 0 ? 'Consider adjusting scheduling.' : 'Favorable variance.';
      return `${fp.position}: Actual ${fmt(fp.actual)} vs Projected ${fmt(fp.projected)} \u2014 ${direction} by ${fmt(Math.abs(fp.varianceDollars))} (${pct(fp.variancePct)} of revenue). ${suggestion}`;
    });
    laborVariance = lines.join(' ');
  }

  // Labor Savings
  let laborSavings = '';
  laborSavings += `Total labor was ${pct(laborPctOfRevenue)} of revenue (${pct(targetLaborPct)} target). `;
  if (laborPctOfRevenue > targetLaborPct) {
    const savingsDollars = (laborPctOfRevenue - targetLaborPct) * revenue;
    const overPositions = flaggedPositions
      .filter((fp) => fp.varianceDollars > 0)
      .sort((a, b) => b.varianceDollars - a.varianceDollars)
      .map((fp) => `${fp.position} (${sign(fp.varianceDollars)}${fmt(Math.abs(fp.varianceDollars))})`)
      .slice(0, 3);
    laborSavings += `Potential savings of ${fmt(savingsDollars)} by aligning to target.`;
    if (overPositions.length > 0) {
      laborSavings += ` Key areas: ${overPositions.join(', ')}.`;
    }
  } else {
    laborSavings += 'Labor came in under target \u2014 efficient scheduling.';
  }

  // Hourly Efficiency — real data from daily_hourly_sales
  let hourlyEfficiency = '';
  const hourlyData: { hour: number; revenue: number; covers: number; orderCount: number }[] = [];
  if (hourlyRows && hourlyRows.length > 0) {
    for (const r of hourlyRows) {
      hourlyData.push({
        hour: r.hour_of_day,
        revenue: Number(r.revenue) || 0,
        covers: r.covers || 0,
        orderCount: r.order_count || 0,
      });
    }
    // Find peak hour
    const peakHour = hourlyData.reduce((best, h) => h.revenue > best.revenue ? h : best, hourlyData[0]);
    const peakLabel = peakHour.hour === 0 ? '12AM' : peakHour.hour <= 12 ? `${peakHour.hour}${peakHour.hour === 12 ? 'PM' : 'AM'}` : `${peakHour.hour - 12}PM`;
    // Lunch window (11AM-2PM) and dinner window (5PM-9PM)
    const lunchHours = hourlyData.filter(h => h.hour >= 11 && h.hour <= 14);
    const dinnerHours = hourlyData.filter(h => h.hour >= 17 && h.hour <= 21);
    const lunchRevenue = lunchHours.reduce((s, h) => s + h.revenue, 0);
    const dinnerRevenue = dinnerHours.reduce((s, h) => s + h.revenue, 0);
    const lunchAvg = lunchHours.length > 0 ? lunchRevenue / lunchHours.length : 0;
    const dinnerAvg = dinnerHours.length > 0 ? dinnerRevenue / dinnerHours.length : 0;
    // Identify slow hours (revenue < 25% of peak)
    const slowThreshold = peakHour.revenue * 0.25;
    const slowHours = hourlyData.filter(h => h.revenue > 0 && h.revenue < slowThreshold);
    const slowLabels = slowHours.slice(0, 3).map(h => {
      const hr = h.hour === 0 ? '12AM' : h.hour <= 12 ? `${h.hour}${h.hour === 12 ? 'PM' : 'AM'}` : `${h.hour - 12}PM`;
      return `${hr} (${fmt(h.revenue)})`;
    });

    hourlyEfficiency = `Peak revenue at ${peakLabel} (${fmt(peakHour.revenue)}). `;
    if (lunchHours.length > 0) {
      hourlyEfficiency += `Lunch (11AM-2PM) averaged ${fmt(lunchAvg)}/hr totaling ${fmt(lunchRevenue)}. `;
    }
    if (dinnerHours.length > 0) {
      hourlyEfficiency += `Dinner (5PM-9PM) averaged ${fmt(dinnerAvg)}/hr totaling ${fmt(dinnerRevenue)}. `;
    }
    if (slowLabels.length > 0) {
      hourlyEfficiency += `Low-volume hours: ${slowLabels.join(', ')} — consider staffing adjustments.`;
    }
  } else {
    hourlyEfficiency = 'Hourly sales data not yet available for this date. Data populates after the next Toast sync.';
  }

  // Fetch existing manager notes + WTD data in parallel
  const mondayDate = getMondayOfWeek(date);
  const [
    { data: notesRow },
    { data: wtdActualsRows },
    { data: wtdBudgetRows },
    { data: wtdForecastRows },
    { data: wtdLaborRows },
  ] = await Promise.all([
    sb.from('manager_notes').select('notes, labor_variance_notes, updated_at').eq('location_id', locationId).eq('business_date', date).single(),
    sb.from('daily_actuals').select('revenue').eq('location_id', locationId).gte('business_date', mondayDate).lte('business_date', date),
    sb.from('daily_budget').select('budget_revenue, server_budget, bartender_budget, host_budget, barista_budget, support_budget, training_budget, line_cooks_budget, prep_cooks_budget, pastry_budget, dishwashers_budget').eq('location_id', locationId).gte('business_date', mondayDate).lte('business_date', date),
    sb.from('daily_forecasts').select('manager_revenue, ai_suggested_revenue').eq('location_id', locationId).gte('business_date', mondayDate).lte('business_date', date),
    sb.from('daily_labor').select('labor_dollars').eq('location_id', locationId).gte('business_date', mondayDate).lte('business_date', date),
  ]);

  const BUDGET_LABOR_COLS = [
    'server_budget', 'bartender_budget', 'host_budget', 'barista_budget',
    'support_budget', 'training_budget', 'line_cooks_budget', 'prep_cooks_budget',
    'pastry_budget', 'dishwashers_budget',
  ];
  const wtdRevenue = (wtdActualsRows || []).reduce((s: number, r: any) => s + (r.revenue || 0), 0);
  const wtdBudgetRevenue = (wtdBudgetRows || []).reduce((s: number, r: any) => s + (r.budget_revenue || 0), 0);
  const wtdForecastRevenue = (wtdForecastRows || []).reduce(
    (s: number, r: any) => s + (r.manager_revenue || r.ai_suggested_revenue || 0), 0,
  );
  const wtdLaborActual = (wtdLaborRows || []).reduce((s: number, r: any) => s + (r.labor_dollars || 0), 0);
  const wtdLaborBudget = (wtdBudgetRows || []).reduce((s: number, row: any) => {
    return s + BUDGET_LABOR_COLS.reduce((rs: number, col: string) => rs + (row[col] || 0), 0);
  }, 0);
  const wtdLaborPct = wtdRevenue > 0 ? wtdLaborActual / wtdRevenue : 0;
  const wtdBudgetLaborPct = wtdBudgetRevenue > 0 ? wtdLaborBudget / wtdBudgetRevenue : 0;

  return json({
    date,
    sections: {
      revenueSummary,
      coversSummary,
      compsAndDiscounts: totalDiscounts > 0 || totalComps > 0
        ? `Discounts: ${fmt(totalDiscounts)} (${pct(discountPct)} of revenue). Comps: ${fmt(totalComps)} (${pct(compPct)} of revenue). Combined: ${fmt(totalDiscounts + totalComps)} (${pct(discountPct + compPct)}).`
        : 'No discounts or comps recorded for this date.',
      salesMix,
      pmixMovers,
      laborVariance,
      laborSavings,
      hourlyEfficiency,
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
      fohActual,
      bohActual,
      fohProjected,
      bohProjected,
      // Structured labor metrics for downstream consumers (email cron, etc.)
      fohLabor: fohActual,
      bohLabor: bohActual,
      totalLabor: totalLaborActual,
      fohBudgetLabor: FOH_POSITIONS.reduce((s, p) => s + (budgetByPosition[p] || 0), 0),
      bohBudgetLabor: BOH_POSITIONS.reduce((s, p) => s + (budgetByPosition[p] || 0), 0),
      totalBudgetLabor: Object.values(budgetByPosition).reduce((s, v) => s + v, 0),
      fohProjectedLabor: fohProjected,
      bohProjectedLabor: bohProjected,
      totalProjectedLabor: totalLaborProjected,
      laborPct: revenue > 0 ? totalLaborActual / revenue : 0,
      budgetLaborPct: budgetRevenue > 0
        ? Object.values(budgetByPosition).reduce((s, v) => s + v, 0) / budgetRevenue
        : 0,
      targetLaborPct,
      sameWeekPYRevenue,
      priorYearRevenue,
      totalDiscounts,
      totalComps,
      discountPct,
      compPct,
      revVsBudgetDollars,
      revVsBudgetPct,
      revVsForecastDollars,
      revVsForecastPct,
      flaggedPositions,
      salesMixData: salesMixRows || [],
      pmixData: pmixRows || [],
      hourlyData,
      weather: weatherData ? {
        condition: weatherData.condition,
        description: weatherData.description,
        icon: weatherData.icon,
        tempHigh: Number(weatherData.temp_high) || null,
        tempLow: Number(weatherData.temp_low) || null,
        precipitationPct: Number(weatherData.precipitation_pct) || null,
      } : null,
      reservations: resoData ? {
        bookedCovers: resoData.booked_covers,
        walkinCovers: resoData.walkin_covers,
        totalCovers: resoData.total_covers,
        noShowCount: resoData.no_show_count,
        cancelCount: resoData.cancel_count,
        avgPartySize: Number(resoData.avg_party_size) || null,
        peakHour: resoData.peak_hour,
      } : null,
    },
    wtd: {
      wtdRevenue,
      wtdBudgetRevenue,
      wtdForecastRevenue,
      wtdLaborActual,
      wtdLaborBudget,
      wtdLaborPct,
      wtdBudgetLaborPct,
    },
    managerNotes: notesRow?.notes || '',
    laborVarianceNotes: notesRow?.labor_variance_notes || '',
  });
};

/** Save manager narrative notes and/or labor variance notes */
export const POST: RequestHandler = async ({ request }) => {
  const { locationId, date, notes, laborVarianceNotes } = await request.json();
  if (!locationId || !date) {
    return json({ error: 'locationId and date required' }, { status: 400 });
  }
  const sb = getSupabase();
  const upsertData: any = {
    location_id: locationId,
    business_date: date,
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) upsertData.notes = notes;
  if (laborVarianceNotes !== undefined) upsertData.labor_variance_notes = laborVarianceNotes;
  const { error } = await sb.from('manager_notes').upsert(upsertData, { onConflict: 'location_id,business_date' });
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ saved: true });
};
