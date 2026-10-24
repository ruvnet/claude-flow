/**
 * Labor Projection Engine
 *
 * Distributes weekly threshold labor dollars to daily targets using DOW weights,
 * and adapts those weights over time based on actual labor patterns.
 *
 * Flow:
 * 1. Manager accepts daily forecasts -> weekly revenue sum
 * 2. Weekly revenue -> threshold bracket lookup -> weekly labor $ per position
 * 3. Weekly position labor $ -> distributed to daily using DOW weights
 * 4. Daily totals reconcile to weekly total (guaranteed by normalization)
 */

import { getSupabaseService } from '$lib/server/supabase';
import { recordLearning } from '$lib/server/domain/record-learning';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WeeklyLaborResult {
	weekStartDate: string;
	weekEndDate: string;
	weekForecastTotal: number;
	acceptedDaysCount: number;
	isWeekComplete: boolean;
	bracketUsed: string | null;
	targetsGenerated: number;
	positionSummaries: PositionWeekSummary[];
}

interface PositionWeekSummary {
	position: string;
	weeklyLaborDollars: number;
	dailyBreakdown: { date: string; dayOfWeek: number; dollars: number; weight: number }[];
}

export interface WeightAdaptationResult {
	locationId: string;
	positionsUpdated: number;
	weeksAnalyzed: number;
	changes: { position: string; dayOfWeek: number; oldWeight: number; newWeight: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get Monday-Sunday date range for the week containing the given date. */
function getWeekBounds(date: string): { monday: Date; sunday: Date; weekDates: string[] } {
	const target = new Date(date + 'T12:00:00');
	const dow = target.getDay();
	const mondayOffset = dow === 0 ? -6 : 1 - dow;
	const monday = new Date(target);
	monday.setDate(monday.getDate() + mondayOffset);
	const sunday = new Date(monday);
	sunday.setDate(sunday.getDate() + 6);

	const weekDates: string[] = [];
	for (let d = new Date(monday); d <= sunday; d.setDate(d.getDate() + 1)) {
		weekDates.push(d.toISOString().split('T')[0]);
	}

	return { monday, sunday, weekDates };
}

function toDateStr(d: Date): string {
	return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Core: Calculate Weekly Labor Targets
// ---------------------------------------------------------------------------

/**
 * Given a location and a week start date, recalculate daily labor targets
 * for every position by:
 *   1. Summing accepted daily forecasts for the week
 *   2. Looking up the matching threshold bracket
 *   3. Distributing weekly labor $ to daily using DOW weights
 *   4. Upserting into daily_labor_targets
 *
 * Works with partial weeks (some days not yet accepted) but flags incomplete.
 */
export async function calculateWeeklyLaborTargets(
	locationId: string,
	weekStartDate: string,
): Promise<WeeklyLaborResult> {
	const sb = getSupabaseService();
	const { weekDates } = getWeekBounds(weekStartDate);
	const mondayStr = weekDates[0];
	const sundayStr = weekDates[6];

	// 1. Get accepted forecasts for this week
	const { data: weekForecasts } = await sb
		.from('daily_forecasts')
		.select('business_date, manager_revenue')
		.eq('location_id', locationId)
		.in('business_date', weekDates)
		.not('manager_revenue', 'is', null);

	const acceptedDays = weekForecasts || [];
	const acceptedTotal = acceptedDays.reduce((s, f) => s + (f.manager_revenue || 0), 0);
	const isWeekComplete = acceptedDays.length === 7;

	if (acceptedTotal <= 0) {
		return {
			weekStartDate: mondayStr,
			weekEndDate: sundayStr,
			weekForecastTotal: 0,
			acceptedDaysCount: acceptedDays.length,
			isWeekComplete,
			bracketUsed: null,
			targetsGenerated: 0,
			positionSummaries: [],
		};
	}

	// Extrapolate to a full-week estimate when only some days are accepted.
	// This prevents partial weeks from landing in the wrong (too low) bracket.
	const weekEstimate = isWeekComplete
		? acceptedTotal
		: (acceptedTotal / acceptedDays.length) * 7;

	// 2. Find matching threshold bracket (use extrapolated estimate for lookup)
	const { data: exactMatch } = await sb
		.from('labor_thresholds')
		.select('*')
		.eq('location_id', locationId)
		.lte('revenue_bracket_low', weekEstimate)
		.gt('revenue_bracket_high', weekEstimate);

	let thresholds = exactMatch;
	if (!thresholds || thresholds.length === 0) {
		// Closest bracket fallback (using extrapolated estimate)
		const { data: allBrackets } = await sb
			.from('labor_thresholds')
			.select('*')
			.eq('location_id', locationId)
			.order('revenue_bracket_low', { ascending: true });

		if (allBrackets && allBrackets.length > 0) {
			const closest = allBrackets.reduce((prev, curr) => {
				const prevMid = (prev.revenue_bracket_low + prev.revenue_bracket_high) / 2;
				const currMid = (curr.revenue_bracket_low + curr.revenue_bracket_high) / 2;
				return Math.abs(currMid - weekEstimate) < Math.abs(prevMid - weekEstimate) ? curr : prev;
			});
			thresholds = allBrackets.filter(
				(t) => t.revenue_bracket_low === closest.revenue_bracket_low,
			);
		}
	}

	if (!thresholds || thresholds.length === 0) {
		return {
			weekStartDate: mondayStr,
			weekEndDate: sundayStr,
			weekForecastTotal: weekEstimate,
			acceptedDaysCount: acceptedDays.length,
			isWeekComplete,
			bracketUsed: null,
			targetsGenerated: 0,
			positionSummaries: [],
		};
	}

	const bracketLabel =
		`$${Math.round(thresholds[0].revenue_bracket_low).toLocaleString()} - ` +
		`$${Math.round(thresholds[0].revenue_bracket_high).toLocaleString()}` +
		(isWeekComplete ? '' : ' (estimated)');

	// 3. Get DOW weights
	const { data: weights } = await sb
		.from('dow_weights')
		.select('*')
		.eq('location_id', locationId);

	const weightMap: Record<string, Record<number, number>> = {};
	for (const w of weights || []) {
		if (!weightMap[w.position]) weightMap[w.position] = {};
		weightMap[w.position][w.day_of_week] = Number(w.weight);
	}

	// Build a revenue-by-date map for labor % calculation
	const revenueByDate: Record<string, number> = {};
	for (const f of acceptedDays) {
		revenueByDate[f.business_date] = f.manager_revenue || 0;
	}

	// 4. Distribute weekly labor $ to daily for each position
	const targets: {
		location_id: string;
		business_date: string;
		position: string;
		projected_labor_dollars: number;
		projected_labor_pct: number;
		threshold_bracket_used: string;
		week_forecast_total: number;
	}[] = [];

	const positionSummaries: PositionWeekSummary[] = [];

	for (const threshold of thresholds) {
		const position = threshold.position;
		const weeklyLabor = threshold.weekly_labor_dollars;
		const posWeights = weightMap[position] || {};

		// Sum weights for normalization (guarantees daily totals = weekly total)
		const totalWeight = weekDates.reduce((s, d) => {
			const dateDow = new Date(d + 'T12:00:00').getDay();
			return s + (posWeights[dateDow] ?? 1 / 7);
		}, 0);

		const dailyBreakdown: PositionWeekSummary['dailyBreakdown'] = [];

		for (const d of weekDates) {
			const dateDow = new Date(d + 'T12:00:00').getDay();
			const dayWeight = posWeights[dateDow] ?? 1 / 7;
			const dailyLabor = (weeklyLabor * dayWeight) / totalWeight;
			const dayRevenue = revenueByDate[d] || weekEstimate / 7;
			const laborPct = dayRevenue > 0 ? dailyLabor / dayRevenue : 0;

			targets.push({
				location_id: locationId,
				business_date: d,
				position,
				projected_labor_dollars: Math.round(dailyLabor * 100) / 100,
				projected_labor_pct: Math.round(laborPct * 10000) / 10000,
				threshold_bracket_used: bracketLabel,
				week_forecast_total: weekEstimate,
			});

			dailyBreakdown.push({
				date: d,
				dayOfWeek: dateDow,
				dollars: Math.round(dailyLabor * 100) / 100,
				weight: Math.round((dayWeight / totalWeight) * 10000) / 10000,
			});
		}

		positionSummaries.push({ position, weeklyLaborDollars: weeklyLabor, dailyBreakdown });
	}

	// 5. Upsert all targets
	if (targets.length > 0) {
		await sb.from('daily_labor_targets').upsert(targets, {
			onConflict: 'location_id,business_date,position',
		});
	}

	return {
		weekStartDate: mondayStr,
		weekEndDate: sundayStr,
		weekForecastTotal: weekEstimate,
		acceptedDaysCount: acceptedDays.length,
		isWeekComplete,
		bracketUsed: bracketLabel,
		targetsGenerated: targets.length,
		positionSummaries,
	};
}

// ---------------------------------------------------------------------------
// Core: Adapt DOW Weights from Actuals
// ---------------------------------------------------------------------------

/**
 * Looks at the last 4 weeks of actual labor patterns and blends them with
 * current weights to gradually shift allocation toward reality.
 *
 * For each position:
 *   1. Get actual labor $ by DOW for the last 28 days
 *   2. Calculate actual DOW distribution (% of weekly labor per day)
 *   3. Blend: new_weight = 0.7 * current_weight + 0.3 * actual_distribution
 *   4. Normalize to sum to 1.0
 *   5. Update dow_weights table
 */
export async function adaptDOWWeights(
	locationId: string,
): Promise<WeightAdaptationResult> {
	const sb = getSupabaseService();

	const today = new Date();
	const fourWeeksAgo = new Date(today);
	fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

	// Get actual labor data grouped by position and day of week
	const { data: laborRows } = await sb
		.from('daily_labor')
		.select('business_date, mapped_position, labor_dollars')
		.eq('location_id', locationId)
		.gte('business_date', toDateStr(fourWeeksAgo))
		.lte('business_date', toDateStr(today))
		.gt('labor_dollars', 0);

	if (!laborRows || laborRows.length === 0) {
		return { locationId, positionsUpdated: 0, weeksAnalyzed: 0, changes: [] };
	}

	// Group by position, then by DOW
	const positionDowTotals: Record<string, Record<number, number>> = {};
	const positionWeeklyTotals: Record<string, number> = {};

	for (const row of laborRows) {
		const pos = row.mapped_position;
		const dow = new Date(row.business_date + 'T12:00:00').getDay();
		const dollars = Number(row.labor_dollars);

		if (!positionDowTotals[pos]) positionDowTotals[pos] = {};
		positionDowTotals[pos][dow] = (positionDowTotals[pos][dow] || 0) + dollars;
		positionWeeklyTotals[pos] = (positionWeeklyTotals[pos] || 0) + dollars;
	}

	// Count distinct weeks for reporting
	const distinctWeeks = new Set(
		laborRows.map((r) => {
			const d = new Date(r.business_date + 'T12:00:00');
			const dow = d.getDay();
			const mondayOffset = dow === 0 ? -6 : 1 - dow;
			const monday = new Date(d);
			monday.setDate(monday.getDate() + mondayOffset);
			return toDateStr(monday);
		}),
	);

	// Get current weights
	const { data: currentWeights } = await sb
		.from('dow_weights')
		.select('*')
		.eq('location_id', locationId);

	const currentMap: Record<string, Record<number, number>> = {};
	for (const w of currentWeights || []) {
		if (!currentMap[w.position]) currentMap[w.position] = {};
		currentMap[w.position][w.day_of_week] = Number(w.weight);
	}

	// 60/40 blend (was 70/30) — adapts to actual patterns in ~6 weeks instead of 3+ months
	const BLEND_CURRENT = 0.6;
	const BLEND_ACTUAL = 0.4;
	const changes: WeightAdaptationResult['changes'] = [];
	const upserts: { location_id: string; position: string; day_of_week: number; weight: number }[] = [];

	for (const [position, dowTotals] of Object.entries(positionDowTotals)) {
		const weeklyTotal = positionWeeklyTotals[position] || 0;
		if (weeklyTotal <= 0) continue;

		const curWeights = currentMap[position] || {};

		// Calculate actual distribution
		const actualDist: Record<number, number> = {};
		for (let dow = 0; dow < 7; dow++) {
			actualDist[dow] = (dowTotals[dow] || 0) / weeklyTotal;
		}

		// Blend with current weights
		const blended: Record<number, number> = {};
		let blendedSum = 0;
		for (let dow = 0; dow < 7; dow++) {
			const current = curWeights[dow] ?? 1 / 7;
			const actual = actualDist[dow] ?? 0;
			blended[dow] = BLEND_CURRENT * current + BLEND_ACTUAL * actual;
			blendedSum += blended[dow];
		}

		// Normalize to sum to 1.0
		for (let dow = 0; dow < 7; dow++) {
			const normalized = blendedSum > 0
				? Math.round((blended[dow] / blendedSum) * 10000) / 10000
				: Math.round((1 / 7) * 10000) / 10000;

			const oldWeight = curWeights[dow] ?? 1 / 7;
			if (Math.abs(normalized - oldWeight) > 0.001) {
				changes.push({
					position,
					dayOfWeek: dow,
					oldWeight: Math.round(oldWeight * 10000) / 10000,
					newWeight: normalized,
				});
			}

			upserts.push({
				location_id: locationId,
				position,
				day_of_week: dow,
				weight: normalized,
			});
		}
	}

	// Batch upsert
	if (upserts.length > 0) {
		await sb.from('dow_weights').upsert(upserts, {
			onConflict: 'location_id,position,day_of_week',
		});
	}

	// Record significant changes as system learnings
	const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	for (const change of changes) {
		const pctShift = Math.abs(change.newWeight - change.oldWeight) * 100;
		if (pctShift >= 0.5) {
			const dir = change.newWeight > change.oldWeight ? 'increased' : 'decreased';
			await recordLearning({
				locationId,
				category: 'labor',
				learning: `${change.position} DOW weight for ${dayNames[change.dayOfWeek]} ${dir} from ${(change.oldWeight * 100).toFixed(1)}% to ${(change.newWeight * 100).toFixed(1)}% based on ${distinctWeeks.size}-week actuals`,
				source: 'dow_weight_adapter',
				confidence: Math.min(0.5 + distinctWeeks.size * 0.1, 0.95),
			});
		}
	}

	return {
		locationId,
		positionsUpdated: Object.keys(positionDowTotals).length,
		weeksAnalyzed: distinctWeeks.size,
		changes,
	};
}

// ---------------------------------------------------------------------------
// Query helpers (for API)
// ---------------------------------------------------------------------------

/** Get current DOW weights and threshold info for a location. */
export async function getDOWWeightsAndThresholds(
	locationId: string,
	date?: string,
): Promise<{
	weights: Record<string, { dayOfWeek: number; weight: number }[]>;
	thresholds: { bracketLow: number; bracketHigh: number; position: string; weeklyLabor: number }[];
}> {
	const sb = getSupabaseService();

	const { data: weights } = await sb
		.from('dow_weights')
		.select('position, day_of_week, weight')
		.eq('location_id', locationId)
		.order('position')
		.order('day_of_week');

	const weightsByPosition: Record<string, { dayOfWeek: number; weight: number }[]> = {};
	for (const w of weights || []) {
		if (!weightsByPosition[w.position]) weightsByPosition[w.position] = [];
		weightsByPosition[w.position].push({
			dayOfWeek: w.day_of_week,
			weight: Number(w.weight),
		});
	}

	const { data: thresholds } = await sb
		.from('labor_thresholds')
		.select('revenue_bracket_low, revenue_bracket_high, position, weekly_labor_dollars')
		.eq('location_id', locationId)
		.order('revenue_bracket_low')
		.order('position');

	return {
		weights: weightsByPosition,
		thresholds: (thresholds || []).map((t) => ({
			bracketLow: t.revenue_bracket_low,
			bracketHigh: t.revenue_bracket_high,
			position: t.position,
			weeklyLabor: t.weekly_labor_dollars,
		})),
	};
}

// ---------------------------------------------------------------------------
// Adaptive Scheduling: Hourly Staffing Curves
// ---------------------------------------------------------------------------

export interface HourlyStaffingRecommendation {
	hour: number;
	revenueShare: number;
	recommendedStaff: Record<string, number>;
}

/**
 * Build hourly revenue distribution for a DOW, then recommend shift
 * start/end times and headcount by position based on when revenue peaks.
 *
 * Queries daily_hourly_sales for last 8 weeks of the same DOW.
 */
export async function hourlyStaffingCurves(
	locationId: string,
	dayOfWeek: number,
): Promise<HourlyStaffingRecommendation[]> {
	const sb = getSupabaseService();

	// Find last 8 same-DOW dates
	const today = new Date();
	const targetDates: string[] = [];
	const cursor = new Date(today);
	cursor.setDate(cursor.getDate() - 1);
	while (targetDates.length < 8) {
		if (cursor.getDay() === dayOfWeek) {
			targetDates.push(cursor.toISOString().split('T')[0]);
		}
		cursor.setDate(cursor.getDate() - 1);
		if (today.getTime() - cursor.getTime() > 120 * 86400000) break;
	}

	if (targetDates.length === 0) return [];

	// Get hourly revenue data
	const { data: hourlyData } = await sb
		.from('daily_hourly_sales')
		.select('business_date, hour_of_day, revenue')
		.eq('location_id', locationId)
		.in('business_date', targetDates)
		.gt('revenue', 0);

	if (!hourlyData || hourlyData.length === 0) return [];

	// Compute average daily totals and per-hour percentages
	const dailyTotals = new Map<string, number>();
	for (const row of hourlyData) {
		const curr = dailyTotals.get(row.business_date) || 0;
		dailyTotals.set(row.business_date, curr + (row.revenue || 0));
	}

	const hourPcts = new Map<number, { totalPct: number; count: number }>();
	for (let h = 0; h < 24; h++) hourPcts.set(h, { totalPct: 0, count: 0 });

	const sampleDays = dailyTotals.size;
	for (const row of hourlyData) {
		const dayTotal = dailyTotals.get(row.business_date) || 0;
		if (dayTotal <= 0) continue;
		const entry = hourPcts.get(row.hour_of_day)!;
		entry.totalPct += (row.revenue || 0) / dayTotal;
		entry.count += 1;
	}

	// Get position staffing levels from labor_thresholds (use median bracket)
	const { data: thresholds } = await sb
		.from('labor_thresholds')
		.select('position, weekly_labor_dollars')
		.eq('location_id', locationId)
		.order('revenue_bracket_low', { ascending: true });

	// Get unique positions and approximate hourly staff
	const positions = new Set<string>();
	const positionDailyBudget: Record<string, number> = {};
	if (thresholds && thresholds.length > 0) {
		for (const t of thresholds) {
			positions.add(t.position);
			// Use weekly / 7 as daily budget baseline
			if (!positionDailyBudget[t.position]) {
				positionDailyBudget[t.position] = t.weekly_labor_dollars / 7;
			}
		}
	}

	// Get average hourly wage for rough headcount estimates
	const { data: laborRows } = await sb
		.from('daily_labor')
		.select('mapped_position, labor_dollars, regular_hours')
		.eq('location_id', locationId)
		.gte('business_date', targetDates[targetDates.length - 1])
		.gt('regular_hours', 0)
		.limit(200);

	const avgHourlyWage: Record<string, number> = {};
	if (laborRows) {
		const posWages: Record<string, { totalDollars: number; totalHours: number }> = {};
		for (const row of laborRows) {
			const pos = row.mapped_position as string;
			if (!posWages[pos]) posWages[pos] = { totalDollars: 0, totalHours: 0 };
			posWages[pos].totalDollars += Number(row.labor_dollars) || 0;
			posWages[pos].totalHours += Number(row.regular_hours) || 0;
		}
		for (const [pos, data] of Object.entries(posWages)) {
			avgHourlyWage[pos] = data.totalHours > 0 ? data.totalDollars / data.totalHours : 20;
		}
	}

	// Build recommendations
	const recommendations: HourlyStaffingRecommendation[] = [];
	for (let h = 0; h < 24; h++) {
		const entry = hourPcts.get(h)!;
		const revenueShare = sampleDays > 0 ? entry.totalPct / sampleDays : 0;

		if (revenueShare < 0.01) continue; // Skip dead hours

		const recommendedStaff: Record<string, number> = {};
		for (const pos of positions) {
			const dailyBudget = positionDailyBudget[pos] || 0;
			const hourlyBudget = dailyBudget * revenueShare;
			const wage = avgHourlyWage[pos] || 20;
			const headcount = Math.max(1, Math.round(hourlyBudget / wage));
			recommendedStaff[pos] = headcount;
		}

		recommendations.push({ hour: h, revenueShare: Math.round(revenueShare * 10000) / 10000, recommendedStaff });
	}

	return recommendations;
}

// ---------------------------------------------------------------------------
// Adaptive Scheduling: Revenue Per Labor Hour Tracking
// ---------------------------------------------------------------------------

export interface RplhResult {
	position: string;
	currentRplh: number;
	priorRplh: number;
	trendPct: number;
	isFlagged: boolean;
}

/**
 * For each position, compute Revenue Per Labor Hour (RPLH) and track its trend.
 * Flags positions where RPLH is declining >10% period-over-period.
 *
 * @param locationId - Location to analyze
 * @param periodDays - Number of days per period (default 14)
 */
export async function revenuePerLaborHour(
	locationId: string,
	periodDays: number = 14,
): Promise<RplhResult[]> {
	const sb = getSupabaseService();
	const today = new Date();

	const currentEnd = today.toISOString().split('T')[0];
	const currentStart = new Date(today);
	currentStart.setDate(currentStart.getDate() - periodDays);
	const priorStart = new Date(currentStart);
	priorStart.setDate(priorStart.getDate() - periodDays);

	// Get revenue totals for both periods
	const [{ data: currentActuals }, { data: priorActuals }] = await Promise.all([
		sb
			.from('daily_actuals')
			.select('revenue')
			.eq('location_id', locationId)
			.gte('business_date', currentStart.toISOString().split('T')[0])
			.lt('business_date', currentEnd)
			.gt('revenue', 0),
		sb
			.from('daily_actuals')
			.select('revenue')
			.eq('location_id', locationId)
			.gte('business_date', priorStart.toISOString().split('T')[0])
			.lt('business_date', currentStart.toISOString().split('T')[0])
			.gt('revenue', 0),
	]);

	const currentRevenue = (currentActuals || []).reduce((s, r) => s + Number(r.revenue), 0);
	const priorRevenue = (priorActuals || []).reduce((s, r) => s + Number(r.revenue), 0);

	// Get labor hours by position for both periods
	const [{ data: currentLabor }, { data: priorLabor }] = await Promise.all([
		sb
			.from('daily_labor')
			.select('mapped_position, regular_hours, overtime_hours')
			.eq('location_id', locationId)
			.gte('business_date', currentStart.toISOString().split('T')[0])
			.lt('business_date', currentEnd)
			.gt('regular_hours', 0),
		sb
			.from('daily_labor')
			.select('mapped_position, regular_hours, overtime_hours')
			.eq('location_id', locationId)
			.gte('business_date', priorStart.toISOString().split('T')[0])
			.lt('business_date', currentStart.toISOString().split('T')[0])
			.gt('regular_hours', 0),
	]);

	// Aggregate hours by position
	const sumHours = (rows: any[] | null): Record<string, number> => {
		const result: Record<string, number> = {};
		for (const row of rows || []) {
			const pos = row.mapped_position as string;
			const hours = (Number(row.regular_hours) || 0) + (Number(row.overtime_hours) || 0);
			result[pos] = (result[pos] || 0) + hours;
		}
		return result;
	};

	const currentHours = sumHours(currentLabor);
	const priorHours = sumHours(priorLabor);

	const allPositions = new Set([...Object.keys(currentHours), ...Object.keys(priorHours)]);
	const results: RplhResult[] = [];

	for (const position of allPositions) {
		const currH = currentHours[position] || 0;
		const priorH = priorHours[position] || 0;

		const currRplh = currH > 0 ? currentRevenue / currH : 0;
		const priorRplh = priorH > 0 ? priorRevenue / priorH : 0;

		const trendPct = priorRplh > 0 ? ((currRplh - priorRplh) / priorRplh) * 100 : 0;
		const isFlagged = trendPct < -10; // declining >10%

		results.push({
			position,
			currentRplh: Math.round(currRplh * 100) / 100,
			priorRplh: Math.round(priorRplh * 100) / 100,
			trendPct: Math.round(trendPct * 10) / 10,
			isFlagged,
		});
	}

	// Sort flagged items first, then by declining trend
	results.sort((a, b) => {
		if (a.isFlagged !== b.isFlagged) return a.isFlagged ? -1 : 1;
		return a.trendPct - b.trendPct;
	});

	return results;
}

// ---------------------------------------------------------------------------
// Adaptive Scheduling: Predictive Overtime Alerts
// ---------------------------------------------------------------------------

export interface OvertimeAlert {
	employeeName: string;
	employeeId: string;
	currentHours: number;
	projectedHours: number;
	overtimeThreshold: number;
	projectedOvertime: number;
	remainingBudgetHours: number;
	severity: 'warning' | 'critical';
}

/**
 * For each employee, sum scheduled + actual hours through current day,
 * project remaining days using average daily hours, and alert if projected
 * total exceeds overtime threshold (typically 40 hours/week).
 */
export async function predictiveOvertimeAlerts(
	locationId: string,
	weekStartDate: string,
): Promise<OvertimeAlert[]> {
	const sb = getSupabaseService();
	const { weekDates } = getWeekBounds(weekStartDate);
	const today = new Date().toISOString().split('T')[0];

	// Determine which days have passed vs. remaining
	const pastDates = weekDates.filter((d) => d <= today);
	const futureDates = weekDates.filter((d) => d > today);

	if (pastDates.length === 0) return []; // Week hasn't started

	// Get employees for this location
	const { data: employees } = await sb
		.from('employees')
		.select('id, name, overtime_threshold')
		.eq('location_id', locationId)
		.eq('active', true);

	if (!employees || employees.length === 0) return [];

	// Get actual labor hours so far this week (from daily_labor, grouped by employee)
	const { data: laborRows } = await sb
		.from('daily_labor')
		.select('employee_name, regular_hours, overtime_hours, business_date')
		.eq('location_id', locationId)
		.in('business_date', pastDates)
		.gt('regular_hours', 0);

	// Get scheduled shifts for remaining days
	const { data: scheduledShifts } = await sb
		.from('scheduled_shifts')
		.select('employee_name, scheduled_hours, business_date')
		.eq('location_id', locationId)
		.in('business_date', futureDates);

	// Aggregate actual hours by employee
	const actualHours: Record<string, number> = {};
	for (const row of laborRows || []) {
		const name = row.employee_name as string;
		const hours = (Number(row.regular_hours) || 0) + (Number(row.overtime_hours) || 0);
		actualHours[name] = (actualHours[name] || 0) + hours;
	}

	// Aggregate scheduled hours by employee
	const scheduledHours: Record<string, number> = {};
	for (const row of scheduledShifts || []) {
		const name = row.employee_name as string;
		scheduledHours[name] = (scheduledHours[name] || 0) + (Number(row.scheduled_hours) || 0);
	}

	const alerts: OvertimeAlert[] = [];

	for (const emp of employees) {
		const name = emp.name as string;
		const threshold = Number(emp.overtime_threshold) || 40;
		const currentHrs = actualHours[name] || 0;
		const schedHrs = scheduledHours[name] || 0;

		// Project: actual hours so far + scheduled remaining
		// If no schedule data, estimate from average daily hours
		let projectedTotal: number;
		if (schedHrs > 0) {
			projectedTotal = currentHrs + schedHrs;
		} else if (pastDates.length > 0 && currentHrs > 0) {
			const avgDailyHours = currentHrs / pastDates.length;
			projectedTotal = currentHrs + avgDailyHours * futureDates.length;
		} else {
			continue; // No data to project from
		}

		const projectedOvertime = Math.max(0, projectedTotal - threshold);

		if (projectedOvertime > 0) {
			const severity = projectedOvertime > 5 ? 'critical' : 'warning';
			alerts.push({
				employeeName: name,
				employeeId: emp.id,
				currentHours: Math.round(currentHrs * 10) / 10,
				projectedHours: Math.round(projectedTotal * 10) / 10,
				overtimeThreshold: threshold,
				projectedOvertime: Math.round(projectedOvertime * 10) / 10,
				remainingBudgetHours: Math.round(Math.max(0, threshold - currentHrs) * 10) / 10,
				severity,
			});
		}
	}

	// Sort critical first, then by projected overtime descending
	alerts.sort((a, b) => {
		if (a.severity !== b.severity) return a.severity === 'critical' ? -1 : 1;
		return b.projectedOvertime - a.projectedOvertime;
	});

	return alerts;
}
