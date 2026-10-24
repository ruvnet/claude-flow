/**
 * Admin Trigger Sync
 * POST — triggers the toast-sync cron using the server's own CRON_SECRET.
 * Requires an active admin session (Supabase auth).
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request, url }) => {
  const authHeader = request.headers.get('authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, { status: 401 });

  const token = authHeader.replace('Bearer ', '');
  const sb = getSupabaseService();

  const { data: { user }, error: userErr } = await sb.auth.getUser(token);
  if (!user || userErr) return json({ error: 'Unauthorized' }, { status: 401 });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return json({ error: 'CRON_SECRET not configured on server' }, { status: 500 });
  }

  const cronUrl = `${url.origin}/api/cron/toast-sync`;
  const res = await fetch(cronUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${cronSecret}` },
  });

  const data = await res.json();
  return json(data, { status: res.status });
};
