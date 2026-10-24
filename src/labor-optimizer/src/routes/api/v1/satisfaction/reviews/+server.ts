import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const platform = url.searchParams.get('platform');
  const sentiment = url.searchParams.get('sentiment');
  const dateFrom = url.searchParams.get('from');
  const dateTo = url.searchParams.get('to');
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let query = sb.from('external_reviews').select('*', { count: 'exact' });

  if (locationId) query = query.eq('location_id', locationId);
  if (platform) query = query.eq('platform', platform);
  if (sentiment) query = query.eq('sentiment', sentiment);
  if (dateFrom) query = query.gte('review_date', dateFrom);
  if (dateTo) query = query.lte('review_date', dateTo);

  const { data, count, error } = await query
    .order('review_date', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ reviews: data, total: count });
};
