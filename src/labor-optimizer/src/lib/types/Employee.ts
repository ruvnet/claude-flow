export type StaffRole =
  | 'server' | 'bartender' | 'host' | 'busser' | 'food_runner'
  | 'line_cook' | 'prep_cook' | 'dishwasher' | 'expo'
  | 'sous_chef' | 'head_chef' | 'bar_back';

export type EmploymentType = 'full_time' | 'part_time' | 'seasonal' | 'on_call';

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  server: 'Server',
  bartender: 'Bartender',
  host: 'Host',
  busser: 'Busser',
  food_runner: 'Food Runner',
  line_cook: 'Line Cook',
  prep_cook: 'Prep Cook',
  dishwasher: 'Dishwasher',
  expo: 'Expo',
  sous_chef: 'Sous Chef',
  head_chef: 'Head Chef',
  bar_back: 'Bar Back',
};

export interface Employee {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  primaryLocationId: string;
  secondaryLocationIds: string[];
  roles: StaffRole[];
  employmentType: EmploymentType;
  hireDate: string;
  hourlyRate: number;
  overtimeRate: number;
  maxHoursPerWeek: number;
  minHoursPerWeek: number;
  certifications: string[];
  availability: WeeklyAvailability;
  timeOffRequests: TimeOffRequest[];
  performanceScore?: number;
  isActive: boolean;
  seniority: number;
  createdAt: string;
  updatedAt: string;
}

export interface WeeklyAvailability {
  [dayOfWeek: number]: DayAvailability;
}

export interface DayAvailability {
  isAvailable: boolean;
  startTime?: string;
  endTime?: string;
  preference: 'preferred' | 'available' | 'unavailable';
}

export interface TimeOffRequest {
  _id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  type: 'vacation' | 'sick' | 'personal' | 'unpaid';
  status: 'pending' | 'approved' | 'denied';
  requestedAt: string;
  reviewedBy?: string;
}
