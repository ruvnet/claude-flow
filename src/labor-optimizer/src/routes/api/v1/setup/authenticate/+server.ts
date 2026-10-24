import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ToastClient } from '$lib/server/integrations/toast/toast-client';

export const POST: RequestHandler = async ({ request }) => {
  const { clientId, clientSecret, restaurantGuid } = await request.json();
  if (!clientId || !clientSecret) {
    return json({ error: 'clientId and clientSecret required' }, { status: 400 });
  }

  try {
    const client = new ToastClient({
      clientId, clientSecret, apiKey: '', restaurantGuid: restaurantGuid || '',
    });
    const restaurants = await client.getRestaurants();
    return json({ restaurants });
  } catch (e: any) {
    return json({ error: `Toast authentication failed: ${e.message}` }, { status: 401 });
  }
};
