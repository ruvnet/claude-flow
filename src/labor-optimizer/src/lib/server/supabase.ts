import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let _client: SupabaseClient | null = null;
let _serviceClient: SupabaseClient | null = null;

/** Anon-key client for authenticated browser requests. */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    }
    _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      db: { schema: 'public' },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-connection-pool': 'true' } },
    });
  }
  return _client;
}

/** Service-role client for cron jobs and server-side mutations. */
export function getSupabaseService(): SupabaseClient {
  if (!_serviceClient) {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables');
    }
    _serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      db: { schema: 'public' },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { headers: { 'x-connection-pool': 'true' } },
    });
  }
  return _serviceClient;
}

// ---------------------------------------------------------------------------
// Position constants
// ---------------------------------------------------------------------------

export type DashboardPosition =
  | 'Server'
  | 'Bartender'
  | 'Host'
  | 'Barista'
  | 'Support'
  | 'Training'
  | 'Line Cooks'
  | 'Prep Cooks'
  | 'Pastry'
  | 'Dishwashers';

export const FOH_POSITIONS: DashboardPosition[] = [
  'Server',
  'Bartender',
  'Host',
  'Barista',
  'Support',
  'Training',
];

export const BOH_POSITIONS: DashboardPosition[] = [
  'Line Cooks',
  'Prep Cooks',
  'Pastry',
  'Dishwashers',
];

export const ALL_POSITIONS: DashboardPosition[] = [...FOH_POSITIONS, ...BOH_POSITIONS];

// ---------------------------------------------------------------------------
// Row types (mirror the DB schema)
// ---------------------------------------------------------------------------

export interface LocationRow {
  id: string;
  name: string;
  type: string;
  toast_guid: string | null;
  toast_client_id: string | null;
  toast_client_secret: string | null;
  timezone: string;
  labor_budget_pct: number;
  period_start_date: string | null;
  is_active: boolean;
}

export interface DailyActualRow {
  id: string;
  location_id: string;
  business_date: string;
  revenue: number | null;
  covers: number | null;
  order_count: number | null;
  prior_year_revenue: number | null;
  prior_year_covers: number | null;
  synced_at: string | null;
}

export interface DailyLaborRow {
  id: string;
  location_id: string;
  business_date: string;
  toast_job_name: string;
  mapped_position: string;
  labor_dollars: number;
  regular_hours: number;
  overtime_hours: number;
  synced_at: string | null;
}

export interface ToastJobMappingRow {
  id: string;
  location_id: string;
  toast_job_name: string;
  toast_job_guid: string | null;
  dashboard_position: DashboardPosition | 'EXCLUDE';
}

export interface LaborThresholdRow {
  id: string;
  location_id: string;
  revenue_bracket_low: number;
  revenue_bracket_high: number;
  position: string;
  weekly_labor_dollars: number;
  labor_pct: number | null;
}

export interface DailyForecastRow {
  id: string;
  location_id: string;
  business_date: string;
  ai_suggested_revenue: number | null;
  ai_suggested_covers: number | null;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  manager_revenue: number | null;
  manager_covers: number | null;
  is_override: boolean;
  override_explanation: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  forecast_weights: Record<string, number> | null;
  locked: boolean;
  locked_at: string | null;
  locked_by: string | null;
}

export interface DailyLaborTargetRow {
  id: string;
  location_id: string;
  business_date: string;
  position: string;
  projected_labor_dollars: number;
  projected_labor_pct: number | null;
  threshold_bracket_used: string | null;
  week_forecast_total: number | null;
}

export interface DowWeightRow {
  id: string;
  location_id: string;
  position: string;
  day_of_week: number;
  weight: number;
}

export interface VarianceLogRow {
  id: string;
  location_id: string;
  business_date: string;
  position: string;
  projected_dollars: number | null;
  actual_dollars: number | null;
  variance_dollars: number | null;
  variance_pct: number | null;
  explanation: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PeriodRow {
  id: string;
  location_id: string;
  period_number: number;
  year: number;
  start_date: string;
  end_date: string;
}
