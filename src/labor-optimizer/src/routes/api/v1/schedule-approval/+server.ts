/**
 * Schedule Approval API
 *
 * GET:   Fetch weekly schedule status with projected vs scheduled comparison
 * POST:  Submit schedule for approval (+ email admins)
 * PUT:   Approve / deny / request revision (admin only) (+ email submitter)
 * PATCH: Upsert scheduled labor for a position + day (manual entry)
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseService, FOH_POSITIONS, BOH_POSITIONS } from '$lib/server/supabase';
import { canApproveSchedule, isValidRole, getHighestRole, type UserRole } from '$lib/roles';
import { createNotification } from '$lib/server/notifications';

/** Resolve user's highest role from DB. */
async function resolveUserRole(email: string): Promise<UserRole> {
  const sb = getSupabaseService();
  const roles: UserRole[] = [];

  const { data: gm } = await sb
    .from('user_group_members')
    .select('role')
    .eq('user_email', email);
  for (const r of gm || []) {
    if (r.role && isValidRole(r.role)) roles.push(r.role as UserRole);
  }

  const { data: lu } = await sb
    .from('location_users')
    .select('role')
    .eq('user_email', email);
  for (const r of lu || []) {
    if (r.role && isValidRole(r.role)) roles.push(r.role as UserRole);
  }

  return getHighestRole(roles);
}
const RESEND_API_URL = 'https://api.resend.com/emails';
const HELIXO_FROM = process.env.RESEND_FROM_EMAIL || 'HELIXO <notifications@helixokpi.com>';

/* ------------------------------------------------------------------ */
/*  Email helpers                                                      */
/* ------------------------------------------------------------------ */

function fmt$(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function formatWeekDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function helixoEmailWrapper(innerHtml: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;background:white;">
    <div style="background:#1e3a5f;padding:24px 32px;">
      <h1 style="color:white;margin:0;font-size:22px;font-weight:700;letter-spacing:0.5px;">HELIXO</h1>
    </div>
    <div style="padding:32px;">
      ${innerHtml}
    </div>
    <div style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">HELIXO &mdash; Performance Dashboard</p>
    </div>
  </div>
</body>
</html>`;
}

function buildSubmittedEmailHtml(
  locationName: string,
  weekLabel: string,
  fohProjected: number,
  fohScheduled: number,
  bohProjected: number,
  bohScheduled: number,
  totalProjected: number,
  totalScheduled: number,
): string {
  const row = (label: string, proj: number, sched: number) => {
    const variance = sched - proj;
    const pct = proj > 0 ? ((variance / proj) * 100).toFixed(1) : '0.0';
    const color = variance > 0 ? '#dc2626' : variance < 0 ? '#16a34a' : '#374151';
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:14px;">${label}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:14px;text-align:right;">${fmt$(proj)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:14px;text-align:right;">${fmt$(sched)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #f3f4f6;font-size:14px;text-align:right;color:${color};font-weight:600;">${variance >= 0 ? '+' : ''}${fmt$(variance)} (${pct}%)</td>
    </tr>`;
  };

  return helixoEmailWrapper(`
    <h2 style="color:#1e3a5f;margin:0 0 4px;font-size:18px;">Schedule Submitted for Review</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">${locationName} &mdash; Week of ${weekLabel}</p>

    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <thead>
        <tr style="background:#f8f9fa;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Category</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Projected</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Scheduled</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Variance</th>
        </tr>
      </thead>
      <tbody>
        ${row('FOH', fohProjected, fohScheduled)}
        ${row('BOH', bohProjected, bohScheduled)}
        ${row('Total', totalProjected, totalScheduled)}
      </tbody>
    </table>

    <div style="text-align:center;margin-bottom:16px;">
      <a href="https://helixoapp.com/dashboard/schedule-approval" style="display:inline-block;background:#1e3a5f;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Review Now</a>
    </div>
    <p style="color:#9ca3af;font-size:12px;text-align:center;margin:0;">Click the button above to review and approve or deny this schedule.</p>
  `);
}

function buildDecisionEmailHtml(
  locationName: string,
  weekLabel: string,
  status: string,
  reviewNotes: string | null,
): string {
  const isApproved = status === 'approved';
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);
  const statusColor = isApproved ? '#16a34a' : '#dc2626';
  const statusBg = isApproved ? '#f0fdf4' : '#fef2f2';

  return helixoEmailWrapper(`
    <h2 style="color:#1e3a5f;margin:0 0 4px;font-size:18px;">Schedule ${statusLabel}</h2>
    <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">${locationName} &mdash; Week of ${weekLabel}</p>

    <div style="background:${statusBg};border-left:4px solid ${statusColor};padding:16px 20px;border-radius:0 6px 6px 0;margin-bottom:24px;">
      <p style="color:${statusColor};font-size:16px;font-weight:700;margin:0 0 4px;">${statusLabel}</p>
      ${reviewNotes ? `<p style="color:#374151;font-size:14px;margin:0;">${reviewNotes}</p>` : '<p style="color:#6b7280;font-size:13px;margin:0;">No additional notes.</p>'}
    </div>

    <div style="text-align:center;margin-bottom:16px;">
      <a href="https://helixoapp.com/schedule" style="display:inline-block;background:#1e3a5f;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">View Schedule</a>
    </div>
  `);
}

async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('RESEND_API_KEY not set — skipping email notification');
    return;
  }
  try {
    await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: HELIXO_FROM, to, subject, html }),
    });
  } catch (err) {
    console.error('Failed to send schedule email:', err);
  }
}

/* ------------------------------------------------------------------ */
/*  GET — weekly schedule with projected vs scheduled by position/day */
/* ------------------------------------------------------------------ */
export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabase();
  const locationId = url.searchParams.get('locationId');
  const weekStartDate = url.searchParams.get('weekStartDate');

  if (!locationId || !weekStartDate) {
    return json({ error: 'locationId and weekStartDate are required' }, { status: 400 });
  }

  // Compute week end (6 days after start = Sun)
  const wsDate = new Date(weekStartDate + 'T12:00:00');
  const weDate = new Date(wsDate);
  weDate.setDate(weDate.getDate() + 6);
  const weekEndDate = weDate.toISOString().split('T')[0];

  // Fetch schedule record (may not exist yet)
  const { data: schedule } = await sb
    .from('weekly_schedules')
    .select('*')
    .eq('location_id', locationId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle();

  // Fetch projected labor targets for the week
  const { data: targets } = await sb
    .from('daily_labor_targets')
    .select('business_date, position, projected_labor_dollars, threshold_bracket_used, week_forecast_total')
    .eq('location_id', locationId)
    .gte('business_date', weekStartDate)
    .lte('business_date', weekEndDate);

  const targetTotal = (targets || []).reduce((s, t) => s + (t.projected_labor_dollars || 0), 0);
  console.log(`[schedule-approval] GET: location=${locationId}, week=${weekStartDate}-${weekEndDate}, targetRows=${(targets || []).length}, totalProjected=$${Math.round(targetTotal)}, bracket=${(targets || [])[0]?.threshold_bracket_used || 'none'}, weekForecastTotal=${(targets || [])[0]?.week_forecast_total || 0}`);

  // Determine if projections are estimated (partial week) or confirmed (full week)
  const sampleTarget = (targets || [])[0];
  const isEstimated = sampleTarget?.threshold_bracket_used?.includes('(estimated)') ?? false;

  // Fetch scheduled labor for the week
  const { data: scheduled } = await sb
    .from('scheduled_labor')
    .select('business_date, position, scheduled_dollars, scheduled_hours, source')
    .eq('location_id', locationId)
    .gte('business_date', weekStartDate)
    .lte('business_date', weekEndDate);

  // Compute avg hourly rate per position from last 30 days of actual labor
  const thirtyDaysAgo = new Date(wsDate);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: laborHistory } = await sb
    .from('daily_labor')
    .select('mapped_position, labor_dollars, regular_hours, overtime_hours')
    .eq('location_id', locationId)
    .gte('business_date', thirtyDaysAgo.toISOString().split('T')[0])
    .lte('business_date', weekEndDate);

  const avgRateMap = new Map<string, number>();
  const rateAccum: Record<string, { dollars: number; hours: number }> = {};
  for (const r of laborHistory || []) {
    if (!r.mapped_position) continue;
    if (!rateAccum[r.mapped_position]) rateAccum[r.mapped_position] = { dollars: 0, hours: 0 };
    rateAccum[r.mapped_position].dollars += r.labor_dollars || 0;
    rateAccum[r.mapped_position].hours += (r.regular_hours || 0) + (r.overtime_hours || 0);
  }
  for (const [pos, acc] of Object.entries(rateAccum)) {
    avgRateMap.set(pos, acc.hours > 0 ? acc.dollars / acc.hours : 15);
  }

  // Build day-by-day position comparison
  const allPositions = [...FOH_POSITIONS, ...BOH_POSITIONS];
  const days: any[] = [];
  let totalProjected = 0;
  let totalScheduled = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(wsDate);
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];

    const dayTargets = (targets || []).filter(t => t.business_date === dateStr);
    const dayScheduled = (scheduled || []).filter(s => s.business_date === dateStr);

    const positions = allPositions.map(pos => {
      const target = dayTargets.find(t => t.position === pos);
      const sched = dayScheduled.find(s => s.position === pos);
      const proj = target?.projected_labor_dollars || 0;
      const sch = sched?.scheduled_dollars || 0;
      const schHrs = sched?.scheduled_hours || 0;
      // Compute projected hours from avg hourly rate (from daily_labor last 30 days)
      const avgRate = avgRateMap.get(pos) || 15;
      const projHrs = avgRate > 0 ? Math.round((proj / avgRate) * 10) / 10 : 0;
      totalProjected += proj;
      totalScheduled += sch;
      return {
        position: pos,
        projected: proj,
        projectedHours: projHrs,
        scheduled: sch,
        scheduledHours: schHrs,
        variance: sch - proj,
      };
    });

    days.push({ date: dateStr, dayOfWeek: d.getDay(), positions });
  }

  const variance = totalScheduled - totalProjected;
  const variancePct = totalProjected > 0 ? variance / totalProjected : 0;

  return json({
    schedule: schedule || {
      status: 'draft',
      submitted_by: null,
      submitted_at: null,
      reviewed_by: null,
      reviewed_at: null,
      review_notes: null,
    },
    days,
    totals: {
      projected: totalProjected,
      scheduled: totalScheduled,
      variance,
      variancePct,
    },
    isEstimated,
  });
};

/* ------------------------------------------------------------------ */
/*  POST — submit schedule for approval                               */
/* ------------------------------------------------------------------ */
export const POST: RequestHandler = async ({ request }) => {
  const sb = getSupabase();
  const body = await request.json();
  const { locationId, weekStartDate, submittedBy } = body;

  if (!locationId || !weekStartDate) {
    return json({ error: 'locationId and weekStartDate are required' }, { status: 400 });
  }

  // Compute totals from scheduled_labor vs daily_labor_targets
  const wsDate = new Date(weekStartDate + 'T12:00:00');
  const weDate = new Date(wsDate);
  weDate.setDate(weDate.getDate() + 6);
  const weekEndDate = weDate.toISOString().split('T')[0];

  const { data: targets } = await sb
    .from('daily_labor_targets')
    .select('projected_labor_dollars')
    .eq('location_id', locationId)
    .gte('business_date', weekStartDate)
    .lte('business_date', weekEndDate);

  const { data: scheduled } = await sb
    .from('scheduled_labor')
    .select('scheduled_dollars')
    .eq('location_id', locationId)
    .gte('business_date', weekStartDate)
    .lte('business_date', weekEndDate);

  const totalProjected = (targets || []).reduce((s, t) => s + (t.projected_labor_dollars || 0), 0);
  const totalScheduled = (scheduled || []).reduce((s, r) => s + (r.scheduled_dollars || 0), 0);
  const varianceDollars = totalScheduled - totalProjected;
  const variancePct = totalProjected > 0 ? varianceDollars / totalProjected : 0;

  const now = new Date().toISOString();

  // Compute FOH / BOH breakdowns for the email
  const { data: targetsByPos } = await sb
    .from('daily_labor_targets')
    .select('position, projected_labor_dollars')
    .eq('location_id', locationId)
    .gte('business_date', weekStartDate)
    .lte('business_date', weekEndDate);

  const { data: schedByPos } = await sb
    .from('scheduled_labor')
    .select('position, scheduled_dollars')
    .eq('location_id', locationId)
    .gte('business_date', weekStartDate)
    .lte('business_date', weekEndDate);

  const fohSet = new Set(FOH_POSITIONS as string[]);
  let fohProjected = 0, fohScheduled = 0, bohProjected = 0, bohScheduled = 0;
  for (const t of targetsByPos || []) {
    if (fohSet.has(t.position)) fohProjected += t.projected_labor_dollars || 0;
    else bohProjected += t.projected_labor_dollars || 0;
  }
  for (const s of schedByPos || []) {
    if (fohSet.has(s.position)) fohScheduled += s.scheduled_dollars || 0;
    else bohScheduled += s.scheduled_dollars || 0;
  }

  // Resolve submitter email to store in the record
  const submitterEmail = submittedBy || 'manager';

  // Upsert the weekly_schedules row
  const { data, error } = await sb
    .from('weekly_schedules')
    .upsert(
      {
        location_id: locationId,
        week_start_date: weekStartDate,
        status: 'submitted',
        submitted_by: submitterEmail,
        submitted_at: now,
        reviewed_by: null,
        reviewed_at: null,
        review_notes: null,
        total_scheduled_labor: totalScheduled,
        total_projected_labor: totalProjected,
        variance_dollars: varianceDollars,
        variance_pct: variancePct,
        updated_at: now,
      },
      { onConflict: 'location_id,week_start_date' },
    )
    .select()
    .single();

  if (error) {
    return json({ error: `Failed to submit: ${error.message}` }, { status: 500 });
  }

  // Send notification email to admins/directors
  const { data: location } = await sb
    .from('locations')
    .select('name')
    .eq('id', locationId)
    .maybeSingle();

  const locationName = location?.name || locationId;
  const weekLabel = formatWeekDate(weekStartDate);

  const { data: adminUsers } = await sb
    .from('location_users')
    .select('user_email')
    .eq('location_id', locationId)
    .or('role.eq.super_admin,role.eq.admin,role.eq.director');

  const adminEmails = (adminUsers || []).map(u => u.user_email).filter(Boolean);

  // Also check user_group_members for super_admins/directors
  const { data: groupAdmins } = await getSupabaseService()
    .from('user_group_members')
    .select('user_email')
    .or('role.eq.super_admin,role.eq.director');

  for (const ga of groupAdmins || []) {
    if (ga.user_email && !adminEmails.includes(ga.user_email)) {
      adminEmails.push(ga.user_email);
    }
  }

  if (adminEmails.length > 0) {
    const subject = `HELIXO | Schedule Submitted | ${locationName} | Week of ${weekLabel}`;
    const html = buildSubmittedEmailHtml(
      locationName, weekLabel,
      fohProjected, fohScheduled,
      bohProjected, bohScheduled,
      totalProjected, totalScheduled,
    );
    await sendEmail(adminEmails, subject, html);

    // In-app notifications for all admin/director recipients
    await createNotification(adminEmails.map(email => ({
      userEmail: email,
      type: 'schedule_submitted' as const,
      title: `Schedule submitted: ${locationName}`,
      body: `Week of ${weekLabel} — ${fmt$(totalScheduled)} scheduled vs ${fmt$(totalProjected)} projected`,
      link: '/dashboard/schedule-approval',
      locationId,
      metadata: { weekStartDate, totalScheduled, totalProjected },
    })));
  }

  return json({ submitted: true, schedule: data });
};

/* ------------------------------------------------------------------ */
/*  PUT — approve / deny / request revision (admin only)              */
/* ------------------------------------------------------------------ */
export const PUT: RequestHandler = async ({ request }) => {
  const sb = getSupabase();
  const body = await request.json();
  const { locationId, weekStartDate, action, reviewedBy, reviewNotes } = body;

  if (!locationId || !weekStartDate || !action) {
    return json({ error: 'locationId, weekStartDate, and action are required' }, { status: 400 });
  }

  if (!['approve', 'deny', 'revision_requested', 'push_to_dolce'].includes(action)) {
    return json({ error: 'action must be approve, deny, revision_requested, or push_to_dolce' }, { status: 400 });
  }

  if (!reviewedBy) {
    return json({ error: 'reviewedBy is required' }, { status: 400 });
  }

  const reviewerRole = await resolveUserRole(reviewedBy);
  if (!canApproveSchedule(reviewerRole)) {
    return json({ error: 'Only super admins and directors can approve or deny schedules.' }, { status: 403 });
  }

  const statusMap: Record<string, string> = {
    approve: 'approved',
    deny: 'denied',
    revision_requested: 'revision_requested',
    push_to_dolce: 'pushing_to_dolce',
  };

  const now = new Date().toISOString();

  // Fetch the current schedule to get submitter email
  const { data: existing } = await sb
    .from('weekly_schedules')
    .select('submitted_by')
    .eq('location_id', locationId)
    .eq('week_start_date', weekStartDate)
    .maybeSingle();

  const newStatus = statusMap[action];

  const { data, error } = await sb
    .from('weekly_schedules')
    .update({
      status: newStatus,
      reviewed_by: reviewedBy,
      reviewed_at: now,
      review_notes: reviewNotes || null,
      updated_at: now,
    })
    .eq('location_id', locationId)
    .eq('week_start_date', weekStartDate)
    .select()
    .single();

  if (error) {
    return json({ error: `Failed to update: ${error.message}` }, { status: 500 });
  }

  // Send decision email to the submitter
  const submitterEmail = existing?.submitted_by;
  if (submitterEmail && submitterEmail.includes('@')) {
    const { data: location } = await sb
      .from('locations')
      .select('name')
      .eq('id', locationId)
      .maybeSingle();

    const locationName = location?.name || locationId;
    const weekLabel = formatWeekDate(weekStartDate);
    const statusLabel = newStatus.charAt(0).toUpperCase() + newStatus.slice(1);
    const subject = `HELIXO | Schedule ${statusLabel} | ${locationName} | Week of ${weekLabel}`;
    const html = buildDecisionEmailHtml(locationName, weekLabel, newStatus, reviewNotes || null);
    await sendEmail([submitterEmail], subject, html);

    // In-app notification for submitter
    const notifType = action === 'approve' ? 'schedule_approved'
      : action === 'deny' ? 'schedule_denied'
      : 'schedule_revision';
    const notifTitle = action === 'approve'
      ? `Schedule approved: ${locationName}`
      : action === 'deny'
      ? `Schedule denied: ${locationName}`
      : `Revision requested: ${locationName}`;
    await createNotification({
      userEmail: submitterEmail,
      type: notifType as any,
      title: notifTitle,
      body: reviewNotes ? `Notes: ${reviewNotes}` : `Week of ${formatWeekDate(weekStartDate)}`,
      link: '/dashboard/schedule-approval',
      locationId,
      metadata: { weekStartDate, action },
    });
  }

  return json({ updated: true, schedule: data });
};

/* ------------------------------------------------------------------ */
/*  PATCH — upsert scheduled labor (manual entry)                     */
/* ------------------------------------------------------------------ */
export const PATCH: RequestHandler = async ({ request }) => {
  const sb = getSupabase();
  const body = await request.json();
  const { locationId, date, position, scheduledDollars, scheduledHours } = body;

  if (!locationId || !date || !position) {
    return json({ error: 'locationId, date, and position are required' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('scheduled_labor')
    .upsert(
      {
        location_id: locationId,
        business_date: date,
        position,
        scheduled_dollars: scheduledDollars ?? 0,
        scheduled_hours: scheduledHours ?? 0,
        source: 'manual',
      },
      { onConflict: 'location_id,business_date,position' },
    )
    .select()
    .single();

  if (error) {
    return json({ error: `Failed to save: ${error.message}` }, { status: 500 });
  }

  return json({ saved: true, record: data });
};
