/**
 * Confidence-Based Ensemble Forecast Engine
 *
 * Combines 6 independent forecasting models, weighted by recent accuracy:
 *   1. Statistical — adaptive weighted blend from ai-forecast.ts
 *   2. Neural — MLP from neural-forecast.ts
 *   3. Analogy — finds most similar historical day by feature distance
 *   4. Manager consensus — average of manager overrides for this DOW
 *   5. Event-Aware — event calendar + market indicators with learned coefficients
 *   6. Cross-Location Correlation — peer location trend transfer
 *
 * Weights use inverse MAPE with:
 *   - 14-day rolling window with exponential decay (0.9^days_ago)
 *   - Auto-disable: model MAPE > 2x ensemble avg -> floor weight (5%)
 *   - Composite confidence = agreement_score * (1 - avg_mape / 100)
 */

import { getSupabase, getSupabaseService } from '$lib/server/supabase';
import { generateForecastSuggestion, type ForecastSuggestion } from './ai-forecast';
import { predict, buildFeaturesForDate, type NeuralPrediction } from './neural-forecast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgreementLevel = 'high' | 'moderate' | 'low';

export interface ModelPrediction {
	model: string;
	prediction: number;
	weight: number;
	recentMape: number;
}

export interface EnsembleForecast {
	revenue: number;
	confidence: number;
	modelBreakdown: ModelPrediction[];
	agreement: AgreementLevel;
	reasoning: string;
	statisticalSuggestion: ForecastSuggestion;
}

interface EventCalendarRow {
	event_name: string;
	event_date: string;
	impact_score: number;
	event_type: string | null;
}

interface MarketIndicatorRow {
	gas_price: number | null;
	consumer_confidence: number | null;
	recorded_at: string;
}

interface CrossLocationSignalRow {
	source_location_id: string;
	signal_type: string;
	coefficient: number;
	confidence: number;
}

// ---------------------------------------------------------------------------
// Model 3: Analogy-based forecast
// ---------------------------------------------------------------------------

/**
 * Find the most similar historical day by feature distance and return
 * its actual revenue. Features compared: DOW, month, weather, PY proximity.
 */
async function analogyForecast(
	locationId: string,
	targetDate: string,
): Promise<number> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');
	const dow = target.getDay();
	const month = target.getMonth();

	// Get weather for target date
	const { data: targetWeather } = await sb
		.from('daily_weather')
		.select('temp_high, precipitation_pct')
		.eq('location_id', locationId)
		.eq('business_date', targetDate)
		.maybeSingle();

	const targetTemp = Number(targetWeather?.temp_high) || 70;
	const targetPrecip = Number(targetWeather?.precipitation_pct) || 0;

	// Search historical days: same DOW, within +/-1 month, last 2 years
	const twoYearsAgo = new Date(target);
	twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

	const { data: candidates } = await sb
		.from('daily_actuals')
		.select('business_date, revenue, covers')
		.eq('location_id', locationId)
		.gte('business_date', twoYearsAgo.toISOString().split('T')[0])
		.lt('business_date', targetDate)
		.gt('revenue', 0)
		.order('business_date', { ascending: false })
		.limit(500);

	if (!candidates || candidates.length < 5) return 0;

	// Filter to same DOW
	const sameDow = candidates.filter((c) => {
		const d = new Date(c.business_date + 'T12:00:00');
		return d.getDay() === dow;
	});

	if (sameDow.length === 0) return 0;

	// Load weather for candidates (batch)
	const candidateDates = sameDow.map((c) => c.business_date);
	const { data: weatherRows } = await sb
		.from('daily_weather')
		.select('business_date, temp_high, precipitation_pct')
		.eq('location_id', locationId)
		.in('business_date', candidateDates.slice(0, 100));

	const weatherMap = new Map<string, { temp: number; precip: number }>();
	for (const w of weatherRows || []) {
		weatherMap.set(w.business_date, {
			temp: Number(w.temp_high) || 70,
			precip: Number(w.precipitation_pct) || 0,
		});
	}

	// Score each candidate by feature distance
	type ScoredCandidate = { revenue: number; distance: number };
	const scored: ScoredCandidate[] = [];

	for (const c of sameDow) {
		const d = new Date(c.business_date + 'T12:00:00');
		const cMonth = d.getMonth();
		const w = weatherMap.get(c.business_date);

		// Distance components (all normalized 0-1 range)
		const monthDist = Math.min(Math.abs(cMonth - month), 12 - Math.abs(cMonth - month)) / 6;
		const tempDist = w ? Math.abs(w.temp - targetTemp) / 60 : 0.5;
		const precipDist = w ? Math.abs(w.precip - targetPrecip) / 100 : 0.5;

		// Recency bonus: more recent days get lower distance
		const daysAgo = (target.getTime() - d.getTime()) / 86400000;
		const recencyPenalty = Math.min(daysAgo / 365, 1) * 0.3;

		const distance = monthDist * 0.4 + tempDist * 0.2 + precipDist * 0.2 + recencyPenalty * 0.2;

		scored.push({ revenue: Number(c.revenue), distance });
	}

	// Sort by distance ascending, take top 3 weighted average
	scored.sort((a, b) => a.distance - b.distance);
	const topK = scored.slice(0, 3);

	const totalInvDist = topK.reduce((s, c) => s + (1 / (c.distance + 0.01)), 0);
	const weightedRevenue = topK.reduce(
		(s, c) => s + c.revenue * ((1 / (c.distance + 0.01)) / totalInvDist),
		0,
	);

	return Math.round(weightedRevenue * 100) / 100;
}

// ---------------------------------------------------------------------------
// Model 4: Manager consensus
// ---------------------------------------------------------------------------

/**
 * Average of the manager's recent accepted overrides for this DOW.
 * Uses up to the last 6 overrides for the same day-of-week.
 */
async function managerConsensusForecast(
	locationId: string,
	targetDate: string,
): Promise<number> {
	const sb = getSupabase();
	const dow = new Date(targetDate + 'T12:00:00').getDay();

	const { data: overrides } = await sb
		.from('daily_forecasts')
		.select('business_date, manager_revenue')
		.eq('location_id', locationId)
		.eq('is_override', true)
		.not('manager_revenue', 'is', null)
		.lt('business_date', targetDate)
		.order('business_date', { ascending: false })
		.limit(50);

	if (!overrides || overrides.length === 0) return 0;

	const sameDow = overrides
		.filter((o) => new Date(o.business_date + 'T12:00:00').getDay() === dow)
		.slice(0, 6);

	if (sameDow.length === 0) return 0;

	const avg = sameDow.reduce((s, o) => s + Number(o.manager_revenue), 0) / sameDow.length;
	return Math.round(avg * 100) / 100;
}

// ---------------------------------------------------------------------------
// Model 5: Event-Aware Predictor
// ---------------------------------------------------------------------------

/**
 * Query event_calendar for events within 3 days of target date, plus
 * market_indicators for gas_price/consumer_confidence. Compute event impact
 * as sum of (impact_score * distance_decay) with learned coefficients from
 * historical event-revenue correlation. Falls back to statistical if no events.
 */
async function eventAwareForecast(
	locationId: string,
	targetDate: string,
	statisticalFallback: number,
): Promise<number> {
	const sb = getSupabase();
	const target = new Date(targetDate + 'T12:00:00');

	// Window: 3 days before through target date
	const windowStart = new Date(target);
	windowStart.setDate(windowStart.getDate() - 3);
	const windowEnd = new Date(target);
	windowEnd.setDate(windowEnd.getDate() + 1);

	const { data: events } = await sb
		.from('event_calendar')
		.select('event_name, event_date, impact_score, event_type')
		.eq('location_id', locationId)
		.gte('event_date', windowStart.toISOString().split('T')[0])
		.lte('event_date', windowEnd.toISOString().split('T')[0]);

	// Get latest market indicators
	const { data: marketRow } = await sb
		.from('market_indicators')
		.select('gas_price, consumer_confidence, recorded_at')
		.order('recorded_at', { ascending: false })
		.limit(1)
		.maybeSingle();

	if ((!events || events.length === 0) && !marketRow) {
		return statisticalFallback;
	}

	// Compute event impact with distance decay
	let eventImpact = 0;
	if (events && events.length > 0) {
		for (const ev of events as EventCalendarRow[]) {
			const evDate = new Date(ev.event_date + 'T12:00:00');
			const daysDiff = Math.abs(
				(target.getTime() - evDate.getTime()) / 86400000,
			);
			// Distance decay: impact drops off further from event
			const decay = Math.pow(0.6, daysDiff);
			eventImpact += (ev.impact_score || 0) * decay;
		}
	}

	// Learn event coefficients from historical event-revenue correlation
	const learnedCoeff = await getLearnedEventCoefficient(locationId, targetDate);

	// Market condition adjustment
	let marketMultiplier = 1.0;
	if (marketRow) {
		const mi = marketRow as MarketIndicatorRow;
		// Higher gas prices depress restaurant spending slightly
		if (mi.gas_price && mi.gas_price > 4.0) {
			marketMultiplier -= (mi.gas_price - 4.0) * 0.01; // -1% per $1 over $4
		}
		// Higher consumer confidence boosts spending
		if (mi.consumer_confidence && mi.consumer_confidence > 100) {
			marketMultiplier += (mi.consumer_confidence - 100) * 0.001; // +0.1% per point over 100
		}
		marketMultiplier = Math.max(0.90, Math.min(1.10, marketMultiplier));
	}

	// Combine: base * (1 + event_impact * coefficient) * market
	const base = statisticalFallback > 0 ? statisticalFallback : 0;
	if (base <= 0) return 0;

	const eventMultiplier = 1 + eventImpact * learnedCoeff;
	const prediction = base * Math.max(0.80, Math.min(1.30, eventMultiplier)) * marketMultiplier;

	return Math.round(prediction * 100) / 100;
}

/**
 * Learn event impact coefficient from last 90 days of event-revenue correlation.
 * Returns a multiplier that scales raw event impact scores to revenue impact.
 */
async function getLearnedEventCoefficient(
	locationId: string,
	targetDate: string,
): Promise<number> {
	const sb = getSupabase();
	const ninetyDaysAgo = new Date(targetDate + 'T12:00:00');
	ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
	const since = ninetyDaysAgo.toISOString().split('T')[0];

	// Get historical events with impact scores
	const { data: histEvents } = await sb
		.from('event_calendar')
		.select('event_date, impact_score')
		.eq('location_id', locationId)
		.gte('event_date', since)
		.lt('event_date', targetDate)
		.gt('impact_score', 0);

	if (!histEvents || histEvents.length < 3) return 0.05; // default coefficient

	// Get actuals and baseline for those dates
	const eventDates = histEvents.map((e) => e.event_date);
	const { data: actuals } = await sb
		.from('daily_actuals')
		.select('business_date, revenue')
		.eq('location_id', locationId)
		.in('business_date', eventDates.slice(0, 50))
		.gt('revenue', 0);

	if (!actuals || actuals.length < 3) return 0.05;

	// Get baseline (non-event days) average
	const { data: baselineRows } = await sb
		.from('daily_actuals')
		.select('revenue')
		.eq('location_id', locationId)
		.gte('business_date', since)
		.lt('business_date', targetDate)
		.gt('revenue', 0)
		.limit(90);

	if (!baselineRows || baselineRows.length < 14) return 0.05;

	const baselineAvg =
		baselineRows.reduce((s, r) => s + Number(r.revenue), 0) / baselineRows.length;
	if (baselineAvg <= 0) return 0.05;

	// Compute how much each event's impact_score correlates with revenue uplift
	const actualsMap = new Map<string, number>();
	for (const a of actuals) actualsMap.set(a.business_date, Number(a.revenue));

	let sumProduct = 0;
	let sumImpactSq = 0;
	for (const ev of histEvents) {
		const actual = actualsMap.get(ev.event_date);
		if (!actual) continue;
		const uplift = (actual - baselineAvg) / baselineAvg;
		const impact = ev.impact_score;
		sumProduct += impact * uplift;
		sumImpactSq += impact * impact;
	}

	if (sumImpactSq <= 0) return 0.05;

	// Regression coefficient: how much revenue changes per unit of impact_score
	const coefficient = sumProduct / sumImpactSq;
	// Clamp to reasonable range
	return Math.max(0.01, Math.min(0.20, coefficient));
}

// ---------------------------------------------------------------------------
// Model 6: Cross-Location Correlation Predictor
// ---------------------------------------------------------------------------

/**
 * Query cross_location_signals for revenue correlations with peer locations.
 * For each correlated source, fetch its recent actuals and compute a weighted
 * average prediction based on source location trends * correlation coefficient.
 * Falls back to statistical prediction if no correlated locations found.
 */
async function crossLocationCorrelationForecast(
	locationId: string,
	targetDate: string,
	statisticalFallback: number,
): Promise<number> {
	const sb = getSupabase();

	// Find correlated source locations with decent confidence
	const { data: signals } = await sb
		.from('cross_location_signals')
		.select('source_location_id, signal_type, coefficient, confidence')
		.eq('target_location_id', locationId)
		.eq('signal_type', 'revenue_correlation')
		.gt('confidence', 0.6)
		.order('confidence', { ascending: false })
		.limit(5);

	if (!signals || signals.length === 0) return statisticalFallback;

	const target = new Date(targetDate + 'T12:00:00');
	const twoWeeksAgo = new Date(target);
	twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
	const dow = target.getDay();

	let weightedSum = 0;
	let totalWeight = 0;

	for (const signal of signals as CrossLocationSignalRow[]) {
		// Get source location's recent same-DOW actuals
		const { data: sourceActuals } = await sb
			.from('daily_actuals')
			.select('business_date, revenue')
			.eq('location_id', signal.source_location_id)
			.gte('business_date', twoWeeksAgo.toISOString().split('T')[0])
			.lt('business_date', targetDate)
			.gt('revenue', 0);

		if (!sourceActuals || sourceActuals.length === 0) continue;

		const sameDow = sourceActuals.filter(
			(a) => new Date(a.business_date + 'T12:00:00').getDay() === dow,
		);
		if (sameDow.length === 0) continue;

		// Compute source location's recent trend
		const sourceAvg =
			sameDow.reduce((s, a) => s + Number(a.revenue), 0) / sameDow.length;

		// Get target location's recent same-DOW average
		const { data: targetActuals } = await sb
			.from('daily_actuals')
			.select('business_date, revenue')
			.eq('location_id', locationId)
			.gte('business_date', twoWeeksAgo.toISOString().split('T')[0])
			.lt('business_date', targetDate)
			.gt('revenue', 0);

		const targetSameDow = (targetActuals || []).filter(
			(a: any) => new Date(a.business_date + 'T12:00:00').getDay() === dow,
		);
		const targetAvg =
			targetSameDow.length > 0
				? targetSameDow.reduce((s: number, a: any) => s + Number(a.revenue), 0) / targetSameDow.length
				: 0;

		if (targetAvg <= 0 || sourceAvg <= 0) continue;

		// Get source location's historical same-DOW baseline (weeks 3-8) to measure trend
		const eightWeeksAgo = new Date(target);
		eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);
		const { data: sourceBaseline } = await sb
			.from('daily_actuals')
			.select('business_date, revenue')
			.eq('location_id', signal.source_location_id)
			.gte('business_date', eightWeeksAgo.toISOString().split('T')[0])
			.lt('business_date', twoWeeksAgo.toISOString().split('T')[0])
			.gt('revenue', 0);

		const sourceBaselineSameDow = (sourceBaseline || []).filter(
			(a: any) => new Date(a.business_date + 'T12:00:00').getDay() === dow,
		);
		const sourceBaselineAvg = sourceBaselineSameDow.length > 0
			? sourceBaselineSameDow.reduce((s: number, a: any) => s + Number(a.revenue), 0) / sourceBaselineSameDow.length
			: sourceAvg; // fallback: no trend if no baseline

		// Source trend factor: how much is source trending vs its own recent baseline?
		// e.g., +1.10 means source is running 10% above its own normal — apply to target
		const sourceTrendFactor = sourceBaselineAvg > 0 ? sourceAvg / sourceBaselineAvg : 1.0;
		// Clamp to prevent outlier events from dominating
		const clampedTrend = Math.max(0.80, Math.min(1.25, sourceTrendFactor));

		// Weight by confidence * coefficient strength
		const weight = signal.confidence * Math.abs(signal.coefficient);
		weightedSum += targetAvg * clampedTrend * weight;
		totalWeight += weight;
	}

	if (totalWeight <= 0) return statisticalFallback;

	const prediction = weightedSum / totalWeight;
	return prediction > 0 ? Math.round(prediction * 100) / 100 : statisticalFallback;
}

// ---------------------------------------------------------------------------
// Recent MAPE per model
// ---------------------------------------------------------------------------

interface ModelMape {
	statistical: number;
	neural: number;
	analogy: number;
	manager: number;
	eventAware: number;
	crossCorrelation: number;
}

/**
 * Compute each model's MAPE over the last 14 days from ensemble_history,
 * using exponential decay weighting (0.9^days_ago) so recent errors matter more.
 * Falls back to high MAPE (50%) for models with no history.
 */
async function getRecentMapes(locationId: string): Promise<ModelMape> {
	const sb = getSupabase();
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - 14);

	const { data: rows } = await sb
		.from('ensemble_history')
		.select(
			'business_date, actual, statistical_pred, neural_pred, analogy_pred, manager_pred, event_aware_pred, cross_correlation_pred',
		)
		.eq('location_id', locationId)
		.gte('business_date', cutoff.toISOString().split('T')[0])
		.not('actual', 'is', null)
		.gt('actual', 0)
		.order('business_date', { ascending: false });

	const DEFAULT_MAPE = 50;
	if (!rows || rows.length < 2) {
		return {
			statistical: DEFAULT_MAPE,
			neural: DEFAULT_MAPE,
			analogy: DEFAULT_MAPE,
			manager: DEFAULT_MAPE,
			eventAware: DEFAULT_MAPE,
			crossCorrelation: DEFAULT_MAPE,
		};
	}

	const today = new Date();

	const computeDecayedMape = (
		predictions: (number | null)[],
		actuals: number[],
		dates: string[],
	): number => {
		let weightedApe = 0;
		let totalWeight = 0;
		for (let i = 0; i < predictions.length; i++) {
			const pred = predictions[i];
			const actual = actuals[i];
			if (pred && pred > 0 && actual > 0) {
				const daysAgo = Math.max(0,
					(today.getTime() - new Date(dates[i] + 'T12:00:00').getTime()) / 86400000,
				);
				const decayWeight = Math.pow(DECAY_FACTOR, daysAgo);
				const ape = Math.abs(pred - actual) / actual;
				weightedApe += ape * decayWeight;
				totalWeight += decayWeight;
			}
		}
		return totalWeight > 0 ? (weightedApe / totalWeight) * 100 : DEFAULT_MAPE;
	};

	const actuals = rows.map((r) => Number(r.actual));
	const dates = rows.map((r) => r.business_date);

	return {
		statistical: computeDecayedMape(rows.map((r) => r.statistical_pred), actuals, dates),
		neural: computeDecayedMape(rows.map((r) => r.neural_pred), actuals, dates),
		analogy: computeDecayedMape(rows.map((r) => r.analogy_pred), actuals, dates),
		manager: computeDecayedMape(rows.map((r) => r.manager_pred), actuals, dates),
		eventAware: computeDecayedMape(rows.map((r) => r.event_aware_pred), actuals, dates),
		crossCorrelation: computeDecayedMape(rows.map((r) => r.cross_correlation_pred), actuals, dates),
	};
}

// ---------------------------------------------------------------------------
// Ensemble weighting
// ---------------------------------------------------------------------------

const WEIGHT_FLOOR = 0.05;        // reduced from 10% to 5% for 6-model ensemble
const AUTO_DISABLE_MULTIPLIER = 2; // models with MAPE > 2x avg get floor weight
const DECAY_FACTOR = 0.9;          // exponential decay per day for MAPE calculation

/**
 * Convert MAPEs to weights: inverse MAPE with auto-disable for poor performers.
 * Models whose 14-day MAPE exceeds 2x the ensemble average get floored to 5%.
 */
function mapeToWeights(
	mapes: ModelMape,
	activePredictions: Record<string, number>,
): Record<string, number> {
	const activeKeys = Object.keys(activePredictions).filter(
		(k) => activePredictions[k] > 0,
	);

	if (activeKeys.length === 0) return {};
	if (activeKeys.length === 1) return { [activeKeys[0]]: 1.0 };

	// Compute average MAPE across active models
	const activeMapes = activeKeys.map((k) => (mapes as unknown as Record<string, number>)[k] || 50);
	const avgMape = activeMapes.reduce((a, b) => a + b, 0) / activeMapes.length;
	const disableThreshold = avgMape * AUTO_DISABLE_MULTIPLIER;

	// Inverse MAPE: lower MAPE = higher weight
	// Auto-disable: if model MAPE > 2x ensemble average, force to floor
	const raw: Record<string, number> = {};
	for (const key of activeKeys) {
		const mape = (mapes as unknown as Record<string, number>)[key] || 50;
		if (mape > disableThreshold) {
			raw[key] = WEIGHT_FLOOR; // force to floor for poor performers
		} else {
			raw[key] = 1 / (mape + 1); // +1 to avoid division by zero
		}
	}

	const rawSum = Object.values(raw).reduce((a, b) => a + b, 0);

	// Normalize and apply floor
	const normalized: Record<string, number> = {};
	for (const key of activeKeys) {
		normalized[key] = Math.max(WEIGHT_FLOOR, raw[key] / rawSum);
	}

	// Re-normalize after clamping
	const clampSum = Object.values(normalized).reduce((a, b) => a + b, 0);
	for (const key of activeKeys) {
		normalized[key] = Math.round((normalized[key] / clampSum) * 1000) / 1000;
	}

	return normalized;
}

// ---------------------------------------------------------------------------
// Agreement scoring
// ---------------------------------------------------------------------------

/**
 * Compute agreement and composite confidence.
 * Composite confidence = agreement_score * (1 - avg_mape / 100)
 * This means high-MAPE models drag down overall confidence even if they agree.
 */
function computeAgreement(
	predictions: number[],
	avgMape?: number,
): {
	agreement: AgreementLevel;
	confidence: number;
} {
	const valid = predictions.filter((p) => p > 0);
	if (valid.length <= 1) return { agreement: 'low', confidence: 0.3 };

	const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
	const stddev = Math.sqrt(
		valid.reduce((s, v) => s + (v - mean) ** 2, 0) / valid.length,
	);
	const cv = mean > 0 ? stddev / mean : 1; // coefficient of variation

	// Agreement score from CV
	const agreementScore = Math.max(0.1, Math.min(0.95, 1 - cv));

	let agreement: AgreementLevel;
	if (cv < 0.05) agreement = 'high';
	else if (cv < 0.15) agreement = 'moderate';
	else agreement = 'low';

	// Composite confidence: agreement * accuracy factor
	const accuracyFactor = avgMape !== undefined
		? Math.max(0.3, 1 - avgMape / 100)
		: 1.0;
	const confidence = Math.max(0.1, Math.min(0.95, agreementScore * accuracyFactor));

	return { agreement, confidence };
}

// ---------------------------------------------------------------------------
// Main ensemble function
// ---------------------------------------------------------------------------

export async function generateEnsembleForecast(
	locationId: string,
	targetDate: string,
): Promise<EnsembleForecast> {
	// Run statistical first since Models 5 & 6 need it as fallback
	const statisticalResult = await generateForecastSuggestion(locationId, targetDate);
	const statisticalRev = statisticalResult.suggestedRevenue;

	// Run remaining 5 models in parallel
	const [neuralResult, analogyRev, managerRev, eventAwareRev, crossCorrelationRev] =
		await Promise.all([
			predictNeural(locationId, targetDate),
			analogyForecast(locationId, targetDate),
			managerConsensusForecast(locationId, targetDate),
			eventAwareForecast(locationId, targetDate, statisticalRev).catch(() => 0),
			crossLocationCorrelationForecast(locationId, targetDate, statisticalRev).catch(() => 0),
		]);

	const neuralRev = neuralResult?.revenue || 0;

	// Get recent accuracy for weighting (with exponential decay)
	const mapes = await getRecentMapes(locationId);

	// Build active predictions map
	const activePredictions: Record<string, number> = {};
	if (statisticalRev > 0) activePredictions.statistical = statisticalRev;
	if (neuralRev > 0) activePredictions.neural = neuralRev;
	if (analogyRev > 0) activePredictions.analogy = analogyRev;
	if (managerRev > 0) activePredictions.manager = managerRev;
	if (eventAwareRev > 0) activePredictions.eventAware = eventAwareRev;
	if (crossCorrelationRev > 0) activePredictions.crossCorrelation = crossCorrelationRev;

	// Compute weights (with auto-disable for poor performers)
	const weights = mapeToWeights(mapes, activePredictions);

	// Weighted average
	let ensembleRevenue = 0;
	for (const [key, pred] of Object.entries(activePredictions)) {
		ensembleRevenue += pred * (weights[key] || 0);
	}
	ensembleRevenue = Math.round(ensembleRevenue * 100) / 100;

	// If no models produced output, fall back to statistical
	if (ensembleRevenue === 0 && statisticalRev > 0) {
		ensembleRevenue = statisticalRev;
	}

	// Compute average MAPE for composite confidence
	const activeMapValues = Object.keys(activePredictions).map(
		(k) => (mapes as unknown as Record<string, number>)[k] || 50,
	);
	const avgMape = activeMapValues.length > 0
		? activeMapValues.reduce((a, b) => a + b, 0) / activeMapValues.length
		: 50;

	// Agreement and composite confidence
	const predictions = Object.values(activePredictions);
	const { agreement, confidence } = computeAgreement(predictions, avgMape);

	// Build breakdown
	const modelBreakdown: ModelPrediction[] = [
		{
			model: 'statistical',
			prediction: statisticalRev,
			weight: weights.statistical || 0,
			recentMape: Math.round(mapes.statistical * 100) / 100,
		},
		{
			model: 'neural',
			prediction: neuralRev,
			weight: weights.neural || 0,
			recentMape: Math.round(mapes.neural * 100) / 100,
		},
		{
			model: 'analogy',
			prediction: analogyRev,
			weight: weights.analogy || 0,
			recentMape: Math.round(mapes.analogy * 100) / 100,
		},
		{
			model: 'manager',
			prediction: managerRev,
			weight: weights.manager || 0,
			recentMape: Math.round(mapes.manager * 100) / 100,
		},
		{
			model: 'eventAware',
			prediction: eventAwareRev,
			weight: weights.eventAware || 0,
			recentMape: Math.round(mapes.eventAware * 100) / 100,
		},
		{
			model: 'crossCorrelation',
			prediction: crossCorrelationRev,
			weight: weights.crossCorrelation || 0,
			recentMape: Math.round(mapes.crossCorrelation * 100) / 100,
		},
	];

	// Build reasoning
	const activeCount = Object.keys(activePredictions).length;
	const parts: string[] = [`Ensemble (${activeCount}/6 models)`];
	for (const m of modelBreakdown) {
		if (m.prediction > 0) {
			parts.push(
				`${m.model}: $${Math.round(m.prediction).toLocaleString()} (${(m.weight * 100).toFixed(0)}% wt, ${m.recentMape.toFixed(1)}% MAPE)`,
			);
		}
	}
	parts.push(`Agreement: ${agreement} | Confidence: ${(confidence * 100).toFixed(0)}% | Avg MAPE: ${avgMape.toFixed(1)}%`);
	if (agreement === 'low') {
		parts.push('Models disagree significantly -- flag for manager review');
	}

	// Record ensemble history (including new models)
	await recordEnsembleHistory(
		locationId,
		targetDate,
		statisticalRev,
		neuralRev,
		analogyRev,
		managerRev,
		eventAwareRev,
		crossCorrelationRev,
		ensembleRevenue,
		weights,
	);

	return {
		revenue: ensembleRevenue,
		confidence,
		modelBreakdown,
		agreement,
		reasoning: parts.join(' | '),
		statisticalSuggestion: statisticalResult,
	};
}

// ---------------------------------------------------------------------------
// Neural prediction wrapper
// ---------------------------------------------------------------------------

async function predictNeural(
	locationId: string,
	targetDate: string,
): Promise<NeuralPrediction | null> {
	try {
		const features = await buildFeaturesForDate(locationId, targetDate);
		return await predict(locationId, features);
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// History recording
// ---------------------------------------------------------------------------

async function recordEnsembleHistory(
	locationId: string,
	businessDate: string,
	statisticalPred: number,
	neuralPred: number,
	analogyPred: number,
	managerPred: number,
	eventAwarePred: number,
	crossCorrelationPred: number,
	ensemblePred: number,
	weightsUsed: Record<string, number>,
): Promise<void> {
	try {
		const sb = getSupabaseService();
		await sb.from('ensemble_history').upsert(
			{
				location_id: locationId,
				business_date: businessDate,
				statistical_pred: statisticalPred || null,
				neural_pred: neuralPred || null,
				analogy_pred: analogyPred || null,
				manager_pred: managerPred || null,
				event_aware_pred: eventAwarePred || null,
				cross_correlation_pred: crossCorrelationPred || null,
				ensemble_pred: ensemblePred,
				weights_used_json: weightsUsed,
			},
			{ onConflict: 'location_id,business_date' },
		);
	} catch {
		// Non-critical: don't fail the forecast if history recording fails
	}
}

// ---------------------------------------------------------------------------
// Check if ensemble is enabled for a location
// ---------------------------------------------------------------------------

export async function isEnsembleEnabled(locationId: string): Promise<boolean> {
	const sb = getSupabase();
	const { data } = await sb
		.from('neural_model_weights')
		.select('training_samples, training_mape')
		.eq('location_id', locationId)
		.maybeSingle();

	// Enable ensemble only if neural model is trained with decent accuracy
	return !!(data && data.training_samples >= 30 && data.training_mape < 30);
}
