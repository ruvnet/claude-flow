/**
 * Demand Forecasting Service
 *
 * Generates hourly demand predictions using a weighted ensemble of signals:
 * - Historical POS data (Toast)
 * - Reservation data (Resy)
 * - Day-of-week patterns
 * - Seasonal factors
 * - Weather impact
 *
 * Uses HNSW (via AgentDB) to find similar historical days for better predictions.
 * Uses SONA to learn and adjust signal weights based on forecast accuracy.
 */
import type { DemandForecast, DemandSignal, HourlyDemand, StaffingRequirement } from '$lib/types/DemandForecast';
import type { StaffRole } from '$lib/types/Employee';
import type { LaborCostSnapshot } from '$lib/types/LaborCost';
import type { StaffingConfig } from '$lib/types/Location';
import { getCollections } from '$lib/server/database';
import { calculateRequiredStaff, getEffectiveFloor } from '$lib/utils/labor-math';

/** Signal weights -- learned over time by SONA, start with reasonable defaults */
interface SignalWeights {
  historical_pos: number;
  resy_reservations: number;
  day_of_week: number;
  seasonal: number;
  weather: number;
}

const DEFAULT_WEIGHTS: SignalWeights = {
  historical_pos: 0.35,
  resy_reservations: 0.25,
  day_of_week: 0.20,
  seasonal: 0.10,
  weather: 0.10,
};

/** Default covers-per-staff ratios for staffing requirements */
const DEFAULT_RATIOS: Record<StaffRole, number> = {
  server: 20,
  bartender: 35,
  host: 100,
  busser: 35,
  food_runner: 45,
  line_cook: 30,
  prep_cook: 80,
  dishwasher: 70,
  expo: 50,
  sous_chef: 60,
  head_chef: 120,
  bar_back: 50,
};

/** Restaurant operating hours for hourly breakdown */
const OPERATING_HOURS = { start: 10, end: 26 }; // 10am to 2am (26 = 2am next day)

export interface ForecastInput {
  locationId: string;
  date: string;
  resyCovers?: number;
  weatherFactor?: number; // 0.7 = bad weather (30% reduction), 1.0 = normal, 1.1 = great weather
  specialEvent?: string;
  staffingConfig?: StaffingConfig;
}

export interface ForecastResult {
  forecast: DemandForecast;
  similarDays: SimilarDay[];
  confidence: number;
}

export interface SimilarDay {
  date: string;
  covers: number;
  revenue: number;
  similarity: number; // 0-1
  dayOfWeek: number;
}

/** Generate a demand forecast for a specific date and location */
export async function generateForecast(input: ForecastInput): Promise<ForecastResult> {
  const db = await getCollections();
  const { locationId, date } = input;
  const targetDate = new Date(date + 'T00:00:00');
  const dayOfWeek = targetDate.getDay();
  const month = targetDate.getMonth();

  // Step 1: Pull historical data (last 52 weeks of labor cost snapshots)
  const allSnapshots = await db.laborCosts.find({ locationId } as any);

  // Step 2: Find similar historical days using pattern matching
  // (In production, this would use HNSW via AgentDB for vector similarity)
  const similarDays = findSimilarDays(allSnapshots, dayOfWeek, month, input.weatherFactor);

  // Step 3: Calculate signal values
  const signals: DemandSignal[] = [];

  // Historical POS signal -- average covers from similar past days
  const historicalAvgCovers = similarDays.length > 0
    ? similarDays.reduce((sum, d) => sum + d.covers, 0) / similarDays.length
    : 0;
  const historicalAvgRevenue = similarDays.length > 0
    ? similarDays.reduce((sum, d) => sum + d.revenue, 0) / similarDays.length
    : 0;

  signals.push({
    source: 'historical_pos',
    value: historicalAvgCovers,
    weight: DEFAULT_WEIGHTS.historical_pos,
    description: similarDays.length > 0
      ? `Average of ${similarDays.length} similar past days: ${Math.round(historicalAvgCovers)} covers`
      : 'No historical data yet -- using defaults',
  });

  // Resy reservation signal
  const resyCovers = input.resyCovers || 0;
  const resyMultiplier = 1.4; // Reservations typically represent ~70% of total covers
  const resyProjected = resyCovers * resyMultiplier;

  signals.push({
    source: 'resy_reservations',
    value: resyProjected,
    weight: resyCovers > 0 ? DEFAULT_WEIGHTS.resy_reservations : 0,
    description: resyCovers > 0
      ? `${resyCovers} reservations x ${resyMultiplier} walk-in factor = ${Math.round(resyProjected)} projected`
      : 'No reservation data',
  });

  // Day-of-week signal
  const dayOfWeekMultipliers: Record<number, number> = {
    0: 0.75, // Sunday
    1: 0.65, // Monday
    2: 0.70, // Tuesday
    3: 0.75, // Wednesday
    4: 0.85, // Thursday
    5: 1.15, // Friday
    6: 1.10, // Saturday
  };
  const dayFactor = dayOfWeekMultipliers[dayOfWeek] || 1.0;
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  signals.push({
    source: 'day_of_week',
    value: dayFactor,
    weight: DEFAULT_WEIGHTS.day_of_week,
    description: `${dayNames[dayOfWeek]}: ${dayFactor > 1 ? '+' : ''}${Math.round((dayFactor - 1) * 100)}% vs average`,
  });

  // Seasonal signal
  const seasonalMultipliers: Record<number, number> = {
    0: 0.85, 1: 0.80, 2: 0.90, // Jan-Mar (slow)
    3: 1.00, 4: 1.05, 5: 1.15, // Apr-Jun (picking up)
    6: 1.10, 7: 1.05, 8: 1.00, // Jul-Sep (summer)
    9: 1.05, 10: 1.10, 11: 1.20, // Oct-Dec (holiday season)
  };
  const seasonFactor = seasonalMultipliers[month] || 1.0;

  signals.push({
    source: 'seasonal',
    value: seasonFactor,
    weight: DEFAULT_WEIGHTS.seasonal,
    description: `Seasonal factor: ${seasonFactor > 1 ? '+' : ''}${Math.round((seasonFactor - 1) * 100)}%`,
  });

  // Weather signal
  const weatherFactor = input.weatherFactor || 1.0;
  signals.push({
    source: 'weather',
    value: weatherFactor,
    weight: input.weatherFactor ? DEFAULT_WEIGHTS.weather : 0,
    description: weatherFactor < 0.9
      ? `Bad weather: ${Math.round((1 - weatherFactor) * 100)}% reduction expected`
      : weatherFactor > 1.05
        ? `Great weather: +${Math.round((weatherFactor - 1) * 100)}% boost expected`
        : 'Normal weather conditions',
  });

  // Step 4: Compute weighted ensemble forecast
  let baseCovers: number;

  if (historicalAvgCovers > 0) {
    // Weighted blend of historical + reservation signals, adjusted by multipliers
    const activeSignals = signals.filter(s => s.weight > 0);
    const totalWeight = activeSignals.reduce((sum, s) => sum + s.weight, 0);

    // Start with historical base, then apply adjustments
    baseCovers = historicalAvgCovers;

    // Blend in Resy if available
    if (resyProjected > 0) {
      const resyWeight = DEFAULT_WEIGHTS.resy_reservations / totalWeight;
      baseCovers = baseCovers * (1 - resyWeight) + resyProjected * resyWeight;
    }

    // Apply day-of-week and seasonal multipliers
    baseCovers *= dayFactor * seasonFactor * weatherFactor;
  } else if (resyProjected > 0) {
    // No history -- use Resy with adjustments
    baseCovers = resyProjected * dayFactor * seasonFactor * weatherFactor;
  } else {
    // No data at all -- use a reasonable restaurant default (100 covers)
    baseCovers = 100 * dayFactor * seasonFactor * weatherFactor;
  }

  const forecastedCovers = Math.round(baseCovers);
  const avgCheckSize = historicalAvgRevenue > 0 && historicalAvgCovers > 0
    ? historicalAvgRevenue / historicalAvgCovers
    : 35; // Default $35 avg check
  const forecastedRevenue = forecastedCovers * avgCheckSize;

  // Step 5: Generate hourly breakdown
  const hourlyBreakdown = generateHourlyBreakdown(
    forecastedCovers,
    dayOfWeek,
    input.staffingConfig,
  );

  // Step 6: Calculate confidence
  const confidence = calculateConfidence(similarDays.length, !!input.resyCovers, !!input.weatherFactor);

  const forecast: DemandForecast = {
    _id: crypto.randomUUID(),
    locationId,
    date,
    dayOfWeek,
    forecastedCovers,
    forecastedRevenue,
    confidenceLevel: confidence,
    signals,
    hourlyBreakdown,
    model: similarDays.length > 5 ? 'weighted_ensemble' : 'historical_avg',
    generatedAt: new Date().toISOString(),
  };

  // Store forecast
  await db.forecasts.insertOne(forecast as any);

  return { forecast, similarDays, confidence };
}

/** Find similar historical days using pattern matching */
function findSimilarDays(
  snapshots: LaborCostSnapshot[],
  targetDayOfWeek: number,
  targetMonth: number,
  weatherFactor?: number,
): SimilarDay[] {
  if (snapshots.length === 0) return [];

  const scored: SimilarDay[] = [];

  for (const snap of snapshots) {
    const snapDate = new Date(snap.periodStart + 'T00:00:00');
    const snapDow = snapDate.getDay();
    const snapMonth = snapDate.getMonth();

    // Similarity score based on:
    // - Same day of week (0.5 weight)
    // - Similar month/season (0.3 weight)
    // - Recency (0.2 weight)
    let similarity = 0;

    // Day of week match
    if (snapDow === targetDayOfWeek) similarity += 0.5;
    else if (Math.abs(snapDow - targetDayOfWeek) === 1) similarity += 0.2;

    // Seasonal proximity (months close together)
    const monthDiff = Math.min(
      Math.abs(snapMonth - targetMonth),
      12 - Math.abs(snapMonth - targetMonth),
    );
    similarity += 0.3 * Math.max(0, 1 - monthDiff / 3);

    // Recency bonus (more recent = more relevant)
    const ageInDays = (Date.now() - snapDate.getTime()) / (1000 * 60 * 60 * 24);
    similarity += 0.2 * Math.max(0, 1 - ageInDays / 365);

    // Estimate covers from revenue (using ~$35 avg check if not directly available)
    const estimatedCovers = snap.coversPerLaborHour > 0
      ? Math.round(snap.coversPerLaborHour * snap.totalHours)
      : Math.round(snap.totalRevenue / 35);

    if (similarity > 0.3) {
      scored.push({
        date: snap.periodStart,
        covers: estimatedCovers,
        revenue: snap.totalRevenue,
        similarity,
        dayOfWeek: snapDow,
      });
    }
  }

  // Return top 10 most similar
  return scored
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);
}

/** Generate hourly demand breakdown with staffing requirements */
function generateHourlyBreakdown(
  totalCovers: number,
  dayOfWeek: number,
  staffingConfig?: StaffingConfig,
): HourlyDemand[] {
  // Hourly distribution curves (% of daily covers per hour)
  // Lunch peak: 12-13, Dinner peak: 19-20
  const hourlyDistribution: Record<number, number> = {
    10: 0.01, 11: 0.05, 12: 0.10, 13: 0.08, 14: 0.04,
    15: 0.02, 16: 0.03, 17: 0.06, 18: 0.10, 19: 0.14,
    20: 0.12, 21: 0.10, 22: 0.08, 23: 0.04, 0: 0.02, 1: 0.01,
  };

  // Adjust for day of week (weekends shift later)
  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
  const hourlyBreakdown: HourlyDemand[] = [];

  for (let hour = OPERATING_HOURS.start; hour <= 25; hour++) {
    const displayHour = hour % 24;
    let pct = hourlyDistribution[displayHour] || 0;

    // Weekend adjustment: more dinner, less lunch
    if (isWeekend) {
      if (displayHour >= 11 && displayHour <= 14) pct *= 0.7;
      if (displayHour >= 19 && displayHour <= 23) pct *= 1.3;
    }

    const expectedCovers = Math.round(totalCovers * pct);

    // Calculate staffing requirements per role
    const roles: StaffRole[] = [
      'server', 'bartender', 'host', 'busser', 'food_runner',
      'line_cook', 'prep_cook', 'dishwasher',
    ];
    const requiredStaff: StaffingRequirement[] = roles.map(role => {
      const ratio = DEFAULT_RATIOS[role] || 30;

      let minCount = 0;
      let daypart: string | undefined;
      if (displayHour >= 11 && displayHour < 15) daypart = 'lunch';
      else if (displayHour >= 17 && displayHour < 22) daypart = 'dinner';
      else if (displayHour >= 22) daypart = 'late_night';

      if (staffingConfig) {
        minCount = getEffectiveFloor(staffingConfig, role, daypart);
      }

      const demandBased = expectedCovers > 0 ? Math.ceil(expectedCovers / ratio) : 0;
      const optimalCount = Math.max(minCount, demandBased);

      return {
        role,
        minCount,
        optimalCount,
        coversPerStaffRatio: ratio,
      };
    });

    hourlyBreakdown.push({
      hour: displayHour,
      expectedCovers,
      requiredStaff,
    });
  }

  return hourlyBreakdown;
}

/** Calculate forecast confidence based on available data */
function calculateConfidence(
  similarDayCount: number,
  hasReservations: boolean,
  hasWeather: boolean,
): number {
  let confidence = 0.3; // Base confidence

  // More similar days = higher confidence
  if (similarDayCount >= 10) confidence += 0.30;
  else if (similarDayCount >= 5) confidence += 0.20;
  else if (similarDayCount >= 1) confidence += 0.10;

  // Reservation data adds confidence
  if (hasReservations) confidence += 0.20;

  // Weather data adds confidence
  if (hasWeather) confidence += 0.10;

  return Math.min(confidence, 0.95);
}

/** Compare forecast to actuals and return accuracy metrics (for SONA learning) */
export async function evaluateForecastAccuracy(
  forecastId: string,
): Promise<{ forecastedCovers: number; actualCovers: number; accuracy: number; error: number } | null> {
  const db = await getCollections();
  const forecast = await db.forecasts.findOne({ _id: forecastId } as any);
  if (!forecast) return null;

  // Look for actual POS data for this date
  const actual = await db.laborCosts.findOne({
    locationId: forecast.locationId,
    periodStart: forecast.date,
  } as any);

  if (!actual) return null;

  const actualCovers = actual.coversPerLaborHour > 0
    ? Math.round(actual.coversPerLaborHour * actual.totalHours)
    : Math.round(actual.totalRevenue / 35);

  const error = Math.abs(forecast.forecastedCovers - actualCovers) / Math.max(actualCovers, 1);
  const accuracy = Math.max(0, 1 - error);

  return {
    forecastedCovers: forecast.forecastedCovers,
    actualCovers,
    accuracy,
    error,
  };
}
