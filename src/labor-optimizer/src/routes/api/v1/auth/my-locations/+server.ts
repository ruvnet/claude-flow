/**
 * My Locations API
 *
 * GET: Returns the locations the current user has access to, based on role.
 *   - super_admin: ALL active locations
 *   - director: all locations in their assigned user_groups
 *   - manager / viewer: only specifically assigned locations via location_users
 *
 * Query params:
 *   email (required) - user's email address
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { type UserRole, isValidRole, getHighestRole } from '$lib/roles';
import { getCached, setCache } from '$lib/server/cache';

export const GET: RequestHandler = async ({ url }) => {
  const email = url.searchParams.get('email');

  if (!email) {
    return json({ error: 'email query parameter is required' }, { status: 400 });
  }

  // Check cache (10 minute TTL)
  const cacheKey = `locations:${email}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return json(cached);

  const sb = getSupabaseService();

  // 1. Determine the user's role — parallelize both lookups
  const roles: UserRole[] = [];

  const [{ data: groupMembers }, { data: locationUsers }] = await Promise.all([
    sb.from('user_group_members').select('role, group_id').eq('user_email', email),
    sb.from('location_users').select('role, location_id').eq('user_email', email),
  ]);

  if (groupMembers && groupMembers.length > 0) {
    for (const gm of groupMembers) {
      if (gm.role && isValidRole(gm.role)) {
        roles.push(gm.role as UserRole);
      }
    }
  }

  if (locationUsers && locationUsers.length > 0) {
    for (const lu of locationUsers) {
      if (lu.role && isValidRole(lu.role)) {
        roles.push(lu.role as UserRole);
      }
    }
  }

  const role = getHighestRole(roles);

  // 2. Determine which location IDs this user can access
  let locationIds: string[] | null = null; // null = all locations

  if (role === 'super_admin') {
    // Super admins see everything
    locationIds = null;
  } else if (role === 'director') {
    // Directors see all locations in their assigned groups
    const groupIds = (groupMembers || [])
      .filter((gm) => gm.group_id)
      .map((gm) => gm.group_id);

    if (groupIds.length > 0) {
      const { data: groupLocations } = await sb
        .from('user_group_locations')
        .select('location_id')
        .in('group_id', groupIds);

      const fromGroups = (groupLocations || []).map((gl) => gl.location_id);
      // Also include any directly assigned locations
      const fromDirect = (locationUsers || []).map((lu) => lu.location_id);
      locationIds = [...new Set([...fromGroups, ...fromDirect])];
    } else {
      // Director with no groups — fall back to direct assignments
      locationIds = (locationUsers || []).map((lu) => lu.location_id);
    }

    // If director has no assignments at all, give them all locations
    if (locationIds.length === 0) {
      locationIds = null;
    }
  } else {
    // Manager / Viewer — only directly assigned locations
    locationIds = (locationUsers || []).map((lu) => lu.location_id);
  }

  // 3. Fetch the actual location records
  let query = sb
    .from('locations')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  if (locationIds !== null && locationIds.length > 0) {
    query = query.in('id', locationIds);
  } else if (locationIds !== null && locationIds.length === 0) {
    // User has no location assignments — return empty
    return json({ locations: [], role });
  }

  const { data: locations, error } = await query;

  if (error) {
    return json({ error: error.message }, { status: 500 });
  }

  const result = { locations: locations || [], role };
  setCache(cacheKey, result, 600); // 10 minutes
  return json(result);
};
