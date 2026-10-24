<script lang="ts">
  interface Props {
    forecast: any;
    fmt: (n: number) => string;
  }

  let { forecast, fmt }: Props = $props();

  // Build waterfall steps from forecast components
  let steps = $derived.by(() => {
    if (!forecast?.components) return [];
    const c = forecast.components;
    const base = c.trailingDowAvg || 0;
    if (base <= 0) return [];

    const final = forecast.suggestedRevenue || 0;
    const signals: { label: string; value: number }[] = [];

    // Calculate adjustments as deltas from base
    if (c.pyAdjusted && c.pyAdjusted > 0) {
      const pyDelta = (c.pyAdjusted - base) * (forecast.weights?.priorYear || 0.15);
      if (Math.abs(pyDelta) > 50) signals.push({ label: 'PY Growth', value: Math.round(pyDelta) });
    }
    if (c.momentumRevenue && c.momentumRevenue > 0) {
      const momDelta = (c.momentumRevenue - base) * (forecast.weights?.momentum || 0.1);
      if (Math.abs(momDelta) > 50) signals.push({ label: 'Momentum', value: Math.round(momDelta) });
    }
    if (c.budgetRevenue && c.budgetRevenue > 0) {
      const budgetDelta = (c.budgetRevenue - base) * (forecast.weights?.budget || 0.05);
      if (Math.abs(budgetDelta) > 50) signals.push({ label: 'Budget', value: Math.round(budgetDelta) });
    }
    if (c.weatherAdjustedRevenue && c.weatherAdjustedRevenue > 0) {
      const wxDelta = c.weatherAdjustedRevenue - base;
      if (Math.abs(wxDelta) > 50) signals.push({ label: 'Weather', value: Math.round(wxDelta * 0.05) });
    }
    if (c.reservationEstRevenue && c.reservationEstRevenue > 0) {
      const resDelta = (c.reservationEstRevenue - base) * (forecast.weights?.reservations || 0.1);
      if (Math.abs(resDelta) > 50) signals.push({ label: 'Resy', value: Math.round(resDelta) });
    }
    if (c.crossLocationRevenue && c.crossLocationRevenue > 0) {
      const clDelta = (c.crossLocationRevenue - base) * (forecast.weights?.crossLocation || 0.05);
      if (Math.abs(clDelta) > 50) signals.push({ label: 'Cross-Loc', value: Math.round(clDelta) });
    }

    // If no signals found, compute residual
    if (signals.length === 0) {
      const residual = final - base;
      if (Math.abs(residual) > 50) {
        signals.push({ label: 'AI Adjustment', value: Math.round(residual) });
      }
    }

    return signals;
  });

  let hasSteps = $derived(steps.length > 0 && (forecast?.components?.trailingDowAvg || 0) > 0);

  // SVG layout
  const SVG_W = 480;
  const SVG_H = 180;
  const PAD = { t: 20, b: 30, l: 80, r: 20 };
  const plotW = SVG_W - PAD.l - PAD.r;
  const plotH = SVG_H - PAD.t - PAD.b;

  let bars = $derived.by(() => {
    if (!hasSteps) return [];
    const base = forecast.components.trailingDowAvg;
    const final = forecast.suggestedRevenue || 0;

    const allItems = [
      { label: 'T2W Avg', type: 'start' as const, value: base },
      ...steps.map(s => ({ label: s.label, type: 'step' as const, value: s.value })),
      { label: 'Forecast', type: 'end' as const, value: final },
    ];

    // Find min and max running total for scale
    let running = base;
    let minVal = base;
    let maxVal = base;
    for (const s of steps) {
      running += s.value;
      minVal = Math.min(minVal, running);
      maxVal = Math.max(maxVal, running);
    }
    minVal = Math.min(minVal, base, final);
    maxVal = Math.max(maxVal, base, final);
    const padding = (maxVal - minVal) * 0.15 || 1000;
    const scaleMin = minVal - padding;
    const scaleMax = maxVal + padding;
    const scaleRange = scaleMax - scaleMin || 1;

    function toX(v: number): number { return PAD.l + ((v - scaleMin) / scaleRange) * plotW; }

    const barH = Math.min(20, plotH / (allItems.length + 1));
    const gap = (plotH - allItems.length * barH) / (allItems.length + 1);
    const result: { x: number; y: number; w: number; h: number; label: string; value: number; color: string; textX: number; displayVal: string }[] = [];

    let runningTotal = base;
    for (let i = 0; i < allItems.length; i++) {
      const item = allItems[i];
      const y = PAD.t + gap + i * (barH + gap);

      if (item.type === 'start') {
        const x = toX(0 + scaleMin);
        const w = toX(item.value) - toX(scaleMin);
        result.push({ x: toX(scaleMin), y, w, h: barH, label: item.label, value: item.value, color: '#1e3a5f', textX: toX(item.value) + 4, displayVal: fmt(Math.round(item.value)) });
      } else if (item.type === 'end') {
        const x = toX(scaleMin);
        const w = toX(item.value) - toX(scaleMin);
        result.push({ x: toX(scaleMin), y, w, h: barH, label: item.label, value: item.value, color: '#1e3a5f', textX: toX(item.value) + 4, displayVal: fmt(Math.round(item.value)) });
      } else {
        const startX = toX(runningTotal);
        const endX = toX(runningTotal + item.value);
        const barX = Math.min(startX, endX);
        const barW = Math.abs(endX - startX);
        const color = item.value >= 0 ? '#16a34a' : '#ef4444';
        const sign = item.value >= 0 ? '+' : '';
        result.push({ x: barX, y, w: barW, h: barH, label: item.label, value: item.value, color, textX: Math.max(startX, endX) + 4, displayVal: sign + fmt(Math.round(item.value)) });
        runningTotal += item.value;
      }
    }

    return result;
  });
</script>

{#if hasSteps}
<div class="mt-3 mb-2">
  <h4 class="text-xs font-semibold mb-2" style="color: #1e3a5f;">Revenue Waterfall</h4>
  <svg viewBox="0 0 {SVG_W} {SVG_H}" style="width: 100%; max-width: 480px; min-height: 140px;" role="img" aria-label="Revenue waterfall chart">
    {#each bars as bar}
      <!-- Label on left -->
      <text x={PAD.l - 6} y={bar.y + bar.h / 2 + 4} text-anchor="end" fill="#374151" font-size="11" font-family="Inter,sans-serif" font-weight="500">{bar.label}</text>
      <!-- Bar -->
      <rect x={bar.x} y={bar.y} width={Math.max(bar.w, 1)} height={bar.h} fill={bar.color} rx="2" opacity="0.85">
        <title>{bar.label}: {bar.displayVal}</title>
      </rect>
      <!-- Value text -->
      <text x={bar.textX} y={bar.y + bar.h / 2 + 4} fill="#374151" font-size="10" font-family="Inter,sans-serif">{bar.displayVal}</text>
    {/each}
  </svg>
</div>
{/if}
