/**
 * Shared retry and failure-tracking helpers for HELIXO cron jobs.
 *
 * Usage:
 *   const result = await withRetry(() => riskyOperation(), { label: 'toast-sync' });
 *   await logCronResult(sb, 'toast_sync', results);
 *   await sendCronAlertIfNeeded(results, totalLocations);
 */

import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

interface RetryOpts {
  /** Human-readable label for log messages. */
  label?: string;
  /** Max attempts (default 2 = original + 1 retry). */
  maxAttempts?: number;
  /** Delay between retries in ms (default 5000). */
  delayMs?: number;
}

/**
 * Execute `fn` with automatic retry on failure.
 * Returns the result on success or throws the last error after exhausting retries.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const { label = 'operation', maxAttempts = 2, delayMs = 5000 } = opts;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      console.warn(`[cron] ${label} attempt ${attempt}/${maxAttempts} failed:`, (err as Error).message);
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Cron run logging (writes to system_health for dashboard visibility)
// ---------------------------------------------------------------------------

export interface CronLocationResult {
  location: string;
  status: 'success' | 'sent' | 'skipped' | 'error' | 'partial';
  error?: string;
  [key: string]: unknown;
}

/**
 * Persist the outcome of a cron run into `system_health` so the
 * cron-status endpoint and Data Source Map can display it.
 */
export async function logCronResult(
  sb: SupabaseClient,
  cronName: string,
  results: CronLocationResult[],
): Promise<void> {
  const succeeded = results.filter((r) => r.status === 'success' || r.status === 'sent').length;
  const failed = results.filter((r) => r.status === 'error').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const total = results.length;

  let overallStatus: 'healthy' | 'degraded' | 'down' = 'healthy';
  if (failed > 0 && failed < total) overallStatus = 'degraded';
  if (failed === total && total > 0) overallStatus = 'down';

  try {
    await sb.from('system_health').upsert(
      {
        component: cronName,
        status: overallStatus,
        last_check: new Date().toISOString(),
        details: {
          ranAt: new Date().toISOString(),
          total,
          succeeded,
          failed,
          skipped,
          errors: results
            .filter((r) => r.status === 'error')
            .map((r) => ({ location: r.location, error: r.error })),
        },
      },
      { onConflict: 'component' },
    );
  } catch (err) {
    console.error(`[cron] Failed to log cron result for ${cronName}:`, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Alert email when >50% of locations fail
// ---------------------------------------------------------------------------

const ALERT_RECIPIENT = process.env.CRON_ALERT_EMAIL || 'rr@methodco.com';
const RESEND_API_URL = 'https://api.resend.com/emails';

/**
 * If more than 50% of locations failed, send a single alert email
 * via Resend to the ops contact.
 */
export async function sendCronAlertIfNeeded(
  cronName: string,
  results: CronLocationResult[],
  totalLocations: number,
): Promise<boolean> {
  const failed = results.filter((r) => r.status === 'error');
  if (totalLocations === 0 || failed.length / totalLocations <= 0.5) return false;

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error('[cron] Cannot send alert — RESEND_API_KEY not configured');
    return false;
  }

  const failedNames = failed.map((f) => `  - ${f.location}: ${f.error ?? 'unknown'}`).join('\n');
  const body = [
    `HELIXO Cron Alert: ${cronName}`,
    '',
    `${failed.length} of ${totalLocations} locations failed (>${Math.round((failed.length / totalLocations) * 100)}%).`,
    '',
    'Failed locations:',
    failedNames,
    '',
    `Timestamp: ${new Date().toISOString()}`,
  ].join('\n');

  try {
    const res = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'HELIXO <notifications@helixokpi.com>',
        to: [ALERT_RECIPIENT],
        subject: `[HELIXO ALERT] ${cronName} — ${failed.length}/${totalLocations} locations failed`,
        text: body,
      }),
    });
    if (!res.ok) {
      console.error(`[cron] Alert email failed: ${res.status}`);
    }
    return res.ok;
  } catch (err) {
    console.error('[cron] Alert email send error:', (err as Error).message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Failure logging to system_learnings
// ---------------------------------------------------------------------------

/**
 * Log a cron failure to system_learnings for historical tracking.
 */
export async function logCronFailure(
  sb: SupabaseClient,
  cronName: string,
  locationName: string,
  error: string,
): Promise<void> {
  try {
    await sb.from('system_learnings').insert({
      location_id: null,
      category: 'forecast',
      learning: `[${cronName}] ${locationName}: ${error}`,
      source: cronName,
      confidence: 0.9,
    });
  } catch {
    // Non-critical
  }
}

/**
 * Check if the request is a Vercel cron retry (X-Vercel-Cron-Retry header).
 * Vercel automatically retries failed crons — this lets us detect retries
 * to potentially adjust behavior (e.g. skip alert on first failure).
 */
export function isVercelCronRetry(request: Request): boolean {
  return request.headers.get('x-vercel-cron-retry') === '1';
}
