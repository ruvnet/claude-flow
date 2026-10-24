import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase } from '$lib/server/supabase';
import { getCached, setCache } from '$lib/server/cache';

export const config = { maxDuration: 10 };

const CACHE_KEY = 'health-check';
const CACHE_TTL = 300; // 5 minutes
const STALE_HOURS = 26;

interface CronDetail {
	lastRun: string | null;
	isStale: boolean;
}

interface HealthResult {
	status: 'healthy' | 'degraded' | 'down';
	timestamp: string;
	checks: {
		database: { status: 'ok' | 'error'; activeLocations?: number };
		crons: { status: 'ok' | 'warning' | 'error'; details: Record<string, CronDetail> };
		dataFreshness: { status: 'ok' | 'warning'; lastSync: string | null };
	};
}

export const GET: RequestHandler = async () => {
	const cached = getCached<HealthResult>(CACHE_KEY);
	if (cached) {
		const httpStatus = cached.status === 'healthy' ? 200 : 503;
		return json(cached, { status: httpStatus });
	}

	const sb = getSupabase();
	const now = new Date();
	const staleThreshold = new Date(now.getTime() - STALE_HOURS * 60 * 60 * 1000).toISOString();

	// --- Database connectivity ---
	let dbCheck: HealthResult['checks']['database'];
	try {
		const { count, error } = await sb
			.from('locations')
			.select('*', { count: 'exact', head: true })
			.eq('is_active', true);

		if (error) throw error;
		dbCheck = { status: 'ok', activeLocations: count ?? 0 };
	} catch {
		dbCheck = { status: 'error' };
	}

	// --- Cron health ---
	const criticalCrons = ['toast_sync_cron', 'data_integrity_cron', 'daily_refresh_cron'];
	const cronDetails: Record<string, CronDetail> = {};
	let cronStatus: 'ok' | 'warning' | 'error' = 'ok';

	try {
		const { data, error } = await sb
			.from('system_health')
			.select('cron_name, last_run_at')
			.in('cron_name', criticalCrons);

		if (error) throw error;

		const runMap = new Map<string, string>();
		for (const row of data ?? []) {
			runMap.set(row.cron_name, row.last_run_at);
		}

		for (const name of criticalCrons) {
			const lastRun = runMap.get(name) ?? null;
			const isStale = !lastRun || lastRun < staleThreshold;
			cronDetails[name] = { lastRun, isStale };
			if (isStale) cronStatus = 'warning';
		}
	} catch {
		for (const name of criticalCrons) {
			cronDetails[name] = { lastRun: null, isStale: true };
		}
		cronStatus = 'error';
	}

	// --- Data freshness ---
	let freshnessCheck: HealthResult['checks']['dataFreshness'];
	try {
		const { data, error } = await sb
			.from('daily_actuals')
			.select('synced_at')
			.not('synced_at', 'is', null)
			.order('synced_at', { ascending: false })
			.limit(1)
			.single();

		if (error) throw error;

		const lastSync = data?.synced_at ?? null;
		const isStale = !lastSync || lastSync < staleThreshold;
		freshnessCheck = { status: isStale ? 'warning' : 'ok', lastSync };
	} catch {
		freshnessCheck = { status: 'warning', lastSync: null };
	}

	// --- Overall status ---
	let overallStatus: HealthResult['status'] = 'healthy';
	if (dbCheck.status === 'error') {
		overallStatus = 'down';
	} else if (cronStatus !== 'ok' || freshnessCheck.status !== 'ok') {
		overallStatus = 'degraded';
	}

	const result: HealthResult = {
		status: overallStatus,
		timestamp: now.toISOString(),
		checks: {
			database: dbCheck,
			crons: { status: cronStatus, details: cronDetails },
			dataFreshness: freshnessCheck
		}
	};

	setCache(CACHE_KEY, result, CACHE_TTL);

	const httpStatus = overallStatus === 'healthy' ? 200 : 503;
	return json(result, { status: httpStatus });
};
