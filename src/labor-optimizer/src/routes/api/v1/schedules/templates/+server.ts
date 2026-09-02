import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';

/** GET: List templates for a location */
export const GET: RequestHandler = async ({ url }) => {
  const db = await getCollections();
  const locationId = url.searchParams.get('locationId');

  let filter: Record<string, unknown> = {};
  if (locationId) filter.locationId = locationId;

  const templates = await db.shiftTemplates.find(filter as any);
  return json({ templates });
};

/** POST: Save current schedule day as a template */
export const POST: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();

  const { name, locationId, dayOfWeek, shiftSlots } = body;

  if (!name || !locationId || dayOfWeek === undefined || !shiftSlots?.length) {
    return json({ error: 'name, locationId, dayOfWeek, and shiftSlots required' }, { status: 400 });
  }

  const template = {
    _id: crypto.randomUUID(),
    name,
    locationId,
    dayOfWeek,
    shiftSlots,
  };

  await db.shiftTemplates.insertOne(template as any);
  return json({ template }, { status: 201 });
};

/** DELETE: Remove a template */
export const DELETE: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();
  const { templateId } = body;

  if (!templateId) {
    return json({ error: 'templateId required' }, { status: 400 });
  }

  await db.shiftTemplates.deleteOne({ _id: templateId } as any);
  return json({ success: true });
};
