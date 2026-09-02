/**
 * Staffing Constraints API
 *
 * GET  /api/v1/staffing-constraints?locationId=...  — returns current constraints
 * POST /api/v1/staffing-constraints                 — upserts constraints
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getStaffingConstraints,
  upsertConstraints,
} from '$lib/server/domain/staffing/staffing-constraints';

export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  if (!locationId) {
    return json({ error: 'locationId is required' }, { status: 400 });
  }

  try {
    const constraints = await getStaffingConstraints(locationId);
    return json({ constraints });
  } catch (err: any) {
    console.error('[staffing-constraints GET]', err);
    return json({ error: err.message || 'Failed to load constraints' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { locationId, constraints } = body;

    if (!locationId) {
      return json({ error: 'locationId is required' }, { status: 400 });
    }
    if (!Array.isArray(constraints) || constraints.length === 0) {
      return json({ error: 'constraints array is required' }, { status: 400 });
    }

    // Validate each constraint
    for (const c of constraints) {
      if (!c.position) {
        return json({ error: 'Each constraint must have a position' }, { status: 400 });
      }
      if (typeof c.minHeadcount !== 'number' || typeof c.maxHeadcount !== 'number') {
        return json(
          { error: `${c.position}: minHeadcount and maxHeadcount must be numbers` },
          { status: 400 },
        );
      }
    }

    const result = await upsertConstraints(locationId, constraints);
    return json(result);
  } catch (err: any) {
    console.error('[staffing-constraints POST]', err);
    return json({ error: err.message || 'Failed to save constraints' }, { status: 500 });
  }
};
