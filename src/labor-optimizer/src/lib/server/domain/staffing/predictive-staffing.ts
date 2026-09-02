/**
 * Predictive Staffing Engine
 *
 * Converts accepted revenue forecasts into per-position shift recommendations
 * using labor thresholds, DOW weights, and average hourly rates from Toast data.
 */

import {
  getSupabase,
  type DashboardPosition,
  FOH_POSITIONS,
  BOH_POSITIONS,
  ALL_POSITIONS,
} from '$lib/server/supabase';
import { getLaborEnhancements, type LaborSignal } from '$lib/server/domain/forecasting/labor-enhancements';
import { getAllPatternsForDay, type ShiftPatternResult } from './shift-patterns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShiftSlot {
  start: string;
  end: string;
  count: number;
  role: 'opener' | 'peak' | 'closer' | 'full';
}

export interface PositionStaffing {
  position: string;
  targetLaborDollars: number;
  avgHourlyRate: number;
  totalHoursNeeded: number;
  shifts: ShiftSlot[];
  totalHeadcount: number;
}

export interface StaffingRecommendation {
  date: string;
  locationId: string;
  forecastRevenue: number;
  positions: PositionStaffing[];
  totalHeadcount: number;
  totalLaborBudget: number;
  laborPctOfForecast: number;
  serviceStyle: 'dinner_only' | 'lunch_dinner' | 'all_day';
  laborSignals?: LaborSignal[];
  laborSignalNotes?: string[];
}

// ---------------------------------------------------------------------------
// Shift templates by service style
// ---------------------------------------------------------------------------

const DINNER_ONLY_SHIFTS: Omit<ShiftSlot, 'count'>[] = [
  { start: '4:00 PM', end: '11:00 PM', role: 'opener' },
  { start: '5:00 PM', end: '11:00 PM', role: 'peak' },
  { start: '6:00 PM', end: '11:00 PM', role: 'closer' },
];

const LUNCH_DINNER_SHIFTS_LUNCH: Omit<ShiftSlot, 'count'>[] = [
  { start: '10:00 AM', end: '3:30 PM', role: 'opener' },
  { start: '11:00 AM', end: '3:30 PM', role: 'peak' },
];

const LUNCH_DINNER_SHIFTS_DINNER: Omit<ShiftSlot, 'count'>[] = [
  { start: '4:00 PM', end: '11:00 PM', role: 'opener' },
  { start: '5:00 PM', end: '11:00 PM', role: 'peak' },
  { start: '6:00 PM', end: '10:00 PM', role: 'closer' },
];

const ALL_DAY_SHIFTS: Omit<ShiftSlot, 'count'>[] = [
  { start: '7:00 AM', end: '3:00 PM', role: 'opener' },
  { start: '10:00 AM', end: '6:00 PM', role: 'full' },
  { start: '3:00 PM', end: '11:00 PM', role: 'closer' },
];

/** Default shift length in hours for headcount calculation. */
const DEFAULT_SHIFT_HOURS = 6.5;

/** Minimum avg hourly rate fallback when no data. */
const MIN_HOURLY_RATE = 12.0;

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Detect service style from hourly sales patterns.
 * Falls back to 'dinner_only' if no data.
 */
async function detectServiceStyle(
  locationId: string,
): Promise<'dinner_only' | 'lunch_dinner' | 'all_day'> {
  const sb = getSupabase();

  // Look at last 14 days of hourly sales to detect pattern
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const since = twoWeeksAgo.toISOString().split('T')[0];

  const { data: hourlyRows } = await sb
    .from('daily_hourly_sales')
    .select('hour_of_day, revenue')
    .eq('location_id', locationId)
    .gte('business_date', since)
    .gt('revenue', 0);

  if (!hourlyRows || hourlyRows.length === 0) return 'dinner_only';

  // Aggregate revenue by hour bucket
  let morningRev = 0;
  let lunchRev = 0;
  let dinnerRev = 0;
  for (const r of hourlyRows) {
    const h = r.hour_of_day;
    const rev = Number(r.revenue) || 0;
    if (h >= 6 && h < 11) morningRev += rev;
    else if (h >= 11 && h < 15) lunchRev += rev;
    else if (h >= 15) dinnerRev += rev;
  }

  const totalRev = morningRev + lunchRev + dinnerRev;
  if (totalRev === 0) return 'dinner_only';

  const morningPct = morningRev / totalRev;
  const lunchPct = lunchRev / totalRev;

  if (morningPct > 0.1) return 'all_day';
  if (lunchPct > 0.15) return 'lunch_dinner';
  return 'dinner_only';
}

/**
 * Compute average hourly rate per position from the last 30 days of labor data.
 * Returns sum(actual_dollars) / sum(actual_hours).
 */
async function getAvgHourlyRates(
  locationId: string,
): Promise<Record<string, number>> {
  const sb = getSupabase();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const since = thirtyDaysAgo.toISOString().split('T')[0];

  const { data: laborRows } = await sb
    .from('daily_labor')
    .select('mapped_position, labor_dollars, regular_hours, overtime_hours')
    .eq('location_id', locationId)
    .gte('business_date', since);

  const rates: Record<string, number> = {};
  const totals: Record<string, { dollars: number; hours: number }> = {};

  for (const row of laborRows || []) {
    const pos = row.mapped_position as string;
    if (!totals[pos]) totals[pos] = { dollars: 0, hours: 0 };
    totals[pos].dollars += Number(row.labor_dollars) || 0;
    totals[pos].hours += (Number(row.regular_hours) || 0) + (Number(row.overtime_hours) || 0);
  }

  for (const [pos, t] of Object.entries(totals)) {
    rates[pos] = t.hours > 0 ? t.dollars / t.hours : MIN_HOURLY_RATE;
  }

  return rates;
}

/**
 * Get accepted forecast revenue for a date.
 * Prefers manager_revenue (locked), falls back to ai_suggested_revenue.
 */
async function getForecastRevenue(
  locationId: string,
  date: string,
): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb
    .from('daily_forecasts')
    .select('manager_revenue, ai_suggested_revenue')
    .eq('location_id', locationId)
    .eq('business_date', date)
    .maybeSingle();

  if (!data) return 0;
  return data.manager_revenue ?? data.ai_suggested_revenue ?? 0;
}

/**
 * Get the matching labor threshold bracket for a weekly revenue level.
 * Returns per-position weekly labor dollars.
 */
async function getThresholdBracket(
  locationId: string,
  weeklyRevenue: number,
): Promise<Record<string, number>> {
  const sb = getSupabase();
  const { data: thresholds } = await sb
    .from('labor_thresholds')
    .select('position, weekly_labor_dollars, revenue_bracket_low, revenue_bracket_high')
    .eq('location_id', locationId)
    .lte('revenue_bracket_low', weeklyRevenue)
    .gte('revenue_bracket_high', weeklyRevenue);

  const result: Record<string, number> = {};
  for (const row of thresholds || []) {
    result[row.position] = Number(row.weekly_labor_dollars) || 0;
  }
  return result;
}

/**
 * Get DOW weight for a position + day.
 * day_of_week: 0=Sun, 1=Mon, ..., 6=Sat
 */
async function getDowWeight(
  locationId: string,
  position: string,
  dayOfWeek: number,
): Promise<number> {
  const sb = getSupabase();
  const { data } = await sb
    .from('dow_weights')
    .select('weight')
    .eq('location_id', locationId)
    .eq('position', position)
    .eq('day_of_week', dayOfWeek)
    .maybeSingle();

  return data?.weight ?? (1 / 7);
}

/**
 * Build shift slots from a learned pattern instead of generic templates.
 * Uses actual clock-in times, stagger intervals, and shift durations.
 */
function buildShiftsFromPattern(
  headcount: number,
  pattern: ShiftPatternResult,
): ShiftSlot[] {
  if (headcount <= 0) return [];

  const startTime = pattern.avgStartTime;
  const endTime = pattern.avgEndTime;

  if (headcount === 1) {
    return [{ start: startTime, end: endTime, count: 1, role: 'full' }];
  }

  // Multiple employees: stagger using learned pattern
  const stagger = pattern.staggerMinutes || 30;
  const shifts: ShiftSlot[] = [];
  const [startH, startM] = startTime.split(':').map(Number);
  const baseMinutes = startH * 60 + startM;

  for (let i = 0; i < headcount; i++) {
    const offsetMin = baseMinutes + i * stagger;
    const h = Math.floor(offsetMin / 60);
    const m = offsetMin % 60;
    const staggeredStart = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const role: ShiftSlot['role'] = i === 0 ? 'opener' : i === headcount - 1 ? 'closer' : 'peak';
    shifts.push({ start: staggeredStart, end: endTime, count: 1, role });
  }

  return shifts;
}

/**
 * Distribute headcount across shift slots.
 * Allocates based on role weight: opener gets 30%, peak gets 50%, closer gets 20%.
 */
function distributeToShifts(
  headcount: number,
  templates: Omit<ShiftSlot, 'count'>[],
): ShiftSlot[] {
  if (headcount <= 0 || templates.length === 0) return [];

  const roleWeights: Record<string, number> = {
    opener: 0.30,
    peak: 0.50,
    closer: 0.20,
    full: 0.40,
  };

  const totalWeight = templates.reduce((s, t) => s + (roleWeights[t.role] || 0.33), 0);
  const shifts: ShiftSlot[] = [];
  let assigned = 0;

  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    const weight = roleWeights[t.role] || 0.33;
    const isLast = i === templates.length - 1;
    const count = isLast
      ? Math.max(1, headcount - assigned)
      : Math.max(1, Math.round((weight / totalWeight) * headcount));
    assigned += count;
    shifts.push({ ...t, count });
  }

  return shifts;
}

/**
 * Get the week's total forecast revenue (Mon-Sun containing the target date).
 */
async function getWeekForecastTotal(
  locationId: string,
  date: string,
): Promise<number> {
  const d = new Date(date + 'T12:00:00');
  const dow = d.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const monday = new Date(d);
  monday.setDate(monday.getDate() + mondayOffset);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const startStr = monday.toISOString().split('T')[0];
  const endStr = sunday.toISOString().split('T')[0];

  const sb = getSupabase();
  const { data: rows } = await sb
    .from('daily_forecasts')
    .select('manager_revenue, ai_suggested_revenue')
    .eq('location_id', locationId)
    .gte('business_date', startStr)
    .lte('business_date', endStr);

  let total = 0;
  for (const row of rows || []) {
    total += row.manager_revenue ?? row.ai_suggested_revenue ?? 0;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a staffing recommendation for a specific date at a location.
 */
export async function getStaffingRecommendation(
  locationId: string,
  date: string,
): Promise<StaffingRecommendation> {
  // Determine DOW for weight + pattern lookup
  const dateObj = new Date(date + 'T12:00:00');
  const dayOfWeek = dateObj.getDay();

  // Parallel data fetches (include learned shift patterns)
  const [forecastRevenue, serviceStyle, avgRates, weekTotal, learnedPatterns] = await Promise.all([
    getForecastRevenue(locationId, date),
    detectServiceStyle(locationId),
    getAvgHourlyRates(locationId),
    getWeekForecastTotal(locationId, date),
    getAllPatternsForDay(locationId, dayOfWeek).catch(() => new Map<string, ShiftPatternResult>()),
  ]);

  // Get threshold bracket based on weekly revenue
  const weeklyLaborByPosition = await getThresholdBracket(locationId, weekTotal);

  // Pick shift templates based on service style (fallback when no learned pattern)
  let shiftTemplates: Omit<ShiftSlot, 'count'>[];
  switch (serviceStyle) {
    case 'lunch_dinner':
      shiftTemplates = [...LUNCH_DINNER_SHIFTS_LUNCH, ...LUNCH_DINNER_SHIFTS_DINNER];
      break;
    case 'all_day':
      shiftTemplates = ALL_DAY_SHIFTS;
      break;
    default:
      shiftTemplates = DINNER_ONLY_SHIFTS;
  }

  // Build per-position staffing
  const positions: PositionStaffing[] = [];
  let grandTotalHeadcount = 0;
  let grandTotalLabor = 0;

  for (const pos of ALL_POSITIONS) {
    const weeklyLabor = weeklyLaborByPosition[pos] ?? 0;
    if (weeklyLabor === 0) continue;

    const dowWeight = await getDowWeight(locationId, pos, dayOfWeek);
    const dailyLabor = weeklyLabor * dowWeight;
    const rate = avgRates[pos] ?? MIN_HOURLY_RATE;
    const totalHours = rate > 0 ? dailyLabor / rate : 0;
    const headcount = Math.max(1, Math.round(totalHours / DEFAULT_SHIFT_HOURS));

    // Use learned pattern if available with sufficient confidence; else generic templates
    const pattern = learnedPatterns.get(pos);
    const shifts = pattern && pattern.confidence >= 0.5
      ? buildShiftsFromPattern(headcount, pattern)
      : distributeToShifts(headcount, shiftTemplates);

    positions.push({
      position: pos,
      targetLaborDollars: Math.round(dailyLabor),
      avgHourlyRate: Math.round(rate * 100) / 100,
      totalHoursNeeded: Math.round(totalHours * 10) / 10,
      shifts,
      totalHeadcount: headcount,
    });

    grandTotalHeadcount += headcount;
    grandTotalLabor += Math.round(dailyLabor);
  }

  const laborPct = forecastRevenue > 0 ? grandTotalLabor / forecastRevenue : 0;

  // --- Labor Enhancements (advisory signals) ---
  let laborSignals: LaborSignal[] = [];
  let laborSignalNotes: string[] = [];
  try {
    const enhancements = await getLaborEnhancements(locationId, date);
    laborSignals = enhancements.adjustmentSignals;
    laborSignalNotes = enhancements.reasoning;

    // Apply headcount deltas from high-confidence signals
    for (const signal of laborSignals) {
      if (signal.confidence >= 0.6 && signal.headcountDelta !== 0) {
        grandTotalHeadcount = Math.max(1, grandTotalHeadcount + signal.headcountDelta);
      }
    }
  } catch (_) { /* non-critical — don't fail staffing recommendation */ }

  return {
    date,
    locationId,
    forecastRevenue: Math.round(forecastRevenue),
    positions,
    totalHeadcount: grandTotalHeadcount,
    totalLaborBudget: grandTotalLabor,
    laborPctOfForecast: Math.round(laborPct * 1000) / 1000,
    serviceStyle,
    laborSignals: laborSignals.length > 0 ? laborSignals : undefined,
    laborSignalNotes: laborSignalNotes.length > 0 ? laborSignalNotes : undefined,
  };
}

/**
 * Generate staffing recommendations for a date range.
 */
export async function getStaffingRange(
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<StaffingRecommendation[]> {
  const start = new Date(startDate + 'T12:00:00');
  const end = new Date(endDate + 'T12:00:00');
  const results: StaffingRecommendation[] = [];

  const current = new Date(start);
  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];
    const rec = await getStaffingRecommendation(locationId, dateStr);
    results.push(rec);
    current.setDate(current.getDate() + 1);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Actuals reconciliation
// ---------------------------------------------------------------------------

export interface DayActuals {
  date: string;
  laborByPosition: { position: string; dollars: number; hours: number }[];
  hourlyRevenue: { hour: number; revenue: number }[];
  totalLaborDollars: number;
  totalRevenue: number;
}

/**
 * Fetch actual labor and hourly revenue for past days in a range.
 * Only returns data for dates before today.
 */
export async function getActualsForRange(
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<DayActuals[]> {
  const sb = getSupabase();
  const today = new Date().toISOString().split('T')[0];

  // Only fetch actuals for past days
  const actualEnd = endDate < today ? endDate : today;
  if (startDate >= today) return [];

  const [laborRes, hourlyRes] = await Promise.all([
    sb
      .from('daily_labor')
      .select('business_date, mapped_position, labor_dollars, regular_hours, overtime_hours')
      .eq('location_id', locationId)
      .gte('business_date', startDate)
      .lt('business_date', actualEnd),
    sb
      .from('daily_hourly_sales')
      .select('business_date, hour_of_day, revenue')
      .eq('location_id', locationId)
      .gte('business_date', startDate)
      .lt('business_date', actualEnd),
  ]);

  const laborRows = laborRes.data || [];
  const hourlyRows = hourlyRes.data || [];

  // Group by date
  const byDate: Record<string, DayActuals> = {};

  for (const row of laborRows) {
    const d = row.business_date;
    if (!byDate[d]) {
      byDate[d] = { date: d, laborByPosition: [], hourlyRevenue: [], totalLaborDollars: 0, totalRevenue: 0 };
    }
    const dollars = Number(row.labor_dollars) || 0;
    const hours = (Number(row.regular_hours) || 0) + (Number(row.overtime_hours) || 0);
    byDate[d].laborByPosition.push({ position: row.mapped_position, dollars, hours });
    byDate[d].totalLaborDollars += dollars;
  }

  for (const row of hourlyRows) {
    const d = row.business_date;
    if (!byDate[d]) {
      byDate[d] = { date: d, laborByPosition: [], hourlyRevenue: [], totalLaborDollars: 0, totalRevenue: 0 };
    }
    const rev = Number(row.revenue) || 0;
    byDate[d].hourlyRevenue.push({ hour: row.hour_of_day, revenue: rev });
    byDate[d].totalRevenue += rev;
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Shift pattern learning
// ---------------------------------------------------------------------------

export interface ShiftPattern {
  date: string;
  dayOfWeek: number;
  openHours: number[];
  peakHours: number[];
  closeHours: number[];
  peakRevenue: number;
}

/**
 * Compute actual open/peak/closer distribution from hourly revenue data.
 * Open: hours where revenue < 30% of peak hour revenue
 * Peak: 3 consecutive hours with highest total revenue
 * Close: hours after peak where revenue < 30% of peak
 */
export async function computeShiftPatterns(
  locationId: string,
  startDate: string,
  endDate: string,
): Promise<ShiftPattern[]> {
  const sb = getSupabase();
  const today = new Date().toISOString().split('T')[0];
  const actualEnd = endDate < today ? endDate : today;
  if (startDate >= today) return [];

  const { data: rows } = await sb
    .from('daily_hourly_sales')
    .select('business_date, hour_of_day, revenue')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lt('business_date', actualEnd)
    .gt('revenue', 0);

  if (!rows || rows.length === 0) return [];

  // Group by date
  const byDate: Record<string, { hour: number; revenue: number }[]> = {};
  for (const r of rows) {
    if (!byDate[r.business_date]) byDate[r.business_date] = [];
    byDate[r.business_date].push({ hour: r.hour_of_day, revenue: Number(r.revenue) || 0 });
  }

  const patterns: ShiftPattern[] = [];

  for (const [date, hourlyData] of Object.entries(byDate)) {
    const sorted = hourlyData.sort((a, b) => a.hour - b.hour);
    if (sorted.length < 3) continue;

    // Find peak 3-hour window
    let bestSum = 0;
    let bestStart = 0;
    for (let i = 0; i <= sorted.length - 3; i++) {
      const sum = sorted[i].revenue + sorted[i + 1].revenue + sorted[i + 2].revenue;
      if (sum > bestSum) {
        bestSum = sum;
        bestStart = i;
      }
    }

    const peakHourNums = sorted.slice(bestStart, bestStart + 3).map(h => h.hour);
    const peakMax = Math.max(...sorted.map(h => h.revenue));
    const threshold = peakMax * 0.3;

    const peakEnd = Math.max(...peakHourNums);
    const openHours: number[] = [];
    const closeHours: number[] = [];

    for (const h of sorted) {
      if (h.revenue < threshold && h.hour < peakHourNums[0]) {
        openHours.push(h.hour);
      } else if (h.revenue < threshold && h.hour > peakEnd) {
        closeHours.push(h.hour);
      }
    }

    const dateObj = new Date(date + 'T12:00:00');
    patterns.push({
      date,
      dayOfWeek: dateObj.getDay(),
      openHours,
      peakHours: peakHourNums,
      closeHours,
      peakRevenue: peakMax,
    });
  }

  // Upsert learned patterns into hourly_revenue_curves
  for (const p of patterns) {
    const totalRev = p.peakRevenue > 0 ? p.peakRevenue : 1;
    const upsertRows = [
      ...p.openHours, ...p.peakHours, ...p.closeHours,
    ].map(hour => ({
      location_id: locationId,
      day_of_week: p.dayOfWeek,
      hour,
      pct_of_daily: 0, // Will be computed on next daily refresh
      sample_count: 1,
      updated_at: new Date().toISOString(),
    }));
    if (upsertRows.length > 0) {
      await sb.from('hourly_revenue_curves').upsert(upsertRows, {
        onConflict: 'location_id,day_of_week,hour',
      });
    }
  }

  return patterns;
}
