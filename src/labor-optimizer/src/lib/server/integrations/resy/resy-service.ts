/**
 * Resy Reservation Service — CSV upload parser and daily_reservations upsert.
 *
 * Resy doesn't have a public API, so we support CSV uploads from the
 * Resy dashboard export. Parses reservation CSVs and aggregates to daily totals.
 */

import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedReservation {
	date: string;        // YYYY-MM-DD
	covers: number;
	status: 'booked' | 'walked_in' | 'no_show' | 'cancelled' | 'completed';
	partySize: number;
	time: string;        // HH:MM
}

export interface DailyReservationSummary {
	business_date: string;
	total_covers: number;
	booked_covers: number;
	walkin_covers: number;
	no_show_count: number;
	cancel_count: number;
	avg_party_size: number;
	peak_hour: string | null;
}

// ---------------------------------------------------------------------------
// CSV Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a Resy CSV export into reservation records.
 *
 * Expected columns (case-insensitive, flexible matching):
 * - Date / Reservation Date
 * - Covers / Party Size / Guests
 * - Status (booked, walked in, no-show, cancelled, completed)
 * - Time / Reservation Time
 */
export function parseResyCsv(csvContent: string): ParsedReservation[] {
	const lines = csvContent.trim().split('\n');
	if (lines.length < 2) return [];

	// Parse header
	const rawHeaders = parseCSVLine(lines[0]);
	const headers = rawHeaders.map(h => h.toLowerCase().trim());

	// Find column indices with flexible matching
	const dateIdx = findColumn(headers, ['date', 'reservation date', 'res date']);
	const coversIdx = findColumn(headers, ['covers', 'party size', 'guests', 'pax', 'party_size']);
	const statusIdx = findColumn(headers, ['status', 'reservation status', 'res status']);
	const timeIdx = findColumn(headers, ['time', 'reservation time', 'res time']);

	if (dateIdx === -1) {
		throw new Error('CSV must have a Date column');
	}

	const reservations: ParsedReservation[] = [];

	for (let i = 1; i < lines.length; i++) {
		const line = lines[i].trim();
		if (!line) continue;

		const cols = parseCSVLine(line);
		const rawDate = cols[dateIdx]?.trim();
		if (!rawDate) continue;

		const date = normalizeDate(rawDate);
		if (!date) continue;

		const partySize = coversIdx >= 0 ? parseInt(cols[coversIdx]) || 1 : 1;
		const rawStatus = statusIdx >= 0 ? cols[statusIdx]?.toLowerCase().trim() : 'booked';
		const status = normalizeStatus(rawStatus);
		const time = timeIdx >= 0 ? normalizeTime(cols[timeIdx]?.trim()) : '19:00';

		reservations.push({
			date,
			covers: partySize,
			status,
			partySize,
			time,
		});
	}

	return reservations;
}

/** Parse a single CSV line respecting quoted fields. */
function parseCSVLine(line: string): string[] {
	const result: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (ch === '"') {
			inQuotes = !inQuotes;
		} else if (ch === ',' && !inQuotes) {
			result.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	result.push(current);
	return result;
}

function findColumn(headers: string[], candidates: string[]): number {
	for (const c of candidates) {
		const idx = headers.indexOf(c);
		if (idx >= 0) return idx;
	}
	// Partial match
	for (const c of candidates) {
		const idx = headers.findIndex(h => h.includes(c));
		if (idx >= 0) return idx;
	}
	return -1;
}

function normalizeDate(raw: string): string | null {
	// Try ISO format first (YYYY-MM-DD)
	if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

	// Try MM/DD/YYYY or M/D/YYYY
	const mdyMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
	if (mdyMatch) {
		const [, m, d, y] = mdyMatch;
		return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
	}

	// Try parsing as Date
	const parsed = new Date(raw);
	if (!isNaN(parsed.getTime())) {
		return parsed.toISOString().split('T')[0];
	}

	return null;
}

function normalizeStatus(raw: string): ParsedReservation['status'] {
	if (!raw) return 'booked';
	const s = raw.replace(/[_\-\s]+/g, '').toLowerCase();
	if (s.includes('walkin') || s.includes('walked')) return 'walked_in';
	if (s.includes('noshow')) return 'no_show';
	if (s.includes('cancel')) return 'cancelled';
	if (s.includes('complete') || s.includes('seated') || s.includes('finished')) return 'completed';
	return 'booked';
}

function normalizeTime(raw: string): string {
	if (!raw) return '19:00';
	// Handle 12-hour format (7:30 PM)
	const match = raw.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
	if (match) {
		let hour = parseInt(match[1]);
		const min = match[2];
		const ampm = match[3]?.toLowerCase();
		if (ampm === 'pm' && hour < 12) hour += 12;
		if (ampm === 'am' && hour === 12) hour = 0;
		return `${String(hour).padStart(2, '0')}:${min}`;
	}
	return '19:00';
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate parsed reservations into daily summaries.
 */
export function aggregateByDay(
	reservations: ParsedReservation[],
): DailyReservationSummary[] {
	const byDate = new Map<string, ParsedReservation[]>();

	for (const r of reservations) {
		if (!byDate.has(r.date)) byDate.set(r.date, []);
		byDate.get(r.date)!.push(r);
	}

	const summaries: DailyReservationSummary[] = [];

	for (const [date, resos] of byDate) {
		const booked = resos.filter(r => r.status === 'booked' || r.status === 'completed');
		const walkins = resos.filter(r => r.status === 'walked_in');
		const noShows = resos.filter(r => r.status === 'no_show');
		const cancels = resos.filter(r => r.status === 'cancelled');

		const allActive = [...booked, ...walkins];
		const totalCovers = allActive.reduce((s, r) => s + r.covers, 0);
		const bookedCovers = booked.reduce((s, r) => s + r.covers, 0);
		const walkinCovers = walkins.reduce((s, r) => s + r.covers, 0);
		const avgPartySize = allActive.length > 0
			? allActive.reduce((s, r) => s + r.partySize, 0) / allActive.length
			: 0;

		// Find peak hour
		const hourCounts: Record<string, number> = {};
		for (const r of allActive) {
			const hour = r.time.split(':')[0];
			hourCounts[hour] = (hourCounts[hour] || 0) + r.covers;
		}
		const peakHour = Object.entries(hourCounts)
			.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

		summaries.push({
			business_date: date,
			total_covers: totalCovers,
			booked_covers: bookedCovers,
			walkin_covers: walkinCovers,
			no_show_count: noShows.length,
			cancel_count: cancels.length,
			avg_party_size: Math.round(avgPartySize * 100) / 100,
			peak_hour: peakHour ? `${peakHour}:00` : null,
		});
	}

	return summaries.sort((a, b) => a.business_date.localeCompare(b.business_date));
}

// ---------------------------------------------------------------------------
// Database Upsert
// ---------------------------------------------------------------------------

/**
 * Parse a Resy CSV, aggregate by day, and upsert into daily_reservations.
 */
export async function importResyCsv(
	locationId: string,
	csvContent: string,
): Promise<{ daysProcessed: number; totalCovers: number; error?: string }> {
	try {
		const reservations = parseResyCsv(csvContent);
		if (reservations.length === 0) {
			return { daysProcessed: 0, totalCovers: 0, error: 'No valid reservations found in CSV' };
		}

		const summaries = aggregateByDay(reservations);
		const sb = getSupabase();
		const now = new Date().toISOString();
		let totalCovers = 0;

		for (const summary of summaries) {
			const { error } = await sb.from('daily_reservations').upsert({
				location_id: locationId,
				business_date: summary.business_date,
				total_covers: summary.total_covers,
				booked_covers: summary.booked_covers,
				walkin_covers: summary.walkin_covers,
				no_show_count: summary.no_show_count,
				cancel_count: summary.cancel_count,
				avg_party_size: summary.avg_party_size,
				peak_hour: summary.peak_hour,
				synced_at: now,
			}, { onConflict: 'location_id,business_date' });

			if (error) {
				console.error(`[Resy] Upsert error for ${summary.business_date}:`, error.message);
			} else {
				totalCovers += summary.total_covers;
			}
		}

		return { daysProcessed: summaries.length, totalCovers };
	} catch (err: any) {
		return { daysProcessed: 0, totalCovers: 0, error: err.message };
	}
}

/**
 * Get reservation data for a specific date.
 */
export async function getReservationsForDate(
	locationId: string,
	date: string,
): Promise<DailyReservationSummary | null> {
	const sb = getSupabase();
	const { data } = await sb
		.from('daily_reservations')
		.select('*')
		.eq('location_id', locationId)
		.eq('business_date', date)
		.maybeSingle();
	return data;
}

/**
 * Get the historical walk-in ratio for a location.
 * Returns walkin_covers / total_covers over the last 90 days.
 */
export async function getHistoricalWalkinRatio(
	locationId: string,
): Promise<number> {
	const sb = getSupabase();
	const ninetyDaysAgo = new Date();
	ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
	const since = ninetyDaysAgo.toISOString().split('T')[0];

	const { data } = await sb
		.from('daily_reservations')
		.select('total_covers, walkin_covers')
		.eq('location_id', locationId)
		.gte('business_date', since)
		.gt('total_covers', 0);

	if (!data || data.length < 3) return 0.3; // default 30% walk-ins

	const totalAll = data.reduce((s, r) => s + r.total_covers, 0);
	const totalWalkin = data.reduce((s, r) => s + r.walkin_covers, 0);

	return totalAll > 0 ? totalWalkin / totalAll : 0.3;
}
