import { json, type RequestHandler } from '@sveltejs/kit';
import { syncDay, syncDateRange } from '$lib/server/integrations/toast/toast-sync';

/** POST: Trigger Toast data sync */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { date, startDate, endDate } = body;

  if (startDate && endDate) {
    // Range sync (backfill)
    const results = await syncDateRange(startDate, endDate);
    return json({
      status: 'sync_complete',
      daysProcessed: results.length,
      results,
    });
  }

  if (date) {
    // Single day sync
    const result = await syncDay(date);
    if (!result) {
      return json({ error: 'Sync failed — check Toast credentials' }, { status: 500 });
    }
    return json({ status: 'sync_complete', result });
  }

  // Default: sync today
  const today = new Date().toISOString().split('T')[0];
  const result = await syncDay(today);
  if (!result) {
    return json({ error: 'Sync failed — check Toast credentials' }, { status: 500 });
  }
  return json({ status: 'sync_complete', result });
};
