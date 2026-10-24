/**
 * Integration-style tests for the Forecast API endpoint.
 *
 * Tests request validation, required parameters, and POST body checks.
 * Mocks Supabase and forecast generation to test routing logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all heavy dependencies
// ---------------------------------------------------------------------------

function buildChain(data: unknown = null) {
	const chain: Record<string, any> = {};
	const methods = ['select', 'eq', 'gte', 'lte', 'gt', 'lt', 'not', 'in', 'order', 'limit', 'maybeSingle', 'upsert', 'update', 'single'];
	for (const m of methods) {
		chain[m] = vi.fn(() => chain);
	}
	chain.then = (resolve: any) => resolve({ data, error: null });
	return chain;
}

vi.mock('$lib/server/supabase', () => ({
	getSupabase: vi.fn(() => ({ from: vi.fn(() => buildChain()) })),
	getSupabaseService: vi.fn(() => ({ from: vi.fn(() => buildChain()) })),
}));

vi.mock('$lib/server/domain/forecasting/ai-forecast', () => ({
	generateForecastSuggestion: vi.fn(async () => ({
		date: '2026-03-27',
		suggestedRevenue: 12000,
		suggestedCovers: 170,
		avgCheck: 70.59,
		confidence: 0.75,
		reasoning: 'Test forecast',
		weights: { trailing: 0.4, pyGrowth: 0.25, momentum: 0.2, budget: 0.15 },
		components: {
			trailingDowAvg: 11500,
			pyAdjusted: 12200,
			momentumRevenue: 11800,
			budgetRevenue: 10500,
		},
	})),
	acceptForecast: vi.fn(async () => ({ success: true })),
	generatePeriodForecasts: vi.fn(async () => []),
	getTrailing2WeekAvgCheck: vi.fn(async () => 70),
}));

vi.mock('$lib/server/domain/forecasting/forecast-accuracy', () => ({
	getModelStats: vi.fn(async () => ({
		mape4w: 8.5,
		adaptiveWeights: { trailing: 0.4, pyGrowth: 0.25, momentum: 0.2, budget: 0.15 },
		trendNotes: [],
		accuracyRecords: 28,
	})),
}));

vi.mock('$lib/roles', () => ({
	canUnlockForecast: vi.fn(() => true),
	isValidRole: vi.fn(() => true),
	getHighestRole: vi.fn(() => 'super_admin'),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Forecast API — GET Validation', () => {
	it('returns 400 when locationId is missing', async () => {
		const { GET } = await import('../../../../routes/api/v1/forecast/+server');

		const url = new URL('http://localhost/api/v1/forecast');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('locationId');
	});

	it('returns 400 when date and startDate are both missing', async () => {
		const { GET } = await import('../../../../routes/api/v1/forecast/+server');

		const url = new URL('http://localhost/api/v1/forecast?locationId=loc-1');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('date');
	});

	it('returns forecast suggestion for valid single date request', async () => {
		const { GET } = await import('../../../../routes/api/v1/forecast/+server');

		const url = new URL('http://localhost/api/v1/forecast?locationId=loc-1&date=2026-03-27');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.suggestedRevenue).toBeDefined();
		expect(body.date).toBe('2026-03-27');
	});

	it('supports period+year shorthand parameters', async () => {
		const { GET } = await import('../../../../routes/api/v1/forecast/+server');

		const url = new URL('http://localhost/api/v1/forecast?locationId=loc-1&period=3&year=2026');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.suggestions).toBeDefined();
	});
});

describe('Forecast API — POST Validation', () => {
	it('returns 400 when required fields are missing', async () => {
		const { POST } = await import('../../../../routes/api/v1/forecast/+server');

		const request = new Request('http://localhost/api/v1/forecast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ locationId: 'loc-1' }),
		});

		const response = await POST({ request } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('required');
	});

	it('returns 400 when isOverride is true but no tags or explanation', async () => {
		const { POST } = await import('../../../../routes/api/v1/forecast/+server');

		const request = new Request('http://localhost/api/v1/forecast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				locationId: 'loc-1',
				date: '2026-03-27',
				revenue: 12000,
				isOverride: true,
			}),
		});

		const response = await POST({ request } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('overrideTags');
	});

	it('accepts valid forecast submission', async () => {
		const { POST } = await import('../../../../routes/api/v1/forecast/+server');

		const request = new Request('http://localhost/api/v1/forecast', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				locationId: 'loc-1',
				date: '2026-03-27',
				revenue: 12000,
				acceptedBy: 'manager@test.com',
			}),
		});

		const response = await POST({ request } as any);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body.accepted).toBe(true);
		expect(body.locked).toBe(true);
	});
});

describe('Forecast API — PUT Validation (Unlock)', () => {
	it('returns 400 when required fields are missing', async () => {
		const { PUT } = await import('../../../../routes/api/v1/forecast/+server');

		const request = new Request('http://localhost/api/v1/forecast', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ locationId: 'loc-1' }),
		});

		const response = await PUT({ request } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('required');
	});
});
