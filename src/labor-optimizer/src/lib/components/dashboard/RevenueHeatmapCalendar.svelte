<script lang="ts">
  interface Props {
    forecasts: any[];
    fmt: (n: number) => string;
  }

  let { forecasts, fmt }: Props = $props();

  // Build 4-week calendar grid (Mon-Sun columns)
  let calendarWeeks = $derived.by(() => {
    if (!forecasts.length) return [];
    const sorted = [...forecasts].sort((a, b) => a.date.localeCompare(b.date));
    const firstDate = new Date(sorted[0].date + 'T12:00:00');
    // Find the Monday on or before the first date
    const dow = firstDate.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const startMon = new Date(firstDate);
    startMon.setDate(startMon.getDate() + diffToMon);

    const dateMap = new Map<string, any>();
    for (const f of sorted) {
      dateMap.set(f.date, f);
    }

    const weeks: { date: string; forecast: any | null; dayOfMonth: number }[][] = [];
    let current = new Date(startMon);
    const lastDate = new Date(sorted[sorted.length - 1].date + 'T12:00:00');
    // Extend to the Sunday after the last date
    const lastDow = lastDate.getDay();
    const daysToSun = lastDow === 0 ? 0 : 7 - lastDow;
    const endSun = new Date(lastDate);
    endSun.setDate(endSun.getDate() + daysToSun);

    while (current <= endSun) {
      const week: { date: string; forecast: any | null; dayOfMonth: number }[] = [];
      for (let d = 0; d < 7; d++) {
        const dateStr = current.toISOString().split('T')[0];
        week.push({
          date: dateStr,
          forecast: dateMap.get(dateStr) ?? null,
          dayOfMonth: current.getDate(),
        });
        current.setDate(current.getDate() + 1);
      }
      weeks.push(week);
    }
    return weeks;
  });

  function heatColor(rev: number | null): string {
    if (rev == null) return '#ffffff';
    if (rev < 8000) return '#dbeafe';
    if (rev < 15000) return '#60a5fa';
    if (rev < 20000) return '#1e3a5f';
    return '#0f1d32';
  }

  function textColor(rev: number | null): string {
    if (rev == null) return '#9ca3af';
    if (rev < 8000) return '#1e3a5f';
    return '#ffffff';
  }

  function hasBorder(rev: number | null): boolean {
    return rev == null;
  }

  function hasActual(f: any): boolean {
    return f && f.actualRevenue != null && f.actualRevenue > 0;
  }

  const dayHeaders = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
</script>

<div class="leo-card mb-4">
  <div class="px-3 pt-3 pb-1 flex items-center justify-between">
    <h3 class="text-xs font-semibold" style="color: #1e3a5f;">Revenue Heatmap</h3>
    <div class="flex items-center gap-2 flex-wrap">
      <div class="flex items-center gap-1"><span style="width:10px;height:10px;border-radius:2px;background:#dbeafe;display:inline-block;border:1px solid #d1d5db;"></span><span class="text-xs" style="color:#9ca3af;">&lt;$8K</span></div>
      <div class="flex items-center gap-1"><span style="width:10px;height:10px;border-radius:2px;background:#60a5fa;display:inline-block;"></span><span class="text-xs" style="color:#9ca3af;">$8-15K</span></div>
      <div class="flex items-center gap-1"><span style="width:10px;height:10px;border-radius:2px;background:#1e3a5f;display:inline-block;"></span><span class="text-xs" style="color:#9ca3af;">$15-20K</span></div>
      <div class="flex items-center gap-1"><span style="width:10px;height:10px;border-radius:2px;background:#0f1d32;display:inline-block;"></span><span class="text-xs" style="color:#9ca3af;">&gt;$20K</span></div>
    </div>
  </div>
  <div class="px-3 pb-2">
    <!-- Day headers -->
    <div class="grid grid-cols-7 gap-0.5 mb-0.5">
      {#each dayHeaders as dh}
        <div class="text-center" style="font-size:10px;color:#9ca3af;">{dh}</div>
      {/each}
    </div>
    <!-- Calendar grid -->
    {#each calendarWeeks as week}
      <div class="grid grid-cols-7 gap-0.5 mb-0.5">
        {#each week as cell}
          {@const rev = cell.forecast?.suggestedRevenue ?? null}
          <div
            class="relative flex items-center justify-center rounded"
            style="
              height: 24px;
              background: {heatColor(rev)};
              {hasBorder(rev) ? 'border: 1px solid #e5e7eb;' : ''}
              cursor: {cell.forecast ? 'pointer' : 'default'};
            "
            title={cell.forecast ? `${cell.date}: ${fmt(Math.round(rev ?? 0))}` : cell.date}
          >
            <span style="font-size:10px;font-weight:500;color:{textColor(rev)};">{cell.dayOfMonth}</span>
            {#if hasActual(cell.forecast)}
              <span class="absolute" style="bottom:2px;right:2px;width:4px;height:4px;border-radius:50%;background:#16a34a;"></span>
            {/if}
          </div>
        {/each}
      </div>
    {/each}
  </div>
</div>
