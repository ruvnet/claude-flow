import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

/**
 * GET /api/v1/admin/learnings
 * Returns system learnings, optionally filtered by category and/or location.
 *
 * Query params:
 *   category - filter by category (forecast, labor, weather, scheduling, sales_mix)
 *   location_id - filter by location UUID
 *   limit - max results (default 100)
 */
export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const category = url.searchParams.get('category');
  const locationId = url.searchParams.get('location_id');
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);

  let query = sb
    .from('system_learnings')
    .select('*, locations(name)')
    .is('superseded_by', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (category) query = query.eq('category', category);
  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ learnings: data || [] });
};

/**
 * POST /api/v1/admin/learnings
 * Record a new system learning. Used by backend self-learning systems.
 *
 * Body: { location_id, category, learning, source, confidence? }
 */
export const POST: RequestHandler = async ({ request }) => {
  const sb = getSupabaseService();
  const body = await request.json();

  const { location_id, category, learning, source, confidence } = body;

  if (!category || !learning || !source) {
    return json(
      { error: 'Missing required fields: category, learning, source' },
      { status: 400 },
    );
  }

  const validCategories = ['forecast', 'labor', 'weather', 'scheduling', 'sales_mix'];
  if (!validCategories.includes(category)) {
    return json(
      { error: `Invalid category. Must be one of: ${validCategories.join(', ')}` },
      { status: 400 },
    );
  }

  const { data, error } = await sb
    .from('system_learnings')
    .insert({
      location_id: location_id || null,
      category,
      learning,
      source,
      confidence: confidence ?? 0.5,
    })
    .select()
    .single();

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ learning: data }, { status: 201 });
};
