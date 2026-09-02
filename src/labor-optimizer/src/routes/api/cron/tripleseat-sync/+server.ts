import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { getSupabaseService } from '$lib/server/supabase';
import { syncAllTripleseatLocations } from '$lib/server/integrations/tripleseat/tripleseat-sync';
import { withRetry, logCronResult, isVercelCronRetry } from '$lib/server/cron-helpers';
import { invalidateCache } from '$lib/server/cache';

export const config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request, url }) => {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const isRetry = isVercelCronRetry(request);
  const sb = getSupabaseService();
  const startTime = Date.now();

  // Support manual date override
  const fromParam = url.searchParams.get('from');
  const toParam = url.searchParams.get('to');

  try {
    const results = await withRetry(
      () => syncAllTripleseatLocations(sb, {
        startDate: fromParam || undefined,
        endDate: toParam || undefined,
      }),
      { label: 'tripleseat-sync', maxAttempts: 2, delayMs: 5000 }
    );

    // Invalidate cached PACE data
    invalidateCache('events-pace:');

    const totalEvents = results.reduce((s, r) => s + r.eventsUpserted, 0);
    const totalLeads = results.reduce((s, r) => s + r.leadsUpserted, 0);
    const errors = results.flatMap(r => r.errors);

    console.log(`[tripleseat-sync] Synced ${totalEvents} events, ${totalLeads} leads across ${results.length} locations in ${Date.now() - startTime}ms`);

    if (errors.length > 0) {
      console.warn(`[tripleseat-sync] ${errors.length} errors:`, errors);
    }

    return json({
      ok: true,
      isRetry,
      locations: results.length,
      eventsUpserted: totalEvents,
      leadsUpserted: totalLeads,
      errors,
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    Sentry.captureException(err, { tags: { cron: 'tripleseat-sync' } });
    console.error('[tripleseat-sync] Fatal error:', err);
    return json({ ok: false, error: err.message }, { status: 500 });
  }
};
