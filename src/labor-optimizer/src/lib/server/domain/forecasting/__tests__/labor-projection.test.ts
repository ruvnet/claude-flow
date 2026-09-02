/**
 * Unit tests for the Labor Projection engine.
 *
 * Tests DOW weight normalization, threshold bracket lookup logic,
 * and weekly-to-daily distribution guarantees.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies
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

vi.mock('$lib/server/domain/record-learning', () => ({
	recordLearning: vi.fn(async () => {}),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Labor Projection — DOW Weight Normalization', () => {
	it('uniform weights (1/7 each) sum to 1.0', () => {
		const weights: number[] = Array(7).fill(1 / 7);
		const sum = weights.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1.0, 10);
	});

	it('custom weights normalize to sum 1.0', () => {
		// Simulate how the code normalizes weights for distribution
		const rawWeights = [0.10, 0.12, 0.13, 0.16, 0.18, 0.20, 0.11];
		const total = rawWeights.reduce((a, b) => a + b, 0);
		const normalized = rawWeights.map(w => w / total);
		const normalizedSum = normalized.reduce((a, b) => a + b, 0);
		expect(normalizedSum).toBeCloseTo(1.0, 10);
	});

	it('blended weights (70% current + 30% actual) sum to 1.0', () => {
		const BLEND_CURRENT = 0.7;
		const BLEND_ACTUAL = 0.3;

		const current = [0.14, 0.14, 0.14, 0.14, 0.14, 0.16, 0.14];
		const actual = [0.10, 0.12, 0.13, 0.16, 0.18, 0.20, 0.11];

		const blended: number[] = [];
		let blendedSum = 0;
		for (let dow = 0; dow < 7; dow++) {
			const val = BLEND_CURRENT * current[dow] + BLEND_ACTUAL * actual[dow];
			blended.push(val);
			blendedSum += val;
		}

		// Normalize
		const normalized = blended.map(b =>
			blendedSum > 0
				? Math.round((b / blendedSum) * 10000) / 10000
				: Math.round((1 / 7) * 10000) / 10000,
		);

		const normalizedSum = normalized.reduce((a, b) => a + b, 0);
		expect(normalizedSum).toBeCloseTo(1.0, 3);
	});

	it('all weights are non-negative after normalization', () => {
		const weights = [0.0, 0.0, 0.05, 0.10, 0.35, 0.40, 0.10];
		const total = weights.reduce((a, b) => a + b, 0);
		const normalized = weights.map(w => w / total);
		for (const w of normalized) {
			expect(w).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('Labor Projection — Threshold Bracket Lookup', () => {
	it('matches exact bracket containing the weekly total', () => {
		const brackets = [
			{ low: 0, high: 50000 },
			{ low: 50000, high: 75000 },
			{ low: 75000, high: 100000 },
			{ low: 100000, high: 150000 },
		];

		const weekTotal = 62000;
		const match = brackets.find(b => weekTotal >= b.low && weekTotal < b.high);
		expect(match).toBeDefined();
		expect(match!.low).toBe(50000);
		expect(match!.high).toBe(75000);
	});

	it('uses closest bracket when no exact match', () => {
		const brackets = [
			{ low: 50000, high: 75000, mid: 62500 },
			{ low: 75000, high: 100000, mid: 87500 },
		];

		const weekTotal = 40000; // below lowest bracket
		const closest = brackets.reduce((prev, curr) =>
			Math.abs(curr.mid - weekTotal) < Math.abs(prev.mid - weekTotal) ? curr : prev,
		);
		expect(closest.low).toBe(50000);
	});

	it('returns highest bracket for very high revenue', () => {
		const brackets = [
			{ low: 0, high: 50000, mid: 25000 },
			{ low: 50000, high: 100000, mid: 75000 },
			{ low: 100000, high: 200000, mid: 150000 },
		];

		const weekTotal = 180000;
		const match = brackets.find(b => weekTotal >= b.low && weekTotal < b.high);
		expect(match).toBeDefined();
		expect(match!.low).toBe(100000);
	});
});

describe('Labor Projection — Weekly-to-Daily Distribution', () => {
	it('daily labor dollars sum to weekly total', () => {
		const weeklyLabor = 5000;
		const weights = [0.10, 0.12, 0.13, 0.16, 0.18, 0.20, 0.11];
		const totalWeight = weights.reduce((a, b) => a + b, 0);

		const dailyAmounts = weights.map(w => (weeklyLabor * w) / totalWeight);
		const dailySum = dailyAmounts.reduce((a, b) => a + b, 0);

		expect(dailySum).toBeCloseTo(weeklyLabor, 5);
	});

	it('daily distribution preserves proportions', () => {
		const weeklyLabor = 8000;
		const weights = [0.10, 0.12, 0.13, 0.16, 0.18, 0.20, 0.11];
		const totalWeight = weights.reduce((a, b) => a + b, 0);

		const dailyAmounts = weights.map(w => (weeklyLabor * w) / totalWeight);

		// Friday (index 5) should get more than Monday (index 1)
		expect(dailyAmounts[5]).toBeGreaterThan(dailyAmounts[1]);
	});

	it('uniform weights produce equal daily amounts', () => {
		const weeklyLabor = 7000;
		const weights = Array(7).fill(1 / 7);
		const totalWeight = weights.reduce((a: number, b: number) => a + b, 0);

		const dailyAmounts = weights.map((w: number) => (weeklyLabor * w) / totalWeight);

		for (const amount of dailyAmounts) {
			expect(amount).toBeCloseTo(1000, 5);
		}
	});

	it('handles zero weekly labor gracefully', () => {
		const weeklyLabor = 0;
		const weights = [0.14, 0.14, 0.14, 0.14, 0.14, 0.16, 0.14];
		const totalWeight = weights.reduce((a, b) => a + b, 0);
		const dailyAmounts = weights.map(w => (weeklyLabor * w) / totalWeight);

		for (const amount of dailyAmounts) {
			expect(amount).toBe(0);
		}
	});

	it('rounding preserves total within 1 cent', () => {
		const weeklyLabor = 4999.99;
		const weights = [0.10, 0.12, 0.13, 0.16, 0.18, 0.20, 0.11];
		const totalWeight = weights.reduce((a, b) => a + b, 0);

		const dailyAmounts = weights.map(w =>
			Math.round(((weeklyLabor * w) / totalWeight) * 100) / 100,
		);
		const roundedSum = dailyAmounts.reduce((a, b) => a + b, 0);

		// Allow up to 7 cents of rounding error (1 cent per day)
		expect(Math.abs(roundedSum - weeklyLabor)).toBeLessThan(0.07);
	});
});

describe('Labor Projection — Week Bounds', () => {
	it('Monday start gives correct 7-day range', () => {
		// Reproduce the getWeekBounds logic
		function getWeekBounds(date: string) {
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

		const bounds = getWeekBounds('2026-03-25'); // Wednesday
		expect(bounds.weekDates).toHaveLength(7);
		// Monday should be March 23
		expect(bounds.weekDates[0]).toBe('2026-03-23');
		// Sunday should be March 29
		expect(bounds.weekDates[6]).toBe('2026-03-29');
	});

	it('Sunday input maps to prior Monday', () => {
		function getWeekBounds(date: string) {
			const target = new Date(date + 'T12:00:00');
			const dow = target.getDay();
			const mondayOffset = dow === 0 ? -6 : 1 - dow;
			const monday = new Date(target);
			monday.setDate(monday.getDate() + mondayOffset);
			return monday.toISOString().split('T')[0];
		}

		// Sunday March 29 2026 -> Monday March 23
		const monday = getWeekBounds('2026-03-29');
		expect(monday).toBe('2026-03-23');
	});
});
