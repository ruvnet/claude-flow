import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importResyCsv } from '$lib/server/integrations/resy/resy-service';

/**
 * POST /api/v1/resy-upload
 *
 * Accepts a multipart form upload with a Resy CSV export.
 * Parses the CSV, aggregates by day, and upserts into daily_reservations.
 *
 * Form fields:
 *   - file: CSV file
 *   - locationId: UUID of the location
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const file = formData.get('file');
		const locationId = formData.get('locationId');

		if (!locationId || typeof locationId !== 'string') {
			return json({ error: 'locationId is required' }, { status: 400 });
		}

		if (!file || !(file instanceof File)) {
			return json({ error: 'CSV file is required' }, { status: 400 });
		}

		if (!file.name.endsWith('.csv')) {
			return json({ error: 'File must be a .csv file' }, { status: 400 });
		}

		// Read file content
		const csvContent = await file.text();
		if (!csvContent.trim()) {
			return json({ error: 'CSV file is empty' }, { status: 400 });
		}

		const result = await importResyCsv(locationId, csvContent);

		if (result.error) {
			return json({
				error: result.error,
				daysProcessed: result.daysProcessed,
			}, { status: 422 });
		}

		return json({
			success: true,
			daysProcessed: result.daysProcessed,
			totalCovers: result.totalCovers,
			message: `Imported ${result.daysProcessed} days of reservation data (${result.totalCovers} total covers)`,
		});
	} catch (err: any) {
		console.error('[Resy Upload] Error:', err);
		return json({ error: err.message || 'Upload failed' }, { status: 500 });
	}
};
