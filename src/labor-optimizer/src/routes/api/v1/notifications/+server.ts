import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

function getBearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

/** GET — fetch unread (and recent read) notifications for the current user. */
export const GET: RequestHandler = async ({ request }) => {
  const token = getBearerToken(request);
  if (!token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const { data: userData, error: authError } = await sb.auth.getUser(token);
  if (authError || !userData?.user?.email) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userEmail = userData.user.email;

  const { data: notifications, error } = await sb
    .from('notifications')
    .select('*')
    .eq('user_email', userEmail)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  const unreadCount = (notifications || []).filter((n) => !n.read).length;

  return json({ notifications: notifications || [], unreadCount });
};

/** POST — mark one or all notifications as read. */
export const POST: RequestHandler = async ({ request }) => {
  const token = getBearerToken(request);
  if (!token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const { data: userData, error: authError } = await sb.auth.getUser(token);
  if (authError || !userData?.user?.email) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userEmail = userData.user.email;
  const body = await request.json();
  const { action, id } = body as { action: string; id?: string };

  if (action !== 'mark_read') {
    return json({ error: 'Invalid action' }, { status: 400 });
  }

  let query = sb
    .from('notifications')
    .update({ read: true })
    .eq('user_email', userEmail);

  if (id) {
    query = query.eq('id', id);
  }

  const { error } = await query;
  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  return json({ updated: true });
};
