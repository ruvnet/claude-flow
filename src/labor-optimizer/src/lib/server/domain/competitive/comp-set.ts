/**
 * Competitive Set Pricing Monitor
 *
 * Tracks competitor restaurant availability via Resy public search API
 * as a proxy for local market demand. When competitors are heavily booked,
 * it signals higher demand for our locations.
 */

import { getSupabaseService } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Competitor {
	id: string;
	location_id: string;
	competitor_name: string;
	competitor_resy_id: string | null;
	competitor_city: string | null;
	competitor_cuisine: string | null;
	competitor_price_tier: string | null;
	distance_miles: number | null;
	is_active: boolean;
}

export interface CompetitorAvailability {
	competitor: Competitor;
	availableSlots: number;
	firstAvailable: string | null;
	lastAvailable: string | null;
	estimatedCapacity: number;
	percentBooked: number;
	/** false when no stored data exists and the live API call failed or returned nothing */
	dataAvailable: boolean;
}

export interface DemandSignal {
	level: 'high' | 'medium' | 'low';
	avgPercentBooked: number;
	forecastAdjustmentPct: number;
	summary: string;
}

export interface CompetitiveSnapshot {
	locationId: string;
	date: string;
	competitors: CompetitorAvailability[];
	demandSignal: DemandSignal;
	fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Resy Public Search
// ---------------------------------------------------------------------------

const RESY_SEARCH_BASE = 'https://api.resy.com/4/find';

interface ResySlot {
	date: { start: string; end: string };
	config: { type: string; token: string };
}

interface ResyVenueResult {
	results?: {
		venues?: Array<{
			venue?: { id: { resy: number }; name: string };
			slots?: ResySlot[];
		}>;
	};
}

/**
 * Query Resy public search for a venue's availability on a given date.
 * Requires ResyAPI auth header to avoid 419 rate limits.
 */
async function fetchResyAvailability(
	resyVenueId: string,
	date: string,
	partySize = 2
): Promise<{ slots: ResySlot[]; totalSlots: number }> {
	try {
		const url = new URL(RESY_SEARCH_BASE);
		url.searchParams.set('day', date);
		url.searchParams.set('party_size', String(partySize));
		url.searchParams.set('venue_id', resyVenueId);

		const resyApiKey = process.env.RESY_API_KEY || 'VbMYTJcQTwKlLJHxK_ELDA';
		const res = await fetch(url.toString(), {
			headers: {
				'Accept': 'application/json, text/plain, */*',
				'Authorization': `ResyAPI api_key="${resyApiKey}"`,
				'X-Origin': 'https://resy.com',
				'User-Agent': 'Mozilla/5.0 (compatible; HELIXO/1.0)',
			},
			signal: AbortSignal.timeout(8000),
		});

		if (!res.ok) {
			console.warn(`[CompSet] Resy returned ${res.status} for venue ${resyVenueId}`);
			return { slots: [], totalSlots: 0 };
		}

		const data: ResyVenueResult = await res.json();
		const venues = data?.results?.venues ?? [];
		const match = venues.find(
			(v) => String(v.venue?.id?.resy) === resyVenueId
		) ?? venues[0];
		const slots = match?.slots ?? [];

		return { slots, totalSlots: slots.length };
	} catch (err) {
		console.warn(`[CompSet] Resy fetch failed for venue ${resyVenueId}:`, err);
		return { slots: [], totalSlots: 0 };
	}
}

// ---------------------------------------------------------------------------
// Competitor CRUD (Supabase)
// ---------------------------------------------------------------------------

export async function getCompetitors(locationId: string): Promise<Competitor[]> {
	const sb = getSupabaseService();
	const { data, error } = await sb
		.from('competitive_set')
		.select('*')
		.eq('location_id', locationId)
		.eq('is_active', true)
		.order('distance_miles', { ascending: true });

	if (error) {
		console.error('[CompSet] Error fetching competitors:', error.message);
		return [];
	}
	return data ?? [];
}

export async function getAllCompetitors(locationId: string): Promise<Competitor[]> {
	const sb = getSupabaseService();
	const { data, error } = await sb
		.from('competitive_set')
		.select('*')
		.eq('location_id', locationId)
		.order('distance_miles', { ascending: true });

	if (error) {
		console.error('[CompSet] Error fetching all competitors:', error.message);
		return [];
	}
	return data ?? [];
}

export async function upsertCompetitor(
	comp: Omit<Competitor, 'id'> & { id?: string }
): Promise<Competitor | null> {
	const sb = getSupabaseService();
	const { data, error } = await sb
		.from('competitive_set')
		.upsert(comp, { onConflict: 'id' })
		.select()
		.single();

	if (error) {
		console.error('[CompSet] Upsert error:', error.message);
		return null;
	}
	return data;
}

export async function deactivateCompetitor(id: string): Promise<boolean> {
	const sb = getSupabaseService();
	const { error } = await sb
		.from('competitive_set')
		.update({ is_active: false })
		.eq('id', id);

	if (error) {
		console.error('[CompSet] Deactivate error:', error.message);
		return false;
	}
	return true;
}

// ---------------------------------------------------------------------------
// Availability Check
// ---------------------------------------------------------------------------

/** Default estimated capacity when we cannot determine actual. */
const DEFAULT_CAPACITY_ESTIMATE = 40;

function extractTimes(slots: ResySlot[]): { first: string | null; last: string | null } {
	if (slots.length === 0) return { first: null, last: null };

	const sorted = [...slots].sort(
		(a, b) => a.date.start.localeCompare(b.date.start)
	);
	return {
		first: sorted[0].date.start,
		last: sorted[sorted.length - 1].date.start,
	};
}

export async function getCompetitorAvailability(
	locationId: string,
	date: string
): Promise<CompetitiveSnapshot> {
	const sb = getSupabaseService();
	const competitors = await getCompetitors(locationId);

	// Prefer stored data from the daily competitive-scan cron
	const compIds = competitors.map((c) => c.id);
	let storedByCompId: Record<string, { available_slots: number; total_slots: number; pct_booked: number; first_available_time: string | null; last_available_time: string | null }> = {};

	if (compIds.length > 0) {
		const { data: stored } = await sb
			.from('competitive_availability')
			.select('competitor_id,available_slots,total_slots,pct_booked,first_available_time,last_available_time')
			.in('competitor_id', compIds)
			.eq('check_date', date);
		for (const row of (stored ?? [])) {
			storedByCompId[row.competitor_id] = row;
		}
	}

	const availabilities: CompetitorAvailability[] = await Promise.all(
		competitors.map(async (comp) => {
			// Use stored scan result if available (avoids live Resy calls + rate limits)
			const stored = storedByCompId[comp.id];
			if (stored) {
				const capacity = Math.max(DEFAULT_CAPACITY_ESTIMATE, stored.total_slots);
				return {
					competitor: comp,
					availableSlots: stored.available_slots,
					firstAvailable: stored.first_available_time,
					lastAvailable: stored.last_available_time,
					estimatedCapacity: capacity,
					percentBooked: Math.min(1, stored.pct_booked),
					dataAvailable: true,
				};
			}

			// Fall back to live Resy fetch if no stored data for this date
			if (!comp.competitor_resy_id) {
				return {
					competitor: comp,
					availableSlots: 0,
					firstAvailable: null,
					lastAvailable: null,
					estimatedCapacity: DEFAULT_CAPACITY_ESTIMATE,
					percentBooked: 0,
					dataAvailable: false,
				};
			}

			const { slots, totalSlots } = await fetchResyAvailability(
				comp.competitor_resy_id,
				date
			);

			// Live fetch returned nothing — mark as unavailable rather than showing misleading 100%
			if (totalSlots === 0 && slots.length === 0) {
				return {
					competitor: comp,
					availableSlots: 0,
					firstAvailable: null,
					lastAvailable: null,
					estimatedCapacity: DEFAULT_CAPACITY_ESTIMATE,
					percentBooked: 0,
					dataAvailable: false,
				};
			}

			const times = extractTimes(slots);
			const capacity = Math.max(DEFAULT_CAPACITY_ESTIMATE, totalSlots);
			const booked = Math.max(0, capacity - totalSlots);
			const pctBooked = capacity > 0 ? booked / capacity : 0;

			return {
				competitor: comp,
				availableSlots: totalSlots,
				firstAvailable: times.first,
				lastAvailable: times.last,
				estimatedCapacity: capacity,
				percentBooked: Math.min(1, pctBooked),
				dataAvailable: true,
			};
		})
	);

	const demandSignal = computeDemandSignal(availabilities);

	return {
		locationId,
		date,
		competitors: availabilities,
		demandSignal,
		fetchedAt: new Date().toISOString(),
	};
}

// ---------------------------------------------------------------------------
// Demand Signal Computation
// ---------------------------------------------------------------------------

function computeDemandSignal(
	availabilities: CompetitorAvailability[]
): DemandSignal {
	const withResy = availabilities.filter(
		(a) => a.competitor.competitor_resy_id
	);

	if (withResy.length === 0) {
		return {
			level: 'medium',
			avgPercentBooked: 0,
			forecastAdjustmentPct: 0,
			summary: 'No competitors with Resy IDs configured.',
		};
	}

	const avgBooked =
		withResy.reduce((sum, a) => sum + a.percentBooked, 0) / withResy.length;

	let level: DemandSignal['level'];
	let adjustPct: number;
	let summary: string;

	if (avgBooked >= 0.8) {
		level = 'high';
		adjustPct = 0.03 + (avgBooked - 0.8) * 0.1; // 3-5%
		const fullyBooked = withResy.filter((a) => a.percentBooked >= 0.95).length;
		summary = `${fullyBooked} of ${withResy.length} competitors are nearly full. ` +
			`Market demand is strong — consider +${(adjustPct * 100).toFixed(1)}% forecast uplift.`;
	} else if (avgBooked >= 0.5) {
		level = 'medium';
		adjustPct = 0;
		summary = `Competitors are moderately booked (${(avgBooked * 100).toFixed(0)}% avg). ` +
			`Market demand is steady.`;
	} else {
		level = 'low';
		adjustPct = -0.02;
		summary = `Competitors have wide-open availability (${(avgBooked * 100).toFixed(0)}% avg). ` +
			`Potential demand weakness — monitor closely.`;
	}

	return {
		level,
		avgPercentBooked: avgBooked,
		forecastAdjustmentPct: adjustPct,
		summary,
	};
}

// ---------------------------------------------------------------------------
// Multi-day snapshot (next N days)
// ---------------------------------------------------------------------------

export async function getMultiDaySnapshot(
	locationId: string,
	startDate: string,
	days: number
): Promise<CompetitiveSnapshot[]> {
	const snapshots: CompetitiveSnapshot[] = [];
	const start = new Date(startDate + 'T12:00:00');

	for (let i = 0; i < days; i++) {
		const d = new Date(start);
		d.setDate(d.getDate() + i);
		const dateStr = d.toISOString().split('T')[0];
		const snap = await getCompetitorAvailability(locationId, dateStr);
		snapshots.push(snap);
	}

	return snapshots;
}
