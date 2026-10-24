/**
 * Admin Wages Import Endpoint
 *
 * Accepts a Dolce wages report (text/CSV) via POST and imports employee data
 * into the employees table. Parses names, ADP IDs, hire dates, employment
 * types, roles with hourly rates, and maps roles to dashboard positions
 * via dolce_job_mapping.
 *
 * POST /api/v1/admin/import-wages
 * Body: { text: string, dryRun?: boolean, adminKey: string }
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const config = { maxDuration: 120 };

const LOCATION_MAP: Record<string, string> = {
  'lowland': 'f36fdb18-a97b-48af-8456-7374dea4b0f9',
  'le supreme': 'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce',
  'hiroki-san': 'b4035001-0928-4ada-a0f0-f2a272393147',
  'kampers': 'b7d3e1a4-5f2c-4a8b-9e6d-1c3f5a7b9d2e',
  'anthology': '84f4ea7f-722d-4296-894b-6ecfe389b2d5',
  'hiroki': 'c21aa6c1-411e-4ed1-9b84-e9d9d143abf9',
  'little wing': '574118d5-8511-41ce-8ae8-14f921fb021a',
  'vessel': 'd201e1aa-a2a7-420d-8112-91160d0bc1bc',
  'rosemary rose': '580ae0a6-34b8-402e-a8a6-2e55310207e4',
  'nickel restaurant': '580ae0a6-34b8-402e-a8a6-2e55310207e4',
  'the quoin': '0eefcab2-d68d-4a2f-ae30-009b999258c7',
  'quoin': '0eefcab2-d68d-4a2f-ae30-009b999258c7',
  'wm. mulherin': '23c02a8e-1425-441e-9650-73ae93fa68cc',
  'mulherin': '23c02a8e-1425-441e-9650-73ae93fa68cc',
};

interface ParsedEmployee {
  name: string;
  adpId: string | null;
  empType: 'full_time' | 'part_time';
  hireDate: string | null;
  roles: { location: string; role: string; rate: number; isSalaried?: boolean }[];
}

interface EmployeeRecord {
  location_id: string;
  name: string;
  position: string;
  secondary_positions: string[];
  hourly_rate: number | null;
  employment_type: string;
  hire_date: string | null;
  is_active: boolean;
  max_hours_per_week: number;
  overtime_threshold: number;
  toast_employee_id: string | null;
  dolce_employee_id: string | null;
}

function parseHireDate(line: string): string | null {
  const m = line.match(/Since\s+(\w+\s+\d{1,2},?\s+\d{4})/i);
  if (!m) return null;
  const d = new Date(m[1]);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

function parseRate(text: string): number {
  const m = text.match(/\$([0-9,]+(?:\.\d+)?)/);
  if (!m) return 0;
  return parseFloat(m[1].replace(/,/g, ''));
}

function resolveLocationId(locName: string): string | null {
  const key = locName.trim().toLowerCase();
  return LOCATION_MAP[key] || null;
}

function parseWagesReport(text: string): ParsedEmployee[] {
  const lines = text.split('\n');
  const employees: ParsedEmployee[] = [];
  const nameRe = /^([A-Za-z'\u00C0-\u024F-]+(?:\s[A-Za-z'\u00C0-\u024F-]+)*),\s*(.+)$/;
  const adpRe = /^\(([^)]+)\)/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const nameMatch = line.match(nameRe);
    if (!nameMatch) { i++; continue; }

    const lastName = nameMatch[1].trim();
    const firstName = nameMatch[2].trim();
    if (lastName.startsWith('----')) { i++; continue; }

    let adpId: string | null = null;
    let peekIdx = i + 1;
    while (peekIdx < Math.min(i + 3, lines.length)) {
      const peekLine = lines[peekIdx].trim();
      const adpMatch = peekLine.match(adpRe);
      if (adpMatch) { adpId = adpMatch[1]; break; }
      if (peekLine && !/^\s*$/.test(peekLine)) break;
      peekIdx++;
    }

    if (!adpId) {
      let hasWages = false;
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        if (/^\t?Hourly|Salaried/i.test(lines[j].trim())) { hasWages = true; break; }
        if (lines[j].trim().match(nameRe) && !lines[j].trim().startsWith('----')) break;
      }
      if (!hasWages) { i++; continue; }
    }

    if (adpId) peekIdx++;
    let cursor = adpId ? peekIdx : i + 1;

    let empType: 'full_time' | 'part_time' = 'full_time';
    let hireDate: string | null = null;
    const roles: ParsedEmployee['roles'] = [];

    while (cursor < lines.length) {
      const cl = lines[cursor].trim();
      if (cl === 'Full Time') { cursor++; continue; }
      if (cl === 'Part Time') { empType = 'part_time'; cursor++; continue; }
      if (cl.startsWith('Since ')) { hireDate = parseHireDate(cl); cursor++; continue; }

      if (/^Hourly$/i.test(cl) || /^\t?Hourly\s*$/i.test(cl)) {
        cursor++;
        if (cursor >= lines.length) break;
        const locLine = lines[cursor].trim();
        cursor++;
        if (cursor >= lines.length) break;
        const roleLine = lines[cursor];
        const roleParts = roleLine.split('\t').map((s: string) => s.trim()).filter(Boolean);
        const roleName = roleParts[0] || '';
        const rate = parseRate(roleLine);
        if (roleName && roleName !== 'Edit Make Default' && roleName !== 'Edit') {
          roles.push({ location: locLine, role: roleName, rate });
        }
        cursor++;
        continue;
      }

      if (/^Salaried\s*@/i.test(cl)) {
        const salaryRate = parseRate(cl);
        const locMatch = cl.match(/@\s*(.+?)(?:\t|$)/);
        const schedGroup = locMatch ? locMatch[1].trim() : '';
        roles.push({ location: 'Lowland', role: schedGroup || 'Manager', rate: salaryRate, isSalaried: true });
        cursor++;
        continue;
      }

      if (cl.startsWith('No Wages for')) { cursor++; continue; }
      if (cl.startsWith('ADP Roles')) { cursor++; continue; }

      if (/^[A-Za-z].*-\s+(Lowland|Le Supreme|Hiroki|Kampers|Little Wing|Vessel|Anthology|Quoin|Mulherin|Rosemary|Nickel)/.test(cl)) break;
      if (cl.match(nameRe) && !cl.startsWith('----')) break;
      if (cl.startsWith('Employee Name')) break;

      cursor++;
    }

    if (roles.length > 0) {
      employees.push({ name: `${firstName} ${lastName}`, adpId, empType, hireDate, roles });
    }
    i = cursor;
  }
  return employees;
}

function expandToRecords(
  employees: ParsedEmployee[],
  jobMappings: Map<string, string>,
): EmployeeRecord[] {
  const records: EmployeeRecord[] = [];

  for (const emp of employees) {
    const byLoc: Record<string, { locName: string; roles: typeof emp.roles }> = {};
    for (const r of emp.roles) {
      const locId = resolveLocationId(r.location);
      if (!locId) continue;
      if (!byLoc[locId]) byLoc[locId] = { locName: r.location, roles: [] };
      byLoc[locId].roles.push(r);
    }

    for (const [locId, data] of Object.entries(byLoc)) {
      const mapped = data.roles.map((r) => {
        const key = `${locId}:${r.role.toLowerCase()}`;
        return { ...r, dashPos: jobMappings.get(key) || null };
      });

      const meaningful = mapped.filter(
        (r) => r.dashPos && r.dashPos !== 'EXCLUDE' && r.dashPos !== 'Training',
      );

      const primary = meaningful.length > 0
        ? meaningful[0]
        : mapped.filter((r) => r.dashPos && r.dashPos !== 'EXCLUDE')[0] || mapped[0];

      const position = primary?.dashPos && primary.dashPos !== 'EXCLUDE'
        ? primary.dashPos
        : (meaningful[0]?.dashPos || 'Other');

      const secondarySet = new Set<string>();
      for (const r of meaningful) {
        if (r.dashPos && r.dashPos !== position && r.dashPos !== 'EXCLUDE') {
          secondarySet.add(r.dashPos);
        }
      }

      let hourlyRate = 0;
      for (const r of data.roles) {
        if (r.isSalaried) {
          hourlyRate = Math.max(hourlyRate, Math.round((r.rate / 2080) * 100) / 100);
        } else {
          hourlyRate = Math.max(hourlyRate, r.rate);
        }
      }

      records.push({
        location_id: locId,
        name: emp.name,
        position,
        secondary_positions: [...secondarySet],
        hourly_rate: hourlyRate > 0 ? hourlyRate : null,
        employment_type: emp.empType,
        hire_date: emp.hireDate,
        is_active: true,
        max_hours_per_week: 40,
        overtime_threshold: 40,
        toast_employee_id: emp.adpId || null,
        dolce_employee_id: emp.adpId || null,
      });
    }
  }
  return records;
}

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { text, dryRun = false, adminKey } = body;

  // Auth
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  const isAuthed = adminKey === 'helixo-admin-2026'
    || (cronSecret && authHeader === `Bearer ${cronSecret}`);
  if (!isAuthed) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!text || typeof text !== 'string') {
    return json({ error: 'Missing "text" field with wages report content' }, { status: 400 });
  }

  const sb = getSupabaseService();

  // 1. Parse wages report
  const employees = parseWagesReport(text);
  if (employees.length === 0) {
    return json({ error: 'No employees found in wages report text', parsed: 0 }, { status: 422 });
  }

  // 2. Load dolce_job_mapping
  const { data: mappingData } = await sb
    .from('dolce_job_mapping')
    .select('location_id, dolce_role_name, dashboard_position');

  const jobMappings = new Map<string, string>();
  for (const m of mappingData || []) {
    jobMappings.set(`${m.location_id}:${m.dolce_role_name.toLowerCase()}`, m.dashboard_position);
  }

  // 3. Expand to per-location records
  const records = expandToRecords(employees, jobMappings);

  if (dryRun) {
    // Group by location for summary
    const byLocation: Record<string, { count: number; positions: Record<string, number> }> = {};
    for (const r of records) {
      if (!byLocation[r.location_id]) byLocation[r.location_id] = { count: 0, positions: {} };
      byLocation[r.location_id].count++;
      byLocation[r.location_id].positions[r.position] = (byLocation[r.location_id].positions[r.position] || 0) + 1;
    }

    return json({
      dryRun: true,
      parsedEmployees: employees.length,
      expandedRecords: records.length,
      jobMappingsLoaded: jobMappings.size,
      byLocation,
      sampleRecords: records.slice(0, 10).map((r) => ({
        name: r.name,
        position: r.position,
        hourlyRate: r.hourly_rate,
        employmentType: r.employment_type,
        hireDate: r.hire_date,
        secondaryPositions: r.secondary_positions,
      })),
    });
  }

  // 4. Deactivate existing employees for affected locations
  const locationIds = [...new Set(records.map((r) => r.location_id))];
  for (const locId of locationIds) {
    await sb.from('employees').update({ is_active: false }).eq('location_id', locId).eq('is_active', true);
  }

  // 5. Upsert records in batches of 50
  let inserted = 0;
  let errors = 0;
  const BATCH = 50;

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH);
    const { error } = await sb.from('employees').upsert(batch, { onConflict: 'location_id,name' });
    if (error) {
      // Try one-by-one
      for (const rec of batch) {
        const { error: e2 } = await sb.from('employees').upsert(rec, { onConflict: 'location_id,name' });
        if (e2) errors++;
        else inserted++;
      }
    } else {
      inserted += batch.length;
    }
  }

  // 6. Summary
  const byLocation: Record<string, number> = {};
  for (const r of records) {
    byLocation[r.location_id] = (byLocation[r.location_id] || 0) + 1;
  }

  return json({
    success: true,
    parsedEmployees: employees.length,
    expandedRecords: records.length,
    inserted,
    errors,
    locationsAffected: locationIds.length,
    byLocation,
  });
};
