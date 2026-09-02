import type { StaffRole } from './Employee';

export interface DemandForecast {
  _id: string;
  locationId: string;
  date: string;
  dayOfWeek: number;
  forecastedCovers: number;
  forecastedRevenue: number;
  confidenceLevel: number;
  signals: DemandSignal[];
  hourlyBreakdown: HourlyDemand[];
  model: 'historical_avg' | 'neural_sona' | 'weighted_ensemble';
  generatedAt: string;
}

export interface DemandSignal {
  source: 'resy_reservations' | 'historical_pos' | 'weather' | 'local_events'
        | 'holiday' | 'day_of_week' | 'seasonal';
  value: number;
  weight: number;
  description: string;
}

export interface HourlyDemand {
  hour: number;
  expectedCovers: number;
  requiredStaff: StaffingRequirement[];
}

export interface StaffingRequirement {
  role: StaffRole;
  minCount: number;
  optimalCount: number;
  coversPerStaffRatio: number;
}
