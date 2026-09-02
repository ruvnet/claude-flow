import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseService } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
	const sb = getSupabase();
	const locationId = url.searchParams.get('locationId');
	if (!locationId) return json({ error: 'locationId required' }, { status: 400 });
	const { data } = await sb.from('toast_job_mapping').select('*').eq('location_id', locationId);
	return json({ mappings: data || [] });
};

export const POST: RequestHandler = async ({ request }) => {
	const { locationId, mappings } = await request.json();
	const sb = getSupabaseService();
	for (const m of mappings) {
		await sb.from('toast_job_mapping').upsert(
			{ location_id: locationId, toast_job_name: m.toast_job_name, dashboard_position: m.dashboard_position },
			{ onConflict: 'location_id,toast_job_name' }
		);
	}
	return json({ saved: true });
};
