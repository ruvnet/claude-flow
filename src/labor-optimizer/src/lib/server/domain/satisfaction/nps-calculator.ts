/**
 * NPS computation and daily rollup for the Guest Satisfaction Dashboard.
 *
 * NPS = ((promoters - detractors) / total) * 100
 *   - Promoters:  recommend_score 9-10
 *   - Passives:   recommend_score 7-8
 *   - Detractors: recommend_score 0-6
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NpsSummary {
  nps: number;
  total: number;
  promoters: number;
  passives: number;
  detractors: number;
}

// ---------------------------------------------------------------------------
// Period NPS (aggregate over N days)
// ---------------------------------------------------------------------------

export async function getNpsForPeriod(
  sb: SupabaseClient,
  locationId: string,
  days: number,
): Promise<NpsSummary> {
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];

  const { data } = await sb
    .from('daily_nps')
    .select('promoters, passives, detractors')
    .eq('location_id', locationId)
    .gte('business_date', dateFrom);

  const totals = (data || []).reduce(
    (acc, row) => ({
      promoters: acc.promoters + (row.promoters ?? 0),
      passives: acc.passives + (row.passives ?? 0),
      detractors: acc.detractors + (row.detractors ?? 0),
    }),
    { promoters: 0, passives: 0, detractors: 0 },
  );

  const total = totals.promoters + totals.passives + totals.detractors;
  const nps = total > 0 ? Math.round(((totals.promoters - totals.detractors) / total) * 100) : 0;

  return { nps, total, ...totals };
}

// ---------------------------------------------------------------------------
// Compute daily NPS rollup from guest_surveys
// ---------------------------------------------------------------------------

/**
 * For each day in the range, compute NPS from raw surveys and upsert
 * into daily_nps. Returns number of days upserted.
 */
export async function computeDailyNps(
  sb: SupabaseClient,
  locationId: string,
  dateFrom: string,
  dateTo: string,
): Promise<number> {
  // Fetch all surveys in the range
  const { data: surveys, error } = await sb
    .from('guest_surveys')
    .select('survey_date, recommend_score, food_score, service_score, ambiance_score, value_score, overall_score')
    .eq('location_id', locationId)
    .gte('survey_date', dateFrom)
    .lte('survey_date', dateTo)
    .not('recommend_score', 'is', null);

  if (error) throw new Error(`Failed to fetch surveys: ${error.message}`);
  if (!surveys || surveys.length === 0) return 0;

  // Group by date
  const byDate = new Map<string, typeof surveys>();
  for (const s of surveys) {
    const d = s.survey_date;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(s);
  }

  let upserted = 0;

  for (const [date, daySurveys] of byDate) {
    let promoters = 0;
    let passives = 0;
    let detractors = 0;

    const foodScores: number[] = [];
    const serviceScores: number[] = [];
    const ambianceScores: number[] = [];
    const valueScores: number[] = [];
    const overallScores: number[] = [];

    for (const s of daySurveys) {
      const score = s.recommend_score as number;
      if (score >= 9) promoters++;
      else if (score >= 7) passives++;
      else detractors++;

      if (s.food_score != null) foodScores.push(s.food_score);
      if (s.service_score != null) serviceScores.push(s.service_score);
      if (s.ambiance_score != null) ambianceScores.push(s.ambiance_score);
      if (s.value_score != null) valueScores.push(s.value_score);
      if (s.overall_score != null) overallScores.push(s.overall_score);
    }

    const total = promoters + passives + detractors;
    const nps = total > 0 ? Math.round(((promoters - detractors) / total) * 100) : null;

    const avg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

    const { error: upsertErr } = await sb.from('daily_nps').upsert(
      {
        location_id: locationId,
        business_date: date,
        promoters,
        passives,
        detractors,
        total_responses: total,
        nps_score: nps,
        avg_food: avg(foodScores),
        avg_service: avg(serviceScores),
        avg_ambiance: avg(ambianceScores),
        avg_value: avg(valueScores),
        avg_overall: avg(overallScores),
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'location_id,business_date' },
    );

    if (upsertErr) {
      console.error(`[nps] Upsert failed for ${date}:`, upsertErr.message);
    } else {
      upserted++;
    }
  }

  return upserted;
}
