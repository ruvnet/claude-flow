<script lang="ts">
  interface Props {
    forecasts: any[];
    locationId: string;
    fmt: (n: number) => string;
  }

  let { forecasts, locationId, fmt }: Props = $props();

  // Derive last 28 days of data from forecasts array
  // We use the full period's data, looking at days that have actuals (past days)
  let trendData = $derived.by(() => {
    if (!forecasts.length) return { points: [], hasData: false };

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const cutoff28 = new Date(today);
    cutoff28.setDate(cutoff28.getDate() - 28);
    const cutoffStr = cutoff28.toISOString().split('T')[0];
    const todayStr = today.toISOString().split('T')[0];

    // Filter to last 28 days with forecast data
    const recent = forecasts
      .filter(f => f.date >= cutoffStr && f.date <= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (recent.length < 3) return { points: [], hasData: false };

    return {
      points: recent.map(f => ({
        date: f.date,
        forecast: f.suggestedRevenue || 0,
        actual: f.actualRevenue ?? null,
        budget: f.budgetRevenue ?? null,
      })),
      hasData: true,
    };
  });

  // SVG dimensions
  const W = 300;
  const H = 60;
  const PAD = { t: 4, b: 4, l: 4, r: 4 };
  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;

  let pathData = $derived.by(() => {
    const pts = trendData.points;
    if (pts.length < 2) return { forecastPath: '', actualPath: '', budgetPath: '', converging: false };

    const allVals = pts.flatMap(p => [p.forecast, p.actual, p.budget].filter((v): v is number => v != null && v > 0));
    const maxVal = Math.max(...allVals, 1);
    const minVal = Math.min(...allVals.filter(v => v > 0), maxVal);
    const range = maxVal - minVal || 1;

    function toX(i: number): number { return PAD.l + (i / (pts.length - 1)) * plotW; }
    function toY(v: number): number { return PAD.t + plotH - ((v - minVal) / range) * plotH; }

    function buildPath(values: (number | null)[]): string {
      let path = '';
      let started = false;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (v == null || v <= 0) { started = false; continue; }
        if (!started) { path += `M${toX(i).toFixed(1)},${toY(v).toFixed(1)}`; started = true; }
        else { path += `L${toX(i).toFixed(1)},${toY(v).toFixed(1)}`; }
      }
      return path;
    }

    const forecastPath = buildPath(pts.map(p => p.forecast));
    const actualPath = buildPath(pts.map(p => p.actual));
    const budgetPath = buildPath(pts.map(p => p.budget));

    // Check convergence: compare last 7 days avg error vs first 7 days avg error
    const withBoth = pts.filter(p => p.actual != null && p.actual > 0);
    let converging = false;
    if (withBoth.length >= 10) {
      const firstHalf = withBoth.slice(0, Math.floor(withBoth.length / 2));
      const secondHalf = withBoth.slice(Math.floor(withBoth.length / 2));
      const errFirst = firstHalf.reduce((s, p) => s + Math.abs(p.forecast - (p.actual ?? 0)), 0) / firstHalf.length;
      const errSecond = secondHalf.reduce((s, p) => s + Math.abs(p.forecast - (p.actual ?? 0)), 0) / secondHalf.length;
      converging = errSecond < errFirst;
    }

    return { forecastPath, actualPath, budgetPath, converging };
  });
</script>

{#if trendData.hasData}
<div class="leo-card mb-4">
  <div class="px-4 pt-3 pb-1 flex items-center justify-between flex-wrap gap-2">
    <h3 class="text-sm font-semibold" style="color: #1e3a5f;">Forecast vs Actual (Rolling 4 Weeks)</h3>
    {#if pathData.converging}
      <span class="text-xs px-2 py-0.5 rounded font-medium" style="background: #dcfce7; color: #16a34a;">Converging -- AI Learning</span>
    {:else if trendData.points.filter(p => p.actual != null).length >= 10}
      <span class="text-xs px-2 py-0.5 rounded font-medium" style="background: #fef9c3; color: #a16207;">Diverging -- Review Signals</span>
    {/if}
  </div>
  <div class="px-4 pb-3">
    <svg viewBox="0 0 {W} {H}" style="width: 100%; max-width: 300px; height: 60px;" role="img" aria-label="Forecast vs actual trend sparkline">
      {#if pathData.budgetPath}
        <path d={pathData.budgetPath} fill="none" stroke="#9ca3af" stroke-width="1" stroke-dasharray="3,3" />
      {/if}
      {#if pathData.forecastPath}
        <path d={pathData.forecastPath} fill="none" stroke="#1e3a5f" stroke-width="1.5" />
      {/if}
      {#if pathData.actualPath}
        <path d={pathData.actualPath} fill="none" stroke="#16a34a" stroke-width="1.5" />
      {/if}
    </svg>
    <div class="flex items-center gap-4 mt-1">
      <div class="flex items-center gap-1"><span style="width:16px;height:2px;background:#1e3a5f;display:inline-block;"></span><span class="text-xs" style="color:#6b7280;">AI Forecast</span></div>
      <div class="flex items-center gap-1"><span style="width:16px;height:2px;background:#16a34a;display:inline-block;"></span><span class="text-xs" style="color:#6b7280;">Actual</span></div>
      <div class="flex items-center gap-1"><span style="width:16px;height:2px;background:#9ca3af;display:inline-block;border-top:1px dashed #9ca3af;"></span><span class="text-xs" style="color:#6b7280;">Budget</span></div>
    </div>
  </div>
</div>
{/if}
