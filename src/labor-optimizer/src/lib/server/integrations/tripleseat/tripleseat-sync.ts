/**
 * Tripleseat Sync Service
 *
 * Fetches events, bookings (with financials), and leads from Tripleseat
 * and upserts them into Supabase tables.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createTripleseatClient, type TripleseatBooking, type TripleseatEvent } from './tripleseat-client';

interface SyncConfig {
  locationId: string;          // Supabase location UUID
  consumerKey: string;
  consumerSecret: string;
  tripleseatSiteId?: string;
  tripleseatLocationId?: number;
}

interface SyncResult {
  locationId: string;
  eventsUpserted: number;
  leadsUpserted: number;
  errors: string[];
}

/**
 * Build a map of booking_id → financial totals from booking documents.
 */
function extractFinancials(bookings: TripleseatBooking[]): Map<number, {
  food: number; beverage: number; rental: number; av: number; other: number;
  total: number; tax: number; serviceCharge: number; grandTotal: number;
}> {
  const map = new Map();
  for (const booking of bookings) {
    const docs = booking.documents || [];
    // Sum all documents on the booking (could be multiple proposals/invoices)
    let food = 0, beverage = 0, rental = 0, av = 0, other = 0;
    let total = 0, tax = 0, serviceCharge = 0, grandTotal = 0;
    for (const doc of docs) {
      food += doc.food_total || 0;
      beverage += doc.beverage_total || 0;
      rental += doc.room_rental_total || 0;
      av += doc.av_total || 0;
      other += doc.other_total || 0;
      total += doc.sub_total || 0;
      tax += doc.tax_total || 0;
      serviceCharge += doc.service_charge_total || 0;
      grandTotal += doc.grand_total || 0;
    }
    map.set(booking.id, { food, beverage, rental, av, other, total, tax, serviceCharge, grandTotal });
  }
  return map;
}

/**
 * Sync events and bookings for a single location.
 */
export async function syncTripleseatLocation(
  sb: SupabaseClient,
  config: SyncConfig,
  opts: { startDate: string; endDate: string }
): Promise<SyncResult> {
  const result: SyncResult = {
    locationId: config.locationId,
    eventsUpserted: 0,
    leadsUpserted: 0,
    errors: [],
  };

  const client = createTripleseatClient(config.consumerKey, config.consumerSecret, config.tripleseatSiteId);

  // Fetch events and bookings in parallel
  let events: TripleseatEvent[] = [];
  let bookings: TripleseatBooking[] = [];

  try {
    [events, bookings] = await Promise.all([
      client.getEvents({
        startDate: opts.startDate,
        endDate: opts.endDate,
        locationId: config.tripleseatLocationId,
      }),
      client.getBookings({
        startDate: opts.startDate,
        endDate: opts.endDate,
        locationId: config.tripleseatLocationId,
      }),
    ]);
  } catch (err: any) {
    result.errors.push(`API fetch failed: ${err.message}`);
    return result;
  }

  // Build financial lookup from bookings
  const financials = extractFinancials(bookings);

  // Also build a booking-level status and event-type map
  const bookingStatusMap = new Map<number, string>();
  for (const b of bookings) {
    bookingStatusMap.set(b.id, b.status);
  }

  // Upsert events
  if (events.length > 0) {
    const rows = events.map(evt => {
      const fin = financials.get(evt.booking_id);
      const eventDate = evt.event_start ? evt.event_start.split('T')[0] : null;
      return {
        tripleseat_event_id: evt.id,
        tripleseat_booking_id: evt.booking_id,
        location_id: config.locationId,
        event_name: evt.name || null,
        event_date: eventDate,
        event_start: evt.event_start || null,
        event_end: evt.event_end || null,
        status: (evt.status || bookingStatusMap.get(evt.booking_id) || 'PROSPECT').toUpperCase(),
        event_type: evt.event_type_name || null,
        guest_count: evt.guest_count || 0,
        room_name: evt.room_names?.join(', ') || null,
        food_revenue: fin?.food || 0,
        beverage_revenue: fin?.beverage || 0,
        rental_revenue: fin?.rental || 0,
        av_revenue: fin?.av || 0,
        other_revenue: fin?.other || 0,
        total_revenue: fin?.total || 0,
        tax: fin?.tax || 0,
        service_charge: fin?.serviceCharge || 0,
        grand_total: fin?.grandTotal || 0,
        sales_manager: null, // TODO: resolve from user_id if available
        account_name: null,  // TODO: resolve from account_id
        contact_name: null,  // TODO: resolve from contact_id
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }).filter(r => r.event_date); // Skip events without a parseable date

    // Batch upsert in chunks of 500
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await sb
        .from('tripleseat_events')
        .upsert(chunk, { onConflict: 'location_id,tripleseat_event_id' });
      if (error) {
        result.errors.push(`Event upsert batch ${i}: ${error.message}`);
      } else {
        result.eventsUpserted += chunk.length;
      }
    }
  }

  // Fetch and upsert leads
  try {
    const leads = await client.getLeads({
      startDate: opts.startDate,
      endDate: opts.endDate,
      locationId: config.tripleseatLocationId,
    });

    if (leads.length > 0) {
      const leadRows = leads.map(lead => ({
        tripleseat_lead_id: lead.id,
        location_id: config.locationId,
        lead_source: lead.lead_source || null,
        event_type: lead.event_type || null,
        event_date: lead.event_date || null,
        guest_count: lead.guest_count || 0,
        status: (lead.status || 'new').toLowerCase(),
        created_at: lead.created_at,
        synced_at: new Date().toISOString(),
      }));

      for (let i = 0; i < leadRows.length; i += 500) {
        const chunk = leadRows.slice(i, i + 500);
        const { error } = await sb
          .from('tripleseat_leads')
          .upsert(chunk, { onConflict: 'location_id,tripleseat_lead_id' });
        if (error) {
          result.errors.push(`Lead upsert batch ${i}: ${error.message}`);
        } else {
          result.leadsUpserted += chunk.length;
        }
      }
    }
  } catch (err: any) {
    result.errors.push(`Lead sync failed: ${err.message}`);
  }

  // Update last_synced_at on config
  await sb
    .from('tripleseat_config')
    .update({ last_synced_at: new Date().toISOString() })
    .eq('location_id', config.locationId);

  return result;
}

/**
 * Sync all enabled Tripleseat locations.
 */
export async function syncAllTripleseatLocations(
  sb: SupabaseClient,
  opts?: { startDate?: string; endDate?: string }
): Promise<SyncResult[]> {
  const { data: configs } = await sb
    .from('tripleseat_config')
    .select('*')
    .eq('enabled', true);

  if (!configs?.length) return [];

  // Default: past 3 months to 18 months ahead (capture STLY data)
  const now = new Date();
  const startDate = opts?.startDate ||
    new Date(now.getFullYear() - 1, now.getMonth() - 3, 1).toISOString().split('T')[0];
  const endDate = opts?.endDate ||
    new Date(now.getFullYear() + 1, now.getMonth() + 6, 0).toISOString().split('T')[0];

  const results: SyncResult[] = [];
  // Process locations sequentially to respect rate limits
  for (const cfg of configs) {
    const result = await syncTripleseatLocation(sb, {
      locationId: cfg.location_id,
      consumerKey: cfg.consumer_key,
      consumerSecret: cfg.consumer_secret,
      tripleseatSiteId: cfg.tripleseat_site_id,
    }, { startDate, endDate });
    results.push(result);
  }

  return results;
}
