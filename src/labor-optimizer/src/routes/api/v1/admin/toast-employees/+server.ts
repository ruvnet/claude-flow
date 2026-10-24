/**
 * TEMPORARY: Toast Employee Discovery Endpoint
 * Tries every possible API path to find employee data for Lowland.
 * GET /api/v1/admin/toast-employees
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const LOWLAND_GUID = 'ee3587d9-e1f0-47b7-94fc-2e523e93c338';
const BASE = 'https://ws-api.toasttab.com';

const CREDS = [
	{ label: 'Standard', clientId: 'QUZI047f57MO5LFtIXnMjtJ3X6kz2lOD', clientSecret: 'U8Cyidf2o5ApDzmbEL19p_O6sp0yVHmTjBse8kl7kJgUCzKE7Zl9Jjb5AY67IB2x' },
	{ label: 'Analytics', clientId: 'XG2kiczIGH387bnJ6HA5OQufGyzX9Gjk', clientSecret: 'mXqH01zBJ4cTIgyJpzdKXWc47NX09gApZKdEH_id9LI4zW-1hqapoUZTOqee91AW' },
];

const ENDPOINTS = [
	'/labor/v1/employees',
	'/labor/v1/employees?pageSize=100',
	'/labor/v2/employees',
	'/config/v2/employees',
	'/employees/v1/employees',
	'/human-resources/v1/employees',
	'/labor/v1/timeEntries?businessDate=20260326',
	'/labor/v1/jobs',
];

async function getToken(cred: typeof CREDS[0]): Promise<{ token: string | null; error?: string }> {
	try {
		const res = await fetch(`${BASE}/authentication/v1/authentication/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ clientId: cred.clientId, clientSecret: cred.clientSecret, userAccessType: 'TOAST_MACHINE_CLIENT' }),
		});
		if (!res.ok) return { token: null, error: `Auth ${res.status} ${res.statusText}` };
		const data = await res.json();
		return { token: data.token?.accessToken || data.accessToken || null };
	} catch (e: any) {
		return { token: null, error: e.message };
	}
}

async function tryEndpoint(token: string, path: string): Promise<{ endpoint: string; status: number; length: number; preview: string; data?: any }> {
	try {
		const res = await fetch(`${BASE}${path}`, {
			headers: {
				'Authorization': `Bearer ${token}`,
				'Toast-Restaurant-External-ID': LOWLAND_GUID,
				'Content-Type': 'application/json',
			},
		});
		const text = await res.text();
		let data: any = undefined;
		try { data = JSON.parse(text); } catch { /* not json */ }
		return { endpoint: path, status: res.status, length: text.length, preview: text.slice(0, 500), data };
	} catch (e: any) {
		return { endpoint: path, status: 0, length: 0, preview: `Error: ${e.message}` };
	}
}

export const GET: RequestHandler = async () => {
	const results: any[] = [];
	const employeesFromTimeEntries: Map<string, { guid: string; firstName?: string; lastName?: string; jobs: Set<string> }> = new Map();

	for (const cred of CREDS) {
		const auth = await getToken(cred);
		if (!auth.token) {
			results.push({ credentialSet: cred.label, authError: auth.error, endpoints: [] });
			continue;
		}

		const endpointResults: any[] = [];
		for (const ep of ENDPOINTS) {
			const r = await tryEndpoint(auth.token, ep);

			// Extract employees from time entries
			if (ep.includes('timeEntries') && r.status === 200 && Array.isArray(r.data)) {
				for (const entry of r.data) {
					const empRef = entry.employeeReference || {};
					const guid = empRef.guid || entry.employeeGuid || '';
					if (!guid) continue;
					if (!employeesFromTimeEntries.has(guid)) {
						employeesFromTimeEntries.set(guid, {
							guid,
							firstName: empRef.firstName,
							lastName: empRef.lastName,
							jobs: new Set(),
						});
					}
					const emp = employeesFromTimeEntries.get(guid)!;
					if (empRef.firstName && !emp.firstName) emp.firstName = empRef.firstName;
					if (empRef.lastName && !emp.lastName) emp.lastName = empRef.lastName;
					const jobGuid = entry.jobReference?.guid || entry.jobGuid || '';
					if (jobGuid) emp.jobs.add(jobGuid);
				}
			}

			// Strip data from logged results to keep response manageable
			endpointResults.push({ endpoint: r.endpoint, status: r.status, length: r.length, preview: r.preview });
		}

		results.push({ credentialSet: cred.label, authSuccess: true, endpoints: endpointResults });
	}

	// Format extracted employees
	const extractedEmployees = Array.from(employeesFromTimeEntries.values()).map(e => ({
		guid: e.guid,
		firstName: e.firstName || null,
		lastName: e.lastName || null,
		name: [e.firstName, e.lastName].filter(Boolean).join(' ') || '(unknown)',
		jobGuids: Array.from(e.jobs),
	}));

	return json({
		location: 'Lowland',
		locationGuid: LOWLAND_GUID,
		credentialResults: results,
		extractedEmployeesFromTimeEntries: {
			count: extractedEmployees.length,
			employees: extractedEmployees,
		},
	});
};
