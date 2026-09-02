/**
 * Forecast helper functions — extracted to keep ai-forecast.ts under 500 lines.
 * Handles PY lookup, YTD trend analysis, and enhanced weather impact.
 */

import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Prior Year Revenue Lookup
// ---------------------------------------------------------------------------

export interface PyLookupResult {
	pyRevenue: number;
	pyCovers: number;
	pyDate: string | null;
	yoyGrowthFactor: number;
	pyAdjusted: number;
}

/**
 * Look up prior-year revenue for the same day-of-week (52 weeks back).
 * Tries 364 days back first (same DOW), then +/-1 day as fallback.
 * Computes YOY growth from last 4 weeks of actuals vs same 4 weeks PY.
 */
export async function lookupPriorYear(
	locationId: string,
	targetDate: string,
): Promise<PyLookupResult> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');

	// Try 364 days back (same DOW, 52 weeks), then 363 and 365
	const offsets = [364, 363, 365];
	let pyRevenue = 0;
	let pyCovers = 0;
	let pyDate: string | null = null;

	for (const offset of offsets) {
		const pyTarget = new Date(target);
		pyTarget.setDate(pyTarget.getDate() - offset);
		const pyDateStr = pyTarget.toISOString().split('T')[0];

		const { data } = await sb
			.from('daily_actuals')
			.select('revenue, covers, business_date')
			.eq('location_id', locationId)
			.eq('business_date', pyDateStr)
			.gt('revenue', 0)
			.maybeSingle();

		if (data && data.revenue > 0) {
			pyRevenue = Number(data.revenue);
			pyCovers = Number(data.covers) || 0;
			pyDate = data.business_date;
			break;
		}
	}

	// Compute YOY growth factor from last 4 weeks vs same 4 weeks a year ago
	const yoyGrowthFactor = await computeYoyGrowth(locationId, targetDate);
	const pyAdjusted = pyRevenue > 0 ? pyRevenue * yoyGrowthFactor : 0;

	return { pyRevenue, pyCovers, pyDate, yoyGrowthFactor, pyAdjusted };
}

/**
 * Compare last 4 weeks of actuals to the same 4 weeks one year prior.
 * Returns a growth factor (e.g., 1.05 = +5% YOY).
 */
async function computeYoyGrowth(
	locationId: string,
	targetDate: string,
): Promise<number> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');

	// Current period: 28 days ending before target
	const periodEnd = new Date(target);
	const periodStart = new Date(target);
	periodStart.setDate(periodStart.getDate() - 28);

	const { data: currentRows } = await sb
		.from('daily_actuals')
		.select('revenue')
		.eq('location_id', locationId)
		.gte('business_date', periodStart.toISOString().split('T')[0])
		.lt('business_date', periodEnd.toISOString().split('T')[0])
		.gt('revenue', 0);

	// Same period one year ago (364 days offset to match DOW)
	const pyPeriodEnd = new Date(periodEnd);
	pyPeriodEnd.setDate(pyPeriodEnd.getDate() - 364);
	const pyPeriodStart = new Date(periodStart);
	pyPeriodStart.setDate(pyPeriodStart.getDate() - 364);

	const { data: pyRows } = await sb
		.from('daily_actuals')
		.select('revenue')
		.eq('location_id', locationId)
		.gte('business_date', pyPeriodStart.toISOString().split('T')[0])
		.lt('business_date', pyPeriodEnd.toISOString().split('T')[0])
		.gt('revenue', 0);

	const currentTotal = (currentRows || []).reduce((s, r) => s + Number(r.revenue), 0);
	const pyTotal = (pyRows || []).reduce((s, r) => s + Number(r.revenue), 0);

	if (pyTotal > 0 && currentTotal > 0) {
		return currentTotal / pyTotal;
	}
	return 1.0; // neutral if insufficient data
}

// ---------------------------------------------------------------------------
// YTD Trend Analysis
// ---------------------------------------------------------------------------

export interface YtdTrendResult {
	ytdRevenue: number;
	ytdPyRevenue: number;
	ytdGrowthRate: number;   // e.g., 0.05 = +5%
	scalingFactor: number;   // applied to final forecast
	reasoningNote: string;
}

/**
 * Compute YTD revenue trend comparing fiscal year to date vs prior year.
 * Fiscal year starts 12/29/2025 (current) and 12/30/2024 (PY).
 */
export async function computeYtdTrend(
	locationId: string,
	targetDate: string,
): Promise<YtdTrendResult> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');

	// Fiscal year start dates
	const fyStart = '2025-12-29';
	const fyPyStart = '2024-12-30';

	// How many days into the fiscal year is the target?
	const fyStartDate = new Date('2025-12-29T12:00:00');
	const daysIntoFy = Math.floor((target.getTime() - fyStartDate.getTime()) / (1000 * 60 * 60 * 24));

	if (daysIntoFy <= 0) {
		return { ytdRevenue: 0, ytdPyRevenue: 0, ytdGrowthRate: 0, scalingFactor: 1.0, reasoningNote: '' };
	}

	// Current FY YTD: from fiscal start to latest actuals before target
	const { data: ytdRows } = await sb
		.from('daily_actuals')
		.select('revenue')
		.eq('location_id', locationId)
		.gte('business_date', fyStart)
		.lt('business_date', targetDate)
		.gt('revenue', 0);

	// PY equivalent period: same number of days from PY fiscal start
	const pyFyEnd = new Date(fyPyStart + 'T12:00:00');
	pyFyEnd.setDate(pyFyEnd.getDate() + daysIntoFy);

	const { data: pyYtdRows } = await sb
		.from('daily_actuals')
		.select('revenue')
		.eq('location_id', locationId)
		.gte('business_date', fyPyStart)
		.lt('business_date', pyFyEnd.toISOString().split('T')[0])
		.gt('revenue', 0);

	const ytdRevenue = (ytdRows || []).reduce((s, r) => s + Number(r.revenue), 0);
	const ytdPyRevenue = (pyYtdRows || []).reduce((s, r) => s + Number(r.revenue), 0);

	let ytdGrowthRate = 0;
	let scalingFactor = 1.0;
	let reasoningNote = '';

	if (ytdPyRevenue > 0 && ytdRevenue > 0) {
		ytdGrowthRate = (ytdRevenue - ytdPyRevenue) / ytdPyRevenue;
		// Dampen the scaling factor: use half the YTD growth rate to avoid overreacting
		scalingFactor = 1 + (ytdGrowthRate * 0.5);
		// Clamp between 0.85 and 1.15
		scalingFactor = Math.max(0.85, Math.min(1.15, scalingFactor));

		const ytdM = (ytdRevenue / 1_000_000).toFixed(2);
		const pyM = (ytdPyRevenue / 1_000_000).toFixed(2);
		const sign = ytdGrowthRate >= 0 ? '+' : '';
		reasoningNote = `YTD Revenue: $${ytdM}M vs PY $${pyM}M (${sign}${(ytdGrowthRate * 100).toFixed(1)}%)`;
	}

	return { ytdRevenue, ytdPyRevenue, ytdGrowthRate, scalingFactor, reasoningNote };
}

// ---------------------------------------------------------------------------
// Enhanced Weather Impact
// ---------------------------------------------------------------------------

export interface WeatherImpactResult {
	adjustedRevenue: number;  // 0 if no impact computed
	weatherNote: string;
	impactMultiplier: number; // 1.0 = neutral
}

/**
 * Enhanced weather impact analysis with severity-based adjustments and
 * learned coefficients from 90-day historical weather-revenue correlation.
 */
export async function computeWeatherImpact(
	locationId: string,
	targetDate: string,
	dayOfWeek: number,
	dayName: string,
	baselineRevenue: number,
	weatherData: {
		temp_high: number | null;
		temp_low: number | null;
		condition: string | null;
		precipitation_pct: number | null;
		description: string | null;
	},
): Promise<WeatherImpactResult> {
	const tempHigh = Number(weatherData.temp_high) || 70;
	const tempLow = Number(weatherData.temp_low) || 50;
	const precip = Number(weatherData.precipitation_pct) || 0;
	const condition = weatherData.condition || 'Clear';
	const desc = weatherData.description || condition;

	if (baselineRevenue <= 0) {
		return { adjustedRevenue: 0, weatherNote: `Weather: ${Math.round(tempHigh)}F, ${desc}`, impactMultiplier: 1.0 };
	}

	// Try to learn from historical weather-revenue data first
	const learnedMultiplier = await getLearnedWeatherCoefficient(locationId, dayOfWeek, condition, tempHigh, precip);

	if (learnedMultiplier !== null) {
		const pctImpact = Math.round((learnedMultiplier - 1) * 100);
		const adjustedRevenue = baselineRevenue * learnedMultiplier;
		const note = `Weather: ${Math.round(tempHigh)}F, ${desc} -- learned ${pctImpact >= 0 ? '+' : ''}${pctImpact}% impact on ${dayName}s`;
		return { adjustedRevenue, weatherNote: note, impactMultiplier: learnedMultiplier };
	}

	// Fall back to rule-based impact estimation
	let multiplier = 1.0;
	let reason = '';

	// Rain/storm severity
	const stormConditions = ['Thunderstorm', 'Squall', 'Tornado'];
	const rainConditions = ['Rain', 'Drizzle', 'Snow', 'Sleet'];

	if (stormConditions.includes(condition) || precip > 80) {
		multiplier = 0.85; // -15% for severe weather
		reason = `severe weather (${desc}) -- est. -15%`;
	} else if (rainConditions.includes(condition) || precip > 50) {
		multiplier = 0.92; // -8% for moderate rain
		reason = `rain/precip ${precip}% (${desc}) -- est. -8%`;
	} else if (precip > 30) {
		multiplier = 0.95; // -5% for light rain chance
		reason = `precip chance ${precip}% -- est. -5%`;
	}

	// Extreme temperature adjustments (stack with rain if applicable)
	if (tempHigh > 95) {
		const heatPenalty = tempHigh > 100 ? 0.90 : 0.95;
		multiplier *= heatPenalty;
		reason += `${reason ? ', ' : ''}extreme heat ${Math.round(tempHigh)}F -- est. ${Math.round((heatPenalty - 1) * 100)}%`;
	} else if (tempHigh < 32) {
		const coldPenalty = tempHigh < 20 ? 0.90 : 0.95;
		multiplier *= coldPenalty;
		reason += `${reason ? ', ' : ''}extreme cold ${Math.round(tempHigh)}F -- est. ${Math.round((coldPenalty - 1) * 100)}%`;
	}

	// Perfect weather boost (only if no adverse conditions)
	if (multiplier >= 1.0 && tempHigh >= 65 && tempHigh <= 80 && precip < 15) {
		const clearConditions = ['Clear', 'Clouds', 'Few clouds'];
		if (clearConditions.includes(condition)) {
			// Modest boost for ideal outdoor dining weather (Fri/Sat/Sun get more)
			const weekendBoost = [0, 5, 6].includes(dayOfWeek) ? 0.03 : 0.02;
			multiplier = 1 + weekendBoost;
			reason = `perfect weather ${Math.round(tempHigh)}F, ${desc} -- est. +${Math.round(weekendBoost * 100)}%`;
		}
	}

	if (!reason) {
		return { adjustedRevenue: 0, weatherNote: `Weather: ${Math.round(tempHigh)}F, ${desc} (neutral)`, impactMultiplier: 1.0 };
	}

	const adjustedRevenue = baselineRevenue * multiplier;
	const note = `Weather: ${Math.round(tempHigh)}F, ${desc} -- ${reason}`;
	return { adjustedRevenue, weatherNote: note, impactMultiplier: multiplier };
}

// ---------------------------------------------------------------------------
// Self-Learning Bias Correction (Enhanced)
// ---------------------------------------------------------------------------

export interface BiasResult {
	correctedRevenue: number;
	biasNote: string | null;
}

/**
 * Enhanced self-learning bias correction with:
 *   1. Per-DOW 8-week rolling bias tracking with recency weighting
 *   2. Regime detection: resets bias when revenue shifts >15%
 *   3. Confidence-adjusted learning: high-confidence misses get 2x weight
 */
export async function applyBiasCorrection(
	locationId: string,
	dayOfWeek: number,
	dayName: string,
	suggestedRevenue: number,
	forecastConfidence?: number,
): Promise<BiasResult> {
	const sb = getSupabase();

	// Step 1: Check for regime shift — if detected, skip bias correction
	const regimeShift = await detectRegimeShift(locationId);
	if (regimeShift) {
		return {
			correctedRevenue: suggestedRevenue,
			biasNote: `Regime shift detected (${regimeShift.direction} ${regimeShift.magnitude.toFixed(0)}%) -- bias correction reset`,
		};
	}

	// Step 2: Get 8-week rolling forecast errors for this DOW
	const { data: biasRows } = await sb
		.from('forecast_accuracy')
		.select('business_date, error_pct, forecast_confidence')
		.eq('location_id', locationId)
		.eq('day_of_week', dayOfWeek)
		.not('error_pct', 'is', null)
		.order('business_date', { ascending: false })
		.limit(8); // 8 weeks of same-DOW data

	if (!biasRows || biasRows.length < 2) {
		return { correctedRevenue: suggestedRevenue, biasNote: null };
	}

	// Step 3: Compute recency-weighted bias with confidence adjustment
	const RECENCY_DECAY = 0.9; // weight decreases 10% per week
	let weightedBias = 0;
	let totalWeight = 0;

	for (let i = 0; i < biasRows.length; i++) {
		const errorPct = Number(biasRows[i].error_pct);
		const recencyWeight = Math.pow(RECENCY_DECAY, i); // 0.9^weeks_ago

		// Confidence-adjusted learning weight
		const rowConfidence = biasRows[i].forecast_confidence != null
			? Number(biasRows[i].forecast_confidence)
			: 0.5;
		let confidenceWeight = 1.0;
		if (rowConfidence > 0.8 && Math.abs(errorPct) > 10) {
			// High-confidence misses are surprising -- learn faster
			confidenceWeight = 2.0;
		} else if (rowConfidence < 0.5) {
			// Low-confidence misses expected -- learn slower
			confidenceWeight = 0.5;
		}

		const compositeWeight = recencyWeight * confidenceWeight;
		weightedBias += errorPct * compositeWeight;
		totalWeight += compositeWeight;
	}

	if (totalWeight <= 0) {
		return { correctedRevenue: suggestedRevenue, biasNote: null };
	}

	const avgBias = weightedBias / totalWeight;

	// Only apply correction if bias exceeds threshold (3%)
	if (Math.abs(avgBias) > 3) {
		const dir = avgBias > 0 ? 'under' : 'over';
		const correction = 1 + avgBias / 100;
		// Clamp correction to +-15% to prevent runaway adjustments
		const clampedCorrection = Math.max(0.85, Math.min(1.15, correction));
		const correctedRevenue = Math.round(suggestedRevenue * clampedCorrection * 100) / 100;

		return {
			correctedRevenue,
			biasNote: `Self-learning: ${dir}-forecast ${dayName}s by ${Math.abs(avgBias).toFixed(1)}% (${biasRows.length}-wk rolling, recency-weighted) -- adjusting`,
		};
	}

	return { correctedRevenue: suggestedRevenue, biasNote: null };
}

// ---------------------------------------------------------------------------
// Regime Detection
// ---------------------------------------------------------------------------

interface RegimeShiftResult {
	direction: 'up' | 'down';
	magnitude: number;
}

/**
 * Compare last 4 weeks average revenue to prior 4 weeks.
 * If change > 15%, flag as regime shift and record in system_learnings.
 */
async function detectRegimeShift(
	locationId: string,
): Promise<RegimeShiftResult | null> {
	const sb = getSupabase();
	const today = new Date();

	const fourWeeksAgo = new Date(today);
	fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
	const eightWeeksAgo = new Date(today);
	eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

	const [{ data: recentRows }, { data: priorRows }] = await Promise.all([
		sb
			.from('daily_actuals')
			.select('revenue')
			.eq('location_id', locationId)
			.gte('business_date', fourWeeksAgo.toISOString().split('T')[0])
			.lt('business_date', today.toISOString().split('T')[0])
			.gt('revenue', 0),
		sb
			.from('daily_actuals')
			.select('revenue')
			.eq('location_id', locationId)
			.gte('business_date', eightWeeksAgo.toISOString().split('T')[0])
			.lt('business_date', fourWeeksAgo.toISOString().split('T')[0])
			.gt('revenue', 0),
	]);

	if (!recentRows || !priorRows || recentRows.length < 7 || priorRows.length < 7) {
		return null;
	}

	const recentAvg = recentRows.reduce((s, r) => s + Number(r.revenue), 0) / recentRows.length;
	const priorAvg = priorRows.reduce((s, r) => s + Number(r.revenue), 0) / priorRows.length;

	if (priorAvg <= 0) return null;

	const changePct = ((recentAvg - priorAvg) / priorAvg) * 100;

	if (Math.abs(changePct) > 15) {
		// Record regime change in system_learnings (non-blocking)
		try {
			const { getSupabaseService } = await import('$lib/server/supabase');
			const sbService = getSupabaseService();
			await sbService.from('system_learnings').insert({
				location_id: locationId,
				category: 'forecast',
				learning: `Regime shift detected: ${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}% avg revenue change (4-wk vs prior 4-wk). Bias correction reset.`,
				source: 'regime_detector',
				confidence: 0.8,
			});
		} catch {
			// Non-critical
		}

		return {
			direction: changePct > 0 ? 'up' : 'down',
			magnitude: Math.abs(changePct),
		};
	}

	return null;
}

// ---------------------------------------------------------------------------
// Override Tag Impact Learning
// ---------------------------------------------------------------------------

/**
 * Analyze historical override tags to learn their revenue impact on a given DOW.
 * Returns trend notes like: '"Holiday" on Fridays: +12% avg revenue impact (3 occurrences)'
 */
export async function learnOverrideTagImpacts(
	locationId: string,
	dayOfWeek: number,
	dayName: string,
	baselineRevenue: number,
): Promise<string[]> {
	const sb = getSupabase();
	const notes: string[] = [];

	const { data: taggedOverrides } = await sb
		.from('daily_forecasts')
		.select('business_date, override_tags, manager_revenue')
		.eq('location_id', locationId)
		.eq('is_override', true)
		.not('override_tags', 'is', null)
		.order('business_date', { ascending: false })
		.limit(50);

	if (!taggedOverrides || taggedOverrides.length === 0) return notes;

	const sameDowTagged = taggedOverrides.filter((row) => {
		const d = new Date(row.business_date + 'T12:00:00');
		return d.getDay() === dayOfWeek && row.override_tags && row.override_tags.length > 0;
	});

	if (sameDowTagged.length === 0) return notes;

	const tagImpacts: Record<string, { totalPctChange: number; count: number }> = {};

	for (const row of sameDowTagged) {
		const { data: actual } = await sb
			.from('daily_actuals')
			.select('revenue')
			.eq('location_id', locationId)
			.eq('business_date', row.business_date)
			.maybeSingle();

		if (!actual?.revenue || actual.revenue <= 0) continue;

		const baseline = baselineRevenue > 0 ? baselineRevenue : actual.revenue;
		const pctChange = baseline > 0 ? ((actual.revenue - baseline) / baseline) * 100 : 0;

		for (const tag of row.override_tags as string[]) {
			const normalizedTag = tag.startsWith('Other:') ? 'Other' : tag;
			if (!tagImpacts[normalizedTag]) tagImpacts[normalizedTag] = { totalPctChange: 0, count: 0 };
			tagImpacts[normalizedTag].totalPctChange += pctChange;
			tagImpacts[normalizedTag].count += 1;
		}
	}

	for (const [tag, impact] of Object.entries(tagImpacts)) {
		if (impact.count >= 1) {
			const avgPct = impact.totalPctChange / impact.count;
			if (Math.abs(avgPct) > 5) {
				const dir = avgPct > 0 ? '+' : '';
				notes.push(
					`"${tag}" on ${dayName}s: ${dir}${avgPct.toFixed(0)}% avg revenue impact (${impact.count} occurrence${impact.count > 1 ? 's' : ''})`,
				);
			}
		}
	}

	return notes;
}

/**
 * Learn weather impact coefficients from the last 90 days of joined
 * weather + actuals data. Groups by condition category and DOW, then
 * compares revenue to non-weather-affected baseline.
 */
async function getLearnedWeatherCoefficient(
	locationId: string,
	dayOfWeek: number,
	condition: string,
	tempHigh: number,
	precipPct: number,
): Promise<number | null> {
	const sb = getSupabase();
	const ninetyDaysAgo = new Date();
	ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
	const since = ninetyDaysAgo.toISOString().split('T')[0];

	// Get weather + actuals for same DOW in last 90 days
	const { data: weatherRows } = await sb
		.from('daily_weather')
		.select('business_date, condition, temp_high, precipitation_pct')
		.eq('location_id', locationId)
		.gte('business_date', since);

	if (!weatherRows || weatherRows.length < 7) return null;

	const { data: actualsRows } = await sb
		.from('daily_actuals')
		.select('business_date, revenue')
		.eq('location_id', locationId)
		.gte('business_date', since)
		.gt('revenue', 0);

	if (!actualsRows || actualsRows.length < 14) return null;

	// Build a date-keyed map of actuals
	const actualsMap = new Map<string, number>();
	for (const r of actualsRows) {
		actualsMap.set(r.business_date, Number(r.revenue));
	}

	// Separate same-DOW days into "similar condition" vs "clear baseline"
	const similarDays: number[] = [];
	const clearDays: number[] = [];

	const isTargetAdverse = ['Rain', 'Thunderstorm', 'Drizzle', 'Snow', 'Sleet', 'Squall'].includes(condition)
		|| precipPct > 40 || tempHigh > 95 || tempHigh < 32;

	for (const wr of weatherRows) {
		const wDate = new Date(wr.business_date + 'T12:00:00');
		if (wDate.getDay() !== dayOfWeek) continue;

		const rev = actualsMap.get(wr.business_date);
		if (!rev || rev <= 0) continue;

		const wCondition = wr.condition || 'Clear';
		const wPrecip = Number(wr.precipitation_pct) || 0;
		const wTemp = Number(wr.temp_high) || 70;
		const isAdverse = ['Rain', 'Thunderstorm', 'Drizzle', 'Snow', 'Sleet', 'Squall'].includes(wCondition)
			|| wPrecip > 40 || wTemp > 95 || wTemp < 32;

		if (isTargetAdverse && isAdverse) {
			similarDays.push(rev);
		} else if (!isAdverse) {
			clearDays.push(rev);
		}
	}

	// Need at least 3 similar-condition days and 3 clear days to compute coefficient
	if (similarDays.length < 3 || clearDays.length < 3) return null;

	const avgSimilar = similarDays.reduce((a, b) => a + b, 0) / similarDays.length;
	const avgClear = clearDays.reduce((a, b) => a + b, 0) / clearDays.length;

	if (avgClear <= 0) return null;

	const coefficient = avgSimilar / avgClear;
	// Clamp between 0.70 and 1.15
	return Math.max(0.70, Math.min(1.15, coefficient));
}
