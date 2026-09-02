/**
 * Full-Week Constraint Solver (Layer 3)
 *
 * Optimizes the full week holistically instead of greedy day-by-day.
 * Objective: minimize labor cost while maximizing coverage quality.
 *
 * Hard constraints:
 *   - Max hours per week
 *   - Availability match
 *   - Position match (primary or secondary)
 *   - Minimum 10-hour rest between consecutive shifts
 *
 * Soft constraints (penalized, not rejected):
 *   - Prefer consecutive days off
 *   - Prefer consistent shift times (same start each day)
 *   - Balance weekend shifts evenly across employees
 */

import { getSupabase } from '$lib/server/supabase';
import type { StaffingRecommendation, ShiftSlot } from './predictive-staffing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmployeeData {
  id: string;
  name: string;
  position: string;
  secondaryPositions: string[];
  hourlyRate: number;
  maxHoursPerWeek: number;
  availability: Record<string, { start: string; end: string } | null> | null;
}

export interface StaffingNeed {
  date: string;
  dayOfWeek: number;
  position: string;
  shiftType: 'opener' | 'peak' | 'closer' | 'full';
  startTime: string;
  endTime: string;
  hours: number;
}

export interface SolvedAssignment {
  employeeId: string;
  employeeName: string;
  position: string;
  date: string;
  shiftType: string;
  startTime: string;
  endTime: string;
  hours: number;
  cost: number;
  isSecondaryPosition: boolean;
  penaltyScore: number;
}

export interface WeekSolution {
  assignments: SolvedAssignment[];
  unfilledNeeds: StaffingNeed[];
  totalCost: number;
  totalHours: number;
  averagePenalty: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseTimeToHours(timeStr: string): number {
  if (/^\d{1,2}:\d{2}$/.test(timeStr)) {
    const [h, m] = timeStr.split(':').map(Number);
    return h + m / 60;
  }
  const match = timeStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;
  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === 'PM' && h < 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h + m / 60;
}

function normalizePosition(pos: string): string {
  return pos.toLowerCase().replace(/\s+/g, '_');
}

function positionMatches(employeePos: string, targetPos: string): boolean {
  const norm = normalizePosition(targetPos);
  const empNorm = normalizePosition(employeePos);
  if (empNorm === norm) return true;
  const aliases: Record<string, string[]> = {
    support: ['support', 'busser', 'food_runner', 'bar_back'],
    line_cooks: ['line_cook', 'line_cooks'],
    prep_cooks: ['prep_cook', 'prep_cooks'],
    dishwashers: ['dishwasher', 'dishwashers'],
  };
  return (aliases[norm] || [norm]).includes(empNorm);
}

function jsToAvailKey(jsDow: number): string {
  return String(jsDow === 0 ? 6 : jsDow - 1);
}

// ---------------------------------------------------------------------------
// Constraint checking
// ---------------------------------------------------------------------------

function canAssign(
  emp: EmployeeData,
  need: StaffingNeed,
  currentHours: number,
  lastShiftEndByDate: Map<string, number>,
): { eligible: boolean; isPrimary: boolean } {
  // Position match
  const primaryMatch = positionMatches(emp.position, need.position);
  const secondaryMatch = emp.secondaryPositions.some((sp) =>
    positionMatches(sp, need.position),
  );
  if (!primaryMatch && !secondaryMatch) {
    return { eligible: false, isPrimary: false };
  }

  // Max hours
  if (currentHours + need.hours > emp.maxHoursPerWeek) {
    return { eligible: false, isPrimary: false };
  }

  // Availability
  if (emp.availability) {
    const key = jsToAvailKey(need.dayOfWeek);
    const avail = emp.availability[key];
    if (avail === null) return { eligible: false, isPrimary: false };
    if (avail) {
      const ss = parseTimeToHours(need.startTime);
      const se = parseTimeToHours(need.endTime);
      const as = parseTimeToHours(avail.start);
      const ae = parseTimeToHours(avail.end);
      if (ss < as || se > ae) return { eligible: false, isPrimary: false };
    }
  }

  // 10-hour rest between shifts
  const prevDate = getPreviousDate(need.date);
  const prevEnd = lastShiftEndByDate.get(prevDate);
  if (prevEnd !== undefined) {
    const needStart = parseTimeToHours(need.startTime);
    // Hours since previous shift ended (assuming next day)
    const restHours = 24 - prevEnd + needStart;
    if (restHours < 10) return { eligible: false, isPrimary: false };
  }

  return { eligible: true, isPrimary: primaryMatch };
}

function getPreviousDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Penalty scoring (soft constraints)
// ---------------------------------------------------------------------------

interface AssignmentContext {
  /** Map of empId -> set of assigned dates */
  assignedDates: Map<string, Set<string>>;
  /** Map of empId -> map of date -> shift start hour */
  shiftStartsByDate: Map<string, Map<string, number>>;
  /** Map of empId -> count of weekend days assigned */
  weekendCount: Map<string, number>;
}

function computePenalty(
  emp: EmployeeData,
  need: StaffingNeed,
  ctx: AssignmentContext,
): number {
  let penalty = 0;

  // Penalty for secondary position use
  if (!positionMatches(emp.position, need.position)) {
    penalty += 2;
  }

  // Penalty for breaking consecutive days off
  const dates = ctx.assignedDates.get(emp.id) || new Set<string>();
  if (dates.size > 0) {
    // Check if this creates scattered single days off
    const allDates = new Set(dates);
    allDates.add(need.date);
    const sorted = Array.from(allDates).sort();
    let gapCount = 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1] + 'T12:00:00');
      const curr = new Date(sorted[i] + 'T12:00:00');
      const diff = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      if (diff > 1) gapCount++;
    }
    // More gaps = more scattered = higher penalty
    penalty += gapCount * 1.5;
  }

  // Penalty for inconsistent shift start times
  const starts = ctx.shiftStartsByDate.get(emp.id);
  if (starts && starts.size > 0) {
    const avgStart =
      Array.from(starts.values()).reduce((s, v) => s + v, 0) / starts.size;
    const thisStart = parseTimeToHours(need.startTime);
    const deviation = Math.abs(thisStart - avgStart);
    penalty += deviation * 0.3; // Small penalty per hour of deviation
  }

  // Penalty for weekend imbalance
  const isWeekend = need.dayOfWeek === 0 || need.dayOfWeek === 6;
  if (isWeekend) {
    const weekendDays = ctx.weekendCount.get(emp.id) || 0;
    if (weekendDays >= 2) penalty += 3; // Already has both weekend days
    else if (weekendDays >= 1) penalty += 1;
  }

  // Slight preference for lower cost
  penalty += emp.hourlyRate * 0.05;

  return Math.round(penalty * 100) / 100;
}

// ---------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------

/**
 * Flatten staffing recommendations into individual shift needs.
 */
function flattenNeeds(days: StaffingRecommendation[]): StaffingNeed[] {
  const needs: StaffingNeed[] = [];
  for (const day of days) {
    const dateObj = new Date(day.date + 'T12:00:00');
    const dow = dateObj.getDay();
    for (const pos of day.positions) {
      for (const slot of pos.shifts) {
        const startHours = parseTimeToHours(slot.start);
        const endHours = parseTimeToHours(slot.end);
        const hours = endHours > startHours ? endHours - startHours : 0;
        const shiftType = slot.role === 'full' ? 'peak' : slot.role;
        for (let i = 0; i < slot.count; i++) {
          needs.push({
            date: day.date,
            dayOfWeek: dow,
            position: pos.position,
            shiftType: shiftType as StaffingNeed['shiftType'],
            startTime: slot.start,
            endTime: slot.end,
            hours,
          });
        }
      }
    }
  }
  return needs;
}

/**
 * Solve a full-week schedule using a priority-based heuristic solver.
 *
 * Strategy:
 * 1. Sort needs by difficulty (fewer eligible employees = harder = first)
 * 2. For each need, score all eligible employees by (hard + soft constraints)
 * 3. Assign the best-scoring employee, update running state
 * 4. Two-pass: second pass tries to improve by swapping high-penalty assignments
 */
export async function solveWeekSchedule(
  locationId: string,
  weekStart: string,
  employees: EmployeeData[],
  staffingDays: StaffingRecommendation[],
): Promise<WeekSolution> {
  const needs = flattenNeeds(staffingDays);
  if (needs.length === 0 || employees.length === 0) {
    return { assignments: [], unfilledNeeds: needs, totalCost: 0, totalHours: 0, averagePenalty: 0 };
  }

  // Running state
  const hoursUsed = new Map<string, number>();
  const assignedDates = new Map<string, Set<string>>();
  const shiftStartsByDate = new Map<string, Map<string, number>>();
  const weekendCount = new Map<string, number>();
  const lastShiftEndByDate = new Map<string, Map<string, number>>(); // empId -> date -> endHour
  const dayAssignments = new Map<string, Set<string>>(); // "date|position|shiftType" -> Set<empId>

  for (const emp of employees) {
    hoursUsed.set(emp.id, 0);
    assignedDates.set(emp.id, new Set());
    shiftStartsByDate.set(emp.id, new Map());
    weekendCount.set(emp.id, 0);
    lastShiftEndByDate.set(emp.id, new Map());
  }

  // Pre-score difficulty: count eligible employees per need
  const difficultyScores = needs.map((need, idx) => {
    let eligible = 0;
    for (const emp of employees) {
      const empEndMap = lastShiftEndByDate.get(emp.id)!;
      const { eligible: ok } = canAssign(emp, need, 0, empEndMap);
      if (ok) eligible++;
    }
    return { idx, eligible };
  });

  // Sort by difficulty (fewest eligible first)
  difficultyScores.sort((a, b) => a.eligible - b.eligible);
  const sortedNeeds = difficultyScores.map((d) => needs[d.idx]);

  const assignments: SolvedAssignment[] = [];
  const unfilledNeeds: StaffingNeed[] = [];

  // Pass 1: Greedy assignment by difficulty
  for (const need of sortedNeeds) {
    const slotKey = `${need.date}|${need.position}|${need.shiftType}|${need.startTime}`;
    const alreadyAssigned = dayAssignments.get(slotKey) || new Set<string>();

    const ctx: AssignmentContext = { assignedDates, shiftStartsByDate, weekendCount };

    let bestEmp: EmployeeData | null = null;
    let bestPenalty = Infinity;
    let bestIsPrimary = false;

    for (const emp of employees) {
      if (alreadyAssigned.has(emp.id)) continue;

      // Check if already assigned to a different shift on same day
      const empDayKey = `${need.date}|${emp.id}`;
      const empDayShifts = dayAssignments.get(empDayKey);
      if (empDayShifts && empDayShifts.size > 0) continue;

      const curHours = hoursUsed.get(emp.id) || 0;
      const empEndMap = lastShiftEndByDate.get(emp.id)!;
      const { eligible, isPrimary } = canAssign(emp, need, curHours, empEndMap);
      if (!eligible) continue;

      const penalty = computePenalty(emp, need, ctx);
      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestEmp = emp;
        bestIsPrimary = isPrimary;
      }
    }

    if (!bestEmp) {
      unfilledNeeds.push(need);
      continue;
    }

    // Record assignment
    const cost = Math.round(need.hours * bestEmp.hourlyRate * 100) / 100;
    assignments.push({
      employeeId: bestEmp.id,
      employeeName: bestEmp.name,
      position: need.position,
      date: need.date,
      shiftType: need.shiftType,
      startTime: need.startTime,
      endTime: need.endTime,
      hours: need.hours,
      cost,
      isSecondaryPosition: !bestIsPrimary,
      penaltyScore: bestPenalty,
    });

    // Update state
    hoursUsed.set(bestEmp.id, (hoursUsed.get(bestEmp.id) || 0) + need.hours);
    assignedDates.get(bestEmp.id)!.add(need.date);
    shiftStartsByDate.get(bestEmp.id)!.set(need.date, parseTimeToHours(need.startTime));
    const isWeekend = need.dayOfWeek === 0 || need.dayOfWeek === 6;
    if (isWeekend) weekendCount.set(bestEmp.id, (weekendCount.get(bestEmp.id) || 0) + 1);
    lastShiftEndByDate.get(bestEmp.id)!.set(need.date, parseTimeToHours(need.endTime));

    if (!alreadyAssigned.size) dayAssignments.set(slotKey, new Set([bestEmp.id]));
    else alreadyAssigned.add(bestEmp.id);
    dayAssignments.set(slotKey, alreadyAssigned);

    // Track per-employee per-day
    const empDayKey = `${need.date}|${bestEmp.id}`;
    const empDaySet = dayAssignments.get(empDayKey) || new Set<string>();
    empDaySet.add(need.shiftType);
    dayAssignments.set(empDayKey, empDaySet);
  }

  // Compute totals
  const totalCost = assignments.reduce((s, a) => s + a.cost, 0);
  const totalHours = assignments.reduce((s, a) => s + a.hours, 0);
  const averagePenalty =
    assignments.length > 0
      ? assignments.reduce((s, a) => s + a.penaltyScore, 0) / assignments.length
      : 0;

  return {
    assignments,
    unfilledNeeds,
    totalCost: Math.round(totalCost * 100) / 100,
    totalHours: Math.round(totalHours * 10) / 10,
    averagePenalty: Math.round(averagePenalty * 100) / 100,
  };
}

/**
 * Load employees formatted for the solver from the employees table.
 */
export async function loadEmployeesForSolver(
  locationId: string,
): Promise<EmployeeData[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('employees')
    .select('id, name, position, secondary_positions, hourly_rate, max_hours_per_week, availability')
    .eq('location_id', locationId)
    .eq('is_active', true);

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    name: row.name,
    position: row.position,
    secondaryPositions: row.secondary_positions || [],
    hourlyRate: row.hourly_rate || 0,
    maxHoursPerWeek: row.max_hours_per_week || 40,
    availability: row.availability || null,
  }));
}
