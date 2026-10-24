/**
 * Integration-style tests for the Insights / KPI API endpoint.
 *
 * Tests response structure, parameter validation,
 * and period boundary calculations.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Supabase
// ---------------------------------------------------------------------------

function buildChain(data: unknown = null) {
	const chain: Record<string, any> = {};
	const methods = ['select', 'eq', 'gte', 'lte', 'gt', 'lt', 'not', 'in', 'order', 'limit', 'maybeSingle', 'single', 'upsert'];
	for (const m of methods) {
		chain[m] = vi.fn(() => chain);
	}
	chain.then = (resolve: any) => resolve({ data, error: null });
	return chain;
}

vi.mock('$lib/server/supabase', () => ({
	getSupabase: vi.fn(() => ({ from: vi.fn(() => buildChain()) })),
	getSupabaseService: vi.fn(() => ({ from: vi.fn(() => buildChain()) })),
	FOH_POSITIONS: ['Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training'],
	BOH_POSITIONS: ['Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'],
	ALL_POSITIONS: ['Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training', 'Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'],
}));

vi.mock('$lib/server/integrations/weather/weather-service', () => ({
	getWeatherForDate: vi.fn(async () => null),
}));

vi.mock('$lib/server/integrations/resy/resy-service', () => ({
	getReservationsForDate: vi.fn(async () => null),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KPI / Insights API — Parameter Validation', () => {
	it('returns 400 when locationId is missing', async () => {
		const { GET } = await import('../../../../routes/api/v1/insights/+server');

		const url = new URL('http://localhost/api/v1/insights');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('locationId');
	});

	it('returns 400 when date is missing', async () => {
		const { GET } = await import('../../../../routes/api/v1/insights/+server');

		const url = new URL('http://localhost/api/v1/insights?locationId=loc-1');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('date');
	});

	it('returns valid response structure for valid parameters', async () => {
		const { GET } = await import('../../../../routes/api/v1/insights/+server');

		const url = new URL('http://localhost/api/v1/insights?locationId=loc-1&date=2026-03-27');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toHaveProperty('date');
		expect(body).toHaveProperty('sections');
		expect(body).toHaveProperty('metrics');
		expect(body).toHaveProperty('wtd');
	});

	it('response sections include all required narrative fields', async () => {
		const { GET } = await import('../../../../routes/api/v1/insights/+server');

		const url = new URL('http://localhost/api/v1/insights?locationId=loc-1&date=2026-03-27');
		const response = await GET({ url } as any);
		const body = await response.json();

		const expectedSections = [
			'revenueSummary',
			'coversSummary',
			'compsAndDiscounts',
			'salesMix',
			'pmixMovers',
			'laborVariance',
			'laborSavings',
			'hourlyEfficiency',
		];

		for (const section of expectedSections) {
			expect(body.sections).toHaveProperty(section);
		}
	});

	it('response metrics include revenue and labor fields', async () => {
		const { GET } = await import('../../../../routes/api/v1/insights/+server');

		const url = new URL('http://localhost/api/v1/insights?locationId=loc-1&date=2026-03-27');
		const response = await GET({ url } as any);
		const body = await response.json();

		expect(body.metrics).toHaveProperty('revenue');
		expect(body.metrics).toHaveProperty('budgetRevenue');
		expect(body.metrics).toHaveProperty('forecastRevenue');
		expect(body.metrics).toHaveProperty('covers');
		expect(body.metrics).toHaveProperty('avgCheck');
		expect(body.metrics).toHaveProperty('totalLaborActual');
		expect(body.metrics).toHaveProperty('laborPctOfRevenue');
		expect(body.metrics).toHaveProperty('fohActual');
		expect(body.metrics).toHaveProperty('bohActual');
	});
});

describe('KPI / Insights API — POST Validation', () => {
	it('returns 400 when locationId is missing in POST', async () => {
		const { POST } = await import('../../../../routes/api/v1/insights/+server');

		const request = new Request('http://localhost/api/v1/insights', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ notes: 'Test notes' }),
		});

		const response = await POST({ request } as any);
		const body = await response.json();

		expect(response.status).toBe(400);
		expect(body.error).toContain('required');
	});
});

describe('KPI / Insights — Period Boundary Calculations', () => {
	it('fiscal year period 1 starts on Dec 29', () => {
		const year = 2026;
		const period = 1;
		const fyStart = new Date(year - 1, 11, 29); // Dec 29 of prior year
		const pStart = new Date(fyStart);
		pStart.setDate(pStart.getDate() + (period - 1) * 28);

		expect(pStart.toISOString().split('T')[0]).toBe('2025-12-29');
	});

	it('each period is exactly 28 days', () => {
		const year = 2026;
		// Use T12:00:00 to avoid DST boundary issues
		const fyStart = new Date(`${year - 1}-12-29T12:00:00`);

		for (let period = 1; period <= 13; period++) {
			const pStart = new Date(fyStart);
			pStart.setDate(pStart.getDate() + (period - 1) * 28);
			const pEnd = new Date(pStart);
			pEnd.setDate(pEnd.getDate() + 27);

			const days = Math.round((pEnd.getTime() - pStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
			expect(days).toBe(28);
		}
	});

	it('Monday-of-week calculation is correct', () => {
		function getMondayOfWeek(dateStr: string): string {
			const d = new Date(dateStr + 'T12:00:00');
			const day = d.getDay();
			const diff = day === 0 ? 6 : day - 1;
			d.setDate(d.getDate() - diff);
			return d.toISOString().split('T')[0];
		}

		// Friday March 27 2026 -> Monday March 23
		expect(getMondayOfWeek('2026-03-27')).toBe('2026-03-23');
		// Sunday March 29 2026 -> Monday March 23
		expect(getMondayOfWeek('2026-03-29')).toBe('2026-03-23');
		// Monday March 23 2026 -> Monday March 23
		expect(getMondayOfWeek('2026-03-23')).toBe('2026-03-23');
	});
});

describe('KPI / Insights — Labor Flagging Logic', () => {
	it('flags positions with variance > 1.5% of revenue', () => {
		const revenue = 10000;
		const positions = [
			{ position: 'Server', actual: 1500, projected: 1200 },
			{ position: 'Host', actual: 200, projected: 190 },
			{ position: 'Line Cooks', actual: 900, projected: 600 },
		];

		const flagged = positions.filter(p => {
			const varianceDollars = p.actual - p.projected;
			const variancePct = revenue > 0 ? Math.abs(varianceDollars) / revenue : 0;
			return variancePct > 0.015;
		});

		// Server: |300|/10000 = 3% > 1.5% => flagged
		// Host: |10|/10000 = 0.1% < 1.5% => not flagged
		// Line Cooks: |300|/10000 = 3% > 1.5% => flagged
		expect(flagged).toHaveLength(2);
		expect(flagged.map(f => f.position)).toContain('Server');
		expect(flagged.map(f => f.position)).toContain('Line Cooks');
	});

	it('no flags when all positions are within threshold', () => {
		const revenue = 10000;
		const positions = [
			{ position: 'Server', actual: 1210, projected: 1200 },
			{ position: 'Host', actual: 195, projected: 190 },
		];

		const flagged = positions.filter(p => {
			const varianceDollars = p.actual - p.projected;
			const variancePct = revenue > 0 ? Math.abs(varianceDollars) / revenue : 0;
			return variancePct > 0.015;
		});

		expect(flagged).toHaveLength(0);
	});
});
