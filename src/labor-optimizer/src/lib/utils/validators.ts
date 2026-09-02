import { z } from 'zod';

const STAFF_ROLES = [
  'server', 'bartender', 'host', 'busser', 'food_runner',
  'line_cook', 'prep_cook', 'dishwasher', 'expo',
  'sous_chef', 'head_chef', 'bar_back',
] as const;

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'seasonal', 'on_call'] as const;

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export const timeString = z.string().regex(TIME_REGEX, 'Must be HH:MM format');
export const dateString = z.string().regex(DATE_REGEX, 'Must be YYYY-MM-DD format');

export const createEmployeeSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email(),
  phone: z.string().min(5).max(20),
  primaryLocationId: z.string().min(1),
  secondaryLocationIds: z.array(z.string()).default([]),
  roles: z.array(z.enum(STAFF_ROLES)).min(1),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  hireDate: dateString,
  hourlyRate: z.number().positive().max(200),
  overtimeRate: z.number().positive().max(300),
  maxHoursPerWeek: z.number().int().min(1).max(80),
  minHoursPerWeek: z.number().int().min(0).max(80),
  certifications: z.array(z.string()).default([]),
});

export const updateEmployeeSchema = createEmployeeSchema.partial();

export const createLocationSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.enum(['restaurant', 'bar', 'restaurant_bar']),
  address: z.string().min(1).max(500),
  timezone: z.string().min(1),
  laborBudgetPct: z.number().min(0).max(1),
  operatingHours: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    openTime: timeString,
    closeTime: timeString,
    isClosed: z.boolean(),
  })).length(7),
});

export const updateLocationSchema = createLocationSchema.partial();

export const createShiftSchema = z.object({
  employeeId: z.string().min(1),
  locationId: z.string().min(1),
  role: z.enum(STAFF_ROLES),
  date: dateString,
  startTime: timeString,
  endTime: timeString,
  breakMinutes: z.number().int().min(0).max(120).default(0),
  notes: z.string().max(500).optional(),
});
