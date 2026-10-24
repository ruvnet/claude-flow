import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const resolved = url.searchParams.get('resolved') === 'true';
  const limit = parseInt(url.searchParams.get('limit') || '20');

  let query = sb.from('satisfaction_alerts').select('*');

  if (locationId) query = query.eq('location_id', locationId);
  query = query.eq('is_resolved', resolved);

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ alerts: data });
};
