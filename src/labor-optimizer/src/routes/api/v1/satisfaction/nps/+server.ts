import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const dateFrom = url.searchParams.get('from');
  const dateTo = url.searchParams.get('to');
  const period = url.searchParams.get('period') || '30'; // days

  let query = sb.from('daily_nps').select('*');

  if (locationId) query = query.eq('location_id', locationId);

  if (dateFrom && dateTo) {
    query = query.gte('business_date', dateFrom).lte('business_date', dateTo);
  } else {
    const daysAgo = new Date(Date.now() - parseInt(period) * 86400000).toISOString().split('T')[0];
    query = query.gte('business_date', daysAgo);
  }

  const { data, error } = await query.order('business_date', { ascending: true });
  if (error) return json({ error: error.message }, { status: 500 });

  // Compute aggregate NPS for the period
  const totals = (data || []).reduce(
    (acc, row) => ({
      promoters: acc.promoters + row.promoters,
      passives: acc.passives + row.passives,
      detractors: acc.detractors + row.detractors,
    }),
    { promoters: 0, passives: 0, detractors: 0 },
  );

  const total = totals.promoters + totals.passives + totals.detractors;
  const nps = total > 0 ? Math.round(((totals.promoters - totals.detractors) / total) * 100) : null;

  return json({
    nps,
    total,
    promoters: totals.promoters,
    passives: totals.passives,
    detractors: totals.detractors,
    daily: data,
  });
};
