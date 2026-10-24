/** AI Forecast Engine — self-improving via adaptive weights from rolling accuracy. */

import {
	getSupabase,
	type DashboardPosition,
} from '$lib/server/supabase';
import { getWeatherForDate } from '$lib/server/integrations/weather/weather-service';
import {
	getReservationsForDate,
	getHistoricalWalkinRatio,
} from '$lib/server/integrations/resy/resy-service';
import { lookupPriorYear, computeYtdTrend, computeWeatherImpact, learnOverrideTagImpacts, applyBiasCorrection } from './forecast-helpers';
import { getCrossLocationSignal } from './cross-location';
import { getEventImpact } from './event-intelligence';
import { getMarketConditions } from './market-signals';
import { getGuestBehaviorForecast } from './guest-behavior';
import { getRevenueEnhancements } from './revenue-enhancements';

// ---------------------------------------------------------------------------
// Proprietary Signal Stack — HELIXO neural signals
// ---------------------------------------------------------------------------

export interface SignalResult {
	multiplier: number;
	note: string;
}

/**
 * Reservation Velocity: rate of change in bookings vs. prior week same DOW.
 * Impact: multiply base forecast by (1 + velocity * 0.15).
 */
async function reservationVelocity(
	locationId: string,
	targetDate: string,
): Promise<SignalResult> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dow = target.getDay();

	// Get same-DOW reservation counts for last 2 weeks
	const twoWeeksAgo = new Date(target);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

	const { data: resoRows } = await sb
		.from('daily_actuals')
		.select('business_date, covers')
		.eq('location_id', locationId)
		.gte('business_date', twoWeeksAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('covers', 0);

	if (!resoRows || resoRows.length < 2) {
		return { multiplier: 1.0, note: '' };
	}

	const sameDow = resoRows
		.filter((r) => new Date(r.business_date + 'T12:00:00').getDay() === dow)
		.sort((a, b) => a.business_date.localeCompare(b.business_date));

	if (sameDow.length < 2) return { multiplier: 1.0, note: '' };

	// Compare most recent week vs prior week
	const lastWeek = Number(sameDow[sameDow.length - 1].covers);
	const priorWeek = Number(sameDow[sameDow.length - 2].covers);

	if (priorWeek <= 0) return { multiplier: 1.0, note: '' };

	const velocity = (lastWeek - priorWeek) / priorWeek;
	const impact = velocity * 0.15;
	const multiplier = 1 + impact;
	const clamped = Math.max(0.90, Math.min(1.12, multiplier));

	if (Math.abs(impact) < 0.01) return { multiplier: 1.0, note: '' };

	const dir = velocity > 0 ? '+' : '';
	const note = `Reservation velocity: ${dir}${(velocity * 100).toFixed(1)}% WoW -- ${dir}${(impact * 100).toFixed(1)}% adjustment`;
	return { multiplier: clamped, note };
}

/**
 * Weather Sentiment: per-location learned weather-revenue regression.
 * Computes penalty/bonus from precipitation, temperature, and conditions
 * using 90-day historical correlation.
 */
async function weatherSentiment(
	locationId: string,
	targetDate: string,
): Promise<SignalResult> {
	const sb = getSupabase();

	const { data: wx } = await sb
		.from('daily_weather')
		.select('temp_high, precipitation_pct, condition')
		.eq('location_id', locationId)
		.eq('business_date', targetDate)
		.maybeSingle();

	if (!wx) return { multiplier: 1.0, note: '' };

	const tempHigh = Number(wx.temp_high) || 70;
	const precip = Number(wx.precipitation_pct) || 0;
	const condition = wx.condition || 'Clear';

	// Learn from 90-day historical weather-revenue regression
	const ninetyDaysAgo = new Date(targetDate + 'T12:00:00');
	ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
	const since = ninetyDaysAgo.toISOString().split('T')[0];

	const { data: wxHist } = await sb
		.from('daily_weather')
		.select('business_date, temp_high, precipitation_pct, condition')
		.eq('location_id', locationId)
		.gte('business_date', since)
		.lt('business_date', targetDate);

	const { data: actHist } = await sb
		.from('daily_actuals')
		.select('business_date, revenue')
		.eq('location_id', locationId)
		.gte('business_date', since)
		.lt('business_date', targetDate)
		.gt('revenue', 0);

	// Build regression data
	if (!wxHist || !actHist || wxHist.length < 14 || actHist.length < 14) {
		// Fall back to rule-based
		let mult = 1.0;
		let note = '';
		if (precip > 50) {
			mult = condition === 'Snow' ? 0.85 : 0.92;
			note = `Weather penalty: ${condition === 'Snow' ? 'snow -15%' : `rain (${precip}%) -8%`}`;
		} else if (tempHigh > 95) {
			mult = 0.95;
			note = `Extreme heat ${tempHigh}F -- -5%`;
		} else if (tempHigh >= 65 && tempHigh <= 80 && precip < 15 && ['Clear', 'Clouds'].includes(condition)) {
			mult = 1.05;
			note = `Perfect weather ${tempHigh}F -- +5%`;
		}
		return { multiplier: mult, note };
	}

	// Map actuals by date for joining
	const actMap = new Map<string, number>();
	for (const a of actHist) actMap.set(a.business_date, Number(a.revenue));

	// Compute average revenue for each weather bucket
	const buckets: Record<string, number[]> = { adverse: [], perfect: [], neutral: [] };
	for (const w of wxHist) {
		const rev = actMap.get(w.business_date);
		if (!rev || rev <= 0) continue;
		const wPrecip = Number(w.precipitation_pct) || 0;
		const wTemp = Number(w.temp_high) || 70;
		const wCond = w.condition || 'Clear';

		if (wPrecip > 50 || ['Rain', 'Snow', 'Thunderstorm'].includes(wCond) || wTemp > 95) {
			buckets.adverse.push(rev);
		} else if (wTemp >= 65 && wTemp <= 80 && wPrecip < 15 && ['Clear', 'Clouds'].includes(wCond)) {
			buckets.perfect.push(rev);
		} else {
			buckets.neutral.push(rev);
		}
	}

	const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
	const neutralAvg = avg(buckets.neutral);
	if (neutralAvg <= 0) return { multiplier: 1.0, note: '' };

	// Determine which bucket this forecast date falls into
	let mult = 1.0;
	let note = '';
	if (precip > 50 || ['Rain', 'Snow', 'Thunderstorm'].includes(condition) || tempHigh > 95) {
		const adverseAvg = avg(buckets.adverse);
		if (adverseAvg > 0 && buckets.adverse.length >= 3) {
			mult = Math.max(0.80, Math.min(1.0, adverseAvg / neutralAvg));
			note = `Learned weather penalty: ${((mult - 1) * 100).toFixed(1)}% (${buckets.adverse.length} similar days)`;
		} else {
			mult = condition === 'Snow' ? 0.85 : 0.92;
			note = `Rule-based weather: ${condition} -${Math.round((1 - mult) * 100)}%`;
		}
	} else if (tempHigh >= 65 && tempHigh <= 80 && precip < 15 && ['Clear', 'Clouds'].includes(condition)) {
		const perfectAvg = avg(buckets.perfect);
		if (perfectAvg > 0 && buckets.perfect.length >= 3) {
			mult = Math.max(1.0, Math.min(1.10, perfectAvg / neutralAvg));
			note = `Learned perfect weather boost: +${((mult - 1) * 100).toFixed(1)}% (${buckets.perfect.length} similar days)`;
		} else {
			mult = 1.05;
			note = 'Perfect weather +5%';
		}
	}

	return { multiplier: mult, note };
}

/**
 * Paycheck Cycle Boost: revenue tends to spike around paydays.
 * 1st or 15th of month: +3%. Friday: +2%. Both: +5%.
 */
function paycheckCycleBoost(targetDate: string): SignalResult {
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfMonth = target.getDate();
	const dayOfWeek = target.getDay(); // 0=Sun, 5=Fri

	const isPayday = dayOfMonth === 1 || dayOfMonth === 15;
	const isFriday = dayOfWeek === 5;

	let boost = 0;
	const notes: string[] = [];

	if (isPayday && isFriday) {
		boost = 0.05;
		notes.push('Payday Friday: +5%');
	} else if (isPayday) {
		boost = 0.03;
		notes.push(`Payday (${dayOfMonth}${dayOfMonth === 1 ? 'st' : 'th'}): +3%`);
	} else if (isFriday) {
		boost = 0.02;
		notes.push('Friday boost: +2%');
	}

	return {
		multiplier: 1 + boost,
		note: notes.join(', '),
	};
}

/**
 * Holiday Proximity: revenue adjustments for days before/after/on holidays.
 * Before: +2% per day for 3 days (max +6%). After: -3% for 2 days.
 * Day-of: variable (+10% Valentine's/NYE, -5% Thanksgiving/Christmas).
 */
function holidayProximity(targetDate: string): SignalResult {
	const target = new Date(targetDate + 'T12:00:00');
	const year = target.getFullYear();

	// Major US holidays with their impact on restaurant revenue
	const holidays: { name: string; date: Date; dayOfImpact: number }[] = [
		{ name: "New Year's Day", date: new Date(year, 0, 1), dayOfImpact: 0.05 },
		{ name: "Valentine's Day", date: new Date(year, 1, 14), dayOfImpact: 0.10 },
		{ name: "Mother's Day", date: getNthDayOfMonth(year, 4, 0, 2), dayOfImpact: 0.08 }, // 2nd Sunday May
		{ name: "Father's Day", date: getNthDayOfMonth(year, 5, 0, 3), dayOfImpact: 0.05 }, // 3rd Sunday June
		{ name: "July 4th", date: new Date(year, 6, 4), dayOfImpact: 0.03 },
		{ name: "Labor Day", date: getNthDayOfMonth(year, 8, 1, 1), dayOfImpact: 0.02 }, // 1st Monday Sep
		{ name: "Halloween", date: new Date(year, 9, 31), dayOfImpact: 0.03 },
		{ name: "Thanksgiving", date: getNthDayOfMonth(year, 10, 4, 4), dayOfImpact: -0.05 }, // 4th Thursday Nov
		{ name: "Christmas Eve", date: new Date(year, 11, 24), dayOfImpact: 0.05 },
		{ name: "Christmas", date: new Date(year, 11, 25), dayOfImpact: -0.05 },
		{ name: "New Year's Eve", date: new Date(year, 11, 31), dayOfImpact: 0.10 },
	];

	// Also check next year's Jan 1 for proximity to late December
	holidays.push({ name: "New Year's Day", date: new Date(year + 1, 0, 1), dayOfImpact: 0.05 });

	let bestMultiplier = 1.0;
	let bestNote = '';

	for (const h of holidays) {
		const diffDays = Math.round(
			(h.date.getTime() - target.getTime()) / 86400000,
		);

		if (diffDays === 0) {
			// Day of holiday
			bestMultiplier = 1 + h.dayOfImpact;
			bestNote = `${h.name}: ${h.dayOfImpact >= 0 ? '+' : ''}${(h.dayOfImpact * 100).toFixed(0)}%`;
			break;
		} else if (diffDays > 0 && diffDays <= 3) {
			// Days before holiday: +2% per day
			const boost = diffDays <= 3 ? 0.02 * (4 - diffDays) : 0;
			if (1 + boost > bestMultiplier) {
				bestMultiplier = 1 + boost;
				bestNote = `${diffDays}d before ${h.name}: +${(boost * 100).toFixed(0)}%`;
			}
		} else if (diffDays < 0 && diffDays >= -2) {
			// Days after holiday: -3% for 2 days
			const penalty = -0.03;
			if (1 + penalty < bestMultiplier || bestMultiplier === 1.0) {
				bestMultiplier = 1 + penalty;
				bestNote = `${Math.abs(diffDays)}d after ${h.name}: ${(penalty * 100).toFixed(0)}%`;
			}
		}
	}

	return { multiplier: bestMultiplier, note: bestNote };
}

/** Helper: get Nth occurrence of a weekday in a month (0=Sun, 1=Mon, etc.) */
function getNthDayOfMonth(year: number, month: number, dayOfWeek: number, n: number): Date {
	const first = new Date(year, month, 1);
	let firstOccurrence = first.getDay() <= dayOfWeek
		? dayOfWeek - first.getDay() + 1
		: 7 - first.getDay() + dayOfWeek + 1;
	return new Date(year, month, firstOccurrence + (n - 1) * 7);
}

/**
 * Competitive Spillover: when competitors are closed or fully booked,
 * their displaced guests flow to our location.
 * +5% per unavailable competitor, capped at +12%.
 */
async function competitiveSpillover(
	locationId: string,
	targetDate: string,
): Promise<SignalResult> {
	const sb = getSupabase();

	const { data: compRows } = await sb
		.from('competitive_availability')
		.select('competitor_name, is_available, availability_score')
		.eq('location_id', locationId)
		.eq('business_date', targetDate);

	if (!compRows || compRows.length === 0) {
		return { multiplier: 1.0, note: '' };
	}

	const unavailable = compRows.filter(
		(c) => !c.is_available || (c.availability_score !== null && c.availability_score < 0.2),
	);

	if (unavailable.length === 0) return { multiplier: 1.0, note: '' };

	const spilloverPct = Math.min(0.12, unavailable.length * 0.05);
	const names = unavailable.map((c) => c.competitor_name).slice(0, 3).join(', ');
	const note = `Competitive spillover: ${unavailable.length} competitor(s) unavailable (${names}) -- +${(spilloverPct * 100).toFixed(0)}%`;

	return { multiplier: 1 + spilloverPct, note };
}

// ---------------------------------------------------------------------------
// Timeout helper — wraps an async call with a deadline + fallback
// ---------------------------------------------------------------------------

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	fallback: T,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout>;
	const timeout = new Promise<T>((resolve) => {
		timer = setTimeout(() => resolve(fallback), timeoutMs);
	});
	try {
		const result = await Promise.race([promise, timeout]);
		return result;
	} finally {
		clearTimeout(timer!);
	}
}

// ---------------------------------------------------------------------------
// In-memory suggestion cache (location+date -> suggestion, 4-hour TTL)
// ---------------------------------------------------------------------------

const SUGGESTION_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CachedSuggestion {
	suggestion: ForecastSuggestion;
	cachedAt: number;
}

const suggestionCache = new Map<string, CachedSuggestion>();

function getCacheKey(locationId: string, date: string): string {
	return `${locationId}:${date}`;
}

/** Invalidate cached suggestions for a location+date (call after accept/override). */
export function invalidateSuggestionCache(locationId: string, date?: string): void {
	if (date) {
		suggestionCache.delete(getCacheKey(locationId, date));
	} else {
		// Invalidate all dates for this location
		for (const key of suggestionCache.keys()) {
			if (key.startsWith(locationId + ':')) {
				suggestionCache.delete(key);
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForecastWeights {
	trailing: number;
	pyGrowth: number;
	momentum: number;
	budget: number;
	weather?: number;
	reservations?: number;
	crossLocation?: number;
}

export interface ForecastSuggestion {
	date: string;
	suggestedRevenue: number;
	suggestedCovers: number;
	avgCheck: number;
	confidence: number;
	reasoning: string;
	weights: ForecastWeights;
	components: {
		trailingDowAvg: number;
		pyAdjusted: number;
		momentumRevenue: number;
		budgetRevenue: number;
		weatherAdjustedRevenue?: number;
		reservationEstRevenue?: number;
		crossLocationRevenue?: number;
	};
}

export interface ModelStats {
	mape4w: number | null;
	adaptiveWeights: ForecastWeights;
	trendNotes: string[];
	accuracyRecords: number;
}

const DEFAULT_AVG_CHECK = 70;

/**
 * Calculate trailing 2-week average guest check for a location.
 * avg_check = sum(revenue) / sum(covers) for the 14 days before targetDate.
 * Falls back to DEFAULT_AVG_CHECK if no data.
 */
export async function getTrailing2WeekAvgCheck(
	locationId: string,
	targetDate: string,
): Promise<number> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const twoWeeksAgo = new Date(target);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

	// First try actuals
	const { data } = await sb
		.from('daily_actuals')
		.select('revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', twoWeeksAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('revenue', 0);

	const rows = data || [];
	let totalRev = rows.reduce((s, a) => s + (a.revenue || 0), 0);
	let totalCovers = rows.reduce((s, a) => s + (a.covers || 0), 0);

	// Fall back to accepted forecasts if no actuals
	if (totalCovers === 0 || totalRev === 0) {
		const { data: forecasts } = await sb
			.from('daily_forecasts')
			.select('manager_revenue, manager_covers')
			.eq('location_id', locationId)
			.gte('business_date', twoWeeksAgo.toISOString().split('T')[0])
			.lt('business_date', targetDate)
			.not('manager_revenue', 'is', null);
		const fRows = forecasts || [];
		totalRev = fRows.reduce((s, f) => s + (f.manager_revenue || 0), 0);
		totalCovers = fRows.reduce((s, f) => s + (f.manager_covers || 0), 0);
	}

	if (totalCovers > 0 && totalRev > 0) {
		return Math.round((totalRev / totalCovers) * 100) / 100;
	}
	return DEFAULT_AVG_CHECK;
}

// ---------------------------------------------------------------------------
// Adaptive Weights
// ---------------------------------------------------------------------------

const BASE_WEIGHTS: ForecastWeights = {
	trailing: 0.40, pyGrowth: 0.25, momentum: 0.20, budget: 0.15,
};
const WEIGHT_MIN = 0.10;
const WEIGHT_MAX = 0.50;

/** Get adaptive weights based on 28-day accuracy for this DOW. */
export async function getAdaptiveWeights(
	locationId: string,
	dayOfWeek: number,
): Promise<ForecastWeights> {
	const sb = getSupabase();
	const { data: rows } = await sb
		.from('forecast_accuracy')
		.select('actual_revenue, component_trailing, component_py, component_momentum, component_budget')
		.eq('location_id', locationId)
		.eq('day_of_week', dayOfWeek)
		.not('actual_revenue', 'is', null)
		.order('business_date', { ascending: false })
		.limit(4); // last 4 same-DOW entries (28 days)

	if (!rows || rows.length < 2) return { ...BASE_WEIGHTS };

	// For each component, compute mean absolute error vs actual
	const compErrors: Record<string, number[]> = {
		trailing: [], pyGrowth: [], momentum: [], budget: [],
	};
	for (const r of rows) {
		const actual = Number(r.actual_revenue);
		if (!actual || actual <= 0) continue;
		if (r.component_trailing > 0)
			compErrors.trailing.push(Math.abs(Number(r.component_trailing) - actual) / actual);
		if (r.component_py > 0)
			compErrors.pyGrowth.push(Math.abs(Number(r.component_py) - actual) / actual);
		if (r.component_momentum > 0)
			compErrors.momentum.push(Math.abs(Number(r.component_momentum) - actual) / actual);
		if (r.component_budget > 0)
			compErrors.budget.push(Math.abs(Number(r.component_budget) - actual) / actual);
	}

	// Convert mean error to accuracy score (1 - meanError), clamped [0,1]
	const accuracy: Record<string, number> = {};
	for (const key of Object.keys(compErrors)) {
		const errs = compErrors[key];
		if (errs.length === 0) {
			accuracy[key] = 0.5; // neutral if no data
		} else {
			const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
			accuracy[key] = Math.max(0, Math.min(1, 1 - mean));
		}
	}

	// Weight = baseWeight * accuracyScore, then normalize and clamp
	const raw: Record<string, number> = {};
	for (const key of Object.keys(BASE_WEIGHTS)) {
		raw[key] = (BASE_WEIGHTS as any)[key] * (0.5 + accuracy[key]);
	}
	const rawSum = Object.values(raw).reduce((a, b) => a + b, 0);
	const normalized: Record<string, number> = {};
	for (const key of Object.keys(raw)) {
		normalized[key] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, raw[key] / rawSum));
	}
	// Re-normalize after clamping
	const clampSum = Object.values(normalized).reduce((a, b) => a + b, 0);
	return {
		trailing: Math.round((normalized.trailing / clampSum) * 1000) / 1000,
		pyGrowth: Math.round((normalized.pyGrowth / clampSum) * 1000) / 1000,
		momentum: Math.round((normalized.momentum / clampSum) * 1000) / 1000,
		budget: Math.round((normalized.budget / clampSum) * 1000) / 1000,
	};
}

// ---------------------------------------------------------------------------
// Trend Detection
// ---------------------------------------------------------------------------

function detectTrends(
	sameDowActuals: { revenue: number; covers: number; business_date: string }[],
	dayName: string,
): string[] {
	const notes: string[] = [];
	if (sameDowActuals.length < 3) return notes;

	// Sort oldest first
	const sorted = [...sameDowActuals].sort((a, b) => a.business_date.localeCompare(b.business_date));

	// Revenue trend: check last 3+ consecutive same-DOW entries
	const revs = sorted.map((r) => r.revenue).filter((r) => r > 0);
	if (revs.length >= 3) {
		const last3 = revs.slice(-3);
		const allUp = last3.every((v, i) => i === 0 || v > last3[i - 1]);
		const allDown = last3.every((v, i) => i === 0 || v < last3[i - 1]);
		const pctChange = revs.length >= 2
			? ((revs[revs.length - 1] - revs[0]) / revs[0]) * 100
			: 0;

		if (allUp) notes.push(`Upward ${dayName} trend detected (+${pctChange.toFixed(1)}% over ${revs.length} weeks)`);
		else if (allDown) notes.push(`Downward ${dayName} trend: ${pctChange.toFixed(1)}% over ${revs.length} weeks`);
	}

	// Avg check shift
	const checks = sorted
		.filter((r) => r.revenue > 0 && r.covers > 0)
		.map((r) => ({ check: r.revenue / r.covers, date: r.business_date }));
	if (checks.length >= 2) {
		const first = checks[0].check;
		const last = checks[checks.length - 1].check;
		const shift = Math.abs(last - first);
		if (shift > 2) {
			notes.push(`Avg check shifting: $${first.toFixed(0)} -> $${last.toFixed(0)} over ${checks.length} weeks`);
		}
	}

	return notes;
}

// ---------------------------------------------------------------------------
// Forecast Generation
// ---------------------------------------------------------------------------

/** Generate AI forecast suggestion for a specific date */
export async function generateForecastSuggestion(
	locationId: string,
	targetDate: string,
): Promise<ForecastSuggestion> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay(); // 0=Sun, 1=Mon, ...
	const dayNames = [
		'Sunday',
		'Monday',
		'Tuesday',
		'Wednesday',
		'Thursday',
		'Friday',
		'Saturday',
	];

	// Adaptive weights based on recent accuracy
	const W = await getAdaptiveWeights(locationId, dayOfWeek);

	// --- Component 1: 2-week trailing DOW average ---
	const twoWeeksAgo = new Date(target);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

	const { data: recentActuals } = await sb
		.from('daily_actuals')
		.select('business_date, revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', twoWeeksAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.not('revenue', 'is', null);

	const sameDowRecent = (recentActuals || []).filter((a) => {
		return new Date(a.business_date + 'T12:00:00').getDay() === dayOfWeek;
	});

	let trailingDowAvg = 0;
	let trailingDowCovers = 0;

	if (sameDowRecent.length > 0) {
		trailingDowAvg = sameDowRecent.reduce((s, a) => s + (a.revenue || 0), 0) / sameDowRecent.length;
		trailingDowCovers = Math.round(sameDowRecent.reduce((s, a) => s + (a.covers || 0), 0) / sameDowRecent.length);
	} else {
		// Fall back to budget data for same DOW
		const { data: budgetData } = await sb
			.from('daily_budget')
			.select('business_date, budget_revenue')
			.eq('location_id', locationId)
			.gte('business_date', twoWeeksAgo.toISOString().split('T')[0])
			.lt('business_date', targetDate)
			.gt('budget_revenue', 0);
		const sameDowBudget = (budgetData || []).filter(b => new Date(b.business_date + 'T12:00:00').getDay() === dayOfWeek);
		if (sameDowBudget.length > 0) {
			trailingDowAvg = sameDowBudget.reduce((s, b) => s + (b.budget_revenue || 0), 0) / sameDowBudget.length;
		}
	}

	// --- Component 2: PY same-DOW (52 weeks back) * YOY growth ---
	const pyResult = await lookupPriorYear(locationId, targetDate);
	const { pyRevenue, yoyGrowthFactor, pyAdjusted } = pyResult;

	// --- YTD Trend Analysis (fiscal year comparison) ---
	const ytdTrend = await computeYtdTrend(locationId, targetDate);

	// --- Component 3: Recent momentum (7d MA vs 14d MA) ---
	const sevenDaysAgo = new Date(target);
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

	const last14 = (recentActuals || []).filter(
		(a) => a.revenue && a.revenue > 0,
	);
	const last7 = last14.filter(
		(a) => new Date(a.business_date) >= sevenDaysAgo,
	);

	const avg7 =
		last7.length > 0
			? last7.reduce((s, a) => s + a.revenue, 0) / last7.length
			: 0;
	const avg14 =
		last14.length > 0
			? last14.reduce((s, a) => s + a.revenue, 0) / last14.length
			: 0;
	const momentumFactor = avg14 > 0 ? avg7 / avg14 : 1.0;
	const momentumRevenue =
		trailingDowAvg > 0 ? trailingDowAvg * momentumFactor : 0;

	// --- Component 4: Budget baseline ---
	// Use the median threshold bracket / 7 as daily budget estimate
	const { data: allThresholds } = await sb
		.from('labor_thresholds')
		.select('revenue_bracket_low, revenue_bracket_high')
		.eq('location_id', locationId)
		.order('revenue_bracket_low', { ascending: true });

	let budgetRevenue = 0;
	if (allThresholds && allThresholds.length > 0) {
		const midIdx = Math.floor(allThresholds.length / 2);
		const midBracket = allThresholds[midIdx];
		budgetRevenue =
			(midBracket.revenue_bracket_low + midBracket.revenue_bracket_high) /
			2 /
			7;
	}

	// --- Component 5: Enhanced weather signal ---
	let weatherAdjustedRevenue = 0;
	let weatherNote = '';
	const weatherData = await withTimeout(
		getWeatherForDate(locationId, targetDate), 5000, null,
	);
	if (weatherData) {
		const weatherResult = await computeWeatherImpact(
			locationId, targetDate, dayOfWeek, dayNames[dayOfWeek],
			trailingDowAvg, weatherData,
		);
		weatherAdjustedRevenue = weatherResult.adjustedRevenue;
		weatherNote = weatherResult.weatherNote;
		W.weather = 0.10;
	}

	// --- Component 6: Reservation signal (only for locations that use Resy) ---
	let reservationEstRevenue = 0;
	let reservationNote = '';

	// Check if this location uses Resy before fetching reservation data
	const { data: locationRow } = await sb
		.from('locations')
		.select('uses_resy')
		.eq('id', locationId)
		.maybeSingle();
	const usesResy = locationRow?.uses_resy ?? false;

	if (usesResy) {
		const resoData = await getReservationsForDate(locationId, targetDate);
		if (resoData && resoData.booked_covers > 0) {
			const avgCheck = await getTrailing2WeekAvgCheck(locationId, targetDate);
			const walkinRatio = await getHistoricalWalkinRatio(locationId);
			const estWalkins = Math.round(resoData.booked_covers * walkinRatio);
			const estTotalCovers = resoData.booked_covers + estWalkins;
			reservationEstRevenue = estTotalCovers * avgCheck;

			const peakNote = resoData.peak_hour ? `, peak at ${resoData.peak_hour}` : '';
			reservationNote = `Resy: ${resoData.booked_covers} covers booked (est. $${Math.round(reservationEstRevenue).toLocaleString()} incl. ~${estWalkins} walk-ins${peakNote})`;
			W.reservations = 0.15;
		}
	}

	// --- Components 7-9: Cross-location, Events, Market (run in parallel with timeouts) ---
	let crossLocationRevenue = 0;
	let crossLocationNote = '';
	let eventNote = '';
	let eventMultiplier = 1.0;
	let marketNote = '';
	let marketAdjustment = 0;

	const [crossSignalResult, eventResult, marketResult] = await Promise.all([
		withTimeout(
			getCrossLocationSignal(locationId, targetDate).catch(() => null),
			5000, null,
		),
		withTimeout(
			getEventImpact(locationId, targetDate).catch(() => null),
			5000, null,
		),
		withTimeout(
			getMarketConditions(targetDate).catch(() => null),
			5000, null,
		),
	]);

	if (crossSignalResult && crossSignalResult.impactPct !== 0 && crossSignalResult.confidence > 0.3) {
		const baseForCross = trailingDowAvg > 0 ? trailingDowAvg : budgetRevenue;
		if (baseForCross > 0) {
			crossLocationRevenue = baseForCross * (1 + crossSignalResult.impactPct / 100);
			crossLocationNote = crossSignalResult.reasoning;
			W.crossLocation = 0.05 + (crossSignalResult.confidence * 0.05);
		}
	}

	if (eventResult && eventResult.impactMultiplier !== 1.0) {
		eventMultiplier = eventResult.impactMultiplier;
		eventNote = eventResult.reasoning;
	}

	if (marketResult && marketResult.forecastAdjustment !== 0) {
		marketAdjustment = marketResult.forecastAdjustment;
		marketNote = marketResult.reasoning;
	}

	// --- Weighted blend ---
	// When new signals are available, adjust base weights down proportionally
	const extraWeight = (W.weather || 0) + (W.reservations || 0) + (W.crossLocation || 0);
	const baseScale = extraWeight > 0 ? (1 - extraWeight) : 1;

	const activeComponents: { value: number; weight: number }[] = [];
	if (trailingDowAvg > 0)
		activeComponents.push({ value: trailingDowAvg, weight: W.trailing * baseScale });
	if (pyAdjusted > 0)
		activeComponents.push({ value: pyAdjusted, weight: W.pyGrowth * baseScale });
	if (momentumRevenue > 0)
		activeComponents.push({ value: momentumRevenue, weight: W.momentum * baseScale });
	if (budgetRevenue > 0)
		activeComponents.push({ value: budgetRevenue, weight: W.budget * baseScale });
	if (weatherAdjustedRevenue > 0 && W.weather)
		activeComponents.push({ value: weatherAdjustedRevenue, weight: W.weather });
	if (reservationEstRevenue > 0 && W.reservations)
		activeComponents.push({ value: reservationEstRevenue, weight: W.reservations });
	if (crossLocationRevenue > 0 && W.crossLocation)
		activeComponents.push({ value: crossLocationRevenue, weight: W.crossLocation });

	let suggestedRevenue = 0;
	if (activeComponents.length > 0) {
		const totalWeight = activeComponents.reduce(
			(s, c) => s + c.weight,
			0,
		);
		suggestedRevenue = activeComponents.reduce(
			(s, c) => s + c.value * (c.weight / totalWeight),
			0,
		);
	}
	suggestedRevenue = Math.round(suggestedRevenue * 100) / 100;

	// Compute covers from trailing 2-week avg check
	const avgCheck = await getTrailing2WeekAvgCheck(locationId, targetDate);
	const suggestedCovers =
		avgCheck > 0 ? Math.round(suggestedRevenue / avgCheck) : 0;

	// Confidence scoring
	let confidence = 0.3;
	if (sameDowRecent.length >= 2) confidence += 0.2;
	if (pyRevenue > 0) confidence += 0.15;
	if (ytdTrend.ytdRevenue > 0 && ytdTrend.ytdPyRevenue > 0) confidence += 0.05;
	if (last7.length >= 5) confidence += 0.1;
	if (budgetRevenue > 0) confidence += 0.05;
	if (weatherData) confidence += 0.05;
	if (reservationEstRevenue > 0) confidence += 0.1; // strong Resy signal
	if (W.crossLocation && crossLocationRevenue > 0) confidence += 0.05;
	if (eventMultiplier !== 1.0) confidence += 0.05;
	confidence = Math.min(confidence, 0.95);

	// Trend detection from same-DOW actuals (up to 8 weeks back for trends)
	const eightWeeksAgo = new Date(target);
	eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
	const { data: trendActuals } = await sb
		.from('daily_actuals')
		.select('business_date, revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', eightWeeksAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.not('revenue', 'is', null);

	const sameDowTrend = (trendActuals || [])
		.filter((a) => new Date(a.business_date + 'T12:00:00').getDay() === dayOfWeek && a.revenue > 0);
	const trendNotes = detectTrends(sameDowTrend, dayNames[dayOfWeek]);

	// --- Override Tag Impact Learning ---
	const tagNotes = await learnOverrideTagImpacts(locationId, dayOfWeek, dayNames[dayOfWeek], trailingDowAvg);
	for (const n of tagNotes) trendNotes.push(n);

	// Check for systematic over/under-forecasting
	const bias = await applyBiasCorrection(locationId, dayOfWeek, dayNames[dayOfWeek], suggestedRevenue);
	suggestedRevenue = bias.correctedRevenue;
	if (bias.biasNote) trendNotes.push(bias.biasNote);

	// --- Guest Behavior Signal ---
	let guestBehaviorNote = '';
	try {
		const guestBehavior = await getGuestBehaviorForecast(locationId, targetDate);
		if (guestBehavior.revenueAdjustmentPct !== 0 && suggestedRevenue > 0) {
			suggestedRevenue = Math.round(suggestedRevenue * (1 + guestBehavior.revenueAdjustmentPct / 100) * 100) / 100;
		}
		if (guestBehavior.reasoning.length > 0) {
			guestBehaviorNote = `Guest signals: ${guestBehavior.reasoning.join('; ')}`;
		}
		if (guestBehavior.revenueAdjustmentPct !== 0 || guestBehavior.coverAdjustmentPct !== 0) {
			confidence = Math.min(confidence + 0.05, 0.95);
		}
	} catch (_) { /* non-critical — don't fail forecast */ }

	// Apply YTD trend scaling factor
	if (ytdTrend.scalingFactor !== 1.0 && suggestedRevenue > 0) {
		suggestedRevenue = Math.round(suggestedRevenue * ytdTrend.scalingFactor * 100) / 100;
	}

	// Apply event impact multiplier (holidays, concerts, festivals)
	if (eventMultiplier !== 1.0 && suggestedRevenue > 0) {
		suggestedRevenue = Math.round(suggestedRevenue * eventMultiplier * 100) / 100;
	}

	// Apply market signal adjustment (gas prices, inflation)
	if (marketAdjustment !== 0 && suggestedRevenue > 0) {
		suggestedRevenue = Math.round(suggestedRevenue * (1 + marketAdjustment) * 100) / 100;
	}

	// --- Revenue Enhancements (validate/challenge budget assumptions) ---
	let revenueEnhancementNote = '';
	try {
		const enhancements = await withTimeout(
			getRevenueEnhancements(locationId, targetDate), 8000,
			{ adjustmentFactor: 1.0, reasoning: [], components: { priceElasticity: 1, reservationPace: 1, neighborhoodDemand: 1, causalImpact: 1, dayPartDecomposition: 1, crossSell: 1, checkAvgMomentum: 1 } },
		);
		if (enhancements.adjustmentFactor !== 1.0 && suggestedRevenue > 0) {
			suggestedRevenue = Math.round(suggestedRevenue * enhancements.adjustmentFactor * 100) / 100;
		}
		if (enhancements.reasoning.length > 0) {
			revenueEnhancementNote = enhancements.reasoning.join(' | ');
			confidence = Math.min(confidence + 0.03, 0.95);
		}
	} catch (_) { /* non-critical — don't fail forecast */ }

	// --- Proprietary Signal Stack (HELIXO neural signals) ---
	let resoVelocityNote = '';
	let wxSentimentNote = '';
	let paycheckNote = '';
	let holidayNote = '';
	let compSpilloverNote = '';

	try {
		const [resoVel, wxSent, paycheck, holiday, compSpill] = await Promise.all([
			withTimeout(reservationVelocity(locationId, targetDate), 3000, { multiplier: 1.0, note: '' }),
			withTimeout(weatherSentiment(locationId, targetDate), 3000, { multiplier: 1.0, note: '' }),
			Promise.resolve(paycheckCycleBoost(targetDate)),
			Promise.resolve(holidayProximity(targetDate)),
			withTimeout(competitiveSpillover(locationId, targetDate), 3000, { multiplier: 1.0, note: '' }),
		]);

		// Apply reservation velocity
		if (resoVel.multiplier !== 1.0 && suggestedRevenue > 0) {
			suggestedRevenue = Math.round(suggestedRevenue * resoVel.multiplier * 100) / 100;
			resoVelocityNote = resoVel.note;
		}

		// Apply weather sentiment (only if we didn't already apply weather from component 5)
		if (wxSent.multiplier !== 1.0 && suggestedRevenue > 0 && !weatherAdjustedRevenue) {
			suggestedRevenue = Math.round(suggestedRevenue * wxSent.multiplier * 100) / 100;
			wxSentimentNote = wxSent.note;
		}

		// Apply paycheck cycle boost
		if (paycheck.multiplier !== 1.0 && suggestedRevenue > 0) {
			suggestedRevenue = Math.round(suggestedRevenue * paycheck.multiplier * 100) / 100;
			paycheckNote = paycheck.note;
		}

		// Apply holiday proximity
		if (holiday.multiplier !== 1.0 && suggestedRevenue > 0) {
			suggestedRevenue = Math.round(suggestedRevenue * holiday.multiplier * 100) / 100;
			holidayNote = holiday.note;
		}

		// Apply competitive spillover
		if (compSpill.multiplier !== 1.0 && suggestedRevenue > 0) {
			suggestedRevenue = Math.round(suggestedRevenue * compSpill.multiplier * 100) / 100;
			compSpilloverNote = compSpill.note;
		}

		// Boost confidence for each active proprietary signal
		const signalCount = [resoVel, wxSent, paycheck, holiday, compSpill]
			.filter((s) => s.multiplier !== 1.0).length;
		if (signalCount > 0) {
			confidence = Math.min(confidence + signalCount * 0.02, 0.95);
		}
	} catch (_) { /* non-critical — don't fail forecast */ }

	// Reasoning summary
	const parts: string[] = [];
	const actualDays = (recentActuals || []).filter((a) => a.revenue && a.revenue > 0).length;

	// Weight info
	const isAdaptive = W.trailing !== 0.4 || W.pyGrowth !== 0.25 || W.momentum !== 0.2 || W.budget !== 0.15;
	parts.push(`Weights: trailing ${(W.trailing * 100).toFixed(0)}%, PY ${(W.pyGrowth * 100).toFixed(0)}%, momentum ${(W.momentum * 100).toFixed(0)}%, budget ${(W.budget * 100).toFixed(0)}%${isAdaptive ? ' (adaptive)' : ''}`);

	if (actualDays < 14) {
		parts.push(`Limited data (${actualDays} days) -- weights favor budget baseline`);
	}

	if (trailingDowAvg > 0)
		parts.push(
			`2-wk ${dayNames[dayOfWeek]} avg: $${Math.round(trailingDowAvg).toLocaleString()}`,
		);
	if (pyAdjusted > 0)
		parts.push(
			`PY adj (${yoyGrowthFactor > 1 ? '+' : ''}${((yoyGrowthFactor - 1) * 100).toFixed(1)}% YOY): $${Math.round(pyAdjusted).toLocaleString()}`,
		);
	if (ytdTrend.reasoningNote) parts.push(ytdTrend.reasoningNote);
	if (momentumRevenue > 0 && momentumFactor !== 1)
		parts.push(
			`momentum ${momentumFactor > 1 ? '+' : ''}${((momentumFactor - 1) * 100).toFixed(1)}%`,
		);
	if (budgetRevenue > 0) {
		parts.push(`budget: $${Math.round(budgetRevenue).toLocaleString()}/day`);
	}
	if (weatherNote) parts.push(weatherNote);
	if (reservationNote) parts.push(reservationNote);
	if (crossLocationNote) parts.push(crossLocationNote);
	if (eventNote) parts.push(eventNote);
	if (marketNote) parts.push(marketNote);
	if (revenueEnhancementNote) parts.push(revenueEnhancementNote);
	if (guestBehaviorNote) parts.push(guestBehaviorNote);
	if (resoVelocityNote) parts.push(resoVelocityNote);
	if (wxSentimentNote) parts.push(wxSentimentNote);
	if (paycheckNote) parts.push(paycheckNote);
	if (holidayNote) parts.push(holidayNote);
	if (compSpilloverNote) parts.push(compSpilloverNote);
	if (confidence >= 0.8) parts.push('High confidence -- strong signal alignment');

	// Add trend insights
	for (const note of trendNotes) parts.push(note);

	const reasoning = parts.join(' | ');

	return {
		date: targetDate,
		suggestedRevenue,
		suggestedCovers,
		avgCheck,
		confidence,
		reasoning,
		weights: W,
		components: {
			trailingDowAvg,
			pyAdjusted,
			momentumRevenue,
			budgetRevenue,
			weatherAdjustedRevenue: weatherAdjustedRevenue || undefined,
			reservationEstRevenue: reservationEstRevenue || undefined,
			crossLocationRevenue: crossLocationRevenue || undefined,
		},
	};
}

// Re-export acceptForecast from its dedicated module
export { acceptForecast } from './forecast-accept';

// ---------------------------------------------------------------------------
// Ensemble Integration
// ---------------------------------------------------------------------------

import {
	generateEnsembleForecast,
	isEnsembleEnabled,
	type EnsembleForecast,
} from './ensemble';

export type { EnsembleForecast };

/**
 * Generate a forecast using the ensemble if enabled for the location,
 * otherwise fall back to the statistical-only model.
 *
 * When useEnsemble is 'auto', checks if the neural model has been trained
 * for this location. If so, runs the full ensemble. Otherwise falls back
 * to the statistical model transparently.
 */
export async function generateForecast(
	locationId: string,
	targetDate: string,
	useEnsemble: boolean | 'auto' = 'auto',
): Promise<ForecastSuggestion & { ensemble?: EnsembleForecast }> {
	let shouldUseEnsemble = useEnsemble === true;

	if (useEnsemble === 'auto') {
		shouldUseEnsemble = await isEnsembleEnabled(locationId);
	}

	if (shouldUseEnsemble) {
		const ensemble = await generateEnsembleForecast(locationId, targetDate);
		const suggestion = ensemble.statisticalSuggestion;
		return {
			...suggestion,
			suggestedRevenue: ensemble.revenue,
			confidence: ensemble.confidence,
			reasoning: ensemble.reasoning,
			ensemble,
		};
	}

	return generateForecastSuggestion(locationId, targetDate);
}

// ---------------------------------------------------------------------------
// Batch Forecast Generation
// ---------------------------------------------------------------------------

/** Generate forecasts for all days in a period (parallel with caching) */
export async function generatePeriodForecasts(
	locationId: string,
	startDate: string,
	endDate: string,
	useEnsemble: boolean | 'auto' = 'auto',
): Promise<ForecastSuggestion[]> {
	const start = new Date(startDate + 'T12:00:00');
	const end = new Date(endDate + 'T12:00:00');
	const dates: string[] = [];

	for (
		let d = new Date(start);
		d <= end;
		d.setDate(d.getDate() + 1)
	) {
		dates.push(d.toISOString().split('T')[0]);
	}

	// Run all dates in parallel; each date's forecast is independent
	const suggestions = await Promise.all(
		dates.map(async (dateStr) => {
			// Check in-memory cache first
			const cacheKey = getCacheKey(locationId, dateStr);
			const cached = suggestionCache.get(cacheKey);
			if (cached && (Date.now() - cached.cachedAt) < SUGGESTION_CACHE_TTL_MS) {
				return cached.suggestion;
			}

			const suggestion = await generateForecast(
				locationId,
				dateStr,
				useEnsemble,
			);

			// Store in cache
			suggestionCache.set(cacheKey, {
				suggestion,
				cachedAt: Date.now(),
			});

			return suggestion;
		}),
	);

	return suggestions;
}
