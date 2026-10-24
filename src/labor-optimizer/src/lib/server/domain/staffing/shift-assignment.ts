/**
 * AI Shift Assignment Engine — assigns employees to shifts from predictive staffing output.
 */

import { getSupabase, getSupabaseService } from '$lib/server/supabase';
import { getStaffingRange } from './predictive-staffing';
import { getAllPatternsForDay, type ShiftPatternResult } from './shift-patterns';

export interface ShiftAssignment {
  employeeId: string;
  employeeName: string;
  position: string;
  shiftType: 'opener' | 'peak' | 'closer';
  startTime: string;
  endTime: string;
  hours: number;
  cost: number;
  hourlyRate: number;
  isSecondaryPosition: boolean;
}

export interface PositionAssignment {
  position: string;
  shifts: ShiftAssignment[];
  totalCost: number;
  totalHours: number;
}

export interface DayAssignment {
  date: string;
  dayOfWeek: number;
  positions: PositionAssignment[];
}

export interface OvertimeWarning {
  employeeId: string;
  employeeName: string;
  scheduledHours: number;
  maxHours: number;
  remainingHours: number;
}

export interface UnfilledShift {
  date: string;
  position: string;
  shiftType: 'opener' | 'peak' | 'closer';
  startTime: string;
  endTime: string;
  reason: string;
}

export interface WeeklyScheduleAssignment {
  locationId: string;
  weekStart: string;
  days: DayAssignment[];
  totalCost: number;
  totalHours: number;
  overtimeWarnings: OvertimeWarning[];
  unfilledShifts: UnfilledShift[];
}


interface EmployeeRow {
  id: string;
  name: string;
  position: string;
  secondary_positions: string[] | null;
  hourly_rate: number;
  max_hours_per_week: number;
  hire_date: string;
  availability: Record<string, AvailabilitySlot | null> | null;
  is_active: boolean;
}

interface AvailabilitySlot { start: string; end: string; }
interface HoursLogRow { employee_id: string; hours: number; }
const OVERTIME_THRESHOLD = 40;

/** Parse "4:00 PM" or "16:00" into fractional hours from midnight. */
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

/** Convert fractional hours to "HH:MM" 24-hour format. */
function hoursToTime(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Compute shift duration in hours. */
function shiftDuration(startStr: string, endStr: string): number {
  const s = parseTimeToHours(startStr);
  const e = parseTimeToHours(endStr);
  return e > s ? e - s : 0;
}

/** Check if a shift time window fits within an availability window. */
function fitsAvailability(
  shiftStart: string,
  shiftEnd: string,
  avail: AvailabilitySlot,
): boolean {
  const ss = parseTimeToHours(shiftStart);
  const se = parseTimeToHours(shiftEnd);
  const as = parseTimeToHours(avail.start);
  const ae = parseTimeToHours(avail.end);
  return ss >= as && se <= ae;
}

/** Map DashboardPosition to a comparable key for employee positions. */
function normalizePosition(pos: string): string {
  return pos.toLowerCase().replace(/\s+/g, '_');
}

/** Check if an employee's position matches a DashboardPosition. */
function positionMatches(employeePos: string, dashboardPos: string): boolean {
  const norm = normalizePosition(dashboardPos);
  const empNorm = normalizePosition(employeePos);
  if (empNorm === norm) return true;
  // Plural/singular and alias variations
  const aliases: Record<string, string[]> = {
    support: ['support', 'busser', 'food_runner', 'bar_back'],
    line_cooks: ['line_cook', 'line_cooks'],
    prep_cooks: ['prep_cook', 'prep_cooks'],
    dishwashers: ['dishwasher', 'dishwashers'],
  };
  return (aliases[norm] || [norm]).includes(empNorm);
}

/** JS day of week (0=Sun) to availability key (0=Mon..6=Sun). */
function jsToAvailKey(jsDow: number): string {
  // availability keys: 0=Mon, 1=Tue, ..., 5=Sat, 6=Sun
  return String(jsDow === 0 ? 6 : jsDow - 1);
}

async function loadActiveEmployees(locationId: string): Promise<EmployeeRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('employees')
    .select('id, name, position, secondary_positions, hourly_rate, max_hours_per_week, hire_date, availability, is_active')
    .eq('location_id', locationId)
    .eq('is_active', true);

  if (error) {
    console.error('[shift-assignment] Failed to load employees:', error.message);
    return [];
  }
  return (data || []) as EmployeeRow[];
}

async function loadWeekHours(
  locationId: string,
  weekStart: string,
  weekEnd: string,
): Promise<Map<string, number>> {
  const sb = getSupabase();
  const { data } = await sb
    .from('employee_hours_log')
    .select('employee_id, hours')
    .eq('location_id', locationId)
    .gte('business_date', weekStart)
    .lte('business_date', weekEnd);

  const totals = new Map<string, number>();
  for (const row of (data || []) as HoursLogRow[]) {
    const cur = totals.get(row.employee_id) || 0;
    totals.set(row.employee_id, cur + (Number(row.hours) || 0));
  }
  return totals;
}

interface ScoredEmployee {
  employee: EmployeeRow;
  score: number;
  isPrimary: boolean;
}

function scoreEmployee(
  emp: EmployeeRow,
  dashboardPos: string,
  weekHours: number,
  shiftHours: number,
  allRates: number[],
): ScoredEmployee {
  let score = 0;
  const isPrimary = positionMatches(emp.position, dashboardPos);

  // Primary position match: +10
  if (isPrimary) {
    score += 10;
  }

  // Lower hourly rate: +5 (relative to max in pool)
  if (allRates.length > 0) {
    const maxRate = Math.max(...allRates);
    if (maxRate > 0) {
      score += 5 * (1 - emp.hourly_rate / maxRate);
    }
  }

  // Fewer hours scheduled this week: +3 (relative to max)
  const maxWeekHours = emp.max_hours_per_week || OVERTIME_THRESHOLD;
  if (maxWeekHours > 0) {
    score += 3 * (1 - weekHours / maxWeekHours);
  }

  // Under overtime threshold: +2
  if (weekHours + shiftHours <= OVERTIME_THRESHOLD) {
    score += 2;
  }

  // Seniority: +1 per year (capped at 5)
  if (emp.hire_date) {
    const years = (Date.now() - new Date(emp.hire_date).getTime()) / (365.25 * 86400000);
    score += Math.min(5, Math.floor(years));
  }

  return { employee: emp, score, isPrimary };
}

export async function generateShiftAssignments(
  locationId: string,
  weekStartDate: string,
): Promise<WeeklyScheduleAssignment> {
  // Compute week end
  const wsDate = new Date(weekStartDate + 'T12:00:00');
  const weDate = new Date(wsDate);
  weDate.setDate(weDate.getDate() + 6);
  const weekEnd = weDate.toISOString().split('T')[0];

  // Load data in parallel
  const [employees, existingHours, staffingDays] = await Promise.all([
    loadActiveEmployees(locationId),
    loadWeekHours(locationId, weekStartDate, weekEnd),
    getStaffingRange(locationId, weekStartDate, weekEnd),
  ]);

  // Running hours tracker (existing + newly assigned)
  const runningHours = new Map<string, number>();
  for (const emp of employees) {
    runningHours.set(emp.id, existingHours.get(emp.id) || 0);
  }

  const days: DayAssignment[] = [];
  const unfilledShifts: UnfilledShift[] = [];
  let grandTotalCost = 0;
  let grandTotalHours = 0;

  // Cache learned patterns per DOW to avoid repeated DB calls
  const patternCache = new Map<number, Map<string, ShiftPatternResult>>();

  for (const dayRec of staffingDays) {
    const dateObj = new Date(dayRec.date + 'T12:00:00');
    const jsDow = dateObj.getDay();
    const availKey = jsToAvailKey(jsDow);

    // Load learned shift patterns for this DOW (cached)
    if (!patternCache.has(jsDow)) {
      try {
        patternCache.set(jsDow, await getAllPatternsForDay(locationId, jsDow));
      } catch {
        patternCache.set(jsDow, new Map());
      }
    }
    const dayPatterns = patternCache.get(jsDow)!;

    const positionAssignments: PositionAssignment[] = [];

    for (const posRec of dayRec.positions) {
      const shifts: ShiftAssignment[] = [];
      let posCost = 0;
      let posHours = 0;

      // If a learned pattern exists with confidence >= 0.5, override shift times
      const pattern = dayPatterns.get(posRec.position);

      for (const slot of posRec.shifts) {
        let shiftStart = hoursToTime(parseTimeToHours(slot.start));
        let shiftEnd = hoursToTime(parseTimeToHours(slot.end));

        // Override with learned pattern times when available
        if (pattern && pattern.confidence >= 0.5) {
          shiftStart = pattern.avgStartTime;
          shiftEnd = pattern.avgEndTime;
        }
        const hours = shiftDuration(shiftStart, shiftEnd);
        const shiftType = slot.role === 'full' ? 'peak' : slot.role;

        // Assign slot.count employees to this shift
        for (let i = 0; i < slot.count; i++) {
          const eligible = employees.filter((emp) => {
            // Position match (primary or secondary)
            const primaryMatch = positionMatches(emp.position, posRec.position);
            const secondaryMatch = (emp.secondary_positions || []).some(
              (sp) => positionMatches(sp, posRec.position)
            );
            if (!primaryMatch && !secondaryMatch) return false;

            // Availability check — null availability means always available
            if (emp.availability) {
              const avail = emp.availability[availKey];
              if (avail === null) return false; // explicitly unavailable this day
              if (avail && !fitsAvailability(slot.start, slot.end, avail)) return false;
            }

            // Max hours check
            const currentHours = runningHours.get(emp.id) || 0;
            if (currentHours + hours > (emp.max_hours_per_week || OVERTIME_THRESHOLD)) {
              return false;
            }

            // Not already assigned to a different shift on this day+time
            const alreadyAssigned = shifts.some(
              (s) => s.employeeId === emp.id,
            );
            if (alreadyAssigned) return false;

            return true;
          });

          if (eligible.length === 0) {
            unfilledShifts.push({
              date: dayRec.date,
              position: posRec.position,
              shiftType,
              startTime: shiftStart,
              endTime: shiftEnd,
              reason: 'No eligible employees available',
            });
            continue;
          }

          // Score and rank
          const allRates = eligible.map((e) => e.hourly_rate);
          const scored = eligible
            .map((emp) =>
              scoreEmployee(
                emp,
                posRec.position,
                runningHours.get(emp.id) || 0,
                hours,
                allRates,
              ),
            )
            .sort((a, b) => b.score - a.score);

          const best = scored[0];
          const emp = best.employee;
          const cost = Math.round(hours * emp.hourly_rate * 100) / 100;

          shifts.push({
            employeeId: emp.id,
            employeeName: emp.name,
            position: posRec.position,
            shiftType,
            startTime: shiftStart,
            endTime: shiftEnd,
            hours,
            cost,
            hourlyRate: emp.hourly_rate,
            isSecondaryPosition: !best.isPrimary,
          });

          // Update running hours
          runningHours.set(emp.id, (runningHours.get(emp.id) || 0) + hours);
          posCost += cost;
          posHours += hours;
        }
      }

      positionAssignments.push({
        position: posRec.position,
        shifts,
        totalCost: Math.round(posCost * 100) / 100,
        totalHours: Math.round(posHours * 10) / 10,
      });

      grandTotalCost += posCost;
      grandTotalHours += posHours;
    }

    days.push({
      date: dayRec.date,
      dayOfWeek: jsDow,
      positions: positionAssignments,
    });
  }

  // Overtime detection
  const overtimeWarnings: OvertimeWarning[] = [];
  for (const emp of employees) {
    const total = runningHours.get(emp.id) || 0;
    const max = emp.max_hours_per_week || OVERTIME_THRESHOLD;
    if (total > OVERTIME_THRESHOLD * 0.85) {
      overtimeWarnings.push({
        employeeId: emp.id,
        employeeName: `${emp.first_name} ${emp.last_name}`,
        scheduledHours: Math.round(total * 10) / 10,
        maxHours: max,
        remainingHours: Math.round((max - total) * 10) / 10,
      });
    }
  }

  return {
    locationId,
    weekStart: weekStartDate,
    days,
    totalCost: Math.round(grandTotalCost * 100) / 100,
    totalHours: Math.round(grandTotalHours * 10) / 10,
    overtimeWarnings,
    unfilledShifts,
  };
}

export async function saveScheduleAssignment(
  assignment: WeeklyScheduleAssignment,
  confirmedBy: string,
): Promise<{ saved: number; errors: string[] }> {
  const sb = getSupabaseService();
  const errors: string[] = [];
  let saved = 0;
  const now = new Date().toISOString();

  for (const day of assignment.days) {
    for (const pos of day.positions) {
      for (const shift of pos.shifts) {
        const { error } = await sb.from('scheduled_shifts').upsert(
          {
            location_id: assignment.locationId,
            business_date: day.date,
            position: shift.position,
            employee_id: shift.employeeId,
            shift_type: shift.shiftType,
            start_time: shift.startTime,
            end_time: shift.endTime,
            hours: shift.hours,
            cost: shift.cost,
            is_confirmed: true,
            confirmed_by: confirmedBy,
            confirmed_at: now,
          },
          {
            onConflict: 'location_id,business_date,position,employee_id,shift_type',
          },
        );

        if (error) {
          errors.push(`${day.date} ${shift.position} ${shift.employeeName}: ${error.message}`);
        } else {
          saved++;
        }
      }
    }
  }

  return { saved, errors };
}

export async function swapShiftEmployee(
  shiftId: string,
  newEmployeeId: string,
  swappedBy: string,
): Promise<{ success: boolean; error?: string }> {
  const sb = getSupabaseService();

  // Load the existing shift
  const { data: existing, error: fetchErr } = await sb
    .from('scheduled_shifts')
    .select('*')
    .eq('id', shiftId)
    .maybeSingle();

  if (fetchErr || !existing) {
    return { success: false, error: fetchErr?.message || 'Shift not found' };
  }

  // Load new employee
  const { data: emp, error: empErr } = await sb
    .from('employees')
    .select('id, first_name, last_name, hourly_rate')
    .eq('id', newEmployeeId)
    .eq('is_active', true)
    .maybeSingle();

  if (empErr || !emp) {
    return { success: false, error: empErr?.message || 'Employee not found' };
  }

  const hours = existing.hours || 0;
  const newCost = Math.round(hours * emp.hourly_rate * 100) / 100;
  const now = new Date().toISOString();

  const { error: updateErr } = await sb
    .from('scheduled_shifts')
    .update({
      employee_id: newEmployeeId,
      cost: newCost,
      confirmed_by: swappedBy,
      confirmed_at: now,
    })
    .eq('id', shiftId);

  if (updateErr) {
    return { success: false, error: updateErr.message };
  }

  return { success: true };
}
