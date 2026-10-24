/**
 * Neural forecast data loading and feature engineering.
 *
 * Extracted from neural-forecast.ts to keep files under 500 lines.
 * Handles training data construction from Supabase and runtime
 * feature building for inference.
 */

import { getSupabase } from '$lib/server/supabase';
import type { NeuralFeatures, ModelWeights } from './neural-forecast';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

export function featuresToVector(f: NeuralFeatures): number[] {
	return [
		...f.dowOneHot,
		f.weekInPeriod,
		f.periodNumber,
		f.month,
		f.isHoliday,
		f.weatherTemp,
		f.weatherPrecip,
		f.resyCovers,
		f.pyRevenue,
		f.trailingDowAvg,
		f.budget,
		f.checkAvgTrend,
		f.dowRevenueShare,
	];
}

function getIsoWeekKey(d: Date): string {
	const jan1 = new Date(d.getFullYear(), 0, 1);
	const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
	return `${d.getFullYear()}-W${week}`;
}

function computeTrailingDowAvg(
	actuals: { business_date: string; revenue: number }[],
	currentIdx: number,
	dow: number,
): number {
	const matches: number[] = [];
	for (let j = currentIdx - 1; j >= Math.max(0, currentIdx - 14); j--) {
		const d = new Date(actuals[j].business_date + 'T12:00:00');
		if (d.getDay() === dow && actuals[j].revenue > 0) {
			matches.push(Number(actuals[j].revenue));
		}
	}
	return matches.length > 0 ? matches.reduce((a, b) => a + b, 0) / matches.length : 0;
}

function computeCheckTrend(
	actuals: { business_date: string; revenue: number; covers: number }[],
	currentIdx: number,
): number {
	const recent: number[] = [];
	const older: number[] = [];
	for (let j = currentIdx - 1; j >= Math.max(0, currentIdx - 30); j--) {
		const check = actuals[j].covers > 0 ? actuals[j].revenue / actuals[j].covers : 0;
		if (check <= 0) continue;
		if (j >= currentIdx - 15) recent.push(check);
		else older.push(check);
	}
	if (recent.length === 0 || older.length === 0) return 0;
	const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
	const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;
	return avgOlder > 0 ? Math.max(-0.5, Math.min(0.5, (avgRecent - avgOlder) / avgOlder)) : 0;
}

// ---------------------------------------------------------------------------
// Training data loader
// ---------------------------------------------------------------------------

export interface TrainingSample {
	features: number[];
	target: number; // normalized revenue
}

export async function loadTrainingData(
	locationId: string,
): Promise<{ samples: TrainingSample[]; avgRevenue: number; maxCovers: number }> {
	const sb = getSupabase();

	const { data: actuals } = await sb
		.from('daily_actuals')
		.select('business_date, revenue, covers')
		.eq('location_id', locationId)
		.gt('revenue', 0)
		.order('business_date', { ascending: true });

	if (!actuals || actuals.length < 30) {
		return { samples: [], avgRevenue: 0, maxCovers: 0 };
	}

	const revenues = actuals.map((r) => Number(r.revenue));
	const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length;
	const maxCovers = Math.max(...actuals.map((r) => Number(r.covers) || 1), 1);

	// Load supporting data in parallel
	const [budgetRes, weatherRes, pyActuals] = await Promise.all([
		sb.from('daily_budget').select('business_date, budget_revenue').eq('location_id', locationId),
		sb.from('daily_weather').select('business_date, temp_high, precipitation_pct').eq('location_id', locationId),
		sb.from('daily_actuals').select('business_date, revenue').eq('location_id', locationId).gt('revenue', 0),
	]);

	const budgetMap = new Map<string, number>();
	for (const b of budgetRes.data || []) budgetMap.set(b.business_date, Number(b.budget_revenue) || 0);

	const weatherMap = new Map<string, { temp: number; precip: number }>();
	for (const w of weatherRes.data || []) {
		weatherMap.set(w.business_date, { temp: Number(w.temp_high) || 70, precip: Number(w.precipitation_pct) || 0 });
	}

	const dateRevMap = new Map<string, number>();
	for (const a of pyActuals.data || []) dateRevMap.set(a.business_date, Number(a.revenue));

	const weeklyTotals = new Map<string, number>();
	for (const a of actuals) {
		const d = new Date(a.business_date + 'T12:00:00');
		const weekKey = getIsoWeekKey(d);
		weeklyTotals.set(weekKey, (weeklyTotals.get(weekKey) || 0) + Number(a.revenue));
	}

	const samples: TrainingSample[] = [];

	for (let i = 14; i < actuals.length; i++) {
		const row = actuals[i];
		const d = new Date(row.business_date + 'T12:00:00');
		const dow = d.getDay();
		const month = d.getMonth() + 1;
		const revenue = Number(row.revenue);

		const dowOneHot = [0, 0, 0, 0, 0, 0, 0];
		dowOneHot[dow] = 1;

		const dayOfYear = Math.floor((d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000);
		const weekInPeriod = clamp01((dayOfYear % 28) / 28);
		const periodNumber = clamp01(Math.ceil(dayOfYear / 28) / 13);

		const weather = weatherMap.get(row.business_date);
		const pyDate = new Date(d);
		pyDate.setDate(pyDate.getDate() - 364);
		const pyRev = dateRevMap.get(pyDate.toISOString().split('T')[0]) || 0;
		const trailing = computeTrailingDowAvg(actuals, i, dow);
		const budgetRev = budgetMap.get(row.business_date) || 0;
		const checkTrend = computeCheckTrend(actuals, i);
		const weekKey = getIsoWeekKey(d);
		const weekTotal = weeklyTotals.get(weekKey) || revenue;
		const dowShare = weekTotal > 0 ? clamp01(revenue / weekTotal) : 0;

		const features = featuresToVector({
			dowOneHot,
			weekInPeriod,
			periodNumber,
			month: clamp01(month / 12),
			isHoliday: 0,
			weatherTemp: clamp01((weather?.temp ?? 70) / 110),
			weatherPrecip: clamp01((weather?.precip ?? 0) / 100),
			resyCovers: clamp01((Number(row.covers) || 0) / maxCovers),
			pyRevenue: avgRevenue > 0 ? clamp01(pyRev / (avgRevenue * 2)) : 0,
			trailingDowAvg: avgRevenue > 0 ? clamp01(trailing / (avgRevenue * 2)) : 0,
			budget: avgRevenue > 0 ? clamp01(budgetRev / (avgRevenue * 2)) : 0,
			checkAvgTrend: clamp01(checkTrend + 0.5),
			dowRevenueShare: dowShare,
		});

		samples.push({ features, target: avgRevenue > 0 ? revenue / (avgRevenue * 2) : 0 });
	}

	return { samples, avgRevenue, maxCovers };
}

// ---------------------------------------------------------------------------
// Runtime feature builder (for inference on a specific date)
// ---------------------------------------------------------------------------

export async function buildFeaturesForDate(
	locationId: string,
	targetDate: string,
	loadModelFn: (locId: string) => Promise<ModelWeights | null>,
): Promise<NeuralFeatures> {
	const sb = getSupabase();
	const d = new Date(targetDate + 'T12:00:00');
	const dow = d.getDay();
	const month = d.getMonth() + 1;
	const dayOfYear = Math.floor(
		(d.getTime() - new Date(d.getFullYear(), 0, 0).getTime()) / 86400000,
	);

	const model = await loadModelFn(locationId);
	const avgRev = model?.featureConfig.locationAvgRevenue || 10000;
	const maxCovers = model?.featureConfig.locationMaxCovers || 200;

	const dowOneHot = [0, 0, 0, 0, 0, 0, 0];
	dowOneHot[dow] = 1;
	const weekInPeriod = clamp01((dayOfYear % 28) / 28);
	const periodNumber = clamp01(Math.ceil(dayOfYear / 28) / 13);

	// Parallel data fetches
	const [weatherRes, resoRes, pyRes, trailingRes, budgetRes, checkRes, weekRes] =
		await Promise.all([
			sb.from('daily_weather').select('temp_high, precipitation_pct')
				.eq('location_id', locationId).eq('business_date', targetDate).maybeSingle(),
			sb.from('resy_reservations').select('booked_covers')
				.eq('location_id', locationId).eq('business_date', targetDate).maybeSingle(),
			(() => {
				const pyDate = new Date(d); pyDate.setDate(pyDate.getDate() - 364);
				return sb.from('daily_actuals').select('revenue')
					.eq('location_id', locationId).eq('business_date', pyDate.toISOString().split('T')[0])
					.gt('revenue', 0).maybeSingle();
			})(),
			(() => {
				const twa = new Date(d); twa.setDate(twa.getDate() - 14);
				return sb.from('daily_actuals').select('business_date, revenue')
					.eq('location_id', locationId)
					.gte('business_date', twa.toISOString().split('T')[0])
					.lt('business_date', targetDate).gt('revenue', 0);
			})(),
			sb.from('daily_budget').select('budget_revenue')
				.eq('location_id', locationId).eq('business_date', targetDate).maybeSingle(),
			(() => {
				const tda = new Date(d); tda.setDate(tda.getDate() - 30);
				return sb.from('daily_actuals').select('revenue, covers')
					.eq('location_id', locationId)
					.gte('business_date', tda.toISOString().split('T')[0])
					.lt('business_date', targetDate).gt('covers', 0);
			})(),
			(() => {
				const owa = new Date(d); owa.setDate(owa.getDate() - 7);
				return sb.from('daily_actuals').select('business_date, revenue')
					.eq('location_id', locationId)
					.gte('business_date', owa.toISOString().split('T')[0])
					.lt('business_date', targetDate).gt('revenue', 0);
			})(),
		]);

	const weather = weatherRes.data;
	const reso = resoRes.data;
	const pyRow = pyRes.data;
	const trailingRows = trailingRes.data || [];
	const budgetRow = budgetRes.data;
	const checkRows = checkRes.data || [];
	const weekRows = weekRes.data || [];

	const sameDow = trailingRows.filter(
		(r: any) => new Date(r.business_date + 'T12:00:00').getDay() === dow,
	);
	const trailingAvg = sameDow.length > 0
		? sameDow.reduce((s: number, r: any) => s + Number(r.revenue), 0) / sameDow.length
		: 0;

	let checkTrend = 0;
	if (checkRows.length >= 10) {
		const half = Math.floor(checkRows.length / 2);
		const recentChecks = checkRows.slice(half).map((r: any) => r.revenue / r.covers);
		const olderChecks = checkRows.slice(0, half).map((r: any) => r.revenue / r.covers);
		const avgRecent = recentChecks.reduce((a: number, b: number) => a + b, 0) / recentChecks.length;
		const avgOlder = olderChecks.reduce((a: number, b: number) => a + b, 0) / olderChecks.length;
		checkTrend = avgOlder > 0 ? Math.max(-0.5, Math.min(0.5, (avgRecent - avgOlder) / avgOlder)) : 0;
	}

	const weekTotal = weekRows.reduce((s: number, r: any) => s + Number(r.revenue), 0);
	const sameDowWeek = weekRows.filter(
		(r: any) => new Date(r.business_date + 'T12:00:00').getDay() === dow,
	);
	const dowRevInWeek = sameDowWeek.reduce((s: number, r: any) => s + Number(r.revenue), 0);
	const dowShare = weekTotal > 0 ? dowRevInWeek / weekTotal : 1 / 7;

	return {
		dowOneHot,
		weekInPeriod,
		periodNumber,
		month: clamp01(month / 12),
		isHoliday: 0,
		weatherTemp: clamp01((Number(weather?.temp_high) || 70) / 110),
		weatherPrecip: clamp01((Number(weather?.precipitation_pct) || 0) / 100),
		resyCovers: clamp01((Number(reso?.booked_covers) || 0) / maxCovers),
		pyRevenue: avgRev > 0 ? clamp01((Number(pyRow?.revenue) || 0) / (avgRev * 2)) : 0,
		trailingDowAvg: avgRev > 0 ? clamp01(trailingAvg / (avgRev * 2)) : 0,
		budget: avgRev > 0 ? clamp01((Number(budgetRow?.budget_revenue) || 0) / (avgRev * 2)) : 0,
		checkAvgTrend: clamp01(checkTrend + 0.5),
		dowRevenueShare: clamp01(dowShare),
	};
}
