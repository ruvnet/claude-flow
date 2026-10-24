import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { parseResySurveyCsv } from '$lib/server/integrations/resy/resy-survey-parser';

export const POST: RequestHandler = async ({ request }) => {
  const sb = getSupabaseService();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const locationId = formData.get('locationId') as string | null;

  if (!file || !locationId) {
    return json({ error: 'Missing file or locationId' }, { status: 400 });
  }

  const csvText = await file.text();
  const { rows, errors } = parseResySurveyCsv(csvText);

  if (rows.length === 0) {
    return json(
      {
        success: false,
        rowsProcessed: 0,
        rowsInserted: 0,
        errors: errors.length > 0 ? errors : ['No valid rows found in CSV'],
      },
      { status: 422 },
    );
  }

  let inserted = 0;
  const insertErrors: string[] = [...errors];

  for (const row of rows) {
    const { error } = await sb.from('guest_surveys').upsert(
      {
        location_id: locationId,
        survey_date: row.survey_date,
        guest_name: row.guest_name,
        guest_email: row.guest_email,
        server_name: row.server_name,
        recommend_score: row.recommend_score,
        food_score: row.food_score,
        service_score: row.service_score,
        ambiance_score: row.ambiance_score,
        value_score: row.value_score,
        overall_score: row.overall_score,
        comment: row.comment,
        source: 'resy_csv',
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'location_id,survey_date,guest_email,server_name' },
    );

    if (error) {
      insertErrors.push(`Row ${row.survey_date}: ${error.message}`);
    } else {
      inserted++;
    }
  }

  return json({
    success: inserted > 0,
    rowsProcessed: rows.length,
    rowsInserted: inserted,
    errors: insertErrors,
  });
};
