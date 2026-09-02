import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ToastClient } from '$lib/server/integrations/toast/toast-client';

export const POST: RequestHandler = async ({ request }) => {
  const { clientId, clientSecret, restaurantGuid } = await request.json();
  if (!clientId || !clientSecret || !restaurantGuid) {
    return json({ error: 'clientId, clientSecret, restaurantGuid required' }, { status: 400 });
  }

  try {
    const client = new ToastClient({
      clientId, clientSecret, apiKey: '', restaurantGuid,
    });
    const jobs = await client.getJobs();
    return json({ jobs });
  } catch (e: any) {
    return json({ error: `Failed to fetch jobs: ${e.message}` }, { status: 500 });
  }
};
