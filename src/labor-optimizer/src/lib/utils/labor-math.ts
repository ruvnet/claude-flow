/**
 * Core labor cost calculation utilities for restaurant operations.
 */

/** Calculate labor cost percentage: labor / revenue */
export function laborCostPct(laborCost: number, revenue: number): number {
  if (revenue === 0) return 0;
  return laborCost / revenue;
}

/** Covers Per Labor Hour — key restaurant efficiency metric */
export function coversPerLaborHour(covers: number, laborHours: number): number {
  if (laborHours === 0) return 0;
  return covers / laborHours;
}

/** Revenue Per Labor Hour */
export function revenuePerLaborHour(revenue: number, laborHours: number): number {
  if (laborHours === 0) return 0;
  return revenue / laborHours;
}

/** Calculate hours between two time strings (HH:MM format), minus break minutes */
export function calculateShiftHours(startTime: string, endTime: string, breakMinutes: number = 0): number {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  let startMinutes = startH * 60 + startM;
  let endMinutes = endH * 60 + endM;

  // Handle overnight shifts (e.g., 22:00 - 02:00)
  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  const totalMinutes = endMinutes - startMinutes - breakMinutes;
  return Math.max(0, totalMinutes / 60);
}

/** Calculate labor cost for a single shift */
export function calculateShiftCost(
  startTime: string,
  endTime: string,
  breakMinutes: number,
  hourlyRate: number,
  isOvertime: boolean,
  overtimeMultiplier: number = 1.5
): number {
  const hours = calculateShiftHours(startTime, endTime, breakMinutes);
  const rate = isOvertime ? hourlyRate * overtimeMultiplier : hourlyRate;
  return hours * rate;
}

/** Check if employee will hit overtime with this shift (>40hrs/week) */
export function wouldTriggerOvertime(
  currentWeeklyHours: number,
  shiftHours: number,
  weeklyOvertimeThreshold: number = 40
): boolean {
  return (currentWeeklyHours + shiftHours) > weeklyOvertimeThreshold;
}

/** Calculate overtime hours from a shift that crosses the threshold */
export function calculateOvertimeHours(
  currentWeeklyHours: number,
  shiftHours: number,
  weeklyOvertimeThreshold: number = 40
): { regularHours: number; overtimeHours: number } {
  const totalAfter = currentWeeklyHours + shiftHours;

  if (totalAfter <= weeklyOvertimeThreshold) {
    return { regularHours: shiftHours, overtimeHours: 0 };
  }

  if (currentWeeklyHours >= weeklyOvertimeThreshold) {
    return { regularHours: 0, overtimeHours: shiftHours };
  }

  const regularHours = weeklyOvertimeThreshold - currentWeeklyHours;
  const overtimeHours = shiftHours - regularHours;
  return { regularHours, overtimeHours };
}

/**
 * Calculate required staff for a role given forecasted covers,
 * applying the floor minimum first, then the demand ratio.
 *
 * Logic: required = max(floor, ceil(covers / coversPerStaff))
 * Then capped at maxOnFloor if set.
 */
export function calculateRequiredStaff(
  forecastedCovers: number,
  floorMinimum: number,
  coversPerStaff: number,
  maxOnFloor?: number,
): number {
  const demandBased = coversPerStaff > 0 ? Math.ceil(forecastedCovers / coversPerStaff) : floorMinimum;
  const required = Math.max(floorMinimum, demandBased);
  return maxOnFloor ? Math.min(required, maxOnFloor) : required;
}

import type { StaffingConfig } from '$lib/types/Location';
import type { StaffRole } from '$lib/types/Employee';

/** Default staffing config for a new restaurant/bar location */
export function getDefaultStaffingConfig(): StaffingConfig {
  return {
    minimumsByRole: [
      { role: 'server', minOnFloor: 2, daypartOverrides: [
        { daypart: 'lunch', minOnFloor: 2 },
        { daypart: 'dinner', minOnFloor: 3 },
      ]},
      { role: 'bartender', minOnFloor: 1, daypartOverrides: [
        { daypart: 'dinner', minOnFloor: 2 },
        { daypart: 'late_night', minOnFloor: 2 },
      ]},
      { role: 'host', minOnFloor: 1 },
      { role: 'busser', minOnFloor: 1 },
      { role: 'food_runner', minOnFloor: 1 },
      { role: 'line_cook', minOnFloor: 2, daypartOverrides: [
        { daypart: 'dinner', minOnFloor: 3 },
      ]},
      { role: 'prep_cook', minOnFloor: 1 },
      { role: 'dishwasher', minOnFloor: 1 },
    ],
    ratiosByRole: [
      { role: 'server', coversPerStaff: 20, maxOnFloor: 15 },
      { role: 'bartender', coversPerStaff: 35, maxOnFloor: 6 },
      { role: 'host', coversPerStaff: 100, maxOnFloor: 3 },
      { role: 'busser', coversPerStaff: 35, maxOnFloor: 8 },
      { role: 'food_runner', coversPerStaff: 45, maxOnFloor: 6 },
      { role: 'line_cook', coversPerStaff: 30, maxOnFloor: 10 },
      { role: 'prep_cook', coversPerStaff: 80, maxOnFloor: 4 },
      { role: 'dishwasher', coversPerStaff: 70, maxOnFloor: 4 },
    ],
  };
}

/** Get the effective floor for a role at a specific daypart */
export function getEffectiveFloor(
  config: StaffingConfig,
  role: StaffRole,
  daypart?: string,
): number {
  const floor = config.minimumsByRole.find(f => f.role === role);
  if (!floor) return 0;

  if (daypart && floor.daypartOverrides) {
    const override = floor.daypartOverrides.find(o => o.daypart === daypart);
    if (override) return override.minOnFloor;
  }

  return floor.minOnFloor;
}

/** Format currency for display */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

/** Format percentage for display */
export function formatPct(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}
