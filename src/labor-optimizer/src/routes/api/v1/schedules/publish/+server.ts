import { json, type RequestHandler } from '@sveltejs/kit';
import { getCollections } from '$lib/server/database';
import { checkCompliance, seedComplianceRules } from '$lib/server/domain/compliance/rules-engine';
import { buildPublishNotifications } from '$lib/server/integrations/gmail/notifications';
import { buildCalendarEvents, buildWeekSummaryEvent } from '$lib/server/integrations/gcal/gcal-sync';

export const POST: RequestHandler = async ({ request }) => {
  const db = await getCollections();
  const body = await request.json();
  const { scheduleId, skipComplianceCheck } = body;

  if (!scheduleId) {
    return json({ error: 'scheduleId required' }, { status: 400 });
  }

  const schedule = await db.schedules.findOne({ _id: scheduleId } as any);
  if (!schedule) {
    return json({ error: 'Schedule not found' }, { status: 404 });
  }

  if (schedule.status === 'published') {
    return json({ error: 'Schedule already published' }, { status: 400 });
  }

  // Run compliance check before publishing
  if (!skipComplianceCheck) {
    await seedComplianceRules();
    const employees = await db.employees.find({ isActive: true } as any);
    const rules = await db.complianceRules.find({} as any);
    const compliance = checkCompliance(schedule, schedule.shifts || [], employees, rules);

    if (!compliance.passed) {
      return json({
        error: 'Schedule has compliance violations',
        violations: compliance.violations,
        warnings: compliance.warnings,
        summary: compliance.summary,
        hint: 'Pass skipComplianceCheck: true to publish anyway',
      }, { status: 422 });
    }
  }

  // Publish the schedule
  const now = new Date().toISOString();
  await db.schedules.updateOne(
    { _id: scheduleId } as any,
    { $set: { status: 'published', publishedAt: now } as any }
  );

  // Prepare notifications (actual sending happens via MCP at agent layer)
  const location = await db.locations.findOne({ _id: schedule.locationId } as any);
  const locationName = location?.name || 'Unknown Location';
  const locationTimezone = location?.timezone || 'America/New_York';
  const employees = await db.employees.find({ isActive: true } as any);

  // Build email notifications
  const emailNotifications = buildPublishNotifications(schedule, employees, locationName);

  // Build calendar events
  const calendarEvents = buildCalendarEvents(schedule, employees, locationName, locationTimezone);
  const summaryEvent = buildWeekSummaryEvent(schedule, locationName);

  return json({
    status: 'published',
    publishedAt: now,
    scheduleId,
    notifications: {
      emails: {
        count: emailNotifications.length,
        recipients: emailNotifications.map(n => n.to),
        // The actual emails are sent by the AI agent using Gmail MCP
        // This response provides the data for the agent to act on
        prepared: emailNotifications,
      },
      calendar: {
        eventsCount: calendarEvents.length,
        summaryEvent,
        // The actual events are created by the AI agent using GCal MCP
        prepared: calendarEvents,
      },
    },
    message: `Schedule published. ${emailNotifications.length} email notifications and ${calendarEvents.length} calendar events prepared.`,
  });
};
