import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const dateFrom = url.searchParams.get('from');
  const dateTo = url.searchParams.get('to');
  const serverName = url.searchParams.get('server');
  const limit = parseInt(url.searchParams.get('limit') || '100');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = sb.from('guest_surveys').select('*', { count: 'exact' });

  if (locationId) query = query.eq('location_id', locationId);
  if (dateFrom) query = query.gte('survey_date', dateFrom);
  if (dateTo) query = query.lte('survey_date', dateTo);
  if (serverName) query = query.ilike('server_name', `%${serverName}%`);

  const { data, count, error } = await query
    .order('survey_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ surveys: data, total: count });
};
