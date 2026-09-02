/**
 * Daily Slack Digest Cron
 *
 * Sends a morning summary to a Slack channel via Incoming Webhook.
 * Includes: all-location revenue vs forecast vs budget vs LY + system diagnostics.
 *
 * Schedule: 0 13 * * * (8 AM EDT / 9 AM EST) — added in vercel.json
 * Requires: SLACK_WEBHOOK_URL env var (Incoming Webhook URL from Slack App config)
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';

export const config = { maxDuration: 60 };

function getYesterdayET(): string {
  const now = new Date();
  const etParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const etDate = `${etParts.find(p => p.type === 'year')!.value}-${etParts.find(p => p.type === 'month')!.value}-${etParts.find(p => p.type === 'day')!.value}`;
  const d = new Date(etDate + 'T12:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

function fmt(n: number | null | undefined): string {
  if (n == null || n === 0) return '$0';
  return '$' + Math.round(n).toLocaleString();
}

function pct(a: number, b: number): string {
  if (!b) return '—';
  const d = ((a - b) / b) * 100;
  return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
}

function emoji(a: number, b: number): string {
  if (!b) return '⚪';
  const d = (a - b) / b;
  if (d >= 0.05) return '🟢';
  if (d >= -0.02) return '🟡';
  return '🔴';
}

export const GET: RequestHandler = async ({ request }) => {
  // Auth check
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) {
    return json({ error: 'SLACK_WEBHOOK_URL not configured' }, { status: 500 });
  }

  const sb = getSupabaseService();
  const date = getYesterdayET();
  const lyDate = (() => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() - 364); // same DOW last year
    return d.toISOString().split('T')[0];
  })();

  const displayDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  // Pull all data in parallel
  const [
    { data: locations },
    { data: actuals },
    { data: forecasts },
    { data: budgets },
    { data: lyActuals },
    { data: cronHealth },
  ] = await Promise.all([
    sb.from('locations').select('id, name, is_active').eq('is_active', true).order('name'),
    sb.from('daily_actuals').select('location_id, revenue, covers').eq('business_date', date),
    sb.from('daily_forecasts').select('location_id, suggested_revenue, manager_revenue').eq('date', date),
    sb.from('daily_budget').select('location_id, revenue_budget').eq('date', date),
    sb.from('daily_actuals').select('location_id, revenue').eq('business_date', lyDate),
    sb.from('system_health').select('component, last_success_at, last_error, status').order('component'),
  ]);

  if (!locations?.length) {
    return json({ error: 'No active locations' }, { status: 500 });
  }

  // Build per-location rows
  type LocationRow = {
    name: string;
    rev: number;
    forecast: number;
    budget: number;
    ly: number;
  };
  const rows: LocationRow[] = [];
  let grandRev = 0;
  let grandForecast = 0;
  let grandBudget = 0;
  let grandLY = 0;

  for (const loc of locations) {
    const act = actuals?.find(a => a.location_id === loc.id);
    const fcast = forecasts?.find(f => f.location_id === loc.id);
    const bud = budgets?.find(b => b.location_id === loc.id);
    const ly = lyActuals?.find(l => l.location_id === loc.id);

    const rev = act?.revenue || 0;
    const forecast = fcast?.manager_revenue || fcast?.suggested_revenue || 0;
    const budget = bud?.revenue_budget || 0;
    const lyRev = ly?.revenue || 0;

    grandRev += rev;
    grandForecast += forecast;
    grandBudget += budget;
    grandLY += lyRev;

    rows.push({ name: loc.name, rev, forecast, budget, ly: lyRev });
  }

  // Shorten location names for Slack display
  const shorten = (name: string) =>
    name.replace('& Bar Rotunda', '').replace('HIROKI', 'HIROKI').replace(' Philadelphia', ' PHI').replace(' Detroit', ' DET').trim();

  // Build location table text
  const tableLines = rows
    .sort((a, b) => b.rev - a.rev)
    .map(r => {
      const e = emoji(r.rev, r.forecast);
      const vsF = r.forecast ? pct(r.rev, r.forecast) : '—';
      const vsB = r.budget  ? pct(r.rev, r.budget)   : '—';
      const vsLY = r.ly     ? pct(r.rev, r.ly)       : '—';
      return `${e} *${shorten(r.name)}* ${fmt(r.rev)}  vs F: ${vsF}  vs B: ${vsB}  vs LY: ${vsLY}`;
    })
    .join('\n');

  // System diagnostics
  const criticalCrons = ['toast-sync', 'daily-refresh', 'daily-insights-email'];
  const now = new Date();
  const diagLines: string[] = [];
  for (const cron of criticalCrons) {
    const health = cronHealth?.find(h => h.component === cron);
    if (!health?.last_success_at) {
      diagLines.push(`⚠️ *${cron}*: No run recorded`);
      continue;
    }
    const hoursAgo = (now.getTime() - new Date(health.last_success_at).getTime()) / 3_600_000;
    const icon = hoursAgo < 26 ? '✅' : '⚠️';
    diagLines.push(`${icon} *${cron}*: ${hoursAgo.toFixed(1)}h ago`);
  }

  // Totals summary line
  const totalEmoji = emoji(grandRev, grandForecast);
  const totalLine = `${totalEmoji} *ALL LOCATIONS* ${fmt(grandRev)}  vs F: ${pct(grandRev, grandForecast)}  vs B: ${pct(grandRev, grandBudget)}  vs LY: ${pct(grandRev, grandLY)}`;

  // Slack Block Kit payload
  const payload = {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📊 HELIXO Daily Summary — ${displayDate}`, emoji: true },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Revenue vs Forecast vs Budget vs Last Year*\n\n${tableLines}`,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: totalLine },
      },
      { type: 'divider' },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*System Diagnostics*\n${diagLines.join('\n') || '_No cron data_'}`,
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<https://www.helixoapp.com/dashboard|Open HELIXO> · Data for ${date} · LY date: ${lyDate}`,
          },
        ],
      },
    ],
  };

  const slackRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!slackRes.ok) {
    const text = await slackRes.text();
    return json({ error: `Slack webhook failed: ${slackRes.status} ${text}` }, { status: 500 });
  }

  return json({
    success: true,
    date,
    locationsReported: rows.length,
    totalRevenue: grandRev,
  });
};
