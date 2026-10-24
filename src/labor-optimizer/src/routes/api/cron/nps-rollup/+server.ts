import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import {
  logCronResult,
  type CronLocationResult,
} from '$lib/server/cron-helpers';
import { computeDailyNps } from '$lib/server/domain/satisfaction/nps-calculator';
import { runAlertChecks } from '$lib/server/domain/satisfaction/alert-engine';

export const config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request }) => {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();

  const { data: locations } = await sb
    .from('locations')
    .select('id, name')
    .eq('is_active', true);

  if (!locations || locations.length === 0) {
    return json({ message: 'No active locations' });
  }

  const results: CronLocationResult[] = [];
  const today = new Date().toISOString().split('T')[0];
  const d30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  for (const loc of locations) {
    try {
      const upserted = await computeDailyNps(sb, loc.id, d30, today);
      const alertsCreated = await runAlertChecks(sb, loc.id, loc.name);
      results.push({ location: loc.name, status: 'success', daysUpserted: upserted, alertsCreated });
    } catch (err) {
      results.push({ location: loc.name, status: 'error', error: (err as Error).message });
    }
  }

  await logCronResult(sb, 'nps_rollup', results);
  return json({ results });
};
