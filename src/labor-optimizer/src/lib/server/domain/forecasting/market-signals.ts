/**
 * Market & External Signals — tracks slow-moving economic indicators
 * that modestly influence restaurant revenue forecasts.
 *
 * Sources:
 *   1. EIA API (free) — retail gasoline prices
 *   2. BLS API (free) — Consumer Price Index (CPI)
 *   3. Hardcoded fallbacks when APIs unavailable
 *
 * These are monthly signals — queried once and cached for 30 days.
 */

import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketConditions {
	gasPrice: number | null;
	gasTrend: 'rising' | 'falling' | 'stable' | 'unknown';
	gasTrendPct: number;
	inflationRate: number | null;
	consumerConfidence: number | null;
	forecastAdjustment: number;  // e.g., -0.02 means -2%
	reasoning: string;
}

interface IndicatorRow {
	indicator_type: string;
	date: string;
	value: number;
	source: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_DAYS = 30;
const GAS_RISING_THRESHOLD = 0.10;  // 10% QoQ
const GAS_FALLING_THRESHOLD = -0.10;

// ---------------------------------------------------------------------------
// EIA API — Retail Gasoline Prices
// ---------------------------------------------------------------------------

/**
 * Fetch weekly retail gasoline price from EIA open data API.
 * Series: PET.EMM_EPMRU_PTE_NUS_DPG.W (US regular gasoline, weekly)
 */
async function fetchGasPrice(): Promise<{ price: number; date: string } | null> {
	const apiKey = process.env.EIA_API_KEY;
	if (!apiKey) return null;

	try {
		const url = new URL('https://api.eia.gov/v2/petroleum/pri/gnd/data/');
		url.searchParams.set('api_key', apiKey);
		url.searchParams.set('frequency', 'weekly');
		url.searchParams.set('data[0]', 'value');
		url.searchParams.set('facets[product][]', 'EPM0');
		url.searchParams.set('facets[duoarea][]', 'NUS');
		url.searchParams.set('sort[0][column]', 'period');
		url.searchParams.set('sort[0][direction]', 'desc');
		url.searchParams.set('offset', '0');
		url.searchParams.set('length', '1');

		const res = await fetch(url.toString());
		if (!res.ok) return null;

		const data = await res.json();
		const row = data?.response?.data?.[0];
		if (!row || !row.value) return null;

		return {
			price: parseFloat(row.value),
			date: row.period || new Date().toISOString().split('T')[0],
		};
	} catch (err: any) {
		console.error('[MarketSignals] EIA fetch failed:', err.message);
		return null;
	}
}

// ---------------------------------------------------------------------------
// BLS API — Consumer Price Index
// ---------------------------------------------------------------------------

/**
 * Fetch latest CPI-U (all items) from BLS public API.
 * Series: CUUR0000SA0 (CPI-U, US city average, all items, seasonally adjusted)
 */
async function fetchCPI(): Promise<{ value: number; date: string } | null> {
	const apiKey = process.env.BLS_API_KEY; // optional, higher rate limits with key

	try {
		const currentYear = new Date().getFullYear();
		const body: any = {
			seriesid: ['CUUR0000SA0'],
			startyear: String(currentYear - 1),
			endyear: String(currentYear),
		};
		if (apiKey) body.registrationkey = apiKey;

		const res = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		if (!res.ok) return null;

		const data = await res.json();
		const series = data?.Results?.series?.[0];
		if (!series?.data?.length) return null;

		// BLS returns most recent first
		const latest = series.data[0];
		const monthNum = latest.period?.replace('M', '') || '01';
		const dateStr = `${latest.year}-${monthNum.padStart(2, '0')}-01`;

		return {
			value: parseFloat(latest.value),
			date: dateStr,
		};
	} catch (err: any) {
		console.error('[MarketSignals] BLS fetch failed:', err.message);
		return null;
	}
}

// ---------------------------------------------------------------------------
// Cache Layer
// ---------------------------------------------------------------------------

async function getCachedIndicator(
	indicatorType: string,
): Promise<IndicatorRow | null> {
	const sb = getSupabase();
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - CACHE_DAYS);

	const { data } = await sb
		.from('market_indicators')
		.select('indicator_type, date, value, source')
		.eq('indicator_type', indicatorType)
		.gte('cached_at', cutoff.toISOString())
		.order('date', { ascending: false })
		.limit(1)
		.maybeSingle();

	return data;
}

async function getCachedIndicatorHistory(
	indicatorType: string,
	limit: number = 4,
): Promise<IndicatorRow[]> {
	const sb = getSupabase();
	const { data } = await sb
		.from('market_indicators')
		.select('indicator_type, date, value, source')
		.eq('indicator_type', indicatorType)
		.order('date', { ascending: false })
		.limit(limit);

	return data || [];
}

async function cacheIndicator(
	indicatorType: string,
	date: string,
	value: number,
	source: string,
	unit: string,
): Promise<void> {
	const sb = getSupabase();
	await sb
		.from('market_indicators')
		.upsert(
			{
				indicator_type: indicatorType,
				date,
				value,
				unit,
				source,
				cached_at: new Date().toISOString(),
			},
			{ onConflict: 'indicator_type,date,source' },
		);
}

// ---------------------------------------------------------------------------
// Trend Analysis
// ---------------------------------------------------------------------------

function computeGasTrend(
	history: IndicatorRow[],
): { trend: 'rising' | 'falling' | 'stable' | 'unknown'; pctChange: number } {
	if (history.length < 2) {
		return { trend: 'unknown', pctChange: 0 };
	}

	// Compare latest to ~3 months ago (or oldest available)
	const latest = Number(history[0].value);
	const older = Number(history[history.length - 1].value);

	if (older <= 0) return { trend: 'unknown', pctChange: 0 };

	const pctChange = (latest - older) / older;

	if (pctChange >= GAS_RISING_THRESHOLD) return { trend: 'rising', pctChange };
	if (pctChange <= GAS_FALLING_THRESHOLD) return { trend: 'falling', pctChange };
	return { trend: 'stable', pctChange };
}

function computeInflationRate(
	history: IndicatorRow[],
): number | null {
	if (history.length < 2) return null;

	// YoY inflation: compare latest CPI to 12 months prior
	const latest = Number(history[0].value);
	// Find entry ~12 months ago
	const latestDate = new Date(history[0].date);
	const yearAgo = new Date(latestDate);
	yearAgo.setFullYear(yearAgo.getFullYear() - 1);

	const priorEntry = history.find((r) => {
		const d = new Date(r.date);
		return Math.abs(d.getTime() - yearAgo.getTime()) < 60 * 24 * 60 * 60 * 1000; // within 60 days
	});

	if (!priorEntry) return null;
	const prior = Number(priorEntry.value);
	if (prior <= 0) return null;

	return ((latest - prior) / prior) * 100;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get current market conditions for forecast adjustment.
 *
 * Checks cache first, then queries EIA and BLS APIs.
 * Returns an adjustment factor to apply to the revenue forecast.
 */
export async function getMarketConditions(
	date: string,
): Promise<MarketConditions> {
	const reasonParts: string[] = [];
	let totalAdjustment = 0;

	// --- Gas Prices ---
	let gasPrice: number | null = null;
	let gasHistory: IndicatorRow[] = [];

	const cachedGas = await getCachedIndicator('gas_price');
	if (cachedGas) {
		gasPrice = Number(cachedGas.value);
		gasHistory = await getCachedIndicatorHistory('gas_price', 4);
	} else {
		const freshGas = await fetchGasPrice();
		if (freshGas) {
			gasPrice = freshGas.price;
			await cacheIndicator('gas_price', freshGas.date, freshGas.price, 'eia', 'usd_per_gallon');
			gasHistory = await getCachedIndicatorHistory('gas_price', 4);
		}
	}

	const gasTrendResult = computeGasTrend(gasHistory);

	if (gasTrendResult.trend === 'rising' && gasTrendResult.pctChange >= GAS_RISING_THRESHOLD) {
		totalAdjustment -= 0.02; // -2%
		const pct = Math.round(gasTrendResult.pctChange * 100);
		reasonParts.push(`Gas up ${pct}% QoQ ($${gasPrice?.toFixed(2)}/gal) -- -2% adj`);
	} else if (gasTrendResult.trend === 'falling' && gasTrendResult.pctChange <= GAS_FALLING_THRESHOLD) {
		totalAdjustment += 0.01; // +1%
		const pct = Math.round(Math.abs(gasTrendResult.pctChange) * 100);
		reasonParts.push(`Gas down ${pct}% QoQ ($${gasPrice?.toFixed(2)}/gal) -- +1% adj`);
	} else if (gasPrice) {
		reasonParts.push(`Gas stable ($${gasPrice.toFixed(2)}/gal)`);
	}

	// --- CPI / Inflation ---
	let inflationRate: number | null = null;
	let cpiHistory: IndicatorRow[] = [];

	const cachedCPI = await getCachedIndicator('cpi');
	if (cachedCPI) {
		cpiHistory = await getCachedIndicatorHistory('cpi', 13); // ~13 months for YoY
	} else {
		const freshCPI = await fetchCPI();
		if (freshCPI) {
			await cacheIndicator('cpi', freshCPI.date, freshCPI.value, 'bls', 'index');
			cpiHistory = await getCachedIndicatorHistory('cpi', 13);
		}
	}

	inflationRate = computeInflationRate(cpiHistory);

	if (inflationRate !== null) {
		if (inflationRate > 5) {
			totalAdjustment -= 0.01; // -1% for high inflation
			reasonParts.push(`CPI inflation ${inflationRate.toFixed(1)}% (elevated) -- -1% adj`);
		} else {
			reasonParts.push(`CPI inflation ${inflationRate.toFixed(1)}%`);
		}
	}

	// --- Consumer Confidence (placeholder, no free API yet) ---
	const consumerConfidence: number | null = null;

	// Clamp total adjustment between -5% and +3%
	totalAdjustment = Math.max(-0.05, Math.min(0.03, totalAdjustment));

	return {
		gasPrice,
		gasTrend: gasTrendResult.trend,
		gasTrendPct: Math.round(gasTrendResult.pctChange * 100),
		inflationRate,
		consumerConfidence,
		forecastAdjustment: Math.round(totalAdjustment * 10000) / 10000,
		reasoning: reasonParts.length > 0
			? `Market: ${reasonParts.join(' | ')}`
			: 'Market signals unavailable',
	};
}
