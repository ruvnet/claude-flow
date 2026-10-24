/**
 * Pattern Analyzer -- identifies recurring demand patterns for SONA learning.
 *
 * In production, this integrates with:
 * - AgentDB HNSW for vector similarity search across day profiles
 * - SONA for adapting signal weights based on forecast accuracy
 * - ReasoningBank for storing discovered patterns
 */
import { getCollections } from '$lib/server/database';
import type { LaborCostSnapshot } from '$lib/types/LaborCost';

export interface DemandPattern {
  id: string;
  name: string;
  type: 'recurring' | 'anomaly' | 'trend';
  description: string;
  confidence: number;
  affectedDays: number[];  // days of week
  affectedMonths: number[]; // months
  impactPct: number;  // % impact on covers
  discoveredAt: string;
  sampleSize: number;
}

/** Analyze historical data to discover demand patterns */
export async function discoverPatterns(locationId: string): Promise<DemandPattern[]> {
  const db = await getCollections();
  const snapshots = await db.laborCosts.find(
    locationId ? { locationId } as any : {} as any
  );

  if (snapshots.length < 14) {
    return []; // Need at least 2 weeks of data
  }

  const patterns: DemandPattern[] = [];

  // Pattern 1: Day-of-week analysis
  const byDow = groupByDayOfWeek(snapshots);
  const overallAvg = snapshots.reduce((s, snap) => s + snap.totalRevenue, 0) / snapshots.length;

  for (const [dow, snaps] of Object.entries(byDow)) {
    const dayAvg = snaps.reduce((s, snap) => s + snap.totalRevenue, 0) / snaps.length;
    const impact = (dayAvg - overallAvg) / overallAvg;

    if (Math.abs(impact) > 0.10 && snaps.length >= 3) {
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const dayNum = parseInt(dow);

      patterns.push({
        id: crypto.randomUUID(),
        name: `${dayNames[dayNum]} ${impact > 0 ? 'Peak' : 'Dip'}`,
        type: 'recurring',
        description: `${dayNames[dayNum]}s average ${impact > 0 ? '+' : ''}${Math.round(impact * 100)}% vs overall average`,
        confidence: Math.min(0.9, 0.5 + snaps.length * 0.05),
        affectedDays: [dayNum],
        affectedMonths: [],
        impactPct: impact,
        discoveredAt: new Date().toISOString(),
        sampleSize: snaps.length,
      });
    }
  }

  // Pattern 2: Monthly/seasonal analysis
  const byMonth = groupByMonth(snapshots);
  for (const [month, snaps] of Object.entries(byMonth)) {
    const monthAvg = snaps.reduce((s, snap) => s + snap.totalRevenue, 0) / snaps.length;
    const impact = (monthAvg - overallAvg) / overallAvg;

    if (Math.abs(impact) > 0.10 && snaps.length >= 3) {
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const monthNum = parseInt(month);

      patterns.push({
        id: crypto.randomUUID(),
        name: `${monthNames[monthNum]} ${impact > 0 ? 'Season' : 'Slowdown'}`,
        type: 'recurring',
        description: `${monthNames[monthNum]} averages ${impact > 0 ? '+' : ''}${Math.round(impact * 100)}% vs overall`,
        confidence: Math.min(0.85, 0.4 + snaps.length * 0.05),
        affectedDays: [],
        affectedMonths: [monthNum],
        impactPct: impact,
        discoveredAt: new Date().toISOString(),
        sampleSize: snaps.length,
      });
    }
  }

  // Pattern 3: Revenue trend (growing or declining)
  if (snapshots.length >= 30) {
    const sorted = [...snapshots].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

    const firstAvg = firstHalf.reduce((s, snap) => s + snap.totalRevenue, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((s, snap) => s + snap.totalRevenue, 0) / secondHalf.length;
    const trend = (secondAvg - firstAvg) / firstAvg;

    if (Math.abs(trend) > 0.05) {
      patterns.push({
        id: crypto.randomUUID(),
        name: trend > 0 ? 'Growth Trend' : 'Decline Trend',
        type: 'trend',
        description: `Revenue ${trend > 0 ? 'growing' : 'declining'} ${Math.round(Math.abs(trend) * 100)}% period-over-period`,
        confidence: Math.min(0.8, 0.5 + snapshots.length * 0.01),
        affectedDays: [],
        affectedMonths: [],
        impactPct: trend,
        discoveredAt: new Date().toISOString(),
        sampleSize: snapshots.length,
      });
    }
  }

  return patterns.sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));
}

function groupByDayOfWeek(snapshots: LaborCostSnapshot[]): Record<number, LaborCostSnapshot[]> {
  const groups: Record<number, LaborCostSnapshot[]> = {};
  for (const snap of snapshots) {
    const dow = new Date(snap.periodStart + 'T00:00:00').getDay();
    if (!groups[dow]) groups[dow] = [];
    groups[dow].push(snap);
  }
  return groups;
}

function groupByMonth(snapshots: LaborCostSnapshot[]): Record<number, LaborCostSnapshot[]> {
  const groups: Record<number, LaborCostSnapshot[]> = {};
  for (const snap of snapshots) {
    const month = new Date(snap.periodStart + 'T00:00:00').getMonth();
    if (!groups[month]) groups[month] = [];
    groups[month].push(snap);
  }
  return groups;
}
