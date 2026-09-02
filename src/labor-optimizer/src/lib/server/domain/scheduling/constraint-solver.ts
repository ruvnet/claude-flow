/**
 * Constraint Solver — generates optimal schedules from demand forecasts.
 *
 * Algorithm: Greedy heuristic with constraint propagation
 * 1. For each day, determine required staff per role from forecast
 * 2. For each open slot, score all eligible employees
 * 3. Assign highest-scoring candidate, update constraints
 * 4. Repeat until all slots filled or no candidates remain
 *
 * Scoring factors: cost, overtime risk, availability preference,
 * fairness (hours balance), skill match, seniority
 */
import type { Schedule, Shift, ShiftSlot } from '$lib/types/Schedule';
import type { Employee, StaffRole } from '$lib/types/Employee';
import type { DemandForecast, HourlyDemand, StaffingRequirement } from '$lib/types/DemandForecast';
import type { StaffingConfig } from '$lib/types/Location';
import {
  calculateShiftHours,
  calculateShiftCost,
  wouldTriggerOvertime,
  calculateRequiredStaff,
  getEffectiveFloor,
} from '$lib/utils/labor-math';

export interface OptimizationConfig {
  locationId: string;
  scheduleId: string;
  weekStartDate: string;
  laborBudgetPct: number;
  projectedWeeklyRevenue: number;
  staffingConfig: StaffingConfig;
  maxOvertimeHoursPerEmployee: number;
  fairnessWeight: number; // 0-1, how much to prioritize equal hour distribution
  costWeight: number;     // 0-1, how much to prioritize lower cost
}

export interface OptimizationResult {
  shifts: Shift[];
  score: number;           // 0-100 overall optimization quality
  totalHours: number;
  totalCost: number;
  laborCostPct: number;
  warnings: OptimizationWarning[];
  unfilledSlots: UnfilledSlot[];
  stats: OptimizationStats;
}

export interface OptimizationWarning {
  type: 'over_budget' | 'understaffed' | 'overtime_heavy' | 'unfair_distribution';
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface UnfilledSlot {
  date: string;
  role: StaffRole;
  startTime: string;
  endTime: string;
  reason: string;
}

export interface OptimizationStats {
  totalSlotsToFill: number;
  slotsFilled: number;
  slotsUnfilled: number;
  candidatesEvaluated: number;
  overtimeShifts: number;
  avgEmployeeHours: number;
  hoursStdDev: number;
}

interface CandidateScore {
  employee: Employee;
  score: number;
  breakdown: {
    costScore: number;
    overtimeScore: number;
    preferenceScore: number;
    fairnessScore: number;
    skillScore: number;
    seniorityScore: number;
  };
  estimatedCost: number;
  wouldBeOvertime: boolean;
}

/** Run the full constraint solver to generate an optimized schedule */
export function optimizeSchedule(
  forecasts: DemandForecast[],
  employees: Employee[],
  config: OptimizationConfig,
  existingShifts: Shift[] = [],
): OptimizationResult {
  const warnings: OptimizationWarning[] = [];
  const unfilledSlots: UnfilledSlot[] = [];
  const generatedShifts: Shift[] = [...existingShifts];

  // Track weekly hours per employee across the optimization
  const employeeWeeklyHours: Record<string, number> = {};
  for (const emp of employees) {
    employeeWeeklyHours[emp._id] = 0;
  }
  // Account for existing shifts
  for (const shift of existingShifts) {
    if (!employeeWeeklyHours[shift.employeeId]) employeeWeeklyHours[shift.employeeId] = 0;
    employeeWeeklyHours[shift.employeeId] += calculateShiftHours(shift.startTime, shift.endTime, shift.breakMinutes);
  }

  let candidatesEvaluated = 0;
  let totalSlotsToFill = 0;

  // Process each day's forecast
  for (const forecast of forecasts) {
    const date = forecast.date;
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();

    // Determine staffing needs from hourly breakdown
    // Aggregate hourly requirements into shift blocks
    const shiftBlocks = buildShiftBlocks(forecast, config.staffingConfig);

    for (const block of shiftBlocks) {
      totalSlotsToFill += block.count;

      for (let i = 0; i < block.count; i++) {
        // Find best candidate for this slot
        const candidates = scoreAllCandidates(
          employees,
          block,
          date,
          dayOfWeek,
          employeeWeeklyHours,
          generatedShifts,
          config,
        );
        candidatesEvaluated += candidates.length;

        if (candidates.length === 0) {
          unfilledSlots.push({
            date,
            role: block.role,
            startTime: block.startTime,
            endTime: block.endTime,
            reason: 'No eligible employees available',
          });
          continue;
        }

        // Pick highest scoring candidate
        const best = candidates[0];

        // Calculate break
        const shiftHours = calculateShiftHours(block.startTime, block.endTime, 0);
        const breakMinutes = shiftHours > 6 ? 30 : shiftHours > 4 ? 15 : 0;

        const laborCost = calculateShiftCost(
          block.startTime, block.endTime, breakMinutes,
          best.employee.hourlyRate, best.wouldBeOvertime,
          best.employee.overtimeRate / best.employee.hourlyRate,
        );

        const shift: Shift = {
          _id: crypto.randomUUID(),
          scheduleId: config.scheduleId,
          employeeId: best.employee._id,
          locationId: config.locationId,
          role: block.role,
          date,
          startTime: block.startTime,
          endTime: block.endTime,
          breakMinutes,
          breaksTaken: [],
          status: 'scheduled',
          laborCost,
          isOvertimeShift: best.wouldBeOvertime,
          createdAt: new Date().toISOString(),
        };

        generatedShifts.push(shift);
        employeeWeeklyHours[best.employee._id] += calculateShiftHours(block.startTime, block.endTime, breakMinutes);
      }
    }
  }

  // Calculate totals
  const newShifts = generatedShifts.filter(s => !existingShifts.find(e => e._id === s._id));
  const allShifts = generatedShifts;
  let totalHours = 0;
  let totalCost = 0;
  let overtimeShifts = 0;

  for (const shift of allShifts) {
    totalHours += calculateShiftHours(shift.startTime, shift.endTime, shift.breakMinutes);
    totalCost += shift.laborCost;
    if (shift.isOvertimeShift) overtimeShifts++;
  }

  const laborCostPct = config.projectedWeeklyRevenue > 0 ? totalCost / config.projectedWeeklyRevenue : 0;

  // Generate warnings
  if (laborCostPct > config.laborBudgetPct + 0.03) {
    warnings.push({
      type: 'over_budget',
      message: `Labor cost ${(laborCostPct * 100).toFixed(1)}% exceeds target ${(config.laborBudgetPct * 100).toFixed(0)}% by ${((laborCostPct - config.laborBudgetPct) * 100).toFixed(1)}%`,
      severity: 'critical',
    });
  } else if (laborCostPct > config.laborBudgetPct) {
    warnings.push({
      type: 'over_budget',
      message: `Labor cost ${(laborCostPct * 100).toFixed(1)}% slightly above target ${(config.laborBudgetPct * 100).toFixed(0)}%`,
      severity: 'warning',
    });
  }

  if (unfilledSlots.length > 0) {
    warnings.push({
      type: 'understaffed',
      message: `${unfilledSlots.length} shift slot${unfilledSlots.length !== 1 ? 's' : ''} could not be filled`,
      severity: unfilledSlots.length > 5 ? 'critical' : 'warning',
    });
  }

  if (overtimeShifts > allShifts.length * 0.15) {
    warnings.push({
      type: 'overtime_heavy',
      message: `${overtimeShifts} shifts (${Math.round(overtimeShifts / allShifts.length * 100)}%) are overtime — consider hiring`,
      severity: 'warning',
    });
  }

  // Fairness check
  const hoursValues = Object.values(employeeWeeklyHours).filter(h => h > 0);
  const avgHours = hoursValues.length > 0 ? hoursValues.reduce((a, b) => a + b, 0) / hoursValues.length : 0;
  const variance = hoursValues.length > 0
    ? Math.sqrt(hoursValues.reduce((sum, h) => sum + Math.pow(h - avgHours, 2), 0) / hoursValues.length)
    : 0;

  if (variance > 8) {
    warnings.push({
      type: 'unfair_distribution',
      message: `Hours vary widely (std dev: ${variance.toFixed(1)}h) — some employees may feel over/under-scheduled`,
      severity: 'info',
    });
  }

  // Calculate optimization score (0-100)
  const slotFillRate = totalSlotsToFill > 0 ? (totalSlotsToFill - unfilledSlots.length) / totalSlotsToFill : 1;
  const budgetScore = laborCostPct <= config.laborBudgetPct ? 1 : Math.max(0, 1 - (laborCostPct - config.laborBudgetPct) * 10);
  const fairnessScore = Math.max(0, 1 - variance / 20);
  const overtimeScore = allShifts.length > 0 ? 1 - overtimeShifts / allShifts.length : 1;

  const score = Math.round(
    (slotFillRate * 30 + budgetScore * 30 + fairnessScore * 20 + overtimeScore * 20)
  );

  return {
    shifts: newShifts,
    score,
    totalHours,
    totalCost,
    laborCostPct,
    warnings,
    unfilledSlots,
    stats: {
      totalSlotsToFill,
      slotsFilled: totalSlotsToFill - unfilledSlots.length,
      slotsUnfilled: unfilledSlots.length,
      candidatesEvaluated,
      overtimeShifts,
      avgEmployeeHours: avgHours,
      hoursStdDev: variance,
    },
  };
}

/** Build shift blocks from hourly demand — merges adjacent hours into shifts */
function buildShiftBlocks(
  forecast: DemandForecast,
  staffingConfig: StaffingConfig,
): { role: StaffRole; startTime: string; endTime: string; count: number }[] {
  const blocks: { role: StaffRole; startTime: string; endTime: string; count: number }[] = [];
  const roles: StaffRole[] = ['server', 'bartender', 'host', 'busser', 'food_runner', 'line_cook', 'prep_cook', 'dishwasher'];

  // Calculate peak demand per role
  for (const role of roles) {
    // Find lunch peak demand
    const lunchHours = forecast.hourlyBreakdown.filter(h => h.hour >= 11 && h.hour < 15);
    const dinnerHours = forecast.hourlyBreakdown.filter(h => h.hour >= 17 && h.hour < 22);

    const lunchPeakReq = Math.max(
      ...lunchHours.map(h => {
        const req = h.requiredStaff.find(r => r.role === role);
        return req?.optimalCount || 0;
      }),
      0,
    );

    const dinnerPeakReq = Math.max(
      ...dinnerHours.map(h => {
        const req = h.requiredStaff.find(r => r.role === role);
        return req?.optimalCount || 0;
      }),
      0,
    );

    // Get floor minimum
    const lunchFloor = getEffectiveFloor(staffingConfig, role, 'lunch');
    const dinnerFloor = getEffectiveFloor(staffingConfig, role, 'dinner');

    const lunchCount = Math.max(lunchFloor, lunchPeakReq);
    const dinnerCount = Math.max(dinnerFloor, dinnerPeakReq);

    // Determine how many AM vs PM vs mid shifts
    if (lunchCount > 0 || dinnerCount > 0) {
      // Staff that work both: mid shifts
      const midCount = Math.min(lunchCount, dinnerCount);
      const amOnlyCount = Math.max(0, lunchCount - midCount);
      const pmOnlyCount = Math.max(0, dinnerCount - midCount);

      if (midCount > 0) {
        blocks.push({ role, startTime: '11:00', endTime: '19:00', count: midCount });
      }
      if (amOnlyCount > 0) {
        blocks.push({ role, startTime: '10:00', endTime: '16:00', count: amOnlyCount });
      }
      if (pmOnlyCount > 0) {
        blocks.push({ role, startTime: '16:00', endTime: '23:00', count: pmOnlyCount });
      }
    }
  }

  return blocks;
}

/** Score all eligible candidates for a shift slot */
function scoreAllCandidates(
  employees: Employee[],
  slot: { role: StaffRole; startTime: string; endTime: string },
  date: string,
  dayOfWeek: number,
  weeklyHours: Record<string, number>,
  existingShifts: Shift[],
  config: OptimizationConfig,
): CandidateScore[] {
  const shiftHours = calculateShiftHours(slot.startTime, slot.endTime, 0);
  const avgHours = Object.values(weeklyHours).filter(h => h > 0);
  const avgWeeklyHours = avgHours.length > 0 ? avgHours.reduce((a, b) => a + b, 0) / avgHours.length : 0;

  const candidates: CandidateScore[] = [];

  for (const emp of employees) {
    // Hard constraint checks — skip if fails
    if (!emp.isActive) continue;
    if (!emp.roles.includes(slot.role)) continue;

    // Check availability
    const dayAvail = emp.availability[dayOfWeek];
    if (dayAvail && dayAvail.isAvailable === false) continue;

    // Check time-off
    const hasTimeOff = emp.timeOffRequests.some(
      tor => tor.status === 'approved' && date >= tor.startDate && date <= tor.endDate,
    );
    if (hasTimeOff) continue;

    // Check not double-booked
    const isBooked = existingShifts.some(
      s => s.employeeId === emp._id && s.date === date && timesOverlap(slot.startTime, slot.endTime, s.startTime, s.endTime),
    );
    if (isBooked) continue;

    // Check max hours
    const currentHours = weeklyHours[emp._id] || 0;
    if (currentHours + shiftHours > emp.maxHoursPerWeek) continue;

    // Check location eligibility
    if (emp.primaryLocationId !== config.locationId &&
        !emp.secondaryLocationIds.includes(config.locationId)) continue;

    // Soft scoring
    const isOvertime = wouldTriggerOvertime(currentHours, shiftHours);
    const cost = calculateShiftCost(
      slot.startTime, slot.endTime, 0,
      emp.hourlyRate, isOvertime, emp.overtimeRate / emp.hourlyRate,
    );

    // Cost score: cheaper = higher score (normalized 0-1)
    const maxRate = 50; // $50/hr cap for normalization
    const costScore = 1 - Math.min(emp.hourlyRate / maxRate, 1);

    // Overtime score: penalize overtime assignments
    const overtimeScore = isOvertime ? 0.2 : 1.0;

    // Preference score: preferred > available > just eligible
    let preferenceScore = 0.5;
    if (dayAvail) {
      if (dayAvail.preference === 'preferred') preferenceScore = 1.0;
      else if (dayAvail.preference === 'available') preferenceScore = 0.7;
    }

    // Fairness score: employees with fewer hours get priority
    const hoursDiff = avgWeeklyHours - currentHours;
    const fairnessScore = Math.max(0, Math.min(1, 0.5 + hoursDiff / 20));

    // Skill match: primary role vs cross-trained
    const skillScore = emp.roles[0] === slot.role ? 1.0 : 0.7;

    // Seniority bonus (slight preference for experienced staff)
    const seniorityScore = Math.min(1, emp.seniority / 10);

    // Weighted total
    const score =
      costScore * config.costWeight * 25 +
      overtimeScore * 20 +
      preferenceScore * 15 +
      fairnessScore * config.fairnessWeight * 20 +
      skillScore * 10 +
      seniorityScore * 10;

    candidates.push({
      employee: emp,
      score,
      breakdown: { costScore, overtimeScore, preferenceScore, fairnessScore, skillScore, seniorityScore },
      estimatedCost: cost,
      wouldBeOvertime: isOvertime,
    });
  }

  // Sort by score descending
  return candidates.sort((a, b) => b.score - a.score);
}

function timesOverlap(s1: string, e1: string, s2: string, e2: string): boolean {
  const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  let a1 = toMin(s1), b1 = toMin(e1), a2 = toMin(s2), b2 = toMin(e2);
  if (b1 <= a1) b1 += 1440;
  if (b2 <= a2) b2 += 1440;
  return a1 < b2 && a2 < b1;
}
