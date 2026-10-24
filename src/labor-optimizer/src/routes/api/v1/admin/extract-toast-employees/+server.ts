/**
 * Extract Toast Employees from Time Entries — All Locations
 *
 * GET /api/v1/admin/extract-toast-employees?days=7
 *
 * For each active location with Toast credentials, fetches time entries
 * over the last N days and extracts unique employees with their jobs,
 * hours, and wage data. Cross-references with the employees table.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { createToastClientFromCredentials } from '$lib/server/integrations/toast/toast-client';

interface ExtractedEmployee {
	employeeGuid: string;
	firstName: string | null;
	lastName: string | null;
	displayName: string;
	jobs: {
		jobGuid: string;
		jobTitle: string;
		totalHours: number;
		avgWage: number;
		entryCount: number;
	}[];
	totalHours: number;
	totalEntries: number;
	daysWorked: number;
}

interface LocationResult {
	locationId: string;
	locationName: string;
	toastGuid: string;
	status: 'success' | 'skipped' | 'error';
	reason?: string;
	datesScanned: string[];
	employeeCount: number;
	employees: ExtractedEmployee[];
}

export const GET: RequestHandler = async ({ url }) => {
	const sb = getSupabaseService();
	const days = Math.min(parseInt(url.searchParams.get('days') || '7', 10), 30);

	// Build date range (last N days)
	const dates: string[] = [];
	const now = new Date();
	for (let i = 1; i <= days; i++) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		dates.push(d.toISOString().split('T')[0]);
	}

	// Fetch all active locations with Toast credentials
	const { data: locations, error: locErr } = await sb
		.from('locations')
		.select('id, name, toast_guid, toast_client_id, toast_client_secret')
		.eq('is_active', true)
		.not('toast_guid', 'is', null);

	if (locErr || !locations) {
		return json({ error: 'Failed to fetch locations', details: locErr?.message }, { status: 500 });
	}

	// Fetch all existing employees for cross-referencing
	const { data: existingEmployees } = await sb
		.from('employees')
		.select('id, first_name, last_name, location_id, toast_guid');

	const existingByToastGuid = new Map<string, { id: string; first_name: string; last_name: string }>();
	const existingByLocationName = new Map<string, { id: string; first_name: string; last_name: string }[]>();
	for (const emp of existingEmployees || []) {
		if (emp.toast_guid) {
			existingByToastGuid.set(emp.toast_guid, emp);
		}
		const key = `${emp.location_id}:${emp.first_name} ${emp.last_name}`.toLowerCase();
		if (!existingByLocationName.has(key)) existingByLocationName.set(key, []);
		existingByLocationName.get(key)!.push(emp);
	}

	// Fetch job titles once per unique Toast GUID (some locations share credentials)
	const jobTitleCache = new Map<string, Map<string, string>>();

	const results: LocationResult[] = [];

	for (const loc of locations) {
		if (!loc.toast_client_id || !loc.toast_client_secret || !loc.toast_guid) {
			results.push({
				locationId: loc.id, locationName: loc.name, toastGuid: loc.toast_guid || '',
				status: 'skipped', reason: 'Missing Toast credentials',
				datesScanned: [], employeeCount: 0, employees: [],
			});
			continue;
		}

		try {
			const toastClient = createToastClientFromCredentials({
				clientId: loc.toast_client_id,
				clientSecret: loc.toast_client_secret,
				restaurantGuid: loc.toast_guid,
			});

			// Fetch job titles (cached per toast_guid to avoid duplicate calls)
			if (!jobTitleCache.has(loc.toast_guid)) {
				try {
					const jobs = await toastClient.getJobs();
					const map = new Map<string, string>();
					for (const j of jobs) map.set(j.guid, j.title);
					jobTitleCache.set(loc.toast_guid, map);
				} catch {
					jobTitleCache.set(loc.toast_guid, new Map());
				}
			}
			const jobMap = jobTitleCache.get(loc.toast_guid)!;

			// Accumulate employee data across all dates
			const empAccum = new Map<string, {
				firstName: string | null;
				lastName: string | null;
				jobs: Map<string, { totalHours: number; totalWage: number; entryCount: number }>;
				daysWorked: Set<string>;
			}>();

			for (const date of dates) {
				try {
					const entries = await toastClient.getTimeEntries(date, date) as any[];
					for (const entry of entries) {
						const empGuid = entry.employeeReference?.guid || entry.employeeGuid || '';
						if (!empGuid) continue;

						if (!empAccum.has(empGuid)) {
							empAccum.set(empGuid, {
								firstName: entry.employeeReference?.firstName || null,
								lastName: entry.employeeReference?.lastName || null,
								jobs: new Map(),
								daysWorked: new Set(),
							});
						}

						const emp = empAccum.get(empGuid)!;
						// Backfill name if we got it on a later entry
						if (!emp.firstName && entry.employeeReference?.firstName) {
							emp.firstName = entry.employeeReference.firstName;
						}
						if (!emp.lastName && entry.employeeReference?.lastName) {
							emp.lastName = entry.employeeReference.lastName;
						}

						emp.daysWorked.add(date);

						const jobGuid = entry.jobReference?.guid || entry.jobGuid || 'unknown';
						if (!emp.jobs.has(jobGuid)) {
							emp.jobs.set(jobGuid, { totalHours: 0, totalWage: 0, entryCount: 0 });
						}
						const jobAccum = emp.jobs.get(jobGuid)!;
						const hours = (entry.regularHours || 0) + (entry.overtimeHours || 0);
						jobAccum.totalHours += hours;
						jobAccum.totalWage += entry.hourlyWage || 0;
						jobAccum.entryCount += 1;
					}
				} catch (dateErr: any) {
					// Skip dates with errors (e.g. no data yet)
					console.warn(`[extract-toast-employees] ${loc.name} ${date}: ${dateErr.message}`);
				}
			}

			// Format results
			const employees: ExtractedEmployee[] = [];
			for (const [empGuid, data] of empAccum) {
				const displayName = [data.firstName, data.lastName].filter(Boolean).join(' ')
					|| `Employee-${empGuid.slice(0, 8)}`;

				const jobs = Array.from(data.jobs.entries()).map(([jobGuid, jd]) => ({
					jobGuid,
					jobTitle: jobMap.get(jobGuid) || 'Unknown',
					totalHours: Math.round(jd.totalHours * 100) / 100,
					avgWage: jd.entryCount > 0 ? Math.round((jd.totalWage / jd.entryCount) * 100) / 100 : 0,
					entryCount: jd.entryCount,
				}));

				const totalHours = jobs.reduce((s, j) => s + j.totalHours, 0);
				const totalEntries = jobs.reduce((s, j) => s + j.entryCount, 0);

				employees.push({
					employeeGuid: empGuid,
					firstName: data.firstName,
					lastName: data.lastName,
					displayName,
					jobs,
					totalHours: Math.round(totalHours * 100) / 100,
					totalEntries,
					daysWorked: data.daysWorked.size,
				});
			}

			// Sort by total hours descending
			employees.sort((a, b) => b.totalHours - a.totalHours);

			results.push({
				locationId: loc.id, locationName: loc.name, toastGuid: loc.toast_guid,
				status: 'success', datesScanned: dates,
				employeeCount: employees.length, employees,
			});
		} catch (err: any) {
			results.push({
				locationId: loc.id, locationName: loc.name, toastGuid: loc.toast_guid,
				status: 'error', reason: err.message,
				datesScanned: dates, employeeCount: 0, employees: [],
			});
		}
	}

	// Cross-reference summary
	const allExtracted = results.flatMap(r => r.employees.map(e => ({
		...e, locationId: r.locationId, locationName: r.locationName,
	})));
	const matchedByGuid = allExtracted.filter(e => existingByToastGuid.has(e.employeeGuid));
	const matchedByName = allExtracted.filter(e => {
		if (existingByToastGuid.has(e.employeeGuid)) return false;
		const key = `${e.locationId}:${e.displayName}`.toLowerCase();
		return existingByLocationName.has(key);
	});

	return json({
		scannedDays: days,
		dateRange: { from: dates[dates.length - 1], to: dates[0] },
		locationCount: locations.length,
		totalEmployeesFound: allExtracted.length,
		crossReference: {
			matchedByToastGuid: matchedByGuid.length,
			matchedByName: matchedByName.length,
			unmatched: allExtracted.length - matchedByGuid.length - matchedByName.length,
		},
		locations: results,
	});
};
