/**
 * Forecast Acceptance + Labor Threshold Cascade
 *
 * When a manager accepts a forecast:
 * 1. Save accepted revenue/covers
 * 2. Trigger weekly labor target recalculation via labor-projection engine
 *
 * The labor-projection engine handles:
 * - Summing the week's accepted forecasts
 * - Threshold bracket lookup
 * - DOW weight distribution
 * - Daily target upserts with reconciliation
 */

import { getSupabaseService } from '$lib/server/supabase';
import { getTrailing2WeekAvgCheck } from './ai-forecast';
import { calculateWeeklyLaborTargets } from './labor-projection';

export async function acceptForecast(
	locationId: string,
	date: string,
	revenue: number,
	isOverride: boolean,
	overrideExplanation: string | null,
	acceptedBy: string,
): Promise<{
	targetsGenerated: number;
	covers: number;
	avgCheck: number;
	isWeekComplete: boolean;
	weekForecastTotal: number;
	weekLocked: boolean;
}> {
	const sb = getSupabaseService();

	// Auto-calculate covers from trailing 2-week avg check
	const avgCheck = await getTrailing2WeekAvgCheck(locationId, date);
	const covers = avgCheck > 0 ? Math.round(revenue / avgCheck) : 0;

	console.log(`[forecast-accept] Accepting forecast: location=${locationId}, date=${date}, revenue=${revenue}, isOverride=${isOverride}, acceptedBy=${acceptedBy}`);

	// 1. Upsert the accepted forecast (NOT locked -- locking is done via explicit "Submit Week")
	const { error: upsertError } = await sb.from('daily_forecasts').upsert(
		{
			location_id: locationId,
			business_date: date,
			manager_revenue: revenue,
			manager_covers: covers,
			is_override: isOverride,
			override_explanation: overrideExplanation,
			accepted_at: new Date().toISOString(),
			accepted_by: acceptedBy,
		},
		{ onConflict: 'location_id,business_date' },
	);

	if (upsertError) {
		console.error(`[forecast-accept] Upsert error for ${date}:`, upsertError.message);
	} else {
		console.log(`[forecast-accept] Upserted daily_forecasts row: date=${date}, manager_revenue=${revenue}, covers=${covers}`);
	}

	// 2. Recalculate weekly labor targets using the projection engine.
	//    This runs on every accept so partial-week projections stay current.
	const result = await calculateWeeklyLaborTargets(locationId, date);
	console.log(`[forecast-accept] Labor targets recalculated: targetsGenerated=${result.targetsGenerated}, weekComplete=${result.isWeekComplete}, weekTotal=${result.weekForecastTotal}`);

	// 3. Check if all 7 days are accepted (for UI to know when to show Submit button).
	//    We no longer auto-lock here -- the manager must explicitly submit the week.
	const { weekStart, weekEnd } = getWeekRange(date);
	const { data: weekRows } = await sb
		.from('daily_forecasts')
		.select('business_date, manager_revenue')
		.eq('location_id', locationId)
		.gte('business_date', weekStart)
		.lte('business_date', weekEnd);

	const acceptedCount = (weekRows || []).filter(r => r.manager_revenue != null).length;
	const isWeekComplete = acceptedCount === 7;

	return {
		targetsGenerated: result.targetsGenerated,
		covers,
		avgCheck,
		isWeekComplete,
		weekForecastTotal: result.weekForecastTotal,
		weekLocked: false, // Never auto-lock; requires explicit submit
	};
}

/**
 * Submit (lock) an entire week's forecast.
 *
 * Called by the "Submit Weekly Forecast" button after all 7 days are accepted.
 * 1. Verifies all 7 days have manager_revenue set
 * 2. Locks all 7 days
 * 3. Runs final calculateWeeklyLaborTargets to ensure targets are up to date
 * 4. Returns the labor projection result
 */
export async function submitWeekForecast(
	locationId: string,
	weekStartDate: string,
	submittedBy: string,
): Promise<{
	locked: boolean;
	acceptedDays: number;
	weekForecastTotal: number;
	targetsGenerated: number;
	bracketUsed: string | null;
	error?: string;
}> {
	const sb = getSupabaseService();
	const { weekStart, weekEnd } = getWeekRange(weekStartDate);

	console.log(`[forecast-accept] submitWeekForecast: location=${locationId}, weekStart=${weekStart}, weekEnd=${weekEnd}, by=${submittedBy}`);

	// 1. Verify all 7 days have manager_revenue
	const { data: weekRows } = await sb
		.from('daily_forecasts')
		.select('business_date, manager_revenue, locked')
		.eq('location_id', locationId)
		.gte('business_date', weekStart)
		.lte('business_date', weekEnd);

	const accepted = (weekRows || []).filter(r => r.manager_revenue != null);
	console.log(`[forecast-accept] Week has ${accepted.length}/7 accepted days`);

	if (accepted.length < 7) {
		return {
			locked: false,
			acceptedDays: accepted.length,
			weekForecastTotal: 0,
			targetsGenerated: 0,
			bracketUsed: null,
			error: `Only ${accepted.length} of 7 days have been accepted. Please accept all days before submitting.`,
		};
	}

	// 2. Lock all 7 days
	const now = new Date().toISOString();
	const { error: lockError } = await sb
		.from('daily_forecasts')
		.update({ locked: true, locked_at: now, locked_by: submittedBy })
		.eq('location_id', locationId)
		.gte('business_date', weekStart)
		.lte('business_date', weekEnd)
		.not('manager_revenue', 'is', null);

	if (lockError) {
		console.error(`[forecast-accept] Lock error:`, lockError.message);
		return {
			locked: false,
			acceptedDays: accepted.length,
			weekForecastTotal: 0,
			targetsGenerated: 0,
			bracketUsed: null,
			error: `Failed to lock week: ${lockError.message}`,
		};
	}

	console.log(`[forecast-accept] All 7 days locked for week ${weekStart}`);

	// 3. Run final labor target calculation with the complete week
	const result = await calculateWeeklyLaborTargets(locationId, weekStart);
	console.log(`[forecast-accept] Final labor targets: bracket=${result.bracketUsed}, targets=${result.targetsGenerated}, weekTotal=${result.weekForecastTotal}`);

	return {
		locked: true,
		acceptedDays: 7,
		weekForecastTotal: result.weekForecastTotal,
		targetsGenerated: result.targetsGenerated,
		bracketUsed: result.bracketUsed,
	};
}

/** Return ISO date strings for Monday and Sunday of the week containing `date`. */
function getWeekRange(date: string): { weekStart: string; weekEnd: string } {
	const d = new Date(date + 'T12:00:00');
	const dow = d.getDay(); // 0=Sun .. 6=Sat
	const diffToMon = dow === 0 ? -6 : 1 - dow;
	const monday = new Date(d);
	monday.setDate(d.getDate() + diffToMon);
	const sunday = new Date(monday);
	sunday.setDate(monday.getDate() + 6);
	return {
		weekStart: monday.toISOString().split('T')[0],
		weekEnd: sunday.toISOString().split('T')[0],
	};
}
