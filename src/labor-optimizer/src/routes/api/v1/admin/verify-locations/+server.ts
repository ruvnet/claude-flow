import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const config = { maxDuration: 30 };

/**
 * GET /api/v1/admin/verify-locations
 *
 * Verifies all 11 HELIXO locations have complete Toast credentials and recent data.
 *
 * Auth: adminKey query param (`helixo-admin-2026`) OR CRON_SECRET bearer token.
 *
 * Response shape:
 *   {
 *     locations: LocationVerification[],
 *     summary: { total, fullyConfigured, missingCredentials, neverSynced }
 *   }
 */

interface LocationVerification {
  name: string;
  id: string;
  hasToastGuid: boolean;
  hasClientId: boolean;
  hasClientSecret: boolean;
  isActive: boolean;
  lastSyncDate: string | null;
  lastSyncAt: string | null;
  jobMappingCount: number;
}

export const GET: RequestHandler = async ({ request, url }) => {
  // Auth: accept adminKey query param or CRON_SECRET bearer token
  const adminKey = url.searchParams.get('adminKey');
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  const validAdminKey = adminKey === 'helixo-admin-2026';
  const validBearer = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!validAdminKey && !validBearer) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();

  // 1. Fetch all active locations
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('id, name, toast_guid, toast_client_id, toast_client_secret, is_active')
    .eq('is_active', true)
    .order('name');

  if (locErr) {
    return json({ error: 'Failed to query locations', details: locErr.message }, { status: 500 });
  }

  if (!locations || locations.length === 0) {
    return json({ locations: [], summary: { total: 0, fullyConfigured: 0, missingCredentials: 0, neverSynced: 0 } });
  }

  const locationIds = locations.map((l) => l.id);

  // 2. Fetch most recent daily_actuals sync per location
  const { data: syncRows, error: syncErr } = await sb
    .from('daily_actuals')
    .select('location_id, business_date, synced_at')
    .in('location_id', locationIds)
    .order('business_date', { ascending: false });

  if (syncErr) {
    return json({ error: 'Failed to query daily_actuals', details: syncErr.message }, { status: 500 });
  }

  // Build map: location_id -> most recent sync info
  const syncMap = new Map<string, { business_date: string; synced_at: string }>();
  for (const row of syncRows ?? []) {
    if (!syncMap.has(row.location_id)) {
      syncMap.set(row.location_id, {
        business_date: row.business_date,
        synced_at: row.synced_at,
      });
    }
  }

  // 3. Fetch job mapping counts per location
  const { data: mappingRows, error: mapErr } = await sb
    .from('toast_job_mapping')
    .select('location_id')
    .in('location_id', locationIds);

  if (mapErr) {
    return json({ error: 'Failed to query toast_job_mapping', details: mapErr.message }, { status: 500 });
  }

  const mappingCountMap = new Map<string, number>();
  for (const row of mappingRows ?? []) {
    mappingCountMap.set(row.location_id, (mappingCountMap.get(row.location_id) ?? 0) + 1);
  }

  // 4. Build response
  let fullyConfigured = 0;
  let missingCredentials = 0;
  let neverSynced = 0;

  const result: LocationVerification[] = locations.map((loc) => {
    const hasToastGuid = !!loc.toast_guid;
    const hasClientId = !!loc.toast_client_id;
    const hasClientSecret = !!loc.toast_client_secret;
    const isActive = !!loc.is_active;
    const sync = syncMap.get(loc.id);
    const jobMappingCount = mappingCountMap.get(loc.id) ?? 0;

    const hasCreds = hasToastGuid && hasClientId && hasClientSecret;
    if (hasCreds) {
      fullyConfigured++;
    } else {
      missingCredentials++;
    }

    if (!sync) {
      neverSynced++;
    }

    return {
      name: loc.name,
      id: loc.id,
      hasToastGuid,
      hasClientId,
      hasClientSecret,
      isActive,
      lastSyncDate: sync?.business_date ?? null,
      lastSyncAt: sync?.synced_at ?? null,
      jobMappingCount,
    };
  });

  return json({
    locations: result,
    summary: {
      total: locations.length,
      fullyConfigured,
      missingCredentials,
      neverSynced,
    },
  });
};
