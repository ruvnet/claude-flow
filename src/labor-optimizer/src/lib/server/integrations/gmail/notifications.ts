/**
 * Gmail Notification Service
 *
 * Prepares email content for schedule-related notifications.
 * Actual sending happens via Gmail MCP tool at the agent layer.
 */
import type { Schedule, Shift } from '$lib/types/Schedule';
import type { Employee } from '$lib/types/Employee';
import { formatTime, formatDateShort, getDayName } from '$lib/utils/date';
import { formatCurrency } from '$lib/utils/labor-math';
import { STAFF_ROLE_LABELS } from '$lib/types/Employee';

export interface EmailNotification {
  to: string;
  subject: string;
  body: string;
  type: 'schedule_published' | 'shift_assigned' | 'overtime_alert' | 'budget_alert' | 'compliance_warning';
}

/** Generate schedule publication email for an employee */
export function buildScheduleEmail(
  employee: Employee,
  schedule: Schedule,
  locationName: string,
): EmailNotification {
  const employeeShifts = schedule.shifts.filter(s => s.employeeId === employee._id);

  if (employeeShifts.length === 0) {
    return {
      to: employee.email,
      subject: `Schedule Published: ${locationName} — Week of ${formatDateShort(schedule.weekStartDate)}`,
      body: `Hi ${employee.firstName},\n\nThe schedule for ${locationName} (week of ${formatDateShort(schedule.weekStartDate)}) has been published.\n\nYou are not scheduled for any shifts this week.\n\nIf you have questions, please contact your manager.\n\n— HELIXO`,
      type: 'schedule_published',
    };
  }

  const shiftLines = employeeShifts
    .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    .map(s => {
      const day = getDayName(new Date(s.date + 'T00:00:00').getDay());
      const role = STAFF_ROLE_LABELS[s.role] || s.role;
      return `  ${day}, ${formatDateShort(s.date)}: ${formatTime(s.startTime)} - ${formatTime(s.endTime)} (${role})`;
    })
    .join('\n');

  const totalHours = employeeShifts.reduce((sum, s) => {
    const [sH, sM] = s.startTime.split(':').map(Number);
    const [eH, eM] = s.endTime.split(':').map(Number);
    let mins = (eH * 60 + eM) - (sH * 60 + sM);
    if (mins <= 0) mins += 24 * 60;
    return sum + (mins - (s.breakMinutes || 0)) / 60;
  }, 0);

  return {
    to: employee.email,
    subject: `Your Schedule: ${locationName} — Week of ${formatDateShort(schedule.weekStartDate)}`,
    body: `Hi ${employee.firstName},\n\nYour schedule for ${locationName} has been published.\n\nYour shifts (${employeeShifts.length} shifts, ${totalHours.toFixed(1)} hours):\n\n${shiftLines}\n\nIf you need to request a change, please contact your manager.\n\n— HELIXO`,
    type: 'schedule_published',
  };
}

/** Generate overtime alert email for a manager */
export function buildOvertimeAlertEmail(
  managerEmail: string,
  employee: Employee,
  currentHours: number,
  locationName: string,
): EmailNotification {
  return {
    to: managerEmail,
    subject: `Overtime Alert: ${employee.firstName} ${employee.lastName} at ${locationName}`,
    body: `${employee.firstName} ${employee.lastName} is at ${currentHours.toFixed(1)} hours this week at ${locationName}, exceeding the 40-hour overtime threshold.\n\nReview the schedule to reduce overtime costs.\n\n— HELIXO`,
    type: 'overtime_alert',
  };
}

/** Generate budget alert email */
export function buildBudgetAlertEmail(
  managerEmail: string,
  locationName: string,
  currentPct: number,
  targetPct: number,
): EmailNotification {
  return {
    to: managerEmail,
    subject: `Budget Alert: ${locationName} labor at ${(currentPct * 100).toFixed(1)}%`,
    body: `${locationName} labor cost is currently ${(currentPct * 100).toFixed(1)}%, which is ${((currentPct - targetPct) * 100).toFixed(1)}% above the target of ${(targetPct * 100).toFixed(0)}%.\n\nReview staffing levels to bring costs in line.\n\n— HELIXO`,
    type: 'budget_alert',
  };
}

/** Generate all emails for a schedule publish event */
export function buildPublishNotifications(
  schedule: Schedule,
  employees: Employee[],
  locationName: string,
): EmailNotification[] {
  const notifications: EmailNotification[] = [];

  // Get unique employee IDs from shifts
  const scheduledEmployeeIds = new Set(schedule.shifts.map(s => s.employeeId));

  for (const emp of employees) {
    if (scheduledEmployeeIds.has(emp._id) || emp.primaryLocationId === schedule.locationId) {
      notifications.push(buildScheduleEmail(emp, schedule, locationName));
    }
  }

  return notifications;
}
