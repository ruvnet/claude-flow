import type { StaffRole } from './Employee';

export type ScheduleStatus = 'draft' | 'published' | 'archived';

export interface Schedule {
  _id: string;
  locationId: string;
  weekStartDate: string;
  status: ScheduleStatus;
  shifts: Shift[];
  publishedAt?: string;
  publishedBy?: string;
  totalLaborCost: number;
  totalScheduledHours: number;
  projectedRevenue: number;
  laborCostPct: number;
  optimizationScore?: number;
  optimizationNotes?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Shift {
  _id: string;
  scheduleId: string;
  employeeId: string;
  locationId: string;
  role: StaffRole;
  date: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  breaksTaken: BreakRecord[];
  status: 'scheduled' | 'confirmed' | 'in_progress' | 'completed' | 'no_show' | 'called_off';
  actualClockIn?: string;
  actualClockOut?: string;
  laborCost: number;
  isOvertimeShift: boolean;
  notes?: string;
  createdAt: string;
}

export interface BreakRecord {
  startTime: string;
  endTime: string;
  type: 'meal' | 'rest';
  durationMinutes: number;
  waived: boolean;
}

export interface ShiftTemplate {
  _id: string;
  locationId: string;
  name: string;
  dayOfWeek: number;
  shiftSlots: ShiftSlot[];
}

export interface ShiftSlot {
  role: StaffRole;
  startTime: string;
  endTime: string;
  count: number;
  requiredCertifications?: string[];
}
