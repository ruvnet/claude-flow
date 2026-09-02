/**
 * Daily 6 AM Diagnostics Email
 *
 * Builds and sends an HELIXO-branded diagnostics email via Resend
 * covering data source health, cron job status, per-location health,
 * and system alerts.
 */

import { getSupabaseService } from '$lib/server/supabase';

const RESEND_API_URL = 'https://api.resend.com/emails';
const RECIPIENT = 'rr@methodco.com';
const FROM = 'HELIXO <notifications@helixokpi.com>';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataSourceRow {
  source: string;
  table: string;
  records: number;
  lastSync: string | null;
  status: 'healthy' | 'stale' | 'empty';
}

interface CronJobRow {
  job: string;
  lastRun: string | null;
  success: boolean;
  status: 'healthy' | 'failed' | 'unknown';
}

interface LocationHealth {
  name: string;
  hasActuals: boolean;
  hasLabor: boolean;
  hasWeather: boolean;
  hasBudget: boolean;
}

type OverallStatus = 'green' | 'yellow' | 'red';

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

function getYesterdayEST(): string {
  const now = new Date();
  const estOffset = -5 * 60;
  const estNow = new Date(now.getTime() + (estOffset - now.getTimezoneOffset()) * 60000);
  estNow.setDate(estNow.getDate() - 1);
  return estNow.toISOString().split('T')[0];
}

function formatDate(): string {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

async function collectDataSources(
  sb: ReturnType<typeof getSupabaseService>,
  yesterday: string,
): Promise<DataSourceRow[]> {
  const sources: DataSourceRow[] = [];
  const staleMs = 26 * 60 * 60 * 1000; // 26 hours

  const tables: { source: string; table: string; timeCol: string }[] = [
    { source: 'Toast Actuals', table: 'daily_actuals', timeCol: 'synced_at' },
    { source: 'Toast Labor', table: 'daily_labor', timeCol: 'synced_at' },
    { source: 'Dolce Schedule', table: 'scheduled_labor', timeCol: 'updated_at' },
    { source: 'Resy Reservations', table: 'daily_reservations', timeCol: 'synced_at' },
    { source: 'Weather', table: 'daily_weather', timeCol: 'synced_at' },
    { source: 'Sales Mix', table: 'sales_mix', timeCol: 'synced_at' },
    { source: 'Hourly Sales', table: 'hourly_sales', timeCol: 'synced_at' },
    { source: 'Forecasts', table: 'forecasts', timeCol: 'created_at' },
    { source: 'Labor Targets', table: 'labor_targets', timeCol: 'updated_at' },
  ];

  for (const t of tables) {
    try {
      const { data: latest } = await sb
        .from(t.table)
        .select(t.timeCol)
        .order(t.timeCol, { ascending: false })
        .limit(1)
        .maybeSingle();

      const { count } = await sb.from(t.table).select('*', { count: 'exact', head: true });
      const lastSync = latest?.[t.timeCol] ?? null;
      const lastMs = lastSync ? new Date(lastSync).getTime() : 0;
      const isStale = lastMs === 0 || Date.now() - lastMs > staleMs;

      sources.push({
        source: t.source,
        table: t.table,
        records: count ?? 0,
        lastSync,
        status: (count ?? 0) === 0 ? 'empty' : isStale ? 'stale' : 'healthy',
      });
    } catch {
      sources.push({ source: t.source, table: t.table, records: 0, lastSync: null, status: 'empty' });
    }
  }

  return sources;
}

async function collectCronJobs(
  sb: ReturnType<typeof getSupabaseService>,
): Promise<CronJobRow[]> {
  const jobs = ['toast_sync', 'daily_insights_email', 'daily_refresh_cron', 'intraday_sync'];
  const rows: CronJobRow[] = [];

  for (const job of jobs) {
    try {
      const { data } = await sb
        .from('system_health')
        .select('status, last_check, details')
        .eq('component', job)
        .maybeSingle();

      if (data) {
        rows.push({
          job,
          lastRun: data.last_check,
          success: data.status === 'healthy',
          status: data.status === 'healthy' ? 'healthy' : 'failed',
        });
      } else {
        rows.push({ job, lastRun: null, success: false, status: 'unknown' });
      }
    } catch {
      rows.push({ job, lastRun: null, success: false, status: 'unknown' });
    }
  }

  return rows;
}

async function collectLocationHealth(
  sb: ReturnType<typeof getSupabaseService>,
  yesterday: string,
): Promise<LocationHealth[]> {
  const { data: locations } = await sb
    .from('locations')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  if (!locations) return [];

  const results: LocationHealth[] = [];

  for (const loc of locations) {
    const { count: actualsCount } = await sb
      .from('daily_actuals')
      .select('*', { count: 'exact', head: true })
      .eq('location_id', loc.id)
      .eq('business_date', yesterday);

    const { count: laborCount } = await sb
      .from('daily_labor')
      .select('*', { count: 'exact', head: true })
      .eq('location_id', loc.id)
      .eq('business_date', yesterday);

    const { count: weatherCount } = await sb
      .from('daily_weather')
      .select('*', { count: 'exact', head: true })
      .eq('location_id', loc.id)
      .eq('business_date', yesterday);

    const { count: budgetCount } = await sb
      .from('labor_targets')
      .select('*', { count: 'exact', head: true })
      .eq('location_id', loc.id);

    results.push({
      name: loc.name,
      hasActuals: (actualsCount ?? 0) > 0,
      hasLabor: (laborCount ?? 0) > 0,
      hasWeather: (weatherCount ?? 0) > 0,
      hasBudget: (budgetCount ?? 0) > 0,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Email HTML builder
// ---------------------------------------------------------------------------

function badge(status: 'green' | 'yellow' | 'red' | 'healthy' | 'stale' | 'empty' | 'failed' | 'unknown'): string {
  const colors: Record<string, { bg: string; text: string; label: string }> = {
    green: { bg: '#dcfce7', text: '#166534', label: 'All Systems Go' },
    yellow: { bg: '#fef9c3', text: '#854d0e', label: 'Degraded' },
    red: { bg: '#fee2e2', text: '#991b1b', label: 'Critical' },
    healthy: { bg: '#dcfce7', text: '#166534', label: 'Healthy' },
    stale: { bg: '#fef9c3', text: '#854d0e', label: 'Stale' },
    empty: { bg: '#fee2e2', text: '#991b1b', label: 'Empty' },
    failed: { bg: '#fee2e2', text: '#991b1b', label: 'Failed' },
    unknown: { bg: '#f3f4f6', text: '#6b7280', label: 'Unknown' },
  };
  const c = colors[status] ?? colors.unknown;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${c.bg};color:${c.text};">${c.label}</span>`;
}

function check(ok: boolean): string {
  return ok ? '<span style="color:#16a34a;">&#10003;</span>' : '<span style="color:#dc2626;">&#10007;</span>';
}

function formatSyncTime(ts: string | null): string {
  if (!ts) return '<span style="color:#9ca3af;">Never</span>';
  const d = new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function th(text: string): string {
  return `<th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.05em;border-bottom:2px solid #e5e7eb;">${text}</th>`;
}

function td(text: string, align = 'left'): string {
  return `<td style="padding:8px 12px;font-size:13px;color:#374151;border-bottom:1px solid #f3f4f6;text-align:${align};">${text}</td>`;
}

function buildEmailHtml(
  overall: OverallStatus,
  dataSources: DataSourceRow[],
  cronJobs: CronJobRow[],
  locationHealth: LocationHealth[],
  alerts: string[],
): string {
  // Data Sources table
  const dsRows = dataSources
    .map(
      (ds) =>
        `<tr>${td(ds.source)}${td(ds.table)}${td(ds.records.toLocaleString(), 'right')}${td(formatSyncTime(ds.lastSync))}${td(badge(ds.status))}</tr>`,
    )
    .join('');

  // Cron Jobs table
  const cronRows = cronJobs
    .map(
      (cj) =>
        `<tr>${td(cj.job)}${td(formatSyncTime(cj.lastRun))}${td(cj.success ? 'Success' : 'Failed')}${td(badge(cj.status))}</tr>`,
    )
    .join('');

  // Location health table
  const locRows = locationHealth
    .map(
      (lh) =>
        `<tr>${td(lh.name)}${td(check(lh.hasActuals))}${td(check(lh.hasLabor))}${td(check(lh.hasWeather))}${td(check(lh.hasBudget))}</tr>`,
    )
    .join('');

  // Alerts section
  const alertsHtml =
    alerts.length > 0
      ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-top:24px;">
          <h3 style="color:#991b1b;margin:0 0 8px;font-size:15px;">Alerts</h3>
          <ul style="margin:0;padding-left:20px;">${alerts.map((a) => `<li style="color:#991b1b;font-size:13px;margin-bottom:4px;">${a}</li>`).join('')}</ul>
        </div>`
      : '<p style="color:#16a34a;font-size:13px;margin-top:24px;">No alerts. All systems operating normally.</p>';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;">
  <div style="max-width:700px;margin:0 auto;background:white;">
    <div style="background:#1e3a5f;padding:24px 32px;">
      <h1 style="color:white;margin:0;font-size:22px;font-weight:700;letter-spacing:0.5px;">HELIXO</h1>
      <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">System Diagnostics &mdash; ${formatDate()}</p>
    </div>
    <div style="padding:32px;">
      <div style="margin-bottom:24px;">
        <h2 style="color:#1e3a5f;margin:0 0 8px;font-size:18px;">Overall Status</h2>
        ${badge(overall)}
      </div>

      <h3 style="color:#1e3a5f;margin:24px 0 12px;font-size:15px;">Data Sources</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>${th('Source')}${th('Table')}${th('Records')}${th('Last Sync')}${th('Status')}</tr></thead>
        <tbody>${dsRows}</tbody>
      </table>

      <h3 style="color:#1e3a5f;margin:24px 0 12px;font-size:15px;">Cron Jobs</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>${th('Job')}${th('Last Run')}${th('Result')}${th('Status')}</tr></thead>
        <tbody>${cronRows}</tbody>
      </table>

      <h3 style="color:#1e3a5f;margin:24px 0 12px;font-size:15px;">Location Health (Yesterday)</h3>
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr>${th('Location')}${th('Actuals')}${th('Labor')}${th('Weather')}${th('Budget')}</tr></thead>
        <tbody>${locRows}</tbody>
      </table>

      ${alertsHtml}
    </div>
    <div style="border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center;">
      <p style="color:#9ca3af;font-size:11px;margin:0;">HELIXO &mdash; Performance Dashboard</p>
    </div>
  </div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Derive overall status + alerts
// ---------------------------------------------------------------------------

function deriveAlerts(
  dataSources: DataSourceRow[],
  cronJobs: CronJobRow[],
  locationHealth: LocationHealth[],
): { overall: OverallStatus; alerts: string[] } {
  const alerts: string[] = [];

  // Stale / empty data sources
  for (const ds of dataSources) {
    if (ds.status === 'empty') alerts.push(`${ds.source} (${ds.table}) has no records`);
    else if (ds.status === 'stale') alerts.push(`${ds.source} (${ds.table}) data is stale`);
  }

  // Failed cron jobs
  for (const cj of cronJobs) {
    if (cj.status === 'failed') alerts.push(`Cron job "${cj.job}" last run failed`);
    if (cj.status === 'unknown') alerts.push(`Cron job "${cj.job}" has never run`);
  }

  // Locations missing yesterday data
  for (const lh of locationHealth) {
    const missing: string[] = [];
    if (!lh.hasActuals) missing.push('actuals');
    if (!lh.hasLabor) missing.push('labor');
    if (missing.length > 0) alerts.push(`${lh.name} missing yesterday: ${missing.join(', ')}`);
  }

  const critical = dataSources.filter((d) => d.status === 'empty').length + cronJobs.filter((c) => c.status === 'failed').length;
  const warnings = dataSources.filter((d) => d.status === 'stale').length + cronJobs.filter((c) => c.status === 'unknown').length;

  let overall: OverallStatus = 'green';
  if (critical > 0) overall = 'red';
  else if (warnings > 2 || alerts.length > 5) overall = 'yellow';

  return { overall, alerts };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function sendDiagnosticsEmail(): Promise<{ sent: boolean; alertCount: number }> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn('[diagnostics-email] RESEND_API_KEY not set, skipping');
    return { sent: false, alertCount: 0 };
  }

  const sb = getSupabaseService();
  const yesterday = getYesterdayEST();

  const dataSources = await collectDataSources(sb, yesterday);
  const cronJobs = await collectCronJobs(sb);
  const locationHealth = await collectLocationHealth(sb, yesterday);
  const { overall, alerts } = deriveAlerts(dataSources, cronJobs, locationHealth);

  const todayStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const subject = `HELIXO | System Diagnostics | ${todayStr}`;
  const html = buildEmailHtml(overall, dataSources, cronJobs, locationHealth, alerts);

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [RECIPIENT], subject, html }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    console.error('[diagnostics-email] Resend error:', res.status, errBody);
    return { sent: false, alertCount: alerts.length };
  }

  console.log(`[diagnostics-email] Sent to ${RECIPIENT} — ${overall} — ${alerts.length} alerts`);
  return { sent: true, alertCount: alerts.length };
}
