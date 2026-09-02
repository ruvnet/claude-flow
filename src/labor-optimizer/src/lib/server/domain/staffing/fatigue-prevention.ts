/**
 * Fatigue Prevention Engine (Layer 5)
 *
 * Tracks and prevents employee burnout by monitoring:
 * - Rolling 4-week total hours
 * - Consecutive days worked
 * - High-intensity shift patterns (all peaks, no openers/closers)
 *
 * Produces per-employee fatigue risk scores and can adjust assignments
 * to swap high-fatigue employees to lighter shifts.
 */

import { getSupabase } from '$lib/server/supabase';
import type { SolvedAssignment } from './constraint-solver';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FatigueRisk {
  employeeId: string;
  employeeName: string;
  position: string;
  /** Rolling 4-week total hours */
  rollingHours: number;
  /** Max comfortable hours for 4 weeks (maxWeekly * 4) */
  maxRollingHours: number;
  /** Ratio of rolling hours to max (>0.9 = high risk) */
  hoursUtilization: number;
  /** Current consecutive days worked streak */
  consecutiveDays: number;
  /** Number of peak-only days in last 2 weeks (no openers/closers) */
  peakOnlyDays: number;
  /** Composite fatigue risk score 0-1 (higher = more fatigued) */
  riskScore: number;
  /** Risk level classification */
  riskLevel: 'low' | 'moderate' | 'high' | 'critical';
  /** Specific risk factors triggered */
  riskFactors: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLLING_WEEKS = 4;
const LOOKBACK_DAYS = ROLLING_WEEKS * 7;
const MAX_CONSECUTIVE_BEFORE_RISK = 5;
const HIGH_HOURS_THRESHOLD = 0.85; // 85% of max rolling hours
const CRITICAL_HOURS_THRESHOLD = 0.95;
const PEAK_ONLY_RISK_DAYS = 5; // 5+ peak-only days in 2 weeks = risk

// ---------------------------------------------------------------------------
// Data Loaders
// ---------------------------------------------------------------------------

interface EmployeeRow {
  id: string;
  name: string;
  position: string;
  max_hours_per_week: number;
}

interface HoursLogRow {
  employee_id: string;
  business_date: string;
  hours: number;
}

interface ShiftRow {
  employee_id: string;
  business_date: string;
  shift_type: string;
}

async function loadActiveEmployees(locationId: string): Promise<EmployeeRow[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('employees')
    .select('id, name, position, max_hours_per_week')
    .eq('location_id', locationId)
    .eq('is_active', true);

  return (data || []) as EmployeeRow[];
}

async function loadRollingHours(
  locationId: string,
  since: string,
  until: string,
): Promise<HoursLogRow[]> {
  const sb = getSupabase();

  // Try employee_hours_log first, fall back to daily_labor
  const { data: hoursData } = await sb
    .from('daily_labor')
    .select('employee_id, business_date, regular_hours, overtime_hours')
    .eq('location_id', locationId)
    .gte('business_date', since)
    .lte('business_date', until)
    .not('employee_id', 'is', null);

  return (hoursData || []).map((row: any) => ({
    employee_id: row.employee_id,
    business_date: row.business_date,
    hours: (Number(row.regular_hours) || 0) + (Number(row.overtime_hours) || 0),
  }));
}

async function loadRecentShifts(
  locationId: string,
  since: string,
): Promise<ShiftRow[]> {
  const sb = getSupabase();
  const { data } = await sb
    .from('scheduled_shifts')
    .select('employee_id, business_date, shift_type')
    .eq('location_id', locationId)
    .gte('business_date', since);

  return (data || []) as ShiftRow[];
}

// ---------------------------------------------------------------------------
// Consecutive days calculation
// ---------------------------------------------------------------------------

function computeConsecutiveDays(
  datesWorked: string[],
  today: string,
): number {
  if (datesWorked.length === 0) return 0;

  const sorted = [...datesWorked].sort().reverse(); // Most recent first
  let streak = 0;

  // Start from today and count backwards
  let checkDate = new Date(today + 'T12:00:00');

  for (let i = 0; i < 14; i++) {
    const dateStr = checkDate.toISOString().split('T')[0];
    if (sorted.includes(dateStr)) {
      streak++;
    } else {
      break;
    }
    checkDate.setDate(checkDate.getDate() - 1);
  }

  return streak;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute fatigue risk scores for all active employees at a location.
 */
export async function getFatigueRisks(
  locationId: string,
): Promise<FatigueRisk[]> {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const lookbackDate = new Date(today);
  lookbackDate.setDate(lookbackDate.getDate() - LOOKBACK_DAYS);
  const sinceStr = lookbackDate.toISOString().split('T')[0];
  const twoWeeksAgo = new Date(today);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const twoWeeksStr = twoWeeksAgo.toISOString().split('T')[0];

  const [employees, hoursRows, shiftRows] = await Promise.all([
    loadActiveEmployees(locationId),
    loadRollingHours(locationId, sinceStr, todayStr),
    loadRecentShifts(locationId, twoWeeksStr),
  ]);

  if (employees.length === 0) return [];

  // Aggregate hours per employee
  const empHours = new Map<string, { total: number; dates: string[] }>();
  for (const row of hoursRows) {
    const cur = empHours.get(row.employee_id) || { total: 0, dates: [] };
    cur.total += row.hours;
    if (!cur.dates.includes(row.business_date)) {
      cur.dates.push(row.business_date);
    }
    empHours.set(row.employee_id, cur);
  }

  // Aggregate shift types per employee per date
  const empShiftTypes = new Map<string, Map<string, Set<string>>>();
  for (const row of shiftRows) {
    if (!empShiftTypes.has(row.employee_id)) {
      empShiftTypes.set(row.employee_id, new Map());
    }
    const byDate = empShiftTypes.get(row.employee_id)!;
    if (!byDate.has(row.business_date)) {
      byDate.set(row.business_date, new Set());
    }
    byDate.get(row.business_date)!.add(row.shift_type);
  }

  const results: FatigueRisk[] = [];

  for (const emp of employees) {
    const hours = empHours.get(emp.id) || { total: 0, dates: [] };
    const maxRolling = (emp.max_hours_per_week || 40) * ROLLING_WEEKS;
    const utilization = maxRolling > 0 ? hours.total / maxRolling : 0;
    const consecutiveDays = computeConsecutiveDays(hours.dates, todayStr);

    // Count peak-only days in last 2 weeks
    let peakOnlyDays = 0;
    const shiftsByDate = empShiftTypes.get(emp.id);
    if (shiftsByDate) {
      for (const [, types] of shiftsByDate) {
        if (types.has('peak') && !types.has('opener') && !types.has('closer')) {
          peakOnlyDays++;
        }
      }
    }

    // Compute risk factors
    const riskFactors: string[] = [];
    let riskScore = 0;

    // Hours utilization (40% weight)
    if (utilization >= CRITICAL_HOURS_THRESHOLD) {
      riskScore += 0.4;
      riskFactors.push(`${Math.round(utilization * 100)}% of max rolling hours (critical)`);
    } else if (utilization >= HIGH_HOURS_THRESHOLD) {
      riskScore += 0.4 * ((utilization - HIGH_HOURS_THRESHOLD) / (CRITICAL_HOURS_THRESHOLD - HIGH_HOURS_THRESHOLD));
      riskFactors.push(`${Math.round(utilization * 100)}% of max rolling hours`);
    }

    // Consecutive days (30% weight)
    if (consecutiveDays >= 7) {
      riskScore += 0.3;
      riskFactors.push(`${consecutiveDays} consecutive days worked`);
    } else if (consecutiveDays >= MAX_CONSECUTIVE_BEFORE_RISK) {
      riskScore += 0.3 * ((consecutiveDays - MAX_CONSECUTIVE_BEFORE_RISK) / 2);
      riskFactors.push(`${consecutiveDays} consecutive days worked`);
    }

    // Peak-only intensity (20% weight)
    if (peakOnlyDays >= PEAK_ONLY_RISK_DAYS) {
      riskScore += 0.2;
      riskFactors.push(`${peakOnlyDays} peak-only days in 2 weeks`);
    } else if (peakOnlyDays >= 3) {
      riskScore += 0.2 * ((peakOnlyDays - 3) / (PEAK_ONLY_RISK_DAYS - 3));
    }

    // Combination amplifier: if multiple factors present, amplify (10% weight)
    if (riskFactors.length >= 2) {
      riskScore += 0.1;
      riskFactors.push('Multiple fatigue factors compounding');
    }

    riskScore = Math.min(1, Math.round(riskScore * 1000) / 1000);

    let riskLevel: FatigueRisk['riskLevel'] = 'low';
    if (riskScore >= 0.75) riskLevel = 'critical';
    else if (riskScore >= 0.5) riskLevel = 'high';
    else if (riskScore >= 0.25) riskLevel = 'moderate';

    results.push({
      employeeId: emp.id,
      employeeName: emp.name,
      position: emp.position,
      rollingHours: Math.round(hours.total * 10) / 10,
      maxRollingHours: maxRolling,
      hoursUtilization: Math.round(utilization * 1000) / 1000,
      consecutiveDays,
      peakOnlyDays,
      riskScore,
      riskLevel,
      riskFactors,
    });
  }

  // Sort by risk score descending
  results.sort((a, b) => b.riskScore - a.riskScore);
  return results;
}

/**
 * Adjust a set of assignments to mitigate fatigue risks.
 *
 * Strategy:
 * - For employees with high/critical fatigue, swap them from peak shifts to
 *   opener/closer shifts (lighter intensity).
 * - If no lighter shift is available, flag the assignment as a fatigue warning.
 */
export function adjustForFatigue(
  assignments: SolvedAssignment[],
  fatigueRisks: FatigueRisk[],
): { adjusted: SolvedAssignment[]; warnings: string[] } {
  const riskMap = new Map<string, FatigueRisk>();
  for (const risk of fatigueRisks) {
    if (risk.riskLevel === 'high' || risk.riskLevel === 'critical') {
      riskMap.set(risk.employeeId, risk);
    }
  }

  if (riskMap.size === 0) {
    return { adjusted: assignments, warnings: [] };
  }

  const warnings: string[] = [];
  const adjusted = [...assignments];

  // Group assignments by date+position for potential swaps
  const byDatePos = new Map<string, SolvedAssignment[]>();
  for (const a of adjusted) {
    const key = `${a.date}|${a.position}`;
    const list = byDatePos.get(key) || [];
    list.push(a);
    byDatePos.set(key, list);
  }

  for (const a of adjusted) {
    const risk = riskMap.get(a.employeeId);
    if (!risk) continue;

    // Only try to swap peak shifts for fatigued employees
    if (a.shiftType !== 'peak') continue;

    const key = `${a.date}|${a.position}`;
    const sameSlot = byDatePos.get(key) || [];

    // Find a non-fatigued employee on an opener/closer shift to swap with
    const swapCandidate = sameSlot.find(
      (s) =>
        s.employeeId !== a.employeeId &&
        (s.shiftType === 'opener' || s.shiftType === 'closer') &&
        !riskMap.has(s.employeeId),
    );

    if (swapCandidate) {
      // Swap shift types, times, and costs
      const tempType = a.shiftType;
      const tempStart = a.startTime;
      const tempEnd = a.endTime;
      const tempHours = a.hours;

      a.shiftType = swapCandidate.shiftType;
      a.startTime = swapCandidate.startTime;
      a.endTime = swapCandidate.endTime;
      a.hours = swapCandidate.hours;
      a.cost = Math.round(a.hours * (a.cost / tempHours) * 100) / 100;

      swapCandidate.shiftType = tempType;
      swapCandidate.startTime = tempStart;
      swapCandidate.endTime = tempEnd;
      swapCandidate.hours = tempHours;
      swapCandidate.cost =
        Math.round(tempHours * (swapCandidate.cost / swapCandidate.hours) * 100) / 100;

      warnings.push(
        `Swapped ${a.employeeName} from peak to ${a.shiftType} on ${a.date} (fatigue risk: ${risk.riskLevel})`,
      );
    } else {
      warnings.push(
        `${a.employeeName} has ${risk.riskLevel} fatigue risk on ${a.date} peak shift but no swap available`,
      );
    }
  }

  return { adjusted, warnings };
}
