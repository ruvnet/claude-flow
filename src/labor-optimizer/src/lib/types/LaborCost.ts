import type { StaffRole } from './Employee';

export interface LaborCostSnapshot {
  _id: string;
  locationId: string;
  periodStart: string;
  periodEnd: string;
  totalLaborCost: number;
  totalRevenue: number;
  laborCostPct: number;
  targetLaborCostPct: number;
  variance: number;
  overtimeCost: number;
  regularCost: number;
  totalHours: number;
  overtimeHours: number;
  coversPerLaborHour: number;
  revenuePerLaborHour: number;
  byRole: RoleLaborCost[];
  byDaypart: DaypartLaborCost[];
  createdAt: string;
}

export interface RoleLaborCost {
  role: StaffRole;
  hours: number;
  cost: number;
  headcount: number;
}

export type Daypart = 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late_night';

export interface DaypartLaborCost {
  daypart: Daypart;
  hours: number;
  cost: number;
  revenue: number;
  laborCostPct: number;
}
