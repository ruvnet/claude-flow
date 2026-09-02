import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * List all restaurants accessible with Toast partner credentials.
 * Tries multiple Toast API endpoints to discover restaurant GUIDs.
 */
export const POST: RequestHandler = async ({ request }) => {
  const { clientId, clientSecret } = await request.json();
  if (!clientId || !clientSecret) {
    return json({ error: 'clientId and clientSecret required' }, { status: 400 });
  }

  try {
    // Authenticate
    const authRes = await fetch(
      'https://ws-api.toasttab.com/authentication/v1/authentication/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' }),
      }
    );
    if (!authRes.ok) {
      return json({ error: `Auth failed: ${authRes.status}` }, { status: 401 });
    }
    const authData = await authRes.json();
    const token = authData.token?.accessToken || authData.accessToken;
    if (!token) {
      return json({ error: 'No access token in auth response' }, { status: 401 });
    }

    const results: Record<string, unknown> = {};

    // Try /restaurants/v1/restaurants (partner-level, no restaurant GUID needed)
    try {
      const res = await fetch('https://ws-api.toasttab.com/restaurants/v1/restaurants', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      results.restaurants_endpoint = {
        status: res.status,
        statusText: res.statusText,
        body: res.ok ? await res.json() : await res.text(),
      };
    } catch (e: any) {
      results.restaurants_endpoint = { error: e.message };
    }

    // Try /partners/v1/restaurants (partner endpoint)
    try {
      const res = await fetch('https://ws-api.toasttab.com/partners/v1/restaurants', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      results.partners_endpoint = {
        status: res.status,
        statusText: res.statusText,
        body: res.ok ? await res.json() : await res.text(),
      };
    } catch (e: any) {
      results.partners_endpoint = { error: e.message };
    }

    // Try /config/v1/restaurantInfo with Lowland GUID to confirm the pattern works
    try {
      const res = await fetch('https://ws-api.toasttab.com/config/v1/restaurantInfo', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Toast-Restaurant-External-ID': '8a5cb8ab-308d-482f-b498-c6bc2a16c96c',
          'Content-Type': 'application/json',
        },
      });
      const body = res.ok ? await res.json() : await res.text();
      results.lowland_config = {
        status: res.status,
        name: body?.general?.name,
        guid: body?.guid,
      };
    } catch (e: any) {
      results.lowland_config = { error: e.message };
    }

    return json(results);
  } catch (e: any) {
    return json({ error: e.message }, { status: 500 });
  }
};
