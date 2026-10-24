import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getCompetitorAvailability,
	getMultiDaySnapshot,
	getAllCompetitors,
	upsertCompetitor,
	deactivateCompetitor,
} from '$lib/server/domain/competitive/comp-set';

// ---------------------------------------------------------------------------
// GET  /api/v1/competitive?locationId=...&date=...&days=7
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ url }) => {
	const locationId = url.searchParams.get('locationId');
	const date = url.searchParams.get('date');
	const days = parseInt(url.searchParams.get('days') || '1', 10);

	if (!locationId) {
		return json({ error: 'locationId is required' }, { status: 400 });
	}

	// If ?config=true, return the competitor configuration list
	if (url.searchParams.get('config') === 'true') {
		const competitors = await getAllCompetitors(locationId);
		return json({ competitors });
	}

	if (!date) {
		return json({ error: 'date (YYYY-MM-DD) is required' }, { status: 400 });
	}

	// Clamp days to 1-14 to avoid abuse
	const clampedDays = Math.max(1, Math.min(14, days));

	if (clampedDays === 1) {
		const snapshot = await getCompetitorAvailability(locationId, date);
		return json(snapshot);
	}

	const snapshots = await getMultiDaySnapshot(locationId, date, clampedDays);
	return json({ snapshots });
};

// ---------------------------------------------------------------------------
// POST  /api/v1/competitive  — upsert competitor
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ request }) => {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const {
		id,
		location_id,
		competitor_name,
		competitor_resy_id,
		competitor_city,
		competitor_cuisine,
		competitor_price_tier,
		distance_miles,
		is_active,
	} = body as Record<string, string | number | boolean | null>;

	if (!location_id || !competitor_name) {
		return json(
			{ error: 'location_id and competitor_name are required' },
			{ status: 400 }
		);
	}

	const result = await upsertCompetitor({
		...(id ? { id: String(id) } : {}),
		location_id: String(location_id),
		competitor_name: String(competitor_name),
		competitor_resy_id: competitor_resy_id ? String(competitor_resy_id) : null,
		competitor_city: competitor_city ? String(competitor_city) : null,
		competitor_cuisine: competitor_cuisine ? String(competitor_cuisine) : null,
		competitor_price_tier: competitor_price_tier ? String(competitor_price_tier) : null,
		distance_miles: distance_miles != null ? Number(distance_miles) : null,
		is_active: is_active !== false,
	});

	if (!result) {
		return json({ error: 'Failed to save competitor' }, { status: 500 });
	}

	return json({ competitor: result });
};

// ---------------------------------------------------------------------------
// DELETE  /api/v1/competitive?id=...  — deactivate a competitor
// ---------------------------------------------------------------------------

export const DELETE: RequestHandler = async ({ url }) => {
	const id = url.searchParams.get('id');
	if (!id) {
		return json({ error: 'id is required' }, { status: 400 });
	}

	const ok = await deactivateCompetitor(id);
	if (!ok) {
		return json({ error: 'Failed to deactivate competitor' }, { status: 500 });
	}

	return json({ success: true });
};
