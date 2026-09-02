/**
 * Google Calendar Sync Service
 *
 * Prepares calendar event data for syncing published schedules.
 * Events are created via the Google Calendar MCP tool at the agent layer.
 */
import type { Schedule, Shift } from '$lib/types/Schedule';
import type { Employee } from '$lib/types/Employee';
import { STAFF_ROLE_LABELS } from '$lib/types/Employee';
import { formatTime } from '$lib/utils/date';

export interface CalendarEvent {
  summary: string;
  description: string;
  location: string;
  startDateTime: string;  // RFC3339
  endDateTime: string;    // RFC3339
  attendeeEmail?: string;
}

/** Build calendar events from a published schedule */
export function buildCalendarEvents(
  schedule: Schedule,
  employees: Employee[],
  locationName: string,
  locationTimezone: string,
): CalendarEvent[] {
  const empMap = new Map(employees.map(e => [e._id, e]));
  const events: CalendarEvent[] = [];

  for (const shift of schedule.shifts) {
    const emp = empMap.get(shift.employeeId);
    if (!emp) continue;

    const roleName = STAFF_ROLE_LABELS[shift.role] || shift.role;

    // Build RFC3339 timestamps
    const startDateTime = `${shift.date}T${shift.startTime}:00`;
    const endDateTime = shift.endTime < shift.startTime
      ? `${nextDay(shift.date)}T${shift.endTime}:00`  // Overnight shift
      : `${shift.date}T${shift.endTime}:00`;

    events.push({
      summary: `${emp.firstName} ${emp.lastName} — ${roleName}`,
      description: [
        `Role: ${roleName}`,
        `Employee: ${emp.firstName} ${emp.lastName}`,
        `Time: ${formatTime(shift.startTime)} - ${formatTime(shift.endTime)}`,
        shift.breakMinutes > 0 ? `Break: ${shift.breakMinutes} min` : '',
        shift.notes ? `Notes: ${shift.notes}` : '',
        '',
        'Scheduled by HELIXO',
      ].filter(Boolean).join('\n'),
      location: locationName,
      startDateTime,
      endDateTime,
      attendeeEmail: emp.email,
    });
  }

  return events;
}

/** Get the next day's date string */
function nextDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

/** Build a summary event for the full week (for manager's calendar) */
export function buildWeekSummaryEvent(
  schedule: Schedule,
  locationName: string,
): CalendarEvent {
  const shiftCount = schedule.shifts.length;
  const uniqueEmployees = new Set(schedule.shifts.map(s => s.employeeId)).size;

  return {
    summary: `${locationName} — Schedule Published (${shiftCount} shifts)`,
    description: [
      `Week: ${schedule.weekStartDate}`,
      `Total Shifts: ${shiftCount}`,
      `Employees Scheduled: ${uniqueEmployees}`,
      `Total Hours: ${schedule.totalScheduledHours.toFixed(1)}`,
      `Projected Labor Cost: $${schedule.totalLaborCost.toFixed(0)}`,
      schedule.laborCostPct > 0 ? `Labor Cost %: ${(schedule.laborCostPct * 100).toFixed(1)}%` : '',
      '',
      'Published via HELIXO',
    ].filter(Boolean).join('\n'),
    location: locationName,
    startDateTime: `${schedule.weekStartDate}T09:00:00`,
    endDateTime: `${schedule.weekStartDate}T09:30:00`,
  };
}
