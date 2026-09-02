/**
 * Forecast Accuracy Tracking & Model Stats
 *
 * Records how well forecasts matched actuals and computes
 * rolling accuracy metrics for the self-improving engine.
 */

import {
	getSupabase,
	getSupabaseService,
} from '$lib/server/supabase';
import {
	generateForecastSuggestion,
	getAdaptiveWeights,
	type ModelStats,
} from './ai-forecast';
import { recordLearning } from '$lib/server/domain/record-learning';

// ---------------------------------------------------------------------------
// Accuracy Recording
// ---------------------------------------------------------------------------

/**
 * Record forecast accuracy for a date that has both an accepted forecast and actuals.
 * Called by the daily cron after syncing actuals.
 */
export async function recordForecastAccuracy(
	locationId: string,
	businessDate: string,
): Promise<void> {
	const sb = getSupabaseService();

	// Get accepted forecast
	const { data: forecast } = await sb
		.from('daily_forecasts')
		.select('manager_revenue, manager_covers')
		.eq('location_id', locationId)
		.eq('business_date', businessDate)
		.not('manager_revenue', 'is', null)
		.maybeSingle();

	if (!forecast?.manager_revenue) return;

	// Get actual revenue
	const { data: actual } = await sb
		.from('daily_actuals')
		.select('revenue, covers')
		.eq('location_id', locationId)
		.eq('business_date', businessDate)
		.gt('revenue', 0)
		.maybeSingle();

	if (!actual?.revenue) return;

	const forecastRev = Number(forecast.manager_revenue);
	const actualRev = Number(actual.revenue);
	const errorPct = forecastRev > 0 ? ((actualRev - forecastRev) / forecastRev) * 100 : 0;
	const absErrorPct = Math.abs(errorPct);
	const dateDow = new Date(businessDate + 'T12:00:00').getDay();

	// Regenerate the suggestion to capture component values
	const suggestion = await generateForecastSuggestion(locationId, businessDate);

	await sb.from('forecast_accuracy').upsert({
		location_id: locationId,
		business_date: businessDate,
		day_of_week: dateDow,
		forecast_revenue: forecastRev,
		actual_revenue: actualRev,
		error_pct: Math.round(errorPct * 10000) / 10000,
		abs_error_pct: Math.round(absErrorPct * 10000) / 10000,
		component_trailing: suggestion.components.trailingDowAvg,
		component_py: suggestion.components.pyAdjusted,
		component_momentum: suggestion.components.momentumRevenue,
		component_budget: suggestion.components.budgetRevenue,
		weights_used: suggestion.weights,
	}, { onConflict: 'location_id,business_date' });

	// Record notable accuracy insights as system learnings
	const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	if (absErrorPct > 10) {
		const dir = errorPct > 0 ? 'under-forecast' : 'over-forecast';
		await recordLearning({
			locationId,
			category: 'forecast',
			learning: `${dayNames[dateDow]} ${businessDate}: ${dir} by ${absErrorPct.toFixed(1)}% (forecast $${forecastRev.toLocaleString()}, actual $${actualRev.toLocaleString()})`,
			source: 'forecast_accuracy',
			confidence: 0.9,
		});
	} else if (absErrorPct < 2) {
		await recordLearning({
			locationId,
			category: 'forecast',
			learning: `${dayNames[dateDow]} ${businessDate}: highly accurate forecast within ${absErrorPct.toFixed(1)}% of actual`,
			source: 'forecast_accuracy',
			confidence: 0.95,
		});
	}
}

// ---------------------------------------------------------------------------
// Model Stats
// ---------------------------------------------------------------------------

/**
 * Get model accuracy stats for a location (last 4 weeks).
 */
export async function getModelStats(locationId: string): Promise<ModelStats> {
	const sb = getSupabase();

	// MAPE over last 28 days
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 28);
	const cutoffStr = cutoff.toISOString().split('T')[0];

	const { data: rows } = await sb
		.from('forecast_accuracy')
		.select('abs_error_pct, day_of_week, error_pct')
		.eq('location_id', locationId)
		.gte('business_date', cutoffStr)
		.not('abs_error_pct', 'is', null)
		.order('business_date', { ascending: false });

	const records = rows || [];
	const mape4w = records.length > 0
		? records.reduce((s, r) => s + Number(r.abs_error_pct), 0) / records.length
		: null;

	// Compute current adaptive weights (use today's DOW as representative)
	const todayDow = new Date().getDay();
	const adaptiveWeights = await getAdaptiveWeights(locationId, todayDow);

	// Trend notes across all DOWs
	const trendNotes: string[] = [];
	const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

	// Check for systematic bias per DOW
	const dowGroups: Record<number, number[]> = {};
	for (const r of records) {
		const dow = r.day_of_week;
		if (!dowGroups[dow]) dowGroups[dow] = [];
		dowGroups[dow].push(Number(r.error_pct));
	}
	for (const [dow, errors] of Object.entries(dowGroups)) {
		if (errors.length < 2) continue;
		const avg = errors.reduce((a, b) => a + b, 0) / errors.length;
		if (Math.abs(avg) > 3) {
			const dir = avg > 0 ? 'under' : 'over';
			trendNotes.push(`Model tends to ${dir}-forecast ${dayNames[Number(dow)]}s by ${Math.abs(avg).toFixed(1)}%`);
		}
	}

	return {
		mape4w: mape4w !== null ? Math.round(mape4w * 100) / 100 : null,
		adaptiveWeights,
		trendNotes,
		accuracyRecords: records.length,
	};
}
