/**
 * Cross-Location Clustering — groups locations by profile for cross-learning.
 *
 * Extracted from cross-location.ts to keep files under 500 lines.
 * Clusters by revenue tier, concept type, city/market, and DOW pattern similarity.
 */

import { getSupabase } from '$lib/server/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LocationCluster {
	locationId: string;
	clusterName: string;
	clusterType: 'revenue_tier' | 'concept' | 'market' | 'dow_pattern';
	confidence: number;
}

// ---------------------------------------------------------------------------
// Location Clustering
// ---------------------------------------------------------------------------

/**
 * Cluster all active locations by revenue tier, concept type, city/market,
 * and DOW pattern similarity. Results are upserted to location_clusters.
 */
export async function clusterLocations(): Promise<LocationCluster[]> {
	const sb = getSupabase();
	const clusters: LocationCluster[] = [];

	// Fetch all active locations
	const { data: locations } = await sb
		.from('locations')
		.select('id, name, type, timezone')
		.eq('is_active', true);

	if (!locations || locations.length === 0) return clusters;

	// Fetch 90-day average daily revenue per location
	const ninetyDaysAgo = new Date();
	ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
	const sinceDate = ninetyDaysAgo.toISOString().split('T')[0];

	const { data: revenueRows } = await sb
		.from('daily_actuals')
		.select('location_id, revenue, business_date')
		.gte('business_date', sinceDate)
		.gt('revenue', 0);

	// Group revenue by location
	const revByLoc = new Map<string, number[]>();
	for (const r of revenueRows || []) {
		const arr = revByLoc.get(r.location_id) || [];
		arr.push(Number(r.revenue));
		revByLoc.set(r.location_id, arr);
	}

	// --- Revenue Tier Clustering ---
	for (const loc of locations) {
		const revs = revByLoc.get(loc.id) || [];
		const avgDaily = revs.length > 0
			? revs.reduce((a, b) => a + b, 0) / revs.length
			: 0;

		let tier: string;
		let confidence: number;

		if (avgDaily > 20_000) {
			tier = 'high';
			confidence = revs.length >= 30 ? 0.9 : 0.6;
		} else if (avgDaily >= 10_000) {
			tier = 'mid';
			confidence = revs.length >= 30 ? 0.85 : 0.55;
		} else {
			tier = 'low';
			confidence = revs.length >= 30 ? 0.8 : 0.5;
		}

		clusters.push({
			locationId: loc.id,
			clusterName: tier,
			clusterType: 'revenue_tier',
			confidence,
		});
	}

	// --- Concept Type Clustering ---
	for (const loc of locations) {
		const conceptType = inferConceptType(loc.type, loc.name);
		clusters.push({
			locationId: loc.id,
			clusterName: conceptType,
			clusterType: 'concept',
			confidence: 0.85,
		});
	}

	// --- Market (City) Clustering ---
	for (const loc of locations) {
		const market = inferMarket(loc.timezone, loc.name);
		clusters.push({
			locationId: loc.id,
			clusterName: market,
			clusterType: 'market',
			confidence: 0.95,
		});
	}

	// --- DOW Pattern Similarity ---
	await clusterByDowPattern(locations, clusters);

	// Persist clusters via upsert
	await persistClusters(clusters);

	return clusters;
}

// ---------------------------------------------------------------------------
// Concept & Market Inference
// ---------------------------------------------------------------------------

/**
 * Infer concept type from location type field and name heuristics.
 */
function inferConceptType(locType: string, locName: string): string {
	const t = (locType || '').toLowerCase();
	const n = (locName || '').toLowerCase();

	if (t.includes('fine') || n.includes('supreme')) return 'fine_dining';
	if (t.includes('bar') || n.includes('bar') || n.includes('lowland')) return 'bar_forward';
	if (t.includes('cafe') || t.includes('coffee') || n.includes('cafe')) return 'cafe';
	return 'casual';
}

/**
 * Infer market/city from timezone and name patterns.
 */
function inferMarket(timezone: string, locName: string): string {
	const n = (locName || '').toLowerCase();
	const tz = (timezone || '').toLowerCase();

	// Known location-to-city mappings for HELIXO portfolio
	if (n.includes('mulherin') || n.includes('hiroki philadelphia') || n.includes('hiroki phila'))
		return 'philadelphia';
	if (n.includes('rosemary') || n.includes('lowland'))
		return 'charleston';
	if (n.includes('hiroki-san') || n.includes('kamper') || n.includes('anthology'))
		return 'detroit';
	if (n.includes('le supreme') || n.includes('bar rotunda') || n.includes('quoin') || n.includes('simmer'))
		return 'wilmington';
	if (n.includes('little wing') || n.includes('vessel'))
		return 'baltimore';

	// Fallback to timezone region
	if (tz.includes('eastern') || tz.includes('new_york')) return 'east_coast';
	if (tz.includes('central') || tz.includes('chicago')) return 'midwest';
	return 'unknown';
}

// ---------------------------------------------------------------------------
// DOW Pattern Clustering
// ---------------------------------------------------------------------------

/**
 * Cluster locations by DOW revenue pattern similarity using Pearson correlation.
 */
async function clusterByDowPattern(
	locations: { id: string; name: string }[],
	clusters: LocationCluster[],
): Promise<void> {
	const sb = getSupabase();

	// Build 7-element DOW revenue profile per location
	const dowProfiles = new Map<string, number[]>();

	for (const loc of locations) {
		const { data: dowRows } = await sb
			.from('daily_actuals')
			.select('business_date, revenue')
			.eq('location_id', loc.id)
			.gt('revenue', 0)
			.order('business_date', { ascending: false })
			.limit(90);

		if (!dowRows || dowRows.length < 14) continue;

		const byDow: number[][] = [[], [], [], [], [], [], []];
		for (const r of dowRows) {
			const dow = new Date(r.business_date + 'T12:00:00').getDay();
			byDow[dow].push(Number(r.revenue));
		}

		const profile = byDow.map(
			(arr) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
		);

		// Normalize to percentages of weekly total
		const total = profile.reduce((a, b) => a + b, 0);
		if (total > 0) {
			dowProfiles.set(loc.id, profile.map((v) => v / total));
		}
	}

	// Find the most similar DOW-pattern peer for each location
	const locIds = Array.from(dowProfiles.keys());

	for (let i = 0; i < locIds.length; i++) {
		const profileA = dowProfiles.get(locIds[i])!;
		let bestPeer = '';
		let bestCorr = -1;

		for (let j = 0; j < locIds.length; j++) {
			if (i === j) continue;
			const profileB = dowProfiles.get(locIds[j])!;
			const corr = pearsonCorrelation(profileA, profileB);
			if (corr > bestCorr) {
				bestCorr = corr;
				bestPeer = locIds[j];
			}
		}

		if (bestCorr > 0.8 && bestPeer) {
			const groupName = [locIds[i], bestPeer].sort().join(':');
			clusters.push({
				locationId: locIds[i],
				clusterName: groupName,
				clusterType: 'dow_pattern',
				confidence: Math.min(0.95, bestCorr),
			});
		}
	}
}

/**
 * Pearson correlation coefficient between two equal-length arrays.
 */
function pearsonCorrelation(a: number[], b: number[]): number {
	const n = a.length;
	if (n === 0 || n !== b.length) return 0;

	const meanA = a.reduce((s, v) => s + v, 0) / n;
	const meanB = b.reduce((s, v) => s + v, 0) / n;

	let num = 0;
	let denA = 0;
	let denB = 0;

	for (let i = 0; i < n; i++) {
		const dA = a[i] - meanA;
		const dB = b[i] - meanB;
		num += dA * dB;
		denA += dA * dA;
		denB += dB * dB;
	}

	const den = Math.sqrt(denA) * Math.sqrt(denB);
	return den > 0 ? num / den : 0;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Upsert location clusters to Supabase.
 */
async function persistClusters(clusters: LocationCluster[]): Promise<void> {
	const sb = getSupabase();

	for (const c of clusters) {
		await sb
			.from('location_clusters')
			.upsert(
				{
					location_id: c.locationId,
					cluster_type: c.clusterType,
					cluster_name: c.clusterName,
					confidence: c.confidence,
					updated_at: new Date().toISOString(),
				},
				{ onConflict: 'location_id,cluster_type' },
			);
	}
}
