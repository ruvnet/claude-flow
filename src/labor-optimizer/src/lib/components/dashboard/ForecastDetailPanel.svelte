<script lang="ts">
  /* Expandable detail panel for a forecast day row.
     Shows: Revenue Breakdown, Confidence Factors, Risk Range,
     Historical Sparkline, Waterfall Chart, Override Impact Preview, Quick Scenarios. */

  import RevenueWaterfallChart from '$lib/components/dashboard/RevenueWaterfallChart.svelte';

  interface Props {
    f: any;
    overrideRevenue: number;
    overrideCovers: number;
    overrideMode: 'revenue' | 'covers';
    overrideTags: string[];
    overrideOtherNote: string;
    weekTotal: number;
    fmt: (n: number) => string;
    onAccept: () => void;
    onSubmitOverride: () => void;
    onCancel: () => void;
    onOverrideRevenueChange: (v: number) => void;
    onOverrideCoversChange: (v: number) => void;
    onOverrideModeChange: (m: 'revenue' | 'covers') => void;
    onToggleTag: (tag: string) => void;
    onOtherNoteChange: (v: string) => void;
    hasValidTags: () => boolean;
    isOverrideMode: boolean;
  }

  let { f, overrideRevenue, overrideCovers, overrideMode, overrideTags, overrideOtherNote,
    weekTotal, fmt, onAccept, onSubmitOverride, onCancel,
    onOverrideRevenueChange, onOverrideCoversChange, onOverrideModeChange,
    onToggleTag, onOtherNoteChange, hasValidTags, isOverrideMode }: Props = $props();

  const OVERRIDE_TAGS = [
    'Private Event', 'Holiday', 'Emergency Closure', 'Weather',
    'Concert', 'Sporting Event', 'Local Event', 'Theatre',
    'Construction/Road Closure', 'Menu Change', 'Promotion', 'Other',
  ];

  let showBreakdown = $state(true);

  // Compute weight labels from the forecast weights
  const weights = f.weights || { trailing: 0.4, pyGrowth: 0.25, momentum: 0.2, budget: 0.15 };
  const totalWeight = Object.values(weights).reduce((s: number, v: any) => s + (typeof v === 'number' ? v : 0), 0) || 1;

  const breakdownItems = $derived.by(() => {
    const items: { label: string; value: number; weight: number; pct: number }[] = [];
    const c = f.components || {};
    if (c.trailingDowAvg > 0) items.push({ label: 'Trailing DOW Avg', value: c.trailingDowAvg, weight: weights.trailing || 0, pct: ((weights.trailing || 0) / totalWeight) * 100 });
    if (c.pyAdjusted > 0) items.push({ label: 'Prior Year Adjusted', value: c.pyAdjusted, weight: weights.pyGrowth || 0, pct: ((weights.pyGrowth || 0) / totalWeight) * 100 });
    if (c.momentumRevenue > 0) items.push({ label: 'Momentum', value: c.momentumRevenue, weight: weights.momentum || 0, pct: ((weights.momentum || 0) / totalWeight) * 100 });
    if (c.budgetRevenue > 0) items.push({ label: 'Budget', value: c.budgetRevenue, weight: weights.budget || 0, pct: ((weights.budget || 0) / totalWeight) * 100 });
    if (c.weatherAdjustedRevenue > 0) items.push({ label: 'Weather Adj.', value: c.weatherAdjustedRevenue, weight: weights.weather || 0, pct: ((weights.weather || 0) / totalWeight) * 100 });
    if (c.reservationEstRevenue > 0) items.push({ label: 'Resy Reservations', value: c.reservationEstRevenue, weight: weights.reservations || 0, pct: ((weights.reservations || 0) / totalWeight) * 100 });
    return items;
  });

  // Risk range
  const lowScenario = f.lowScenario || Math.round(f.suggestedRevenue * 0.85);
  const highScenario = f.highScenario || Math.round(f.suggestedRevenue * 1.15);
  const rangeSpan = highScenario - lowScenario || 1;
  const expectedPct = ((f.suggestedRevenue - lowScenario) / rangeSpan) * 100;

  // Sparkline data
  const histBars = (f.historicalSameDow || []).slice(0, 8);
  const histMax = histBars.length > 0 ? Math.max(...histBars) : 1;
  const histTrend = histBars.length >= 2 ? (histBars[0] > histBars[histBars.length - 1] ? 'up' : 'down') : 'flat';

  // Override impact preview (reactive)
  const overrideImpactWeekTotal = $derived(weekTotal - (f.managerRevenue || f.suggestedRevenue) + overrideRevenue);
  const overrideDelta = $derived(overrideRevenue - f.suggestedRevenue);
  const overrideDeltaPct = $derived(f.suggestedRevenue > 0 ? ((overrideDelta) / f.suggestedRevenue * 100) : 0);

  // Quick scenario buttons
  function applyScenario(type: string) {
    let newRev = f.suggestedRevenue;
    if (type === '+5%') newRev = Math.round(f.suggestedRevenue * 1.05);
    else if (type === '+10%') newRev = Math.round(f.suggestedRevenue * 1.10);
    else if (type === '-5%') newRev = Math.round(f.suggestedRevenue * 0.95);
    else if (type === 'budget') newRev = f.budgetRevenue || f.suggestedRevenue;
    else if (type === 'ly') newRev = f.samePeriodPY || f.suggestedRevenue;
    else if (type === 't2w') newRev = f.trailing2wAvg || f.suggestedRevenue;
    onOverrideRevenueChange(newRev);
    if (f.avgCheck > 0) onOverrideCoversChange(Math.round(newRev / f.avgCheck));
  }

  // Confidence factors
  const cFactors = f.confidenceFactors || [];
</script>

<td colspan="13" class="p-0" style="border-bottom: 2px solid #1e3a5f;">
  <div class="p-4" style="background: #f8fafc;">
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
      <!-- Revenue Breakdown Card -->
      <div class="leo-card p-3" style="border-left: 3px solid #1e3a5f;">
        <h4 class="text-xs font-semibold text-[#1e3a5f] mb-2 uppercase tracking-wide">Revenue Breakdown</h4>
        {#each breakdownItems as item}
        <div class="flex items-center gap-2 mb-1.5">
          <span class="text-xs text-[#6b7280] w-28 flex-shrink-0">{item.label}</span>
          <div class="flex-1 h-4 rounded overflow-hidden" style="background: #e5e7eb;">
            <div class="h-full rounded" style="width: {item.pct}%; background: #1e3a5f; opacity: {0.4 + item.pct / 150};"></div>
          </div>
          <span class="text-xs font-medium text-[#374151] w-14 text-right">{item.pct.toFixed(0)}%</span>
          <span class="text-xs text-[#9ca3af] w-16 text-right">{fmt(Math.round(item.value))}</span>
        </div>
        {/each}
        {#if f.weatherCondition}
        <div class="mt-2 pt-2 text-xs text-[#6b7280]" style="border-top: 1px solid #e5e7eb;">Weather: {f.weatherCondition} {f.weatherTempHigh ? Math.round(f.weatherTempHigh) + 'F' : ''}</div>
        {/if}
      </div>

      <!-- Confidence Explanation Card -->
      <div class="leo-card p-3" style="border-left: 3px solid {f.confidence >= 0.7 ? '#16a34a' : f.confidence >= 0.5 ? '#eab308' : '#dc2626'};">
        <h4 class="text-xs font-semibold text-[#1e3a5f] mb-2 uppercase tracking-wide">Confidence: {(f.confidence * 100).toFixed(0)}%</h4>
        {#each cFactors as cf}
        <div class="flex items-center gap-2 mb-1">
          <span class="text-sm">{cf.available ? '✓' : '⚠'}</span>
          <span class="text-xs {cf.available ? 'text-[#374151]' : 'text-[#9ca3af]'}">{cf.signal}</span>
          <span class="text-xs text-[#9ca3af] ml-auto">+{(cf.impact * 100).toFixed(0)}%</span>
        </div>
        {/each}
        {#if f.confidence < 0.7}
        <div class="mt-2 pt-2 text-xs text-[#ea580c]" style="border-top: 1px solid #e5e7eb;">
          Adding {cFactors.filter((c: any) => !c.available).map((c: any) => c.signal).slice(0, 2).join(', ')} would improve confidence
        </div>
        {/if}
      </div>

      <!-- Risk Range Card -->
      <div class="leo-card p-3" style="border-left: 3px solid #6366f1;">
        <h4 class="text-xs font-semibold text-[#1e3a5f] mb-2 uppercase tracking-wide">Revenue Range (P10-P90)</h4>
        <div class="flex items-center justify-between text-xs text-[#6b7280] mb-1">
          <span>Low: {fmt(lowScenario)}</span>
          <span class="font-semibold text-[#1e3a5f]">Expected: {fmt(Math.round(f.suggestedRevenue))}</span>
          <span>High: {fmt(highScenario)}</span>
        </div>
        <div class="relative h-5 rounded-full overflow-hidden" style="background: linear-gradient(90deg, #fef2f2 0%, #f0fdf4 50%, #eff6ff 100%);">
          <div class="absolute top-1 bottom-1 w-1 rounded" style="left: {Math.max(2, Math.min(expectedPct, 98))}%; background: #1e3a5f;"></div>
        </div>
        <div class="flex items-center justify-between text-xs text-[#9ca3af] mt-1">
          <span>Spread: {fmt(highScenario - lowScenario)}</span>
          {#if f.managerAccuracy?.mape != null}
          <span>Override MAPE: {f.managerAccuracy.mape}% ({f.managerAccuracy.grade})</span>
          {/if}
        </div>

        <!-- Historical Sparkline -->
        {#if histBars.length > 0}
        <div class="mt-3 pt-2" style="border-top: 1px solid #e5e7eb;">
          <div class="flex items-end gap-1" style="height: 40px;">
            {#each [...histBars].reverse() as rev, i}
            <div class="flex-1 rounded-t" style="height: {Math.max(4, (rev / histMax) * 36)}px; background: {i === histBars.length - 1 ? '#1e3a5f' : '#93c5fd'};" title="{fmt(Math.round(rev))}"></div>
            {/each}
          </div>
          <div class="flex items-center justify-between mt-1">
            <span class="text-xs text-[#9ca3af]">Last 8 same-DOW</span>
            <span class="text-xs font-medium" style="color: {histTrend === 'up' ? '#16a34a' : '#dc2626'};">{histTrend === 'up' ? '↑' : '↓'} trend</span>
          </div>
        </div>
        {/if}
      </div>
    </div>

    <!-- Revenue Waterfall Chart -->
    <RevenueWaterfallChart forecast={f} {fmt} />

    <!-- Override Section (only if in override mode) -->
    {#if isOverrideMode}
    <div class="leo-card p-4" style="background: #fff7ed; border-left: 3px solid #ea580c;">
      <div class="flex flex-wrap items-end gap-4 mb-3">
        <div class="inline-flex rounded-md overflow-hidden border" style="border-color: #d1d5db;">
          <button type="button" onclick={() => { onOverrideModeChange('revenue'); onOverrideRevenueChange(f.suggestedRevenue); }} class="text-xs font-medium px-3 py-1" style="{overrideMode === 'revenue' ? 'background:#1e3a5f;color:white;' : 'background:#f9fafb;color:#374151;'}">Revenue</button>
          <button type="button" onclick={() => { onOverrideModeChange('covers'); onOverrideCoversChange(f.suggestedCovers || 0); }} class="text-xs font-medium px-3 py-1" style="{overrideMode === 'covers' ? 'background:#1e3a5f;color:white;' : 'background:#f9fafb;color:#374151;'}">Covers</button>
        </div>
        {#if overrideMode === 'revenue'}
          <div><label class="text-xs text-[#6b7280]">Revenue</label><input value={overrideRevenue} oninput={(e) => { const v = Number(e.currentTarget.value); onOverrideRevenueChange(v); if (f.avgCheck > 0) onOverrideCoversChange(Math.round(v / f.avgCheck)); }} type="number" class="leo-select w-32 block mt-1" /></div>
          <div><label class="text-xs text-[#9ca3af]">Covers: {f.avgCheck > 0 ? Math.round(overrideRevenue / f.avgCheck) : '-'}</label></div>
        {:else}
          <div><label class="text-xs text-[#6b7280]">Covers</label><input value={overrideCovers} oninput={(e) => { const v = Number(e.currentTarget.value); onOverrideCoversChange(v); onOverrideRevenueChange(Math.round(v * (f.avgCheck || 0))); }} type="number" class="leo-select w-32 block mt-1" /></div>
          <div><label class="text-xs text-[#9ca3af]">Revenue: {fmt(Math.round(overrideCovers * (f.avgCheck || 0)))}</label></div>
        {/if}
        <div><label class="text-xs text-[#9ca3af]">Avg Check: {fmt(Math.round(f.avgCheck || 0))}</label></div>
      </div>

      <!-- Override Impact Preview -->
      <div class="mb-3 p-2 rounded text-xs" style="background: #fef3c7; border: 1px solid #fde68a;">
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span>Weekly total: {fmt(Math.round(weekTotal))} → <strong>{fmt(Math.round(overrideImpactWeekTotal))}</strong> ({overrideImpactWeekTotal - weekTotal >= 0 ? '+' : ''}{fmt(Math.round(overrideImpactWeekTotal - weekTotal))})</span>
          <span>vs AI: <strong style="color: {overrideDelta >= 0 ? '#16a34a' : '#dc2626'};">{overrideDelta >= 0 ? '+' : ''}{fmt(Math.round(overrideDelta))} ({overrideDeltaPct >= 0 ? '+' : ''}{overrideDeltaPct.toFixed(1)}%)</strong></span>
          {#if f.managerAccuracy?.mape != null}
          <span>Your {new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', {weekday: 'short'})} override accuracy: MAPE {f.managerAccuracy.mape}%</span>
          {/if}
        </div>
      </div>

      <!-- Quick Scenarios -->
      <div class="flex flex-wrap gap-1.5 mb-3">
        <span class="text-xs text-[#6b7280] self-center mr-1">Quick:</span>
        {#each [{label: '+5%', key: '+5%'}, {label: '+10%', key: '+10%'}, {label: '-5%', key: '-5%'}, {label: 'Match Budget', key: 'budget'}, {label: 'Match LY', key: 'ly'}, {label: 'Match T2W', key: 't2w'}] as sc}
        <button type="button" onclick={() => applyScenario(sc.key)} class="rounded text-xs font-medium px-2 py-1 transition-colors" style="background: #f3f4f6; color: #374151; border: 1px solid #d1d5db;" onmouseenter={(e) => e.currentTarget.style.background='#e5e7eb'} onmouseleave={(e) => e.currentTarget.style.background='#f3f4f6'}>{sc.label}</button>
        {/each}
      </div>

      <!-- Tags -->
      <div class="mb-2">
        <label class="text-xs text-[#6b7280] block mb-1">Reason (select one or more)</label>
        <div class="flex flex-wrap gap-1.5">
          {#each OVERRIDE_TAGS as tag}<button type="button" onclick={() => onToggleTag(tag)} class="rounded-xl text-xs font-medium transition-colors cursor-pointer" style="{overrideTags.includes(tag) ? 'background:#1e3a5f;color:white;padding:2px 10px;border:1px solid #1e3a5f;' : 'background:#f3f4f6;color:#374151;padding:2px 10px;border:1px solid #d1d5db;'}">{tag}</button>{/each}
        </div>
      </div>
      {#if overrideTags.includes('Other')}
      <div class="mb-2"><input value={overrideOtherNote} oninput={(e) => onOtherNoteChange(e.currentTarget.value)} type="text" placeholder="Describe..." class="leo-select w-64 text-xs" /></div>
      {/if}
      <div class="flex items-center gap-3">
        <button onclick={onSubmitOverride} disabled={!hasValidTags()} class="leo-btn disabled:opacity-50" style="background: #ea580c;" onmouseenter={(e) => e.currentTarget.style.background='#c2410c'} onmouseleave={(e) => e.currentTarget.style.background='#ea580c'}>Submit Override</button>
        <button onclick={onCancel} class="text-sm text-[#6b7280]">Cancel</button>
      </div>
    </div>
    {/if}
  </div>
</td>
