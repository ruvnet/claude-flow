/**
 * Push-to-Dolce API
 *
 * POST /api/v1/schedule-builder/push-to-dolce
 *
 * Exports the AI-generated schedule as a Dolce-compatible CSV that managers
 * can upload to Dolce TeamWork. Uses real employee names from scheduled_shifts
 * and maps dashboard positions back to Dolce role names via dolce_job_mapping.
 *
 * The CSV is a backup/manual import path. The primary path (future) is
 * Playwright automation that pushes shifts directly into Dolce as drafts.
 *
 * Query params:
 *   ?download=true — returns CSV file with Content-Disposition header
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const config = { maxDuration: 30 };

interface ShiftRow {
  employee_name: string;  // "Last, First" format for Dolce
  dolce_role: string;     // Dolce role name (e.g., "Lowland server")
  position: string;       // Dashboard position (e.g., "Server")
  date: string;
  day_name: string;
  start_time: string;
  end_time: string;
  hours: number;
  cost: number;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Convert "First Last" to "Last, First" for Dolce format */
function toDolceName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

function toCsv(rows: ShiftRow[]): string {
  const header = 'Employee Name,Role,Date,Day,Start Time,End Time,Hours,Est. Cost';
  const lines = rows.map(
    (r) => `"${r.employee_name}","${r.dolce_role}","${r.date}","${r.day_name}","${r.start_time}","${r.end_time}",${r.hours.toFixed(1)},${r.cost.toFixed(2)}`,
  );
  return [header, ...lines].join('\n');
}

export const POST: RequestHandler = async ({ request, url }) => {
  try {
    const body = await request.json();
    const { locationId, weekStart } = body as { locationId?: string; weekStart?: string };
    const download = url.searchParams.get('download') === 'true';

    if (!locationId || !weekStart) {
      return json({ error: 'locationId and weekStart are required' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      return json({ error: 'weekStart must be YYYY-MM-DD format' }, { status: 400 });
    }

    const sb = getSupabaseService();

    // Fetch location
    const { data: loc } = await sb.from('locations').select('id, name').eq('id', locationId).maybeSingle();
    if (!loc) return json({ error: 'Location not found' }, { status: 404 });

    const dates = weekDates(weekStart);

    // Fetch AI-generated shift assignments (from scheduled_shifts table)
    const { data: shifts, error: shiftErr } = await sb
      .from('scheduled_shifts')
      .select('business_date, position, employee_id, shift_type, start_time, end_time, hours, cost')
      .eq('location_id', locationId)
      .in('business_date', dates)
      .order('business_date')
      .order('position')
      .order('start_time');

    if (shiftErr || !shifts || shifts.length === 0) {
      // Fallback: try scheduled_labor (aggregate level, no employee names)
      const { data: scheduled } = await sb
        .from('scheduled_labor')
        .select('position, business_date, scheduled_hours, scheduled_cost')
        .eq('location_id', locationId)
        .in('business_date', dates)
        .order('business_date');

      if (!scheduled || scheduled.length === 0) {
        return json({
          success: false,
          message: 'No schedule found for this week. Generate a schedule in the Schedule Builder first.',
          location: loc.name,
          weekStart,
          shifts: [],
          csvData: '',
        });
      }

      // Build aggregate-level CSV (position placeholders)
      const fallbackRows: ShiftRow[] = scheduled.map((row) => {
        const d = new Date(row.business_date + 'T12:00:00');
        return {
          employee_name: `[${row.position}]`,
          dolce_role: row.position,
          position: row.position,
          date: row.business_date,
          day_name: DAY_NAMES[d.getDay()],
          start_time: '10:00',
          end_time: '18:00',
          hours: row.scheduled_hours ?? 8,
          cost: row.scheduled_cost ?? 0,
        };
      });

      const csvData = toCsv(fallbackRows);
      return json({
        success: true,
        mode: 'aggregate_csv',
        message: 'Schedule exported at position level (no individual employee assignments). Generate a full schedule in the Schedule Builder for employee-level detail.',
        location: loc.name,
        weekStart,
        weekEnd: addDays(weekStart, 6),
        totalShifts: fallbackRows.length,
        totalHours: fallbackRows.reduce((s, r) => s + r.hours, 0),
        totalCost: fallbackRows.reduce((s, r) => s + r.cost, 0),
        shifts: fallbackRows,
        csvData,
      });
    }

    // Load employee names for the shift employee_ids
    const empIds = [...new Set(shifts.filter(s => s.employee_id).map(s => s.employee_id))];
    const empNameMap = new Map<string, string>();

    if (empIds.length > 0) {
      const { data: employees } = await sb
        .from('employees')
        .select('id, name')
        .in('id', empIds);
      for (const emp of employees || []) {
        empNameMap.set(emp.id, emp.name);
      }
    }

    // Load reverse Dolce job mapping: dashboard_position -> dolce_role_name
    const { data: mappings } = await sb
      .from('dolce_job_mapping')
      .select('dolce_role_name, dashboard_position')
      .eq('location_id', locationId);

    const positionToDolceRole = new Map<string, string>();
    for (const m of mappings || []) {
      // Use the first mapping for each dashboard position
      if (!positionToDolceRole.has(m.dashboard_position)) {
        positionToDolceRole.set(m.dashboard_position, m.dolce_role_name);
      }
    }

    // Build shift rows with real employee names
    const shiftRows: ShiftRow[] = shifts.map((s) => {
      const empName = s.employee_id ? empNameMap.get(s.employee_id) : null;
      const dolceName = empName ? toDolceName(empName) : `[${s.position}]`;
      const dolceRole = positionToDolceRole.get(s.position) || s.position;
      const d = new Date(s.business_date + 'T12:00:00');

      return {
        employee_name: dolceName,
        dolce_role: dolceRole,
        position: s.position,
        date: s.business_date,
        day_name: DAY_NAMES[d.getDay()],
        start_time: s.start_time || '10:00',
        end_time: s.end_time || '18:00',
        hours: s.hours || 0,
        cost: s.cost || 0,
      };
    });

    const csvData = toCsv(shiftRows);

    // If download=true, return as downloadable CSV file
    if (download) {
      const filename = `${loc.name.replace(/[^a-zA-Z0-9]/g, '_')}_Schedule_${weekStart}.csv`;
      return new Response(csvData, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return json({
      success: true,
      mode: 'employee_csv',
      message: `Schedule exported for ${loc.name} (${weekStart} to ${addDays(weekStart, 6)}). Upload this CSV to Dolce TeamWork to import as draft.`,
      location: loc.name,
      weekStart,
      weekEnd: addDays(weekStart, 6),
      totalShifts: shiftRows.length,
      totalHours: shiftRows.reduce((s, r) => s + r.hours, 0),
      totalCost: shiftRows.reduce((s, r) => s + r.cost, 0),
      employeesAssigned: empNameMap.size,
      shifts: shiftRows,
      csvData,
    });
  } catch (err: any) {
    console.error('[push-to-dolce] Error:', err.message);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
};
