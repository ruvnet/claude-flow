import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { getNpsForPeriod } from '$lib/server/domain/satisfaction/nps-calculator';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const days = parseInt(url.searchParams.get('days') || '30');

  // Get all active locations
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('id, name, type, timezone')
    .eq('is_active', true)
    .order('name');

  if (locErr) return json({ error: locErr.message }, { status: 500 });

  // Build per-location summaries
  const summaries = await Promise.all(
    (locations || []).map(async (loc) => {
      const nps30 = await getNpsForPeriod(sb, loc.id, 30);
      const nps90 = await getNpsForPeriod(sb, loc.id, 90);

      // Get latest platform ratings
      const { data: platformRatings } = await sb
        .from('platform_ratings')
        .select('platform, avg_rating, total_reviews')
        .eq('location_id', loc.id)
        .order('snapshot_date', { ascending: false })
        .limit(2);

      const google = platformRatings?.find((p) => p.platform === 'google');
      const yelp = platformRatings?.find((p) => p.platform === 'yelp');

      // NPS trend (compare 30d to prior 30d)
      const nps60 = await getNpsForPeriod(sb, loc.id, 60);
      const priorTotal = nps60.total - nps30.total;
      const priorPromoters = nps60.promoters - nps30.promoters;
      const priorDetractors = nps60.detractors - nps30.detractors;
      const priorNps = priorTotal > 0
        ? Math.round(((priorPromoters - priorDetractors) / priorTotal) * 100)
        : nps30.nps;
      const trend = nps30.nps > priorNps + 2 ? 'up' : nps30.nps < priorNps - 2 ? 'down' : 'flat';

      return {
        id: loc.id,
        name: loc.name,
        nps30d: nps30.total > 0 ? nps30.nps : null,
        nps90d: nps90.total > 0 ? nps90.nps : null,
        npsTrend: trend,
        totalSurveys30d: nps30.total,
        googleRating: google?.avg_rating ?? null,
        googleReviews: google?.total_reviews ?? null,
        yelpRating: yelp?.avg_rating ?? null,
        yelpReviews: yelp?.total_reviews ?? null,
      };
    }),
  );

  // Portfolio-wide NPS
  const allNps30 = summaries.filter((s) => s.nps30d !== null);
  const portfolioNps = allNps30.length > 0
    ? Math.round(allNps30.reduce((s, l) => s + l.nps30d!, 0) / allNps30.length)
    : null;

  // Recent alerts
  const { data: alerts } = await sb
    .from('satisfaction_alerts')
    .select('*')
    .eq('is_resolved', false)
    .order('created_at', { ascending: false })
    .limit(5);

  return json({
    portfolioNps,
    totalLocations: locations?.length ?? 0,
    summaries,
    recentAlerts: alerts || [],
  });
};
