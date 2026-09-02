import { json, type RequestHandler } from '@sveltejs/kit';
import { generateForecast, evaluateForecastAccuracy } from '$lib/server/domain/forecasting/forecast.service';
import { discoverPatterns } from '$lib/server/domain/forecasting/pattern-analyzer';
import { getCollections } from '$lib/server/database';
import { createResyClient } from '$lib/server/integrations/resy/resy-client';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { locationId, date, startDate, endDate, includePatterns } = body;

  if (!locationId || (!date && !startDate)) {
    return json({ error: 'locationId and date (or startDate) required' }, { status: 400 });
  }

  // Get location config
  const db = await getCollections();
  const location = await db.locations.findOne({ _id: locationId } as any);
  const staffingConfig = location?.staffingConfig;

  // Try to get Resy reservation data
  let resyCovers: number | undefined;
  const resyClient = createResyClient();
  if (resyClient) {
    try {
      const summary = await resyClient.getAvailabilitySummary(date || startDate);
      resyCovers = summary.totalCovers;
    } catch (e) {
      console.warn('[Forecast] Resy data unavailable:', e);
    }
  }

  if (date) {
    // Single date forecast
    const result = await generateForecast({
      locationId,
      date,
      resyCovers,
      staffingConfig,
    });

    const patterns = includePatterns ? await discoverPatterns(locationId) : [];

    return json({
      status: 'forecast_complete',
      forecast: result.forecast,
      similarDays: result.similarDays,
      confidence: result.confidence,
      patterns,
    });
  }

  // Date range forecast
  const results = [];
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date(startDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const result = await generateForecast({
      locationId,
      date: dateStr,
      staffingConfig,
    });
    results.push(result.forecast);
  }

  return json({
    status: 'forecast_complete',
    forecasts: results,
    count: results.length,
  });
};
