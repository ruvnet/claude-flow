import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';
import { createShiftSchema } from '$lib/utils/validators';
import { addShift, summarizeSchedule } from '$lib/server/domain/scheduling/schedule.service';
import { calculateShiftHours, calculateShiftCost } from '$lib/utils/labor-math';

/** POST: Add a shift to a schedule */
export const POST: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();

  const { scheduleId, ...shiftData } = body;

  if (!scheduleId) {
    return json({ error: 'scheduleId required' }, { status: 400 });
  }

  const parsed = createShiftSchema.safeParse(shiftData);
  if (!parsed.success) {
    return json({ error: 'Validation failed', details: parsed.error.issues }, { status: 400 });
  }

  // Load schedule
  const schedule = await db.schedules.findOne({ _id: scheduleId } as any);
  if (!schedule) {
    return json({ error: 'Schedule not found' }, { status: 404 });
  }

  if (schedule.status === 'published') {
    return json({ error: 'Cannot modify a published schedule' }, { status: 400 });
  }

  // Load employee
  const employee = await db.employees.findOne({ _id: parsed.data.employeeId } as any);
  if (!employee) {
    return json({ error: 'Employee not found' }, { status: 404 });
  }

  // Get existing shifts for conflict detection
  const existingShifts = schedule.shifts || [];

  // Add shift with conflict detection
  const result = addShift(schedule, { ...parsed.data, status: 'scheduled' } as any, employee, existingShifts);

  // Add to schedule's shifts array
  const updatedShifts = [...existingShifts, result.shift];

  // Recalculate totals
  let totalHours = 0;
  let totalCost = 0;
  for (const s of updatedShifts) {
    totalHours += calculateShiftHours(s.startTime, s.endTime, s.breakMinutes);
    totalCost += s.laborCost;
  }

  await db.schedules.updateOne(
    { _id: scheduleId } as any,
    { $set: {
      shifts: updatedShifts,
      totalScheduledHours: totalHours,
      totalLaborCost: totalCost,
    } as any }
  );

  return json({
    shift: result.shift,
    conflicts: result.conflicts,
    schedule: {
      totalShifts: updatedShifts.length,
      totalScheduledHours: totalHours,
      totalLaborCost: totalCost,
    },
  }, { status: 201 });
};

/** DELETE: Remove a shift from a schedule */
export const DELETE: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();
  const { scheduleId, shiftId } = body;

  if (!scheduleId || !shiftId) {
    return json({ error: 'scheduleId and shiftId required' }, { status: 400 });
  }

  const schedule = await db.schedules.findOne({ _id: scheduleId } as any);
  if (!schedule) {
    return json({ error: 'Schedule not found' }, { status: 404 });
  }

  if (schedule.status === 'published') {
    return json({ error: 'Cannot modify a published schedule' }, { status: 400 });
  }

  const updatedShifts = (schedule.shifts || []).filter((s: any) => s._id !== shiftId);

  let totalHours = 0;
  let totalCost = 0;
  for (const s of updatedShifts) {
    totalHours += calculateShiftHours(s.startTime, s.endTime, s.breakMinutes);
    totalCost += s.laborCost;
  }

  await db.schedules.updateOne(
    { _id: scheduleId } as any,
    { $set: {
      shifts: updatedShifts,
      totalScheduledHours: totalHours,
      totalLaborCost: totalCost,
    } as any }
  );

  return json({ success: true, totalShifts: updatedShifts.length });
};

/** PUT: Update an existing shift */
export const PUT: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();
  const { scheduleId, shiftId, ...updates } = body;

  if (!scheduleId || !shiftId) {
    return json({ error: 'scheduleId and shiftId required' }, { status: 400 });
  }

  const schedule = await db.schedules.findOne({ _id: scheduleId } as any);
  if (!schedule) {
    return json({ error: 'Schedule not found' }, { status: 404 });
  }

  if (schedule.status === 'published') {
    return json({ error: 'Cannot modify a published schedule' }, { status: 400 });
  }

  const shifts = schedule.shifts || [];
  const shiftIndex = shifts.findIndex((s: any) => s._id === shiftId);
  if (shiftIndex === -1) {
    return json({ error: 'Shift not found' }, { status: 404 });
  }

  // If employee or times changed, recalculate cost
  const existingShift = shifts[shiftIndex];
  const updatedShift = { ...existingShift, ...updates };

  if (updates.startTime || updates.endTime || updates.breakMinutes || updates.employeeId) {
    const empId = updates.employeeId || existingShift.employeeId;
    const employee = await db.employees.findOne({ _id: empId } as any);
    if (employee) {
      updatedShift.laborCost = calculateShiftCost(
        updatedShift.startTime, updatedShift.endTime,
        updatedShift.breakMinutes, employee.hourlyRate, false
      );
    }
  }

  shifts[shiftIndex] = updatedShift;

  let totalHours = 0;
  let totalCost = 0;
  for (const s of shifts) {
    totalHours += calculateShiftHours(s.startTime, s.endTime, s.breakMinutes);
    totalCost += s.laborCost;
  }

  await db.schedules.updateOne(
    { _id: scheduleId } as any,
    { $set: { shifts, totalScheduledHours: totalHours, totalLaborCost: totalCost } as any }
  );

  return json({ shift: updatedShift });
};
