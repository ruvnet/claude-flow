/**
 * Labor Cost Service -- computes real-time and historical labor metrics.
 */
import { getCollections } from '$lib/server/database';
import type { Schedule, Shift } from '$lib/types/Schedule';
import type { Employee, StaffRole } from '$lib/types/Employee';
import type { LaborCostSnapshot, RoleLaborCost, Daypart, DaypartLaborCost } from '$lib/types/LaborCost';
import type { Location } from '$lib/types/Location';
import {
  laborCostPct,
  coversPerLaborHour,
  revenuePerLaborHour,
  calculateShiftHours,
  formatCurrency,
  formatPct,
} from '$lib/utils/labor-math';

export interface RealTimeLaborMetrics {
  locationId: string;
  locationName: string;
  date: string;
  scheduledHours: number;
  scheduledCost: number;
  actualRevenue: number | null;
  actualCovers: number | null;
  laborCostPct: number | null;
  targetLaborCostPct: number;
  variance: number | null;
  cplh: number | null;
  rplh: number | null;
  overtimeHours: number;
  overtimeCost: number;
  byRole: RoleLaborCost[];
  status: 'on_target' | 'warning' | 'over_budget';
}

export interface BudgetAlert {
  id: string;
  locationId: string;
  locationName: string;
  type: 'over_budget' | 'approaching_budget' | 'overtime_spike';
  severity: 'warning' | 'critical';
  message: string;
  currentValue: number;
  threshold: number;
  createdAt: string;
}

/** Compute real-time labor metrics for a location on a given date */
export async function getRealTimeMetrics(
  locationId: string,
  date: string,
): Promise<RealTimeLaborMetrics> {
  const db = await getCollections();

  const location = await db.locations.findOne({ _id: locationId } as any);
  const locationName = location?.name || 'Unknown';
  const targetPct = location?.laborBudgetPct || 0.28;

  // Get today's schedule
  const weekStart = getWeekStartForDate(date);
  const schedule = await db.schedules.findOne({
    locationId,
    weekStartDate: weekStart,
  } as any);

  // Filter shifts for this date
  const todayShifts = (schedule?.shifts || []).filter((s: Shift) => s.date === date);

  // Calculate scheduled labor
  let scheduledHours = 0;
  let scheduledCost = 0;
  let overtimeHours = 0;
  let overtimeCost = 0;
  const roleHours: Record<string, { hours: number; cost: number; headcount: number }> = {};

  const employees = await db.employees.find({} as any);
  const empMap = new Map(employees.map(e => [e._id, e]));

  for (const shift of todayShifts) {
    const hours = calculateShiftHours(shift.startTime, shift.endTime, shift.breakMinutes);
    scheduledHours += hours;
    scheduledCost += shift.laborCost;

    if (shift.isOvertimeShift) {
      overtimeHours += hours;
      const emp = empMap.get(shift.employeeId);
      if (emp) {
        overtimeCost += hours * (emp.overtimeRate - emp.hourlyRate);
      }
    }

    // Aggregate by role
    if (!roleHours[shift.role]) {
      roleHours[shift.role] = { hours: 0, cost: 0, headcount: 0 };
    }
    roleHours[shift.role].hours += hours;
    roleHours[shift.role].cost += shift.laborCost;
    roleHours[shift.role].headcount++;
  }

  const byRole: RoleLaborCost[] = Object.entries(roleHours).map(([role, data]) => ({
    role: role as StaffRole,
    hours: data.hours,
    cost: data.cost,
    headcount: data.headcount,
  }));

  // Check for Toast POS actual data
  const posSnapshot = await db.laborCosts.findOne({
    locationId,
    periodStart: date,
  } as any);

  const actualRevenue = posSnapshot?.totalRevenue ?? null;
  const actualCovers = posSnapshot ? (posSnapshot.totalRevenue / 25) : null; // ~$25 avg check estimate
  const currentLaborPct = actualRevenue ? laborCostPct(scheduledCost, actualRevenue) : null;
  const variance = currentLaborPct !== null ? currentLaborPct - targetPct : null;

  let status: 'on_target' | 'warning' | 'over_budget' = 'on_target';
  if (variance !== null) {
    if (variance > 0.03) status = 'over_budget';
    else if (variance > 0.01) status = 'warning';
  }

  return {
    locationId,
    locationName,
    date,
    scheduledHours,
    scheduledCost,
    actualRevenue,
    actualCovers,
    laborCostPct: currentLaborPct,
    targetLaborCostPct: targetPct,
    variance,
    cplh: actualCovers && scheduledHours ? coversPerLaborHour(actualCovers, scheduledHours) : null,
    rplh: actualRevenue && scheduledHours ? revenuePerLaborHour(actualRevenue, scheduledHours) : null,
    overtimeHours,
    overtimeCost,
    byRole,
    status,
  };
}

/** Check all locations for budget alerts */
export async function checkBudgetAlerts(date: string): Promise<BudgetAlert[]> {
  const db = await getCollections();
  const locations = await db.locations.find({ isActive: true } as any);
  const alerts: BudgetAlert[] = [];

  for (const location of locations) {
    const metrics = await getRealTimeMetrics(location._id, date);

    // Over budget alert
    if (metrics.variance !== null && metrics.variance > 0.03) {
      alerts.push({
        id: crypto.randomUUID(),
        locationId: location._id,
        locationName: location.name,
        type: 'over_budget',
        severity: 'critical',
        message: `Labor cost at ${formatPct(metrics.laborCostPct!)} — ${formatPct(Math.abs(metrics.variance))} over target of ${formatPct(metrics.targetLaborCostPct)}`,
        currentValue: metrics.laborCostPct!,
        threshold: metrics.targetLaborCostPct,
        createdAt: new Date().toISOString(),
      });
    } else if (metrics.variance !== null && metrics.variance > 0.01) {
      alerts.push({
        id: crypto.randomUUID(),
        locationId: location._id,
        locationName: location.name,
        type: 'approaching_budget',
        severity: 'warning',
        message: `Labor cost approaching target — currently ${formatPct(metrics.laborCostPct!)} vs ${formatPct(metrics.targetLaborCostPct)} target`,
        currentValue: metrics.laborCostPct!,
        threshold: metrics.targetLaborCostPct,
        createdAt: new Date().toISOString(),
      });
    }

    // Overtime spike alert
    if (metrics.overtimeHours > 8) {
      alerts.push({
        id: crypto.randomUUID(),
        locationId: location._id,
        locationName: location.name,
        type: 'overtime_spike',
        severity: metrics.overtimeHours > 16 ? 'critical' : 'warning',
        message: `${metrics.overtimeHours.toFixed(1)} overtime hours today — ${formatCurrency(metrics.overtimeCost)} extra cost`,
        currentValue: metrics.overtimeHours,
        threshold: 8,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return alerts;
}

/** Get weekly labor cost trend for a location */
export async function getWeeklyTrend(
  locationId: string,
  weeks: number = 8,
): Promise<{ weekStart: string; laborCostPct: number; revenue: number; laborCost: number }[]> {
  const db = await getCollections();
  const snapshots = await db.laborCosts.find(
    locationId ? { locationId } as any : {} as any
  );

  // Group by week
  const weeklyMap: Record<string, { revenue: number; laborCost: number }> = {};

  for (const snap of snapshots) {
    const weekStart = getWeekStartForDate(snap.periodStart);
    if (!weeklyMap[weekStart]) {
      weeklyMap[weekStart] = { revenue: 0, laborCost: 0 };
    }
    weeklyMap[weekStart].revenue += snap.totalRevenue;
    weeklyMap[weekStart].laborCost += snap.totalLaborCost;
  }

  return Object.entries(weeklyMap)
    .map(([weekStart, data]) => ({
      weekStart,
      laborCostPct: laborCostPct(data.laborCost, data.revenue),
      revenue: data.revenue,
      laborCost: data.laborCost,
    }))
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-weeks);
}

function getWeekStartForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}
