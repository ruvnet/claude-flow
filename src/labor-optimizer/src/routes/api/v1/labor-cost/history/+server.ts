import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';

export const GET: RequestHandler = async ({ url }) => {
  const db = await getCollections();
  const locationId = url.searchParams.get('locationId');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  let filter: Record<string, unknown> = {};
  if (locationId) filter.locationId = locationId;

  const snapshots = await db.laborCosts.find(filter as any);

  return json({ snapshots });
};
