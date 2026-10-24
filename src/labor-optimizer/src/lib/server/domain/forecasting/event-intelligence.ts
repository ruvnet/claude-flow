/**
 * Event & Calendar Intelligence — pulls external event data to predict
 * revenue spikes/dips from local events, holidays, and festivals.
 *
 * Sources:
 *   1. Ticketmaster Discovery API (free tier, 5000 calls/day)
 *   2. PredictHQ API (free tier, aggregated impact scores)
 *   3. Hardcoded US holiday calendar (fallback)
 */

import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EventEntry {
	name: string;
	venue: string | null;
	capacity: number | null;
	distanceMiles: number | null;
	impactScore: number;
	source: string;
	eventType: string | null;
}

export interface EventImpactResult {
	events: EventEntry[];
	impactMultiplier: number;
	reasoning: string;
}

// ---------------------------------------------------------------------------
// Location coordinates (matches weather-service pattern)
// ---------------------------------------------------------------------------

const LOCATION_COORDS: Record<string, { lat: number; lon: number; city: string }> = {
	default: { lat: 32.7765, lon: -79.9311, city: 'Charleston' },
};

const CACHE_HOURS = 12; // refresh event cache every 12 hours

// ---------------------------------------------------------------------------
// Holiday Calendar (US federal + restaurant-significant)
// ---------------------------------------------------------------------------

interface HolidayDef {
	name: string;
	impactMultiplier: number;
	type: string;
}

function getFixedHolidays(year: number): Record<string, HolidayDef> {
	return {
		[`${year}-01-01`]: { name: "New Year's Day", impactMultiplier: 0.70, type: 'holiday' },
		[`${year}-02-14`]: { name: "Valentine's Day", impactMultiplier: 1.35, type: 'holiday' },
		[`${year}-03-17`]: { name: "St. Patrick's Day", impactMultiplier: 1.15, type: 'holiday' },
		[`${year}-04-20`]: { name: 'Easter Sunday (approx)', impactMultiplier: 1.10, type: 'holiday' },
		[`${year}-05-05`]: { name: 'Cinco de Mayo', impactMultiplier: 1.10, type: 'holiday' },
		[`${year}-07-04`]: { name: 'Independence Day', impactMultiplier: 1.20, type: 'holiday' },
		[`${year}-10-31`]: { name: 'Halloween', impactMultiplier: 1.15, type: 'holiday' },
		[`${year}-11-27`]: { name: 'Thanksgiving (approx)', impactMultiplier: 0.60, type: 'holiday' },
		[`${year}-12-24`]: { name: 'Christmas Eve', impactMultiplier: 0.85, type: 'holiday' },
		[`${year}-12-25`]: { name: 'Christmas Day', impactMultiplier: 0.40, type: 'holiday' },
		[`${year}-12-31`]: { name: "New Year's Eve", impactMultiplier: 1.40, type: 'holiday' },
	};
}

/** Compute-based holidays (Mother's Day = 2nd Sunday in May, etc.) */
function getComputedHolidays(year: number): Record<string, HolidayDef> {
	const result: Record<string, HolidayDef> = {};

	// Mother's Day — 2nd Sunday in May
	const mayFirst = new Date(year, 4, 1);
	const firstSunday = 1 + ((7 - mayFirst.getDay()) % 7);
	const mothersDayDate = new Date(year, 4, firstSunday + 7);
	const md = mothersDayDate.toISOString().split('T')[0];
	result[md] = { name: "Mother's Day", impactMultiplier: 1.30, type: 'holiday' };

	// Father's Day — 3rd Sunday in June
	const juneFirst = new Date(year, 5, 1);
	const junFirstSun = 1 + ((7 - juneFirst.getDay()) % 7);
	const fathersDayDate = new Date(year, 5, junFirstSun + 14);
	const fd = fathersDayDate.toISOString().split('T')[0];
	result[fd] = { name: "Father's Day", impactMultiplier: 1.20, type: 'holiday' };

	// Memorial Day — last Monday in May
	const mayLast = new Date(year, 5, 0); // last day of May
	const memDay = new Date(mayLast);
	while (memDay.getDay() !== 1) memDay.setDate(memDay.getDate() - 1);
	result[memDay.toISOString().split('T')[0]] = {
		name: 'Memorial Day', impactMultiplier: 1.10, type: 'holiday',
	};

	// Labor Day — 1st Monday in September
	const sepFirst = new Date(year, 8, 1);
	const laborDay = new Date(sepFirst);
	while (laborDay.getDay() !== 1) laborDay.setDate(laborDay.getDate() + 1);
	result[laborDay.toISOString().split('T')[0]] = {
		name: 'Labor Day', impactMultiplier: 1.10, type: 'holiday',
	};

	return result;
}

function getAllHolidays(date: string): HolidayDef | null {
	const year = parseInt(date.substring(0, 4), 10);
	const fixed = getFixedHolidays(year);
	const computed = getComputedHolidays(year);
	return fixed[date] || computed[date] || null;
}

// ---------------------------------------------------------------------------
// Ticketmaster Discovery API
// ---------------------------------------------------------------------------

interface TmEvent {
	name: string;
	type: string;
	dates: { start: { localDate: string } };
	_embedded?: {
		venues?: {
			name: string;
			location?: { longitude: string; latitude: string };
			upcomingEvents?: { _total: number };
		}[];
	};
}

async function fetchTicketmasterEvents(
	lat: number,
	lon: number,
	date: string,
	radiusMiles: number = 15,
): Promise<EventEntry[]> {
	const apiKey = process.env.TICKETMASTER_API_KEY;
	if (!apiKey) return [];

	try {
		const url = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
		url.searchParams.set('apikey', apiKey);
		url.searchParams.set('latlong', `${lat},${lon}`);
		url.searchParams.set('radius', String(radiusMiles));
		url.searchParams.set('unit', 'miles');
		url.searchParams.set('startDateTime', `${date}T00:00:00Z`);
		url.searchParams.set('endDateTime', `${date}T23:59:59Z`);
		url.searchParams.set('size', '20');
		url.searchParams.set('sort', 'relevance,desc');

		const res = await fetch(url.toString());
		if (!res.ok) return [];

		const data = await res.json();
		const tmEvents: TmEvent[] = data?._embedded?.events || [];

		return tmEvents.map((ev) => {
			const venue = ev._embedded?.venues?.[0];
			const venueName = venue?.name || null;
			const capacity = venue?.upcomingEvents?._total || null;

			let distanceMiles: number | null = null;
			if (venue?.location?.latitude && venue?.location?.longitude) {
				distanceMiles = haversineDistance(
					lat, lon,
					parseFloat(venue.location.latitude),
					parseFloat(venue.location.longitude),
				);
			}

			const score = computeEventScore(capacity, distanceMiles);

			return {
				name: ev.name,
				venue: venueName,
				capacity,
				distanceMiles: distanceMiles ? Math.round(distanceMiles * 10) / 10 : null,
				impactScore: score,
				source: 'ticketmaster',
				eventType: ev.type?.toLowerCase() || null,
			};
		});
	} catch (err: any) {
		console.error('[EventIntel] Ticketmaster fetch failed:', err.message);
		return [];
	}
}

// ---------------------------------------------------------------------------
// PredictHQ API
// ---------------------------------------------------------------------------

async function fetchPredictHQEvents(
	lat: number,
	lon: number,
	date: string,
	radiusKm: number = 25,
): Promise<EventEntry[]> {
	const token = process.env.PREDICTHQ_ACCESS_TOKEN;
	if (!token) return [];

	try {
		const url = new URL('https://api.predicthq.com/v1/events/');
		url.searchParams.set('within', `${radiusKm}km@${lat},${lon}`);
		url.searchParams.set('active.gte', date);
		url.searchParams.set('active.lte', date);
		url.searchParams.set('limit', '20');
		url.searchParams.set('sort', 'rank');
		url.searchParams.set('category', 'concerts,festivals,sports,performing-arts,community,conferences');

		const res = await fetch(url.toString(), {
			headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
		});
		if (!res.ok) return [];

		const data = await res.json();
		const phqEvents = data?.results || [];

		return phqEvents.map((ev: any) => {
			const evLat = ev.location?.[1];
			const evLon = ev.location?.[0];
			let distanceMiles: number | null = null;
			if (evLat && evLon) {
				distanceMiles = haversineDistance(lat, lon, evLat, evLon);
			}

			const phqRank = ev.phq_attendance || ev.rank || 0;
			const score = computeEventScore(phqRank, distanceMiles);

			return {
				name: ev.title || ev.label || 'Unknown Event',
				venue: ev.entities?.[0]?.name || null,
				capacity: phqRank || null,
				distanceMiles: distanceMiles ? Math.round(distanceMiles * 10) / 10 : null,
				impactScore: score,
				source: 'predicthq',
				eventType: ev.category || null,
			};
		});
	} catch (err: any) {
		console.error('[EventIntel] PredictHQ fetch failed:', err.message);
		return [];
	}
}

// ---------------------------------------------------------------------------
// Scoring Helpers
// ---------------------------------------------------------------------------

/** Haversine distance in miles between two lat/lon points. */
function haversineDistance(
	lat1: number, lon1: number, lat2: number, lon2: number,
): number {
	const R = 3959; // Earth radius in miles
	const dLat = (lat2 - lat1) * Math.PI / 180;
	const dLon = (lon2 - lon1) * Math.PI / 180;
	const a = Math.sin(dLat / 2) ** 2 +
		Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
		Math.sin(dLon / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Compute impact score (0-1) based on event capacity and distance.
 * - Within 1 mile + large capacity => highest impact
 * - Large events (>5000) in the city => moderate impact
 */
function computeEventScore(
	capacity: number | null,
	distanceMiles: number | null,
): number {
	let score = 0;
	const cap = capacity || 0;
	const dist = distanceMiles ?? 10;

	// Capacity component (0 to 0.5)
	if (cap >= 20000) score += 0.50;
	else if (cap >= 10000) score += 0.40;
	else if (cap >= 5000) score += 0.30;
	else if (cap >= 1000) score += 0.20;
	else if (cap >= 200) score += 0.10;
	else score += 0.05;

	// Distance component (0 to 0.5)
	if (dist <= 0.5) score += 0.50;
	else if (dist <= 1) score += 0.40;
	else if (dist <= 3) score += 0.25;
	else if (dist <= 5) score += 0.15;
	else if (dist <= 10) score += 0.08;
	else score += 0.03;

	return Math.min(1.0, Math.round(score * 100) / 100);
}

/** Convert aggregate event score to a revenue multiplier. */
function scoreToMultiplier(aggregateScore: number): number {
	// Scale: 0 score => 1.0x, 1.0 score => 1.15x (capped)
	if (aggregateScore <= 0) return 1.0;
	const mult = 1.0 + (aggregateScore * 0.15);
	return Math.min(1.20, Math.round(mult * 1000) / 1000);
}

// ---------------------------------------------------------------------------
// Cache Layer
// ---------------------------------------------------------------------------

async function getCachedEvents(
	locationId: string,
	date: string,
): Promise<EventEntry[] | null> {
	const sb = getSupabase();
	const cutoff = new Date();
	cutoff.setHours(cutoff.getHours() - CACHE_HOURS);

	const { data: rows } = await sb
		.from('event_calendar')
		.select('event_name, venue, capacity, distance_miles, impact_score, source, event_type, cached_at')
		.eq('location_id', locationId)
		.eq('event_date', date);

	if (!rows || rows.length === 0) return null;

	// Check freshness — if any row was cached after cutoff, use cache
	const freshEnough = rows.some(
		(r) => new Date(r.cached_at) >= cutoff,
	);
	if (!freshEnough) return null;

	return rows.map((r) => ({
		name: r.event_name,
		venue: r.venue,
		capacity: r.capacity,
		distanceMiles: r.distance_miles ? Number(r.distance_miles) : null,
		impactScore: Number(r.impact_score),
		source: r.source,
		eventType: r.event_type,
	}));
}

async function cacheEvents(
	locationId: string,
	date: string,
	events: EventEntry[],
): Promise<void> {
	const sb = getSupabase();
	const now = new Date().toISOString();

	// Delete stale entries for this location + date
	await sb
		.from('event_calendar')
		.delete()
		.eq('location_id', locationId)
		.eq('event_date', date)
		.neq('source', 'holiday'); // keep holiday entries

	// Insert fresh entries
	const rows = events.map((ev) => ({
		location_id: locationId,
		event_date: date,
		event_name: ev.name,
		venue: ev.venue,
		capacity: ev.capacity,
		distance_miles: ev.distanceMiles,
		impact_score: ev.impactScore,
		source: ev.source,
		event_type: ev.eventType,
		cached_at: now,
	}));

	if (rows.length > 0) {
		await sb
			.from('event_calendar')
			.upsert(rows, { onConflict: 'location_id,event_date,event_name,source' });
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get event impact for a location on a specific date.
 *
 * Queries Ticketmaster, PredictHQ, and the holiday calendar, then computes
 * an aggregate impact multiplier for the revenue forecast.
 */
export async function getEventImpact(
	locationId: string,
	date: string,
): Promise<EventImpactResult> {
	const allEvents: EventEntry[] = [];
	const reasonParts: string[] = [];

	// 1. Check holiday calendar first (no API call needed)
	const holiday = getAllHolidays(date);
	if (holiday) {
		allEvents.push({
			name: holiday.name,
			venue: null,
			capacity: null,
			distanceMiles: null,
			impactScore: Math.abs(holiday.impactMultiplier - 1),
			source: 'holiday',
			eventType: holiday.type,
		});

		const pct = Math.round((holiday.impactMultiplier - 1) * 100);
		const dir = pct >= 0 ? '+' : '';
		reasonParts.push(`${holiday.name} (${dir}${pct}% historical impact)`);

		return {
			events: allEvents,
			impactMultiplier: holiday.impactMultiplier,
			reasoning: reasonParts.join(' | '),
		};
	}

	// 2. Check cache
	const cached = await getCachedEvents(locationId, date);
	if (cached && cached.length > 0) {
		return buildResult(cached);
	}

	// 3. Fetch from APIs in parallel
	const coords = LOCATION_COORDS.default;
	const [tmEvents, phqEvents] = await Promise.all([
		fetchTicketmasterEvents(coords.lat, coords.lon, date),
		fetchPredictHQEvents(coords.lat, coords.lon, date),
	]);

	const freshEvents = [...tmEvents, ...phqEvents];

	// Deduplicate by name similarity
	const deduped = deduplicateEvents(freshEvents);

	// Cache results
	await cacheEvents(locationId, date, deduped);

	return buildResult(deduped);
}

function buildResult(events: EventEntry[]): EventImpactResult {
	if (events.length === 0) {
		return { events: [], impactMultiplier: 1.0, reasoning: 'No notable events' };
	}

	// Aggregate: take the max single-event score, then add diminishing returns for extras
	const sorted = [...events].sort((a, b) => b.impactScore - a.impactScore);
	let aggregateScore = sorted[0].impactScore;
	for (let i = 1; i < sorted.length; i++) {
		aggregateScore += sorted[i].impactScore * (0.3 / i); // diminishing
	}
	aggregateScore = Math.min(1.0, aggregateScore);

	const multiplier = scoreToMultiplier(aggregateScore);
	const pct = Math.round((multiplier - 1) * 100);
	const topEvents = sorted.slice(0, 3);
	const names = topEvents.map((e) => {
		const venue = e.venue ? ` at ${e.venue}` : '';
		const cap = e.capacity ? ` (~${e.capacity.toLocaleString()} cap)` : '';
		return `${e.name}${venue}${cap}`;
	});

	const reasoning = pct !== 0
		? `${events.length} event(s): ${names.join('; ')} -- est. ${pct >= 0 ? '+' : ''}${pct}% impact`
		: `${events.length} event(s) nearby but minimal impact`;

	return { events, impactMultiplier: multiplier, reasoning };
}

/** Simple deduplication by checking name similarity. */
function deduplicateEvents(events: EventEntry[]): EventEntry[] {
	const seen = new Map<string, EventEntry>();
	for (const ev of events) {
		const key = ev.name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 30);
		const existing = seen.get(key);
		if (!existing || ev.impactScore > existing.impactScore) {
			seen.set(key, ev);
		}
	}
	return Array.from(seen.values());
}
