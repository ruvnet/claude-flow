import { json, type RequestHandler } from '@sveltejs/kit';
import { getSupabase } from '$lib/server/supabase';

export const GET: RequestHandler = async () => {
  const sb = getSupabase();
  const { data: locations, error } = await sb
    .from('locations')
    .select('id, name, type, city, toast_guid, timezone, labor_budget_pct, is_active')
    .eq('is_active', true)
    .order('name');

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ locations: locations || [] });
};
