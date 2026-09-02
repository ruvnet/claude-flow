import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const locationId = url.searchParams.get('locationId');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  const position = url.searchParams.get('position');
  const unexplainedOnly = url.searchParams.get('unexplainedOnly') === 'true';

  if (!locationId) return json({ error: 'locationId required' }, { status: 400 });

  let query = sb.from('variance_log')
    .select('*')
    .eq('location_id', locationId)
    .order('business_date', { ascending: false });

  if (startDate) query = query.gte('business_date', startDate);
  if (endDate) query = query.lte('business_date', endDate);
  if (position) query = query.eq('position', position);
  if (unexplainedOnly) query = query.is('explanation', null);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, { status: 500 });

  return json({ entries: data });
};

export const POST: RequestHandler = async ({ request }) => {
  const sb = getSupabase();
  const body = await request.json();
  const { locationId, date, position, projectedDollars, actualDollars, explanation, createdBy } = body;

  if (!locationId || !date || !position) {
    return json({ error: 'locationId, date, position required' }, { status: 400 });
  }

  const varianceDollars = (projectedDollars || 0) - (actualDollars || 0);
  const variancePct = projectedDollars > 0 ? varianceDollars / projectedDollars : 0;

  const { data, error } = await sb.from('variance_log').upsert({
    location_id: locationId,
    business_date: date,
    position,
    projected_dollars: projectedDollars,
    actual_dollars: actualDollars,
    variance_dollars: Math.round(varianceDollars * 100) / 100,
    variance_pct: Math.round(variancePct * 10000) / 10000,
    explanation,
    created_by: createdBy || 'manager',
    updated_at: new Date().toISOString(),
  }, { onConflict: 'location_id,business_date,position' } as any).select();

  if (error) return json({ error: error.message }, { status: 500 });
  return json({ saved: true, entry: data?.[0] });
};
