/**
 * Toast POS Data Sync Service
 * Pulls revenue, covers, and labor data from Toast and stores locally.
 */
import { createToastClient } from './toast-client';
import { getCollections } from '$lib/server/database';
import type { LaborCostSnapshot, RoleLaborCost, DaypartLaborCost, Daypart } from '$lib/types/LaborCost';
import { laborCostPct, coversPerLaborHour, revenuePerLaborHour } from '$lib/utils/labor-math';

export interface SyncResult {
  date: string;
  revenue: number;
  covers: number;
  laborCost: number;
  laborPct: number;
  ordersProcessed: number;
  timeEntriesProcessed: number;
}

/** Classify an hour into a daypart */
function getDaypart(hour: number): Daypart {
  if (hour >= 6 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 15) return 'lunch';
  if (hour >= 15 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'dinner';
  return 'late_night';
}

/** Sync a single day's data from Toast POS */
export async function syncDay(date: string, restaurantGuid?: string): Promise<SyncResult | null> {
  const client = createToastClient();
  if (!client) {
    console.warn('[Toast Sync] No Toast client configured');
    return null;
  }

  try {
    // Pull revenue data
    const revenueSummary = await client.getRevenueSummary(date);

    // Pull labor data
    const laborSummary = await client.getLaborSummary(date);

    // Pull raw time entries for daypart breakdown
    const timeEntries = await client.getTimeEntries(date, date);

    // Build daypart breakdown from time entries
    const daypartMap: Record<Daypart, { hours: number; cost: number; revenue: number }> = {
      breakfast: { hours: 0, cost: 0, revenue: 0 },
      lunch: { hours: 0, cost: 0, revenue: 0 },
      afternoon: { hours: 0, cost: 0, revenue: 0 },
      dinner: { hours: 0, cost: 0, revenue: 0 },
      late_night: { hours: 0, cost: 0, revenue: 0 },
    };

    // Distribute time entries across dayparts based on clock-in hour
    for (const entry of timeEntries) {
      const inHour = new Date(entry.inDate).getHours();
      const daypart = getDaypart(inHour);
      const hours = entry.regularHours + entry.overtimeHours;
      const cost = entry.regularHours * entry.hourlyWage + entry.overtimeHours * entry.hourlyWage * 1.5;
      daypartMap[daypart].hours += hours;
      daypartMap[daypart].cost += cost;
    }

    // Distribute revenue proportionally across dayparts (simplified)
    const totalHours = Object.values(daypartMap).reduce((s, d) => s + d.hours, 0);
    if (totalHours > 0) {
      for (const dp of Object.keys(daypartMap) as Daypart[]) {
        daypartMap[dp].revenue = revenueSummary.totalRevenue * (daypartMap[dp].hours / totalHours);
      }
    }

    const byDaypart: DaypartLaborCost[] = (Object.entries(daypartMap) as [Daypart, typeof daypartMap[Daypart]][]).map(
      ([daypart, data]) => ({
        daypart,
        hours: data.hours,
        cost: data.cost,
        revenue: data.revenue,
        laborCostPct: data.revenue > 0 ? data.cost / data.revenue : 0,
      })
    );

    // Store snapshot
    const db = await getCollections();
    const snapshot: LaborCostSnapshot = {
      _id: crypto.randomUUID(),
      locationId: restaurantGuid || 'default',
      periodStart: date,
      periodEnd: date,
      totalLaborCost: laborSummary.totalLaborCost,
      totalRevenue: revenueSummary.totalRevenue,
      laborCostPct: laborCostPct(laborSummary.totalLaborCost, revenueSummary.totalRevenue),
      targetLaborCostPct: 0.28, // Will be pulled from location config
      variance: laborCostPct(laborSummary.totalLaborCost, revenueSummary.totalRevenue) - 0.28,
      overtimeCost: laborSummary.overtimeCost,
      regularCost: laborSummary.totalLaborCost - laborSummary.overtimeCost,
      totalHours: laborSummary.totalHours,
      overtimeHours: laborSummary.overtimeHours,
      coversPerLaborHour: coversPerLaborHour(revenueSummary.totalCovers, laborSummary.totalHours),
      revenuePerLaborHour: revenuePerLaborHour(revenueSummary.totalRevenue, laborSummary.totalHours),
      byRole: [], // Toast doesn't easily map to our roles without job mapping
      byDaypart,
      createdAt: new Date().toISOString(),
    };

    await db.laborCosts.insertOne(snapshot as any);

    return {
      date,
      revenue: revenueSummary.totalRevenue,
      covers: revenueSummary.totalCovers,
      laborCost: laborSummary.totalLaborCost,
      laborPct: snapshot.laborCostPct,
      ordersProcessed: revenueSummary.orderCount,
      timeEntriesProcessed: timeEntries.length,
    };
  } catch (error) {
    console.error(`[Toast Sync] Failed for ${date}:`, error);
    return null;
  }
}

/** Sync a date range (e.g., last 7 days for backfill) */
export async function syncDateRange(startDate: string, endDate: string): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  const start = new Date(startDate);
  const end = new Date(endDate);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    const result = await syncDay(dateStr);
    if (result) results.push(result);
  }

  return results;
}
