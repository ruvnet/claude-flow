import type { StaffRole } from './Employee';

export interface Location {
  _id: string;
  name: string;
  type: 'restaurant' | 'bar' | 'restaurant_bar';
  address: string;
  timezone: string;
  posIntegration?: POSIntegration;
  reservationIntegration?: ReservationIntegration;
  operatingHours: DayOfWeekHours[];
  laborBudgetPct: number;
  staffingConfig: StaffingConfig;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Per-location staffing configuration.
 * Defines minimum floors AND demand-based ratios per position.
 */
export interface StaffingConfig {
  /** Minimum staff required per role regardless of demand (the "floor") */
  minimumsByRole: RoleStaffingFloor[];
  /** Covers-per-staff ratios used when demand exceeds floor levels */
  ratiosByRole: RoleStaffingRatio[];
}

/**
 * Minimum staffing floor for a position.
 * "We always need at least 1 host, even on a slow Monday."
 */
export interface RoleStaffingFloor {
  role: StaffRole;
  /** Minimum headcount whenever the location is open */
  minOnFloor: number;
  /** Optional per-daypart overrides (e.g., 2 hosts at dinner, 1 at lunch) */
  daypartOverrides?: DaypartStaffingFloor[];
}

export interface DaypartStaffingFloor {
  daypart: 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late_night';
  minOnFloor: number;
}

/**
 * Demand-based staffing ratio for a position.
 * "1 server per 20 covers" — kicks in when demand exceeds the floor.
 */
export interface RoleStaffingRatio {
  role: StaffRole;
  /** Number of covers one staff member can handle */
  coversPerStaff: number;
  /** Max staff for this role (cap even at high demand) */
  maxOnFloor?: number;
}

export interface DayOfWeekHours {
  dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
}

export interface POSIntegration {
  provider: 'toast' | 'spoton' | 'square';
  restaurantGuid: string;
  lastSyncAt?: string;
}

export interface ReservationIntegration {
  provider: 'resy' | 'opentable';
  venueId: string;
  lastSyncAt?: string;
}
