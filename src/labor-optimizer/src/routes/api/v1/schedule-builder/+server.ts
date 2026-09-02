/**
 * Schedule Builder API
 *
 * GET  ?locationId=...&weekStart=...  — Generate AI shift assignments
 * POST                                — Save/confirm the assignment
 * PUT                                 — Swap an employee on a specific shift
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  generateShiftAssignments,
  saveScheduleAssignment,
  swapShiftEmployee,
  type WeeklyScheduleAssignment,
} from '$lib/server/domain/staffing/shift-assignment';

// ---------------------------------------------------------------------------
// GET — generate AI schedule assignment
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  const weekStart = url.searchParams.get('weekStart');

  if (!locationId) {
    return json({ error: 'locationId is required' }, { status: 400 });
  }
  if (!weekStart) {
    return json({ error: 'weekStart is required (YYYY-MM-DD, Monday)' }, { status: 400 });
  }

  // Validate weekStart is a Monday
  const wsDate = new Date(weekStart + 'T12:00:00');
  if (wsDate.getDay() !== 1) {
    return json(
      { error: 'weekStart must be a Monday (YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  try {
    const assignment = await generateShiftAssignments(locationId, weekStart);
    return json(assignment);
  } catch (err) {
    console.error('[schedule-builder] GET error:', err);
    return json(
      { error: 'Failed to generate shift assignments' },
      { status: 500 },
    );
  }
};

// ---------------------------------------------------------------------------
// POST — save/confirm the assignment (upserts to scheduled_shifts)
// ---------------------------------------------------------------------------

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { assignment, confirmedBy } = body as {
    assignment: WeeklyScheduleAssignment;
    confirmedBy: string;
  };

  if (!assignment || !assignment.locationId || !assignment.weekStart) {
    return json(
      { error: 'assignment with locationId and weekStart is required' },
      { status: 400 },
    );
  }
  if (!confirmedBy) {
    return json({ error: 'confirmedBy is required' }, { status: 400 });
  }

  try {
    const result = await saveScheduleAssignment(assignment, confirmedBy);

    if (result.errors.length > 0) {
      return json({
        saved: result.saved,
        errors: result.errors,
        partial: true,
      });
    }

    return json({ saved: result.saved, success: true });
  } catch (err) {
    console.error('[schedule-builder] POST error:', err);
    return json(
      { error: 'Failed to save schedule assignment' },
      { status: 500 },
    );
  }
};

// ---------------------------------------------------------------------------
// PUT — swap an employee on a specific shift (manager adjustment)
// ---------------------------------------------------------------------------

export const PUT: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { shiftId, newEmployeeId, swappedBy } = body as {
    shiftId: string;
    newEmployeeId: string;
    swappedBy: string;
  };

  if (!shiftId) {
    return json({ error: 'shiftId is required' }, { status: 400 });
  }
  if (!newEmployeeId) {
    return json({ error: 'newEmployeeId is required' }, { status: 400 });
  }
  if (!swappedBy) {
    return json({ error: 'swappedBy is required' }, { status: 400 });
  }

  try {
    const result = await swapShiftEmployee(shiftId, newEmployeeId, swappedBy);

    if (!result.success) {
      return json({ error: result.error }, { status: 400 });
    }

    return json({ swapped: true });
  } catch (err) {
    console.error('[schedule-builder] PUT error:', err);
    return json(
      { error: 'Failed to swap employee' },
      { status: 500 },
    );
  }
};
