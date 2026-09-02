/**
 * Tripleseat API Client
 *
 * OAuth 1.0a HMAC-SHA1 signed requests (two-legged, consumer-only).
 * Rate limited to 10 req/sec per Tripleseat docs.
 * Docs: https://support.tripleseat.com/hc/en-us/articles/205162108-API-Overview
 */

import { createHmac, randomBytes } from 'crypto';

const BASE_URL = 'https://api.tripleseat.com/v1';

interface TripleseatConfig {
  consumerKey: string;
  consumerSecret: string;
  siteId?: string;
}

export interface TripleseatEvent {
  id: number;
  name: string;
  status: string;
  event_start: string;
  event_end: string;
  guest_count: number;
  event_type_id: number;
  event_type_name?: string;
  location_id: number;
  booking_id: number;
  room_ids: number[];
  room_names?: string[];
  account_id: number;
  contact_id: number;
  created_at: string;
  updated_at: string;
}

export interface TripleseatBooking {
  id: number;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  documents?: TripleseatDocument[];
  events?: TripleseatEvent[];
}

export interface TripleseatDocument {
  id: number;
  name: string;
  food_total?: number;
  beverage_total?: number;
  room_rental_total?: number;
  av_total?: number;
  other_total?: number;
  sub_total?: number;
  tax_total?: number;
  service_charge_total?: number;
  grand_total?: number;
  payments_total?: number;
  balance_due?: number;
}

export interface TripleseatLead {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  event_date: string;
  guest_count: number;
  location_id: number;
  lead_source: string;
  event_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface TripleseatSite {
  id: number;
  name: string;
  locations: { id: number; name: string }[];
}

// Simple rate limiter — max 10 requests/second
class RateLimiter {
  private timestamps: number[] = [];
  private maxPerSecond = 10;

  async wait(): Promise<void> {
    const now = Date.now();
    this.timestamps = this.timestamps.filter(t => now - t < 1000);
    if (this.timestamps.length >= this.maxPerSecond) {
      const oldest = this.timestamps[0];
      const waitMs = 1000 - (now - oldest) + 10;
      await new Promise(r => setTimeout(r, waitMs));
    }
    this.timestamps.push(Date.now());
  }
}

export class TripleseatClient {
  private config: TripleseatConfig;
  private rateLimiter = new RateLimiter();

  constructor(config: TripleseatConfig) {
    this.config = config;
  }

  /**
   * RFC 5849 percent-encode (OAuth 1.0a requires uppercase hex).
   */
  private percentEncode(str: string): string {
    return encodeURIComponent(str).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  }

  /**
   * Generate OAuth 1.0a Authorization header (two-legged, consumer-only).
   * Uses HMAC-SHA1 signature with consumer secret + empty token secret.
   */
  private buildOAuthHeader(method: string, url: string, queryParams: Record<string, string>): string {
    const oauthParams: Record<string, string> = {
      oauth_consumer_key: this.config.consumerKey,
      oauth_nonce: randomBytes(16).toString('hex'),
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_version: '1.0',
    };

    // Combine all params for signature base string
    const allParams: Record<string, string> = { ...queryParams, ...oauthParams };
    const sortedKeys = Object.keys(allParams).sort();
    const paramString = sortedKeys
      .map(k => `${this.percentEncode(k)}=${this.percentEncode(allParams[k])}`)
      .join('&');

    // Signature base string: METHOD&url&params
    const baseString = [
      method.toUpperCase(),
      this.percentEncode(url),
      this.percentEncode(paramString),
    ].join('&');

    // Signing key: consumerSecret& (empty token secret for two-legged)
    const signingKey = `${this.percentEncode(this.config.consumerSecret)}&`;
    const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

    oauthParams['oauth_signature'] = signature;

    // Build Authorization header
    const headerParts = Object.entries(oauthParams)
      .map(([k, v]) => `${this.percentEncode(k)}="${this.percentEncode(v)}"`)
      .join(', ');

    return `OAuth ${headerParts}`;
  }

  private async request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    await this.rateLimiter.wait();

    const baseUrl = `${BASE_URL}${path}.json`;
    const authHeader = this.buildOAuthHeader('GET', baseUrl, params);

    // Build URL with query params
    const url = new URL(baseUrl);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    const res = await fetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader,
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Tripleseat API ${res.status}: ${path} — ${text.substring(0, 200)}`);
    }
    return res.json();
  }

  /**
   * Paginate through all pages of a list endpoint.
   * Tripleseat returns arrays; an empty page means we've hit the end.
   */
  private async paginate<T>(path: string, params: Record<string, string> = {}, resultKey?: string): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    while (true) {
      const data = await this.request<any>(path, { ...params, page: String(page) });
      const items: T[] = resultKey ? (data[resultKey] || data) : (Array.isArray(data) ? data : []);
      if (!items.length) break;
      all.push(...items);
      page++;
      // Safety: max 200 pages to avoid infinite loops
      if (page > 200) break;
    }
    return all;
  }

  /** Fetch all sites (venues). */
  async getSites(): Promise<TripleseatSite[]> {
    const data = await this.request<any>('/sites');
    return Array.isArray(data) ? data : (data.results || []);
  }

  /** Fetch events with optional date range and status filters. */
  async getEvents(opts: {
    startDate?: string;
    endDate?: string;
    status?: string;
    locationId?: number;
  } = {}): Promise<TripleseatEvent[]> {
    const params: Record<string, string> = {};
    if (opts.startDate) params.start_date = opts.startDate;
    if (opts.endDate) params.end_date = opts.endDate;
    if (opts.status) params.status = opts.status;
    if (opts.locationId) params.location_id = String(opts.locationId);
    return this.paginate<TripleseatEvent>('/events', params, 'results');
  }

  /** Fetch a single event by ID. */
  async getEvent(eventId: number): Promise<TripleseatEvent> {
    return this.request<TripleseatEvent>(`/events/${eventId}`);
  }

  /** Fetch bookings with financial details. */
  async getBookings(opts: {
    startDate?: string;
    endDate?: string;
    status?: string;
    locationId?: number;
  } = {}): Promise<TripleseatBooking[]> {
    const params: Record<string, string> = { show_financial: 'true' };
    if (opts.startDate) params.start_date = opts.startDate;
    if (opts.endDate) params.end_date = opts.endDate;
    if (opts.status) params.status = opts.status;
    if (opts.locationId) params.location_id = String(opts.locationId);
    return this.paginate<TripleseatBooking>('/bookings', params, 'results');
  }

  /** Fetch a single booking with financials. */
  async getBooking(bookingId: number): Promise<TripleseatBooking> {
    return this.request<TripleseatBooking>(`/bookings/${bookingId}`, { show_financial: 'true' });
  }

  /** Fetch leads with optional filters. */
  async getLeads(opts: {
    startDate?: string;
    endDate?: string;
    locationId?: number;
  } = {}): Promise<TripleseatLead[]> {
    const params: Record<string, string> = {};
    if (opts.startDate) params.start_date = opts.startDate;
    if (opts.endDate) params.end_date = opts.endDate;
    if (opts.locationId) params.location_id = String(opts.locationId);
    return this.paginate<TripleseatLead>('/leads', params, 'results');
  }

  /** Quick connectivity test — fetches sites endpoint. */
  async testConnection(): Promise<{ ok: boolean; sites: number; error?: string }> {
    try {
      const sites = await this.getSites();
      return { ok: true, sites: sites.length };
    } catch (err: any) {
      return { ok: false, sites: 0, error: err.message };
    }
  }
}

/** Create a Tripleseat client from stored config. */
export function createTripleseatClient(consumerKey: string, consumerSecret: string, siteId?: string): TripleseatClient {
  return new TripleseatClient({ consumerKey, consumerSecret, siteId });
}
