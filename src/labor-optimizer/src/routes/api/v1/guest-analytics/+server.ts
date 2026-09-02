/**
 * Guest Analytics API — NPS-centric
 *
 * GET ?locationId=X&range=all|ytd|90d|60d|4mo|1yr|30d
 * GET ?locationId=X&month=YYYY-MM          (single calendar month)
 *   Returns: NPS summary, monthly trend, DOW breakdown, server leaderboard,
 *            keyword analysis, survey rows, intelligence bullets, availableMonths
 *
 * GET ?locationId=X&...&comments=1&page=N&segment=all|promoter|passive|detractor&q=keyword
 *   Returns: paginated guest survey comments
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/server/supabase';

const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','is','was','are',
  'were','be','been','have','has','had','do','does','did','will','would','could','should',
  'it','its','i','we','they','you','he','she','my','our','their','your','this','that',
  'these','those','his','her','him','us','me','very','so','just','also','not','no','more',
  'most','some','any','all','as','by','from','up','about','there','when','where','how',
  'get','got','go','went','one','two','first','last','new','old','every','much','many',
  'out','back','again','s','t','re','ve','ll','m','d','always','never','really','quite',
  'time','good','great','nice','place','night','day','year','next','only','come','came',
  'make','made','know','think','even','like','love','said','here','food','restaurant',
]);

function extractKeywords(texts: string[], max = 25): { word: string; count: number }[] {
  const freq = new Map<string, number>();
  for (const t of texts) {
    if (!t) continue;
    for (const raw of t.toLowerCase().replace(/[^a-z\s'-]/g, ' ').split(/\s+/)) {
      const w = raw.replace(/^['-]+|['-]+$/g, '');
      if (w.length < 4 || STOP.has(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([word, count]) => ({ word, count }));
}

function calcNPS(p: number, d: number, total: number): number | null {
  return total > 0 ? Math.round(((p - d) / total) * 100) : null;
}

function avg(vals: (number | null | undefined)[]): number | null {
  const v = vals.filter(x => x != null) as number[];
  return v.length ? Math.round(v.reduce((a, b) => a + b) / v.length * 10) / 10 : null;
}

function getRange(range: string): { start: string | null; end: string } {
  const today = new Date();
  const end = today.toISOString().split('T')[0];
  if (range === 'ytd') return { start: `${today.getFullYear()}-01-01`, end };
  if (range === '90d') {
    const d = new Date(today); d.setDate(d.getDate() - 90);
    return { start: d.toISOString().split('T')[0], end };
  }
  if (range === '60d') {
    const d = new Date(today); d.setDate(d.getDate() - 60);
    return { start: d.toISOString().split('T')[0], end };
  }
  if (range === '30d') {
    const d = new Date(today); d.setDate(d.getDate() - 30);
    return { start: d.toISOString().split('T')[0], end };
  }
  if (range === '4mo') {
    const d = new Date(today); d.setMonth(d.getMonth() - 4);
    return { start: d.toISOString().split('T')[0], end };
  }
  if (range === '1yr') {
    const d = new Date(today); d.setFullYear(d.getFullYear() - 1);
    return { start: d.toISOString().split('T')[0], end };
  }
  return { start: null, end };
}

function fmtMonthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[parseInt(m) - 1]} ${y}`;
}

function buildIntelligence(
  monthlyTrend: { month: string; nps: number | null; responses: number }[],
  categories: { food: number | null; service: number | null; ambiance: number | null; value: number | null },
  dowBreakdown: { dow: string; nps: number | null; responses: number }[],
  serverLeaderboard: { name: string; avgScore: number; responses: number }[],
): { type: string; text: string }[] {
  const bullets: { type: string; text: string }[] = [];

  // Alert: NPS drop > 10pts latest vs prior month
  const validMonths = monthlyTrend.filter(m => m.nps != null && m.responses > 0);
  if (validMonths.length >= 2) {
    const latest = validMonths[validMonths.length - 1];
    const prior = validMonths[validMonths.length - 2];
    const drop = (prior.nps as number) - (latest.nps as number);
    if (drop > 10) {
      bullets.push({
        type: 'alert',
        text: `NPS dropped ${drop} pts to ${latest.nps} in ${fmtMonthLabel(latest.month)} — investigate root cause.`,
      });
    }
  }

  // Insight: best vs worst category score (multiply 1-10 avg by 10 to get /100)
  const catEntries = [
    { label: 'Food', val: categories.food },
    { label: 'Service', val: categories.service },
    { label: 'Ambiance', val: categories.ambiance },
    { label: 'Value', val: categories.value },
  ].filter(c => c.val != null) as { label: string; val: number }[];

  if (catEntries.length >= 2) {
    const sorted = [...catEntries].sort((a, b) => b.val - a.val);
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];
    if (best.val !== worst.val) {
      const bestPct = (best.val * 10).toFixed(1);
      const worstPct = (worst.val * 10).toFixed(1);
      bullets.push({
        type: 'insight',
        text: `${best.label} leads at ${bestPct}/100 while ${worst.label} trails at ${worstPct}/100.`,
      });
    }
  }

  // Action: weakest DOW by NPS
  const validDow = dowBreakdown.filter(d => d.nps != null && d.responses >= 5);
  if (validDow.length > 0) {
    const weakest = validDow.reduce((a, b) => (a.nps as number) <= (b.nps as number) ? a : b);
    bullets.push({
      type: 'action',
      text: `${weakest.dow} is the weakest day (NPS ${weakest.nps}) — review staffing and execution.`,
    });
  }

  // Coaching: servers below 9.0 avg with >=5 surveys
  const coachServers = serverLeaderboard
    .filter(s => s.avgScore < 9.0 && s.responses >= 5)
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 3);
  if (coachServers.length > 0) {
    const names = coachServers.map(s => s.name).join(', ');
    bullets.push({
      type: 'coaching',
      text: `${coachServers.length} server(s) below 9.0 avg need coaching: ${names}.`,
    });
  }

  return bullets;
}

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const locationId = url.searchParams.get('locationId');
  if (!locationId) return json({ error: 'locationId required' }, { status: 400 });

  const range = url.searchParams.get('range') || 'all';
  const month = url.searchParams.get('month') || '';
  const isComments = url.searchParams.get('comments') === '1';

  // Determine date range for filtered queries
  let start: string | null;
  let end: string;
  if (month) {
    const [y, m] = month.split('-').map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0);
    start = firstDay.toISOString().split('T')[0];
    end = lastDay.toISOString().split('T')[0];
  } else {
    ({ start, end } = getRange(range));
  }

  /* ── COMMENTS MODE ── */
  if (isComments) {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
    const limit = 50;
    const offset = (page - 1) * limit;
    const segment = url.searchParams.get('segment') || 'all';
    const q = url.searchParams.get('q') || '';

    let query = sb
      .from('guest_surveys')
      .select(
        'business_date, recommend_score, food_score, service_score, ambiance_score, value_score, overall_score, comment, server_name, visit_type',
        { count: 'exact' },
      )
      .eq('location_id', locationId)
      .not('comment', 'is', null)
      .neq('comment', '')
      .order('business_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (start) query = query.gte('business_date', start);
    query = query.lte('business_date', end);
    if (segment === 'promoter') query = query.gte('recommend_score', 9);
    else if (segment === 'passive') query = query.gte('recommend_score', 7).lte('recommend_score', 8);
    else if (segment === 'detractor') query = query.lte('recommend_score', 6);
    if (q) query = query.ilike('comment', `%${q}%`);

    const { data, count } = await query;
    return json(
      { comments: data || [], totalCount: count || 0, page, totalPages: Math.ceil((count || 0) / limit) },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  /* ── MAIN ANALYTICS MODE ── */
  let npsQ = sb
    .from('daily_nps')
    .select('business_date, nps_score, total_responses, promoters, passives, detractors, avg_food, avg_service, avg_ambiance, avg_value, avg_overall')
    .eq('location_id', locationId)
    .gt('total_responses', 0)
    .order('business_date');

  let surveyQ = sb
    .from('guest_surveys')
    .select('business_date, recommend_score, server_name, comment')
    .eq('location_id', locationId);

  // Survey rows for the detail table (limited to 500 for performance)
  let surveyRowsQ = sb
    .from('guest_surveys')
    .select('business_date, guest_name, server_name, recommend_score, food_score, service_score, ambiance_score, comment')
    .eq('location_id', locationId)
    .order('business_date', { ascending: false })
    .limit(500);

  const inceptionQ = sb
    .from('guest_surveys')
    .select('business_date')
    .eq('location_id', locationId)
    .order('business_date', { ascending: true })
    .limit(1);

  // All-time daily_nps for availableMonths (we need the full history regardless of filter)
  const allTimeNpsQ = sb
    .from('daily_nps')
    .select('business_date')
    .eq('location_id', locationId)
    .gt('total_responses', 0)
    .order('business_date');

  if (start) {
    npsQ = npsQ.gte('business_date', start);
    surveyQ = surveyQ.gte('business_date', start);
    surveyRowsQ = surveyRowsQ.gte('business_date', start);
  }
  npsQ = npsQ.lte('business_date', end);
  surveyQ = surveyQ.lte('business_date', end);
  surveyRowsQ = surveyRowsQ.lte('business_date', end);

  const [
    { data: npsRows },
    { data: surveyRows },
    { data: inceptionRows },
    { data: surveyTableRows },
    { data: allTimeNps },
  ] = await Promise.all([npsQ, surveyQ, inceptionQ, surveyRowsQ, allTimeNpsQ]);

  const nps = npsRows || [];
  const surveys = surveyRows || [];

  /* ── Available Months (always full history for the picker) ── */
  const monthSet = new Set<string>();
  for (const r of allTimeNps || []) monthSet.add(r.business_date.slice(0, 7));
  const availableMonths = [...monthSet].sort();

  /* ── Summary ── */
  const totalR  = nps.reduce((s, r) => s + (r.total_responses || 0), 0);
  const totalP  = nps.reduce((s, r) => s + (r.promoters || 0), 0);
  const totalPa = nps.reduce((s, r) => s + (r.passives || 0), 0);
  const totalD  = nps.reduce((s, r) => s + (r.detractors || 0), 0);

  // 30-day vs prior 30-day velocity
  const now30 = new Date(); now30.setDate(now30.getDate() - 30);
  const now60 = new Date(); now60.setDate(now60.getDate() - 60);
  const c30 = now30.toISOString().split('T')[0];
  const c60 = now60.toISOString().split('T')[0];
  const recent = nps.filter(r => r.business_date >= c30);
  const prior  = nps.filter(r => r.business_date >= c60 && r.business_date < c30);
  const rR = recent.reduce((s, r) => s + (r.total_responses || 0), 0);
  const rP = recent.reduce((s, r) => s + (r.promoters || 0), 0);
  const rD = recent.reduce((s, r) => s + (r.detractors || 0), 0);
  const pR = prior.reduce((s, r) => s + (r.total_responses || 0), 0);
  const pP = prior.reduce((s, r) => s + (r.promoters || 0), 0);
  const pD = prior.reduce((s, r) => s + (r.detractors || 0), 0);

  /* ── Monthly trend ── */
  const mMap = new Map<string, { r: number; p: number; pa: number; d: number; fs: number; ss: number; as: number; vs: number; n: number }>();
  for (const row of nps) {
    const mo = row.business_date.slice(0, 7);
    const m = mMap.get(mo) || { r: 0, p: 0, pa: 0, d: 0, fs: 0, ss: 0, as: 0, vs: 0, n: 0 };
    m.r += row.total_responses || 0;
    m.p += row.promoters || 0;
    m.pa += row.passives || 0;
    m.d += row.detractors || 0;
    if (row.avg_food != null) { m.fs += row.avg_food; m.ss += row.avg_service || 0; m.as += row.avg_ambiance || 0; m.vs += row.avg_value || 0; m.n++; }
    mMap.set(mo, m);
  }
  const monthlyTrend = [...mMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, m]) => ({
      month,
      nps: calcNPS(m.p, m.d, m.r),
      responses: m.r,
      promoters: m.p, passives: m.pa, detractors: m.d,
      avgFood:     m.n > 0 ? Math.round(m.fs / m.n * 10) / 10 : null,
      avgService:  m.n > 0 ? Math.round(m.ss / m.n * 10) / 10 : null,
      avgAmbiance: m.n > 0 ? Math.round(m.as / m.n * 10) / 10 : null,
      avgValue:    m.n > 0 ? Math.round(m.vs / m.n * 10) / 10 : null,
    }));

  /* ── DOW breakdown ── */
  const dowAgg: { r: number; p: number; d: number }[] = Array.from({ length: 7 }, () => ({ r: 0, p: 0, d: 0 }));
  for (const row of nps) {
    const d = new Date(row.business_date + 'T12:00:00').getDay();
    dowAgg[d].r += row.total_responses || 0;
    dowAgg[d].p += row.promoters || 0;
    dowAgg[d].d += row.detractors || 0;
  }
  const dowBreakdown = DOW_LABELS.map((label, i) => ({
    dow: label,
    nps: calcNPS(dowAgg[i].p, dowAgg[i].d, dowAgg[i].r),
    responses: dowAgg[i].r,
  }));

  /* ── Server leaderboard ── */
  const srvMap = new Map<string, { r: number; p: number; d: number; sum: number }>();
  for (const s of surveys) {
    if (!s.server_name?.trim()) continue;
    const n = s.server_name.trim();
    const m = srvMap.get(n) || { r: 0, p: 0, d: 0, sum: 0 };
    m.r++; m.sum += s.recommend_score || 0;
    if ((s.recommend_score || 0) >= 9) m.p++;
    else if ((s.recommend_score || 0) <= 6) m.d++;
    srvMap.set(n, m);
  }
  const serverLeaderboard = [...srvMap.entries()]
    .filter(([, m]) => m.r >= 5)
    .map(([name, m]) => ({
      name,
      nps: calcNPS(m.p, m.d, m.r) ?? 0,
      responses: m.r,
      avgScore: Math.round(m.sum / m.r * 10) / 10,
    }))
    .sort((a, b) => b.nps - a.nps)
    .slice(0, 15);

  /* ── Categories ── */
  const categories = {
    food:     avg(nps.map(r => r.avg_food)),
    service:  avg(nps.map(r => r.avg_service)),
    ambiance: avg(nps.map(r => r.avg_ambiance)),
    value:    avg(nps.map(r => r.avg_value)),
    overall:  avg(nps.map(r => r.avg_overall)),
  };

  /* ── Intelligence bullets ── */
  const intelligence = buildIntelligence(monthlyTrend, categories, dowBreakdown, serverLeaderboard);

  /* ── Keywords ── */
  const promoterComments  = surveys.filter(s => (s.recommend_score || 0) >= 9 && s.comment).map(s => s.comment!);
  const detractorComments = surveys.filter(s => (s.recommend_score || 0) <= 6 && s.comment).map(s => s.comment!);

  return json({
    summary: {
      npsScore: calcNPS(totalP, totalD, totalR),
      totalResponses: totalR,
      promoters: totalP, passives: totalPa, detractors: totalD,
      categories,
      recentNps: calcNPS(rP, rD, rR),
      priorNps:  calcNPS(pP, pD, pR),
      inceptionDate: inceptionRows?.[0]?.business_date || null,
    },
    monthlyTrend,
    dowBreakdown,
    serverLeaderboard,
    surveys: surveyTableRows || [],
    availableMonths,
    intelligence,
    keywords: {
      positive: extractKeywords(promoterComments.slice(0, 2000)),
      negative: extractKeywords(detractorComments.slice(0, 2000)),
    },
  }, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } });
};
