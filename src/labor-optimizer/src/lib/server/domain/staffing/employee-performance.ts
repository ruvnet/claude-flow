/**
 * Employee Performance Scoring Engine (Layer 2)
 *
 * Scores employees based on actual performance data from Toast:
 * - Revenue per hour worked
 * - Average check size on their shifts
 * - Table turn speed
 * - No-show reliability (scheduled vs actual clock-in)
 *
 * Uses last 30 days of data to build a composite score per employee.
 */

import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmployeePerformanceScore {
  employeeId: string;
  employeeName: string;
  position: string;
  /** Revenue generated per hour worked (higher = better) */
  revenuePerHour: number;
  /** Normalized 0-1 score for revenue efficiency */
  revenueScore: number;
  /** Average check size when this employee was working */
  avgCheckSize: number;
  /** Normalized 0-1 score for check size */
  checkSizeScore: number;
  /** Average table turns per hour (from dining metrics) */
  tableTurnsPerHour: number;
  /** Normalized 0-1 score for turn speed */
  turnSpeedScore: number;
  /** Reliability: ratio of actual clock-ins to scheduled shifts */
  reliabilityRate: number;
  /** Normalized 0-1 score for reliability */
  reliabilityScore: number;
  /** Composite score (weighted average of all dimensions) */
  compositeScore: number;
  /** Number of shifts in the scoring window */
  shiftsWorked: number;
  /** Confidence: higher when more data is available */
  confidence: 'high' | 'medium' | 'low';
}

// Weights for the composite score
const WEIGHTS = {
  revenue: 0.30,
  checkSize: 0.20,
  turnSpeed: 0.20,
  reliability: 0.30,
};

const LOOKBACK_DAYS = 30;

// ---------------------------------------------------------------------------
// Data Loaders
// ---------------------------------------------------------------------------

interface LaborRow {
  employee_id: string;
  business_date: string;
  labor_dollars: number;
  regular_hours: number;
  overtime_hours: number;
}

interface ActualsRow {
  business_date: string;
  revenue: number;
  covers: number;
  order_count: number;
}

interface DiningMetricsRow {
  business_date: string;
  avg_table_turn_minutes: number;
  covers_per_hour: number;
}

interface ScheduledShiftRow {
  employee_id: string;
  business_date: string;
}

interface EmployeeBasicRow {
  id: string;
  name: string;
  position: string;
}

async function loadEmployeeLabor(
  locationId: string,
  since: string,
): Promise<LaborRow[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('daily_labor')
    .select('employee_id, business_date, labor_dollars, regular_hours, overtime_hours')
    .eq('location_id', locationId)
    .gte('business_date', since)
    .not('employee_id', 'is', null);

  return (data || []) as LaborRow[];
}

async function loadDailyActuals(
  locationId: string,
  since: string,
): Promise<ActualsRow[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('daily_actuals')
    .select('business_date, revenue, covers, order_count')
    .eq('location_id', locationId)
    .gte('business_date', since);

  return (data || []) as ActualsRow[];
}

async function loadDiningMetrics(
  locationId: string,
  since: string,
): Promise<DiningMetricsRow[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('daily_dining_metrics')
    .select('business_date, avg_table_turn_minutes, covers_per_hour')
    .eq('location_id', locationId)
    .gte('business_date', since);

  return (data || []) as DiningMetricsRow[];
}

async function loadScheduledShifts(
  locationId: string,
  since: string,
): Promise<ScheduledShiftRow[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('scheduled_shifts')
    .select('employee_id, business_date')
    .eq('location_id', locationId)
    .gte('business_date', since);

  return (data || []) as ScheduledShiftRow[];
}

async function loadEmployees(locationId: string): Promise<EmployeeBasicRow[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('employees')
    .select('id, name, position')
    .eq('location_id', locationId)
    .eq('is_active', true);

  return (data || []) as EmployeeBasicRow[];
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Normalize a value array to 0-1 scale (higher is better). */
function normalizeScores(values: Map<string, number>): Map<string, number> {
  const arr = Array.from(values.values());
  if (arr.length === 0) return values;
  const min = Math.min(...arr);
  const max = Math.max(...arr);
  const range = max - min;
  if (range === 0) {
    // All values equal -- return 0.5 for everyone
    const result = new Map<string, number>();
    for (const [k] of values) result.set(k, 0.5);
    return result;
  }
  const result = new Map<string, number>();
  for (const [k, v] of values) {
    result.set(k, (v - min) / range);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calculate performance scores for all active employees at a location.
 * Uses the last 30 days of Toast data.
 */
export async function getEmployeePerformanceScores(
  locationId: string,
): Promise<EmployeePerformanceScore[]> {
  const since = new Date();
  since.setDate(since.getDate() - LOOKBACK_DAYS);
  const sinceStr = since.toISOString().split('T')[0];

  // Load all data in parallel
  const [employees, laborRows, actualsRows, diningRows, scheduledRows] =
    await Promise.all([
      loadEmployees(locationId),
      loadEmployeeLabor(locationId, sinceStr),
      loadDailyActuals(locationId, sinceStr),
      loadDiningMetrics(locationId, sinceStr),
      loadScheduledShifts(locationId, sinceStr),
    ]);

  if (employees.length === 0) return [];

  // Index daily actuals by date
  const actualsByDate = new Map<string, ActualsRow>();
  for (const a of actualsRows) actualsByDate.set(a.business_date, a);

  // Index dining metrics by date
  const diningByDate = new Map<string, DiningMetricsRow>();
  for (const d of diningRows) diningByDate.set(d.business_date, d);

  // Aggregate labor per employee
  const empLabor = new Map<string, { totalHours: number; dates: Set<string> }>();
  for (const row of laborRows) {
    const hours = (Number(row.regular_hours) || 0) + (Number(row.overtime_hours) || 0);
    if (hours <= 0) continue;
    const cur = empLabor.get(row.employee_id) || { totalHours: 0, dates: new Set<string>() };
    cur.totalHours += hours;
    cur.dates.add(row.business_date);
    empLabor.set(row.employee_id, cur);
  }

  // Count scheduled shifts per employee
  const empScheduled = new Map<string, Set<string>>();
  for (const row of scheduledRows) {
    const set = empScheduled.get(row.employee_id) || new Set<string>();
    set.add(row.business_date);
    empScheduled.set(row.employee_id, set);
  }

  // Raw metric maps
  const rawRevPerHour = new Map<string, number>();
  const rawAvgCheck = new Map<string, number>();
  const rawTurnSpeed = new Map<string, number>();
  const rawReliability = new Map<string, number>();
  const shiftsWorkedMap = new Map<string, number>();

  for (const emp of employees) {
    const labor = empLabor.get(emp.id);
    const datesWorked = labor?.dates || new Set<string>();
    const totalHours = labor?.totalHours || 0;
    shiftsWorkedMap.set(emp.id, datesWorked.size);

    // Revenue per hour: total revenue on days worked / total hours
    if (totalHours > 0 && datesWorked.size > 0) {
      let totalRev = 0;
      let totalCovers = 0;
      let totalOrders = 0;
      let turnMinutesSum = 0;
      let turnCount = 0;

      for (const date of datesWorked) {
        const actual = actualsByDate.get(date);
        if (actual) {
          totalRev += Number(actual.revenue) || 0;
          totalCovers += Number(actual.covers) || 0;
          totalOrders += Number(actual.order_count) || 0;
        }
        const dining = diningByDate.get(date);
        if (dining && dining.avg_table_turn_minutes > 0) {
          turnMinutesSum += dining.avg_table_turn_minutes;
          turnCount++;
        }
      }

      rawRevPerHour.set(emp.id, totalRev / totalHours);
      rawAvgCheck.set(emp.id, totalOrders > 0 ? totalRev / totalOrders : 0);
      rawTurnSpeed.set(
        emp.id,
        turnCount > 0 ? 60 / (turnMinutesSum / turnCount) : 0,
      );
    } else {
      rawRevPerHour.set(emp.id, 0);
      rawAvgCheck.set(emp.id, 0);
      rawTurnSpeed.set(emp.id, 0);
    }

    // Reliability: days with labor data / days scheduled
    const scheduledDates = empScheduled.get(emp.id);
    if (scheduledDates && scheduledDates.size > 0) {
      const showedUp = Array.from(scheduledDates).filter((d) =>
        datesWorked.has(d),
      ).length;
      rawReliability.set(emp.id, showedUp / scheduledDates.size);
    } else {
      // No scheduled shifts in window -- assume reliable if they worked
      rawReliability.set(emp.id, datesWorked.size > 0 ? 1.0 : 0.5);
    }
  }

  // Normalize each dimension to 0-1
  const normRevPerHour = normalizeScores(rawRevPerHour);
  const normAvgCheck = normalizeScores(rawAvgCheck);
  const normTurnSpeed = normalizeScores(rawTurnSpeed);
  // Reliability is already 0-1, but normalize across employees for relative ranking
  const normReliability = normalizeScores(rawReliability);

  // Build final scores
  const results: EmployeePerformanceScore[] = [];

  for (const emp of employees) {
    const revScore = normRevPerHour.get(emp.id) ?? 0.5;
    const checkScore = normAvgCheck.get(emp.id) ?? 0.5;
    const turnScore = normTurnSpeed.get(emp.id) ?? 0.5;
    const relScore = normReliability.get(emp.id) ?? 0.5;
    const shiftsWorked = shiftsWorkedMap.get(emp.id) ?? 0;

    const composite =
      WEIGHTS.revenue * revScore +
      WEIGHTS.checkSize * checkScore +
      WEIGHTS.turnSpeed * turnScore +
      WEIGHTS.reliability * relScore;

    let confidence: 'high' | 'medium' | 'low' = 'low';
    if (shiftsWorked >= 15) confidence = 'high';
    else if (shiftsWorked >= 5) confidence = 'medium';

    results.push({
      employeeId: emp.id,
      employeeName: emp.name,
      position: emp.position,
      revenuePerHour: Math.round((rawRevPerHour.get(emp.id) ?? 0) * 100) / 100,
      revenueScore: Math.round(revScore * 1000) / 1000,
      avgCheckSize: Math.round((rawAvgCheck.get(emp.id) ?? 0) * 100) / 100,
      checkSizeScore: Math.round(checkScore * 1000) / 1000,
      tableTurnsPerHour: Math.round((rawTurnSpeed.get(emp.id) ?? 0) * 100) / 100,
      turnSpeedScore: Math.round(turnScore * 1000) / 1000,
      reliabilityRate: Math.round((rawReliability.get(emp.id) ?? 0) * 1000) / 1000,
      reliabilityScore: Math.round(relScore * 1000) / 1000,
      compositeScore: Math.round(composite * 1000) / 1000,
      shiftsWorked,
      confidence,
    });
  }

  // Sort by composite score descending
  results.sort((a, b) => b.compositeScore - a.compositeScore);
  return results;
}

/**
 * Get a map of employeeId -> compositeScore for use in shift assignment scoring.
 * Returns scores scaled 0-10 for integration with the existing scoring system.
 */
export async function getPerformanceBoostMap(
  locationId: string,
): Promise<Map<string, number>> {
  const scores = await getEmployeePerformanceScores(locationId);
  const map = new Map<string, number>();
  for (const s of scores) {
    // Scale composite (0-1) to 0-10 bonus points
    map.set(s.employeeId, Math.round(s.compositeScore * 10 * 100) / 100);
  }
  return map;
}
