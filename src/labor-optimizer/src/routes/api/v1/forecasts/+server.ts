import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';

export const GET: RequestHandler = async ({ url }) => {
  const db = await getCollections();
  const locationId = url.searchParams.get('locationId');
  const date = url.searchParams.get('date');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  let filter: Record<string, unknown> = {};
  if (locationId) filter.locationId = locationId;
  if (date) filter.date = date;

  const forecasts = await db.forecasts.find(filter as any);

  // Filter by date range if provided
  let filtered = forecasts;
  if (startDate) filtered = filtered.filter(f => f.date >= startDate);
  if (endDate) filtered = filtered.filter(f => f.date <= endDate);

  return json({ forecasts: filtered });
};
