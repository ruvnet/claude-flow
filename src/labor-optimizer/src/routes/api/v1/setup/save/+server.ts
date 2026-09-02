import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const POST: RequestHandler = async ({ request }) => {
  const { name, toastGuid, clientId, clientSecret, jobMappings, p1StartDate } = await request.json();
  const sb = getSupabaseService();

  // Create location
  const { data: loc, error: locErr } = await sb.from('locations').insert({
    name,
    type: 'restaurant_bar',
    toast_guid: toastGuid,
    toast_client_id: clientId,
    toast_client_secret: clientSecret,
    timezone: 'America/New_York',
    labor_budget_pct: 0.2800,
    period_start_date: p1StartDate,
    is_active: true,
  }).select().single();

  if (locErr || !loc) {
    return json({ error: locErr?.message || 'Failed to create location' }, { status: 500 });
  }

  // Save job mappings
  const mappingRows = Object.entries(jobMappings).map(([toastJob, position]) => ({
    location_id: loc.id,
    toast_job_name: toastJob,
    dashboard_position: position,
  }));
  if (mappingRows.length > 0) {
    await sb.from('toast_job_mapping').insert(mappingRows);
  }

  // Generate 13 periods
  const periods = [];
  const start = new Date(p1StartDate + 'T00:00:00');
  for (let p = 1; p <= 13; p++) {
    const pStart = new Date(start);
    pStart.setDate(pStart.getDate() + (p - 1) * 28);
    const pEnd = new Date(pStart);
    pEnd.setDate(pEnd.getDate() + 27);
    periods.push({
      location_id: loc.id,
      period_number: p,
      year: pStart.getFullYear(),
      start_date: pStart.toISOString().split('T')[0],
      end_date: pEnd.toISOString().split('T')[0],
    });
  }
  await sb.from('periods').insert(periods);

  // Insert default DOW weights
  const defaultWeights: Record<string, number[]> = {
    // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
    'Server': [1.05, 1.30, 1.25, 1.15, 1.00, 0.90, 0.90],
    'Bartender': [1.05, 1.25, 1.20, 1.10, 1.00, 0.95, 0.90],
    'Host': [1.15, 1.45, 1.40, 1.25, 1.00, 0.90, 0.85],
    'Barista': [1.20, 1.45, 1.40, 1.25, 1.00, 0.95, 0.95],
    'Support': [1.03, 1.20, 1.15, 1.08, 1.00, 0.97, 0.94],
    'Training': [1.05, 1.20, 1.15, 1.10, 1.00, 0.95, 0.90],
    'Line Cooks': [1.00, 1.20, 1.15, 1.10, 1.00, 0.95, 0.92],
    'Prep Cooks': [1.05, 1.35, 1.30, 1.20, 1.00, 0.90, 0.85],
    'Pastry': [1.15, 1.40, 1.35, 1.25, 1.00, 0.90, 0.90],
    'Dishwashers': [1.08, 1.25, 1.20, 1.15, 1.00, 0.98, 0.96],
  };
  const weightRows: { location_id: string; position: string; day_of_week: number; weight: number }[] = [];
  for (const [position, weights] of Object.entries(defaultWeights)) {
    for (let dow = 0; dow < 7; dow++) {
      weightRows.push({ location_id: loc.id, position, day_of_week: dow, weight: weights[dow] });
    }
  }
  await sb.from('dow_weights').insert(weightRows);

  return json({ locationId: loc.id, name: loc.name, periods: periods.length });
};
