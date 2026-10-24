/**
 * Admin Backfill Endpoint
 *
 * Syncs historical Toast data (revenue, labor, sales mix, hourly sales)
 * for a specific location and date range. Processes at most 10 days per
 * request to stay within Vercel's 60-second serverless timeout. Returns
 * a `nextStartDate` when there are remaining dates so the caller can
 * paginate.
 *
 * POST /api/v1/admin/backfill
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';

export const config = { maxDuration: 120 };

const MAX_DAYS_PER_REQUEST = 3;

interface BackfillRequest {
  locationId: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  includeLabor?: boolean;
  includeRevenue?: boolean;
  includeSalesMix?: boolean;
  lite?: boolean; // When true: skip PMIX + sales mix, reduces Toast API calls from 4-5 to 2 per day
}

interface DateResult {
  date: string;
  status: 'success' | 'error';
  revenue?: number;
  covers?: number;
  orderCount?: number;
  laborEntries?: number;
  salesMixCategories?: number;
  pmixItems?: number;
  hourlyBuckets?: number;
  error?: string;
}

export const POST: RequestHandler = async ({ request }) => {
  // ── Auth: cron secret, body admin key, or Supabase super_admin session ──
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  const body: BackfillRequest = await request.json();

  const isAuthedViaCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isAuthedViaBody = cronSecret && body && (body as any).adminKey === cronSecret;

  let isAuthedViaSession = false;
  if (!isAuthedViaCron && !isAuthedViaBody) {
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token && token !== cronSecret) {
      try {
        const sb2 = getSupabaseService();
        const { data: { user } } = await sb2.auth.getUser(token);
        if (user?.email) {
          // Check both user_group_members and location_users for super_admin
          const [{ data: gm }, { data: lu }] = await Promise.all([
            sb2.from('user_group_members').select('role').eq('user_email', user.email).eq('role', 'super_admin').maybeSingle(),
            sb2.from('location_users').select('role').eq('user_email', user.email).eq('role', 'super_admin').limit(1).maybeSingle(),
          ]);
          isAuthedViaSession = !!(gm || lu);
        }
      } catch { /* ignore */ }
    }
  }

  if (!isAuthedViaCron && !isAuthedViaBody && !isAuthedViaSession) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Validate inputs ──
  const {
    locationId,
    startDate,
    endDate,
    includeLabor = true,
    includeRevenue = true,
    lite = false,
  } = body;
  // In lite mode, force sales mix off to reduce Toast API calls
  const includeSalesMix = lite ? false : (body.includeSalesMix ?? false);

  if (!locationId || !startDate || !endDate) {
    return json(
      { error: 'Missing required fields: locationId, startDate, endDate' },
      { status: 400 },
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return json(
      { error: 'Dates must be in YYYY-MM-DD format' },
      { status: 400 },
    );
  }

  if (startDate > endDate) {
    return json(
      { error: 'startDate must be <= endDate' },
      { status: 400 },
    );
  }

  const sb = getSupabaseService();

  // ── Look up location + Toast credentials ──
  const { data: loc, error: locErr } = await sb
    .from('locations')
    .select('id, name, toast_guid, toast_client_id, toast_client_secret, revenue_center_filter, closed_days_of_week')
    .eq('id', locationId)
    .single();

  if (locErr || !loc) {
    return json({ error: 'Location not found' }, { status: 404 });
  }

  if (!loc.toast_guid || !loc.toast_client_id || !loc.toast_client_secret) {
    return json(
      { error: 'Location is missing Toast credentials (toast_guid, toast_client_id, or toast_client_secret)' },
      { status: 422 },
    );
  }

  // ── Build date list, capped at MAX_DAYS_PER_REQUEST ──
  const allDates: string[] = [];
  const start = new Date(startDate + 'T12:00:00Z');
  const end = new Date(endDate + 'T12:00:00Z');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    allDates.push(d.toISOString().split('T')[0]);
  }

  const datesToProcess = allDates.slice(0, MAX_DAYS_PER_REQUEST);
  const hasMore = allDates.length > MAX_DAYS_PER_REQUEST;
  const nextStartDate = hasMore ? allDates[MAX_DAYS_PER_REQUEST] : null;

  // ── Create Toast client ──
  const toastClient = createToastClientFromCredentials({
    clientId: loc.toast_client_id,
    clientSecret: loc.toast_client_secret,
    restaurantGuid: loc.toast_guid,
  });

  // Revenue center filter: used when multiple locations share one Toast GUID
  const rcFilter: string[] | undefined = loc.revenue_center_filter || undefined;

  // Closed days filter: skip sync on days the location is closed (0=Sun…6=Sat)
  const closedDays: number[] = loc.closed_days_of_week || [];

  // ── Get job mapping for labor (once) ──
  let mapLookup: Record<string, string> = {};
  if (includeLabor) {
    const { data: mappings } = await sb
      .from('toast_job_mapping')
      .select('toast_job_name, dashboard_position')
      .eq('location_id', loc.id);
    for (const m of mappings || []) {
      mapLookup[m.toast_job_name] = m.dashboard_position;
    }
  }

  // ── Process each date ──
  const results: DateResult[] = [];

  for (const syncDate of datesToProcess) {
    // Skip closed days — don't sync or store $0 for days the location is closed
    const syncDow = new Date(syncDate + 'T12:00:00Z').getUTCDay();
    if (closedDays.includes(syncDow)) {
      results.push({ date: syncDate, status: 'success', revenue: 0, orderCount: 0 });
      continue;
    }

    try {
      const now = new Date().toISOString();
      let dateResult: DateResult = { date: syncDate, status: 'success' };

      // ─── Revenue (getDaySummary) ───
      let daySummary: Awaited<ReturnType<typeof toastClient.getDaySummary>> | null = null;
      if (includeRevenue || includeSalesMix) {
        try {
          daySummary = await toastClient.getDaySummary(syncDate, rcFilter);
        } catch (summaryErr: any) {
          console.warn(`[Backfill] getDaySummary failed for ${loc.name} ${syncDate}:`, summaryErr.message);
        }
      }

      // ─── Revenue upsert ───
      if (includeRevenue && daySummary) {
        try {
          await sb.from('daily_actuals').upsert(
            {
              location_id: loc.id,
              business_date: syncDate,
              revenue: daySummary.totalRevenue,
              covers: daySummary.totalCovers,
              order_count: daySummary.orderCount,
              total_discounts: daySummary.totalDiscounts,
              total_comps: daySummary.totalComps,
              synced_at: now,
            },
            { onConflict: 'location_id,business_date' },
          );
          dateResult.revenue = daySummary.totalRevenue;
          dateResult.covers = daySummary.totalCovers;
          dateResult.orderCount = daySummary.orderCount;
        } catch (revErr: any) {
          console.warn(`[Backfill] Revenue upsert failed for ${loc.name} ${syncDate}:`, revErr.message);
        }
      }

      // ─── Hourly sales — already computed inside getDaySummary, no extra API calls ───
      if (includeRevenue && daySummary) {
        try {
          const hourlySales = daySummary.hourlySales;
          if (hourlySales.length > 0) {
            const hourlyRows = hourlySales.map((h) => ({
              location_id: loc.id,
              business_date: syncDate,
              hour_of_day: h.hour,
              revenue: h.revenue,
              covers: h.covers,
              order_count: h.orderCount,
            }));
            await sb.from('daily_hourly_sales').upsert(hourlyRows, {
              onConflict: 'location_id,business_date,hour_of_day',
            });
            dateResult.hourlyBuckets = hourlySales.length;
          }
        } catch (hourlyErr: any) {
          console.warn(`[Backfill] Hourly sales failed for ${loc.name} ${syncDate}:`, hourlyErr.message);
        }
      }

      // ─── Sales mix categories ───
      if (includeSalesMix && daySummary) {
        try {
          if (daySummary.salesMix.length > 0) {
            const mixRows = daySummary.salesMix.map((m) => ({
              location_id: loc.id,
              business_date: syncDate,
              category: m.category,
              revenue: m.revenue,
              item_count: m.itemCount,
              pct_of_total: m.pctOfTotal,
              synced_at: now,
            }));
            await sb.from('daily_sales_mix').upsert(mixRows, {
              onConflict: 'location_id,business_date,category',
            });
            dateResult.salesMixCategories = daySummary.salesMix.length;
          }
        } catch (mixErr: any) {
          console.warn(`[Backfill] Sales mix failed for ${loc.name} ${syncDate}:`, mixErr.message);
        }
      }

      // ─── PMIX (skip entirely in lite mode) ───
      if (includeSalesMix && !lite && daySummary) {
        try {
          if (daySummary.pmix.length > 0) {
            const pmixRows = daySummary.pmix.slice(0, 100).map((p) => ({
              location_id: loc.id,
              business_date: syncDate,
              item_name: p.itemName,
              item_guid: p.itemGuid,
              category: p.category,
              quantity: p.quantity,
              revenue: p.revenue,
              avg_price: p.avgPrice,
              synced_at: now,
            }));
            await sb.from('daily_pmix').upsert(pmixRows, {
              onConflict: 'location_id,business_date,item_name',
            });
            dateResult.pmixItems = daySummary.pmix.length;
          }
        } catch (pmixErr: any) {
          console.warn(`[Backfill] PMIX failed for ${loc.name} ${syncDate}:`, pmixErr.message);
        }
      }

      // ─── Labor ───
      if (includeLabor) {
        try {
          const laborByJob = await toastClient.getLaborByJob(syncDate);
          let laborCount = 0;

          // Pastry allocation: Le Supreme shares pastry team (70% Le Supreme, 25% Anthology, 5% HIROKI-SAN)
          const LE_SUPREME_ID = 'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce';
          const PASTRY_ALLOC = [
            { locationId: '84f4ea7f-722d-4296-894b-6ecfe389b2d5', pct: 0.25 }, // Anthology
            { locationId: 'b4035001-0928-4ada-a0f0-f2a272393147', pct: 0.05 }, // HIROKI-SAN
          ];

          for (const job of laborByJob) {
            const mappedPosition = mapLookup[job.jobTitle] || 'EXCLUDE';
            if (mappedPosition === 'EXCLUDE') continue;

            let laborDollars = Math.round(job.laborDollars * 100) / 100;
            let regularHours = Math.round(job.regularHours * 100) / 100;
            let overtimeHours = Math.round(job.overtimeHours * 100) / 100;

            // Apply pastry allocation for Le Supreme
            if (loc.id === LE_SUPREME_ID && mappedPosition === 'Pastry') {
              const full = { dollars: laborDollars, reg: regularHours, ot: overtimeHours };
              laborDollars = Math.round(full.dollars * 0.70 * 100) / 100;
              regularHours = Math.round(full.reg * 0.70 * 100) / 100;
              overtimeHours = Math.round(full.ot * 0.70 * 100) / 100;
              for (const t of PASTRY_ALLOC) {
                await sb.from('daily_labor').upsert({
                  location_id: t.locationId, business_date: syncDate,
                  toast_job_name: `Pastry (from Le Supreme ${Math.round(t.pct * 100)}%)`,
                  mapped_position: 'Pastry',
                  labor_dollars: Math.round(full.dollars * t.pct * 100) / 100,
                  regular_hours: Math.round(full.reg * t.pct * 100) / 100,
                  overtime_hours: Math.round(full.ot * t.pct * 100) / 100,
                  synced_at: now,
                }, { onConflict: 'location_id,business_date,toast_job_name' });
              }
            }

            await sb.from('daily_labor').upsert(
              {
                location_id: loc.id,
                business_date: syncDate,
                toast_job_name: job.jobTitle,
                mapped_position: mappedPosition,
                labor_dollars, regular_hours, overtime_hours,
                synced_at: now,
              },
              { onConflict: 'location_id,business_date,toast_job_name' },
            );
            laborCount++;
          }

          dateResult.laborEntries = laborCount;
        } catch (laborErr: any) {
          console.warn(`[Backfill] Labor failed for ${loc.name} ${syncDate}:`, laborErr.message);
        }
      }

      results.push(dateResult);
    } catch (err: any) {
      results.push({ date: syncDate, status: 'error', error: err.message });
    }
  }

  // ── Summary ──
  const successCount = results.filter((r) => r.status === 'success').length;
  const errorCount = results.filter((r) => r.status === 'error').length;

  return json({
    location: loc.name,
    locationId: loc.id,
    requested: { startDate, endDate, totalDays: allDates.length },
    processed: {
      dates: datesToProcess.length,
      success: successCount,
      errors: errorCount,
    },
    nextStartDate,
    hasMore,
    results,
  });
};
