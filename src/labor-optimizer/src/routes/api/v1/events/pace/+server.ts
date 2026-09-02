import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSupabaseService } from '$lib/server/supabase';
import { getCached, setCache } from '$lib/server/cache';

export const GET: RequestHandler = async ({ url }) => {
  const sb = getSupabaseService();
  const locationId = url.searchParams.get('locationId');
  const yearParam = url.searchParams.get('year');
  const monthParam = url.searchParams.get('month');

  if (!locationId) {
    return json({ error: 'locationId required' }, { status: 400 });
  }

  const now = new Date();
  const year = yearParam ? Number(yearParam) : now.getFullYear();
  // If month specified, show just that month; otherwise show full year
  const monthStart = monthParam ? Number(monthParam) : 1;
  const monthEnd = monthParam ? Number(monthParam) : 12;

  const cacheKey = `events-pace:${locationId}:${year}:${monthParam || 'all'}`;
  const cached = getCached<any>(cacheKey);
  if (cached) return json(cached);

  // Date ranges
  const startDate = `${year}-${String(monthStart).padStart(2, '0')}-01`;
  const endMonth = monthEnd === 12 ? `${year + 1}-01-01` : `${year}-${String(monthEnd + 1).padStart(2, '0')}-01`;

  // STLY: same date range last year
  const stlyStartDate = `${year - 1}-${String(monthStart).padStart(2, '0')}-01`;
  const stlyEndDate = monthEnd === 12 ? `${year}-01-01` : `${year - 1}-${String(monthEnd + 1).padStart(2, '0')}-01`;

  // STLM: previous month
  const stlmMonth = monthParam ? Number(monthParam) - 1 : now.getMonth(); // 0-indexed for prev month
  const stlmYear = stlmMonth <= 0 ? year - 1 : year;
  const stlmMonthAdj = stlmMonth <= 0 ? 12 : stlmMonth;

  // Parallel queries
  const [eventsRes, stlyRes, budgetRes, leadsRes] = await Promise.all([
    // Current year events
    sb.from('tripleseat_events')
      .select('*')
      .eq('location_id', locationId)
      .gte('event_date', startDate)
      .lt('event_date', endMonth)
      .order('event_date'),
    // STLY events (same period last year)
    sb.from('tripleseat_events')
      .select('status, total_revenue, guest_count, event_type, event_date')
      .eq('location_id', locationId)
      .gte('event_date', stlyStartDate)
      .lt('event_date', stlyEndDate),
    // Budgets
    sb.from('event_revenue_budget')
      .select('*')
      .eq('location_id', locationId)
      .eq('year', year)
      .gte('month', monthStart)
      .lte('month', monthEnd),
    // Leads for the date range
    sb.from('tripleseat_leads')
      .select('*')
      .eq('location_id', locationId)
      .gte('created_at', startDate)
      .lt('created_at', endMonth),
  ]);

  const events = eventsRes.data || [];
  const stlyEvents = stlyRes.data || [];
  const budgets = budgetRes.data || [];
  const leads = leadsRes.data || [];

  // --- Build PACE by month ---
  const paceByMonth: any[] = [];

  for (let m = monthStart; m <= monthEnd; m++) {
    const mStr = String(m).padStart(2, '0');
    const monthEvents = events.filter((e: any) => {
      const em = e.event_date?.substring(5, 7);
      return em === mStr;
    });
    const stlyMonthEvents = stlyEvents.filter((e: any) => {
      const em = e.event_date?.substring(5, 7);
      return em === mStr;
    });

    const byStatus = (status: string) => {
      const filtered = monthEvents.filter((e: any) => e.status === status);
      return {
        count: filtered.length,
        revenue: filtered.reduce((s: number, e: any) => s + (e.total_revenue || 0), 0),
        covers: filtered.reduce((s: number, e: any) => s + (e.guest_count || 0), 0),
      };
    };

    const definite = byStatus('DEFINITE');
    const tentative = byStatus('TENTATIVE');
    const prospect = byStatus('PROSPECT');
    const closed = byStatus('CLOSED');

    // OTB = definite + closed (revenue that's confirmed)
    const totalOTB = definite.revenue + closed.revenue;

    // STLY = definite + closed from same month last year
    const stlyOTB = stlyMonthEvents
      .filter((e: any) => e.status === 'DEFINITE' || e.status === 'CLOSED')
      .reduce((s: number, e: any) => s + (e.total_revenue || 0), 0);

    // Budget
    const monthBudget = budgets.find((b: any) => b.month === m);
    const budgetTotal = monthBudget?.total_budget || 0;

    // Revenue by category
    const sumCategory = (field: string) =>
      monthEvents
        .filter((e: any) => e.status === 'DEFINITE' || e.status === 'CLOSED')
        .reduce((s: number, e: any) => s + (e[field] || 0), 0);

    paceByMonth.push({
      year,
      month: m,
      definite,
      tentative,
      prospect,
      closed,
      totalOTB,
      budget: budgetTotal,
      varianceToBudget: budgetTotal ? totalOTB - budgetTotal : null,
      varianceToBudgetPct: budgetTotal ? ((totalOTB - budgetTotal) / budgetTotal) * 100 : null,
      stly: stlyOTB,
      varianceToSTLY: stlyOTB ? totalOTB - stlyOTB : null,
      varianceToSTLYPct: stlyOTB ? ((totalOTB - stlyOTB) / stlyOTB) * 100 : null,
      revenueByCategory: {
        food: sumCategory('food_revenue'),
        beverage: sumCategory('beverage_revenue'),
        rental: sumCategory('rental_revenue'),
        av: sumCategory('av_revenue'),
        other: sumCategory('other_revenue'),
      },
    });
  }

  // --- STLM (previous month vs current) ---
  // Get previous month's OTB from the pace data if available, or query
  let stlmOTB = 0;
  if (monthParam) {
    const { data: stlmEvents } = await sb.from('tripleseat_events')
      .select('status, total_revenue')
      .eq('location_id', locationId)
      .gte('event_date', `${stlmYear}-${String(stlmMonthAdj).padStart(2, '0')}-01`)
      .lt('event_date', stlmMonthAdj === 12
        ? `${stlmYear + 1}-01-01`
        : `${stlmYear}-${String(stlmMonthAdj + 1).padStart(2, '0')}-01`);
    stlmOTB = (stlmEvents || [])
      .filter((e: any) => e.status === 'DEFINITE' || e.status === 'CLOSED')
      .reduce((s: number, e: any) => s + (e.total_revenue || 0), 0);

    if (paceByMonth.length === 1) {
      paceByMonth[0].stlm = stlmOTB;
      paceByMonth[0].varianceToSTLM = stlmOTB ? paceByMonth[0].totalOTB - stlmOTB : null;
      paceByMonth[0].varianceToSTLMPct = stlmOTB
        ? ((paceByMonth[0].totalOTB - stlmOTB) / stlmOTB) * 100 : null;
    }
  }

  // --- By Event Type ---
  const confirmedEvents = events.filter((e: any) =>
    e.status === 'DEFINITE' || e.status === 'CLOSED' || e.status === 'TENTATIVE'
  );
  const typeMap = new Map<string, { count: number; revenue: number; covers: number }>();
  for (const evt of confirmedEvents) {
    const type = (evt as any).event_type || 'Other';
    const entry = typeMap.get(type) || { count: 0, revenue: 0, covers: 0 };
    entry.count++;
    entry.revenue += (evt as any).total_revenue || 0;
    entry.covers += (evt as any).guest_count || 0;
    typeMap.set(type, entry);
  }
  const byEventType = Array.from(typeMap.entries())
    .map(([type, data]) => ({
      type,
      count: data.count,
      revenue: data.revenue,
      avgRevenue: data.count ? Math.round(data.revenue / data.count) : 0,
      avgCovers: data.count ? Math.round(data.covers / data.count) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  // --- Lead Metrics ---
  const respondedLeads = leads.filter((l: any) => l.first_responded_at);
  const convertedLeads = leads.filter((l: any) => l.converted_at);
  const responseTimes = leads
    .filter((l: any) => l.response_time_hours != null)
    .map((l: any) => l.response_time_hours);

  const leadMetrics = {
    totalLeads: leads.length,
    responded: respondedLeads.length,
    responseRate: leads.length ? (respondedLeads.length / leads.length) * 100 : 0,
    avgResponseTimeHours: responseTimes.length
      ? Math.round((responseTimes.reduce((s: number, h: number) => s + h, 0) / responseTimes.length) * 10) / 10
      : null,
    conversionRate: leads.length ? (convertedLeads.length / leads.length) * 100 : 0,
    convertedCount: convertedLeads.length,
  };

  // --- KPI Summary ---
  const allOTB = confirmedEvents;
  const totalRevenue = allOTB.reduce((s: number, e: any) => s + (e.total_revenue || 0), 0);
  const totalCovers = allOTB.reduce((s: number, e: any) => s + (e.guest_count || 0), 0);

  const kpiSummary = {
    revenuePerCover: totalCovers ? Math.round((totalRevenue / totalCovers) * 100) / 100 : 0,
    avgCheckPerEvent: allOTB.length ? Math.round(totalRevenue / allOTB.length) : 0,
    totalCovers,
    totalEvents: allOTB.length,
    definiteCount: events.filter((e: any) => e.status === 'DEFINITE').length,
    tentativeCount: events.filter((e: any) => e.status === 'TENTATIVE').length,
    prospectCount: events.filter((e: any) => e.status === 'PROSPECT').length,
    closedCount: events.filter((e: any) => e.status === 'CLOSED').length,
  };

  // --- Top 3 Events by revenue ---
  const topEvents = events
    .filter((e: any) => e.status === 'DEFINITE' || e.status === 'CLOSED')
    .sort((a: any, b: any) => (b.total_revenue || 0) - (a.total_revenue || 0))
    .slice(0, 3)
    .map((e: any) => ({
      name: e.event_name || 'Unnamed Event',
      type: e.event_type || 'Other',
      revenue: e.total_revenue || 0,
      grandTotal: e.grand_total || 0,
      date: e.event_date,
      covers: e.guest_count || 0,
      status: e.status,
      contactName: e.contact_name || null,
      accountName: e.account_name || null,
      salesManager: e.sales_manager || null,
      roomName: e.room_name || null,
      foodRevenue: e.food_revenue || 0,
      beverageRevenue: e.beverage_revenue || 0,
      rentalRevenue: e.rental_revenue || 0,
      avRevenue: e.av_revenue || 0,
      otherRevenue: e.other_revenue || 0,
      serviceCharge: e.service_charge || 0,
      tax: e.tax || 0,
    }));

  // --- Deposits / AR Section ---
  // Total invoiced = grand_total for confirmed events
  const confirmedFull = events.filter((e: any) => e.status === 'DEFINITE' || e.status === 'CLOSED');
  const totalInvoiced = confirmedFull.reduce((s: number, e: any) => s + (e.grand_total || e.total_revenue || 0), 0);
  const totalContracted = confirmedFull.reduce((s: number, e: any) => s + (e.total_revenue || 0), 0);
  const totalServiceCharge = confirmedFull.reduce((s: number, e: any) => s + (e.service_charge || 0), 0);
  const totalTax = confirmedFull.reduce((s: number, e: any) => s + (e.tax || 0), 0);
  // Outstanding = invoiced for future/upcoming DEFINITE events (not yet occurred)
  const today = new Date().toISOString().split('T')[0];
  const upcomingDefinite = confirmedFull.filter((e: any) => e.status === 'DEFINITE' && e.event_date >= today);
  const outstandingAR = upcomingDefinite.reduce((s: number, e: any) => s + (e.grand_total || e.total_revenue || 0), 0);
  const depositsSection = {
    totalInvoiced,
    totalContracted,
    totalServiceCharge,
    totalTax,
    outstandingAR,
    upcomingEventCount: upcomingDefinite.length,
    note: 'Outstanding AR = grand totals for future confirmed events. Actual deposit tracking requires payment sync.',
  };

  const response = { paceByMonth, byEventType, leadMetrics, kpiSummary, topEvents, depositsSection };
  setCache(cacheKey, response, 300); // 5 min cache
  return json(response);
};
