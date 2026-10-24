/**
 * Schedule Service — core scheduling business logic.
 * Manages shift CRUD, conflict detection, and schedule lifecycle.
 */
import type { Schedule, Shift, ShiftTemplate, ShiftSlot } from '$lib/types/Schedule';
import type { Employee, StaffRole } from '$lib/types/Employee';
import type { StaffingConfig } from '$lib/types/Location';
import { calculateShiftHours, calculateShiftCost, wouldTriggerOvertime, calculateOvertimeHours, calculateRequiredStaff, getEffectiveFloor } from '$lib/utils/labor-math';
import { getWeekDates } from '$lib/utils/date';

export interface ShiftConflict {
  type: 'double_booked' | 'unavailable' | 'overtime' | 'missing_role' | 'insufficient_break' | 'below_floor';
  severity: 'error' | 'warning';
  message: string;
  shiftId?: string;
  employeeId?: string;
  role?: StaffRole;
  date?: string;
}

export interface ScheduleSummary {
  totalShifts: number;
  totalHours: number;
  totalLaborCost: number;
  overtimeHours: number;
  overtimeCost: number;
  conflicts: ShiftConflict[];
  coverageByRole: RoleCoverage[];
}

export interface RoleCoverage {
  role: StaffRole;
  date: string;
  scheduled: number;
  minimum: number;
  isBelowFloor: boolean;
}

/** Add a shift to a schedule, returning conflicts if any */
export function addShift(
  schedule: Schedule,
  shift: Omit<Shift, '_id' | 'scheduleId' | 'laborCost' | 'isOvertimeShift' | 'createdAt' | 'breaksTaken'>,
  employee: Employee,
  allScheduleShifts: Shift[],
): { shift: Shift; conflicts: ShiftConflict[] } {
  const conflicts: ShiftConflict[] = [];
  const shiftId = crypto.randomUUID();
  const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.breakMinutes);

  // Check: employee available on this day
  const dayOfWeek = new Date(shift.date + 'T00:00:00').getDay();
  const dayAvail = employee.availability[dayOfWeek];
  if (dayAvail && !dayAvail.isAvailable) {
    conflicts.push({
      type: 'unavailable',
      severity: 'error',
      message: `${employee.firstName} ${employee.lastName} is not available on ${shift.date}`,
      shiftId,
      employeeId: employee._id,
    });
  }

  // Check: not double-booked (same employee, same date, overlapping times)
  const employeeShiftsOnDate = allScheduleShifts.filter(
    s => s.employeeId === shift.employeeId && s.date === shift.date
  );
  for (const existing of employeeShiftsOnDate) {
    if (timesOverlap(shift.startTime, shift.endTime, existing.startTime, existing.endTime)) {
      conflicts.push({
        type: 'double_booked',
        severity: 'error',
        message: `${employee.firstName} ${employee.lastName} already has a shift from ${existing.startTime}-${existing.endTime} on ${shift.date}`,
        shiftId,
        employeeId: employee._id,
      });
    }
  }

  // Check: overtime
  const weeklyHours = calculateWeeklyHours(shift.employeeId, allScheduleShifts);
  const isOvertime = wouldTriggerOvertime(weeklyHours, hours);
  if (isOvertime) {
    conflicts.push({
      type: 'overtime',
      severity: 'warning',
      message: `${employee.firstName} ${employee.lastName} will hit ${(weeklyHours + hours).toFixed(1)} hours this week (overtime after 40)`,
      shiftId,
      employeeId: employee._id,
    });
  }

  // Check: minimum break between shifts (10 hours)
  const MIN_HOURS_BETWEEN_SHIFTS = 10;
  for (const existing of allScheduleShifts.filter(s => s.employeeId === shift.employeeId)) {
    const gap = calculateGapHours(existing, shift);
    if (gap !== null && gap < MIN_HOURS_BETWEEN_SHIFTS && gap >= 0) {
      conflicts.push({
        type: 'insufficient_break',
        severity: 'warning',
        message: `Only ${gap.toFixed(1)} hours between shifts for ${employee.firstName} (minimum ${MIN_HOURS_BETWEEN_SHIFTS})`,
        shiftId,
        employeeId: employee._id,
      });
    }
  }

  // Check: time-off requests
  const hasTimeOff = employee.timeOffRequests.some(
    tor => tor.status === 'approved' && shift.date >= tor.startDate && shift.date <= tor.endDate
  );
  if (hasTimeOff) {
    conflicts.push({
      type: 'unavailable',
      severity: 'error',
      message: `${employee.firstName} ${employee.lastName} has approved time off on ${shift.date}`,
      shiftId,
      employeeId: employee._id,
    });
  }

  const { overtimeHours } = calculateOvertimeHours(weeklyHours, hours);
  const laborCost = calculateShiftCost(
    shift.startTime, shift.endTime, shift.breakMinutes,
    employee.hourlyRate, isOvertime, employee.overtimeRate / employee.hourlyRate
  );

  const newShift: Shift = {
    _id: shiftId,
    scheduleId: schedule._id,
    employeeId: shift.employeeId,
    locationId: shift.locationId,
    role: shift.role,
    date: shift.date,
    startTime: shift.startTime,
    endTime: shift.endTime,
    breakMinutes: shift.breakMinutes,
    breaksTaken: [],
    status: 'scheduled',
    laborCost,
    isOvertimeShift: isOvertime,
    notes: shift.notes,
    createdAt: new Date().toISOString(),
  };

  return { shift: newShift, conflicts };
}

/** Calculate total weekly hours for an employee across all shifts */
export function calculateWeeklyHours(employeeId: string, shifts: Shift[]): number {
  return shifts
    .filter(s => s.employeeId === employeeId)
    .reduce((total, s) => total + calculateShiftHours(s.startTime, s.endTime, s.breakMinutes), 0);
}

/** Check if two time ranges overlap */
function timesOverlap(start1: string, end1: string, start2: string, end2: string): boolean {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  let s1 = toMin(start1), e1 = toMin(end1);
  let s2 = toMin(start2), e2 = toMin(end2);
  // Handle overnight
  if (e1 <= s1) e1 += 24 * 60;
  if (e2 <= s2) e2 += 24 * 60;
  return s1 < e2 && s2 < e1;
}

/** Calculate gap in hours between two shifts (for minimum rest check) */
function calculateGapHours(shiftA: Shift, shiftB: { date: string; startTime: string; endTime: string }): number | null {
  const dateA = new Date(shiftA.date + 'T00:00:00');
  const dateB = new Date(shiftB.date + 'T00:00:00');
  const dayDiff = (dateB.getTime() - dateA.getTime()) / (1000 * 60 * 60 * 24);

  if (Math.abs(dayDiff) > 1) return null; // Too far apart to matter

  const [endH, endM] = shiftA.endTime.split(':').map(Number);
  const [startH, startM] = shiftB.startTime.split(':').map(Number);

  let endMinutes = endH * 60 + endM + (dayDiff < 0 ? -24 * 60 : 0);
  let startMinutes = startH * 60 + startM + (dayDiff > 0 ? 24 * 60 : 0);

  if (shiftA.endTime <= shiftA.startTime) endMinutes += 24 * 60; // overnight shift A

  return (startMinutes - endMinutes) / 60;
}

/** Generate a schedule summary with conflict detection */
export function summarizeSchedule(
  schedule: Schedule,
  shifts: Shift[],
  employees: Employee[],
  staffingConfig?: StaffingConfig,
): ScheduleSummary {
  const conflicts: ShiftConflict[] = [];
  let totalHours = 0;
  let totalLaborCost = 0;
  let overtimeHours = 0;
  let overtimeCost = 0;

  // Per-employee weekly hours tracking
  const employeeWeeklyHours: Record<string, number> = {};

  for (const shift of shifts) {
    const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.breakMinutes);
    totalHours += hours;
    totalLaborCost += shift.laborCost;

    if (!employeeWeeklyHours[shift.employeeId]) employeeWeeklyHours[shift.employeeId] = 0;
    employeeWeeklyHours[shift.employeeId] += hours;

    if (shift.isOvertimeShift) {
      overtimeHours += hours;
      // Rough overtime cost estimation
      const emp = employees.find(e => e._id === shift.employeeId);
      if (emp) {
        overtimeCost += hours * (emp.overtimeRate - emp.hourlyRate);
      }
    }
  }

  // Check floor coverage by role per day
  const coverageByRole: RoleCoverage[] = [];
  if (staffingConfig) {
    const weekDates = getWeekDates(schedule.weekStartDate);
    for (const date of weekDates) {
      for (const floor of staffingConfig.minimumsByRole) {
        const scheduled = shifts.filter(s => s.date === date && s.role === floor.role).length;
        const minimum = floor.minOnFloor;
        const isBelowFloor = scheduled < minimum;

        coverageByRole.push({ role: floor.role, date, scheduled, minimum, isBelowFloor });

        if (isBelowFloor) {
          conflicts.push({
            type: 'below_floor',
            severity: 'warning',
            message: `${floor.role} has ${scheduled}/${minimum} minimum on ${date}`,
            role: floor.role,
            date,
          });
        }
      }
    }
  }

  return {
    totalShifts: shifts.length,
    totalHours,
    totalLaborCost,
    overtimeHours,
    overtimeCost,
    conflicts,
    coverageByRole,
  };
}

/** Apply a shift template to a schedule day, returning suggested shifts */
export function applyTemplate(
  template: ShiftTemplate,
  date: string,
  locationId: string,
  scheduleId: string,
  availableEmployees: Employee[],
): Shift[] {
  const suggestedShifts: Shift[] = [];

  for (const slot of template.shiftSlots) {
    // Find available employees for this role
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    const candidates = availableEmployees.filter(emp => {
      const hasRole = emp.roles.includes(slot.role);
      const isAvailable = !emp.availability[dayOfWeek] || emp.availability[dayOfWeek].isAvailable;
      const hasCerts = !slot.requiredCertifications ||
        slot.requiredCertifications.every(c => emp.certifications.includes(c));
      return hasRole && isAvailable && hasCerts;
    });

    // Assign up to slot.count employees
    for (let i = 0; i < Math.min(slot.count, candidates.length); i++) {
      suggestedShifts.push({
        _id: crypto.randomUUID(),
        scheduleId,
        employeeId: candidates[i]._id,
        locationId,
        role: slot.role,
        date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        breakMinutes: calculateShiftHours(slot.startTime, slot.endTime, 0) > 5 ? 30 : 0,
        breaksTaken: [],
        status: 'scheduled',
        laborCost: calculateShiftCost(slot.startTime, slot.endTime, 0, candidates[i].hourlyRate, false),
        isOvertimeShift: false,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return suggestedShifts;
}
