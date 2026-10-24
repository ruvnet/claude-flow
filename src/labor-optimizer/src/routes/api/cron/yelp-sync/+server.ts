import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import {
  withRetry,
  logCronResult,
  type CronLocationResult,
} from '$lib/server/cron-helpers';
import { fetchYelpReviews, fetchYelpBusiness } from '$lib/server/integrations/yelp/yelp-client';
import { analyzeSentiment } from '$lib/utils/sentiment';

export const config = { maxDuration: 120 };

export const GET: RequestHandler = async ({ request }) => {
  // Verify cron secret (Vercel sends this header)
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) return json({ error: 'YELP_API_KEY not configured' }, { status: 500 });

  const { data: configs } = await sb
    .from('yelp_config')
    .select('location_id, business_id')
    .eq('is_active', true);

  if (!configs || configs.length === 0) {
    return json({ message: 'No active Yelp configs' });
  }

  const results: CronLocationResult[] = [];
  const today = new Date().toISOString().split('T')[0];

  for (const config of configs) {
    try {
      // Fetch reviews
      const reviews = await withRetry(
        () => fetchYelpReviews(config.business_id, apiKey),
        { label: `yelp-reviews-${config.business_id}` },
      );

      for (const r of reviews) {
        await sb.from('external_reviews').upsert(
          {
            location_id: config.location_id,
            platform: 'yelp',
            review_date: r.time_created.split(' ')[0],
            author_name: r.user.name,
            rating: r.rating,
            review_text: r.text,
            sentiment: analyzeSentiment(r.text),
            external_id: r.id,
            review_url: r.url,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'location_id,platform,external_id' },
        );
      }

      // Fetch business aggregate
      const biz = await withRetry(
        () => fetchYelpBusiness(config.business_id, apiKey),
        { label: `yelp-biz-${config.business_id}` },
      );

      if (biz) {
        await sb.from('platform_ratings').upsert(
          {
            location_id: config.location_id,
            platform: 'yelp',
            snapshot_date: today,
            avg_rating: biz.rating,
            total_reviews: biz.review_count,
            synced_at: new Date().toISOString(),
          },
          { onConflict: 'location_id,platform,snapshot_date' },
        );
      }

      results.push({ location: config.business_id, status: 'success', reviewsSynced: reviews.length });
    } catch (err) {
      results.push({ location: config.business_id, status: 'error', error: (err as Error).message });
    }
  }

  await logCronResult(sb, 'yelp_sync', results);
  return json({ results });
};
