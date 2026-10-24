import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { invalidateCache } from '$lib/server/cache';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const year = url.searchParams.get('year') || new Date().getFullYear().toString();

  if (!locationId) {
    return json({ error: 'locationId required' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('event_revenue_budget')
    .select('*')
    .eq('location_id', locationId)
    .eq('year', Number(year))
    .order('month');

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ budgets: data || [] });
};

export const POST: RequestHandler = async ({ request }) => {
  const sb = getSupabaseService();
  const body = await request.json();
  const { locationId, year, month, food_budget, beverage_budget, rental_budget, av_budget, other_budget } = body;

  if (!locationId || !year || !month) {
    return json({ error: 'locationId, year, and month required' }, { status: 400 });
  }

  const total_budget = (food_budget || 0) + (beverage_budget || 0) + (rental_budget || 0) + (av_budget || 0) + (other_budget || 0);

  const { data, error } = await sb
    .from('event_revenue_budget')
    .upsert({
      location_id: locationId,
      year: Number(year),
      month: Number(month),
      food_budget: food_budget || 0,
      beverage_budget: beverage_budget || 0,
      rental_budget: rental_budget || 0,
      av_budget: av_budget || 0,
      other_budget: other_budget || 0,
      total_budget,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id,year,month' })
    .select()
    .single();

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  // Invalidate PACE cache for this location
  invalidateCache(`events-pace:${locationId}`);

  return json({ ok: true, budget: data });
};
