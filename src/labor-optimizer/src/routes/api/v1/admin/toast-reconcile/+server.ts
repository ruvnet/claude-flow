/**
 * Toast Revenue Reconciliation Endpoint
 *
 * Compares HELIXO's stored daily_actuals revenue against live Toast API
 * figures for a given location and date range. Surfaces any discrepancy
 * so managers can identify and re-sync days that were under- or over-captured.
 *
 * GET /api/v1/admin/toast-reconcile
 *   ?locationId=<uuid>&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&adminKey=helixo-admin-2026
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';

export const config = { maxDuration: 120 };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
function isAuthorized(request: Request, url: URL): boolean {
  if (url.searchParams.get('adminKey') === 'helixo-admin-2026') return true;
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && request.headers.get('authorization') === `Bearer ${cronSecret}`) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface DayReconciliation {
  date: string;
  helixo: number | null;
  toast: number | null;
  diff: number | null;    // toast - helixo
  diffPct: number | null; // diff / toast
  status: 'match' | 'over' | 'under' | 'missing_helixo' | 'missing_toast' | 'no_data';
}

export interface ReconcileResponse {
  locationId: string;
  locationName: string;
  startDate: string;
  endDate: string;
  helixoTotal: number;
  toastTotal: number;
  totalDiff: number;
  days: DayReconciliation[];
  errors: string[];
  durationMs: number;
}

// ---------------------------------------------------------------------------
// GET handler
// ---------------------------------------------------------------------------
export const GET: RequestHandler = async ({ request, url }) => {
  if (!isAuthorized(request, url)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const locationId = url.searchParams.get('locationId');
  const startDate  = url.searchParams.get('startDate');
  const endDate    = url.searchParams.get('endDate');

  if (!locationId || !startDate || !endDate) {
    return json({ error: 'Missing required params: locationId, startDate, endDate' }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return json({ error: 'Dates must be YYYY-MM-DD' }, { status: 400 });
  }

  const t0 = Date.now();
  const sb = getSupabaseService();
  const errors: string[] = [];

  // ── Fetch location + Toast credentials ──────────────────────────────────
  const { data: loc, error: locErr } = await sb
    .from('locations')
    .select('id, name, toast_guid, toast_client_id, toast_client_secret, revenue_center_filter, closed_days_of_week')
    .eq('id', locationId)
    .single();

  if (locErr || !loc) {
    return json({ error: 'Location not found' }, { status: 404 });
  }
  if (!loc.toast_guid || !loc.toast_client_id || !loc.toast_client_secret) {
    return json({ error: 'Location missing Toast credentials' }, { status: 422 });
  }

  // ── Build date list ──────────────────────────────────────────────────────
  const allDates: string[] = [];
  for (
    let d = new Date(startDate + 'T12:00:00Z');
    d <= new Date(endDate + 'T12:00:00Z');
    d.setDate(d.getDate() + 1)
  ) {
    allDates.push(d.toISOString().split('T')[0]);
  }
  if (allDates.length > 14) {
    return json({ error: 'Date range too large — max 14 days per request' }, { status: 400 });
  }

  const closedDays: number[] = loc.closed_days_of_week || [];

  // ── Fetch stored HELIXO revenue ──────────────────────────────────────────
  const { data: storedRows } = await sb
    .from('daily_actuals')
    .select('business_date, revenue')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lte('business_date', endDate);

  const helixoByDate = new Map<string, number>();
  for (const row of storedRows ?? []) {
    helixoByDate.set(row.business_date, Number(row.revenue) || 0);
  }

  // ── Fetch live Toast revenue ─────────────────────────────────────────────
  const toastClient = createToastClientFromCredentials({
    clientId: loc.toast_client_id,
    clientSecret: loc.toast_client_secret,
    restaurantGuid: loc.toast_guid,
  });
  const rcFilter: string[] | undefined = loc.revenue_center_filter || undefined;

  const toastByDate = new Map<string, number>();

  // Fetch Toast data sequentially to avoid hammering the API
  for (const date of allDates) {
    // Skip closed days — Toast will return 0 anyway
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    if (closedDays.includes(dow)) {
      toastByDate.set(date, 0);
      continue;
    }

    try {
      const summary = await toastClient.getRevenueSummary(date, rcFilter);
      toastByDate.set(date, summary.totalRevenue);
    } catch (err: any) {
      errors.push(`Toast fetch failed for ${date}: ${err.message}`);
      // Don't set — will appear as missing_toast
    }
  }

  // ── Build per-day reconciliation ─────────────────────────────────────────
  const days: DayReconciliation[] = allDates.map(date => {
    const dow = new Date(date + 'T12:00:00Z').getUTCDay();
    if (closedDays.includes(dow)) {
      return { date, helixo: null, toast: null, diff: null, diffPct: null, status: 'no_data' };
    }

    const helixo = helixoByDate.has(date) ? helixoByDate.get(date)! : null;
    const toast  = toastByDate.has(date)  ? toastByDate.get(date)!  : null;

    if (toast === null) return { date, helixo, toast: null, diff: null, diffPct: null, status: 'missing_toast' };
    if (helixo === null) return { date, helixo: null, toast, diff: toast, diffPct: 1, status: 'missing_helixo' };
    if (toast === 0 && helixo === 0) return { date, helixo, toast, diff: 0, diffPct: 0, status: 'match' };

    const diff    = toast - helixo;
    const diffPct = toast > 0 ? diff / toast : 0;
    const absPct  = Math.abs(diffPct);

    const status = absPct < 0.005 ? 'match' : diff > 0 ? 'under' : 'over';
    return { date, helixo, toast, diff, diffPct, status };
  });

  // ── Totals ───────────────────────────────────────────────────────────────
  let helixoTotal = 0;
  let toastTotal  = 0;
  for (const d of days) {
    if (d.helixo != null) helixoTotal += d.helixo;
    if (d.toast  != null) toastTotal  += d.toast;
  }

  const response: ReconcileResponse = {
    locationId: loc.id,
    locationName: loc.name,
    startDate,
    endDate,
    helixoTotal,
    toastTotal,
    totalDiff: toastTotal - helixoTotal,
    days,
    errors,
    durationMs: Date.now() - t0,
  };

  return json(response);
};
