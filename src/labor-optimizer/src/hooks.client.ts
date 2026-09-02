import * as Sentry from '@sentry/sveltekit';

if (typeof window !== 'undefined') {
  const dsn = document.querySelector('meta[name="sentry-dsn"]')?.getAttribute('content');
  if (dsn) {
    Sentry.init({
      dsn,
      environment: 'production',
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
    });
  }
}

export const handleError = Sentry.handleErrorWithSentry();
