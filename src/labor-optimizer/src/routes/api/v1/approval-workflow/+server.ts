/**
 * Approval Workflow API
 *
 * Unified queue for Revenue Forecast submissions + Schedule submissions
 * across all locations the requesting user can access.
 *
 * GET    ?email=   — fetch all pending/recent submissions for user's locations
 * POST   action=submit_forecast | approve | deny | revision_requested
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabase, getSupabaseService } from '$lib/server/supabase';
import { isValidRole, getHighestRole, canApproveSchedule, type UserRole } from '$lib/roles';
import { createNotification } from '$lib/server/notifications';

const RESEND_API_URL = 'https://api.resend.com/emails';
const HELIXO_FROM = process.env.RESEND_FROM_EMAIL || 'HELIXO <notifications@helixokpi.com>';

async function sendEmail(to: string[], subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return;
  try {
    await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: HELIXO_FROM, to, subject, html }),
    });
  } catch {}
}

function emailWrapper(inner: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;font-family:'Inter',sans-serif;background:#f5f5f5;">
  <div style="max-width:600px;margin:0 auto;background:white;">
    <div style="background:#1e3a5f;padding:24px 32px;"><h1 style="color:white;margin:0;font-size:22px;font-weight:700;">HELIXO</h1></div>
    <div style="padding:32px;">${inner}</div>
    <div style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;"><p style="color:#9ca3af;font-size:11px;margin:0;">HELIXO &mdash; Performance Dashboard</p></div>
  </div></body></html>`;
}

async function resolveUserRole(email: string): Promise<UserRole> {
  const sb = getSupabaseService();
  const roles: UserRole[] = [];
  const [{ data: gm }, { data: lu }] = await Promise.all([
    sb.from('user_group_members').select('role').eq('user_email', email),
    sb.from('location_users').select('role').eq('user_email', email),
  ]);
  for (const r of [...(gm || []), ...(lu || [])]) {
    if (r.role && isValidRole(r.role)) roles.push(r.role as UserRole);
  }
  return getHighestRole(roles);
}

async function getUserLocationIds(email: string): Promise<string[] | null> {
  const sb = getSupabaseService();
  const [{ data: gm }, { data: lu }] = await Promise.all([
    sb.from('user_group_members').select('role').eq('user_email', email),
    sb.from('location_users').select('role, location_id').eq('user_email', email),
  ]);
  const roles: UserRole[] = [];
  for (const r of [...(gm || []), ...(lu || [])]) {
    if (r.role && isValidRole(r.role)) roles.push(r.role as UserRole);
  }
  const role = getHighestRole(roles);
  if (role === 'super_admin' || role === 'director') return null; // all locations
  return (lu || []).map((r) => r.location_id).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/*  GET — fetch all pending + recent submissions                       */
/* ------------------------------------------------------------------ */
export const GET: RequestHandler = async ({ url }) => {
  const email = url.searchParams.get('email');
  const statusFilter = url.searchParams.get('status') || 'all'; // all | pending | reviewed
  if (!email) return json({ error: 'email required' }, { status: 400 });

  const sb = getSupabase();

  // Get which locations this user can access
  const locationIds = await getUserLocationIds(email);

  // --- Schedule submissions ---
  let schedQuery = sb
    .from('weekly_schedules')
    .select('*, locations(name)')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (locationIds !== null) {
    schedQuery = schedQuery.in('location_id', locationIds);
  }
  if (statusFilter === 'pending') {
    schedQuery = schedQuery.eq('status', 'submitted');
  } else if (statusFilter === 'reviewed') {
    schedQuery = schedQuery.in('status', ['approved', 'denied', 'revision_requested']);
  }

  // --- Forecast submissions ---
  let forecastQuery = sb
    .from('forecast_submissions')
    .select('*, locations(name)')
    .order('submitted_at', { ascending: false })
    .limit(100);

  if (locationIds !== null) {
    forecastQuery = forecastQuery.in('location_id', locationIds);
  }
  if (statusFilter === 'pending') {
    forecastQuery = forecastQuery.eq('status', 'submitted');
  } else if (statusFilter === 'reviewed') {
    forecastQuery = forecastQuery.in('status', ['approved', 'denied', 'revision_requested']);
  }

  const [{ data: schedules }, { data: forecasts }] = await Promise.all([schedQuery, forecastQuery]);

  // Combine and enrich
  const schedItems = (schedules || []).map((s) => ({
    ...s,
    type: 'schedule' as const,
    locationName: (s.locations as any)?.name || s.location_id,
    title: `Schedule — Week of ${s.week_start_date}`,
    amount: s.total_scheduled_labor,
    projected: s.total_projected_labor,
    variance: s.variance_dollars,
    variancePct: s.variance_pct,
  }));

  const forecastItems = (forecasts || []).map((f) => ({
    ...f,
    type: 'forecast' as const,
    locationName: (f.locations as any)?.name || f.location_id,
    title: `Revenue Forecast — P${f.period_number} W${f.week_number} ${f.year}`,
    amount: f.total_forecast_revenue,
    projected: null,
    variance: null,
    variancePct: null,
  }));

  // Sort combined by submitted_at desc
  const allItems = [...schedItems, ...forecastItems].sort(
    (a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime(),
  );

  const pendingCount = allItems.filter((i) => i.status === 'submitted').length;

  return json({ items: allItems, pendingCount });
};

/* ------------------------------------------------------------------ */
/*  POST — submit forecast | approve | deny | revision_requested       */
/* ------------------------------------------------------------------ */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const { action, reviewedBy } = body;

  if (!action) return json({ error: 'action required' }, { status: 400 });

  const sb = getSupabase();
  const now = new Date().toISOString();

  // ---- Submit forecast ----
  if (action === 'submit_forecast') {
    const { locationId, periodNumber, year, weekNumber, weekStartDate, weekEndDate,
            totalForecastRevenue, submittedBy, managerNotes } = body;

    if (!locationId || !periodNumber || !year || !weekNumber || !weekStartDate || !weekEndDate || !submittedBy) {
      return json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data, error } = await sb
      .from('forecast_submissions')
      .upsert(
        {
          location_id: locationId,
          period_number: periodNumber,
          year,
          week_number: weekNumber,
          week_start_date: weekStartDate,
          week_end_date: weekEndDate,
          status: 'submitted',
          submitted_by: submittedBy,
          submitted_at: now,
          reviewed_by: null,
          reviewed_at: null,
          review_notes: null,
          total_forecast_revenue: totalForecastRevenue || 0,
          manager_notes: managerNotes || null,
          updated_at: now,
        },
        { onConflict: 'location_id,period_number,year,week_number' },
      )
      .select()
      .single();

    if (error) return json({ error: error.message }, { status: 500 });

    // Notify approvers
    const { data: location } = await sb.from('locations').select('name').eq('id', locationId).maybeSingle();
    const locationName = location?.name || locationId;

    const { data: approvers } = await getSupabaseService()
      .from('user_group_members')
      .select('user_email')
      .or('role.eq.super_admin,role.eq.director');

    const approverEmails = [...new Set((approvers || []).map((a) => a.user_email).filter(Boolean))];

    if (approverEmails.length > 0) {
      const subject = `HELIXO | Forecast Submitted | ${locationName} | P${periodNumber} W${weekNumber} ${year}`;
      const html = emailWrapper(`
        <h2 style="color:#1e3a5f;margin:0 0 4px;font-size:18px;">Revenue Forecast Submitted for Review</h2>
        <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">${locationName} — Period ${periodNumber}, Week ${weekNumber} ${year}</p>
        <div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:16px 20px;border-radius:0 6px 6px 0;margin-bottom:24px;">
          <p style="color:#374151;font-size:16px;font-weight:700;margin:0;">$${Math.round(totalForecastRevenue || 0).toLocaleString()} projected revenue</p>
          ${managerNotes ? `<p style="color:#6b7280;font-size:13px;margin:4px 0 0;">${managerNotes}</p>` : ''}
        </div>
        <div style="text-align:center;">
          <a href="https://helixoapp.com/dashboard/approval-workflow" style="display:inline-block;background:#1e3a5f;color:white;padding:12px 32px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;">Review Now</a>
        </div>
      `);
      await sendEmail(approverEmails, subject, html);
      await createNotification(approverEmails.map((e) => ({
        userEmail: e,
        type: 'forecast_submitted' as any,
        title: `Forecast submitted: ${locationName}`,
        body: `P${periodNumber} W${weekNumber} — $${Math.round(totalForecastRevenue || 0).toLocaleString()}`,
        link: '/dashboard/approval-workflow',
        locationId,
        metadata: { periodNumber, year, weekNumber },
      })));
    }

    return json({ submitted: true, submission: data });
  }

  // ---- Approve / Deny / Revision actions ----
  if (['approve', 'deny', 'revision_requested'].includes(action)) {
    const { itemType, itemId, locationId, notes } = body;

    if (!itemId || !itemType || !reviewedBy) {
      return json({ error: 'itemId, itemType, and reviewedBy required' }, { status: 400 });
    }

    const reviewerRole = await resolveUserRole(reviewedBy);
    if (!canApproveSchedule(reviewerRole)) {
      return json({ error: 'Only directors and super admins can approve submissions.' }, { status: 403 });
    }

    const statusMap: Record<string, string> = {
      approve: 'approved',
      deny: 'denied',
      revision_requested: 'revision_requested',
    };
    const newStatus = statusMap[action];

    const table = itemType === 'schedule' ? 'weekly_schedules' : 'forecast_submissions';

    const { data, error } = await sb
      .from(table)
      .update({ status: newStatus, reviewed_by: reviewedBy, reviewed_at: now, review_notes: notes || null, updated_at: now })
      .eq('id', itemId)
      .select()
      .single();

    if (error) return json({ error: error.message }, { status: 500 });

    // Notify submitter
    if (data?.submitted_by?.includes('@')) {
      const { data: loc } = await sb.from('locations').select('name').eq('id', data.location_id).maybeSingle();
      const locName = loc?.name || data.location_id;
      const statusLabel = newStatus.replace('_', ' ');
      const isApproved = newStatus === 'approved';

      const subject = `HELIXO | ${itemType === 'schedule' ? 'Schedule' : 'Forecast'} ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)} | ${locName}`;
      const html = emailWrapper(`
        <h2 style="color:#1e3a5f;margin:0 0 4px;font-size:18px;">${itemType === 'schedule' ? 'Schedule' : 'Forecast'} ${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}</h2>
        <p style="color:#6b7280;margin:0 0 24px;font-size:14px;">${locName}</p>
        <div style="background:${isApproved ? '#f0fdf4' : '#fef2f2'};border-left:4px solid ${isApproved ? '#16a34a' : '#dc2626'};padding:16px 20px;border-radius:0 6px 6px 0;margin-bottom:24px;">
          <p style="color:${isApproved ? '#16a34a' : '#dc2626'};font-size:16px;font-weight:700;margin:0;">${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}</p>
          ${notes ? `<p style="color:#374151;font-size:14px;margin:4px 0 0;">${notes}</p>` : ''}
        </div>
      `);
      await sendEmail([data.submitted_by], subject, html);

      const notifType = action === 'approve'
        ? (itemType === 'forecast' ? 'forecast_approved' : 'schedule_approved')
        : (action === 'deny' ? 'schedule_denied' : 'schedule_revision');

      await createNotification({
        userEmail: data.submitted_by,
        type: notifType as any,
        title: `${itemType === 'schedule' ? 'Schedule' : 'Forecast'} ${statusLabel}: ${locName}`,
        body: notes || `Status updated to ${statusLabel}`,
        link: '/dashboard/approval-workflow',
        locationId: data.location_id,
        metadata: { action, itemType },
      });
    }

    return json({ updated: true, item: data });
  }

  return json({ error: `Unknown action: ${action}` }, { status: 400 });
};
