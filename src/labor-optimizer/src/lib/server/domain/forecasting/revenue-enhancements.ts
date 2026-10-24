/** Revenue Forecast Enhancements — 7 signals that VALIDATE and CHALLENGE budget assumptions. */

import { getSupabase } from '$lib/server/supabase';

export interface RevenueEnhancementResult {
	adjustmentFactor: number;   // multiplicative: 1.0 = no change
	reasoning: string[];
	components: {
		priceElasticity: number;
		reservationPace: number;
		neighborhoodDemand: number;
		causalImpact: number;
		dayPartDecomposition: number;
		crossSell: number;
		checkAvgMomentum: number;
	};
}

/** 1. Menu Price Elasticity — track price changes from PMIX data, compute volume impact. */
async function computePriceElasticity(
	locationId: string,
	targetDate: string,
): Promise<{ factor: number; note: string }> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');

	const thirtyDaysAgo = new Date(target);
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
	const sixtyDaysAgo = new Date(target);
	sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

	// Recent 30-day avg price per item
	const { data: recentPmix } = await sb
		.from('daily_pmix')
		.select('item_price, quantity')
		.eq('location_id', locationId)
		.gte('business_date', thirtyDaysAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('quantity', 0);

	// Prior 30-day avg price per item
	const { data: priorPmix } = await sb
		.from('daily_pmix')
		.select('item_price, quantity')
		.eq('location_id', locationId)
		.gte('business_date', sixtyDaysAgo.toISOString().split('T')[0])
		.lt('business_date', thirtyDaysAgo.toISOString().split('T')[0])
		.gt('quantity', 0);

	if (!recentPmix || recentPmix.length < 10 || !priorPmix || priorPmix.length < 10) {
		return { factor: 1.0, note: '' };
	}

	const weightedAvg = (rows: typeof recentPmix) => {
		const totalQty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
		const totalRev = rows.reduce((s, r) => s + (r.item_price || 0) * (r.quantity || 0), 0);
		return totalQty > 0 ? totalRev / totalQty : 0;
	};

	const recentAvg = weightedAvg(recentPmix);
	const priorAvg = weightedAvg(priorPmix);

	if (priorAvg <= 0 || recentAvg <= 0) return { factor: 1.0, note: '' };

	const pricePctChange = (recentAvg - priorAvg) / priorAvg;

	// Elasticity coefficient: ~-0.3 (a 10% price increase yields ~3% volume drop)
	const ELASTICITY = -0.3;
	const volumeImpact = pricePctChange * ELASTICITY;

	if (Math.abs(volumeImpact) < 0.005) return { factor: 1.0, note: '' };
	const revenueImpact = (1 + pricePctChange) * (1 + volumeImpact) - 1;
	const factor = 1 + revenueImpact;
	const clamped = Math.max(0.90, Math.min(1.10, factor));
	const sign = pricePctChange >= 0 ? '+' : '';
	const note = `Menu prices ${sign}${(pricePctChange * 100).toFixed(1)}% (30d) — est. ${(revenueImpact * 100).toFixed(1)}% net revenue impact`;
	return { factor: clamped, note };
}

/** 2. Reservation Pace Momentum — compare booking velocity to historical pace. */
async function computeReservationPace(
	locationId: string,
	targetDate: string,
): Promise<{ factor: number; note: string }> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay();
	const today = new Date();
	const daysUntil = Math.floor((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

	if (daysUntil < 0) return { factor: 1.0, note: '' };

	// Current bookings for the target date
	const { data: currentReso } = await sb
		.from('daily_reservations')
		.select('covers')
		.eq('location_id', locationId)
		.eq('business_date', targetDate)
		.maybeSingle();

	const currentCovers = currentReso?.covers || 0;
	if (currentCovers === 0) return { factor: 1.0, note: '' };

	// Historical: how many covers were booked X days before for the same DOW?
	const lookbackWeeks = 8;
	const historicalPaces: number[] = [];

	for (let w = 1; w <= lookbackWeeks; w++) {
		const pastDate = new Date(target);
		pastDate.setDate(pastDate.getDate() - w * 7);
		const pastDateStr = pastDate.toISOString().split('T')[0];

		const { data: pastReso } = await sb
			.from('daily_reservations')
			.select('covers')
			.eq('location_id', locationId)
			.eq('business_date', pastDateStr)
			.maybeSingle();

		if (pastReso?.covers && pastReso.covers > 0) {
			historicalPaces.push(pastReso.covers);
		}
	}

	if (historicalPaces.length < 3) return { factor: 1.0, note: '' };

	const avgHistorical = historicalPaces.reduce((a, b) => a + b, 0) / historicalPaces.length;
	if (avgHistorical <= 0) return { factor: 1.0, note: '' };

	const paceRatio = currentCovers / avgHistorical;
	// Scale: if pace is 1.2x, boost ~10% (damped by 0.5)
	const rawFactor = 1 + (paceRatio - 1) * 0.5;
	const factor = Math.max(0.85, Math.min(1.20, rawFactor));

	if (Math.abs(factor - 1.0) < 0.01) return { factor: 1.0, note: '' };
	const dir = paceRatio > 1 ? 'ahead of' : 'behind';
	const note = `Reso pace: ${currentCovers} covers booked vs ${Math.round(avgHistorical)} avg — ${dir} pace by ${Math.round((paceRatio - 1) * 100)}%`;
	return { factor, note };
}

/** 3. Neighborhood Demand Index — competitor availability spillover. */
async function computeNeighborhoodDemand(
	locationId: string,
	targetDate: string,
): Promise<{ factor: number; note: string }> {
	const sb = getSupabase();

	const { data: compData } = await sb
		.from('competitive_set')
		.select('competitor_name, availability_pct, booked_pct')
		.eq('location_id', locationId)
		.eq('business_date', targetDate);

	if (!compData || compData.length === 0) return { factor: 1.0, note: '' };

	const avgBookedPct = compData.reduce((s, c) => s + (c.booked_pct || 0), 0) / compData.length;

	if (avgBookedPct < 70) return { factor: 1.0, note: '' };
	let spilloverPct: number;
	if (avgBookedPct >= 90) spilloverPct = 5;
	else if (avgBookedPct >= 80) spilloverPct = 3 + (avgBookedPct - 80) * 0.1;
	else spilloverPct = 1 + (avgBookedPct - 70) * 0.1;

	const factor = 1 + spilloverPct / 100;
	const note = `Competitors ${Math.round(avgBookedPct)}% booked (${compData.length} tracked) — est. +${spilloverPct.toFixed(1)}% walk-in spillover`;
	return { factor, note };
}

/** 4. Causal Impact Detection — detect/tag unusual revenue events, learn for next time. */
async function computeCausalImpact(
	locationId: string,
	targetDate: string,
): Promise<{ factor: number; note: string }> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay();

	// Look for past large-variance events on the same DOW
	const { data: accuracyRows } = await sb
		.from('forecast_accuracy')
		.select('business_date, error_pct, override_tags')
		.eq('location_id', locationId)
		.eq('day_of_week', dayOfWeek)
		.order('business_date', { ascending: false })
		.limit(12);

	if (!accuracyRows || accuracyRows.length < 2) return { factor: 1.0, note: '' };

	// Find events with >15% variance that have tags
	const significantEvents = accuracyRows.filter(
		(r) => Math.abs(r.error_pct || 0) > 15 && r.override_tags && (r.override_tags as string[]).length > 0,
	);

	if (significantEvents.length === 0) return { factor: 1.0, note: '' };

	// Check if any current forecast has matching tags
	const { data: currentForecast } = await sb
		.from('daily_forecasts')
		.select('override_tags')
		.eq('location_id', locationId)
		.eq('business_date', targetDate)
		.maybeSingle();

	if (!currentForecast?.override_tags) return { factor: 1.0, note: '' };

	const currentTags = currentForecast.override_tags as string[];
	if (currentTags.length === 0) return { factor: 1.0, note: '' };

	// Match tags and compute average historical impact
	let totalImpact = 0;
	let matchCount = 0;

	for (const event of significantEvents) {
		const eventTags = event.override_tags as string[];
		const hasOverlap = currentTags.some((t) => eventTags.includes(t));
		if (hasOverlap) {
			totalImpact += event.error_pct || 0;
			matchCount++;
		}
	}

	if (matchCount === 0) return { factor: 1.0, note: '' };
	const avgImpact = totalImpact / matchCount;
	const dampened = avgImpact * 0.6;
	const factor = Math.max(0.80, Math.min(1.25, 1 + dampened / 100));

	if (Math.abs(factor - 1.0) < 0.01) return { factor: 1.0, note: '' };

	const matchedTags = currentTags.join(', ');
	const sign = avgImpact >= 0 ? '+' : '';
	const note = `Causal pattern: "${matchedTags}" historically ${sign}${avgImpact.toFixed(0)}% (${matchCount} matches) — applying ${sign}${(dampened).toFixed(0)}%`;
	return { factor, note };
}

/** 5. Day-Part Revenue Decomposition — forecast lunch/HH/dinner/late night separately. */
async function computeDayPartDecomposition(
	locationId: string,
	targetDate: string,
): Promise<{ factor: number; note: string }> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay();

	// Get 8 weeks of same-DOW hourly sales
	const targetDates: string[] = [];
	const cursor = new Date(target);
	cursor.setDate(cursor.getDate() - 1);
	for (let i = 0; i < 120 && targetDates.length < 8; i++) {
		if (cursor.getDay() === dayOfWeek) {
			targetDates.push(cursor.toISOString().split('T')[0]);
		}
		cursor.setDate(cursor.getDate() - 1);
	}

	if (targetDates.length < 3) return { factor: 1.0, note: '' };

	const { data: hourlyData } = await sb
		.from('daily_hourly_sales')
		.select('business_date, hour_of_day, revenue')
		.eq('location_id', locationId)
		.in('business_date', targetDates)
		.gt('revenue', 0);

	if (!hourlyData || hourlyData.length < 10) return { factor: 1.0, note: '' };

	// Day-part definitions
	const PARTS = {
		lunch: { start: 11, end: 14, label: 'Lunch (11a-2p)' },
		happyHour: { start: 16, end: 18, label: 'Happy Hour (4p-6p)' },
		dinner: { start: 18, end: 22, label: 'Dinner (6p-10p)' },
		lateNight: { start: 22, end: 26, label: 'Late Night (10p+)' },
	};

	// Compute avg revenue per day-part per day
	const dayPartTotals: Record<string, number[]> = {
		lunch: [], happyHour: [], dinner: [], lateNight: [],
	};
	const dailyTotals: number[] = [];

	// Group by date first
	const byDate: Record<string, { hour: number; revenue: number }[]> = {};
	for (const row of hourlyData) {
		if (!byDate[row.business_date]) byDate[row.business_date] = [];
		byDate[row.business_date].push({ hour: row.hour_of_day, revenue: row.revenue });
	}

	for (const [, hours] of Object.entries(byDate)) {
		let lunch = 0, happy = 0, dinner = 0, late = 0, total = 0;
		for (const h of hours) {
			const hr = h.hour;
			total += h.revenue;
			if (hr >= PARTS.lunch.start && hr < PARTS.lunch.end) lunch += h.revenue;
			else if (hr >= PARTS.happyHour.start && hr < PARTS.happyHour.end) happy += h.revenue;
			else if (hr >= PARTS.dinner.start && hr < PARTS.dinner.end) dinner += h.revenue;
			else if (hr >= PARTS.lateNight.start) late += h.revenue;
		}
		dayPartTotals.lunch.push(lunch);
		dayPartTotals.happyHour.push(happy);
		dayPartTotals.dinner.push(dinner);
		dayPartTotals.lateNight.push(late);
		dailyTotals.push(total);
	}

	if (dailyTotals.length < 3) return { factor: 1.0, note: '' };

	// Sum of day-part averages vs overall daily average
	const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
	const partSum = avg(dayPartTotals.lunch) + avg(dayPartTotals.happyHour)
		+ avg(dayPartTotals.dinner) + avg(dayPartTotals.lateNight);
	const dailyAvg = avg(dailyTotals);

	if (dailyAvg <= 0) return { factor: 1.0, note: '' };
	const divergence = (partSum - dailyAvg) / dailyAvg;
	if (Math.abs(divergence) < 0.02) return { factor: 1.0, note: '' };

	const factor = Math.max(0.92, Math.min(1.08, 1 + divergence * 0.5));

	// Build descriptive note
	const parts: string[] = [];
	for (const [key, def] of Object.entries(PARTS)) {
		const partAvg = avg(dayPartTotals[key]);
		if (partAvg > 0) parts.push(`${def.label}: $${Math.round(partAvg).toLocaleString()}`);
	}
	const note = `Day-part decomposition: ${parts.join(', ')} — ${divergence > 0 ? '+' : ''}${(divergence * 100).toFixed(1)}% vs whole-day`;
	return { factor, note };
}

/** 6. Cross-Sell Prediction — category correlations that drive incremental revenue. */
async function computeCrossSellSignal(
	locationId: string,
	targetDate: string,
): Promise<{ factor: number; note: string }> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dayOfWeek = target.getDay();

	const sixtyDaysAgo = new Date(target);
	sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

	// Get sales mix by category for same DOW over 60 days
	const { data: salesMixData } = await sb
		.from('daily_sales_mix')
		.select('business_date, category, revenue, pct_of_total')
		.eq('location_id', locationId)
		.gte('business_date', sixtyDaysAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate);

	if (!salesMixData || salesMixData.length < 20) return { factor: 1.0, note: '' };

	const byDate: Record<string, Record<string, number>> = {};
	const dateTotals: Record<string, number> = {};
	for (const row of salesMixData) {
		if (new Date(row.business_date + 'T12:00:00').getDay() !== dayOfWeek) continue;
		if (!byDate[row.business_date]) byDate[row.business_date] = {};
		byDate[row.business_date][row.category] = (byDate[row.business_date][row.category] || 0) + (row.revenue || 0);
		dateTotals[row.business_date] = (dateTotals[row.business_date] || 0) + (row.revenue || 0);
	}
	const dates = Object.keys(byDate);
	if (dates.length < 4) return { factor: 1.0, note: '' };
	const categories = new Set<string>();
	for (const cats of Object.values(byDate)) for (const cat of Object.keys(cats)) categories.add(cat);
	const avgTotal = dates.reduce((s, d) => s + (dateTotals[d] || 0), 0) / dates.length;
	if (avgTotal <= 0) return { factor: 1.0, note: '' };
	const recentDates = dates.slice(0, Math.min(4, dates.length));
	const olderDates = dates.slice(Math.min(4, dates.length));
	if (olderDates.length < 2) return { factor: 1.0, note: '' };

	const insights: string[] = [];
	let compositeFactor = 1.0;

	for (const cat of categories) {
		const recentShare = recentDates.reduce((s, d) => {
			const catRev = byDate[d]?.[cat] || 0;
			const total = dateTotals[d] || 1;
			return s + catRev / total;
		}, 0) / recentDates.length;

		const olderShare = olderDates.reduce((s, d) => {
			const catRev = byDate[d]?.[cat] || 0;
			const total = dateTotals[d] || 1;
			return s + catRev / total;
		}, 0) / olderDates.length;

		const shareShift = recentShare - olderShare;
		if (Math.abs(shareShift) > 0.03) {
			const sign = shareShift > 0 ? '+' : '';
			insights.push(`${cat} share ${sign}${(shareShift * 100).toFixed(1)}%`);
			compositeFactor += shareShift * 0.3;
		}
	}

	if (insights.length === 0) return { factor: 1.0, note: '' };

	const clamped = Math.max(0.95, Math.min(1.08, compositeFactor));
	const note = `Cross-sell: ${insights.join(', ')}`;
	return { factor: clamped, note };
}

/** 7. Check Average Trend Momentum — 14d vs 30d trailing check avg. */
async function computeCheckAvgMomentum(
	locationId: string,
	targetDate: string,
): Promise<{ factor: number; note: string }> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');

	const fourteenDaysAgo = new Date(target);
	fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
	const thirtyDaysAgo = new Date(target);
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const { data: recentRows } = await sb
		.from('daily_actuals')
		.select('revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', fourteenDaysAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('covers', 0);

	const { data: olderRows } = await sb
		.from('daily_actuals')
		.select('revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', thirtyDaysAgo.toISOString().split('T')[0])
		.lt('business_date', fourteenDaysAgo.toISOString().split('T')[0])
		.gt('covers', 0);

	if (!recentRows || recentRows.length < 5 || !olderRows || olderRows.length < 5) {
		return { factor: 1.0, note: '' };
	}

	const avgCheck = (rows: typeof recentRows) => {
		const totalRev = rows.reduce((s, r) => s + (r.revenue || 0), 0);
		const totalCovers = rows.reduce((s, r) => s + (r.covers || 0), 0);
		return totalCovers > 0 ? totalRev / totalCovers : 0;
	};

	const recent14 = avgCheck(recentRows);
	const older30 = avgCheck(olderRows);

	if (older30 <= 0) return { factor: 1.0, note: '' };

	const checkTrend = (recent14 - older30) / older30;

	if (Math.abs(checkTrend) < 0.015) return { factor: 1.0, note: '' };
	const factor = Math.max(0.95, Math.min(1.06, 1 + checkTrend * 0.5));
	const sign = checkTrend >= 0 ? '+' : '';
	const note = `Check avg momentum: $${recent14.toFixed(0)} (14d) vs $${older30.toFixed(0)} (30d) — ${sign}${(checkTrend * 100).toFixed(1)}% trend`;
	return { factor, note };
}

/** Run all 7 revenue enhancements, return composite adjustment + reasoning. */
export async function getRevenueEnhancements(
	locationId: string,
	targetDate: string,
): Promise<RevenueEnhancementResult> {
	const results = await Promise.all([
		computePriceElasticity(locationId, targetDate).catch(() => ({ factor: 1.0, note: '' })),
		computeReservationPace(locationId, targetDate).catch(() => ({ factor: 1.0, note: '' })),
		computeNeighborhoodDemand(locationId, targetDate).catch(() => ({ factor: 1.0, note: '' })),
		computeCausalImpact(locationId, targetDate).catch(() => ({ factor: 1.0, note: '' })),
		computeDayPartDecomposition(locationId, targetDate).catch(() => ({ factor: 1.0, note: '' })),
		computeCrossSellSignal(locationId, targetDate).catch(() => ({ factor: 1.0, note: '' })),
		computeCheckAvgMomentum(locationId, targetDate).catch(() => ({ factor: 1.0, note: '' })),
	]);

	const [priceEl, resoPace, neighborhood, causal, dayPart, crossSell, checkAvg] = results;

	// Composite factor: multiply all individual factors
	const compositeFactor = priceEl.factor * resoPace.factor * neighborhood.factor
		* causal.factor * dayPart.factor * crossSell.factor * checkAvg.factor;

	// Clamp final composite between 0.80 and 1.25
	const clampedFactor = Math.max(0.80, Math.min(1.25, compositeFactor));

	// Collect non-empty reasoning
	const reasoning: string[] = [];
	for (const r of results) {
		if (r.note) reasoning.push(r.note);
	}

	return {
		adjustmentFactor: Math.round(clampedFactor * 10000) / 10000,
		reasoning,
		components: {
			priceElasticity: priceEl.factor,
			reservationPace: resoPace.factor,
			neighborhoodDemand: neighborhood.factor,
			causalImpact: causal.factor,
			dayPartDecomposition: dayPart.factor,
			crossSell: crossSell.factor,
			checkAvgMomentum: checkAvg.factor,
		},
	};
}
