/** Labor Forecast Enhancements — 6 advisory signals that VALIDATE and CHALLENGE staffing assumptions. */

import { getSupabase } from '$lib/server/supabase';
import { getHourlyCurve } from './hourly-curves';

export interface LaborEnhancementResult {
	adjustmentSignals: LaborSignal[];
	reasoning: string[];
	components: {
		productivityCurve: LaborSignal | null;
		taskBasedSignals: LaborSignal | null;
		patioStaffing: LaborSignal | null;
		calloutPrediction: LaborSignal | null;
		rplhOptimization: LaborSignal | null;
		breakScheduling: LaborSignal | null;
	};
}

export interface LaborSignal {
	type: string;
	headcountDelta: number;            // +1 = add 1 person, -1 = reduce 1
	positions?: string[];              // affected positions
	timeRange?: { start: number; end: number }; // hour range (24h format)
	confidence: number;                // 0-1
	reasoning: string;
}

/** 8. Labor Productivity Curves — detect long shifts with productivity decay. */
async function computeProductivityCurve(
	locationId: string,
	targetDate: string,
): Promise<LaborSignal | null> {
	const sb = getSupabase();

	const thirtyDaysAgo = new Date(targetDate + 'T12:00:00');
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	// Get average shift lengths by position
	const { data: laborRows } = await sb
		.from('daily_labor')
		.select('mapped_position, regular_hours, overtime_hours, labor_dollars')
		.eq('location_id', locationId)
		.gte('business_date', thirtyDaysAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('regular_hours', 0);

	if (!laborRows || laborRows.length < 10) return null;

	// Compute avg shift length and overtime frequency by position
	const posStats: Record<string, { totalHours: number; otHours: number; count: number; dollars: number }> = {};
	for (const row of laborRows) {
		const pos = row.mapped_position as string;
		if (!posStats[pos]) posStats[pos] = { totalHours: 0, otHours: 0, count: 0, dollars: 0 };
		const regular = Number(row.regular_hours) || 0;
		const ot = Number(row.overtime_hours) || 0;
		posStats[pos].totalHours += regular + ot;
		posStats[pos].otHours += ot;
		posStats[pos].count += 1;
		posStats[pos].dollars += Number(row.labor_dollars) || 0;
	}

	const longShiftPositions: string[] = [];
	for (const [pos, stats] of Object.entries(posStats)) {
		const avgShift = stats.totalHours / stats.count;
		// If avg shift exceeds 7 hours, productivity declines
		if (avgShift > 7) {
			longShiftPositions.push(pos);
		}
	}

	if (longShiftPositions.length === 0) return null;

	return {
		type: 'productivity_curve',
		headcountDelta: 0,
		positions: longShiftPositions,
		confidence: 0.6,
		reasoning: `Long avg shifts detected for ${longShiftPositions.join(', ')} — consider splitting into shorter shifts for sustained productivity (hours 7+ show ~15% output decline)`,
	};
}

/** 9. Task-Based Scheduling Signals — covers-driven headcount: >150=runner, >200=expo. */
async function computeTaskBasedSignals(
	locationId: string,
	targetDate: string,
): Promise<LaborSignal | null> {
	const sb = getSupabase();

	// Get forecast covers for the date
	const { data: forecast } = await sb
		.from('daily_forecasts')
		.select('manager_covers, ai_suggested_covers')
		.eq('location_id', locationId)
		.eq('business_date', targetDate)
		.maybeSingle();

	const covers = forecast?.manager_covers ?? forecast?.ai_suggested_covers ?? 0;
	if (covers <= 0) return null;

	const signals: string[] = [];
	let totalDelta = 0;
	const positions: string[] = [];

	if (covers >= 200) {
		signals.push('200+ covers: dedicated expo recommended');
		totalDelta += 1;
		positions.push('Support');
	}
	if (covers >= 150) {
		signals.push(`${covers >= 200 ? '200' : '150'}+ covers: dedicated food runner recommended`);
		totalDelta += 1;
		positions.push('Support');
	}
	if (covers >= 250) {
		signals.push('250+ covers: consider additional barback');
		totalDelta += 1;
		positions.push('Support');
	}

	if (signals.length === 0) return null;

	return {
		type: 'task_based',
		headcountDelta: totalDelta,
		positions: [...new Set(positions)],
		confidence: 0.7,
		reasoning: `Task signals (${covers} covers): ${signals.join('; ')}`,
	};
}

/** 10. Weather-Adjusted Patio Staffing — for patio locations only. */
async function computePatioStaffing(
	locationId: string,
	targetDate: string,
): Promise<LaborSignal | null> {
	const sb = getSupabase();

	// Check if location has a patio
	const { data: location } = await sb
		.from('locations')
		.select('has_patio, name')
		.eq('id', locationId)
		.maybeSingle();

	if (!location?.has_patio) return null;

	// Get weather for the date
	const { data: weather } = await sb
		.from('daily_weather')
		.select('temp_high, precipitation_pct, condition')
		.eq('location_id', locationId)
		.eq('business_date', targetDate)
		.maybeSingle();

	if (!weather) return null;

	const tempHigh = Number(weather.temp_high) || 70;
	const precipPct = Number(weather.precipitation_pct) || 0;
	const condition = weather.condition || 'Clear';

	const adverseConditions = ['Rain', 'Thunderstorm', 'Drizzle', 'Snow', 'Sleet', 'Squall'];
	const isAdverse = adverseConditions.includes(condition) || precipPct > 50;
	const isPerfect = tempHigh >= 60 && tempHigh <= 85 && precipPct < 20
		&& !adverseConditions.includes(condition);

	if (isPerfect) {
		return {
			type: 'patio_staffing',
			headcountDelta: 3,
			positions: ['Server', 'Bartender'],
			timeRange: { start: 16, end: 22 },
			confidence: 0.75,
			reasoning: `Patio weather: ${Math.round(tempHigh)}F, ${condition} — add +2 servers, +1 bartender for outdoor seating`,
		};
	}

	if (isAdverse) {
		return {
			type: 'patio_staffing',
			headcountDelta: -2,
			positions: ['Server'],
			timeRange: { start: 16, end: 22 },
			confidence: 0.8,
			reasoning: `Patio closed: ${condition}, ${precipPct}% precip — reduce 2 servers (no outdoor seating)`,
		};
	}

	// Marginal weather: mild adjustment
	if (tempHigh >= 50 && precipPct < 35) {
		return {
			type: 'patio_staffing',
			headcountDelta: 1,
			positions: ['Server'],
			timeRange: { start: 17, end: 21 },
			confidence: 0.5,
			reasoning: `Marginal patio weather: ${Math.round(tempHigh)}F, ${precipPct}% precip — light patio use, +1 server`,
		};
	}

	return null;
}

/** 11. Predictive Callout Modeling — DOW-specific no-show risk from historical data. */
async function computeCalloutPrediction(
	locationId: string,
	targetDate: string,
): Promise<LaborSignal | null> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay();

	const ninetyDaysAgo = new Date(target);
	ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

	// Get scheduled shifts vs actual labor for the same DOW
	const { data: scheduledRows } = await sb
		.from('scheduled_shifts')
		.select('business_date, employee_id, position, scheduled_hours')
		.eq('location_id', locationId)
		.gte('business_date', ninetyDaysAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('scheduled_hours', 0);

	if (!scheduledRows || scheduledRows.length < 20) return null;

	// Filter to same DOW
	const sameDow = scheduledRows.filter((r) => {
		const d = new Date(r.business_date + 'T12:00:00');
		return d.getDay() === dayOfWeek;
	});

	if (sameDow.length < 5) return null;

	// Get actual labor for those same dates
	const sameDowDates = [...new Set(sameDow.map((r) => r.business_date))];
	const { data: actualRows } = await sb
		.from('daily_labor')
		.select('business_date, employee_id, regular_hours')
		.eq('location_id', locationId)
		.in('business_date', sameDowDates)
		.gt('regular_hours', 0);

	if (!actualRows || actualRows.length === 0) return null;

	// Build sets of who was scheduled vs who worked per date
	const scheduledByDate: Record<string, Set<string>> = {};
	const workedByDate: Record<string, Set<string>> = {};

	for (const r of sameDow) {
		if (!scheduledByDate[r.business_date]) scheduledByDate[r.business_date] = new Set();
		scheduledByDate[r.business_date].add(r.employee_id);
	}
	for (const r of actualRows) {
		if (!workedByDate[r.business_date]) workedByDate[r.business_date] = new Set();
		workedByDate[r.business_date].add(r.employee_id);
	}

	// Compute callout rate per date
	let totalScheduled = 0;
	let totalNoShows = 0;

	for (const [date, scheduled] of Object.entries(scheduledByDate)) {
		const worked = workedByDate[date] || new Set();
		for (const empId of scheduled) {
			totalScheduled++;
			if (!worked.has(empId)) totalNoShows++;
		}
	}

	if (totalScheduled < 10) return null;

	const calloutRate = totalNoShows / totalScheduled;
	if (calloutRate < 0.05) return null; // <5% is normal

	const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
	const backupCount = calloutRate >= 0.15 ? 2 : 1;

	return {
		type: 'callout_prediction',
		headcountDelta: backupCount,
		confidence: Math.min(0.5 + sameDowDates.length * 0.03, 0.85),
		reasoning: `${dayNames[dayOfWeek]} callout risk: ${(calloutRate * 100).toFixed(0)}% no-show rate (${totalNoShows}/${totalScheduled} over ${sameDowDates.length} weeks) — schedule +${backupCount} backup`,
	};
}

/** 12. Revenue Per Labor Hour (RPLH) Optimization — find optimal staffing level. */
async function computeRplhOptimization(
	locationId: string,
	targetDate: string,
): Promise<LaborSignal | null> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay();

	const sixtyDaysAgo = new Date(target);
	sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

	// Get actuals + labor for same DOW over 60 days
	const { data: actualsRows } = await sb
		.from('daily_actuals')
		.select('business_date, revenue')
		.eq('location_id', locationId)
		.gte('business_date', sixtyDaysAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('revenue', 0);

	if (!actualsRows || actualsRows.length < 5) return null;

	const sameDowDates = actualsRows
		.filter((r) => new Date(r.business_date + 'T12:00:00').getDay() === dayOfWeek)
		.map((r) => r.business_date);

	if (sameDowDates.length < 3) return null;

	const { data: laborRows } = await sb
		.from('daily_labor')
		.select('business_date, regular_hours, overtime_hours, labor_dollars')
		.eq('location_id', locationId)
		.in('business_date', sameDowDates);

	if (!laborRows || laborRows.length < 5) return null;

	// Compute RPLH per date
	const revenueMap: Record<string, number> = {};
	for (const r of actualsRows) {
		revenueMap[r.business_date] = r.revenue;
	}

	const rplhByDate: { date: string; rplh: number; laborHours: number; revenue: number }[] = [];
	const laborByDate: Record<string, number> = {};

	for (const r of laborRows) {
		const hours = (Number(r.regular_hours) || 0) + (Number(r.overtime_hours) || 0);
		laborByDate[r.business_date] = (laborByDate[r.business_date] || 0) + hours;
	}

	for (const date of sameDowDates) {
		const rev = revenueMap[date] || 0;
		const hours = laborByDate[date] || 0;
		if (rev > 0 && hours > 0) {
			rplhByDate.push({ date, rplh: rev / hours, laborHours: hours, revenue: rev });
		}
	}

	if (rplhByDate.length < 3) return null;

	// Find best RPLH day and compare to average
	rplhByDate.sort((a, b) => b.rplh - a.rplh);
	const bestRplh = rplhByDate[0];
	const avgRplh = rplhByDate.reduce((s, d) => s + d.rplh, 0) / rplhByDate.length;
	const avgHours = rplhByDate.reduce((s, d) => s + d.laborHours, 0) / rplhByDate.length;

	if (avgRplh <= 0) return null;

	const rplhGap = (bestRplh.rplh - avgRplh) / avgRplh;
	if (rplhGap < 0.05) return null; // Best is within 5% of avg, nothing to optimize

	// Recommend targeting the best-performing hours level
	const hoursDelta = Math.round(bestRplh.laborHours - avgHours);

	return {
		type: 'rplh_optimization',
		headcountDelta: hoursDelta > 0 ? 0 : -1,
		confidence: Math.min(0.5 + rplhByDate.length * 0.05, 0.8),
		reasoning: `Best RPLH: $${bestRplh.rplh.toFixed(0)}/hr @ ${bestRplh.laborHours.toFixed(0)}h vs avg $${avgRplh.toFixed(0)}/hr @ ${avgHours.toFixed(0)}h — ${hoursDelta > 0 ? 'add' : 'trim'} ${Math.abs(hoursDelta)}h to match optimal staffing`,
	};
}

/** 13. Break Scheduling Intelligence — stagger breaks during lull hours. */
async function computeBreakScheduling(
	locationId: string,
	targetDate: string,
): Promise<LaborSignal | null> {
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay();

	const curve = await getHourlyCurve(locationId, dayOfWeek);
	if (!curve || curve.length === 0) return null;

	// Find hours where revenue is <15% of peak hour
	const peakPct = Math.max(...curve.map((c) => c.pctOfDaily));
	if (peakPct <= 0) return null;

	const threshold = peakPct * 0.25;
	const lullHours = curve
		.filter((c) => c.pctOfDaily > 0 && c.pctOfDaily < threshold && c.hour >= 11 && c.hour <= 22)
		.map((c) => c.hour)
		.sort((a, b) => a - b);

	if (lullHours.length === 0) return null;

	// Format lull windows
	const windows: string[] = [];
	let windowStart = lullHours[0];
	let windowEnd = lullHours[0];

	for (let i = 1; i < lullHours.length; i++) {
		if (lullHours[i] === windowEnd + 1) {
			windowEnd = lullHours[i];
		} else {
			windows.push(formatHourRange(windowStart, windowEnd));
			windowStart = lullHours[i];
			windowEnd = lullHours[i];
		}
	}
	windows.push(formatHourRange(windowStart, windowEnd));

	return {
		type: 'break_scheduling',
		headcountDelta: 0,
		timeRange: { start: lullHours[0], end: lullHours[lullHours.length - 1] },
		confidence: 0.65,
		reasoning: `Optimal break windows: ${windows.join(', ')} — stagger breaks during low-volume; max 1 per position on break simultaneously`,
	};
}

function formatHourRange(start: number, end: number): string {
	const fmt = (h: number) => {
		const ampm = h >= 12 ? 'p' : 'a';
		const hr = h > 12 ? h - 12 : h;
		return `${hr}${ampm}`;
	};
	return start === end ? fmt(start) : `${fmt(start)}-${fmt(end + 1)}`;
}

/** Run all 6 labor enhancements, return advisory signals with reasoning. */
export async function getLaborEnhancements(
	locationId: string,
	targetDate: string,
): Promise<LaborEnhancementResult> {
	const results = await Promise.all([
		computeProductivityCurve(locationId, targetDate).catch(() => null),
		computeTaskBasedSignals(locationId, targetDate).catch(() => null),
		computePatioStaffing(locationId, targetDate).catch(() => null),
		computeCalloutPrediction(locationId, targetDate).catch(() => null),
		computeRplhOptimization(locationId, targetDate).catch(() => null),
		computeBreakScheduling(locationId, targetDate).catch(() => null),
	]);

	const [productivity, taskBased, patio, callout, rplh, breaks] = results;

	const allSignals: LaborSignal[] = [];
	const reasoning: string[] = [];

	for (const signal of results) {
		if (signal) {
			allSignals.push(signal);
			reasoning.push(signal.reasoning);
		}
	}

	return {
		adjustmentSignals: allSignals,
		reasoning,
		components: {
			productivityCurve: productivity,
			taskBasedSignals: taskBased,
			patioStaffing: patio,
			calloutPrediction: callout,
			rplhOptimization: rplh,
			breakScheduling: breaks,
		},
	};
}
