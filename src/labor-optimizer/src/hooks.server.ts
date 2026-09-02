import * as Sentry from '@sentry/sveltekit';
import { json, type Handle } from '@sveltejs/kit';
import { getSupabaseService } from '$lib/server/supabase';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.VERCEL_ENV || 'development',
    tracesSampleRate: 0.1, // 10% of requests
    beforeSend(event) {
      // Don't send in development
      if (!process.env.VERCEL) return null;
      return event;
    },
  });
}

export const handleError = Sentry.handleErrorWithSentry();

/**
 * Server hook: guard all /api/v1/admin/* routes with Supabase JWT auth.
 * CRON_SECRET bearer token is also accepted for server-to-server calls.
 * Read-only status endpoints (cron-status, data-sources, engine-audit) exempt.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const path = event.url.pathname;

  // Apply auth guard to admin endpoints (except safe read-only status checks)
  const EXEMPT_READONLY = [
    '/api/v1/admin/cron-status',
    '/api/v1/admin/data-sources',
    '/api/v1/admin/engine-audit',
    '/api/v1/admin/forecast-accuracy',
  ];

  if (path.startsWith('/api/v1/admin/') && !EXEMPT_READONLY.some(e => path.startsWith(e))) {
    const authHeader = event.request.headers.get('authorization') || '';
    const cronSecret = process.env.CRON_SECRET;

    // Allow CRON_SECRET for server-to-server calls
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      return resolve(event);
    }

    // Require Supabase JWT for UI-originated requests
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
    try {
      const sb = getSupabaseService();
      const { data: { user }, error } = await sb.auth.getUser(token);
      if (!user || error) {
        return json({ error: 'Unauthorized' }, { status: 401 });
      }
    } catch {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  return resolve(event);
};
