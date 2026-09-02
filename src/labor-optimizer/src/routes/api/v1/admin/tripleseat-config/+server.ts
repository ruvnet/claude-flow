import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { createTripleseatClient } from '$lib/server/integrations/tripleseat/tripleseat-client';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');

  let query = sb.from('tripleseat_config').select('*');
  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query;
  if (error) return json({ error: error.message }, { status: 500 });

  return json({ configs: data || [] });
};

export const POST: RequestHandler = async ({ request, url }) => {
  const sb = getSupabaseService();
  const action = url.searchParams.get('action');

  // Test connection endpoint
  if (action === 'test') {
    const { consumerKey, consumerSecret } = await request.json();
    if (!consumerKey || !consumerSecret) {
      return json({ error: 'consumerKey and consumerSecret required' }, { status: 400 });
    }
    const client = createTripleseatClient(consumerKey, consumerSecret);
    const result = await client.testConnection();
    return json(result);
  }

  // Upsert config
  const body = await request.json();
  const { locationId, consumerKey, consumerSecret, tripleseatSiteId, enabled } = body;

  if (!locationId || !consumerKey || !consumerSecret) {
    return json({ error: 'locationId, consumerKey, and consumerSecret required' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('tripleseat_config')
    .upsert({
      location_id: locationId,
      consumer_key: consumerKey,
      consumer_secret: consumerSecret,
      tripleseat_site_id: tripleseatSiteId || null,
      enabled: enabled !== false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'location_id' })
    .select()
    .single();

  if (error) return json({ error: error.message }, { status: 500 });

  return json({ ok: true, config: data });
};
