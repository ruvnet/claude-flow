import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function gradeFromScore(score: number): string {
  if (score >= 97) return 'A+';
  if (score >= 93) return 'A';
  if (score >= 90) return 'A-';
  if (score >= 87) return 'B+';
  if (score >= 83) return 'B';
  if (score >= 80) return 'B-';
  if (score >= 77) return 'C+';
  if (score >= 73) return 'C';
  if (score >= 70) return 'C-';
  if (score >= 67) return 'D+';
  if (score >= 60) return 'D';
  return 'F';
}

function accuracyPts(mape: number): number {
  if (mape < 0.05) return 30;
  if (mape < 0.10) return 20;
  if (mape < 0.15) return 10;
  return 0;
}

function consistencyPts(errors: number[]): number {
  if (errors.length < 2) return 10;
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const variance = errors.reduce((s, e) => s + (e - mean) ** 2, 0) / errors.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev < 0.05) return 20;
  if (stdDev < 0.10) return 15;
  if (stdDev < 0.15) return 10;
  return 5;
}

function biasPts(meanBias: number): number {
  const absBias = Math.abs(meanBias);
  if (absBias < 0.02) return 20;
  if (absBias < 0.05) return 15;
  if (absBias < 0.10) return 10;
  return 5;
}

function improvementPts(recentMape: number | null, priorMape: number | null): number {
  if (recentMape === null || priorMape === null) return 8;
  if (priorMape === 0) return 8;
  const change = (recentMape - priorMape) / priorMape;
  if (change < -0.20) return 15;
  if (change < -0.10) return 12;
  if (change < 0) return 10;
  if (change < 0.10) return 6;
  return 3;
}

function coveragePts(forecastDays: number, actualDays: number): number {
  if (actualDays === 0) return 8;
  const ratio = forecastDays / actualDays;
  return Math.min(15, Math.round(ratio * 15));
}

function computeScore(mape: number, errors: number[], meanBias: number, recentMape: number | null, priorMape: number | null, fcDays: number, actDays: number) {
  const acc = accuracyPts(mape);
  const cons = consistencyPts(errors);
  const bias = biasPts(meanBias);
  const imp = improvementPts(recentMape, priorMape);
  const cov = coveragePts(fcDays, actDays);
  const total = acc + cons + bias + imp + cov; // max 100
  return { score: total, grade: gradeFromScore(total), breakdown: { accuracy: acc, consistency: cons, biasControl: bias, improvement: imp, coverage: cov } };
}

function rd4(n: number): number { return Math.round(n * 10000) / 10000; }

interface PairedDay {
  date: string;
  dayOfWeek: string;
  forecast: number;
  actual: number;
  errorPct: number;
}

function buildAnalysis(paired: PairedDay[], totalFcDays: number, totalActDays: number) {
  const errorPcts = paired.map(d => d.errorPct);
  const absErrorPcts = errorPcts.map(Math.abs);
  const mape = absErrorPcts.length > 0 ? absErrorPcts.reduce((a, b) => a + b, 0) / absErrorPcts.length : 0;
  const meanBias = errorPcts.length > 0 ? errorPcts.reduce((a, b) => a + b, 0) / errorPcts.length : 0;

  // DOW analysis
  const dowGroups: Record<string, { forecasts: number[]; actuals: number[]; errors: number[] }> = {};
  for (const day of paired) {
    if (!dowGroups[day.dayOfWeek]) dowGroups[day.dayOfWeek] = { forecasts: [], actuals: [], errors: [] };
    dowGroups[day.dayOfWeek].forecasts.push(day.forecast);
    dowGroups[day.dayOfWeek].actuals.push(day.actual);
    dowGroups[day.dayOfWeek].errors.push(day.errorPct);
  }
  const dowAnalysis = DAY_NAMES.map(dow => {
    const g = dowGroups[dow];
    if (!g || g.errors.length === 0) return { dow, avgForecast: 0, avgActual: 0, mape: 0, bias: 0, count: 0, grade: '-' };
    const avgFc = Math.round(g.forecasts.reduce((a, b) => a + b, 0) / g.forecasts.length);
    const avgAct = Math.round(g.actuals.reduce((a, b) => a + b, 0) / g.actuals.length);
    const dMape = g.errors.map(Math.abs).reduce((a, b) => a + b, 0) / g.errors.length;
    const dBias = g.errors.reduce((a, b) => a + b, 0) / g.errors.length;
    return { dow, avgForecast: avgFc, avgActual: avgAct, mape: rd4(dMape), bias: rd4(dBias), count: g.errors.length, grade: gradeFromScore(dMape < 0.05 ? 97 : dMape < 0.10 ? 85 : dMape < 0.15 ? 73 : 55) };
  });

  // Improvement: compare last half vs first half
  const halfIdx = Math.floor(paired.length / 2);
  const firstHalf = paired.slice(0, halfIdx);
  const secondHalf = paired.slice(halfIdx);
  const firstMape = firstHalf.length > 0 ? firstHalf.map(d => Math.abs(d.errorPct)).reduce((a, b) => a + b, 0) / firstHalf.length : null;
  const secondMape = secondHalf.length > 0 ? secondHalf.map(d => Math.abs(d.errorPct)).reduce((a, b) => a + b, 0) / secondHalf.length : null;

  const grading = computeScore(mape, errorPcts, meanBias, secondMape, firstMape, totalFcDays, totalActDays);
  const prevScore = firstMape !== null ? computeScore(firstMape, firstHalf.map(d => d.errorPct), 0, null, null, totalFcDays, totalActDays).score : null;
  const trend = prevScore !== null ? (grading.score > prevScore ? 'improving' : grading.score < prevScore ? 'declining' : 'stable') : 'stable';

  return {
    mape: rd4(mape),
    bias: rd4(meanBias),
    score: grading.score,
    grade: grading.grade,
    breakdown: grading.breakdown,
    previousScore: prevScore,
    trend,
    dailyDetail: paired.map(d => ({ date: d.date, dayOfWeek: d.dayOfWeek, forecast: Math.round(d.forecast), actual: Math.round(d.actual), errorPct: rd4(d.errorPct) })),
    dowAnalysis,
    totalForecasts: paired.length,
  };
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const locationId = url.searchParams.get('locationId');
  const weeksBack = Number(url.searchParams.get('weeksBack') || '4');

  if (!locationId) return json({ error: 'locationId required' }, { status: 400 });

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeksBack * 7);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  const todayStr = new Date().toISOString().split('T')[0];

  const wideCutoff = new Date();
  wideCutoff.setDate(wideCutoff.getDate() - 400);
  const wideCutoffStr = wideCutoff.toISOString().split('T')[0];

  const [{ data: forecastRows }, { data: actualRows }, { data: budgetRows }, { data: wideActualRows }, { data: accuracyRows }] = await Promise.all([
    sb.from('daily_forecasts')
      .select('business_date, manager_revenue, ai_suggested_revenue, ai_confidence, forecast_weights, override_tags, is_override, accepted_at')
      .eq('location_id', locationId).gte('business_date', cutoffStr).lte('business_date', todayStr)
      .or('manager_revenue.not.is.null,ai_suggested_revenue.not.is.null'),
    sb.from('daily_actuals')
      .select('business_date, revenue, covers, prior_year_revenue')
      .eq('location_id', locationId).gte('business_date', cutoffStr).lte('business_date', todayStr).gt('revenue', 0),
    sb.from('daily_budget')
      .select('business_date, budget_revenue')
      .eq('location_id', locationId).gte('business_date', cutoffStr).lte('business_date', todayStr),
    sb.from('daily_actuals')
      .select('business_date, revenue')
      .eq('location_id', locationId).gte('business_date', wideCutoffStr).lte('business_date', todayStr).gt('revenue', 0),
    sb.from('forecast_accuracy')
      .select('*').eq('location_id', locationId).gte('business_date', cutoffStr).lte('business_date', todayStr)
      .order('business_date', { ascending: true }),
  ]);

  const forecasts = forecastRows || [];
  const actuals = actualRows || [];
  const budgets = budgetRows || [];
  const wideActuals = wideActualRows || [];
  const accuracy = accuracyRows || [];

  const forecastMap = new Map(forecasts.map(f => [f.business_date, f]));
  const actualMap = new Map(actuals.map(a => [a.business_date, a]));
  const budgetMap = new Map(budgets.map(b => [b.business_date, b]));
  const actualsLookup = new Map(wideActuals.map((a: any) => [a.business_date, a.revenue || 0]));

  const PY_OFFSET_DAYS = 364;

  // Build daily comparison + paired arrays for AI and Manager
  const allDates = new Set([...forecasts.map(f => f.business_date), ...actuals.map(a => a.business_date)]);
  const sortedDates = [...allDates].sort();
  const dailyComparison: any[] = [];
  const aiPaired: PairedDay[] = [];
  const mgrPaired: PairedDay[] = [];

  let helixoBetter = 0, managerBetter = 0, sameCount = 0;

  for (const date of sortedDates) {
    const fc = forecastMap.get(date);
    const act = actualMap.get(date);
    const bud = budgetMap.get(date);
    const aiRev = fc?.ai_suggested_revenue ?? null;
    const mgrRev = fc?.manager_revenue ?? null;
    const actualRev = act?.revenue ?? null;
    const d = new Date(date + 'T12:00:00');
    const dow = DAY_NAMES[d.getDay()];

    // Trailing 2-week same-DOW average
    let trailing2wAvg: number | null = null;
    const sameDowRevs: number[] = [];
    for (let wk = 1; wk <= 2; wk++) {
      const priorDate = new Date(d);
      priorDate.setDate(priorDate.getDate() - wk * 7);
      const rev = actualsLookup.get(priorDate.toISOString().split('T')[0]);
      if (rev && rev > 0) sameDowRevs.push(rev);
    }
    if (sameDowRevs.length > 0) trailing2wAvg = Math.round(sameDowRevs.reduce((a, b) => a + b, 0) / sameDowRevs.length);

    const pyDate = new Date(d);
    pyDate.setDate(pyDate.getDate() - PY_OFFSET_DAYS);
    const pyRevenue = actualsLookup.get(pyDate.toISOString().split('T')[0]) || (act?.prior_year_revenue ?? null);

    // Error calculations
    let aiError: number | null = null, aiErrorPct: number | null = null;
    let mgrError: number | null = null, mgrErrorPct: number | null = null;

    if (aiRev != null && actualRev != null && actualRev > 0) {
      aiError = actualRev - aiRev;
      aiErrorPct = (actualRev - aiRev) / actualRev;
      aiPaired.push({ date, dayOfWeek: dow, forecast: aiRev, actual: actualRev, errorPct: aiErrorPct });
    }
    if (mgrRev != null && actualRev != null && actualRev > 0) {
      mgrError = actualRev - mgrRev;
      mgrErrorPct = (actualRev - mgrRev) / actualRev;
      mgrPaired.push({ date, dayOfWeek: dow, forecast: mgrRev, actual: actualRev, errorPct: mgrErrorPct });
    }

    // Head-to-head comparison
    if (aiRev != null && mgrRev != null && actualRev != null && actualRev > 0) {
      const aiAbsErr = Math.abs(actualRev - aiRev);
      const mgrAbsErr = Math.abs(actualRev - mgrRev);
      if (Math.abs(aiAbsErr - mgrAbsErr) < 1) sameCount++;
      else if (aiAbsErr < mgrAbsErr) helixoBetter++;
      else managerBetter++;
    }

    dailyComparison.push({
      date, dayOfWeek: dow,
      aiSuggested: aiRev, managerForecast: mgrRev, actual: actualRev,
      budget: bud?.budget_revenue ?? null, trailing2wAvg,
      samePeriodPY: pyRevenue ? Math.round(pyRevenue) : null,
      aiError: aiError != null ? Math.round(aiError) : null,
      aiErrorPct: aiErrorPct != null ? rd4(aiErrorPct) : null,
      mgrError: mgrError != null ? Math.round(mgrError) : null,
      mgrErrorPct: mgrErrorPct != null ? rd4(mgrErrorPct) : null,
      confidence: fc?.ai_confidence ?? null,
    });
  }

  // Build separate analyses
  const helixoAccuracy = buildAnalysis(aiPaired, forecasts.filter(f => f.ai_suggested_revenue != null).length, actuals.length);
  const approvedAccuracy = buildAnalysis(mgrPaired, forecasts.length, actuals.length);

  // Comparison
  const totalCompared = helixoBetter + managerBetter + sameCount;
  let avgImprovement = 0;
  if (totalCompared > 0 && helixoAccuracy.mape > 0) {
    avgImprovement = rd4((helixoAccuracy.mape - approvedAccuracy.mape) / helixoAccuracy.mape);
  }
  let recommendation = '';
  if (avgImprovement > 0.01) {
    recommendation = `Manager overrides improve accuracy by ${Math.round(avgImprovement * 100)}% on average.`;
  } else if (avgImprovement < -0.01) {
    recommendation = `AI suggestions are ${Math.round(Math.abs(avgImprovement) * 100)}% more accurate on average - consider trusting the AI forecast more often.`;
  } else {
    recommendation = 'AI and manager forecasts perform similarly overall.';
  }

  // Tag impact (unchanged logic, uses manager_revenue)
  const tagImpact: any[] = [];
  const tagStats: Record<string, { count: number; errors: number[] }> = {};
  for (const fc of forecasts) {
    const tags = fc.override_tags as string[] | null;
    if (!tags || tags.length === 0) continue;
    const act = actualMap.get(fc.business_date);
    if (!act || fc.manager_revenue <= 0) continue;
    for (const tag of tags) {
      if (!tagStats[tag]) tagStats[tag] = { count: 0, errors: [] };
      tagStats[tag].count++;
      tagStats[tag].errors.push((act.revenue - fc.manager_revenue) / fc.manager_revenue);
    }
  }
  for (const [tag, stats] of Object.entries(tagStats)) {
    const avg = stats.errors.reduce((a, b) => a + b, 0) / stats.errors.length;
    const acc = 1 - stats.errors.map(Math.abs).reduce((a, b) => a + b, 0) / stats.errors.length;
    tagImpact.push({ tag, occurrences: stats.count, avgRevImpact: rd4(avg), forecastAccuracy: Math.round(acc * 100) / 100 });
  }

  // Weight history
  const weightHistory = accuracy.filter(r => r.weights_used).slice(-14).map(r => ({
    date: r.business_date, trailing: r.weights_used?.trailing ?? null,
    pyGrowth: r.weights_used?.pyGrowth ?? null, momentum: r.weights_used?.momentum ?? null, budget: r.weights_used?.budget ?? null,
  }));

  // Recommendations
  const recommendations: string[] = [];
  const activeDow = approvedAccuracy.dowAnalysis.filter(d => d.count > 0);
  if (activeDow.length > 0) {
    const worst = activeDow.reduce((a, b) => a.mape > b.mape ? a : b);
    if (worst.mape > 0.10) {
      const dir = worst.bias > 0 ? 'under' : 'over';
      recommendations.push(`${worst.dow} forecasts are consistently ${Math.round(worst.mape * 100)}% off - model tends to ${dir}-forecast.`);
    }
  }
  if (managerBetter > helixoBetter && totalCompared > 3) {
    recommendations.push(`Manager overrides were closer to actual on ${managerBetter} of ${totalCompared} days - good instincts.`);
  } else if (helixoBetter > managerBetter && totalCompared > 3) {
    recommendations.push(`AI was more accurate on ${helixoBetter} of ${totalCompared} days - consider accepting AI suggestions more often.`);
  }
  if (approvedAccuracy.trend === 'improving') {
    recommendations.push('Overall forecast accuracy is trending upward.');
  } else if (approvedAccuracy.trend === 'declining') {
    recommendations.push('Forecast accuracy has declined recently - review whether business patterns have shifted.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Forecast model is performing well across all dimensions. Continue monitoring.');
  }

  return json({
    helixoAccuracy,
    approvedAccuracy,
    comparison: { helixoBetter, managerBetter, same: sameCount, avgImprovement, recommendation },
    dailyComparison,
    tagImpact,
    weightHistory,
    recommendations,
  });
};
