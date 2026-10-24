/**
 * Forecast Data Signals — parallel queries for enhancements 6-10.
 * Each function returns a Map keyed by business_date (or DOW number).
 * All are designed to be called via Promise.allSettled for resilience.
 */
import { getSupabaseService } from '$lib/server/supabase';

export interface BookingPace { booked: number; avgAtThisPoint: number; delta: number }
export interface EventCallout { name: string; type: string; impactPct: number }
export interface CompetitiveDemand { avgPctBooked: number; signal: 'high' | 'moderate' | 'low' }

/** Enhancement 6: Resy Booking Pace vs 4-week same-DOW average */
export async function fetchBookingPace(
  locationId: string, startDate: string, endDate: string,
): Promise<Map<string, BookingPace>> {
  const sb = getSupabaseService();
  const { data: bookings } = await sb
    .from('daily_reservations')
    .select('business_date, booked_covers')
    .eq('location_id', locationId)
    .gte('business_date', startDate)
    .lte('business_date', endDate);

  const histStart = new Date(startDate + 'T12:00:00');
  histStart.setDate(histStart.getDate() - 28);
  const { data: histBookings } = await sb
    .from('daily_reservations')
    .select('business_date, booked_covers')
    .eq('location_id', locationId)
    .gte('business_date', histStart.toISOString().split('T')[0])
    .lt('business_date', startDate);

  const dowAvgMap = new Map<number, number[]>();
  for (const r of histBookings || []) {
    const dow = new Date(r.business_date + 'T12:00:00').getDay();
    if (!dowAvgMap.has(dow)) dowAvgMap.set(dow, []);
    dowAvgMap.get(dow)!.push(r.booked_covers ?? 0);
  }

  const paceMap = new Map<string, BookingPace>();
  for (const r of bookings || []) {
    const dow = new Date(r.business_date + 'T12:00:00').getDay();
    const hist = dowAvgMap.get(dow) || [];
    const avg = hist.length > 0 ? Math.round(hist.reduce((a, b) => a + b, 0) / hist.length) : 0;
    const booked = r.booked_covers ?? 0;
    paceMap.set(r.business_date, { booked, avgAtThisPoint: avg, delta: booked - avg });
  }
  return paceMap;
}

/** Enhancement 8: Event Callouts from event_calendar within 15 miles */
export async function fetchEventCallouts(
  locationId: string, startDate: string, endDate: string,
): Promise<Map<string, EventCallout[]>> {
  const sb = getSupabaseService();
  const { data: events } = await sb
    .from('event_calendar')
    .select('event_date, event_name, event_type, impact_score, distance_miles')
    .eq('location_id', locationId)
    .gte('event_date', startDate)
    .lte('event_date', endDate)
    .lte('distance_miles', 15);

  const eventMap = new Map<string, EventCallout[]>();
  for (const e of events || []) {
    const list = eventMap.get(e.event_date) || [];
    list.push({
      name: e.event_name,
      type: e.event_type || 'event',
      impactPct: Math.round((Number(e.impact_score) || 0) * 100),
    });
    eventMap.set(e.event_date, list);
  }
  return eventMap;
}

/** Enhancement 9: Competitive Demand Signal — avg % booked across competitors */
export async function fetchCompetitiveDemand(
  locationId: string, startDate: string, endDate: string,
): Promise<Map<string, CompetitiveDemand> | null> {
  const sb = getSupabaseService();
  const { data: comps } = await sb
    .from('competitive_set')
    .select('id')
    .eq('location_id', locationId)
    .eq('is_active', true);

  if (!comps || comps.length === 0) return null;

  const compIds = comps.map(c => c.id);
  const { data: avail } = await sb
    .from('competitive_availability')
    .select('check_date, pct_booked')
    .in('competitor_id', compIds)
    .gte('check_date', startDate)
    .lte('check_date', endDate);

  const dayMap = new Map<string, number[]>();
  for (const r of avail || []) {
    const list = dayMap.get(r.check_date) || [];
    list.push(Number(r.pct_booked) || 0);
    dayMap.set(r.check_date, list);
  }

  const signalMap = new Map<string, CompetitiveDemand>();
  for (const [date, pcts] of dayMap.entries()) {
    const avg = Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100);
    const signal = avg > 80 ? 'high' : avg > 50 ? 'moderate' : 'low';
    signalMap.set(date, { avgPctBooked: avg, signal });
  }
  return signalMap;
}

/** Enhancement 10: Week-over-Week Momentum — trailing 3-week same-DOW trend */
export async function fetchWowTrend(
  locationId: string, startDate: string,
): Promise<Map<number, 'up' | 'down' | 'flat'>> {
  const sb = getSupabaseService();
  const trendStart = new Date(startDate + 'T12:00:00');
  trendStart.setDate(trendStart.getDate() - 21);

  const { data: trendData } = await sb
    .from('daily_actuals')
    .select('business_date, revenue')
    .eq('location_id', locationId)
    .gte('business_date', trendStart.toISOString().split('T')[0])
    .lt('business_date', startDate)
    .gt('revenue', 0)
    .order('business_date', { ascending: true });

  const dowWeeks = new Map<number, number[]>();
  for (const r of trendData || []) {
    const dow = new Date(r.business_date + 'T12:00:00').getDay();
    if (!dowWeeks.has(dow)) dowWeeks.set(dow, []);
    dowWeeks.get(dow)!.push(r.revenue);
  }

  const trendMap = new Map<number, 'up' | 'down' | 'flat'>();
  for (const [dow, revs] of dowWeeks.entries()) {
    if (revs.length < 2) { trendMap.set(dow, 'flat'); continue; }
    const last3 = revs.slice(-3);
    let allUp = true, allDown = true;
    for (let i = 1; i < last3.length; i++) {
      const pctChange = (last3[i] - last3[i - 1]) / last3[i - 1];
      if (pctChange <= 0.03) allUp = false;
      if (pctChange >= -0.03) allDown = false;
    }
    trendMap.set(dow, allUp ? 'up' : allDown ? 'down' : 'flat');
  }
  return trendMap;
}
