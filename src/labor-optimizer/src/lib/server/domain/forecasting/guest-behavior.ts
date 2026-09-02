/**
 * Guest Behavior Patterns — Resy reservation + Toast order analysis
 * for revenue adjustment signals in the forecast engine.
 */

import { getSupabase } from '$lib/server/supabase';

// --- Types ---

export interface BookingVelocity {
	targetDate: string;
	daysOut: number;
	coversBooked: number;
	historicalAvgAtDaysOut: number;
	velocityRatio: number;
	revenueAdjustmentPct: number;
}

export interface NoShowPrediction {
	date: string;
	historicalNoShowPct: number;
	predictedNoShowPct: number;
	adjustedCovers: number;
	rawCovers: number;
}

export interface PartyMixForecast {
	date: string;
	distribution: { partySize: string; pct: number; avgCheck: number }[];
	weightedAvgCheck: number;
	checkAdjustmentPct: number;
}

export interface TableTurnAnalysis {
	dayOfWeek: number;
	avgDwellMinutes: number;
	turnsPerSeat: number;
	peakHourTurns: number;
	sampleDays: number;
}

export interface CheckAvgTrend {
	direction: 'up' | 'down' | 'flat';
	changePct: number;
	foodTrendPct: number;
	beverageTrendPct: number;
	periodDays: number;
}

export interface GuestBehaviorForecast {
	date: string;
	bookingVelocity: BookingVelocity | null;
	noShowPrediction: NoShowPrediction | null;
	partyMix: PartyMixForecast | null;
	checkTrend: CheckAvgTrend | null;
	revenueAdjustmentPct: number;
	coverAdjustmentPct: number;
	checkAvgAdjustmentPct: number;
	reasoning: string[];
}

// --- Helpers ---

function daysAgo(n: number): string {
	const d = new Date();
	d.setDate(d.getDate() - n);
	return d.toISOString().split('T')[0];
}

function sameDowFilter<T extends { business_date: string }>(rows: T[], dow: number): T[] {
	return rows.filter(r => new Date(r.business_date + 'T12:00:00').getDay() === dow);
}

// --- Booking Velocity ---

/** How fast reservations are being booked vs historical pace. */
export async function getBookingVelocity(
	locationId: string,
	targetDate: string,
): Promise<BookingVelocity | null> {
	const sb = getSupabase();
	const today = new Date();
	const target = new Date(targetDate + 'T12:00:00');
	const daysOut = Math.max(0, Math.round((target.getTime() - today.getTime()) / 86400000));

	const { data: currentReso } = await sb
		.from('daily_reservations')
		.select('booked_covers')
		.eq('location_id', locationId)
		.eq('business_date', targetDate)
		.maybeSingle();

	const coversBooked = currentReso?.booked_covers || 0;

	// Try velocity tracking table first
	const { data: velocityRows } = await sb
		.from('booking_velocity')
		.select('covers_booked, velocity_vs_avg')
		.eq('location_id', locationId)
		.eq('days_out', daysOut)
		.order('target_date', { ascending: false })
		.limit(8);

	if (velocityRows && velocityRows.length >= 2) {
		const avgHistorical = velocityRows.reduce((s, r) => s + r.covers_booked, 0) / velocityRows.length;
		const ratio = avgHistorical > 0 ? coversBooked / avgHistorical : 1;
		return {
			targetDate, daysOut, coversBooked,
			historicalAvgAtDaysOut: Math.round(avgHistorical),
			velocityRatio: Math.round(ratio * 100) / 100,
			revenueAdjustmentPct: Math.round(Math.max(-8, Math.min(8, (ratio - 1) * 15)) * 10) / 10,
		};
	}

	// Fallback: compare to same-DOW historical reservation totals
	const { data: historicalResos } = await sb
		.from('daily_reservations')
		.select('booked_covers, business_date')
		.eq('location_id', locationId)
		.gte('business_date', daysAgo(60))
		.gt('booked_covers', 0);

	const sameDow = sameDowFilter(historicalResos || [], target.getDay());
	if (sameDow.length < 2 || coversBooked === 0) return null;

	const avgCovers = sameDow.reduce((s, r) => s + r.booked_covers, 0) / sameDow.length;
	const ratio = avgCovers > 0 ? coversBooked / avgCovers : 1;
	return {
		targetDate, daysOut, coversBooked,
		historicalAvgAtDaysOut: Math.round(avgCovers),
		velocityRatio: Math.round(ratio * 100) / 100,
		revenueAdjustmentPct: Math.round(Math.max(-8, Math.min(8, (ratio - 1) * 15)) * 10) / 10,
	};
}

// --- No-Show Prediction ---

/** Predict no-show rate based on DOW + seasonal patterns. */
export async function getNoShowPrediction(
	locationId: string,
	date: string,
): Promise<NoShowPrediction | null> {
	const sb = getSupabase();
	const target = new Date(date + 'T12:00:00');

	const { data: resoRows } = await sb
		.from('daily_reservations')
		.select('business_date, booked_covers, no_show_count, total_covers')
		.eq('location_id', locationId)
		.gte('business_date', daysAgo(90))
		.gt('total_covers', 0);

	if (!resoRows || resoRows.length < 5) return null;

	const sameDow = sameDowFilter(resoRows, target.getDay());
	if (sameDow.length < 2) return null;

	const totalBooked = sameDow.reduce((s, r) => s + (r.booked_covers || 0), 0);
	const totalNoShows = sameDow.reduce((s, r) => s + (r.no_show_count || 0), 0);
	const historicalPct = totalBooked > 0 ? (totalNoShows / totalBooked) * 100 : 0;

	// Seasonal bump for summer/holiday months
	const seasonalFactor = [6, 7, 11].includes(target.getMonth()) ? 1.15 : 1.0;
	const predictedPct = Math.min(25, historicalPct * seasonalFactor);

	const { data: targetReso } = await sb
		.from('daily_reservations')
		.select('booked_covers')
		.eq('location_id', locationId)
		.eq('business_date', date)
		.maybeSingle();

	const rawCovers = targetReso?.booked_covers || 0;

	return {
		date,
		historicalNoShowPct: Math.round(historicalPct * 10) / 10,
		predictedNoShowPct: Math.round(predictedPct * 10) / 10,
		adjustedCovers: Math.round(rawCovers * (1 - predictedPct / 100)),
		rawCovers,
	};
}

// --- Party Mix Forecast ---

/** Predict party size distribution and its effect on check avg. */
export async function getPartyMixForecast(
	locationId: string,
	date: string,
): Promise<PartyMixForecast | null> {
	const sb = getSupabase();
	const target = new Date(date + 'T12:00:00');

	const { data: resoRows } = await sb
		.from('daily_reservations')
		.select('business_date, avg_party_size, booked_covers, total_covers')
		.eq('location_id', locationId)
		.gte('business_date', daysAgo(60))
		.gt('total_covers', 0);

	if (!resoRows || resoRows.length < 5) return null;

	const sameDow = sameDowFilter(resoRows, target.getDay());
	if (sameDow.length < 2) return null;

	const avgPartySize = sameDow.reduce((s, r) => s + (r.avg_party_size || 2), 0) / sameDow.length;

	// Estimate distribution from avg party size
	const pct2 = Math.max(20, Math.min(80, 100 - (avgPartySize - 2) * 25));
	const pct6 = Math.max(0, Math.min(30, (avgPartySize - 3) * 15));
	const pct4 = 100 - pct2 - pct6;
	const distribution = [
		{ partySize: '2-top', pct: Math.round(pct2) },
		{ partySize: '4-top', pct: Math.round(pct4) },
		{ partySize: '6+', pct: Math.round(pct6) },
	];

	// Baseline check avg
	const { data: checkData } = await sb
		.from('daily_actuals')
		.select('revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', daysAgo(60))
		.gt('covers', 0);

	const baselineCheck = (checkData && checkData.length > 0)
		? checkData.reduce((s, r) => s + r.revenue, 0) / checkData.reduce((s, r) => s + r.covers, 0)
		: 70;

	const multipliers: Record<string, number> = { '2-top': 1.0, '4-top': 1.08, '6+': 1.18 };

	const weightedAvgCheck = distribution.reduce((sum, d) => {
		return sum + (d.pct / 100) * baselineCheck * (multipliers[d.partySize] || 1.0);
	}, 0);

	const checkAdjPct = baselineCheck > 0 ? ((weightedAvgCheck - baselineCheck) / baselineCheck) * 100 : 0;

	return {
		date,
		distribution: distribution.map(d => ({
			...d,
			avgCheck: Math.round(baselineCheck * (multipliers[d.partySize] || 1.0) * 100) / 100,
		})),
		weightedAvgCheck: Math.round(weightedAvgCheck * 100) / 100,
		checkAdjustmentPct: Math.round(checkAdjPct * 10) / 10,
	};
}

// --- Table Turn Analysis ---

/** Avg dwell time and table turns from daily_dining_metrics. */
export async function getTableTurnAnalysis(
	locationId: string,
	dayOfWeek: number,
): Promise<TableTurnAnalysis | null> {
	const sb = getSupabase();

	const { data: metrics } = await sb
		.from('daily_dining_metrics')
		.select('business_date, avg_dwell_minutes, avg_turns_per_seat, peak_hour_turns')
		.eq('location_id', locationId)
		.gte('business_date', daysAgo(60))
		.gt('avg_dwell_minutes', 0);

	if (!metrics || metrics.length < 3) return null;

	const sameDow = sameDowFilter(metrics, dayOfWeek);
	if (sameDow.length < 2) return null;

	return {
		dayOfWeek,
		avgDwellMinutes: Math.round(sameDow.reduce((s, r) => s + r.avg_dwell_minutes, 0) / sameDow.length),
		turnsPerSeat: Math.round(sameDow.reduce((s, r) => s + r.avg_turns_per_seat, 0) / sameDow.length * 100) / 100,
		peakHourTurns: Math.round(sameDow.reduce((s, r) => s + (r.peak_hour_turns || 0), 0) / sameDow.length * 100) / 100,
		sampleDays: sameDow.length,
	};
}

// --- Check Average Trend ---

/** Is avg check trending up/down over last 30 days? Decomposes food vs bev. */
export async function getCheckAvgTrend(locationId: string): Promise<CheckAvgTrend | null> {
	const sb = getSupabase();
	const since = daysAgo(30);

	const { data: actuals } = await sb
		.from('daily_actuals')
		.select('business_date, revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', since)
		.gt('covers', 0)
		.order('business_date', { ascending: true });

	if (!actuals || actuals.length < 10) return null;

	const mid = Math.floor(actuals.length / 2);
	const first = actuals.slice(0, mid);
	const second = actuals.slice(mid);

	const avgFirst = first.reduce((s, r) => s + r.revenue, 0) / first.reduce((s, r) => s + r.covers, 0);
	const avgSecond = second.reduce((s, r) => s + r.revenue, 0) / second.reduce((s, r) => s + r.covers, 0);
	const changePct = avgFirst > 0 ? ((avgSecond - avgFirst) / avgFirst) * 100 : 0;

	// Food vs beverage from sales mix
	const midDate = actuals[mid].business_date;
	const [{ data: mixFirst }, { data: mixSecond }] = await Promise.all([
		sb.from('daily_sales_mix').select('category, revenue').eq('location_id', locationId).gte('business_date', since).lt('business_date', midDate),
		sb.from('daily_sales_mix').select('category, revenue').eq('location_id', locationId).gte('business_date', midDate),
	]);

	const bevCats = ['Liquor', 'Wine', 'Beer', 'Non-Alcoholic'];
	const sumCat = (rows: any[] | null, cats: string[]) => (rows || []).filter(r => cats.includes(r.category)).reduce((s: number, r: any) => s + r.revenue, 0);

	const foodFirst = sumCat(mixFirst, ['Food']);
	const foodSecond = sumCat(mixSecond, ['Food']);
	const bevFirst = sumCat(mixFirst, bevCats);
	const bevSecond = sumCat(mixSecond, bevCats);

	return {
		direction: changePct > 2 ? 'up' : changePct < -2 ? 'down' : 'flat',
		changePct: Math.round(changePct * 10) / 10,
		foodTrendPct: Math.round((foodFirst > 0 ? ((foodSecond - foodFirst) / foodFirst) * 100 : 0) * 10) / 10,
		beverageTrendPct: Math.round((bevFirst > 0 ? ((bevSecond - bevFirst) / bevFirst) * 100 : 0) * 10) / 10,
		periodDays: actuals.length,
	};
}

// --- Repeat Guest Signal ---

/** Estimate repeat guest % from weekday vs weekend check avg differential. */
export async function getRepeatGuestSignal(locationId: string): Promise<{ estimatedRepeatPct: number; checkPremiumPct: number; confidence: number } | null> {
	const sb = getSupabase();

	const { data: actuals } = await sb
		.from('daily_actuals')
		.select('business_date, revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', daysAgo(60))
		.gt('covers', 0)
		.order('business_date', { ascending: true });

	if (!actuals || actuals.length < 14) return null;

	const weekdays = actuals.filter(r => { const d = new Date(r.business_date + 'T12:00:00').getDay(); return d >= 1 && d <= 4; });
	const weekends = actuals.filter(r => { const d = new Date(r.business_date + 'T12:00:00').getDay(); return d === 0 || d === 5 || d === 6; });
	if (weekdays.length < 3 || weekends.length < 3) return null;

	const wdCheck = weekdays.reduce((s, r) => s + r.revenue, 0) / weekdays.reduce((s, r) => s + r.covers, 0);
	const weCheck = weekends.reduce((s, r) => s + r.revenue, 0) / weekends.reduce((s, r) => s + r.covers, 0);
	const premium = wdCheck > 0 && weCheck > 0 ? ((wdCheck - weCheck) / weCheck) * 100 : 0;

	return {
		estimatedRepeatPct: premium > 5 ? 45 : premium > 0 ? 35 : 25,
		checkPremiumPct: Math.round(Math.max(0, premium) * 10) / 10,
		confidence: Math.min(0.7, 0.3 + actuals.length * 0.01),
	};
}

// --- Composite Guest Behavior Forecast ---

/** Combine all guest behavior signals into a revenue adjustment. */
export async function getGuestBehaviorForecast(locationId: string, date: string): Promise<GuestBehaviorForecast> {
	const [velocity, noShow, partyMix, checkTrend] = await Promise.all([
		getBookingVelocity(locationId, date).catch(() => null),
		getNoShowPrediction(locationId, date).catch(() => null),
		getPartyMixForecast(locationId, date).catch(() => null),
		getCheckAvgTrend(locationId).catch(() => null),
	]);

	let revenueAdjPct = 0;
	let coverAdjPct = 0;
	let checkAvgAdjPct = 0;
	const reasoning: string[] = [];

	if (velocity && Math.abs(velocity.revenueAdjustmentPct) > 1) {
		revenueAdjPct += velocity.revenueAdjustmentPct;
		const dir = velocity.velocityRatio > 1 ? 'faster' : 'slower';
		reasoning.push(`Booking ${dir} than avg (${velocity.velocityRatio}x): ${velocity.revenueAdjustmentPct > 0 ? '+' : ''}${velocity.revenueAdjustmentPct}%`);
	}

	if (partyMix && Math.abs(partyMix.checkAdjustmentPct) > 1) {
		checkAvgAdjPct += partyMix.checkAdjustmentPct;
		reasoning.push(`Party mix: check avg ${partyMix.checkAdjustmentPct > 0 ? '+' : ''}${partyMix.checkAdjustmentPct}%`);
	}

	if (noShow && noShow.predictedNoShowPct > 2) {
		coverAdjPct -= noShow.predictedNoShowPct;
		reasoning.push(`No-shows: ${noShow.predictedNoShowPct}% (${noShow.rawCovers} booked -> ~${noShow.adjustedCovers} expected)`);
	}

	if (checkTrend && checkTrend.direction !== 'flat') {
		const trendAdj = checkTrend.changePct * 0.5;
		revenueAdjPct += trendAdj;
		reasoning.push(`Check trend ${checkTrend.direction}: ${checkTrend.changePct > 0 ? '+' : ''}${checkTrend.changePct}% (food ${checkTrend.foodTrendPct > 0 ? '+' : ''}${checkTrend.foodTrendPct}%, bev ${checkTrend.beverageTrendPct > 0 ? '+' : ''}${checkTrend.beverageTrendPct}%)`);
	}

	return {
		date,
		bookingVelocity: velocity,
		noShowPrediction: noShow,
		partyMix: partyMix,
		checkTrend: checkTrend,
		revenueAdjustmentPct: Math.round(Math.max(-12, Math.min(12, revenueAdjPct)) * 10) / 10,
		coverAdjustmentPct: Math.round(Math.max(-20, Math.min(10, coverAdjPct)) * 10) / 10,
		checkAvgAdjustmentPct: Math.round(Math.max(-10, Math.min(10, checkAvgAdjPct)) * 10) / 10,
		reasoning,
	};
}
