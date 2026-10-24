/**
 * Backdate Forecasts Endpoint
 *
 * Generates retroactive AI forecasts for historical dates, auto-accepts them,
 * triggers labor projection cascades, and records forecast accuracy where
 * actuals exist. Processes at most 5 days per request to stay within Vercel's
 * serverless timeout. Returns `nextStartDate` for pagination.
 *
 * POST /api/v1/admin/backdate-forecasts
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { generateForecastSuggestion, acceptForecast } from '$lib/server/domain/forecasting/ai-forecast';
import { recordForecastAccuracy } from '$lib/server/domain/forecasting/forecast-accuracy';

const MAX_DAYS_PER_REQUEST = 5;

interface BackdateRequest {
	locationId: string;
	startDate: string; // YYYY-MM-DD
	endDate: string;   // YYYY-MM-DD
}

interface DateResult {
	date: string;
	status: 'success' | 'skipped' | 'error';
	suggestedRevenue?: number;
	suggestedCovers?: number;
	confidence?: number;
	targetsGenerated?: number;
	accuracyRecorded?: boolean;
	skipReason?: string;
	error?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	// ── Auth: accept CRON_SECRET bearer token ──
	const authHeader = request.headers.get('authorization');
	const cronSecret = process.env.CRON_SECRET;

	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	// ── Parse & validate ──
	const body: BackdateRequest = await request.json();
	const { locationId, startDate, endDate } = body;

	if (!locationId || !startDate || !endDate) {
		return json(
			{ error: 'Missing required fields: locationId, startDate, endDate' },
			{ status: 400 },
		);
	}

	if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
		return json({ error: 'Dates must be in YYYY-MM-DD format' }, { status: 400 });
	}

	if (startDate > endDate) {
		return json({ error: 'startDate must be <= endDate' }, { status: 400 });
	}

	const sb = getSupabaseService();

	// ── Verify location exists ──
	const { data: loc, error: locErr } = await sb
		.from('locations')
		.select('id, name')
		.eq('id', locationId)
		.single();

	if (locErr || !loc) {
		return json({ error: 'Location not found' }, { status: 404 });
	}

	// ── Build date list, capped at MAX_DAYS_PER_REQUEST ──
	const allDates: string[] = [];
	const start = new Date(startDate + 'T12:00:00Z');
	const end = new Date(endDate + 'T12:00:00Z');
	for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
		allDates.push(d.toISOString().split('T')[0]);
	}

	const datesToProcess = allDates.slice(0, MAX_DAYS_PER_REQUEST);
	const hasMore = allDates.length > MAX_DAYS_PER_REQUEST;
	const nextStartDate = hasMore ? allDates[MAX_DAYS_PER_REQUEST] : null;

	// ── Fetch existing forecasts to skip dates that already have manual forecasts ──
	const { data: existingForecasts } = await sb
		.from('daily_forecasts')
		.select('business_date, accepted_by')
		.eq('location_id', locationId)
		.in('business_date', datesToProcess)
		.not('manager_revenue', 'is', null);

	const existingMap = new Map<string, string>();
	for (const f of existingForecasts || []) {
		existingMap.set(f.business_date, f.accepted_by || 'unknown');
	}

	// ── Process each date ──
	const results: DateResult[] = [];

	for (const dateStr of datesToProcess) {
		try {
			// Skip if a non-backdate forecast already exists
			const existingBy = existingMap.get(dateStr);
			if (existingBy && existingBy !== 'system-backdate') {
				results.push({
					date: dateStr,
					status: 'skipped',
					skipReason: `Existing forecast by ${existingBy}`,
				});
				continue;
			}

			// 1. Generate AI forecast suggestion
			const suggestion = await generateForecastSuggestion(locationId, dateStr);

			if (!suggestion.suggestedRevenue || suggestion.suggestedRevenue <= 0) {
				results.push({
					date: dateStr,
					status: 'skipped',
					skipReason: 'No revenue suggestion generated (insufficient data)',
				});
				continue;
			}

			// 2. Accept the forecast (triggers labor projection cascade)
			const acceptResult = await acceptForecast(
				locationId,
				dateStr,
				suggestion.suggestedRevenue,
				false,       // isOverride
				null,        // overrideExplanation
				'system-backdate',
			);

			// 3. Record forecast accuracy if actuals exist for this date
			let accuracyRecorded = false;
			try {
				await recordForecastAccuracy(locationId, dateStr);
				accuracyRecorded = true;
			} catch {
				// Accuracy recording is non-critical; actuals may not exist
			}

			results.push({
				date: dateStr,
				status: 'success',
				suggestedRevenue: suggestion.suggestedRevenue,
				suggestedCovers: suggestion.suggestedCovers,
				confidence: suggestion.confidence,
				targetsGenerated: acceptResult.targetsGenerated,
				accuracyRecorded,
			});
		} catch (err: any) {
			results.push({
				date: dateStr,
				status: 'error',
				error: err.message,
			});
		}
	}

	// ── Summary ──
	const successCount = results.filter((r) => r.status === 'success').length;
	const skippedCount = results.filter((r) => r.status === 'skipped').length;
	const errorCount = results.filter((r) => r.status === 'error').length;

	return json({
		location: loc.name,
		locationId: loc.id,
		requested: { startDate, endDate, totalDays: allDates.length },
		processed: {
			dates: datesToProcess.length,
			success: successCount,
			skipped: skippedCount,
			errors: errorCount,
		},
		nextStartDate,
		hasMore,
		results,
	});
};
