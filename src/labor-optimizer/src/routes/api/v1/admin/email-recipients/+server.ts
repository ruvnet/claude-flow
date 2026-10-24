import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

/**
 * CRUD API for managing location_users (email recipients for daily insights).
 *
 * GET  ?locationId=xxx          — List all recipients for a location
 * POST { locationId, email, name, role, receives_daily_email }  — Add a recipient
 * DELETE { id }                 — Remove a recipient
 * PATCH { id, receives_daily_email } — Toggle email preference
 */
export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  if (!locationId) {
    return json({ error: 'locationId is required' }, { status: 400 });
  }

  const sb = getSupabaseService();
  const { data, error } = await sb
    .from('location_users')
    .select('*')
    .eq('location_id', locationId)
    .order('created_at', { ascending: true });

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ recipients: data || [] });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { locationId, email, name, role, receives_daily_email } = body;

  if (!locationId || !email) {
    return json({ error: 'locationId and email are required' }, { status: 400 });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email format' }, { status: 400 });
  }

  // Validate role
  const validRoles = ['manager', 'director', 'admin'];
  if (role && !validRoles.includes(role)) {
    return json({ error: `Role must be one of: ${validRoles.join(', ')}` }, { status: 400 });
  }

  const sb = getSupabaseService();
  const { data, error } = await sb
    .from('location_users')
    .upsert(
      {
        location_id: locationId,
        user_email: email.toLowerCase().trim(),
        user_name: name || null,
        role: role || 'manager',
        receives_daily_email: receives_daily_email !== false,
      },
      { onConflict: 'location_id,user_email' },
    )
    .select()
    .single();

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ recipient: data });
};

export const DELETE: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { id } = body;

  if (!id) {
    return json({ error: 'id is required' }, { status: 400 });
  }

  const sb = getSupabaseService();
  const { error } = await sb.from('location_users').delete().eq('id', id);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { id, receives_daily_email, role, user_name } = body;

  if (!id) {
    return json({ error: 'id is required' }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (receives_daily_email !== undefined) update.receives_daily_email = receives_daily_email;
  if (role !== undefined) update.role = role;
  if (user_name !== undefined) update.user_name = user_name;

  if (Object.keys(update).length === 0) {
    return json({ error: 'No fields to update' }, { status: 400 });
  }

  const sb = getSupabaseService();
  const { data, error } = await sb
    .from('location_users')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ recipient: data });
};
