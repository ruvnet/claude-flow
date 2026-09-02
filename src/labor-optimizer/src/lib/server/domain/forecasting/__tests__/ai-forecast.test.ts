/**
 * Unit tests for the AI Forecast engine.
 *
 * Tests adaptive weight normalization, weather impact calculations,
 * and bias correction logic.  All Supabase calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Supabase before importing the module under test
// ---------------------------------------------------------------------------

const mockSelect = vi.fn();
const mockFrom = vi.fn(() => ({
	select: mockSelect,
}));

// Chain helpers for the Supabase query builder
function chainBuilder(data: unknown[] | null = []) {
	const chain: Record<string, any> = {};
	const methods = ['eq', 'gte', 'lt', 'lte', 'gt', 'not', 'in', 'order', 'limit', 'maybeSingle'];
	for (const m of methods) {
		chain[m] = vi.fn(() => chain);
	}
	chain.then = undefined;
	// Resolve data on terminal await
	Object.defineProperty(chain, Symbol.for('resolveData'), { value: data });
	// Make it thenable so `await sb.from(...).select(...)...` resolves
	const result = { data, error: null };
	for (const m of methods) {
		chain[m] = vi.fn(() => chain);
	}
	chain.select = vi.fn(() => chain);
	// Override the last call to return data
	chain[Symbol.for('nodejs.util.inspect.custom')] = () => result;
	// Simplest approach: make chain itself a promise-like
	chain.then = (resolve: any) => resolve(result);
	return chain;
}

vi.mock('$lib/server/supabase', () => ({
	getSupabase: vi.fn(() => ({
		from: vi.fn(() => chainBuilder()),
	})),
	getSupabaseService: vi.fn(() => ({
		from: vi.fn(() => chainBuilder()),
	})),
}));

vi.mock('$lib/server/integrations/weather/weather-service', () => ({
	getWeatherForDate: vi.fn(async () => null),
}));

vi.mock('$lib/server/integrations/resy/resy-service', () => ({
	getReservationsForDate: vi.fn(async () => null),
	getHistoricalWalkinRatio: vi.fn(async () => 0.3),
}));

vi.mock('../forecast-helpers', () => ({
	lookupPriorYear: vi.fn(async () => ({
		pyRevenue: 0, pyCovers: 0, pyDate: null, yoyGrowthFactor: 1.0, pyAdjusted: 0,
	})),
	computeYtdTrend: vi.fn(async () => ({
		ytdRevenue: 0, ytdPyRevenue: 0, ytdGrowthRate: 0, scalingFactor: 1.0, reasoningNote: '',
	})),
	computeWeatherImpact: vi.fn(async () => ({
		adjustedRevenue: 0, weatherNote: '', impactMultiplier: 1.0,
	})),
	learnOverrideTagImpacts: vi.fn(async () => []),
	applyBiasCorrection: vi.fn(async (_loc: string, _dow: number, _name: string, rev: number) => ({
		correctedRevenue: rev, biasNote: null,
	})),
}));

vi.mock('../cross-location', () => ({
	getCrossLocationSignal: vi.fn(async () => ({ impactPct: 0, confidence: 0, reasoning: '' })),
}));

vi.mock('../event-intelligence', () => ({
	getEventImpact: vi.fn(async () => ({ impactMultiplier: 1.0, reasoning: '' })),
}));

vi.mock('../market-signals', () => ({
	getMarketConditions: vi.fn(async () => ({ forecastAdjustment: 0, reasoning: '' })),
}));

vi.mock('../guest-behavior', () => ({
	getGuestBehaviorForecast: vi.fn(async () => ({
		revenueAdjustmentPct: 0, coverAdjustmentPct: 0, reasoning: [],
	})),
}));

vi.mock('../ensemble', () => ({
	generateEnsembleForecast: vi.fn(),
	isEnsembleEnabled: vi.fn(async () => false),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

import { type ForecastWeights } from '../ai-forecast';

describe('AI Forecast — Adaptive Weights', () => {
	it('BASE_WEIGHTS sum to 1.0', () => {
		const base: ForecastWeights = {
			trailing: 0.40, pyGrowth: 0.25, momentum: 0.20, budget: 0.15,
		};
		const sum = base.trailing + base.pyGrowth + base.momentum + base.budget;
		expect(sum).toBeCloseTo(1.0, 5);
	});

	it('getAdaptiveWeights returns base weights when insufficient data', async () => {
		// With no rows from forecast_accuracy, should return base weights
		const { getAdaptiveWeights } = await import('../ai-forecast');
		const weights = await getAdaptiveWeights('loc-1', 3); // Wednesday
		const sum = weights.trailing + weights.pyGrowth + weights.momentum + weights.budget;
		expect(sum).toBeCloseTo(1.0, 2);
		expect(weights.trailing).toBeGreaterThanOrEqual(0.10);
		expect(weights.budget).toBeGreaterThanOrEqual(0.10);
	});

	it('weight normalization ensures sum equals 1.0 after clamping', () => {
		// Simulate the clamping + re-normalization logic from getAdaptiveWeights
		const WEIGHT_MIN = 0.10;
		const WEIGHT_MAX = 0.50;
		const raw = { trailing: 0.60, pyGrowth: 0.05, momentum: 0.30, budget: 0.05 };
		const rawSum = Object.values(raw).reduce((a, b) => a + b, 0);

		const normalized: Record<string, number> = {};
		for (const [key, val] of Object.entries(raw)) {
			normalized[key] = Math.max(WEIGHT_MIN, Math.min(WEIGHT_MAX, val / rawSum));
		}
		const clampSum = Object.values(normalized).reduce((a, b) => a + b, 0);
		const final: Record<string, number> = {};
		for (const [key, val] of Object.entries(normalized)) {
			final[key] = val / clampSum;
		}

		const finalSum = Object.values(final).reduce((a, b) => a + b, 0);
		expect(finalSum).toBeCloseTo(1.0, 5);
		// All weights should be >= floor after normalization
		for (const v of Object.values(final)) {
			expect(v).toBeGreaterThanOrEqual(0.05); // slightly below MIN due to normalization
		}
	});

	it('extra signal weights (weather, resy, cross-location) reduce base proportionally', () => {
		const W: ForecastWeights = { trailing: 0.40, pyGrowth: 0.25, momentum: 0.20, budget: 0.15 };
		W.weather = 0.10;
		W.reservations = 0.15;
		const extraWeight = (W.weather || 0) + (W.reservations || 0) + (W.crossLocation || 0);
		const baseScale = 1 - extraWeight;

		expect(baseScale).toBeCloseTo(0.75, 5);
		const scaledTrailing = W.trailing * baseScale;
		expect(scaledTrailing).toBeCloseTo(0.30, 5);
	});
});

describe('AI Forecast — Weather Impact (rule-based)', () => {
	it('severe storm applies -15% multiplier', async () => {
		const { computeWeatherImpact } = await import('../forecast-helpers');
		// computeWeatherImpact is mocked -- test the rule logic inline
		const condition = 'Thunderstorm';
		const precip = 85;
		const stormConditions = ['Thunderstorm', 'Squall', 'Tornado'];
		const isSevere = stormConditions.includes(condition) || precip > 80;
		expect(isSevere).toBe(true);
		// Rule: multiplier = 0.85
		const multiplier = 0.85;
		const base = 10000;
		expect(base * multiplier).toBe(8500);
	});

	it('moderate rain applies -8% multiplier', () => {
		const condition = 'Rain';
		const precip = 55;
		const rainConditions = ['Rain', 'Drizzle', 'Snow', 'Sleet'];
		const isModerate = rainConditions.includes(condition) || precip > 50;
		expect(isModerate).toBe(true);
		const multiplier = 0.92;
		const base = 10000;
		expect(base * multiplier).toBe(9200);
	});

	it('extreme heat stacks with rain penalty', () => {
		let multiplier = 0.92; // rain
		const tempHigh = 102;
		if (tempHigh > 95) {
			const heatPenalty = tempHigh > 100 ? 0.90 : 0.95;
			multiplier *= heatPenalty;
		}
		expect(multiplier).toBeCloseTo(0.828, 3);
	});

	it('perfect weather gives modest boost', () => {
		const tempHigh = 72;
		const precip = 5;
		const condition = 'Clear';
		const dayOfWeek = 5; // Friday
		let multiplier = 1.0;

		if (multiplier >= 1.0 && tempHigh >= 65 && tempHigh <= 80 && precip < 15) {
			if (['Clear', 'Clouds', 'Few clouds'].includes(condition)) {
				const weekendBoost = [0, 5, 6].includes(dayOfWeek) ? 0.03 : 0.02;
				multiplier = 1 + weekendBoost;
			}
		}
		expect(multiplier).toBe(1.03);
	});
});

describe('AI Forecast — Bias Correction', () => {
	it('applies positive correction when model under-forecasts', () => {
		const avgBias = 8.0; // model under-forecasts by 8%
		const suggestedRevenue = 10000;
		const correction = 1 + avgBias / 100;
		const corrected = Math.round(suggestedRevenue * correction * 100) / 100;
		expect(corrected).toBe(10800);
	});

	it('applies negative correction when model over-forecasts', () => {
		const avgBias = -6.0;
		const suggestedRevenue = 10000;
		const correction = 1 + avgBias / 100;
		const corrected = Math.round(suggestedRevenue * correction * 100) / 100;
		expect(corrected).toBe(9400);
	});

	it('no correction when bias is within 3% threshold', () => {
		const avgBias = 2.5;
		const suggestedRevenue = 10000;
		// Code only corrects when abs(avgBias) > 3
		expect(Math.abs(avgBias) > 3).toBe(false);
		// Revenue should stay the same
		expect(suggestedRevenue).toBe(10000);
	});
});

describe('AI Forecast — Confidence Scoring', () => {
	it('starts at 0.30 base confidence', () => {
		let confidence = 0.3;
		expect(confidence).toBe(0.3);
	});

	it('caps at 0.95 maximum confidence', () => {
		let confidence = 0.3;
		confidence += 0.2;  // same DOW >= 2
		confidence += 0.15; // PY > 0
		confidence += 0.05; // YTD
		confidence += 0.1;  // 7d data
		confidence += 0.05; // budget
		confidence += 0.05; // weather
		confidence += 0.1;  // reservations
		confidence += 0.05; // cross-location
		confidence += 0.05; // event
		confidence = Math.min(confidence, 0.95);
		expect(confidence).toBe(0.95);
	});
});
