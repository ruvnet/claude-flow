/**
 * Shift Pattern Learning Engine
 *
 * Extracts actual clock-in/out patterns from Toast time entry data,
 * grouped by position and day-of-week, then stores learned patterns
 * for use by the Schedule Builder and Predictive Staffing engines.
 *
 * Instead of generic "opener at 4 PM, peak at 5 PM, closer at 6 PM",
 * this learns that line cooks start at 2 PM for prep, hosts at 4:30 PM,
 * servers stagger 4:30/5:00/5:30, bartenders at 3:30 PM, etc.
 */

import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShiftPatternRow {
  location_id: string;
  position: string;
  day_of_week: number;
  avg_start_time: string;
  avg_end_time: string;
  avg_shift_hours: number;
  stagger_minutes: number;
  earliest_start: string;
  latest_start: string;
  sample_size: number;
  confidence: number;
}

export interface ShiftPatternResult {
  avgStartTime: string;
  avgEndTime: string;
  avgShiftHours: number;
  staggerMinutes: number;
  earliestStart: string;
  latestStart: string;
  sampleSize: number;
  confidence: number;
}

interface TimeEntryParsed {
  position: string;
  dayOfWeek: number;
  startMinutes: number; // minutes from midnight
  endMinutes: number;
  shiftHours: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert "HH:MM" to minutes from midnight. */
function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** Convert minutes from midnight to "HH:MM". */
function minutesToTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Parse an ISO timestamp into minutes-from-midnight in EST. */
function isoToEstMinutes(isoDate: string): number {
  const d = new Date(isoDate);
  const est = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return est.getHours() * 60 + est.getMinutes();
}

/** Parse an ISO timestamp into JS day-of-week (0=Sun) in EST. */
function isoToEstDow(isoDate: string): number {
  const d = new Date(isoDate);
  const est = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return est.getDay();
}

/** Compute average of an array of numbers. */
function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/** Compute stagger: median gap between consecutive sorted start times. */
function computeStagger(startMinutes: number[]): number {
  if (startMinutes.length < 2) return 0;
  const sorted = [...startMinutes].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push(sorted[i] - sorted[i - 1]);
  }
  // Median gap (ignore outliers)
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0
    ? Math.round((gaps[mid - 1] + gaps[mid]) / 2)
    : gaps[mid];
}

// ---------------------------------------------------------------------------
// Core: Learn patterns from Toast time entries
// ---------------------------------------------------------------------------

/**
 * Fetch Toast time entries for a location over a date range,
 * parse into position/DOW/start/end, and compute aggregated patterns.
 */
export async function learnShiftPatterns(
  locationId: string,
  daysBack = 30,
): Promise<{ patternsUpserted: number; entriesAnalyzed: number }> {
  const sb = getSupabaseService();

  // Load location credentials
  const { data: loc } = await sb
    .from('locations')
    .select('id, name, toast_client_id, toast_client_secret, toast_guid')
    .eq('id', locationId)
    .maybeSingle();

  if (!loc?.toast_client_id || !loc?.toast_client_secret || !loc?.toast_guid) {
    return { patternsUpserted: 0, entriesAnalyzed: 0 };
  }

  // Load job mapping
  const { data: mappings } = await sb
    .from('toast_job_mapping')
    .select('toast_job_name, dashboard_position')
    .eq('location_id', locationId);
  const jobMap: Record<string, string> = {};
  for (const m of mappings || []) {
    jobMap[m.toast_job_name] = m.dashboard_position;
  }

  const toast = createToastClientFromCredentials({
    clientId: loc.toast_client_id,
    clientSecret: loc.toast_client_secret,
    restaurantGuid: loc.toast_guid,
  });

  // Fetch Toast jobs for GUID -> title mapping
  const jobs = await toast.getJobs();
  const jobGuidToTitle = new Map(jobs.map(j => [j.guid, j.title]));

  // Fetch time entries for last N days
  const entries: TimeEntryParsed[] = [];
  const today = new Date();

  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];

    try {
      const timeEntries = await toast.getTimeEntries(dateStr, dateStr);
      for (const te of timeEntries as any[]) {
        if (!te.inDate) continue;
        const jobGuid = te.jobReference?.guid || te.jobGuid;
        if (!jobGuid) continue;
        const jobTitle = jobGuidToTitle.get(jobGuid) || '';
        const position = jobMap[jobTitle];
        if (!position || position === 'EXCLUDE') continue;

        const startMin = isoToEstMinutes(te.inDate);
        const endMin = te.outDate ? isoToEstMinutes(te.outDate) : startMin + 360;
        const hours = te.outDate
          ? (new Date(te.outDate).getTime() - new Date(te.inDate).getTime()) / 3600000
          : (te.regularHours || 0) + (te.overtimeHours || 0);
        const dow = isoToEstDow(te.inDate);

        // Filter out unreasonable entries (< 2 hours or > 16 hours)
        if (hours < 2 || hours > 16) continue;

        entries.push({ position, dayOfWeek: dow, startMinutes: startMin, endMinutes: endMin, shiftHours: hours });
      }
    } catch (err: any) {
      // Non-critical: skip days with API errors
      console.warn(`[shift-patterns] Skipped ${dateStr} for ${loc.name}: ${err.message}`);
    }

    // Rate limit: 500ms between days
    if (i < daysBack) await new Promise(r => setTimeout(r, 500));
  }

  if (entries.length === 0) {
    return { patternsUpserted: 0, entriesAnalyzed: 0 };
  }

  // Group by position + DOW
  const groups = new Map<string, TimeEntryParsed[]>();
  for (const e of entries) {
    const key = `${e.position}::${e.dayOfWeek}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  // Compute patterns and upsert
  let patternsUpserted = 0;
  const now = new Date().toISOString();

  for (const [key, group] of groups) {
    const [position, dowStr] = key.split('::');
    const dow = parseInt(dowStr, 10);

    const starts = group.map(e => e.startMinutes);
    const ends = group.map(e => e.endMinutes);
    const hours = group.map(e => e.shiftHours);

    const avgStart = Math.round(avg(starts));
    const avgEnd = Math.round(avg(ends));
    const avgHours = Math.round(avg(hours) * 10) / 10;
    const stagger = computeStagger(starts);
    const earliest = Math.min(...starts);
    const latest = Math.max(...starts);
    const sampleSize = group.length;
    // Confidence: ramp from 0 at 1 sample to 1.0 at 14+ samples
    const confidence = Math.min(1.0, Math.round((sampleSize / 14) * 100) / 100);

    const { error } = await sb.from('shift_start_patterns').upsert({
      location_id: locationId,
      position,
      day_of_week: dow,
      avg_start_time: minutesToTime(avgStart),
      avg_end_time: minutesToTime(avgEnd),
      avg_shift_hours: avgHours,
      stagger_minutes: stagger,
      earliest_start: minutesToTime(earliest),
      latest_start: minutesToTime(latest),
      sample_size: sampleSize,
      confidence,
      updated_at: now,
    }, { onConflict: 'location_id,position,day_of_week' });

    if (!error) patternsUpserted++;
  }

  return { patternsUpserted, entriesAnalyzed: entries.length };
}

// ---------------------------------------------------------------------------
// Query: Get learned shift pattern for a specific position + DOW
// ---------------------------------------------------------------------------

/**
 * Returns the learned shift pattern for a position on a given DOW.
 * Returns null if no pattern exists or confidence is below threshold.
 */
export async function getShiftPattern(
  locationId: string,
  position: string,
  dayOfWeek: number,
  minConfidence = 0.3,
): Promise<ShiftPatternResult | null> {
  const sb = getSupabaseService();
  const { data } = await sb
    .from('shift_start_patterns')
    .select('*')
    .eq('location_id', locationId)
    .eq('position', position)
    .eq('day_of_week', dayOfWeek)
    .gte('confidence', minConfidence)
    .maybeSingle();

  if (!data) return null;

  return {
    avgStartTime: data.avg_start_time,
    avgEndTime: data.avg_end_time,
    avgShiftHours: Number(data.avg_shift_hours),
    staggerMinutes: data.stagger_minutes || 0,
    earliestStart: data.earliest_start,
    latestStart: data.latest_start,
    sampleSize: data.sample_size,
    confidence: Number(data.confidence),
  };
}

/**
 * Fetch all learned patterns for a location on a given DOW.
 * Returns a map of position -> pattern for fast lookup.
 */
export async function getAllPatternsForDay(
  locationId: string,
  dayOfWeek: number,
  minConfidence = 0.3,
): Promise<Map<string, ShiftPatternResult>> {
  const sb = getSupabaseService();
  const { data } = await sb
    .from('shift_start_patterns')
    .select('*')
    .eq('location_id', locationId)
    .eq('day_of_week', dayOfWeek)
    .gte('confidence', minConfidence);

  const map = new Map<string, ShiftPatternResult>();
  for (const row of data || []) {
    map.set(row.position, {
      avgStartTime: row.avg_start_time,
      avgEndTime: row.avg_end_time,
      avgShiftHours: Number(row.avg_shift_hours),
      staggerMinutes: row.stagger_minutes || 0,
      earliestStart: row.earliest_start,
      latestStart: row.latest_start,
      sampleSize: row.sample_size,
      confidence: Number(row.confidence),
    });
  }
  return map;
}
