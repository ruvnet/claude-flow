/**
 * Labor Targets API
 *
 * POST: Recalculate labor targets for a week
 * GET:  Get current DOW weights and threshold info
 * PUT:  Manually trigger DOW weight adaptation from actuals
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	calculateWeeklyLaborTargets,
	adaptDOWWeights,
	getDOWWeightsAndThresholds,
} from '$lib/server/domain/forecasting/labor-projection';

/** POST — Recalculate labor targets for a specific week. */
export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { locationId, weekStartDate } = body;

	if (!locationId || !weekStartDate) {
		return json(
			{ error: 'locationId and weekStartDate are required' },
			{ status: 400 },
		);
	}

	try {
		const result = await calculateWeeklyLaborTargets(locationId, weekStartDate);
		return json(result);
	} catch (err: any) {
		return json(
			{ error: `Failed to calculate targets: ${err.message}` },
			{ status: 500 },
		);
	}
};

/** GET — Get current DOW weights and threshold info for a location. */
export const GET: RequestHandler = async ({ url }) => {
	const locationId = url.searchParams.get('locationId');
	const date = url.searchParams.get('date') || undefined;

	if (!locationId) {
		return json({ error: 'locationId is required' }, { status: 400 });
	}

	try {
		const data = await getDOWWeightsAndThresholds(locationId, date);
		return json(data);
	} catch (err: any) {
		return json(
			{ error: `Failed to get weights: ${err.message}` },
			{ status: 500 },
		);
	}
};

/** PUT — Manually trigger DOW weight adaptation from actuals. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json();
	const { locationId } = body;

	if (!locationId) {
		return json({ error: 'locationId is required' }, { status: 400 });
	}

	try {
		const result = await adaptDOWWeights(locationId);
		return json(result);
	} catch (err: any) {
		return json(
			{ error: `Failed to adapt weights: ${err.message}` },
			{ status: 500 },
		);
	}
};
