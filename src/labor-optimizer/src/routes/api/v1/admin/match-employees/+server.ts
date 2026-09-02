/**
 * POST /api/v1/admin/match-employees { locationId, dryRun? }
 * Matches Toast employee GUIDs (from time entries) to Dolce-imported
 * employee records by position + wage rate patterns.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';

interface ToastEmployee {
	guid: string;
	positions: Map<string, number>;
	daysWorked: Set<string>;
	totalHours: number;
	dailyHours: Map<string, number>;
}

interface MatchCandidate { toastGuid: string; wage: number; position: string; hours: number; confidence: number }

export const POST: RequestHandler = async ({ request }) => {
	const { locationId, dryRun = false } = await request.json();
	if (!locationId) return json({ error: 'locationId required' }, { status: 400 });

	const sb = getSupabaseService();

	// 1. Fetch location + Toast credentials
	const { data: loc, error: locErr } = await sb
		.from('locations')
		.select('id, name, toast_guid, toast_client_id, toast_client_secret')
		.eq('id', locationId)
		.single();

	if (locErr || !loc) return json({ error: 'Location not found' }, { status: 404 });
	if (!loc.toast_client_id || !loc.toast_client_secret || !loc.toast_guid) {
		return json({ error: 'Missing Toast credentials for this location' }, { status: 400 });
	}

	// 2. Fetch Dolce employees (unmatched: no toast_employee_id)
	const { data: dolceEmployees } = await sb
		.from('employees')
		.select('id, name, position, hourly_rate, is_active')
		.eq('location_id', locationId)
		.eq('is_active', true)
		.is('toast_employee_id', null);

	if (!dolceEmployees || dolceEmployees.length === 0) {
		return json({
			locationId, matched: [], ambiguous: [],
			unmatchedDolce: [], unmatchedToast: [],
			message: 'No unmatched Dolce employees found',
		});
	}

	// 3. Fetch toast_job_mapping for this location
	const { data: mappings } = await sb
		.from('toast_job_mapping')
		.select('toast_job_name, toast_job_guid, dashboard_position')
		.eq('location_id', locationId);

	const jobGuidToPosition = new Map<string, string>();
	for (const m of mappings || []) {
		if (m.toast_job_guid) jobGuidToPosition.set(m.toast_job_guid, m.dashboard_position);
	}

	// 4. Fetch Toast time entries for the last 7 days
	const toastClient = createToastClientFromCredentials({
		clientId: loc.toast_client_id,
		clientSecret: loc.toast_client_secret,
		restaurantGuid: loc.toast_guid,
	});

	const jobs = await toastClient.getJobs();
	const jobGuidToTitle = new Map(jobs.map(j => [j.guid, j.title]));
	// Also map by job title if toast_job_guid isn't set
	const jobTitleToPosition = new Map<string, string>();
	for (const m of mappings || []) {
		jobTitleToPosition.set(m.toast_job_name.toLowerCase(), m.dashboard_position);
	}

	const toastEmps = new Map<string, ToastEmployee>();
	const dates: string[] = [];
	const now = new Date();
	for (let i = 1; i <= 7; i++) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		dates.push(d.toISOString().split('T')[0]);
	}

	for (const date of dates) {
		try {
			const entries = await toastClient.getTimeEntries(date, date) as any[];
			for (const entry of entries) {
				const empGuid = entry.employeeReference?.guid || entry.employeeGuid || '';
				if (!empGuid) continue;

				if (!toastEmps.has(empGuid)) {
					toastEmps.set(empGuid, {
						guid: empGuid,
						positions: new Map(),
						daysWorked: new Set(),
						totalHours: 0,
						dailyHours: new Map(),
					});
				}
				const te = toastEmps.get(empGuid)!;
				te.daysWorked.add(date);

				const hours = (entry.regularHours || 0) + (entry.overtimeHours || 0);
				te.totalHours += hours;
				te.dailyHours.set(date, (te.dailyHours.get(date) || 0) + hours);

				const jobGuid = entry.jobReference?.guid || entry.jobGuid || '';
				const jobTitle = jobGuidToTitle.get(jobGuid) || '';
				const position = jobGuidToPosition.get(jobGuid)
					|| jobTitleToPosition.get(jobTitle.toLowerCase())
					|| jobTitle;

				if (position && position !== 'EXCLUDE') {
					const wage = entry.hourlyWage || 0;
					// Keep highest-frequency position's wage
					if (!te.positions.has(position) || wage > 0) {
						te.positions.set(position, wage);
					}
				}
			}
		} catch {
			// Skip dates with errors
		}
	}

	// Filter out Toast employees already linked to someone
	const { data: alreadyLinked } = await sb
		.from('employees')
		.select('toast_employee_id')
		.eq('location_id', locationId)
		.not('toast_employee_id', 'is', null);

	const linkedGuids = new Set((alreadyLinked || []).map((e: any) => e.toast_employee_id));
	for (const guid of linkedGuids) toastEmps.delete(guid);

	// 5. Build matches
	const matched: { employeeId: string; name: string; toastGuid: string; confidence: number; position: string; wage: number }[] = [];
	const ambiguous: { dolceEmployee: any; candidates: MatchCandidate[] }[] = [];
	const matchedDolceIds = new Set<string>();
	const matchedToastGuids = new Set<string>();

	for (const dolce of dolceEmployees) {
		const candidates: MatchCandidate[] = [];
		const dolcePos = (dolce.position || '').trim();
		const dolceRate = dolce.hourly_rate || 0;

		for (const [guid, te] of toastEmps) {
			if (matchedToastGuids.has(guid)) continue;

			for (const [toastPos, toastWage] of te.positions) {
				const posMatch = dolcePos.toLowerCase() === toastPos.toLowerCase();
				if (!posMatch) continue;

				const rateDiff = Math.abs(dolceRate - toastWage);
				let confidence = 0;

				// Exact rate match
				if (rateDiff < 0.01) {
					confidence = 0.9;
				} else if (rateDiff <= 0.50) {
					confidence = 0.7 - (rateDiff / 0.50) * 0.2;
				} else {
					continue; // Rate too different
				}

				candidates.push({
					toastGuid: guid,
					wage: toastWage,
					position: toastPos,
					hours: Math.round(te.totalHours * 100) / 100,
					confidence: Math.round(confidence * 100) / 100,
				});
			}
		}

		if (candidates.length === 0) continue;

		// Sort by confidence desc
		candidates.sort((a, b) => b.confidence - a.confidence);

		if (candidates.length === 1 || (candidates[0].confidence >= 0.85 && candidates[0].confidence - (candidates[1]?.confidence || 0) >= 0.15)) {
			// Unambiguous match
			const best = candidates[0];
			matched.push({
				employeeId: dolce.id, name: dolce.name,
				toastGuid: best.toastGuid,
				confidence: best.confidence,
				position: best.position, wage: best.wage,
			});
			matchedDolceIds.add(dolce.id);
			matchedToastGuids.add(best.toastGuid);
		} else {
			ambiguous.push({ dolceEmployee: dolce, candidates: candidates.slice(0, 5) });
		}
	}

	// 6. Auto-link unambiguous matches (unless dryRun)
	if (!dryRun) {
		for (const m of matched) {
			await sb.from('employees')
				.update({ toast_employee_id: m.toastGuid })
				.eq('id', m.employeeId);
		}
	}

	// 7. Build unmatched lists
	const unmatchedDolce = dolceEmployees
		.filter(e => !matchedDolceIds.has(e.id) && !ambiguous.some(a => a.dolceEmployee.id === e.id))
		.map(e => ({ id: e.id, name: e.name, position: e.position, hourlyRate: e.hourly_rate }));

	const unmatchedToast = Array.from(toastEmps.entries())
		.filter(([guid]) => !matchedToastGuids.has(guid))
		.map(([guid, te]) => ({
			toastGuid: guid,
			positions: Object.fromEntries(te.positions),
			totalHours: Math.round(te.totalHours * 100) / 100,
			daysWorked: te.daysWorked.size,
		}));

	return json({
		locationId,
		locationName: loc.name,
		dryRun,
		matched,
		ambiguous,
		unmatchedDolce,
		unmatchedToast,
		summary: {
			dolceTotal: dolceEmployees.length,
			toastTotal: toastEmps.size + matchedToastGuids.size,
			autoLinked: matched.length,
			ambiguousCount: ambiguous.length,
			unmatchedDolceCount: unmatchedDolce.length,
			unmatchedToastCount: unmatchedToast.length,
		},
	});
};
