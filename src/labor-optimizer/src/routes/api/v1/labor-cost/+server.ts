import { json, type RequestHandler } from '@sveltejs/kit';
import { getRealTimeMetrics, checkBudgetAlerts } from '$lib/server/domain/labor-cost/labor-cost.service';
import { getCollections } from '$lib/server/database';

export const GET: RequestHandler = async ({ url }) => {
  const locationId = url.searchParams.get('locationId');
  const date = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
  const includeAlerts = url.searchParams.get('alerts') === 'true';

  if (locationId) {
    const metrics = await getRealTimeMetrics(locationId, date);
    const alerts = includeAlerts ? await checkBudgetAlerts(date) : [];
    return json({ metrics, alerts }, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } });
  }

  // All locations summary
  const db = await getCollections();
  const locations = await db.locations.find({ isActive: true } as any);
  const allMetrics = [];

  for (const loc of locations) {
    const metrics = await getRealTimeMetrics(loc._id, date);
    allMetrics.push(metrics);
  }

  const alerts = includeAlerts ? await checkBudgetAlerts(date) : [];

  // Aggregate totals
  const totals = {
    totalScheduledHours: allMetrics.reduce((s, m) => s + m.scheduledHours, 0),
    totalScheduledCost: allMetrics.reduce((s, m) => s + m.scheduledCost, 0),
    totalRevenue: allMetrics.reduce((s, m) => s + (m.actualRevenue || 0), 0),
    totalOvertimeHours: allMetrics.reduce((s, m) => s + m.overtimeHours, 0),
    totalOvertimeCost: allMetrics.reduce((s, m) => s + m.overtimeCost, 0),
    locationsOverBudget: allMetrics.filter(m => m.status === 'over_budget').length,
    locationsWarning: allMetrics.filter(m => m.status === 'warning').length,
  };

  return json({ locations: allMetrics, totals, alerts }, { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } });
};
