import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { computeServerPerformance } from '$lib/server/domain/satisfaction/server-performance';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const days = parseInt(url.searchParams.get('days') || '30');

  if (!locationId) return json({ error: 'locationId required' }, { status: 400 });

  const dateTo = new Date().toISOString().split('T')[0];
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  try {
    const servers = await computeServerPerformance(sb, locationId, dateFrom, dateTo);
    return json({ servers, period: { from: dateFrom, to: dateTo } });
  } catch (err) {
    return json({ error: (err as Error).message }, { status: 500 });
  }
};
