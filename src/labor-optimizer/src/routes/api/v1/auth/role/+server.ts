/**
 * Auth Role API
 *
 * GET: Returns the current user's role, legacy permissions, AND tabPermissions
 *      from their user_group's tab_permissions JSONB column.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import {
  type UserRole,
  type TabPermissions,
  ROLE_PERMISSIONS,
  EMPTY_TAB_PERMISSIONS,
  DEFAULT_GROUP_PERMISSIONS,
  isValidRole,
  getHighestRole,
} from '$lib/roles';
import { getCached, setCache } from '$lib/server/cache';

export const GET: RequestHandler = async ({ url }) => {
  const email = url.searchParams.get('email');

  if (!email) {
    return json({ error: 'email query parameter is required' }, { status: 400 });
  }

  // Check cache (10 minute TTL)
  const cacheKey = `role:v2:${email}`;
  const cached = getCached<{ email: string; role: UserRole; permissions: any; tabPermissions: TabPermissions }>(cacheKey);
  if (cached) return json(cached);

  const sb = getSupabaseService();
  const roles: UserRole[] = [];

  // Fetch group membership with group details, and location_users in parallel
  const [{ data: memberRows }, { data: locationUsers }] = await Promise.all([
    sb
      .from('user_group_members')
      .select('role, group_id, user_groups(name, tab_permissions)')
      .eq('user_email', email),
    sb.from('location_users').select('role').eq('user_email', email),
  ]);

  // Merge tab permissions from all groups the user belongs to
  let tabPermissions: TabPermissions = { reporting: [], planning: [], admin: [] };

  if (memberRows && memberRows.length > 0) {
    for (const gm of memberRows) {
      if (gm.role && isValidRole(gm.role)) {
        roles.push(gm.role as UserRole);
      }

      // Get tab_permissions from the joined group
      const group = gm.user_groups as any;
      if (group) {
        const tp: TabPermissions | null = group.tab_permissions;
        if (tp && typeof tp === 'object') {
          // Merge arrays (union)
          if (Array.isArray(tp.reporting)) {
            for (const t of tp.reporting) {
              if (!tabPermissions.reporting.includes(t)) tabPermissions.reporting.push(t);
            }
          }
          if (Array.isArray(tp.planning)) {
            for (const t of tp.planning) {
              if (!tabPermissions.planning.includes(t)) tabPermissions.planning.push(t);
            }
          }
          if (Array.isArray(tp.admin)) {
            for (const t of tp.admin) {
              if (!tabPermissions.admin.includes(t)) tabPermissions.admin.push(t);
            }
          }
        } else if (group.name && DEFAULT_GROUP_PERMISSIONS[group.name]) {
          // Fallback: use defaults based on group name if tab_permissions is empty
          const defaults = DEFAULT_GROUP_PERMISSIONS[group.name];
          for (const t of defaults.reporting) {
            if (!tabPermissions.reporting.includes(t)) tabPermissions.reporting.push(t);
          }
          for (const t of defaults.planning) {
            if (!tabPermissions.planning.includes(t)) tabPermissions.planning.push(t);
          }
          for (const t of defaults.admin) {
            if (!tabPermissions.admin.includes(t)) tabPermissions.admin.push(t);
          }
        }
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

  // Determine the highest role; default to 'viewer'
  const role = getHighestRole(roles);
  const permissions = ROLE_PERMISSIONS[role];

  // If user has no group-based tabPermissions but has a legacy role, derive from defaults
  const hasAnyTab = tabPermissions.reporting.length + tabPermissions.planning.length + tabPermissions.admin.length;
  if (hasAnyTab === 0 && role !== 'viewer') {
    // Map legacy role to a default group
    const roleToGroup: Record<string, string> = {
      super_admin: 'Super Admin',
      director: 'Director',
      admin: 'Super Admin',
      manager: 'Manager',
    };
    const groupName = roleToGroup[role];
    if (groupName && DEFAULT_GROUP_PERMISSIONS[groupName]) {
      tabPermissions = { ...DEFAULT_GROUP_PERMISSIONS[groupName] };
    }
  }

  const result = { email, role, permissions, tabPermissions };
  setCache(cacheKey, result, 600);
  return json(result);
};
