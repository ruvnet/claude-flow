/**
 * Dolce Job Mapping API
 *
 * GET  — fetch all dolce_job_mapping rows for a location
 * POST — bulk upsert mappings for a location
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseService } from '$lib/server/supabase';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const locationId = url.searchParams.get('locationId');
  if (!locationId) {
    return json({ error: 'locationId required' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('dolce_job_mapping')
    .select('*')
    .eq('location_id', locationId)
    .order('dolce_role_name');

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ mappings: data || [] });
};

export const POST: RequestHandler = async ({ request }) => {
  const { locationId, mappings } = await request.json();
  if (!locationId || !Array.isArray(mappings)) {
    return json({ error: 'locationId and mappings[] required' }, { status: 400 });
  }

  const sb = getSupabaseService();
  const errors: string[] = [];

  for (const m of mappings) {
    if (!m.dolce_role_name || !m.dashboard_position) continue;

    const { error } = await sb
      .from('dolce_job_mapping')
      .upsert(
        {
          location_id: locationId,
          dolce_role_name: m.dolce_role_name,
          dashboard_position: m.dashboard_position,
        },
        { onConflict: 'location_id,dolce_role_name' },
      );

    if (error) {
      errors.push(`${m.dolce_role_name}: ${error.message}`);
    }
  }

  if (errors.length > 0) {
    return json({ saved: false, errors }, { status: 500 });
  }

  return json({ saved: true });
};
