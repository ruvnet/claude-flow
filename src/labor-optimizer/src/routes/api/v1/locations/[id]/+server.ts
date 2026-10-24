import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';
import { updateLocationSchema } from '$lib/utils/validators';

export const GET: RequestHandler = async ({ params }) => {
  const db = await getCollections();
  const location = await db.locations.findOne({ _id: params.id } as any);

  if (!location) {
    return json({ error: 'Location not found' }, { status: 404 });
  }

  return json({ location });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const db = await getCollections();
  const body = await request.json();

  const parsed = updateLocationSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  const result = await db.locations.updateOne(
    { _id: params.id } as any,
    { $set: parsed.data as any }
  );

  if (result.modifiedCount === 0) {
    return json({ error: 'Location not found' }, { status: 404 });
  }

  const location = await db.locations.findOne({ _id: params.id } as any);
  return json({ location });
};
