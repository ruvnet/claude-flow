import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import * as Sentry from '@sentry/sveltekit';
import { getSupabaseService } from '$lib/server/supabase';
import { generateInsightsPdf } from '$lib/server/reports/insights-pdf';

export const config = { maxDuration: 120 };
import {
  withRetry,
  logCronResult,
  logCronFailure,
  type CronLocationResult,
} from '$lib/server/cron-helpers';

const RESEND_API_URL = 'https://api.resend.com/emails';

interface EmailRecipient {
  user_email: string;
  user_name: string | null;
  role: string;
}

function formatDateForSubject(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getYesterdayEST(): string {
  const now = new Date();
  // Convert to EST (UTC-5)
  const estOffset = -5 * 60;
  const estNow = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
  estNow.setDate(estNow.getDate() - 1);
  return estNow.toISOString().split('T')[0];
}

/**
 * Daily insights email cron endpoint.
 * Schedule: 10:30 UTC (5:30 AM EST) via vercel.json crons.
 *
 * For each active location:
 *   1. Generates a PDF insights report for yesterday
 *   2. Queries location_users for email recipients
 *   3. Sends email via Resend API with PDF attachment
 */
export const GET: RequestHandler = async ({ request }) => {
  // Verify cron secret
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  const sb = getSupabaseService();
  const yesterday = getYesterdayEST();
  const results: CronLocationResult[] = [];

  // Get all active locations
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('id, name')
    .eq('is_active', true);

  if (locErr || !locations) {
    return json({ error: 'Failed to fetch locations', details: locErr?.message }, { status: 500 });
  }

  for (const loc of locations) {
    try {
      // Get recipients for this location
      const { data: recipients, error: recErr } = await sb
        .from('location_users')
        .select('user_email, user_name, role')
        .eq('location_id', loc.id)
        .eq('receives_daily_email', true);

      if (recErr) {
        results.push({ location: loc.name, status: 'error', error: `Recipients query failed: ${recErr.message}` });
        continue;
      }

      if (!recipients || recipients.length === 0) {
        results.push({ location: loc.name, status: 'skipped', error: 'No email recipients configured' });
        continue;
      }

      // Check if there's actual data for yesterday
      const { data: actuals } = await sb
        .from('daily_actuals')
        .select('revenue')
        .eq('location_id', loc.id)
        .eq('business_date', yesterday)
        .maybeSingle();

      if (!actuals || !actuals.revenue) {
        results.push({ location: loc.name, status: 'skipped', error: `No revenue data for ${yesterday}` });
        continue;
      }

      // Fetch labor, budget, and forecast data for email summary
      const [{ data: laborRows }, { data: budgetRow }, { data: forecastRow }] = await Promise.all([
        sb.from('daily_labor').select('mapped_position, labor_dollars').eq('location_id', loc.id).eq('business_date', yesterday),
        sb.from('daily_budget').select('budget_revenue, server_budget, bartender_budget, host_budget, barista_budget, support_budget, training_budget, line_cooks_budget, prep_cooks_budget, pastry_budget, dishwashers_budget').eq('location_id', loc.id).eq('business_date', yesterday).maybeSingle(),
        sb.from('daily_forecasts').select('manager_revenue, ai_suggested_revenue').eq('location_id', loc.id).eq('business_date', yesterday).maybeSingle(),
      ]);

      const FOH_POS = ['Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training'];
      const BOH_POS = ['Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'];
      let fohActual = 0, bohActual = 0;
      (laborRows || []).forEach((r: { mapped_position: string; labor_dollars: number }) => {
        if (FOH_POS.includes(r.mapped_position)) fohActual += r.labor_dollars || 0;
        else if (BOH_POS.includes(r.mapped_position)) bohActual += r.labor_dollars || 0;
      });
      const totalLabor = fohActual + bohActual;
      const laborPct = actuals.revenue > 0 ? (totalLabor / actuals.revenue * 100) : 0;
      const budgetRevenue = budgetRow?.budget_revenue || 0;
      const forecastRevenue = forecastRow?.manager_revenue || forecastRow?.ai_suggested_revenue || 0;
      let fohBudget = 0, bohBudget = 0;
      if (budgetRow) {
        fohBudget = (budgetRow.server_budget || 0) + (budgetRow.bartender_budget || 0) + (budgetRow.host_budget || 0) + (budgetRow.barista_budget || 0) + (budgetRow.support_budget || 0) + (budgetRow.training_budget || 0);
        bohBudget = (budgetRow.line_cooks_budget || 0) + (budgetRow.prep_cooks_budget || 0) + (budgetRow.pastry_budget || 0) + (budgetRow.dishwashers_budget || 0);
      }
      const totalBudgetLabor = fohBudget + bohBudget;
      const budgetLaborPct = budgetRevenue > 0 ? (totalBudgetLabor / budgetRevenue * 100) : 0;

      // Generate PDF — if this fails, skip this location and continue
      let buffer: Buffer;
      let locationName: string;
      try {
        const pdfResult = await generateInsightsPdf(loc.id, yesterday);
        buffer = pdfResult.buffer;
        locationName = pdfResult.locationName;
      } catch (pdfErr: any) {
        const msg = `PDF generation failed: ${pdfErr.message}`;
        Sentry.captureException(pdfErr);
        results.push({ location: loc.name, status: 'error', error: msg });
        await logCronFailure(sb, 'daily_insights_email_cron', loc.name, msg);
        continue;
      }

      // Build email
      const toAddresses = recipients.map((r: EmailRecipient) => r.user_email);
      const dateFormatted = formatDateForSubject(yesterday);
      const subject = `HELIXO | Daily Insights | ${locationName} | ${dateFormatted}`;

      const htmlBody = buildEmailHtml(locationName, yesterday, dateFormatted, {
        revenue: actuals.revenue, budgetRevenue, forecastRevenue,
        fohActual, fohBudget, bohActual, bohBudget,
        totalLabor, totalBudgetLabor, laborPct, budgetLaborPct,
      });

      const emailPayload = {
        from: process.env.RESEND_FROM_EMAIL || 'HELIXO <notifications@helixokpi.com>',
        to: toAddresses,
        subject,
        html: htmlBody,
        attachments: [
          {
            filename: `KPI-Insights-${locationName.replace(/\s+/g, '-')}-${yesterday}.pdf`,
            content: buffer.toString('base64'),
            content_type: 'application/pdf',
          },
        ],
      };

      // Send via Resend with 1 retry on failure
      try {
        await withRetry(async () => {
          const emailRes = await fetch(RESEND_API_URL, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${resendApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(emailPayload),
          });
          if (!emailRes.ok) {
            const errBody = await emailRes.text();
            throw new Error(`Resend API error ${emailRes.status}: ${errBody}`);
          }
        }, { label: `email:${loc.name}`, maxAttempts: 2, delayMs: 3000 });

        results.push({ location: loc.name, status: 'sent', recipients: toAddresses.length });
      } catch (emailErr: any) {
        const msg = `Email send failed after retry: ${emailErr.message}`;
        results.push({ location: loc.name, status: 'error', recipients: toAddresses.length, error: msg });
        await logCronFailure(sb, 'daily_insights_email_cron', loc.name, msg);
      }
    } catch (err: any) {
      Sentry.captureException(err);
      results.push({ location: loc.name, status: 'error', error: err.message });
      await logCronFailure(sb, 'daily_insights_email_cron', loc.name, err.message);
    }
  }

  // Log cron outcome to system_health
  await logCronResult(sb, 'daily_insights_email_cron', results);

  return json({
    date: yesterday,
    totalLocations: locations.length,
    results,
  });
};

interface EmailMetrics {
  revenue: number; budgetRevenue: number; forecastRevenue: number;
  fohActual: number; fohBudget: number;
  bohActual: number; bohBudget: number;
  totalLabor: number; totalBudgetLabor: number;
  laborPct: number; budgetLaborPct: number;
}

function buildEmailHtml(
  locationName: string,
  date: string,
  dateFormatted: string,
  m: EmailMetrics,
): string {
  const fmt = (n: number) => '$' + Math.round(n).toLocaleString('en-US');
  const pct = (n: number) => n.toFixed(1) + '%';
  const varColor = (actual: number, budget: number, invertGood = false) => {
    const diff = actual - budget;
    if (Math.abs(diff) < 1) return '#6b7280';
    if (invertGood) return diff > 0 ? '#dc2626' : '#059669';
    return diff > 0 ? '#059669' : '#dc2626';
  };
  const varStr = (actual: number, budget: number) => {
    const diff = actual - budget;
    const sign = diff >= 0 ? '+' : '';
    const pctVal = budget > 0 ? ` (${sign}${((diff / budget) * 100).toFixed(1)}%)` : '';
    return `${sign}${fmt(diff)}${pctVal}`;
  };

  const td = (text: string, extra = '') =>
    `<td style="padding:10px 14px;text-align:right;font-size:13px;border-bottom:1px solid #e5e7eb;${extra}">${text}</td>`;
  const tdLeft = (text: string, extra = '') =>
    `<td style="padding:10px 14px;font-size:13px;border-bottom:1px solid #e5e7eb;${extra}">${text}</td>`;

  // Revenue row: Actual | Forecast | Budget | Var to Budget (5 cols)
  const revVarColor = varColor(m.revenue, m.budgetRevenue);
  const revenueRow = `<tr>${tdLeft('Revenue')}${td(fmt(m.revenue))}${td(fmt(m.forecastRevenue))}${td(fmt(m.budgetRevenue))}${td(varStr(m.revenue, m.budgetRevenue), `color:${revVarColor};`)}</tr>`;

  // Labor rows: Actual | — | Budget | Variance (5 cols, forecast col is dash)
  const laborRow = (label: string, actual: number, budget: number, invertGood: boolean, bold = false) => {
    const fw = bold ? 'font-weight:700;' : '';
    const bg = bold ? 'background:#f3f4f6;' : '';
    const vColor = varColor(actual, budget, invertGood);
    return `<tr style="${bg}">${tdLeft(label, fw)}${td(fmt(actual), fw)}${td('\u2014', 'color:#9ca3af;')}${td(fmt(budget))}${td(varStr(actual, budget), `color:${vColor};${fw}`)}</tr>`;
  };
  const laborPctRow = () => {
    const vColor = varColor(m.laborPct, m.budgetLaborPct, true);
    const diff = m.laborPct - m.budgetLaborPct;
    const sign = diff >= 0 ? '+' : '';
    return `<tr>${tdLeft('Labor %')}${td(pct(m.laborPct))}${td('\u2014', 'color:#9ca3af;')}${td(pct(m.budgetLaborPct))}${td(`${sign}${pct(diff)}`, `color:${vColor};`)}</tr>`;
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:680px;margin:0 auto;background:white;">
    <div style="background:#1e3a5f;padding:24px 32px;text-align:center;">
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;letter-spacing:3px;">HELIXO</h1>
      <p style="color:rgba(255,255,255,0.6);margin:4px 0 0;font-size:11px;letter-spacing:1px;">DAILY INSIGHTS REPORT</p>
    </div>

    <div style="padding:32px;">
      <table style="width:100%;margin-bottom:24px;"><tr>
        <td style="vertical-align:top;">
          <p style="color:#6b7280;font-size:11px;margin:0;text-transform:uppercase;letter-spacing:1px;">Location</p>
          <p style="color:#111;font-size:16px;font-weight:700;margin:4px 0 0;">${locationName}</p>
        </td>
        <td style="vertical-align:top;text-align:right;">
          <p style="color:#6b7280;font-size:11px;margin:0;text-transform:uppercase;letter-spacing:1px;">Date</p>
          <p style="color:#111;font-size:16px;font-weight:700;margin:4px 0 0;">${dateFormatted}</p>
        </td>
      </tr></table>

      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr style="background:#1e3a5f;">
          <th style="color:#fff;padding:10px 14px;text-align:left;font-size:12px;">Metric</th>
          <th style="color:#fff;padding:10px 14px;text-align:right;font-size:12px;">Actual</th>
          <th style="color:#fff;padding:10px 14px;text-align:right;font-size:12px;">Forecast</th>
          <th style="color:#fff;padding:10px 14px;text-align:right;font-size:12px;">Budget</th>
          <th style="color:#fff;padding:10px 14px;text-align:right;font-size:12px;">Var to Budget</th>
        </tr>
        ${revenueRow}
        ${laborRow('FOH Labor', m.fohActual, m.fohBudget, true)}
        ${laborRow('BOH Labor', m.bohActual, m.bohBudget, true)}
        ${laborRow('Total Labor', m.totalLabor, m.totalBudgetLabor, true, true)}
        ${laborPctRow()}
      </table>

      <p style="color:#374151;font-size:14px;line-height:1.6;margin:20px 0;">
        Full insights report attached as PDF — includes sales mix, PMIX movers, labor variance by position, hourly efficiency, and savings opportunities.
      </p>

      <div style="text-align:center;margin:24px 0;">
        <a href="https://helixokpi.com/dashboard/insights" style="display:inline-block;background:#1e3a5f;color:#fff;padding:12px 36px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.5px;">View Full Insights</a>
      </div>
    </div>

    <div style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">HELIXO | Performance Dashboard<br>helixokpi.com</p>
    </div>
  </div>
</body>
</html>`;
}
