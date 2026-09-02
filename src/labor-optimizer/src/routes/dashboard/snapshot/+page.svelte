<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  let locationId = $state('');
  let locations = $state<{id: string; name: string}[]>([]);
  let period = $state(0);
  let year = $state(2026);
  let loading = $state(false);
  let error = $state('');
  let kpi = $state<any>(null);
  let npsData = $state<any>(null);

  function fmt(n: number) { return '$' + Math.round(n).toLocaleString(); }
  function pct(n: number) { return (n * 100).toFixed(1) + '%'; }
  function delta(a: number, b: number) {
    if (!b) return null;
    return ((a - b) / b) * 100;
  }
  function deltaStr(d: number | null) {
    if (d === null) return '—';
    return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
  }
  function deltaColor(d: number | null) {
    if (d === null) return '#9ca3af';
    return d >= 0 ? '#16a34a' : '#dc2626';
  }
  function laborColor(ratio: number) {
    if (ratio <= 0.30) return '#16a34a';
    if (ratio <= 0.35) return '#ca8a04';
    return '#dc2626';
  }
  function npsColor(n: number | null) {
    if (n === null) return '#9ca3af';
    if (n >= 60) return '#16a34a';
    if (n >= 30) return '#ca8a04';
    return '#dc2626';
  }
  function detectCurrentPeriod() {
    const fyStart = new Date(year - 1, 11, 29);
    const now = new Date();
    return Math.min(13, Math.max(1, Math.floor((now.getTime() - fyStart.getTime()) / 86400000 / 28) + 1));
  }

  async function loadLocations() {
    const sb = getClientSupabase();
    const { data: { user } } = await sb.auth.getUser();
    const url = user?.email
      ? `/api/v1/auth/my-locations?email=${encodeURIComponent(user.email)}`
      : '/api/v1/locations';
    const res = await fetch(url);
    const d = await res.json();
    locations = d.locations || d || [];
    if (locations.length > 0) {
      const saved = localStorage.getItem('helixo_selected_location');
      locationId = (saved && locations.some(l => l.id === saved)) ? saved : locations[0].id;
    }
    if (period === 0) period = detectCurrentPeriod();
    await loadData();
  }

  async function loadData() {
    if (!locationId || !period) return;
    loading = true; error = '';
    try {
      const [kpiRes, npsRes] = await Promise.all([
        fetch(`/api/v1/kpi?locationId=${locationId}&period=${period}&year=${year}`),
        fetch(`/api/v1/guest-analytics?locationId=${locationId}&range=90`),
      ]);
      kpi = kpiRes.ok ? await kpiRes.json() : null;
      npsData = npsRes.ok ? await npsRes.json() : null;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  $effect(() => { loadLocations(); });
  $effect(() => { if (locationId) localStorage.setItem('helixo_selected_location', locationId); });

  // Derived KPI values — kpi response shape: { period, summary, days }
  const summary = $derived(kpi?.summary ?? {});
  const revenue = $derived(summary?.totalRevenue ?? 0);
  const revLY = $derived(summary?.totalLyRevenue ?? 0);
  const revBudget = $derived(summary?.totalBudgetRevenue ?? 0);
  const laborPct = $derived(summary?.laborPct ?? 0);
  const laborTarget = $derived(summary?.budgetLaborPct ?? 0.30);
  const totalLabor = $derived(summary?.totalLaborActual ?? 0);
  const covers = $derived(summary?.totalCovers ?? 0);
  const perCover = $derived(covers > 0 ? revenue / covers : 0);

  const revVsBudget = $derived(delta(revenue, revBudget));
  const revVsLY = $derived(delta(revenue, revLY));

  const npsScore = $derived(npsData?.nps ?? null);
  const totalResponses = $derived(npsData?.totalResponses ?? 0);
  const promoters = $derived(npsData?.promoters ?? 0);
  const detractors = $derived(npsData?.detractors ?? 0);

  // Weekly pace from kpi days
  const days = $derived<any[]>(kpi?.days ?? []);
  const completedDays = $derived(days.filter((d: any) => d.revenue > 0));
  const remainingDays = $derived(days.filter((d: any) => !d.revenue));
  const avgDailyRevenue = $derived(completedDays.length > 0
    ? completedDays.reduce((s: number, d: any) => s + d.revenue, 0) / completedDays.length
    : 0);
  const projectedTotal = $derived(revenue + avgDailyRevenue * remainingDays.length);

  // Per-period position totals aggregated across all days
  const positionTotals = $derived.by(() => {
    const map = new Map<string, number>();
    for (const d of days) {
      for (const p of (d.laborByPosition ?? [])) {
        map.set(p.position, (map.get(p.position) ?? 0) + (p.actual || 0));
      }
    }
    return Array.from(map.entries()).map(([position, actual]) => ({ position, actual }));
  });

  const locationName = $derived(locations.find(l => l.id === locationId)?.name ?? '');
</script>

<div class="p-4 max-w-5xl mx-auto space-y-4">

  <!-- Header + Controls -->
  <div class="flex flex-wrap gap-3 items-center justify-between">
    <div>
      <h1 class="text-xl font-bold text-[#1e3a5f]">Snapshot</h1>
      <p class="text-xs text-[#6b7280]">Quick-view KPI overview for the selected period</p>
    </div>
    <div class="flex gap-2 flex-wrap">
      {#if locations.length > 1}
      <select class="leo-select text-sm" bind:value={locationId} onchange={loadData}>
        {#each locations as l}<option value={l.id}>{l.name}</option>{/each}
      </select>
      {/if}
      <select class="leo-select text-sm" bind:value={period} onchange={loadData}>
        {#each Array.from({length: 13}, (_, i) => i + 1) as p}
          <option value={p}>Period {p}</option>
        {/each}
      </select>
      <select class="leo-select text-sm" bind:value={year} onchange={loadData}>
        <option value={2025}>FY2025</option>
        <option value={2026}>FY2026</option>
      </select>
    </div>
  </div>

  {#if error}
    <div class="leo-card p-3 text-sm text-red-600">{error}</div>
  {/if}

  {#if loading}
    <div class="leo-card p-8 text-center text-[#6b7280] text-sm">Loading…</div>
  {:else if kpi}

  <!-- Location + Period Banner -->
  <div class="leo-card p-3 flex items-center justify-between" style="background: #1e3a5f;">
    <span class="text-white font-semibold text-sm">{locationName}</span>
    <span class="text-white/70 text-xs">Period {period} · FY{year} · {kpi.period?.startDate ?? ''} – {kpi.period?.endDate ?? ''}</span>
  </div>

  <!-- Revenue Row -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    <div class="leo-card p-4">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Revenue</div>
      <div class="text-2xl font-bold text-[#1e3a5f]">{fmt(revenue)}</div>
      {#if revBudget > 0}
        <div class="text-xs mt-1" style="color: {deltaColor(revVsBudget)}">
          vs Budget: {deltaStr(revVsBudget)}
        </div>
      {/if}
      {#if revLY > 0}
        <div class="text-xs" style="color: {deltaColor(revVsLY)}">
          vs LY: {deltaStr(revVsLY)}
        </div>
      {/if}
    </div>

    <div class="leo-card p-4">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Labor %</div>
      <div class="text-2xl font-bold" style="color: {laborColor(laborPct)}">{pct(laborPct)}</div>
      <div class="text-xs text-[#6b7280] mt-1">Target: {pct(laborTarget)}</div>
      <div class="text-xs text-[#6b7280]">Cost: {fmt(totalLabor)}</div>
    </div>

    <div class="leo-card p-4">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Revenue / Cover</div>
      <div class="text-2xl font-bold text-[#1e3a5f]">{covers > 0 ? fmt(perCover) : '—'}</div>
      <div class="text-xs text-[#6b7280] mt-1">Covers: {covers.toLocaleString()}</div>
    </div>

    <div class="leo-card p-4">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">NPS (90 days)</div>
      <div class="text-2xl font-bold" style="color: {npsColor(npsScore)}">{npsScore !== null ? npsScore : '—'}</div>
      {#if totalResponses > 0}
        <div class="text-xs text-[#6b7280] mt-1">{totalResponses} responses</div>
        <div class="text-xs text-[#6b7280]">{promoters}P · {detractors}D</div>
      {/if}
    </div>
  </div>

  <!-- Period Pace Bar -->
  {#if days.length > 0}
  <div class="leo-card p-4">
    <div class="flex items-center justify-between mb-3">
      <span class="text-sm font-semibold text-[#1e3a5f]">Period Pace</span>
      <div class="flex gap-4 text-xs text-[#6b7280]">
        <span>{completedDays.length} of {days.length} days complete</span>
        {#if remainingDays.length > 0 && avgDailyRevenue > 0}
          <span>Projected total: <strong class="text-[#1e3a5f]">{fmt(projectedTotal)}</strong></span>
        {/if}
      </div>
    </div>
    <div class="flex gap-1 flex-wrap">
      {#each days as d, i}
        {@const rev = d.revenue || 0}
        {@const hasRev = rev > 0}
        {@const dow = new Date((d.date || '') + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
        {@const tip = `${dow} ${d.date ?? ''}: ${hasRev ? fmt(rev) : 'No data'}`}
        <div
          class="flex flex-col items-center gap-0.5"
          style="width: calc((100% - {(days.length - 1) * 4}px) / {days.length})"
          title={tip}
        >
          <div
            class="w-full rounded-sm"
            style="height: 28px; background: {hasRev ? '#1e3a5f' : '#e5e7eb'}; opacity: {hasRev ? Math.max(0.3, rev / (avgDailyRevenue * 1.5)) : 1};"
          ></div>
          <span class="text-[9px] text-[#9ca3af]">{dow.charAt(0)}</span>
        </div>
      {/each}
    </div>
    <div class="flex justify-between mt-1">
      <span class="text-[10px] text-[#9ca3af]">Wk 1</span>
      <span class="text-[10px] text-[#9ca3af]">Wk 2</span>
      <span class="text-[10px] text-[#9ca3af]">Wk 3</span>
      <span class="text-[10px] text-[#9ca3af]">Wk 4</span>
    </div>
  </div>
  {/if}

  <!-- Weekly Breakdown Table -->
  {#if days.length >= 28}
  <div class="leo-card p-4">
    <div class="text-sm font-semibold text-[#1e3a5f] mb-3">Weekly Breakdown</div>
    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-[#6b7280] uppercase tracking-wide">
            <th class="text-left py-1 pr-4">Week</th>
            <th class="text-right py-1 pr-4">Revenue</th>
            <th class="text-right py-1 pr-4">Labor $</th>
            <th class="text-right py-1 pr-4">Labor %</th>
            <th class="text-right py-1">Covers</th>
          </tr>
        </thead>
        <tbody>
          {#each [0,1,2,3] as wk}
            {@const wkDays = days.slice(wk * 7, wk * 7 + 7)}
            {@const wkRev = wkDays.reduce((s: number, d: any) => s + (d.revenue || 0), 0)}
            {@const wkLabor = wkDays.reduce((s: number, d: any) => s + (d.totalLabor?.actual || 0), 0)}
            {@const wkCovers = wkDays.reduce((s: number, d: any) => s + (d.covers || 0), 0)}
            {@const wkLaborPct = wkRev > 0 ? wkLabor / wkRev : 0}
            <tr class="border-t border-gray-100">
              <td class="py-2 pr-4 font-medium text-[#1e3a5f]">Week {wk + 1}</td>
              <td class="py-2 pr-4 text-right text-[#1e3a5f] font-medium">{wkRev > 0 ? fmt(wkRev) : '—'}</td>
              <td class="py-2 pr-4 text-right text-[#6b7280]">{wkLabor > 0 ? fmt(wkLabor) : '—'}</td>
              <td class="py-2 pr-4 text-right font-medium" style="color: {wkLaborPct > 0 ? laborColor(wkLaborPct) : '#9ca3af'}">{wkLaborPct > 0 ? pct(wkLaborPct) : '—'}</td>
              <td class="py-2 text-right text-[#6b7280]">{wkCovers > 0 ? wkCovers.toLocaleString() : '—'}</td>
            </tr>
          {/each}
          <tr class="border-t-2 border-[#1e3a5f]/20 font-semibold">
            <td class="py-2 pr-4 text-[#1e3a5f]">Period Total</td>
            <td class="py-2 pr-4 text-right text-[#1e3a5f]">{fmt(revenue)}</td>
            <td class="py-2 pr-4 text-right text-[#1e3a5f]">{fmt(totalLabor)}</td>
            <td class="py-2 pr-4 text-right" style="color: {laborColor(laborPct)}">{pct(laborPct)}</td>
            <td class="py-2 text-right text-[#1e3a5f]">{covers.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
  {/if}

  <!-- FOH / BOH Split -->
  {#if positionTotals.length > 0}
  {@const positions = positionTotals}
  {@const fohPositions = ['Server','Bartender','Host','Barista','Support','Training']}
  {@const foh = positions.filter((p: any) => fohPositions.includes(p.position))}
  {@const boh = positions.filter((p: any) => !fohPositions.includes(p.position))}
  {@const fohTotal = foh.reduce((s: number, p: any) => s + (p.actual || 0), 0)}
  {@const bohTotal = boh.reduce((s: number, p: any) => s + (p.actual || 0), 0)}
  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
    {#each [{ label: 'FOH Labor', positions: foh, total: fohTotal }, { label: 'BOH Labor', positions: boh, total: bohTotal }] as group}
    <div class="leo-card p-4">
      <div class="flex items-center justify-between mb-3">
        <span class="text-sm font-semibold text-[#1e3a5f]">{group.label}</span>
        <span class="text-sm font-bold text-[#1e3a5f]">{fmt(group.total)}</span>
      </div>
      {#each group.positions.filter((p: any) => p.actual > 0) as pos}
        {@const barWidth = group.total > 0 ? (pos.actual / group.total) * 100 : 0}
        <div class="mb-1.5">
          <div class="flex justify-between text-xs mb-0.5">
            <span class="text-[#374151]">{pos.position}</span>
            <span class="text-[#6b7280]">{fmt(pos.actual)}</span>
          </div>
          <div class="w-full h-1.5 bg-gray-100 rounded-full">
            <div class="h-1.5 bg-[#1e3a5f] rounded-full" style="width: {barWidth}%"></div>
          </div>
        </div>
      {/each}
    </div>
    {/each}
  </div>
  {/if}

  {/if}

  {#if !loading && !kpi && !error}
    <div class="leo-card p-8 text-center text-[#6b7280] text-sm">No data available for Period {period}, FY{year}.</div>
  {/if}

</div>
