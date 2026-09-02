<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  let loading = $state(false);
  let error = $state('');
  let data = $state<any>(null);
  let isAuthorized = $state(false);
  let authChecked = $state(false);

  let period = $state(4);
  let week = $state(0);
  let year = $state(2026);
  let sortCol = $state('rank');
  let sortAsc = $state(true);
  let selectedMetric = $state('revenue');

  const metrics = [
    { value: 'revenue', label: 'Revenue' },
    { value: 'laborPct', label: 'Labor %' },
    { value: 'covers', label: 'Covers' },
    { value: 'avgCheck', label: 'Avg Check' },
    { value: 'forecastAccuracy', label: 'Forecast Accuracy' },
  ];

  function fmt(n: number | null): string {
    if (n == null) return '-';
    return '$' + Math.round(n).toLocaleString();
  }
  function pct(n: number | null): string {
    if (n == null) return '-';
    return (n * 100).toFixed(1) + '%';
  }
  function varColor(val: number, inverted = false): string {
    const good = inverted ? val > 0 : val >= 0;
    return good ? '#16a34a' : '#dc2626';
  }
  function laborColor(actual: number, target: number): string {
    if (actual <= target) return '#16a34a';
    if (actual <= target + 0.02) return '#ca8a04';
    return '#dc2626';
  }
  function trendArrow(dir: string): string {
    if (dir === 'up') return '\u25B2';
    if (dir === 'down') return '\u25BC';
    return '\u25AC';
  }
  function trendColor(dir: string): string {
    if (dir === 'up') return '#16a34a';
    if (dir === 'down') return '#dc2626';
    return '#9ca3af';
  }

  async function loadData() {
    loading = true;
    error = '';
    data = null;
    try {
      const params = new URLSearchParams({
        period: String(period),
        week: String(week),
        year: String(year),
      });
      const res = await fetch(`/api/v1/location-comparison?${params}`);
      if (!res.ok) { error = (await res.json()).error || 'Failed to load'; return; }
      data = await res.json();
    } catch (e: any) { error = e.message; }
    finally { loading = false; }
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const email = session?.user?.email ?? null;
      if (email) {
        try {
          const _roleCtrl = new AbortController(); setTimeout(() => _roleCtrl.abort(), 8000); const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: _roleCtrl.signal });
          if (res.ok) {
            const d = await res.json();
            const role = d.role || 'viewer';
            isAuthorized = role === 'super_admin' || role === 'director';
          }
        } catch { isAuthorized = false; }
      }
      authChecked = true;
      if (!isAuthorized) { goto('/dashboard'); return; }
      loadData();
    });
  });

  function sortBy(col: string) {
    if (sortCol === col) { sortAsc = !sortAsc; }
    else { sortCol = col; sortAsc = col === 'rank'; }
  }

  let sortedLocations = $derived.by(() => {
    if (!data?.locations) return [];
    const locs = [...data.locations];
    const dir = sortAsc ? 1 : -1;
    locs.sort((a: any, b: any) => {
      let va: number, vb: number;
      switch (sortCol) {
        case 'rank': va = a.rank; vb = b.rank; break;
        case 'name': return dir * a.locationName.localeCompare(b.locationName);
        case 'revenue': va = a.revenue.actual; vb = b.revenue.actual; break;
        case 'revVar': va = a.revenue.varPct; vb = b.revenue.varPct; break;
        case 'covers': va = a.covers.actual; vb = b.covers.actual; break;
        case 'avgCheck': va = a.avgCheck; vb = b.avgCheck; break;
        case 'fohLabor': va = a.fohLaborPct.actual; vb = b.fohLaborPct.actual; break;
        case 'bohLabor': va = a.bohLaborPct.actual; vb = b.bohLaborPct.actual; break;
        case 'totalLabor': va = a.totalLaborPct.actual; vb = b.totalLaborPct.actual; break;
        case 'laborVar': va = a.totalLaborPct.varPct; vb = b.totalLaborPct.varPct; break;
        case 'forecast': va = a.forecastAccuracy; vb = b.forecastAccuracy; break;
        default: va = a.rank; vb = b.rank;
      }
      return dir * (va - vb);
    });
    return locs;
  });

  // SVG bar chart data
  let barChartSvg = $derived.by(() => {
    if (!data?.locations || data.locations.length === 0) return '';
    const sorted = [...data.locations].sort((a: any, b: any) => b.revenue.actual - a.revenue.actual);
    const maxRev = Math.max(...sorted.map((l: any) => Math.max(l.revenue.actual, l.revenue.budget)), 1);
    const w = 800, barH = 32, gap = 6, padL = 160, padR = 80;
    const h = sorted.length * (barH + gap) + 40;
    const barArea = w - padL - padR;

    let svg = `<svg viewBox="0 0 ${w} ${h}" class="w-full" style="max-height:${h}px">`;
    sorted.forEach((loc: any, i: number) => {
      const y = i * (barH + gap) + 20;
      const revW = (loc.revenue.actual / maxRev) * barArea;
      const budX = padL + (loc.revenue.budget / maxRev) * barArea;

      // Location label
      svg += `<text x="${padL - 8}" y="${y + barH / 2 + 4}" text-anchor="end" fill="#374151" font-size="11" font-weight="500">${loc.locationName}</text>`;

      // Revenue bar
      svg += `<rect x="${padL}" y="${y}" width="${Math.max(revW, 2)}" height="${barH}" fill="#1e3a5f" rx="3" opacity="0.85"/>`;

      // Budget marker
      if (loc.revenue.budget > 0) {
        svg += `<line x1="${budX}" y1="${y - 2}" x2="${budX}" y2="${y + barH + 2}" stroke="#dc2626" stroke-width="2" stroke-dasharray="3,2"/>`;
      }

      // Revenue label
      const revLabel = '$' + Math.round(loc.revenue.actual / 1000).toLocaleString() + 'k';
      svg += `<text x="${padL + revW + 6}" y="${y + barH / 2 + 4}" fill="#374151" font-size="10">${revLabel}</text>`;
    });

    // Legend
    svg += `<rect x="${padL}" y="${h - 16}" width="12" height="4" fill="#1e3a5f" rx="1"/>`;
    svg += `<text x="${padL + 16}" y="${h - 12}" fill="#6b7280" font-size="9">Actual</text>`;
    svg += `<line x1="${padL + 80}" y1="${h - 16}" x2="${padL + 80}" y2="${h - 10}" stroke="#dc2626" stroke-width="2" stroke-dasharray="3,2"/>`;
    svg += `<text x="${padL + 86}" y="${h - 12}" fill="#6b7280" font-size="9">Budget</text>`;
    svg += '</svg>';
    return svg;
  });

  function sortIcon(col: string): string {
    if (sortCol !== col) return '';
    return sortAsc ? ' \u25B4' : ' \u25BE';
  }
</script>

{#if !authChecked}
  <div class="p-6"><p class="text-sm text-[#9ca3af]">Checking access...</p></div>
{:else if !isAuthorized}
  <div class="p-6"><p class="text-sm text-[#dc2626]">Super Admin or Director access required</p></div>
{:else}
<div class="p-3 md:p-4">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
    <div>
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Location Comparison</h1>
      <p class="text-sm text-[#6b7280]">Cross-location performance benchmarking</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
      <select bind:value={period} onchange={loadData} class="leo-select">
        {#each Array.from({length: 13}, (_, i) => i + 1) as p}
          <option value={p}>Period {p}</option>
        {/each}
      </select>
      <select bind:value={week} onchange={loadData} class="leo-select">
        <option value={0}>Full Period</option>
        <option value={1}>Week 1</option>
        <option value={2}>Week 2</option>
        <option value={3}>Week 3</option>
        <option value={4}>Week 4</option>
      </select>
      <select bind:value={selectedMetric} class="leo-select">
        {#each metrics as m}
          <option value={m.value}>{m.label}</option>
        {/each}
      </select>
    </div>
  </div>

  {#if loading}
    <div class="leo-card p-12 text-center"><p class="text-sm text-[#9ca3af]">Loading comparison data...</p></div>
  {:else if error}
    <div class="leo-card p-6"><p class="text-sm text-[#dc2626]">{error}</p></div>
  {:else if data}

  <!-- Date range badge -->
  <div class="mb-4">
    <span class="text-xs font-medium px-3 py-1 rounded-full" style="background:#eef2f7;color:#1e3a5f;">
      {data.startDate} to {data.endDate} | {data.locations.length} locations
    </span>
  </div>

  <!-- Section 1: Comparison Table -->
  <div class="leo-card p-4 md:p-5 mb-6">
    <h2 class="leo-section-title mb-3">Performance Comparison</h2>
    <div class="leo-table-scroll" style="max-height:600px;overflow:auto;">
      <table class="w-full leo-table" style="min-width:1100px;">
        <thead class="sticky top-0" style="z-index:2;">
          <tr>
            <th class="leo-th text-left cursor-pointer" style="width:40px;" onclick={() => sortBy('rank')}>#{ sortIcon('rank')}</th>
            <th class="leo-th text-left cursor-pointer" style="min-width:140px;" onclick={() => sortBy('name')}>Location{sortIcon('name')}</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('revenue')}>Revenue{sortIcon('revenue')}</th>
            <th class="leo-th">Budget</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('revVar')}>Var%{sortIcon('revVar')}</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('covers')}>Covers{sortIcon('covers')}</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('avgCheck')}>Avg Chk{sortIcon('avgCheck')}</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('fohLabor')}>FOH %{sortIcon('fohLabor')}</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('bohLabor')}>BOH %{sortIcon('bohLabor')}</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('totalLabor')}>Total %{sortIcon('totalLabor')}</th>
            <th class="leo-th">Target</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('laborVar')}>L.Var{sortIcon('laborVar')}</th>
            <th class="leo-th cursor-pointer" onclick={() => sortBy('forecast')}>Fc Acc{sortIcon('forecast')}</th>
            <th class="leo-th" style="width:40px;">WoW</th>
          </tr>
        </thead>
        <tbody>
          {#each sortedLocations as loc}
            <tr>
              <td class="leo-td text-left">
                <span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold" style="background:#1e3a5f;color:white;">{loc.rank}</span>
              </td>
              <td class="leo-td text-left">
                <span class="text-xs font-medium text-[#1a1a1a]">{loc.locationName}</span>
                {#if loc.city}
                  <span class="ml-1 text-[9px] px-1.5 py-0.5 rounded" style="background:#f0f4f8;color:#5b8cbf;">{loc.city}</span>
                {/if}
              </td>
              <td class="leo-td text-xs font-medium">{fmt(loc.revenue.actual)}</td>
              <td class="leo-td text-xs text-[#6b7280]">{fmt(loc.revenue.budget)}</td>
              <td class="leo-td text-xs font-medium" style="color:{varColor(loc.revenue.varPct)}">
                {loc.revenue.varPct >= 0 ? '+' : ''}{pct(loc.revenue.varPct)}
              </td>
              <td class="leo-td text-xs">{loc.covers.actual.toLocaleString()}</td>
              <td class="leo-td text-xs">{fmt(loc.avgCheck)}</td>
              <td class="leo-td text-xs" style="color:{laborColor(loc.fohLaborPct.actual, loc.fohLaborPct.target)}">
                {pct(loc.fohLaborPct.actual)}
              </td>
              <td class="leo-td text-xs" style="color:{laborColor(loc.bohLaborPct.actual, loc.bohLaborPct.target)}">
                {pct(loc.bohLaborPct.actual)}
              </td>
              <td class="leo-td text-xs font-medium" style="color:{laborColor(loc.totalLaborPct.actual, loc.totalLaborPct.target)}">
                {pct(loc.totalLaborPct.actual)}
              </td>
              <td class="leo-td text-xs text-[#6b7280]">{pct(loc.totalLaborPct.target)}</td>
              <td class="leo-td text-xs font-medium" style="color:{varColor(loc.totalLaborPct.varPct, true)}">
                {loc.totalLaborPct.varPct >= 0 ? '+' : ''}{pct(loc.totalLaborPct.varPct)}
              </td>
              <td class="leo-td text-xs font-medium" style="color:{loc.forecastAccuracy >= 80 ? '#16a34a' : loc.forecastAccuracy >= 60 ? '#ca8a04' : '#dc2626'}">
                {loc.forecastAccuracy}
              </td>
              <td class="leo-td text-center">
                <span class="text-xs font-bold" style="color:{trendColor(loc.trendDirection)}">{trendArrow(loc.trendDirection)}</span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Section 2: Revenue Rankings Bar Chart -->
  <div class="leo-card p-5 mb-6">
    <h2 class="leo-section-title mb-3">Revenue Rankings</h2>
    {#if barChartSvg}
      {@html barChartSvg}
    {:else}
      <p class="text-sm text-[#9ca3af] py-8 text-center">No revenue data available</p>
    {/if}
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6">
    <!-- Section 3: Labor Efficiency -->
    <div class="leo-card p-4 md:p-5">
      <h2 class="leo-section-title mb-3">Labor Efficiency</h2>
      <p class="text-[10px] text-[#9ca3af] mb-2">Labor % relative to revenue tier</p>
      <div class="overflow-x-auto">
        <table class="w-full leo-table">
          <thead>
            <tr>
              <th class="leo-th text-left">Location</th>
              <th class="leo-th">Revenue</th>
              <th class="leo-th">Labor %</th>
              <th class="leo-th">Target %</th>
              <th class="leo-th">Efficiency</th>
            </tr>
          </thead>
          <tbody>
            {#each [...(data.locations || [])].sort((a, b) => a.totalLaborPct.actual - b.totalLaborPct.actual) as loc}
              <tr>
                <td class="leo-td text-left text-xs font-medium">{loc.locationName}</td>
                <td class="leo-td text-xs">{fmt(loc.revenue.actual)}</td>
                <td class="leo-td text-xs font-medium" style="color:{laborColor(loc.totalLaborPct.actual, loc.totalLaborPct.target)}">
                  {pct(loc.totalLaborPct.actual)}
                </td>
                <td class="leo-td text-xs text-[#6b7280]">{pct(loc.totalLaborPct.target)}</td>
                <td class="leo-td text-xs">
                  {#if loc.totalLaborPct.actual <= loc.totalLaborPct.target}
                    <span class="px-2 py-0.5 rounded text-[10px] font-medium" style="background:#dcfce7;color:#16a34a;">Efficient</span>
                  {:else if loc.totalLaborPct.actual <= loc.totalLaborPct.target + 0.02}
                    <span class="px-2 py-0.5 rounded text-[10px] font-medium" style="background:#fef9c3;color:#ca8a04;">Watch</span>
                  {:else}
                    <span class="px-2 py-0.5 rounded text-[10px] font-medium" style="background:#fee2e2;color:#dc2626;">Over</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Section 4: City Clusters -->
    <div class="leo-card p-4 md:p-5">
      <h2 class="leo-section-title mb-3">City Clusters</h2>
      {#if data.cityClusters && data.cityClusters.length > 0}
        <div class="space-y-4">
          {#each data.cityClusters as cluster}
            <div class="rounded-lg p-3" style="background:#f8fafc;border:1px solid #e2e8f0;">
              <div class="flex items-center justify-between mb-2">
                <span class="text-sm font-semibold text-[#1e3a5f]">{cluster.city || 'Unknown'}</span>
                <span class="text-[10px] px-2 py-0.5 rounded-full" style="background:#eef2f7;color:#5b8cbf;">
                  {cluster.locationCount} location{cluster.locationCount !== 1 ? 's' : ''}
                </span>
              </div>
              <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <div>
                  <p class="text-[10px] text-[#6b7280] uppercase">Revenue</p>
                  <p class="text-sm font-bold text-[#1a1a1a]">{fmt(cluster.totalRevenue)}</p>
                </div>
                <div>
                  <p class="text-[10px] text-[#6b7280] uppercase">Budget</p>
                  <p class="text-sm font-bold text-[#1a1a1a]">{fmt(cluster.totalBudget)}</p>
                </div>
                <div>
                  <p class="text-[10px] text-[#6b7280] uppercase">Avg Labor %</p>
                  <p class="text-sm font-bold" style="color:{cluster.avgLaborPct <= 0.30 ? '#16a34a' : '#dc2626'}">
                    {pct(cluster.avgLaborPct)}
                  </p>
                </div>
                <div>
                  <p class="text-[10px] text-[#6b7280] uppercase">Fc Accuracy</p>
                  <p class="text-sm font-bold" style="color:{cluster.avgForecastAccuracy >= 80 ? '#16a34a' : '#ca8a04'}">
                    {Math.round(cluster.avgForecastAccuracy)}
                  </p>
                </div>
              </div>
              <div class="mt-2 flex flex-wrap gap-1">
                {#each cluster.locations as name}
                  <span class="text-[9px] px-1.5 py-0.5 rounded" style="background:#e2e8f0;color:#475569;">{name}</span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-sm text-[#9ca3af] py-4 text-center">No city data available</p>
      {/if}
    </div>
  </div>

  {/if}
</div>
{/if}
