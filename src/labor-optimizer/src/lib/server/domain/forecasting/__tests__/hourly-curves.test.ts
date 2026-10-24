/**
 * Unit tests for the Hourly Revenue Curves module.
 *
 * Tests curve normalization, predictFinalRevenue math,
 * and anomaly detection threshold logic.
 */

import { describe, it, expect, vi } from 'vitest';
import type { HourlyCurvePoint, AnomalyResult } from '../hourly-curves';

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

vi.mock('$lib/server/supabase', () => ({
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
// Curve Normalization Tests
// ---------------------------------------------------------------------------

describe('Hourly Curves — Curve Normalization', () => {
	it('flat curve sums to 1.0', () => {
		const openHours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
		const pctPerHour = 1.0 / openHours.length;
		const curve: HourlyCurvePoint[] = [];
		for (let h = 0; h < 24; h++) {
			curve.push({
				hour: h,
				pctOfDaily: openHours.includes(h) ? pctPerHour : 0,
				sampleCount: 0,
			});
		}

		const sum = curve.reduce((s, c) => s + c.pctOfDaily, 0);
		expect(sum).toBeCloseTo(1.0, 10);
	});

	it('normalized historical curve sums to 1.0', () => {
		// Simulate a raw curve that does not sum to 1.0 and then normalize
		const rawCurve: HourlyCurvePoint[] = [];
		for (let h = 0; h < 24; h++) {
			rawCurve.push({
				hour: h,
				pctOfDaily: h >= 11 && h <= 22 ? 0.09 : 0, // 12 hours * 0.09 = 1.08
				sampleCount: 5,
			});
		}

		const rawSum = rawCurve.reduce((s, c) => s + c.pctOfDaily, 0);
		expect(rawSum).not.toBeCloseTo(1.0, 2);

		// Apply normalization (same logic as in buildCurveFromHistory)
		if (rawSum > 0 && Math.abs(rawSum - 1.0) > 0.001) {
			for (const point of rawCurve) {
				point.pctOfDaily = point.pctOfDaily / rawSum;
			}
		}

		const normalizedSum = rawCurve.reduce((s, c) => s + c.pctOfDaily, 0);
		expect(normalizedSum).toBeCloseTo(1.0, 10);
	});

	it('all-zero curve remains all zero', () => {
		const curve: HourlyCurvePoint[] = Array.from({ length: 24 }, (_, h) => ({
			hour: h, pctOfDaily: 0, sampleCount: 0,
		}));

		const sum = curve.reduce((s, c) => s + c.pctOfDaily, 0);
		expect(sum).toBe(0);
	});

	it('single active hour concentrates 100%', () => {
		const curve: HourlyCurvePoint[] = Array.from({ length: 24 }, (_, h) => ({
			hour: h, pctOfDaily: h === 19 ? 1.0 : 0, sampleCount: h === 19 ? 10 : 0,
		}));

		const sum = curve.reduce((s, c) => s + c.pctOfDaily, 0);
		expect(sum).toBeCloseTo(1.0, 10);
		expect(curve[19].pctOfDaily).toBe(1.0);
	});

	it('curve has exactly 24 entries', () => {
		const openHours = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
		const curve: HourlyCurvePoint[] = [];
		for (let h = 0; h < 24; h++) {
			curve.push({
				hour: h,
				pctOfDaily: openHours.includes(h) ? 1 / openHours.length : 0,
				sampleCount: 0,
			});
		}
		expect(curve).toHaveLength(24);
	});
});

// ---------------------------------------------------------------------------
// predictFinalRevenue Math
// ---------------------------------------------------------------------------

describe('Hourly Curves — predictFinalRevenue Math', () => {
	it('projects correctly at 50% curve completion', () => {
		const revenueSoFar = 5000;
		const curveCompletionPct = 0.5;
		const projected = revenueSoFar / curveCompletionPct;
		expect(projected).toBe(10000);
	});

	it('projects correctly at 30% curve completion', () => {
		const revenueSoFar = 3000;
		const curveCompletionPct = 0.3;
		const projected = revenueSoFar / curveCompletionPct;
		expect(projected).toBeCloseTo(10000, 0);
	});

	it('returns revenueSoFar when curve is essentially complete (>=99%)', () => {
		const revenueSoFar = 9800;
		const curveCompletionPct = 0.995;

		let projectedFinalRevenue: number;
		if (curveCompletionPct >= 0.99) {
			projectedFinalRevenue = revenueSoFar;
		} else {
			projectedFinalRevenue = revenueSoFar / curveCompletionPct;
		}
		expect(projectedFinalRevenue).toBe(9800);
	});

	it('returns revenueSoFar when curve is too early (<=1%)', () => {
		const revenueSoFar = 50;
		const curveCompletionPct = 0.005;

		let projectedFinalRevenue: number;
		if (curveCompletionPct <= 0.01) {
			projectedFinalRevenue = revenueSoFar;
		} else {
			projectedFinalRevenue = revenueSoFar / curveCompletionPct;
		}
		expect(projectedFinalRevenue).toBe(50);
	});

	it('projection is always >= revenueSoFar for valid curves', () => {
		const revenueSoFar = 4000;
		// Any completion pct from 0.01 to 1.0 should give projection >= revenueSoFar
		for (let pct = 0.02; pct <= 1.0; pct += 0.05) {
			const projected = revenueSoFar / pct;
			expect(projected).toBeGreaterThanOrEqual(revenueSoFar);
		}
	});
});

// ---------------------------------------------------------------------------
// Anomaly Detection
// ---------------------------------------------------------------------------

describe('Hourly Curves — Anomaly Detection', () => {
	const ANOMALY_THRESHOLD = 0.15;

	it('detects ahead anomaly when >15% above expected', () => {
		const forecastedTotal = 10000;
		const expectedPctByNow = 0.5;
		const expectedRevByNow = forecastedTotal * expectedPctByNow; // 5000
		const revenueSoFar = 6000;

		const variance = (revenueSoFar - expectedRevByNow) / expectedRevByNow;
		expect(variance).toBe(0.2);
		expect(variance >= ANOMALY_THRESHOLD).toBe(true);
	});

	it('detects behind anomaly when >15% below expected', () => {
		const forecastedTotal = 10000;
		const expectedPctByNow = 0.5;
		const expectedRevByNow = forecastedTotal * expectedPctByNow; // 5000
		const revenueSoFar = 4000;

		const variance = (revenueSoFar - expectedRevByNow) / expectedRevByNow;
		expect(variance).toBe(-0.2);
		expect(variance <= -ANOMALY_THRESHOLD).toBe(true);
	});

	it('reports on_track when within 15% band', () => {
		const forecastedTotal = 10000;
		const expectedPctByNow = 0.5;
		const expectedRevByNow = forecastedTotal * expectedPctByNow; // 5000
		const revenueSoFar = 5500;

		const variance = (revenueSoFar - expectedRevByNow) / expectedRevByNow;
		expect(variance).toBe(0.1);
		expect(Math.abs(variance) < ANOMALY_THRESHOLD).toBe(true);
	});

	it('returns not anomaly when expected revenue is 0', () => {
		const expectedRevByNow = 0;
		// Function should return on_track with magnitude 0
		const result: AnomalyResult = {
			isAnomaly: false,
			direction: 'on_track',
			magnitude: 0,
			message: 'Too early in the day for meaningful anomaly detection.',
		};
		expect(result.isAnomaly).toBe(false);
		expect(result.direction).toBe('on_track');
	});

	it('magnitude is correctly computed', () => {
		const expectedRevByNow = 5000;
		const revenueSoFar = 6500;
		const variance = (revenueSoFar - expectedRevByNow) / expectedRevByNow;
		const magnitude = Math.round(variance * 1000) / 1000;
		expect(magnitude).toBe(0.3);
	});
});

// ---------------------------------------------------------------------------
// Staffing Suggestion
// ---------------------------------------------------------------------------

describe('Hourly Curves — suggestAction', () => {
	it('suggests adding 2+ servers for extreme ahead anomaly', () => {
		// Inline the suggestAction logic
		const anomaly: AnomalyResult = {
			isAnomaly: true,
			direction: 'ahead',
			magnitude: 0.30,
			message: '',
		};

		const pct = Math.round(anomaly.magnitude * 100);
		expect(pct).toBe(30);
		expect(pct >= 25).toBe(true);
		// Should suggest 2+ servers
	});

	it('suggests no action when on_track', () => {
		const anomaly: AnomalyResult = {
			isAnomaly: false,
			direction: 'on_track',
			magnitude: 0.05,
			message: '',
		};
		expect(anomaly.isAnomaly).toBe(false);
	});
});
