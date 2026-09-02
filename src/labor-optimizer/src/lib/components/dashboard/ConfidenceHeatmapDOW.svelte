<script lang="ts">
  interface Props {
    forecasts: any[];
  }

  let { forecasts }: Props = $props();

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // Map JS getDay() (0=Sun) to Mon-first index
  const jsToIdx: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };

  let dowConfidence = $derived.by(() => {
    const buckets: Record<number, { total: number; count: number }> = {};
    for (let i = 0; i < 7; i++) buckets[i] = { total: 0, count: 0 };

    for (const f of forecasts) {
      const dow = new Date(f.date + 'T12:00:00').getDay();
      const idx = jsToIdx[dow];
      if (idx != null && f.confidence != null) {
        buckets[idx].total += f.confidence;
        buckets[idx].count++;
      }
    }

    return dayNames.map((name, i) => {
      const b = buckets[i];
      const avg = b.count > 0 ? (b.total / b.count) * 100 : 0;
      return { name, avg: Math.round(avg), count: b.count };
    });
  });

  function cellColor(avg: number): string {
    if (avg >= 80) return '#16a34a';
    if (avg >= 60) return '#f59e0b';
    return '#ef4444';
  }

  function cellBg(avg: number): string {
    if (avg >= 80) return '#dcfce7';
    if (avg >= 60) return '#fef9c3';
    return '#fef2f2';
  }
</script>

{#if forecasts.length > 0}
<div class="leo-card mb-4">
  <div class="px-4 pt-3 pb-1">
    <h3 class="text-sm font-semibold" style="color: #1e3a5f;">Confidence by Day of Week</h3>
  </div>
  <div class="px-4 pb-3">
    <div class="grid grid-cols-7 gap-1">
      {#each dowConfidence as d}
        <div
          class="flex flex-col items-center justify-center rounded py-2"
          style="background: {d.count > 0 ? cellBg(d.avg) : '#f9fafb'}; border: 1px solid {d.count > 0 ? cellColor(d.avg) + '33' : '#e5e7eb'};"
        >
          <span class="text-xs font-medium" style="color: #374151;">{d.name}</span>
          {#if d.count > 0}
            <span class="text-sm font-bold" style="color: {cellColor(d.avg)};">{d.avg}%</span>
          {:else}
            <span class="text-xs" style="color: #d1d5db;">--</span>
          {/if}
        </div>
      {/each}
    </div>
  </div>
</div>
{/if}
