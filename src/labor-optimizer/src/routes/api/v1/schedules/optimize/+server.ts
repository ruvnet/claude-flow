import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';
import { optimizeSchedule } from '$lib/server/domain/scheduling/constraint-solver';
import { generateForecast } from '$lib/server/domain/forecasting/forecast.service';
import { getDefaultStaffingConfig } from '$lib/utils/labor-math';
import { getWeekDates } from '$lib/utils/date';

export const POST: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();
  const { scheduleId, locationId, weekStartDate } = body;

  // Resolve location
  const locId = locationId || (scheduleId ? (await db.schedules.findOne({ _id: scheduleId } as any))?.locationId : null);
  if (!locId) {
    return json({ error: 'locationId or scheduleId required' }, { status: 400 });
  }

  const location = await db.locations.findOne({ _id: locId } as any);
  const staffingConfig = location?.staffingConfig || getDefaultStaffingConfig();
  const laborBudgetPct = location?.laborBudgetPct || 0.28;

  // Resolve or create schedule
  let schedule = scheduleId
    ? await db.schedules.findOne({ _id: scheduleId } as any)
    : null;

  const resolvedWeekStart = weekStartDate || schedule?.weekStartDate;
  if (!resolvedWeekStart) {
    return json({ error: 'Could not determine week start date' }, { status: 400 });
  }

  if (!schedule) {
    const now = new Date().toISOString();
    schedule = {
      _id: crypto.randomUUID(),
      locationId: locId,
      weekStartDate: resolvedWeekStart,
      status: 'draft' as const,
      shifts: [],
      totalLaborCost: 0,
      totalScheduledHours: 0,
      projectedRevenue: 0,
      laborCostPct: 0,
      createdAt: now,
      updatedAt: now,
    };
    await db.schedules.insertOne(schedule as any);
  }

  if (schedule.status === 'published') {
    return json({ error: 'Cannot optimize a published schedule' }, { status: 400 });
  }

  // Generate forecasts for each day of the week
  const weekDates = getWeekDates(resolvedWeekStart);
  const forecasts = [];

  for (const date of weekDates) {
    const result = await generateForecast({
      locationId: locId,
      date,
      staffingConfig,
    });
    forecasts.push(result.forecast);
  }

  // Get employees eligible for this location
  const allEmployees = await db.employees.find({ isActive: true } as any);
  const eligibleEmployees = allEmployees.filter(
    (e: any) => e.primaryLocationId === locId || (e.secondaryLocationIds || []).includes(locId),
  );

  // Calculate projected weekly revenue from forecasts
  const projectedRevenue = forecasts.reduce((sum, f) => sum + f.forecastedRevenue, 0);

  // Run the constraint solver
  const result = optimizeSchedule(
    forecasts,
    eligibleEmployees,
    {
      locationId: locId,
      scheduleId: schedule._id,
      weekStartDate: resolvedWeekStart,
      laborBudgetPct,
      projectedWeeklyRevenue: projectedRevenue,
      staffingConfig,
      maxOvertimeHoursPerEmployee: 10,
      fairnessWeight: 0.7,
      costWeight: 0.6,
    },
    schedule.shifts || [],
  );

  // Update schedule with optimized shifts
  const allShifts = [...(schedule.shifts || []), ...result.shifts];
  await db.schedules.updateOne(
    { _id: schedule._id } as any,
    {
      $set: {
        shifts: allShifts,
        totalScheduledHours: result.totalHours,
        totalLaborCost: result.totalCost,
        projectedRevenue,
        laborCostPct: result.laborCostPct,
        optimizationScore: result.score,
        optimizationNotes: result.warnings.map(w => w.message),
      } as any,
    },
  );

  return json({
    status: 'optimization_complete',
    scheduleId: schedule._id,
    score: result.score,
    totalShifts: allShifts.length,
    newShiftsAdded: result.shifts.length,
    totalHours: result.totalHours,
    totalCost: result.totalCost,
    laborCostPct: result.laborCostPct,
    projectedRevenue,
    warnings: result.warnings,
    unfilledSlots: result.unfilledSlots,
    stats: result.stats,
  });
};
