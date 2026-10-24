/**
 * Weather Service — Visual Crossing + OpenWeatherMap integration for forecast signals.
 *
 * Primary: Visual Crossing (free tier: 1000 records/day, 15-day forecast).
 * Fallback: OpenWeatherMap (free 5-day/3-hour forecast).
 * Stores daily high/low/condition/precipitation in daily_weather table.
 */

import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OWMForecastItem {
	dt: number;
	main: { temp_min: number; temp_max: number; humidity: number };
	weather: { id: number; main: string; description: string; icon: string }[];
	pop: number; // probability of precipitation 0-1
}

interface OWMForecastResponse {
	list: OWMForecastItem[];
	city: { name: string; timezone: number };
}

interface VCDay {
	datetime: string;        // YYYY-MM-DD
	tempmax: number;
	tempmin: number;
	conditions: string;
	precipprob: number;      // 0-100
	icon: string;
	description: string;
}

interface VCForecastResponse {
	days: VCDay[];
	resolvedAddress: string;
}

export interface DailyWeatherRow {
	location_id: string;
	business_date: string;
	temp_high: number | null;
	temp_low: number | null;
	condition: string | null;
	precipitation_pct: number | null;
	description: string | null;
	icon: string | null;
	synced_at: string;
}

// ---------------------------------------------------------------------------
// Location coordinates (hardcoded for now, can expand later)
// ---------------------------------------------------------------------------

const LOCATION_COORDS: Record<string, { lat: number; lon: number }> = {
	// Charleston, SC
	'f36fdb18-a97b-48af-8456-7374dea4b0f9': { lat: 32.7795, lon: -79.9311 }, // Lowland
	'580ae0a6-34b8-402e-a8a6-2e55310207e4': { lat: 32.7795, lon: -79.9311 }, // Rosemary Rose
	// Detroit, MI
	'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce': { lat: 42.3314, lon: -83.0458 }, // Le Supreme
	'b4035001-0928-4ada-a0f0-f2a272393147': { lat: 42.3314, lon: -83.0458 }, // HIROKI-SAN
	'b7d3e1a4-5f2c-4a8b-9e6d-1c3f5a7b9d2e': { lat: 42.3314, lon: -83.0458 }, // Kamper's
	'84f4ea7f-722d-4296-894b-6ecfe389b2d5': { lat: 42.3314, lon: -83.0458 }, // Anthology
	// Philadelphia, PA
	'23c02a8e-1425-441e-9650-73ae93fa68cc': { lat: 39.9735, lon: -75.1340 }, // Mulherin's
	'c21aa6c1-411e-4ed1-9b84-e9d9d143abf9': { lat: 39.9735, lon: -75.1340 }, // HIROKI Philly
	// Wilmington, DE
	'0eefcab2-d68d-4a2f-ae30-009b999258c7': { lat: 39.7447, lon: -75.5484 }, // The Quoin
	// Baltimore, MD
	'574118d5-8511-41ce-8ae8-14f921fb021a': { lat: 39.2904, lon: -76.6122 }, // Little Wing
	'd201e1aa-a2a7-420d-8112-91160d0bc1bc': { lat: 39.2904, lon: -76.6122 }, // Vessel
	// Fallback
	default: { lat: 32.7795, lon: -79.9311 },
};

// ---------------------------------------------------------------------------
// Visual Crossing Mappings
// ---------------------------------------------------------------------------

const VC_ICON_TO_OWM: Record<string, string> = {
	'clear-day': '01d',
	'clear-night': '01n',
	'partly-cloudy-day': '02d',
	'partly-cloudy-night': '02n',
	'cloudy': '04d',
	'rain': '10d',
	'snow': '13d',
	'fog': '50d',
	'wind': '50d',
	'thunder-rain': '11d',
	'thunder-showers-day': '11d',
	'thunder-showers-night': '11n',
	'showers-day': '09d',
	'showers-night': '09n',
	'snow-showers-day': '13d',
	'snow-showers-night': '13n',
	'sleet': '13d',
};

/** Map Visual Crossing conditions string to our standard condition name. */
function mapVCCondition(conditions: string): string {
	const c = conditions.toLowerCase();
	if (c.includes('thunder')) return 'Thunderstorm';
	if (c.includes('snow') || c.includes('ice') || c.includes('sleet')) return 'Snow';
	if (c.includes('rain') || c.includes('drizzle') || c.includes('shower')) return 'Rain';
	if (c.includes('fog') || c.includes('mist') || c.includes('haze')) return 'Fog';
	if (c.includes('cloud') || c.includes('overcast')) return 'Clouds';
	if (c.includes('clear')) return 'Clear';
	return 'Clouds'; // safe default
}

// ---------------------------------------------------------------------------
// Visual Crossing Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch up to 15-day forecast from Visual Crossing.
 * Returns daily entries keyed by YYYY-MM-DD.
 */
async function fetchVisualCrossingForecast(
	lat: number,
	lon: number,
	apiKey: string,
): Promise<Map<string, DailyWeatherRow>> {
	const location = `${lat},${lon}`;
	const url =
		`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/` +
		`${location}?unitGroup=us&key=${apiKey}&include=days&contentType=json`;
	const res = await fetch(url);

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Visual Crossing API error ${res.status}: ${text}`);
	}

	const data: VCForecastResponse = await res.json();
	const result = new Map<string, DailyWeatherRow>();
	const now = new Date().toISOString();

	for (const day of data.days) {
		result.set(day.datetime, {
			location_id: '', // filled by caller
			business_date: day.datetime,
			temp_high: Math.round(day.tempmax * 10) / 10,
			temp_low: Math.round(day.tempmin * 10) / 10,
			condition: mapVCCondition(day.conditions),
			precipitation_pct: Math.round((day.precipprob ?? 0) * 100) / 100,
			description: day.description ?? day.conditions,
			icon: VC_ICON_TO_OWM[day.icon] ?? '03d',
			synced_at: now,
		});
	}

	return result;
}

// ---------------------------------------------------------------------------
// OpenWeatherMap Fetch
// ---------------------------------------------------------------------------

/**
 * Fetch 5-day forecast from OpenWeatherMap and aggregate to daily summaries.
 * Returns daily entries keyed by YYYY-MM-DD.
 */
async function fetchForecast(
	lat: number,
	lon: number,
	apiKey: string,
): Promise<Map<string, DailyWeatherRow>> {
	const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`;
	const res = await fetch(url);

	if (!res.ok) {
		const text = await res.text();
		throw new Error(`OpenWeatherMap API error ${res.status}: ${text}`);
	}

	const data: OWMForecastResponse = await res.json();
	const dailyMap = new Map<string, {
		highs: number[];
		lows: number[];
		pops: number[];
		conditions: string[];
		descriptions: string[];
		icons: string[];
	}>();

	for (const item of data.list) {
		const date = new Date(item.dt * 1000).toISOString().split('T')[0];
		if (!dailyMap.has(date)) {
			dailyMap.set(date, {
				highs: [], lows: [], pops: [],
				conditions: [], descriptions: [], icons: [],
			});
		}
		const day = dailyMap.get(date)!;
		day.highs.push(item.main.temp_max);
		day.lows.push(item.main.temp_min);
		day.pops.push(item.pop);
		if (item.weather.length > 0) {
			day.conditions.push(item.weather[0].main);
			day.descriptions.push(item.weather[0].description);
			day.icons.push(item.weather[0].icon);
		}
	}

	const result = new Map<string, DailyWeatherRow>();
	const now = new Date().toISOString();

	for (const [date, agg] of dailyMap) {
		// Pick the most common condition
		const conditionCounts: Record<string, number> = {};
		for (const c of agg.conditions) {
			conditionCounts[c] = (conditionCounts[c] || 0) + 1;
		}
		const topCondition = Object.entries(conditionCounts)
			.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

		// Pick the matching description and icon
		const condIdx = agg.conditions.indexOf(topCondition ?? '');
		const description = condIdx >= 0 ? agg.descriptions[condIdx] : null;
		const icon = condIdx >= 0 ? agg.icons[condIdx] : null;

		result.set(date, {
			location_id: '', // filled by caller
			business_date: date,
			temp_high: Math.round(Math.max(...agg.highs) * 10) / 10,
			temp_low: Math.round(Math.min(...agg.lows) * 10) / 10,
			condition: topCondition,
			precipitation_pct: Math.round(Math.max(...agg.pops) * 100 * 100) / 100,
			description,
			icon,
			synced_at: now,
		});
	}

	return result;
}

/**
 * Upsert a daily weather map into Supabase for a location.
 * Past dates are only inserted if no row exists yet (preserving historical actuals).
 */
async function upsertDailyWeather(
	locationId: string,
	dailyMap: Map<string, DailyWeatherRow>,
): Promise<{ upserted: number; skipped: number }> {
	const sb = getSupabase();
	const today = new Date().toISOString().split('T')[0];
	let upserted = 0;
	let skipped = 0;

	for (const [date, row] of dailyMap) {
		// Never overwrite past weather — it represents the actual conditions
		if (date < today) {
			const { data: existing } = await sb
				.from('daily_weather')
				.select('business_date')
				.eq('location_id', locationId)
				.eq('business_date', date)
				.maybeSingle();
			if (existing) {
				skipped++;
				continue;
			}
		}

		row.location_id = locationId;
		const { error } = await sb
			.from('daily_weather')
			.upsert(row, { onConflict: 'location_id,business_date' });
		if (!error) upserted++;
	}

	return { upserted, skipped };
}

/**
 * Sync weather data for a location.
 *
 * Strategy:
 *   1. Try Visual Crossing first (15-day forecast on free tier).
 *   2. Fall back to OpenWeatherMap (5-day forecast) if VC fails or key not set.
 *
 * IMPORTANT: Only upserts rows for today and future dates. Past dates are
 * left untouched so that yesterday's forecast (which is the closest we have
 * to actual weather on the free tier) is preserved as historical data.
 */
export async function syncWeather(locationId: string): Promise<{
	daysUpserted: number;
	daysSkipped: number;
	provider?: string;
	error?: string;
}> {
	const coords = LOCATION_COORDS[locationId] || LOCATION_COORDS.default;
	const vcKey = process.env.VISUAL_CROSSING_API_KEY;
	const owmKey = process.env.OPENWEATHER_API_KEY;

	// --- Try Visual Crossing first ---
	if (vcKey) {
		try {
			const dailyMap = await fetchVisualCrossingForecast(coords.lat, coords.lon, vcKey);
			const { upserted, skipped } = await upsertDailyWeather(locationId, dailyMap);
			console.log(`[Weather] Visual Crossing synced ${upserted} days for ${locationId}`);
			return { daysUpserted: upserted, daysSkipped: skipped, provider: 'visual-crossing' };
		} catch (err: any) {
			console.warn(`[Weather] Visual Crossing failed, falling back to OWM: ${err.message}`);
		}
	}

	// --- Fallback to OpenWeatherMap ---
	if (!owmKey) {
		return {
			daysUpserted: 0,
			daysSkipped: 0,
			error: 'No weather API key set (VISUAL_CROSSING_API_KEY or OPENWEATHER_API_KEY)',
		};
	}

	try {
		const dailyMap = await fetchForecast(coords.lat, coords.lon, owmKey);
		const { upserted, skipped } = await upsertDailyWeather(locationId, dailyMap);
		console.log(`[Weather] OpenWeatherMap synced ${upserted} days for ${locationId}`);
		return { daysUpserted: upserted, daysSkipped: skipped, provider: 'openweathermap' };
	} catch (err: any) {
		console.error('[Weather] Sync failed:', err.message);
		return { daysUpserted: 0, daysSkipped: 0, error: err.message };
	}
}

/**
 * Get weather data for a specific date and location.
 */
export async function getWeatherForDate(
	locationId: string,
	date: string,
): Promise<DailyWeatherRow | null> {
	const sb = getSupabase();
	const { data } = await sb
		.from('daily_weather')
		.select('*')
		.eq('location_id', locationId)
		.eq('business_date', date)
		.maybeSingle();
	return data;
}

/**
 * Compute the historical weather impact on revenue for a given DOW.
 * Returns a multiplier (e.g., 0.88 means rainy days see 12% less revenue).
 */
export async function getWeatherImpactFactor(
	locationId: string,
	dayOfWeek: number,
): Promise<{ rainyMultiplier: number; dataPoints: number } | null> {
	const sb = getSupabase();
	const ninetyDaysAgo = new Date();
	ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
	const since = ninetyDaysAgo.toISOString().split('T')[0];

	// Join weather with actuals for the last 90 days
	const { data: weatherRows } = await sb
		.from('daily_weather')
		.select('business_date, precipitation_pct, condition')
		.eq('location_id', locationId)
		.gte('business_date', since);

	if (!weatherRows || weatherRows.length === 0) return null;

	const { data: actualsRows } = await sb
		.from('daily_actuals')
		.select('business_date, revenue')
		.eq('location_id', locationId)
		.gte('business_date', since)
		.gt('revenue', 0);

	if (!actualsRows || actualsRows.length < 7) return null;

	// Build lookup
	const weatherMap = new Map(weatherRows.map(w => [w.business_date, w]));
	const rainyRevenues: number[] = [];
	const clearRevenues: number[] = [];

	for (const actual of actualsRows) {
		const d = new Date(actual.business_date + 'T12:00:00');
		if (d.getDay() !== dayOfWeek) continue;

		const w = weatherMap.get(actual.business_date);
		if (!w) continue;

		const isRainy = (w.precipitation_pct ?? 0) > 40 ||
			['Rain', 'Thunderstorm', 'Drizzle', 'Snow'].includes(w.condition ?? '');

		if (isRainy) {
			rainyRevenues.push(actual.revenue);
		} else {
			clearRevenues.push(actual.revenue);
		}
	}

	if (rainyRevenues.length < 2 || clearRevenues.length < 2) return null;

	const avgRainy = rainyRevenues.reduce((a, b) => a + b, 0) / rainyRevenues.length;
	const avgClear = clearRevenues.reduce((a, b) => a + b, 0) / clearRevenues.length;

	return {
		rainyMultiplier: avgClear > 0 ? avgRainy / avgClear : 1.0,
		dataPoints: rainyRevenues.length + clearRevenues.length,
	};
}
