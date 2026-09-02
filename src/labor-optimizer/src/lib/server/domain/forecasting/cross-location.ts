/** Cross-Location Intelligence — HELIXO forecast engine Component 7.
 * Signals, trends, overrides, seasonal transfer. Clusters in cross-location-clusters.ts. */
import { getSupabase } from '$lib/server/supabase';
export { clusterLocations, type LocationCluster } from './cross-location-clusters';

export interface CrossLocationSignal {
	impactPct: number;
	confidence: number;
	reasoning: string;
	signalType: string;
	sourceLocations: string[];
}

export interface MarketTrend {
	city: string;
	trendPct: number;
	locationCount: number;
	dateRange: { start: string; end: string };
}

export interface ConceptTrend {
	conceptType: string;
	trendPct: number;
	locationCount: number;
	dateRange: { start: string; end: string };
}

export interface OverrideInsight {
	tag: string;
	avgImpactPct: number;
	occurrences: number;
	sourceLocations: string[];
}

export interface SeasonalForecast {
	predictedRevenue: number;
	predictedCovers: number;
	confidence: number;
	reasoning: string;
	donorLocationId: string;
	scaleFactor: number;
}

/** Aggregate market, concept, and peer signals into a weighted adjustment. */
export async function getCrossLocationSignal(
	locationId: string,
	targetDate: string,
): Promise<CrossLocationSignal> {
	const sb = getSupabase();

	const { data: myClusters } = await sb
		.from('location_clusters')
		.select('cluster_name, cluster_type, confidence')
		.eq('location_id', locationId);

	if (!myClusters || myClusters.length === 0) {
		return { impactPct: 0, confidence: 0, reasoning: 'No cluster data', signalType: 'none', sourceLocations: [] };
	}

	const signals: { impact: number; weight: number; note: string; sources: string[] }[] = [];

	// --- Market Trend Signal ---
	const marketCluster = myClusters.find((c) => c.cluster_type === 'market');
	if (marketCluster) {
		const trend = await getMarketTrend(marketCluster.cluster_name, targetDate);
		if (trend && Math.abs(trend.trendPct) > 2 && trend.locationCount >= 2) {
			signals.push({
				impact: trend.trendPct,
				weight: 0.4,
				note: `${capitalize(marketCluster.cluster_name)} market trending ${trend.trendPct > 0 ? '+' : ''}${trend.trendPct.toFixed(1)}% this week (${trend.locationCount} locations)`,
				sources: [],
			});
		}
	}

	// --- Concept Trend Signal ---
	const conceptCluster = myClusters.find((c) => c.cluster_type === 'concept');
	if (conceptCluster) {
		const trend = await getConceptTrend(conceptCluster.cluster_name, targetDate);
		if (trend && Math.abs(trend.trendPct) > 2 && trend.locationCount >= 2) {
			signals.push({
				impact: trend.trendPct,
				weight: 0.3,
				note: `${capitalize(conceptCluster.cluster_name)} venues trending ${trend.trendPct > 0 ? '+' : ''}${trend.trendPct.toFixed(1)}% (${trend.locationCount} locations)`,
				sources: [],
			});
		}
	}

	// --- Peer Location Momentum ---
	const peerSignal = await getPeerMomentum(locationId, myClusters, targetDate);
	if (peerSignal) {
		signals.push({
			impact: peerSignal.impactPct,
			weight: 0.3,
			note: peerSignal.note,
			sources: peerSignal.sources,
		});
	}

	if (signals.length === 0) {
		return { impactPct: 0, confidence: 0.3, reasoning: 'Cross-location: No actionable signals', signalType: 'none', sourceLocations: [] };
	}

	// Weighted average of all signals
	const totalWeight = signals.reduce((s, sig) => s + sig.weight, 0);
	const weightedImpact = signals.reduce(
		(s, sig) => s + sig.impact * (sig.weight / totalWeight), 0,
	);

	const clampedImpact = Math.max(-15, Math.min(15, weightedImpact));
	const allSources = signals.flatMap((s) => s.sources);
	const reasoning = 'Cross-location: ' + signals.map((s) => s.note).join('; ');

	const confidence = Math.min(
		0.85,
		0.3 + signals.length * 0.15 + (myClusters.length >= 3 ? 0.1 : 0),
	);

	// Persist signal for audit trail
	if (Math.abs(clampedImpact) > 1) {
		await sb.from('cross_location_signals').insert({
			source_location_id: allSources[0] || locationId,
			target_location_id: locationId,
			signal_type: 'market_trend',
			impact_pct: clampedImpact,
			confidence,
			reasoning,
			date_range_start: targetDate,
			date_range_end: targetDate,
		});
	}

	return {
		impactPct: Math.round(clampedImpact * 100) / 100,
		confidence,
		reasoning,
		signalType: signals.length > 1 ? 'composite' : signals[0]?.note || 'unknown',
		sourceLocations: [...new Set(allSources)],
	};
}

/** Aggregate trend across all locations in a city for the past 7 days. */
export async function getMarketTrend(
	city: string,
	targetDate: string,
): Promise<MarketTrend | null> {
	return getGroupTrend('market', city, targetDate);
}

/** Aggregate trend across all locations of a concept type. */
export async function getConceptTrend(
	conceptType: string,
	targetDate: string,
): Promise<ConceptTrend | null> {
	const trend = await getGroupTrend('concept', conceptType, targetDate);
	if (!trend) return null;
	return {
		conceptType: trend.city,
		trendPct: trend.trendPct,
		locationCount: trend.locationCount,
		dateRange: trend.dateRange,
	};
}

/** Compare current 7d vs prior 7d for locations in a cluster. */
async function getGroupTrend(
	clusterType: string,
	clusterName: string,
	targetDate: string,
): Promise<MarketTrend | null> {
	const sb = getSupabase();

	const { data: clusterRows } = await sb
		.from('location_clusters')
		.select('location_id')
		.eq('cluster_type', clusterType)
		.eq('cluster_name', clusterName);

	if (!clusterRows || clusterRows.length < 2) return null;

	const locIds = clusterRows.map((r) => r.location_id);
	const target = new Date(targetDate + 'T12:00:00');
	const week1Start = new Date(target);
	week1Start.setDate(week1Start.getDate() - 7);
	const week2Start = new Date(target);
	week2Start.setDate(week2Start.getDate() - 14);

	const w1s = week1Start.toISOString().split('T')[0];
	const w2s = week2Start.toISOString().split('T')[0];

	const { data: curRows } = await sb
		.from('daily_actuals')
		.select('location_id, revenue')
		.in('location_id', locIds)
		.gte('business_date', w1s)
		.lt('business_date', targetDate)
		.gt('revenue', 0);

	const { data: priorRows } = await sb
		.from('daily_actuals')
		.select('location_id, revenue')
		.in('location_id', locIds)
		.gte('business_date', w2s)
		.lt('business_date', w1s)
		.gt('revenue', 0);

	const curTotal = (curRows || []).reduce((s, r) => s + Number(r.revenue), 0);
	const priorTotal = (priorRows || []).reduce((s, r) => s + Number(r.revenue), 0);

	if (priorTotal <= 0 || curTotal <= 0) return null;

	const trendPct = ((curTotal - priorTotal) / priorTotal) * 100;
	const activeLocCount = new Set((curRows || []).map((r) => r.location_id)).size;

	return {
		city: clusterName,
		trendPct: Math.round(trendPct * 10) / 10,
		locationCount: activeLocCount,
		dateRange: { start: w1s, end: targetDate },
	};
}

interface PeerMomentumResult {
	impactPct: number;
	note: string;
	sources: string[];
}

/** Check peer locations (same market) WoW change, propagate 40% as dampened signal. */
async function getPeerMomentum(
	locationId: string,
	myClusters: { cluster_name: string; cluster_type: string }[],
	targetDate: string,
): Promise<PeerMomentumResult | null> {
	const sb = getSupabase();
	const marketCluster = myClusters.find((c) => c.cluster_type === 'market');
	if (!marketCluster) return null;

	const { data: peers } = await sb
		.from('location_clusters')
		.select('location_id')
		.eq('cluster_type', 'market')
		.eq('cluster_name', marketCluster.cluster_name)
		.neq('location_id', locationId);

	if (!peers || peers.length === 0) return null;

	const peerIds = peers.map((p) => p.location_id);
	const target = new Date(targetDate + 'T12:00:00');
	const weekAgo = new Date(target);
	weekAgo.setDate(weekAgo.getDate() - 7);
	const twoWeeksAgo = new Date(target);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

	const w1s = weekAgo.toISOString().split('T')[0];
	const w2s = twoWeeksAgo.toISOString().split('T')[0];

	const peerChanges: { locId: string; pctChange: number }[] = [];

	for (const peerId of peerIds) {
		const { data: cur } = await sb
			.from('daily_actuals')
			.select('revenue')
			.eq('location_id', peerId)
			.gte('business_date', w1s)
			.lt('business_date', targetDate)
			.gt('revenue', 0);

		const { data: prior } = await sb
			.from('daily_actuals')
			.select('revenue')
			.eq('location_id', peerId)
			.gte('business_date', w2s)
			.lt('business_date', w1s)
			.gt('revenue', 0);

		const curSum = (cur || []).reduce((s, r) => s + Number(r.revenue), 0);
		const priorSum = (prior || []).reduce((s, r) => s + Number(r.revenue), 0);

		if (priorSum > 0 && curSum > 0) {
			peerChanges.push({ locId: peerId, pctChange: ((curSum - priorSum) / priorSum) * 100 });
		}
	}

	if (peerChanges.length === 0) return null;

	const avgChange = peerChanges.reduce((s, p) => s + p.pctChange, 0) / peerChanges.length;
	if (Math.abs(avgChange) < 3) return null;

	const dampened = avgChange * 0.4;

	return {
		impactPct: Math.round(dampened * 10) / 10,
		note: `Peer locations in ${capitalize(marketCluster.cluster_name)} trending ${avgChange > 0 ? '+' : ''}${avgChange.toFixed(1)}% WoW (${peerChanges.length} peers, 40% transferred)`,
		sources: peerChanges.map((p) => p.locId),
	};
}

/** Get historical override tag impact data from ALL locations. */
export async function getSharedOverrideInsights(
	locationId: string,
	tags: string[],
): Promise<OverrideInsight[]> {
	const sb = getSupabase();
	const insights: OverrideInsight[] = [];

	for (const tag of tags) {
		const { data: taggedRows } = await sb
			.from('daily_forecasts')
			.select('location_id, business_date, manager_revenue')
			.eq('is_override', true)
			.contains('override_tags', [tag])
			.order('business_date', { ascending: false })
			.limit(50);

		if (!taggedRows || taggedRows.length === 0) continue;

		const impacts: { pctChange: number; locId: string }[] = [];

		for (const row of taggedRows) {
			const { data: actual } = await sb
				.from('daily_actuals')
				.select('revenue')
				.eq('location_id', row.location_id)
				.eq('business_date', row.business_date)
				.maybeSingle();

			if (!actual?.revenue || !row.manager_revenue) continue;

			const pctChange = ((actual.revenue - row.manager_revenue) / row.manager_revenue) * 100;
			impacts.push({ pctChange, locId: row.location_id });
		}

		if (impacts.length === 0) continue;

		const avgImpact = impacts.reduce((s, i) => s + i.pctChange, 0) / impacts.length;
		const uniqueLocs = [...new Set(impacts.map((i) => i.locId))];

		insights.push({
			tag,
			avgImpactPct: Math.round(avgImpact * 10) / 10,
			occurrences: impacts.length,
			sourceLocations: uniqueLocs,
		});
	}

	return insights;
}

/** Transfer seasonal patterns from a similar location to a newer one. */
export async function getSeasonalForecast(
	locationId: string,
	targetDate: string,
): Promise<SeasonalForecast | null> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const targetMonth = target.getMonth();

	// Check if this location already has data for this month (CY or PY)
	const monthStr = String(targetMonth + 1).padStart(2, '0');
	const { data: existingData } = await sb
		.from('daily_actuals')
		.select('id')
		.eq('location_id', locationId)
		.gte('business_date', `${target.getFullYear()}-${monthStr}-01`)
		.limit(1);

	const pyYear = target.getFullYear() - 1;
	const nextMonth = targetMonth + 2 > 12 ? 1 : targetMonth + 2;
	const nextMonthYear = targetMonth + 2 > 12 ? pyYear + 1 : pyYear;

	const { data: pyData } = await sb
		.from('daily_actuals')
		.select('id')
		.eq('location_id', locationId)
		.gte('business_date', `${pyYear}-${monthStr}-01`)
		.lt('business_date', `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`)
		.limit(1);

	if ((existingData && existingData.length > 0) || (pyData && pyData.length > 0)) {
		return null;
	}

	// Find similar locations via clusters
	const { data: myClusters } = await sb
		.from('location_clusters')
		.select('cluster_name, cluster_type')
		.eq('location_id', locationId);

	if (!myClusters || myClusters.length === 0) return null;

	const conceptCluster = myClusters.find((c) => c.cluster_type === 'concept');
	const marketCluster = myClusters.find((c) => c.cluster_type === 'market');

	const clusterPrefs = [
		conceptCluster ? { type: 'concept', name: conceptCluster.cluster_name } : null,
		marketCluster ? { type: 'market', name: marketCluster.cluster_name } : null,
	].filter(Boolean) as { type: string; name: string }[];

	let donorId: string | null = null;
	let donorMonthAvg = 0;
	let donorOverallAvg = 0;

	for (const pref of clusterPrefs) {
		const { data: peerRows } = await sb
			.from('location_clusters')
			.select('location_id')
			.eq('cluster_type', pref.type)
			.eq('cluster_name', pref.name)
			.neq('location_id', locationId);

		if (!peerRows) continue;

		for (const peer of peerRows) {
			const monthStart = `${pyYear}-${monthStr}-01`;
			const monthEnd = `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}-01`;

			const { data: donorMonthData } = await sb
				.from('daily_actuals')
				.select('revenue')
				.eq('location_id', peer.location_id)
				.gte('business_date', monthStart)
				.lt('business_date', monthEnd)
				.gt('revenue', 0);

			if (!donorMonthData || donorMonthData.length < 7) continue;

			const { data: donorAllData } = await sb
				.from('daily_actuals')
				.select('revenue')
				.eq('location_id', peer.location_id)
				.gt('revenue', 0)
				.order('business_date', { ascending: false })
				.limit(90);

			if (!donorAllData || donorAllData.length < 14) continue;

			donorMonthAvg = donorMonthData.reduce((s, r) => s + Number(r.revenue), 0) / donorMonthData.length;
			donorOverallAvg = donorAllData.reduce((s, r) => s + Number(r.revenue), 0) / donorAllData.length;
			donorId = peer.location_id;
			break;
		}

		if (donorId) break;
	}

	if (!donorId || donorOverallAvg <= 0) return null;

	// Get target location's recent average for scaling
	const { data: targetRecent } = await sb
		.from('daily_actuals')
		.select('revenue')
		.eq('location_id', locationId)
		.gt('revenue', 0)
		.order('business_date', { ascending: false })
		.limit(30);

	if (!targetRecent || targetRecent.length < 7) return null;

	const targetAvg = targetRecent.reduce((s, r) => s + Number(r.revenue), 0) / targetRecent.length;
	const seasonalRatio = donorMonthAvg / donorOverallAvg;
	const predictedRevenue = Math.round(targetAvg * seasonalRatio * 100) / 100;
	const predictedCovers = Math.round(predictedRevenue / 70);
	const scaleFactor = targetAvg / donorOverallAvg;
	const seasonPct = Math.round((seasonalRatio - 1) * 100);

	await sb.from('cross_location_signals').insert({
		source_location_id: donorId,
		target_location_id: locationId,
		signal_type: 'seasonal_transfer',
		impact_pct: seasonPct,
		confidence: 0.55,
		reasoning: `Seasonal transfer: donor month avg ${seasonPct >= 0 ? '+' : ''}${seasonPct}% vs baseline, scale ${scaleFactor.toFixed(2)}`,
		date_range_start: targetDate,
		date_range_end: targetDate,
	});

	return {
		predictedRevenue,
		predictedCovers,
		confidence: 0.55,
		reasoning: `Seasonal transfer from similar location: ${seasonPct >= 0 ? '+' : ''}${seasonPct}% seasonal pattern applied (scale factor ${scaleFactor.toFixed(2)})`,
		donorLocationId: donorId,
		scaleFactor,
	};
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
