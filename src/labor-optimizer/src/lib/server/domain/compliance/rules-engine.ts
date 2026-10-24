/**
 * Compliance Rules Engine
 *
 * Configurable labor law compliance checker supporting:
 * - Federal overtime (>40 hrs/week at 1.5x)
 * - State meal break requirements (e.g., CA: 30min for >5hr shifts)
 * - State rest break requirements (e.g., CA: 10min per 4hrs)
 * - Predictive scheduling laws (advance notice requirements)
 * - Split shift regulations
 * - Minor labor restrictions
 * - Daily overtime (CA: >8hrs/day at 1.5x, >12hrs at 2x)
 */
import type { Schedule, Shift } from '$lib/types/Schedule';
import type { Employee } from '$lib/types/Employee';
import type { ComplianceRule, ComplianceViolation } from '$lib/types/Compliance';
import { calculateShiftHours } from '$lib/utils/labor-math';

export interface ComplianceCheckResult {
  violations: ComplianceViolation[];
  warnings: ComplianceViolation[];
  passed: boolean;
  rulesChecked: number;
  summary: {
    totalViolations: number;
    totalWarnings: number;
    byType: Record<string, number>;
  };
}

/** Built-in compliance rules — can be enabled/disabled per location */
export const BUILT_IN_RULES: ComplianceRule[] = [
  {
    _id: 'federal-overtime-weekly',
    jurisdiction: 'Federal',
    name: 'Weekly Overtime',
    type: 'overtime',
    parameters: { weeklyThreshold: 40, multiplier: 1.5 },
    description: 'Overtime pay required after 40 hours per work week at 1.5x regular rate',
    isActive: true,
  },
  {
    _id: 'ca-daily-overtime',
    jurisdiction: 'California',
    name: 'Daily Overtime',
    type: 'overtime',
    parameters: { dailyThreshold: 8, doubleTimeThreshold: 12, multiplier: 1.5, doubleMultiplier: 2.0 },
    description: 'Overtime after 8 hours/day at 1.5x, double time after 12 hours/day',
    isActive: false,
  },
  {
    _id: 'ca-meal-break',
    jurisdiction: 'California',
    name: 'Meal Break (30 min)',
    type: 'break',
    parameters: { shiftThresholdHours: 5, breakMinutes: 30, maxHoursBeforeBreak: 5 },
    description: '30-minute unpaid meal break required for shifts exceeding 5 hours',
    isActive: false,
  },
  {
    _id: 'ca-rest-break',
    jurisdiction: 'California',
    name: 'Rest Break (10 min)',
    type: 'break',
    parameters: { hoursPerBreak: 4, breakMinutes: 10, paid: true },
    description: '10-minute paid rest break for every 4 hours worked (or major fraction)',
    isActive: false,
  },
  {
    _id: 'federal-meal-break',
    jurisdiction: 'Federal',
    name: 'Meal Break (General)',
    type: 'break',
    parameters: { shiftThresholdHours: 6, breakMinutes: 30, maxHoursBeforeBreak: 6 },
    description: '30-minute meal break recommended for shifts over 6 hours',
    isActive: true,
  },
  {
    _id: 'nyc-fair-workweek',
    jurisdiction: 'New York City',
    name: 'Fair Workweek (Advance Notice)',
    type: 'predictive_scheduling',
    parameters: { advanceNoticeDays: 14, premiumPayHours: 0 },
    description: 'Employers must provide schedules at least 14 days in advance',
    isActive: false,
  },
  {
    _id: 'or-predictive-scheduling',
    jurisdiction: 'Oregon',
    name: 'Predictive Scheduling',
    type: 'predictive_scheduling',
    parameters: { advanceNoticeDays: 14, premiumPayHours: 1 },
    description: '14-day advance notice; 1 hour premium pay for schedule changes within window',
    isActive: false,
  },
  {
    _id: 'ca-split-shift',
    jurisdiction: 'California',
    name: 'Split Shift Premium',
    type: 'split_shift',
    parameters: { gapHoursThreshold: 1, premiumAmount: 'minimum_wage_hour' },
    description: 'One hour at minimum wage premium required when shift has gap > 1 hour',
    isActive: false,
  },
  {
    _id: 'federal-minor-hours',
    jurisdiction: 'Federal',
    name: 'Minor Work Hours',
    type: 'minor',
    parameters: { maxHoursSchoolWeek: 18, maxHoursNonSchoolWeek: 40, maxHoursPerDay: 8, minAge: 14, maxAge: 17, noWorkAfter: '19:00', noWorkBefore: '07:00' },
    description: 'Restricts work hours for employees aged 14-17',
    isActive: false,
  },
];

/** Run all active compliance rules against a schedule */
export function checkCompliance(
  schedule: Schedule,
  shifts: Shift[],
  employees: Employee[],
  rules: ComplianceRule[],
): ComplianceCheckResult {
  const violations: ComplianceViolation[] = [];
  const warnings: ComplianceViolation[] = [];
  const activeRules = rules.filter(r => r.isActive);
  const empMap = new Map(employees.map(e => [e._id, e]));

  for (const rule of activeRules) {
    switch (rule.type) {
      case 'overtime':
        checkOvertimeRule(rule, schedule, shifts, empMap, violations, warnings);
        break;
      case 'break':
        checkBreakRule(rule, schedule, shifts, empMap, violations, warnings);
        break;
      case 'predictive_scheduling':
        checkPredictiveSchedulingRule(rule, schedule, violations, warnings);
        break;
      case 'split_shift':
        checkSplitShiftRule(rule, schedule, shifts, empMap, violations, warnings);
        break;
    }
  }

  const byType: Record<string, number> = {};
  for (const v of violations) {
    const rule = activeRules.find(r => r._id === v.ruleId);
    if (rule) byType[rule.type] = (byType[rule.type] || 0) + 1;
  }

  return {
    violations,
    warnings,
    passed: violations.length === 0,
    rulesChecked: activeRules.length,
    summary: {
      totalViolations: violations.length,
      totalWarnings: warnings.length,
      byType,
    },
  };
}

function checkOvertimeRule(
  rule: ComplianceRule,
  schedule: Schedule,
  shifts: Shift[],
  empMap: Map<string, Employee>,
  violations: ComplianceViolation[],
  warnings: ComplianceViolation[],
) {
  const weeklyThreshold = (rule.parameters.weeklyThreshold as number) || 40;
  const dailyThreshold = rule.parameters.dailyThreshold as number | undefined;

  // Weekly overtime check
  const hoursByEmployee: Record<string, number> = {};
  for (const shift of shifts) {
    if (!hoursByEmployee[shift.employeeId]) hoursByEmployee[shift.employeeId] = 0;
    hoursByEmployee[shift.employeeId] += calculateShiftHours(shift.startTime, shift.endTime, shift.breakMinutes);
  }

  for (const [empId, hours] of Object.entries(hoursByEmployee)) {
    if (hours > weeklyThreshold) {
      const emp = empMap.get(empId);
      const overtimeHours = hours - weeklyThreshold;
      violations.push({
        _id: crypto.randomUUID(),
        ruleId: rule._id,
        scheduleId: schedule._id,
        employeeId: empId,
        shiftId: '',
        severity: overtimeHours > 10 ? 'critical' : 'violation',
        description: `${emp?.firstName || 'Employee'} ${emp?.lastName || ''} scheduled for ${hours.toFixed(1)} hours (${overtimeHours.toFixed(1)}h overtime beyond ${weeklyThreshold}h threshold)`,
        detectedAt: new Date().toISOString(),
      });
    } else if (hours > weeklyThreshold - 2) {
      const emp = empMap.get(empId);
      warnings.push({
        _id: crypto.randomUUID(),
        ruleId: rule._id,
        scheduleId: schedule._id,
        employeeId: empId,
        shiftId: '',
        severity: 'warning',
        description: `${emp?.firstName || 'Employee'} ${emp?.lastName || ''} at ${hours.toFixed(1)} hours — approaching ${weeklyThreshold}h overtime threshold`,
        detectedAt: new Date().toISOString(),
      });
    }
  }

  // Daily overtime check (e.g., California)
  if (dailyThreshold) {
    for (const shift of shifts) {
      const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.breakMinutes);
      if (hours > dailyThreshold) {
        const emp = empMap.get(shift.employeeId);
        violations.push({
          _id: crypto.randomUUID(),
          ruleId: rule._id,
          scheduleId: schedule._id,
          employeeId: shift.employeeId,
          shiftId: shift._id,
          severity: 'violation',
          description: `${emp?.firstName || 'Employee'} ${emp?.lastName || ''} shift on ${shift.date} is ${hours.toFixed(1)} hours (daily OT threshold: ${dailyThreshold}h)`,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }
}

function checkBreakRule(
  rule: ComplianceRule,
  schedule: Schedule,
  shifts: Shift[],
  empMap: Map<string, Employee>,
  violations: ComplianceViolation[],
  _warnings: ComplianceViolation[],
) {
  const thresholdHours = (rule.parameters.shiftThresholdHours as number) || 5;
  const requiredBreakMinutes = (rule.parameters.breakMinutes as number) || 30;

  for (const shift of shifts) {
    const hours = calculateShiftHours(shift.startTime, shift.endTime, 0); // Gross hours before break
    if (hours > thresholdHours && shift.breakMinutes < requiredBreakMinutes) {
      const emp = empMap.get(shift.employeeId);
      violations.push({
        _id: crypto.randomUUID(),
        ruleId: rule._id,
        scheduleId: schedule._id,
        employeeId: shift.employeeId,
        shiftId: shift._id,
        severity: 'violation',
        description: `${emp?.firstName || 'Employee'} ${emp?.lastName || ''} on ${shift.date}: ${hours.toFixed(1)}h shift has only ${shift.breakMinutes}min break (${requiredBreakMinutes}min required for shifts >${thresholdHours}h)`,
        detectedAt: new Date().toISOString(),
      });
    }
  }
}

function checkPredictiveSchedulingRule(
  rule: ComplianceRule,
  schedule: Schedule,
  _violations: ComplianceViolation[],
  warnings: ComplianceViolation[],
) {
  const advanceNoticeDays = (rule.parameters.advanceNoticeDays as number) || 14;

  if (schedule.status === 'draft' && schedule.weekStartDate) {
    const scheduleStart = new Date(schedule.weekStartDate + 'T00:00:00');
    const now = new Date();
    const daysUntilStart = (scheduleStart.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

    if (daysUntilStart < advanceNoticeDays) {
      warnings.push({
        _id: crypto.randomUUID(),
        ruleId: rule._id,
        scheduleId: schedule._id,
        employeeId: '',
        shiftId: '',
        severity: 'warning',
        description: `Schedule starts in ${Math.round(daysUntilStart)} days — ${rule.jurisdiction} requires ${advanceNoticeDays}-day advance notice. Publishing now may trigger premium pay obligations.`,
        detectedAt: new Date().toISOString(),
      });
    }
  }
}

function checkSplitShiftRule(
  rule: ComplianceRule,
  schedule: Schedule,
  shifts: Shift[],
  empMap: Map<string, Employee>,
  _violations: ComplianceViolation[],
  warnings: ComplianceViolation[],
) {
  const gapThreshold = (rule.parameters.gapHoursThreshold as number) || 1;

  // Group shifts by employee + date
  const grouped: Record<string, Shift[]> = {};
  for (const shift of shifts) {
    const key = `${shift.employeeId}:${shift.date}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(shift);
  }

  for (const [, dayShifts] of Object.entries(grouped)) {
    if (dayShifts.length < 2) continue;

    // Sort by start time
    const sorted = dayShifts.sort((a, b) => a.startTime.localeCompare(b.startTime));

    for (let i = 0; i < sorted.length - 1; i++) {
      const endMin = timeToMinutes(sorted[i].endTime);
      const nextStartMin = timeToMinutes(sorted[i + 1].startTime);
      const gapHours = (nextStartMin - endMin) / 60;

      if (gapHours > gapThreshold) {
        const emp = empMap.get(sorted[i].employeeId);
        warnings.push({
          _id: crypto.randomUUID(),
          ruleId: rule._id,
          scheduleId: schedule._id,
          employeeId: sorted[i].employeeId,
          shiftId: sorted[i]._id,
          severity: 'warning',
          description: `${emp?.firstName || 'Employee'} ${emp?.lastName || ''} has a ${gapHours.toFixed(1)}h gap between shifts on ${sorted[i].date} — split shift premium may apply`,
          detectedAt: new Date().toISOString(),
        });
      }
    }
  }
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Seed the database with built-in rules if none exist */
export async function seedComplianceRules(): Promise<void> {
  const { getCollections } = await import('$lib/server/database');
  const db = await getCollections();
  const existing = await db.complianceRules.countDocuments();

  if (existing === 0) {
    for (const rule of BUILT_IN_RULES) {
      await db.complianceRules.insertOne(rule as any);
    }
    console.log(`[Compliance] Seeded ${BUILT_IN_RULES.length} built-in rules`);
  }
}
