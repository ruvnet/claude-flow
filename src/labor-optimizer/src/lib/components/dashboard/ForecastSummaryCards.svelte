<script lang="ts">
  /* Week comparison cards + AI vs Manager accuracy tracker + pre-submit summary.
     Placed above and below the forecast table. */

  interface Props {
    forecasts: any[];
    modelStats: any;
    managerAccuracySummary: any;
    trailing2Weeks: any[];
    sameWeekLastYear: any[];
    fmt: (n: number) => string;
    showPreSubmit: boolean;
    weekTotal: number;
  }

  let { forecasts, modelStats, managerAccuracySummary, trailing2Weeks, sameWeekLastYear, fmt, showPreSubmit, weekTotal }: Props = $props();

  // Comparison data
  const thisWeekTotal = $derived(forecasts.reduce((s, f) => s + (f.managerRevenue || f.suggestedRevenue || 0), 0));
  const lastWeekTotal = $derived(trailing2Weeks.length > 0 ? trailing2Weeks[0]?.total || 0 : 0);
  const lyWeekTotal = $derived(sameWeekLastYear.reduce((s: number, d: any) => s + (d.revenue || 0), 0));
  const budgetWeekTotal = $derived(forecasts.reduce((s, f) => s + (f.budgetRevenue || 0), 0));

  const thisWeekDailyAvg = $derived(forecasts.length > 0 ? thisWeekTotal / forecasts.length : 0);
  const lastWeekDailyAvg = $derived(trailing2Weeks.length > 0 && trailing2Weeks[0]?.days?.length > 0 ? lastWeekTotal / trailing2Weeks[0].days.length : 0);

  const peakDay = $derived.by(() => {
    if (forecasts.length === 0) return { label: '-', value: 0 };
    const best = forecasts.reduce((max, f) => (f.managerRevenue || f.suggestedRevenue) > (max.managerRevenue || max.suggestedRevenue) ? f : max, forecasts[0]);
    return { label: new Date(best.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }), value: best.managerRevenue || best.suggestedRevenue };
  });

  const lowDay = $derived.by(() => {
    if (forecasts.length === 0) return { label: '-', value: 0 };
    const worst = forecasts.reduce((min, f) => (f.managerRevenue || f.suggestedRevenue) < (min.managerRevenue || min.suggestedRevenue) ? f : min, forecasts[0]);
    return { label: new Date(worst.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' }), value: worst.managerRevenue || worst.suggestedRevenue };
  });

  function deltaPct(a: number, b: number): string {
    if (b === 0) return '-';
    const d = ((a - b) / b) * 100;
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
  }
  function deltaColor(a: number, b: number): string {
    if (b === 0) return '#6b7280';
    return a >= b ? '#16a34a' : '#dc2626';
  }

  // Model accuracy
  const aiMape = $derived(modelStats?.mape4w ?? null);
  const aiGrade = $derived(aiMape === null ? null : aiMape <= 5 ? 'A' : aiMape <= 8 ? 'B' : aiMape <= 12 ? 'C' : 'D');
  const mgrMape = $derived(managerAccuracySummary?.mape ?? null);
  const mgrGrade = $derived(managerAccuracySummary?.grade ?? null);

  // Weather summary for pre-submit
  const weatherSummary = $derived.by(() => {
    const conditions = forecasts.filter(f => f.weatherCondition).map(f => f.weatherCondition);
    if (conditions.length === 0) return 'No weather data';
    const unique = [...new Set(conditions)];
    return unique.slice(0, 3).join(', ');
  });

  const avgConfidence = $derived(forecasts.length > 0 ? forecasts.reduce((s, f) => s + (f.confidence || 0), 0) / forecasts.length : 0);
</script>

<!-- Comparison Dashboard Cards -->
{#if forecasts.length > 0 && !showPreSubmit}
<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
  <!-- This Week Total -->
  <div class="leo-card p-3">
    <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">This Week Total</div>
    <div class="text-lg font-bold text-[#1e3a5f]">{fmt(Math.round(thisWeekTotal))}</div>
    <div class="flex gap-3 mt-1">
      {#if lastWeekTotal > 0}<span class="text-xs" style="color: {deltaColor(thisWeekTotal, lastWeekTotal)};">vs LW: {deltaPct(thisWeekTotal, lastWeekTotal)}</span>{/if}
      {#if lyWeekTotal > 0}<span class="text-xs" style="color: {deltaColor(thisWeekTotal, lyWeekTotal)};">vs LY: {deltaPct(thisWeekTotal, lyWeekTotal)}</span>{/if}
    </div>
  </div>

  <!-- Daily Avg -->
  <div class="leo-card p-3">
    <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Avg Daily Revenue</div>
    <div class="text-lg font-bold text-[#1e3a5f]">{fmt(Math.round(thisWeekDailyAvg))}</div>
    {#if lastWeekDailyAvg > 0}<div class="text-xs mt-1" style="color: {deltaColor(thisWeekDailyAvg, lastWeekDailyAvg)};">vs LW: {deltaPct(thisWeekDailyAvg, lastWeekDailyAvg)}</div>{/if}
  </div>

  <!-- Peak Day -->
  <div class="leo-card p-3">
    <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Peak Day</div>
    <div class="text-lg font-bold text-[#1e3a5f]">{fmt(Math.round(peakDay.value))}</div>
    <div class="text-xs text-[#6b7280] mt-1">{peakDay.label}</div>
  </div>

  <!-- Low Day -->
  <div class="leo-card p-3">
    <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Low Day</div>
    <div class="text-lg font-bold text-[#1e3a5f]">{fmt(Math.round(lowDay.value))}</div>
    <div class="text-xs text-[#6b7280] mt-1">{lowDay.label}</div>
  </div>
</div>

{/if}

<!-- Pre-Submit Week Summary -->
{#if showPreSubmit && forecasts.length > 0}
<div class="leo-card p-4 mb-2" style="border: 2px solid #1e3a5f; background: #f8fafc;">
  <h4 class="text-sm font-semibold text-[#1e3a5f] mb-3">Week Summary</h4>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
    <div>
      <span class="text-xs text-[#6b7280]">Total Revenue</span>
      <div class="font-bold text-[#1e3a5f]">{fmt(Math.round(weekTotal))}</div>
    </div>
    {#if budgetWeekTotal > 0}
    <div>
      <span class="text-xs text-[#6b7280]">vs Budget</span>
      <div class="font-bold" style="color: {deltaColor(weekTotal, budgetWeekTotal)};">{deltaPct(weekTotal, budgetWeekTotal)} ({fmt(Math.round(weekTotal - budgetWeekTotal))})</div>
    </div>
    {/if}
    {#if lyWeekTotal > 0}
    <div>
      <span class="text-xs text-[#6b7280]">vs Last Year</span>
      <div class="font-bold" style="color: {deltaColor(weekTotal, lyWeekTotal)};">{deltaPct(weekTotal, lyWeekTotal)} ({fmt(Math.round(weekTotal - lyWeekTotal))})</div>
    </div>
    {/if}
    <div>
      <span class="text-xs text-[#6b7280]">Confidence</span>
      <div class="font-bold" style="color: {avgConfidence >= 0.7 ? '#16a34a' : avgConfidence >= 0.5 ? '#a16207' : '#dc2626'};">{(avgConfidence * 100).toFixed(0)}%</div>
    </div>
  </div>
  {#if weatherSummary !== 'No weather data'}
  <div class="text-xs text-[#6b7280] mt-2">Weather: {weatherSummary}</div>
  {/if}
</div>
{/if}
