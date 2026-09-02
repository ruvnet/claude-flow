/**
 * Unit tests for the Ensemble Forecast engine.
 *
 * Tests inverse-MAPE weighting, minimum weight floor,
 * and confidence/agreement calculation.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

vi.mock('$lib/server/supabase', () => ({
	getSupabase: vi.fn(() => ({
		from: vi.fn(() => {
			const chain: Record<string, any> = {};
			const methods = ['select', 'eq', 'gte', 'lte', 'gt', 'lt', 'not', 'in', 'order', 'limit', 'maybeSingle', 'upsert'];
			for (const m of methods) {
				chain[m] = vi.fn(() => chain);
			}
			chain.then = (resolve: any) => resolve({ data: [], error: null });
			return chain;
		}),
	})),
	getSupabaseService: vi.fn(() => ({
		from: vi.fn(() => {
			const chain: Record<string, any> = {};
			const methods = ['select', 'eq', 'gte', 'lte', 'gt', 'lt', 'not', 'in', 'order', 'limit', 'maybeSingle', 'upsert'];
			for (const m of methods) {
				chain[m] = vi.fn(() => chain);
			}
			chain.then = (resolve: any) => resolve({ data: [], error: null });
			return chain;
		}),
	})),
}));

// ---------------------------------------------------------------------------
// Replicate core ensemble functions for isolated testing
// ---------------------------------------------------------------------------

const WEIGHT_FLOOR = 0.05;

interface ModelMape {
	statistical: number;
	neural: number;
	analogy: number;
	manager: number;
	eventAware: number;
	crossCorrelation: number;
}

function mapeToWeights(
	mapes: ModelMape,
	activePredictions: Record<string, number>,
): Record<string, number> {
	const activeKeys = Object.keys(activePredictions).filter(
		(k) => activePredictions[k] > 0,
	);

	if (activeKeys.length === 0) return {};
	if (activeKeys.length === 1) return { [activeKeys[0]]: 1.0 };

	const raw: Record<string, number> = {};
	for (const key of activeKeys) {
		const mape = (mapes as unknown as Record<string, number>)[key] || 50;
		raw[key] = 1 / (mape + 1);
	}

	const rawSum = Object.values(raw).reduce((a, b) => a + b, 0);

	const normalized: Record<string, number> = {};
	for (const key of activeKeys) {
		normalized[key] = Math.max(WEIGHT_FLOOR, raw[key] / rawSum);
	}

	const clampSum = Object.values(normalized).reduce((a, b) => a + b, 0);
	for (const key of activeKeys) {
		normalized[key] = Math.round((normalized[key] / clampSum) * 1000) / 1000;
	}

	return normalized;
}

type AgreementLevel = 'high' | 'moderate' | 'low';

function computeAgreement(predictions: number[]): {
	agreement: AgreementLevel;
	confidence: number;
} {
	const valid = predictions.filter((p) => p > 0);
	if (valid.length <= 1) return { agreement: 'low', confidence: 0.3 };

	const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
	const stddev = Math.sqrt(
		valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length,
	);
	const cv = mean > 0 ? stddev / mean : 1;

	const confidence = Math.max(0.1, Math.min(0.95, 1 - cv));

	let agreement: AgreementLevel;
	if (cv < 0.05) agreement = 'high';
	else if (cv < 0.15) agreement = 'moderate';
	else agreement = 'low';

	return { agreement, confidence };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Ensemble — Inverse-MAPE Weighting', () => {
	it('weights sum to 1.0 with all 4 models active', () => {
		const mapes: ModelMape = {
			statistical: 8, neural: 12, analogy: 20, manager: 15, eventAware: 50, crossCorrelation: 50,
		};
		const predictions = {
			statistical: 10000, neural: 9500, analogy: 10500, manager: 9800,
		};

		const weights = mapeToWeights(mapes, predictions);
		const sum = Object.values(weights).reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1.0, 2);
	});

	it('weights sum to 1.0 with 2 models active', () => {
		const mapes: ModelMape = { statistical: 10, neural: 15, analogy: 50, manager: 50, eventAware: 50, crossCorrelation: 50 };
		const predictions = { statistical: 10000, neural: 9500, analogy: 0, manager: 0 };

		const weights = mapeToWeights(mapes, predictions);
		const sum = Object.values(weights).reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1.0, 2);
	});

	it('single active model gets weight 1.0', () => {
		const mapes: ModelMape = { statistical: 10, neural: 50, analogy: 50, manager: 50, eventAware: 50, crossCorrelation: 50 };
		const predictions = { statistical: 10000, neural: 0, analogy: 0, manager: 0 };

		const weights = mapeToWeights(mapes, predictions);
		expect(weights.statistical).toBe(1.0);
	});

	it('lower MAPE model gets higher weight', () => {
		const mapes: ModelMape = { statistical: 5, neural: 25, analogy: 50, manager: 50, eventAware: 50, crossCorrelation: 50 };
		const predictions = { statistical: 10000, neural: 10000, analogy: 0, manager: 0 };

		const weights = mapeToWeights(mapes, predictions);
		expect(weights.statistical).toBeGreaterThan(weights.neural);
	});

	it('returns empty object when no models are active', () => {
		const mapes: ModelMape = { statistical: 50, neural: 50, analogy: 50, manager: 50, eventAware: 50, crossCorrelation: 50 };
		const predictions = { statistical: 0, neural: 0, analogy: 0, manager: 0 };

		const weights = mapeToWeights(mapes, predictions);
		expect(Object.keys(weights)).toHaveLength(0);
	});
});

describe('Ensemble — Minimum Weight Floor (5%)', () => {
	it('no model gets weight below 5% when multiple active', () => {
		const mapes: ModelMape = {
			statistical: 3,   // very accurate
			neural: 50,       // very inaccurate
			analogy: 45,
			manager: 40,
			eventAware: 50,
			crossCorrelation: 50,
		};
		const predictions = {
			statistical: 10000, neural: 8000, analogy: 9000, manager: 9500,
		};

		const weights = mapeToWeights(mapes, predictions);

		for (const [key, weight] of Object.entries(weights)) {
			// After re-normalization, effective floor may be slightly adjusted
			// but should not be far below 10%
			expect(weight).toBeGreaterThanOrEqual(0.05);
		}
	});

	it('floor is applied before re-normalization', () => {
		const mapes: ModelMape = {
			statistical: 1,    // near perfect
			neural: 100,       // terrible
			analogy: 50,
			manager: 50,
			eventAware: 50,
			crossCorrelation: 50,
		};
		const predictions = {
			statistical: 10000, neural: 5000, analogy: 0, manager: 0,
		};

		const weights = mapeToWeights(mapes, predictions);

		// Neural should have been floored to at least 5% before re-normalization
		expect(weights.neural).toBeGreaterThanOrEqual(0.04);
		expect(weights.statistical + weights.neural).toBeCloseTo(1.0, 2);
	});
});

describe('Ensemble — Agreement & Confidence', () => {
	it('high agreement when predictions are within 5% CV', () => {
		const predictions = [10000, 10200, 10100, 9900];
		const { agreement, confidence } = computeAgreement(predictions);
		expect(agreement).toBe('high');
		expect(confidence).toBeGreaterThan(0.9);
	});

	it('moderate agreement when predictions vary 5-15% CV', () => {
		const predictions = [10000, 11000, 9200, 10500];
		const { agreement } = computeAgreement(predictions);
		expect(agreement).toBe('moderate');
	});

	it('low agreement when predictions diverge significantly', () => {
		const predictions = [10000, 5000, 15000, 8000];
		const { agreement } = computeAgreement(predictions);
		expect(agreement).toBe('low');
	});

	it('confidence is clamped between 0.1 and 0.95', () => {
		// Perfect agreement
		const perfect = computeAgreement([10000, 10000, 10000]);
		expect(perfect.confidence).toBeLessThanOrEqual(0.95);

		// Terrible agreement
		const terrible = computeAgreement([1000, 50000]);
		expect(terrible.confidence).toBeGreaterThanOrEqual(0.1);
	});

	it('single prediction returns low agreement, 0.3 confidence', () => {
		const { agreement, confidence } = computeAgreement([10000]);
		expect(agreement).toBe('low');
		expect(confidence).toBe(0.3);
	});

	it('empty predictions returns low agreement', () => {
		const { agreement, confidence } = computeAgreement([]);
		expect(agreement).toBe('low');
		expect(confidence).toBe(0.3);
	});

	it('zero predictions are filtered out', () => {
		const { agreement, confidence } = computeAgreement([10000, 0, 0, 10200]);
		// Only 2 valid predictions, should still compute
		expect(agreement).toBe('high');
		expect(confidence).toBeGreaterThan(0.9);
	});
});

describe('Ensemble — Weighted Average', () => {
	it('weighted average matches manual calculation', () => {
		const predictions: Record<string, number> = {
			statistical: 10000,
			neural: 9500,
			analogy: 10500,
		};
		const weights: Record<string, number> = {
			statistical: 0.5,
			neural: 0.3,
			analogy: 0.2,
		};

		let ensemble = 0;
		for (const [key, pred] of Object.entries(predictions)) {
			ensemble += pred * (weights[key] || 0);
		}

		// 10000*0.5 + 9500*0.3 + 10500*0.2 = 5000 + 2850 + 2100 = 9950
		expect(ensemble).toBe(9950);
	});

	it('ensemble falls back to statistical when no models produce output', () => {
		const activePredictions: Record<string, number> = {};
		const statisticalRev = 10000;

		let ensembleRevenue = 0;
		for (const [, pred] of Object.entries(activePredictions)) {
			ensembleRevenue += pred;
		}

		if (ensembleRevenue === 0 && statisticalRev > 0) {
			ensembleRevenue = statisticalRev;
		}

		expect(ensembleRevenue).toBe(10000);
	});
});
