import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import {
  withRetry,
  logCronResult,
  type CronLocationResult,
} from '$lib/server/cron-helpers';
import { fetchGoogleRatingSummary } from '$lib/server/integrations/google/google-business-client';

export const config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request }) => {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const apiKey = process.env.GOOGLE_BUSINESS_API_KEY;
  if (!apiKey) return json({ error: 'GOOGLE_BUSINESS_API_KEY not configured' }, { status: 500 });

  const { data: configs } = await sb
    .from('google_business_config')
    .select('location_id, place_id, location_name')
    .eq('is_active', true);

  if (!configs || configs.length === 0) {
    return json({ message: 'No active Google Business configs' });
  }

  const results: CronLocationResult[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (const config of configs) {
    try {
      const summary = await withRetry(
        () => fetchGoogleRatingSummary(config.place_id, apiKey),
        { label: `google-${config.location_name}` },
      );

      if (summary) {
        await sb.from('platform_ratings').upsert(
          {
            location_id: config.location_id,
            platform: 'google',
            snapshot_date: today,
            avg_rating: summary.averageRating,
            total_reviews: summary.totalReviewCount,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'location_id,platform,snapshot_date' },
        );
        results.push({ location: config.location_name || config.location_id, status: 'success' });
      } else {
        results.push({ location: config.location_name || config.location_id, status: 'skipped', error: 'No data returned' });
      }
    } catch (err) {
      results.push({ location: config.location_name || config.location_id, status: 'error', error: (err as Error).message });
    }
  }

  await logCronResult(sb, 'google_sync', results);
  return json({ results });
};
