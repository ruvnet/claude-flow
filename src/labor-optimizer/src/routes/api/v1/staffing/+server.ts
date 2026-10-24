/**
 * Predictive Staffing API
 *
 * GET /api/v1/staffing?locationId=...&startDate=...&endDate=...
 *
 * Returns shift-level headcount recommendations based on forecast revenue,
 * plus actuals reconciliation data for past days.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getStaffingRange,
  getActualsForRange,
  computeShiftPatterns,
} from '$lib/server/domain/staffing/predictive-staffing';

export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');

  if (!locationId) {
    return json({ error: 'locationId is required' }, { status: 400 });
  }
  if (!startDate || !endDate) {
    return json({ error: 'startDate and endDate are required' }, { status: 400 });
  }

  try {
    const [days, actuals, patterns] = await Promise.all([
      getStaffingRange(locationId, startDate, endDate),
      getActualsForRange(locationId, startDate, endDate),
      computeShiftPatterns(locationId, startDate, endDate),
    ]);

    return json({ days, actuals, patterns });
  } catch (err) {
    console.error('[Staffing API]', err);
    return json(
      { error: 'Failed to generate staffing recommendation' },
      { status: 500 },
    );
  }
};
