import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService, ALL_POSITIONS } from '$lib/server/supabase';

export const config = { maxDuration: 120 };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Severity = 'warning' | 'error';
type CheckResult = 'pass' | 'fail';

interface Issue {
  type: string;
  details: string;
  severity: Severity;
}

interface LocationReport {
  name: string;
  locationId: string;
  issues: Issue[];
  checks: {
    revenueWithoutLabor: CheckResult;
    laborRatio: CheckResult;
    dowWeights: CheckResult;
    periodCoverage: CheckResult;
    hourlySales: CheckResult;
  };
}

interface ReconciliationResponse {
  summary: {
    locationsChecked: number;
    totalIssues: number;
    issuesByType: Record<string, number>;
  };
  locations: LocationReport[];
}

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

function isAuthorized(request: Request, url: URL): boolean {
  const adminKey = url.searchParams.get('adminKey');
  if (adminKey === 'helixo-admin-2026') return true;

  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return true;

  return false;
}

// ---------------------------------------------------------------------------
// GET /api/v1/admin/reconciliation
// ---------------------------------------------------------------------------

export const GET: RequestHandler = async ({ request, url }) => {
  if (!isAuthorized(request, url)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const sb = getSupabaseService();
  const today = new Date().toISOString().slice(0, 10);

  // Fetch active locations
  const { data: locations, error: locErr } = await sb
    .from('locations')
    .select('id, name')
    .eq('is_active', true)
    .order('name');

  if (locErr || !locations) {
    return json({ error: 'Failed to query locations', details: locErr?.message }, { status: 500 });
  }

  const reports: LocationReport[] = [];

  for (const loc of locations) {
    const issues: Issue[] = [];
    const checks = {
      revenueWithoutLabor: 'pass' as CheckResult,
      laborRatio: 'pass' as CheckResult,
      dowWeights: 'pass' as CheckResult,
      periodCoverage: 'pass' as CheckResult,
      hourlySales: 'pass' as CheckResult,
    };

    // ------------------------------------------------------------------
    // Check 1: Revenue without Labor
    // ------------------------------------------------------------------
    try {
      // Get dates with revenue > 0
      const { data: revDates } = await sb
        .from('daily_actuals')
        .select('business_date')
        .eq('location_id', loc.id)
        .gt('revenue', 0)
        .order('business_date', { ascending: false })
        .limit(90);

      if (revDates && revDates.length > 0) {
        const dates = revDates.map((r: { business_date: string }) => r.business_date);

        // Get dates that have labor rows
        const { data: laborDates } = await sb
          .from('daily_labor')
          .select('business_date')
          .eq('location_id', loc.id)
          .in('business_date', dates);

        const laborDateSet = new Set(
          (laborDates ?? []).map((l: { business_date: string }) => l.business_date),
        );
        const missing = dates.filter((d: string) => !laborDateSet.has(d));

        if (missing.length > 0) {
          checks.revenueWithoutLabor = 'fail';
          issues.push({
            type: 'revenueWithoutLabor',
            details: `${missing.length} date(s) have revenue but no labor data. Most recent: ${missing.slice(0, 5).join(', ')}`,
            severity: missing.length > 7 ? 'error' : 'warning',
          });
        }
      }
    } catch {
      issues.push({
        type: 'revenueWithoutLabor',
        details: 'Query failed',
        severity: 'error',
      });
      checks.revenueWithoutLabor = 'fail';
    }

    // ------------------------------------------------------------------
    // Check 2: Labor Ratio outliers
    // ------------------------------------------------------------------
    try {
      // Get recent daily_actuals with revenue
      const { data: actuals } = await sb
        .from('daily_actuals')
        .select('business_date, revenue')
        .eq('location_id', loc.id)
        .gt('revenue', 0)
        .order('business_date', { ascending: false })
        .limit(60);

      if (actuals && actuals.length > 0) {
        const dateList = actuals.map((a: { business_date: string }) => a.business_date);

        // Aggregate labor dollars per date
        const { data: laborAgg } = await sb
          .from('daily_labor')
          .select('business_date, labor_dollars')
          .eq('location_id', loc.id)
          .in('business_date', dateList);

        const laborByDate = new Map<string, number>();
        for (const row of laborAgg ?? []) {
          const cur = laborByDate.get(row.business_date) ?? 0;
          laborByDate.set(row.business_date, cur + (row.labor_dollars ?? 0));
        }

        const outliers: string[] = [];
        for (const a of actuals) {
          const labor = laborByDate.get(a.business_date);
          if (labor == null || a.revenue == null || a.revenue === 0) continue;
          const ratio = labor / a.revenue;
          if (ratio < 0.10 || ratio > 0.50) {
            outliers.push(`${a.business_date} (${(ratio * 100).toFixed(1)}%)`);
          }
        }

        if (outliers.length > 0) {
          checks.laborRatio = 'fail';
          issues.push({
            type: 'laborRatio',
            details: `${outliers.length} date(s) with extreme labor ratio (<10% or >50%). Examples: ${outliers.slice(0, 5).join(', ')}`,
            severity: outliers.length > 5 ? 'error' : 'warning',
          });
        }
      }
    } catch {
      issues.push({ type: 'laborRatio', details: 'Query failed', severity: 'error' });
      checks.laborRatio = 'fail';
    }

    // ------------------------------------------------------------------
    // Check 3: DOW Weight Coverage
    // ------------------------------------------------------------------
    try {
      const { data: weights } = await sb
        .from('dow_weights')
        .select('position, day_of_week')
        .eq('location_id', loc.id);

      const existing = new Set(
        (weights ?? []).map(
          (w: { position: string; day_of_week: number }) => `${w.position}|${w.day_of_week}`,
        ),
      );

      const missingCombos: string[] = [];
      for (const pos of ALL_POSITIONS) {
        for (let dow = 0; dow <= 6; dow++) {
          if (!existing.has(`${pos}|${dow}`)) {
            missingCombos.push(`${pos}/day${dow}`);
          }
        }
      }

      if (missingCombos.length > 0) {
        checks.dowWeights = 'fail';
        issues.push({
          type: 'dowWeights',
          details: `${missingCombos.length} missing position/day weight(s). Examples: ${missingCombos.slice(0, 8).join(', ')}`,
          severity: missingCombos.length > 20 ? 'error' : 'warning',
        });
      }
    } catch {
      issues.push({ type: 'dowWeights', details: 'Query failed', severity: 'error' });
      checks.dowWeights = 'fail';
    }

    // ------------------------------------------------------------------
    // Check 4: Period Coverage
    // ------------------------------------------------------------------
    try {
      const { data: periods } = await sb
        .from('periods')
        .select('period_number, start_date, end_date')
        .eq('location_id', loc.id)
        .eq('year', 2026)
        .order('period_number');

      if (periods && periods.length > 0) {
        const gapPeriods: string[] = [];

        for (const p of periods) {
          // Only check dates up to today
          const effectiveEnd = p.end_date <= today ? p.end_date : today;
          if (p.start_date > today) continue; // future period

          // Count expected days
          const start = new Date(p.start_date);
          const end = new Date(effectiveEnd);
          let expectedDays = 0;
          for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
            expectedDays++;
          }

          // Count actual days with revenue data
          const { count } = await sb
            .from('daily_actuals')
            .select('id', { count: 'exact', head: true })
            .eq('location_id', loc.id)
            .gte('business_date', p.start_date)
            .lte('business_date', effectiveEnd);

          const actualDays = count ?? 0;
          if (actualDays < expectedDays) {
            gapPeriods.push(
              `P${p.period_number} (${expectedDays - actualDays} missing of ${expectedDays})`,
            );
          }
        }

        if (gapPeriods.length > 0) {
          checks.periodCoverage = 'fail';
          issues.push({
            type: 'periodCoverage',
            details: `${gapPeriods.length} period(s) with data gaps: ${gapPeriods.join(', ')}`,
            severity: gapPeriods.length > 3 ? 'error' : 'warning',
          });
        }
      }
    } catch {
      issues.push({ type: 'periodCoverage', details: 'Query failed', severity: 'error' });
      checks.periodCoverage = 'fail';
    }

    // ------------------------------------------------------------------
    // Check 5: Hourly Sales Consistency (sample 7 recent dates)
    // ------------------------------------------------------------------
    try {
      const { data: recentActuals } = await sb
        .from('daily_actuals')
        .select('business_date, revenue')
        .eq('location_id', loc.id)
        .gt('revenue', 0)
        .order('business_date', { ascending: false })
        .limit(7);

      if (recentActuals && recentActuals.length > 0) {
        const sampleDates = recentActuals.map(
          (a: { business_date: string }) => a.business_date,
        );

        const { data: hourlyRows } = await sb
          .from('daily_hourly_sales')
          .select('business_date, revenue')
          .eq('location_id', loc.id)
          .in('business_date', sampleDates);

        // Sum hourly revenue per date
        const hourlyByDate = new Map<string, number>();
        for (const h of hourlyRows ?? []) {
          const cur = hourlyByDate.get(h.business_date) ?? 0;
          hourlyByDate.set(h.business_date, cur + (h.revenue ?? 0));
        }

        const mismatches: string[] = [];
        for (const a of recentActuals) {
          const hourlyTotal = hourlyByDate.get(a.business_date);
          if (hourlyTotal == null) continue; // no hourly data, skip
          if (a.revenue == null || a.revenue === 0) continue;
          const diff = Math.abs(hourlyTotal - a.revenue) / a.revenue;
          if (diff > 0.05) {
            mismatches.push(
              `${a.business_date} (${(diff * 100).toFixed(1)}% diff)`,
            );
          }
        }

        if (mismatches.length > 0) {
          checks.hourlySales = 'fail';
          issues.push({
            type: 'hourlySales',
            details: `${mismatches.length} date(s) where hourly sales sum differs >5% from daily actual: ${mismatches.join(', ')}`,
            severity: mismatches.length > 3 ? 'error' : 'warning',
          });
        }
      }
    } catch {
      issues.push({ type: 'hourlySales', details: 'Query failed', severity: 'error' });
      checks.hourlySales = 'fail';
    }

    reports.push({ name: loc.name, locationId: loc.id, issues, checks });
  }

  // ------------------------------------------------------------------
  // Build summary
  // ------------------------------------------------------------------
  const issuesByType: Record<string, number> = {};
  let totalIssues = 0;
  for (const r of reports) {
    for (const issue of r.issues) {
      issuesByType[issue.type] = (issuesByType[issue.type] ?? 0) + 1;
      totalIssues++;
    }
  }

  const response: ReconciliationResponse = {
    summary: {
      locationsChecked: reports.length,
      totalIssues,
      issuesByType,
    },
    locations: reports,
  };

  return json(response);
};
