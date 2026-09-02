import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { locationId, dates, adminKey } = body;

  // Simple admin key check
  if (adminKey !== 'helixo-admin-2026') {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const results: any[] = [];

  // Get location + Toast credentials
  const { data: loc } = await sb
    .from('locations')
    .select('id, name, toast_guid, toast_client_id, toast_client_secret')
    .eq('id', locationId)
    .single();

  if (!loc) return json({ error: 'Location not found' }, { status: 404 });

  const toastClient = createToastClientFromCredentials({
    clientId: loc.toast_client_id || process.env.TOAST_STANDARD_CLIENT_ID || '',
    clientSecret: loc.toast_client_secret || process.env.TOAST_STANDARD_CLIENT_SECRET || '',
    restaurantGuid: loc.toast_guid || process.env.TOAST_RESTAURANT_GUID || '78cf784e-8713-4949-9e09-68aa46e15a2d',
  });

  for (const date of dates) {
    try {
      // Delete old hourly data
      await sb
        .from('daily_hourly_sales')
        .delete()
        .eq('location_id', locationId)
        .eq('business_date', date);

      // Fetch fresh hourly data (with EST timezone fix)
      const hourlyData = await toastClient.getHourlySales(date);

      // Upsert
      if (hourlyData.length > 0) {
        const rows = hourlyData.map(h => ({
          location_id: locationId,
          business_date: date,
          hour_of_day: h.hour,
          revenue: h.revenue,
          covers: h.covers,
          order_count: h.orderCount,
        }));

        await sb.from('daily_hourly_sales').upsert(rows, {
          onConflict: 'location_id,business_date,hour_of_day',
        });
      }

      results.push({ date, hours: hourlyData.length, status: 'ok' });
    } catch (e: any) {
      results.push({ date, status: 'error', error: e.message });
    }
  }

  return json({ results });
};
