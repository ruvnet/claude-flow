import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';

export const GET: RequestHandler = async ({ url }) => {
  const db = await getCollections();
  const locationId = url.searchParams.get('locationId');
  const weekStartDate = url.searchParams.get('weekStartDate');

  let filter: Record<string, unknown> = {};
  if (locationId) filter.locationId = locationId;
  if (weekStartDate) filter.weekStartDate = weekStartDate;

  const schedules = await db.schedules.find(filter as any);
  return json({ schedules });
};

export const POST: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();

  const { locationId, weekStartDate } = body;

  if (!locationId || !weekStartDate) {
    return json({ error: 'locationId and weekStartDate are required' }, { status: 400 });
  }

  const now = new Date().toISOString();
  const schedule = {
    _id: crypto.randomUUID(),
    locationId,
    weekStartDate,
    status: 'draft' as const,
    shifts: [],
    totalLaborCost: 0,
    totalScheduledHours: 0,
    projectedRevenue: 0,
    laborCostPct: 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.schedules.insertOne(schedule as any);
  return json({ schedule }, { status: 201 });
};
