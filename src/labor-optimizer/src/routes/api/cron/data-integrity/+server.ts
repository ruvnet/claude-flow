/**
 * Data Integrity Cron — 6:30 AM EST (11:30 UTC)
 *
 * Scans all active HELIXO locations for data gaps and auto-heals by
 * triggering backfills. Sends a summary email via Resend.
 *
 * Runs after the 5 AM Toast sync and 5:30 AM insights email.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { getSupabaseService } from '$lib/server/supabase';
import { scanAndHeal, type IntegrityReport, type LocationReport } from '$lib/server/domain/data-integrity';
import { logCronResult, type CronLocationResult } from '$lib/server/cron-helpers';

export const config = { maxDuration: 120 };

const RESEND_API_URL = 'https://api.resend.com/emails';
const ALERT_RECIPIENT = 'rr@methodco.com';

function formatDate(): string {
  const now = new Date();
  const estOffset = -5 * 60;
  const estNow = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
  return estNow.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Email builder
// ---------------------------------------------------------------------------

function buildReportEmail(report: IntegrityReport, dateStr: string): { subject: string; html: string } {
  const hasGaps = report.totalGaps > 0;
  const subject = hasGaps
    ? `HELIXO | Data Integrity Report | ${dateStr} | ${report.totalGaps} gaps found`
    : `HELIXO | Data Integrity Report | ${dateStr} | All Clear`;

  const statusIcon = (status: LocationReport['status']) => {
    switch (status) {
      case 'healthy': return '<span style="color:#059669;">&#9679;</span>';
      case 'healing': return '<span style="color:#d97706;">&#9679;</span>';
      case 'gaps_remaining': return '<span style="color:#dc2626;">&#9679;</span>';
    }
  };

  const locationRows = report.locations
    .map((loc) => {
      const revGaps = loc.revenueGaps.length;
      const labGaps = loc.laborGaps.length;
      const healed = loc.healedCount;
      const remaining = revGaps + labGaps + loc.weatherGaps + loc.budgetGaps + loc.forecastGaps - healed;

      return `<tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">
          ${statusIcon(loc.status)} ${loc.locationName}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">${revGaps}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">${labGaps}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">${loc.weatherGaps}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">${loc.budgetGaps}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;">${loc.forecastGaps}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:#059669;font-weight:600;">${healed}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:center;color:${remaining > 0 ? '#dc2626' : '#059669'};font-weight:600;">${remaining > 0 ? remaining : '0'}</td>
      </tr>`;
    })
    .join('');

  const summaryLine = hasGaps
    ? `<p style="color:#374151;font-size:14px;line-height:1.6;">
        Found <strong>${report.totalGaps}</strong> total gaps across ${report.locations.length} locations.
        Auto-healed <strong>${report.autoHealed}</strong>.
        ${report.persistentGaps > 0 ? `<span style="color:#dc2626;font-weight:600;">${report.persistentGaps} persistent gaps require manual review.</span>` : ''}
      </p>`
    : `<p style="color:#059669;font-size:16px;font-weight:600;text-align:center;padding:24px 0;">
        All Clear — No data gaps detected across ${report.locations.length} locations.
      </p>`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:780px;margin:0 auto;background:white;">
    <div style="background:#1e3a5f;padding:24px 32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;letter-spacing:3px;">HELIXO</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:11px;letter-spacing:1px;">DATA INTEGRITY REPORT</p>
    </div>

    <div style="padding:32px;">
      <p style="color:#6b7280;font-size:12px;margin:0 0 16px;">Scanned at ${report.scannedAt.replace('T', ' ').split('.')[0]} UTC</p>

      ${summaryLine}

      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr style="background:#1e3a5f;">
          <th style="color:#fff;padding:10px 12px;text-align:left;font-size:11px;">Location</th>
          <th style="color:#fff;padding:10px 12px;text-align:center;font-size:11px;">Rev</th>
          <th style="color:#fff;padding:10px 12px;text-align:center;font-size:11px;">Labor</th>
          <th style="color:#fff;padding:10px 12px;text-align:center;font-size:11px;">Weather</th>
          <th style="color:#fff;padding:10px 12px;text-align:center;font-size:11px;">Budget</th>
          <th style="color:#fff;padding:10px 12px;text-align:center;font-size:11px;">Forecast</th>
          <th style="color:#fff;padding:10px 12px;text-align:center;font-size:11px;">Healed</th>
          <th style="color:#fff;padding:10px 12px;text-align:center;font-size:11px;">Remaining</th>
        </tr>
        ${locationRows}
      </table>

      <p style="color:#9ca3af;font-size:11px;margin:20px 0 0;">
        Legend: <span style="color:#059669;">&#9679;</span> Healthy
        <span style="color:#d97706;margin-left:12px;">&#9679;</span> Healing
        <span style="color:#dc2626;margin-left:12px;">&#9679;</span> Gaps Remaining
      </p>
    </div>

    <div style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">HELIXO | Performance Dashboard<br>helixokpi.com</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, html };
}

// ---------------------------------------------------------------------------
// Send email
// ---------------------------------------------------------------------------

async function sendReportEmail(report: IntegrityReport): Promise<boolean> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.warn('[data-integrity] RESEND_API_KEY not configured — skipping email');
    return false;
  }

  const dateStr = formatDate();
  const { subject, html } = buildReportEmail(report, dateStr);

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'HELIXO <notifications@helixokpi.com>',
        to: [ALERT_RECIPIENT],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[data-integrity] Email send failed: ${res.status} ${errBody}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.error(`[data-integrity] Email send error: ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ request, url }) => {
  // Auth
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dryRun = url.searchParams.get('dryRun') === 'true';
  const locationId = url.searchParams.get('locationId') || undefined;

  const sb = getSupabaseService();
  let report: IntegrityReport;

  try {
    report = await scanAndHeal({ dryRun, locationId });
  } catch (err: any) {
    Sentry.captureException(err);
    console.error('[data-integrity] Scanner failed:', err.message);
    return json({ error: 'Scanner failed', details: err.message }, { status: 500 });
  }

  // Send email
  let emailSent = false;
  try {
    emailSent = await sendReportEmail(report);
  } catch (err: any) {
    console.error('[data-integrity] Email failed:', err.message);
  }

  // Log to system_health
  try {
    await sb.from('system_health').upsert(
      {
        component: 'data_integrity_cron',
        status: report.persistentGaps > 0 ? 'degraded' : report.totalGaps > 0 ? 'degraded' : 'healthy',
        last_check: new Date().toISOString(),
        details: {
          ranAt: report.scannedAt,
          totalGaps: report.totalGaps,
          autoHealed: report.autoHealed,
          persistentGaps: report.persistentGaps,
          locationCount: report.locations.length,
          emailSent,
          dryRun,
        },
      },
      { onConflict: 'component' },
    );
  } catch (err: any) {
    console.error('[data-integrity] Failed to log to system_health:', err.message);
  }

  // Log cron result
  const cronResults: CronLocationResult[] = report.locations.map((loc) => ({
    location: loc.locationName,
    status: loc.status === 'healthy' ? 'success' : loc.status === 'healing' ? 'partial' : 'error',
    error: loc.status === 'gaps_remaining'
      ? `Rev:${loc.revenueGaps.length} Lab:${loc.laborGaps.length} Wx:${loc.weatherGaps} Bud:${loc.budgetGaps} Fct:${loc.forecastGaps}`
      : undefined,
  }));
  await logCronResult(sb, 'data_integrity_cron', cronResults);

  // Record persistent gaps as learnings
  if (report.persistentGaps > 0) {
    for (const loc of report.locations) {
      const persistent = [
        ...loc.revenueGaps.filter((g) => g.error),
        ...loc.laborGaps.filter((g) => g.error),
      ];
      if (persistent.length > 0) {
        const dates = persistent.map((g) => g.date).slice(0, 5).join(', ');
        await sb.from('system_learnings').insert({
          location_id: loc.locationId,
          category: 'forecast',
          learning: `Persistent data gaps (${persistent.length} dates): ${dates}${persistent.length > 5 ? '...' : ''}`,
          source: 'data_integrity_cron',
          confidence: 0.95,
        }).then(() => {}, () => {});
      }
    }
  }

  return json({
    ...report,
    emailSent,
    dryRun,
  });
};
