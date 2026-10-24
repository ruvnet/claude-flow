import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request }) => {
  // Auth handled by hooks.server.ts — all admin routes require JWT or CRON_SECRET
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const sb = getSupabaseService();
  const results: string[] = [];

  // 1. Create Super Admin group
  const { data: existingGroup } = await sb
    .from('user_groups')
    .select('id')
    .eq('name', 'Super Admin')
    .maybeSingle();

  let superAdminGroupId = existingGroup?.id;

  if (!superAdminGroupId) {
    const { data: newGroup, error: e1 } = await sb
      .from('user_groups')
      .insert({
        name: 'Super Admin',
        description: 'Full platform access — all locations, all features',
        permissions: ['reporting', 'planning', 'admin', 'insights', 'schedule_approval', 'forecast_unlock'],
      })
      .select('id')
      .single();
    if (e1) {
      results.push(`Create Super Admin group error: ${e1.message}`);
    } else {
      superAdminGroupId = newGroup.id;
      results.push(`Created Super Admin group: ${superAdminGroupId}`);
    }
  } else {
    results.push(`Super Admin group already exists: ${superAdminGroupId}`);
  }

  // 2. Fix Director group — remove 'admin' permission
  const { error: e2 } = await sb
    .from('user_groups')
    .update({
      description: 'Reporting, planning, insights, and schedule approval',
      permissions: ['reporting', 'planning', 'insights', 'schedule_approval'],
    })
    .eq('name', 'Director');
  results.push(e2 ? `Fix Director error: ${e2.message}` : 'Director group: removed admin permission');

  // 3. Move rr@methodco.com from Director to Super Admin
  if (superAdminGroupId) {
    // Get all location IDs
    const { data: allLocs } = await sb.from('locations').select('id');
    const allLocationIds = (allLocs || []).map((l: any) => l.id);

    // Delete from Director group
    const { error: e3 } = await sb
      .from('user_group_members')
      .delete()
      .eq('user_email', 'rr@methodco.com');
    results.push(e3 ? `Remove from Director error: ${e3.message}` : 'Removed rr@methodco.com from Director group');

    // Get user ID from Supabase auth
    const { data: authUsers } = await sb.auth.admin.listUsers({ perPage: 100 });
    const rrUser = authUsers?.users?.find((u: any) => u.email === 'rr@methodco.com');
    const userId = rrUser?.id || '64fef13f-8b07-42a0-bc04-4f690d152bef';

    // Add to Super Admin group with all locations
    const { error: e4 } = await sb
      .from('user_group_members')
      .insert({
        user_id: userId,
        user_email: 'rr@methodco.com',
        user_name: 'Ross Richardson',
        group_id: superAdminGroupId,
        location_ids: allLocationIds,
      });
    results.push(e4 ? `Add to Super Admin error: ${e4.message}` : `Added rr@methodco.com to Super Admin with ${allLocationIds.length} locations`);
  }

  // 4. Update location_users role
  const { error: e5 } = await sb
    .from('location_users')
    .update({ role: 'super_admin' })
    .eq('user_email', 'rr@methodco.com');
  results.push(e5 ? `location_users error: ${e5.message}` : 'location_users: rr@methodco.com -> super_admin');

  return json({ results });
};
