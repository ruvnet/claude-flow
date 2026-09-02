import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { getSupabaseService } from '$lib/server/supabase';

export const config = { maxDuration: 120 };
import {
  logCronResult,
  logCronFailure,
  type CronLocationResult,
} from '$lib/server/cron-helpers';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompetitorRow {
  id: string;
  location_id: string;
  competitor_name: string;
  competitor_resy_id: string | null;
  competitor_city: string | null;
  competitor_slug: string | null;
  platform: 'resy' | 'opentable';
  is_active: boolean;
}

interface ResySlot {
  date: { start: string; end: string };
  config: { type: string; token: string };
}

interface ResyVenueResult {
  results?: {
    venues?: Array<{
      venue?: { id: { resy: number }; name: string };
      slots?: ResySlot[];
    }>;
  };
}

interface OpenTableSlot {
  dateTime: string;
  isAvailable: boolean;
}

interface OpenTableAvailability {
  availability?: {
    [date: string]: OpenTableSlot[];
  };
  times?: Array<{
    dateTime: string;
    isAvailable: boolean;
  }>;
}

interface ScanResult {
  competitorId: string;
  competitorName: string;
  date: string;
  availableSlots: number;
  totalSlots: number;
  pctBooked: number;
  firstAvailable: string | null;
  lastAvailable: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESY_SEARCH_BASE = 'https://api.resy.com/4/find';
const OPENTABLE_AVAILABILITY_BASE = 'https://www.opentable.com/widget/reservation/restaurant-info';
const DEFAULT_CAPACITY = 40;
const OPENTABLE_DEFAULT_CAPACITY = 30;
const SCAN_DAYS = 7;
const DEMAND_LOOKAHEAD_DAYS = 3;

// ---------------------------------------------------------------------------
// Resy fetch helper
// ---------------------------------------------------------------------------

async function fetchResySlots(
  resyVenueId: string,
  date: string,
  partySize = 2,
): Promise<{ slots: ResySlot[]; totalSlots: number }> {
  const url = new URL(RESY_SEARCH_BASE);
  url.searchParams.set('day', date);
  url.searchParams.set('party_size', String(partySize));
  url.searchParams.set('venue_id', resyVenueId);

  // Resy API requires auth. Use env key or fall back to Resy's public embed key.
  const resyApiKey = process.env.RESY_API_KEY || 'VbMYTJcQTwKlLJHxK_ELDA';

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json, text/plain, */*',
      Authorization: `ResyAPI api_key="${resyApiKey}"`,
      'X-Origin': 'https://resy.com',
      'User-Agent': 'Mozilla/5.0 (compatible; HELIXO/1.0)',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`Resy returned ${res.status} for venue ${resyVenueId}`);
  }

  const data: ResyVenueResult = await res.json();
  const venues = data?.results?.venues ?? [];

  // First try exact match on venue ID, then fall back to first venue returned
  const match = venues.find((v) => String(v.venue?.id?.resy) === resyVenueId) ?? venues[0];
  const slots = match?.slots ?? [];
  return { slots, totalSlots: slots.length };
}

function extractTimes(slots: ResySlot[]): { first: string | null; last: string | null } {
  if (slots.length === 0) return { first: null, last: null };
  const sorted = [...slots].sort((a, b) => a.date.start.localeCompare(b.date.start));
  return { first: sorted[0].date.start, last: sorted[sorted.length - 1].date.start };
}

// ---------------------------------------------------------------------------
// OpenTable fetch helper
// ---------------------------------------------------------------------------

async function fetchOpenTableSlots(
  slug: string,
  date: string,
  covers = 2,
): Promise<{ availableCount: number; totalSlots: number; first: string | null; last: string | null }> {
  // Use the widget API with a dinner-time query
  const url = new URL(OPENTABLE_AVAILABILITY_BASE);
  url.searchParams.set('rid', slug);
  url.searchParams.set('type', 'multi');
  url.searchParams.set('covers', String(covers));
  url.searchParams.set('dateTime', `${date} 19:00`);

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'HELIXO-CompScan/1.0',
    },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`OpenTable returned ${res.status} for slug ${slug}`);
  }

  const data: OpenTableAvailability = await res.json();

  // The widget API returns a times array with availability per slot
  const slots = data.times ?? [];
  const totalSlots = slots.length || OPENTABLE_DEFAULT_CAPACITY;
  const available = slots.filter((s) => s.isAvailable);
  const availableCount = available.length;

  let first: string | null = null;
  let last: string | null = null;
  if (available.length > 0) {
    const sorted = [...available].sort((a, b) => a.dateTime.localeCompare(b.dateTime));
    first = sorted[0].dateTime;
    last = sorted[sorted.length - 1].dateTime;
  }

  return { availableCount, totalSlots, first, last };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function getNextNDays(n: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() + i);
    days.push(d.toISOString().split('T')[0]);
  }
  return days;
}

// ---------------------------------------------------------------------------
// Demand signal classification
// ---------------------------------------------------------------------------

type DemandLevel = 'high' | 'moderate' | 'low';

function classifyDemand(avgPctBooked: number): DemandLevel {
  if (avgPctBooked >= 0.8) return 'high';
  if (avgPctBooked >= 0.5) return 'moderate';
  return 'low';
}

// ---------------------------------------------------------------------------
// Main cron handler
// ---------------------------------------------------------------------------

/**
 * Competitive Scan Cron
 *
 * Runs daily at 3 PM UTC (10 AM EST).
 * Scans Resy and OpenTable availability for all active competitors across all locations,
 * stores results in `competitive_availability`, and writes demand signals
 * to `daily_demand_signals` for the forecast engine.
 */
export const GET: RequestHandler = async ({ request }) => {
  // Auth via CRON_SECRET bearer token
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const results: CronLocationResult[] = [];
  const scanDates = getNextNDays(SCAN_DAYS);
  const now = new Date().toISOString();

  // ----------------------------------------------------------
  // 1. Fetch all active competitors grouped by location
  // ----------------------------------------------------------

  const { data: competitors, error: compErr } = await sb
    .from('competitive_set')
    .select('id, location_id, competitor_name, competitor_resy_id, competitor_city, competitor_slug, platform, is_active')
    .eq('is_active', true);

  if (compErr || !competitors || competitors.length === 0) {
    await logCronResult(sb, 'competitive_scan', [
      { location: 'global', status: 'skipped', error: compErr?.message || 'No active competitors' },
    ]);
    return json({ message: 'No active competitors found', error: compErr?.message });
  }

  // Group by location for demand signal computation
  const byLocation = new Map<string, CompetitorRow[]>();
  for (const c of competitors as CompetitorRow[]) {
    const platform = c.platform || 'resy';
    // Skip competitors missing required identifier for their platform
    if (platform === 'resy' && !c.competitor_resy_id) continue;
    if (platform === 'opentable' && !c.competitor_slug) continue;
    const list = byLocation.get(c.location_id) || [];
    list.push({ ...c, platform });
    byLocation.set(c.location_id, list);
  }

  // ----------------------------------------------------------
  // 2. Scan each competitor for each day (try/catch per competitor)
  // ----------------------------------------------------------

  const allScanResults: ScanResult[] = [];
  let scanned = 0;
  let errors = 0;

  for (const [locationId, locationCompetitors] of byLocation) {
    for (const comp of locationCompetitors) {
      for (const date of scanDates) {
        try {
          let availableSlots: number;
          let capacity: number;
          let firstAvailable: string | null;
          let lastAvailable: string | null;

          if (comp.platform === 'opentable') {
            // ---- OpenTable scan ----
            const ot = await fetchOpenTableSlots(comp.competitor_slug!, date);
            availableSlots = ot.availableCount;
            capacity = Math.max(OPENTABLE_DEFAULT_CAPACITY, ot.totalSlots);
            firstAvailable = ot.first;
            lastAvailable = ot.last;
          } else {
            // ---- Resy scan (default) ----
            const { slots, totalSlots } = await fetchResySlots(comp.competitor_resy_id!, date);
            const times = extractTimes(slots);
            availableSlots = totalSlots;
            capacity = Math.max(DEFAULT_CAPACITY, totalSlots);
            firstAvailable = times.first;
            lastAvailable = times.last;
          }

          const booked = Math.max(0, capacity - availableSlots);
          const pctBooked = capacity > 0 ? Math.round((booked / capacity) * 10000) / 10000 : 0;

          const scanResult: ScanResult = {
            competitorId: comp.id,
            competitorName: comp.competitor_name,
            date,
            availableSlots,
            totalSlots: capacity,
            pctBooked,
            firstAvailable,
            lastAvailable,
          };
          allScanResults.push(scanResult);

          // Upsert to competitive_availability
          await sb.from('competitive_availability').upsert(
            {
              competitor_id: comp.id,
              check_date: date,
              available_slots: availableSlots,
              total_slots: capacity,
              pct_booked: pctBooked,
              first_available_time: firstAvailable,
              last_available_time: lastAvailable,
              scanned_at: now,
            },
            { onConflict: 'competitor_id,check_date' },
          );

          scanned++;
        } catch (err: any) {
          errors++;
          console.warn(
            `[CompScan] Failed for ${comp.competitor_name} (${comp.platform}) on ${date}:`,
            err.message,
          );
          // Non-critical: continue to next competitor/date
        }
      }
    }

    // ----------------------------------------------------------
    // 3. Compute demand signal for this location (next 3 days)
    // ----------------------------------------------------------

    try {
      const lookaheadDates = scanDates.slice(0, DEMAND_LOOKAHEAD_DAYS);

      // Get recent scan results for this location's competitors
      const locationCompIds = locationCompetitors.map((c) => c.id);
      const locationScans = allScanResults.filter(
        (s) => locationCompIds.includes(s.competitorId) && lookaheadDates.includes(s.date),
      );

      if (locationScans.length > 0) {
        const avgPctBooked =
          locationScans.reduce((sum, s) => sum + s.pctBooked, 0) / locationScans.length;
        const demandLevel = classifyDemand(avgPctBooked);

        // Store demand signal per date for the forecast engine
        for (const date of lookaheadDates) {
          const dateScans = locationScans.filter((s) => s.date === date);
          if (dateScans.length === 0) continue;

          const datePctBooked =
            dateScans.reduce((sum, s) => sum + s.pctBooked, 0) / dateScans.length;
          const dateDemand = classifyDemand(datePctBooked);

          await sb.from('daily_demand_signals').upsert(
            {
              location_id: locationId,
              signal_date: date,
              signal_source: 'competitive_scan',
              demand_level: dateDemand,
              avg_competitor_pct_booked: Math.round(datePctBooked * 10000) / 10000,
              competitors_scanned: dateScans.length,
              details: {
                competitors: dateScans.map((s) => ({
                  name: s.competitorName,
                  pctBooked: s.pctBooked,
                  availableSlots: s.availableSlots,
                })),
              },
              scanned_at: now,
            },
            { onConflict: 'location_id,signal_date,signal_source' },
          );
        }

        results.push({
          location: locationId,
          status: 'success',
          competitors: locationCompetitors.length,
          avgPctBooked: Math.round(avgPctBooked * 100),
          demandLevel,
        });
      } else {
        results.push({
          location: locationId,
          status: 'skipped',
          error: 'No scan results for lookahead period',
        });
      }
    } catch (err: any) {
      Sentry.captureException(err);
      results.push({
        location: locationId,
        status: 'error',
        error: `Demand signal failed: ${err.message}`,
      });
      await logCronFailure(sb, 'competitive_scan', locationId, err.message);
    }

    // Rate-limit: small pause between locations to be polite to Resy/OpenTable
    await sleep(500);
  }

  // ----------------------------------------------------------
  // 4. Log cron outcome to system_health
  // ----------------------------------------------------------

  await logCronResult(sb, 'competitive_scan', results);

  return json({
    scannedDates: scanDates,
    totalCompetitors: competitors.length,
    totalScans: scanned,
    totalErrors: errors,
    locationResults: results,
  });
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
