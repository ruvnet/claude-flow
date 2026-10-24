/**
 * Resy Survey Sync Endpoint
 *
 * Receives raw Resy OS survey API responses from the browser scraper and
 * saves them to guest_surveys + recomputes daily_nps aggregates.
 *
 * POST /api/v1/admin/resy-survey-sync
 * Body: { locationId, rawResponse, monthKey? }
 *   rawResponse: the raw JSON from Resy OS survey API
 *   monthKey: "YYYY-MM" for logging
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const config = { maxDuration: 60 };

// Allow Resy OS browser scraper to POST cross-origin
export const OPTIONS: RequestHandler = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://os.resy.com',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
};

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { locationId, rawResponse, monthKey, resyAuthToken } = body;

  // ── Auth: Supabase session, cron secret, or Resy OS services token ──
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  const sb = getSupabaseService();
  let authed = false;

  // Option 1: cron secret
  if (cronSecret && bearerToken === cronSecret) {
    authed = true;
  }
  // Option 2: Supabase super_admin session
  else if (bearerToken) {
    try {
      const { data: { user } } = await sb.auth.getUser(bearerToken);
      if (user?.email) {
        const [{ data: gm }, { data: lu }] = await Promise.all([
          sb.from('user_group_members').select('role').eq('user_email', user.email).eq('role', 'super_admin').maybeSingle(),
          sb.from('location_users').select('role').eq('user_email', user.email).eq('role', 'super_admin').limit(1).maybeSingle(),
        ]);
        authed = !!(gm || lu);
      }
    } catch { /* ignore */ }
  }
  // Option 3: Resy OS services auth token — validate server-side (no CORS issues)
  if (!authed && resyAuthToken) {
    try {
      const testResp = await fetch(
        'https://survey.resy.com/api/1/venue/surveys?start_date=2026-03-01T00:00:00&end_date=2026-03-01T23:59:59&sort=-reservation__date_booked',
        {
          headers: {
            Accept: 'application/json',
            'X-Origin': 'OS',
            'X-Resy-Services-Auth': resyAuthToken,
          },
        }
      );
      // Any 2xx or 4xx (but not 0 or network error) means token is valid for Resy OS
      authed = testResp.status >= 200 && testResp.status < 503;
    } catch { /* ignore */ }
  }

  if (!authed) return json({ error: 'Unauthorized' }, { status: 401 });

  if (!locationId || !rawResponse) {
    return json({ error: 'Missing locationId or rawResponse' }, { status: 400 });
  }

  // Verify location exists
  const { data: loc } = await sb.from('locations').select('id, name').eq('id', locationId).single();
  if (!loc) return json({ error: 'Location not found' }, { status: 404 });

  // ── Parse Resy OS survey response ──
  // Resy OS returns: { data: { num_surveys, survey_stats, ordered_categories, surveys, next_request } }
  // or directly: { surveys: [...], ... }
  const payload = rawResponse?.data ?? rawResponse;
  const surveys: any[] = payload?.surveys ?? payload?.results ?? [];

  if (surveys.length === 0) {
    return json({ location: loc.name, monthKey, saved: 0, skipped: 0, message: 'No surveys in response' });
  }

  const now = new Date().toISOString();
  let saved = 0;
  let skipped = 0;
  const affectedDates = new Set<string>();

  for (const s of surveys) {
    try {
      // ── Map fields from Resy OS API format ──
      // Visit/reservation date
      const rawDate = s.reservation_date ?? s.visit_date ?? s.date ?? s.created_at;
      if (!rawDate) { skipped++; continue; }
      const surveyDate = rawDate.split('T')[0];
      affectedDates.add(surveyDate);

      // Submitted timestamp
      const submittedAt = s.submitted_at ?? s.created_at ?? null;

      // Guest info
      const guestObj = s.guest ?? s.diner ?? {};
      const guestName = s.guest_name ?? guestObj.name ?? (guestObj.first_name ? `${guestObj.first_name} ${guestObj.last_name ?? ''}`.trim() : null) ?? null;
      const guestEmail = s.guest_email ?? guestObj.email ?? null;
      const isVip = s.is_vip ?? guestObj.is_vip ?? guestObj.vip ?? false;
      const visitCount = s.visit_count ?? guestObj.visit_count ?? guestObj.num_visits ?? null;

      // Server
      const serverObj = s.server ?? s.employee ?? {};
      const serverName = s.server_name ?? (typeof serverObj === 'string' ? serverObj : serverObj.name ?? null) ?? null;

      // Table / covers
      const tableNumber = s.table_number ?? s.table ?? null;
      const partySize = s.party_size ?? s.covers ?? s.cover_count ?? null;
      const subtotal = s.subtotal ?? s.check_amount ?? null;

      // Scores — Resy uses 0-100 scale
      const overallScore = s.overall_score ?? s.overall ?? s.score ?? null;

      // Category scores — check categories/responses array
      const categories: any[] = s.categories ?? s.responses ?? s.category_scores ?? [];
      let recommendScore: number | null = null;
      let foodScore: number | null = null;
      let serviceScore: number | null = null;
      let ambianceScore: number | null = null;
      let valueScore: number | null = null;
      let recommendComment: string | null = null;
      let foodComment: string | null = null;
      let generalComment: string | null = null;

      for (const cat of categories) {
        const name = (cat.name ?? cat.category ?? cat.type ?? '').toLowerCase();
        const score = cat.score ?? cat.rating ?? null;
        const answer = cat.answer ?? cat.comment ?? cat.text ?? null;

        if (name.includes('sentiment') || name.includes('recommend') || name.includes('nps') || name.includes('likelihood')) {
          recommendScore = score;
          recommendComment = answer;
        } else if (name.includes('food') || name.includes('taste') || name.includes('cuisine')) {
          foodScore = score;
          foodComment = answer;
        } else if (name.includes('service')) {
          serviceScore = score;
        } else if (name.includes('ambiance') || name.includes('atmosphere') || name.includes('environment')) {
          ambianceScore = score;
        } else if (name.includes('value') || name.includes('price')) {
          valueScore = score;
        } else if (name.includes('general') || name.includes('other') || name.includes('additional')) {
          generalComment = answer;
        }
      }

      // Flat score fields (some Resy responses don't use categories array)
      recommendScore = recommendScore ?? s.sentiment_score ?? s.recommend_score ?? s.nps_score ?? null;
      foodScore = foodScore ?? s.food_score ?? null;
      serviceScore = serviceScore ?? s.service_score ?? null;
      ambianceScore = ambianceScore ?? s.ambiance_score ?? null;
      valueScore = valueScore ?? s.value_score ?? null;
      recommendComment = recommendComment ?? s.sentiment_comment ?? s.recommend_comment ?? null;
      foodComment = foodComment ?? s.food_comment ?? null;
      generalComment = generalComment ?? s.general_comment ?? s.comment ?? null;

      // External ID for deduplication
      const externalId = s.id ?? s.survey_id ?? s.token ?? null;

      const { error } = await sb.from('guest_surveys').upsert(
        {
          location_id: locationId,
          survey_date: surveyDate,
          submitted_at: submittedAt,
          guest_name: guestName,
          guest_email: guestEmail,
          server_name: serverName,
          table_number: String(tableNumber ?? '').slice(0, 20) || null,
          party_size: partySize,
          subtotal,
          overall_score: overallScore,
          recommend_score: recommendScore,
          food_score: foodScore,
          service_score: serviceScore,
          ambiance_score: ambianceScore,
          value_score: valueScore,
          recommend_comment: recommendComment,
          food_comment: foodComment,
          general_comment: generalComment,
          is_vip: isVip ?? false,
          visit_count: visitCount,
          source: 'resy_os_api',
          external_id: externalId ? String(externalId) : null,
          synced_at: now,
        },
        { onConflict: externalId ? 'location_id,external_id' : 'location_id,survey_date,guest_email,server_name' },
      );

      if (error) {
        console.warn(`[ResySurveySync] upsert error for ${loc.name} ${surveyDate}:`, error.message);
        skipped++;
      } else {
        saved++;
      }
    } catch (err: any) {
      console.warn(`[ResySurveySync] parse error:`, err.message);
      skipped++;
    }
  }

  // ── Recompute daily_nps for all affected dates ──
  for (const d of affectedDates) {
    await recomputeDailyNps(sb, locationId, d);
  }

  return new Response(
    JSON.stringify({
      location: loc.name,
      monthKey: monthKey ?? 'unknown',
      totalInResponse: surveys.length,
      saved,
      skipped,
      datesUpdated: affectedDates.size,
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': 'https://os.resy.com',
      },
    }
  );
};

async function recomputeDailyNps(sb: any, locationId: string, date: string) {
  try {
    const { data: rows } = await sb
      .from('guest_surveys')
      .select('recommend_score, food_score, service_score, ambiance_score, value_score, overall_score')
      .eq('location_id', locationId)
      .eq('survey_date', date);

    if (!rows || rows.length === 0) return;

    // NPS: recommend_score on 0-100 scale → map to 0-10 equivalent
    // Resy uses 0-100, NPS categories: 90-100 = promoter, 70-80 = passive, 0-60 = detractor
    let promoters = 0, passives = 0, detractors = 0, withScore = 0;
    let sumFood = 0, countFood = 0;
    let sumService = 0, countService = 0;
    let sumAmbiance = 0, countAmbiance = 0;
    let sumValue = 0, countValue = 0;
    let sumOverall = 0, countOverall = 0;

    for (const r of rows) {
      if (r.recommend_score !== null) {
        withScore++;
        const s = r.recommend_score;
        if (s >= 90) promoters++;
        else if (s >= 70) passives++;
        else detractors++;
      }
      if (r.food_score !== null) { sumFood += r.food_score; countFood++; }
      if (r.service_score !== null) { sumService += r.service_score; countService++; }
      if (r.ambiance_score !== null) { sumAmbiance += r.ambiance_score; countAmbiance++; }
      if (r.value_score !== null) { sumValue += r.value_score; countValue++; }
      if (r.overall_score !== null) { sumOverall += r.overall_score; countOverall++; }
    }

    const npsScore = withScore > 0
      ? Math.round(((promoters - detractors) / withScore) * 100)
      : null;

    await sb.from('daily_nps').upsert(
      {
        location_id: locationId,
        business_date: date,
        promoters,
        passives,
        detractors,
        total_responses: rows.length,
        nps_score: npsScore,
        avg_food: countFood > 0 ? Math.round((sumFood / countFood) * 10) / 10 : null,
        avg_service: countService > 0 ? Math.round((sumService / countService) * 10) / 10 : null,
        avg_ambiance: countAmbiance > 0 ? Math.round((sumAmbiance / countAmbiance) * 10) / 10 : null,
        avg_value: countValue > 0 ? Math.round((sumValue / countValue) * 10) / 10 : null,
        avg_overall: countOverall > 0 ? Math.round((sumOverall / countOverall) * 10) / 10 : null,
        computed_at: new Date().toISOString(),
      },
      { onConflict: 'location_id,business_date' },
    );
  } catch (err: any) {
    console.warn(`[ResySurveySync] NPS recompute error for ${date}:`, err.message);
  }
}
