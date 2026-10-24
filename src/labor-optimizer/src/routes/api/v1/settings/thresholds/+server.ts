import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
	const sb = getSupabase();
	const locationId = url.searchParams.get('locationId');
	if (!locationId) return json({ error: 'locationId required' }, { status: 400 });
	const { data } = await sb.from('labor_thresholds').select('*').eq('location_id', locationId).order('revenue_bracket_low').order('position');
	return json({ thresholds: data || [] });
};
