<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  let locationId = $state('');
  let locations = $state<{ id: string; name: string }[]>([]);
  let weeksBack = $state(4);
  let loading = $state(false);
  let data = $state<any>(null);
  let error = $state('');
  let isAdmin = $state(false);
  let authChecked = $state(false);
  let activeTab = $state<'helixo' | 'approved' | 'compare'>('approved');

  function fmt(n: number | null): string {
    if (n == null) return '-';
    return '$' + Math.round(n).toLocaleString();
  }
  function pct(n: number | null): string {
    if (n == null) return '-';
    return (n * 100).toFixed(1) + '%';
  }
  function shortDate(d: string): string {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function scoreColor(score: number): string {
    if (score >= 70) return '#16a34a';
    if (score >= 50) return '#ca8a04';
    return '#dc2626';
  }
  function mapeColor(mape: number): string {
    if (mape <= 0.08) return '#16a34a';
    if (mape <= 0.15) return '#ca8a04';
    return '#dc2626';
  }
  function mapeBg(mape: number): string {
    if (mape <= 0.08) return '#dcfce7';
    if (mape <= 0.15) return '#fef9c3';
    return '#fee2e2';
  }

  async function loadData() {
    if (!locationId) return;
    loading = true; error = ''; data = null;
    try {
      const params = new URLSearchParams({ locationId, weeksBack: String(weeksBack) });
      const res = await fetch(`/api/v1/admin/forecast-accuracy?${params}`);
      if (!res.ok) { error = (await res.json()).error || 'Failed'; return; }
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
          if (res.ok) { const d = await res.json(); isAdmin = d.permissions?.admin ?? false; }
        } catch { isAdmin = false; }
      }
      authChecked = true;
      if (!isAdmin) { goto('/dashboard'); return; }
      const locUrl = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(locUrl).then(r => r.json()).then(d => {
        locations = d.locations || d || [];
        if (locations.length > 0) {
          const saved = localStorage.getItem('helixo_selected_location');
          locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
          loadData();
        }
      });
    });
  });

  function gauge(score: number, grade: string): string {
    const r = 50, c = 60, circ = 2 * Math.PI * r;
    const offset = circ * (1 - score / 100);
    return `<svg viewBox="0 0 120 120" width="120" height="120">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="10"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="10"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"
        transform="rotate(-90 ${c} ${c})"/>
      <text x="${c}" y="${c - 6}" text-anchor="middle" font-size="28" font-weight="700" fill="#1a1a1a">${score}</text>
      <text x="${c}" y="${c + 14}" text-anchor="middle" font-size="14" font-weight="600" fill="${scoreColor(score)}">${grade}</text>
    </svg>`;
  }

  function barChart(items: any[], forecastKey: string): string {
    const valid = items.filter(i => i[forecastKey] != null || i.actual != null);
    if (valid.length === 0) return '';
    const maxVal = Math.max(...valid.map(i => Math.max(i[forecastKey] ?? 0, i.actual ?? 0)), 1);
    const w = 900, h = 220, pad = 40, barW = Math.min(14, (w - pad * 2) / valid.length / 2.5);
    const xStep = (w - pad * 2) / valid.length;
    let svg = `<svg viewBox="0 0 ${w} ${h + 30}" class="w-full" style="max-height:280px">`;
    for (let i = 0; i <= 4; i++) {
      const y = pad + (h - pad * 2) * (1 - i / 4);
      svg += `<line x1="${pad}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5"/>`;
      svg += `<text x="${pad - 4}" y="${y + 3}" text-anchor="end" fill="#9ca3af" font-size="9">$${(Math.round(maxVal * i / 4) / 1000).toFixed(0)}k</text>`;
    }
    valid.forEach((item, idx) => {
      const x = pad + idx * xStep + xStep / 2;
      const fcH = item[forecastKey] != null ? ((item[forecastKey] / maxVal) * (h - pad * 2)) : 0;
      const actH = item.actual != null ? ((item.actual / maxVal) * (h - pad * 2)) : 0;
      const baseY = h - pad;
      if (item[forecastKey] != null) svg += `<rect x="${x - barW - 1}" y="${baseY - fcH}" width="${barW}" height="${fcH}" fill="#1e3a5f" rx="2" opacity="0.7"/>`;
      if (item.actual != null) svg += `<rect x="${x + 1}" y="${baseY - actH}" width="${barW}" height="${actH}" fill="#16a34a" rx="2" opacity="0.7"/>`;
      if (idx % Math.max(1, Math.floor(valid.length / 10)) === 0) {
        svg += `<text x="${x}" y="${h - pad + 14}" text-anchor="middle" fill="#6b7280" font-size="8">${shortDate(item.date)}</text>`;
      }
    });
    const label = forecastKey === 'aiSuggested' ? 'AI Forecast' : 'Approved';
    svg += `<rect x="${w - 180}" y="6" width="10" height="10" fill="#1e3a5f" rx="2" opacity="0.7"/>`;
    svg += `<text x="${w - 166}" y="15" fill="#374151" font-size="10">${label}</text>`;
    svg += `<rect x="${w - 100}" y="6" width="10" height="10" fill="#16a34a" rx="2" opacity="0.7"/>`;
    svg += `<text x="${w - 86}" y="15" fill="#374151" font-size="10">Actual</text>`;
    svg += '</svg>';
    return svg;
  }

  function compDowChart(aiDow: any[], mgrDow: any[]): string {
    const w = 700, h = 200, pad = 50, barW = 16;
    const maxMape = Math.max(0.20, ...aiDow.map(d => d.mape), ...mgrDow.map(d => d.mape));
    const xStep = (w - pad * 2) / 7;
    let svg = `<svg viewBox="0 0 ${w} ${h + 30}" class="w-full" style="max-height:260px">`;
    for (let i = 0; i <= 4; i++) {
      const y = pad + (h - pad * 2) * (1 - i / 4);
      svg += `<line x1="${pad}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#e5e7eb" stroke-width="0.5"/>`;
      svg += `<text x="${pad - 4}" y="${y + 3}" text-anchor="end" fill="#9ca3af" font-size="9">${Math.round(maxMape * i / 4 * 100)}%</text>`;
    }
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days.forEach((day, idx) => {
      const x = pad + idx * xStep + xStep / 2;
      const aiM = aiDow[idx]?.mape ?? 0;
      const mgrM = mgrDow[idx]?.mape ?? 0;
      const aiH = (aiM / maxMape) * (h - pad * 2);
      const mgrH = (mgrM / maxMape) * (h - pad * 2);
      const baseY = h - pad;
      svg += `<rect x="${x - barW - 1}" y="${baseY - aiH}" width="${barW}" height="${Math.max(aiH, 1)}" fill="#6366f1" rx="2" opacity="0.8"/>`;
      svg += `<rect x="${x + 1}" y="${baseY - mgrH}" width="${barW}" height="${Math.max(mgrH, 1)}" fill="#1e3a5f" rx="2" opacity="0.8"/>`;
      svg += `<text x="${x}" y="${h - pad + 14}" text-anchor="middle" fill="#6b7280" font-size="9">${day}</text>`;
    });
    svg += `<rect x="${w - 220}" y="6" width="10" height="10" fill="#6366f1" rx="2" opacity="0.8"/>`;
    svg += `<text x="${w - 206}" y="15" fill="#374151" font-size="10">AI MAPE</text>`;
    svg += `<rect x="${w - 140}" y="6" width="10" height="10" fill="#1e3a5f" rx="2" opacity="0.8"/>`;
    svg += `<text x="${w - 126}" y="15" fill="#374151" font-size="10">Approved MAPE</text>`;
    svg += '</svg>';
    return svg;
  }
</script>

{#if !authChecked}
  <div class="p-6"><p class="text-sm text-[#9ca3af]">Checking access...</p></div>
{:else if !isAdmin}
  <div class="p-6"><p class="text-sm text-[#dc2626]">Admin access required</p></div>
{:else}
<div class="p-3 md:p-4">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
    <div>
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Forecast Accuracy</h1>
      <p class="text-sm text-[#6b7280]">Compare AI suggestions vs approved forecasts</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
      <select bind:value={weeksBack} onchange={loadData} class="leo-select">
        <option value={2}>2 weeks</option>
        <option value={4}>4 weeks</option>
        <option value={8}>8 weeks</option>
        <option value={13}>Full period</option>
      </select>
      <select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); loadData(); }} class="leo-select flex-1 sm:flex-none">
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
    </div>
  </div>

  {#if loading}
    <div class="leo-card p-12 text-center"><p class="text-sm text-[#9ca3af]">Loading analytics...</p></div>
  {:else if error}
    <div class="leo-card p-6"><p class="text-sm text-[#dc2626]">{error}</p></div>
  {:else if data}

  <!-- Tab Toggle -->
  <div class="flex gap-1 mb-6 p-1 rounded-lg" style="background:#f3f4f6;">
    <button class="flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-all" style="{activeTab === 'helixo' ? 'background:#1e3a5f;color:white;' : 'color:#6b7280;'}" onclick={() => activeTab = 'helixo'}>HELIXO AI</button>
    <button class="flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-all" style="{activeTab === 'approved' ? 'background:#1e3a5f;color:white;' : 'color:#6b7280;'}" onclick={() => activeTab = 'approved'}>Approved Forecast</button>
    <button class="flex-1 py-2 px-3 rounded-md text-sm font-semibold transition-all" style="{activeTab === 'compare' ? 'background:#1e3a5f;color:white;' : 'color:#6b7280;'}" onclick={() => activeTab = 'compare'}>Compare</button>
  </div>

  {#if activeTab === 'helixo' || activeTab === 'approved'}
  {@const acc = activeTab === 'helixo' ? data.helixoAccuracy : data.approvedAccuracy}
  {@const fcKey = activeTab === 'helixo' ? 'aiSuggested' : 'managerForecast'}
  {@const errKey = activeTab === 'helixo' ? 'aiErrorPct' : 'mgrErrorPct'}
  {@const errDollarKey = activeTab === 'helixo' ? 'aiError' : 'mgrError'}
  {@const label = activeTab === 'helixo' ? 'HELIXO AI' : 'Approved'}

  <!-- Score Card -->
  <div class="leo-card p-4 md:p-6 mb-6">
    <div class="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
      <div class="flex-shrink-0 relative" style="width:120px;height:120px;">
        {@html gauge(acc.score, acc.grade)}
      </div>
      <div class="flex-1">
        <div class="flex items-center gap-3 mb-2">
          <span class="text-lg font-semibold text-[#1a1a1a]">{label} Score</span>
          {#if acc.trend === 'improving'}
            <span class="text-xs font-medium px-2 py-0.5 rounded" style="background:#dcfce7;color:#16a34a;">Improving</span>
          {:else if acc.trend === 'declining'}
            <span class="text-xs font-medium px-2 py-0.5 rounded" style="background:#fee2e2;color:#dc2626;">Declining</span>
          {:else}
            <span class="text-xs font-medium px-2 py-0.5 rounded" style="background:#f3f4f6;color:#6b7280;">Stable</span>
          {/if}
        </div>
        <div class="flex flex-wrap gap-3 sm:gap-6 text-sm text-[#6b7280]">
          <span>MAPE: <strong class="text-[#1a1a1a]">{(acc.mape * 100).toFixed(1)}%</strong></span>
          <span>Bias: <strong class="text-[#1a1a1a]">{acc.bias >= 0 ? '+' : ''}{(acc.bias * 100).toFixed(1)}%</strong></span>
          <span>Forecasts: <strong class="text-[#1a1a1a]">{acc.totalForecasts}</strong></span>
        </div>
      </div>
    </div>
  </div>

  <!-- Breakdown Cards -->
  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mb-6">
    {#each [
      { label: 'Accuracy', score: acc.breakdown.accuracy, max: 30 },
      { label: 'Consistency', score: acc.breakdown.consistency, max: 20 },
      { label: 'Bias Control', score: acc.breakdown.biasControl, max: 20 },
      { label: 'Improvement', score: acc.breakdown.improvement, max: 15 },
      { label: 'Coverage', score: acc.breakdown.coverage, max: 15 },
    ] as card}
      <div class="leo-card p-4 text-center">
        <p class="text-xs uppercase tracking-wider text-[#6b7280] mb-1">{card.label}</p>
        <p class="text-2xl font-bold" style="color:{scoreColor(Math.round(card.score / card.max * 100))}">{card.score}<span class="text-sm font-normal text-[#9ca3af]">/{card.max}</span></p>
      </div>
    {/each}
  </div>

  <!-- Chart -->
  <div class="leo-card p-5 mb-6">
    <h2 class="leo-section-title mb-3">{label} vs Actual Revenue</h2>
    {#if data.dailyComparison.length > 0}
      {@html barChart(data.dailyComparison, fcKey)}
    {:else}
      <p class="text-sm text-[#9ca3af] py-8 text-center">No comparison data available</p>
    {/if}
  </div>

  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6">
    <!-- DOW Heatmap -->
    <div class="leo-card p-4 md:p-5">
      <h2 class="leo-section-title mb-3">Day-of-Week Accuracy</h2>
      <div class="grid grid-cols-7 gap-1">
        {#each acc.dowAnalysis as dow}
          <div class="rounded-lg p-3 text-center" style="background:{dow.count > 0 ? mapeBg(dow.mape) : '#f3f4f6'}">
            <p class="text-[10px] font-semibold text-[#374151] uppercase">{dow.dow.slice(0,3)}</p>
            <p class="text-lg font-bold mt-1" style="color:{dow.count > 0 ? mapeColor(dow.mape) : '#9ca3af'}">{dow.grade}</p>
            <p class="text-[10px] text-[#6b7280]">{dow.count > 0 ? (dow.mape * 100).toFixed(0) + '%' : '-'}</p>
          </div>
        {/each}
      </div>
      <div class="flex gap-4 mt-3 text-[10px] text-[#9ca3af]">
        <span><span class="inline-block w-3 h-3 rounded" style="background:#dcfce7"></span> &lt;8%</span>
        <span><span class="inline-block w-3 h-3 rounded" style="background:#fef9c3"></span> 8-15%</span>
        <span><span class="inline-block w-3 h-3 rounded" style="background:#fee2e2"></span> &gt;15%</span>
      </div>
    </div>

    <!-- Recommendations -->
    <div class="leo-card p-4 md:p-5">
      <h2 class="leo-section-title mb-3">Recommendations</h2>
      <div class="space-y-2">
        {#each data.recommendations as rec, i}
          <div class="flex items-start gap-3 py-2 {i < data.recommendations.length - 1 ? 'border-b border-[#e5e7eb]' : ''}">
            <span class="flex-shrink-0 mt-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style="background:#1e3a5f;color:white;">{i + 1}</span>
            <p class="text-sm text-[#374151]">{rec}</p>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Daily Detail -->
  <div class="leo-card p-4 md:p-5 mb-6">
    <h2 class="leo-section-title mb-3">{label} Daily Detail</h2>
    <div class="leo-table-scroll" style="max-height:400px;overflow-y:auto;">
      <table class="w-full leo-table">
        <thead class="sticky top-0">
          <tr>
            <th class="leo-th text-left">Date</th>
            <th class="leo-th">Day</th>
            <th class="leo-th">{label}</th>
            <th class="leo-th">Actual</th>
            <th class="leo-th">Error $</th>
            <th class="leo-th">Error %</th>
          </tr>
        </thead>
        <tbody>
          {#each data.dailyComparison as day}
            <tr>
              <td class="leo-td text-left text-xs">{shortDate(day.date)}</td>
              <td class="leo-td text-xs">{day.dayOfWeek.slice(0, 3)}</td>
              <td class="leo-td text-xs">{fmt(day[fcKey])}</td>
              <td class="leo-td text-xs font-medium">{fmt(day.actual)}</td>
              <td class="leo-td text-xs" style="color:{day[errDollarKey] != null ? (day[errDollarKey] >= 0 ? '#16a34a' : '#dc2626') : '#9ca3af'}">
                {day[errDollarKey] != null ? (day[errDollarKey] >= 0 ? '+' : '') + '$' + Math.abs(day[errDollarKey]).toLocaleString() : '-'}
              </td>
              <td class="leo-td text-xs" style="color:{day[errKey] != null ? (Math.abs(day[errKey]) <= 0.10 ? '#16a34a' : Math.abs(day[errKey]) <= 0.15 ? '#ca8a04' : '#dc2626') : '#9ca3af'}">
                {day[errKey] != null ? (day[errKey] >= 0 ? '+' : '') + (day[errKey] * 100).toFixed(1) + '%' : '-'}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  {:else}
  <!-- COMPARE TAB -->
  {@const ai = data.helixoAccuracy}
  {@const mgr = data.approvedAccuracy}
  {@const cmp = data.comparison}

  <!-- Side-by-side gauges -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
    <div class="leo-card p-5 text-center">
      <p class="text-xs uppercase tracking-wider text-[#6b7280] mb-3">HELIXO AI</p>
      <div class="flex justify-center">{@html gauge(ai.score, ai.grade)}</div>
      <div class="flex justify-center gap-4 mt-3 text-sm text-[#6b7280]">
        <span>MAPE: <strong>{(ai.mape * 100).toFixed(1)}%</strong></span>
        <span>Bias: <strong>{ai.bias >= 0 ? '+' : ''}{(ai.bias * 100).toFixed(1)}%</strong></span>
      </div>
    </div>
    <div class="leo-card p-5 text-center">
      <p class="text-xs uppercase tracking-wider text-[#6b7280] mb-3">Approved Forecast</p>
      <div class="flex justify-center">{@html gauge(mgr.score, mgr.grade)}</div>
      <div class="flex justify-center gap-4 mt-3 text-sm text-[#6b7280]">
        <span>MAPE: <strong>{(mgr.mape * 100).toFixed(1)}%</strong></span>
        <span>Bias: <strong>{mgr.bias >= 0 ? '+' : ''}{(mgr.bias * 100).toFixed(1)}%</strong></span>
      </div>
    </div>
  </div>

  <!-- Who was more accurate? -->
  <div class="leo-card p-5 mb-6">
    <h2 class="leo-section-title mb-3">Who Was More Accurate?</h2>
    <div class="grid grid-cols-3 gap-4 text-center mb-4">
      <div>
        <p class="text-2xl font-bold" style="color:#6366f1">{cmp.helixoBetter}</p>
        <p class="text-xs text-[#6b7280]">AI Closer</p>
      </div>
      <div>
        <p class="text-2xl font-bold text-[#9ca3af]">{cmp.same}</p>
        <p class="text-xs text-[#6b7280]">Same</p>
      </div>
      <div>
        <p class="text-2xl font-bold" style="color:#1e3a5f">{cmp.managerBetter}</p>
        <p class="text-xs text-[#6b7280]">Manager Closer</p>
      </div>
    </div>
    <!-- Progress bar -->
    {#if (cmp.helixoBetter + cmp.managerBetter + cmp.same) > 0}
      {@const total = cmp.helixoBetter + cmp.managerBetter + cmp.same}
      <div class="flex rounded-full overflow-hidden h-3 mb-3">
        <div style="width:{(cmp.helixoBetter / total * 100).toFixed(1)}%;background:#6366f1;"></div>
        <div style="width:{(cmp.same / total * 100).toFixed(1)}%;background:#d1d5db;"></div>
        <div style="width:{(cmp.managerBetter / total * 100).toFixed(1)}%;background:#1e3a5f;"></div>
      </div>
    {/if}
    <p class="text-sm text-[#374151] font-medium">{cmp.recommendation}</p>
  </div>

  <!-- DOW Comparison Chart -->
  <div class="leo-card p-5 mb-6">
    <h2 class="leo-section-title mb-3">Accuracy by Day of Week</h2>
    {@html compDowChart(ai.dowAnalysis, mgr.dowAnalysis)}
  </div>

  <!-- Head-to-head daily table -->
  <div class="leo-card p-4 md:p-5 mb-6">
    <h2 class="leo-section-title mb-3">Daily Head-to-Head</h2>
    <div class="leo-table-scroll" style="max-height:400px;overflow-y:auto;">
      <table class="w-full leo-table">
        <thead class="sticky top-0">
          <tr>
            <th class="leo-th text-left">Date</th>
            <th class="leo-th">Day</th>
            <th class="leo-th">AI Forecast</th>
            <th class="leo-th">Approved</th>
            <th class="leo-th">Actual</th>
            <th class="leo-th">AI Error</th>
            <th class="leo-th">Appr Error</th>
            <th class="leo-th">Winner</th>
          </tr>
        </thead>
        <tbody>
          {#each data.dailyComparison.filter((d: any) => d.actual != null) as day}
            {@const aiErr = day.aiErrorPct != null ? Math.abs(day.aiErrorPct) : null}
            {@const mgrErr = day.mgrErrorPct != null ? Math.abs(day.mgrErrorPct) : null}
            {@const winner = aiErr != null && mgrErr != null ? (Math.abs(aiErr - mgrErr) < 0.001 ? 'Tie' : aiErr < mgrErr ? 'AI' : 'Manager') : '-'}
            <tr>
              <td class="leo-td text-left text-xs">{shortDate(day.date)}</td>
              <td class="leo-td text-xs">{day.dayOfWeek.slice(0, 3)}</td>
              <td class="leo-td text-xs">{fmt(day.aiSuggested)}</td>
              <td class="leo-td text-xs">{fmt(day.managerForecast)}</td>
              <td class="leo-td text-xs font-medium">{fmt(day.actual)}</td>
              <td class="leo-td text-xs" style="color:{aiErr != null ? (aiErr <= 0.10 ? '#16a34a' : aiErr <= 0.15 ? '#ca8a04' : '#dc2626') : '#9ca3af'}">
                {aiErr != null ? (aiErr * 100).toFixed(1) + '%' : '-'}
              </td>
              <td class="leo-td text-xs" style="color:{mgrErr != null ? (mgrErr <= 0.10 ? '#16a34a' : mgrErr <= 0.15 ? '#ca8a04' : '#dc2626') : '#9ca3af'}">
                {mgrErr != null ? (mgrErr * 100).toFixed(1) + '%' : '-'}
              </td>
              <td class="leo-td text-xs font-semibold" style="color:{winner === 'AI' ? '#6366f1' : winner === 'Manager' ? '#1e3a5f' : '#9ca3af'}">
                {winner}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
  {/if}

  <!-- Weight History & Tag Impact (shared across all tabs) -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6 mb-6">
    <div class="leo-card p-4 md:p-5">
      <h2 class="leo-section-title mb-3">Adaptive Weight History</h2>
      {#if data.weightHistory.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full leo-table">
            <thead><tr>
              <th class="leo-th text-left">Date</th><th class="leo-th">Trailing</th><th class="leo-th">PY Growth</th><th class="leo-th">Momentum</th><th class="leo-th">Budget</th>
            </tr></thead>
            <tbody>
              {#each data.weightHistory.slice(-8) as w}
                <tr>
                  <td class="leo-td text-left text-xs">{shortDate(w.date)}</td>
                  <td class="leo-td text-xs">{w.trailing != null ? (w.trailing * 100).toFixed(0) + '%' : '-'}</td>
                  <td class="leo-td text-xs">{w.pyGrowth != null ? (w.pyGrowth * 100).toFixed(0) + '%' : '-'}</td>
                  <td class="leo-td text-xs">{w.momentum != null ? (w.momentum * 100).toFixed(0) + '%' : '-'}</td>
                  <td class="leo-td text-xs">{w.budget != null ? (w.budget * 100).toFixed(0) + '%' : '-'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="text-sm text-[#9ca3af] py-4 text-center">No weight history recorded yet</p>
      {/if}
    </div>

    <div class="leo-card p-4 md:p-5">
      <h2 class="leo-section-title mb-3">Override Tag Impact</h2>
      {#if data.tagImpact.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full leo-table">
            <thead><tr>
              <th class="leo-th text-left">Tag</th><th class="leo-th">Uses</th><th class="leo-th">Avg Rev Impact</th><th class="leo-th">Accuracy</th>
            </tr></thead>
            <tbody>
              {#each data.tagImpact as t}
                <tr>
                  <td class="leo-td text-left text-xs font-medium">{t.tag}</td>
                  <td class="leo-td text-xs">{t.occurrences}</td>
                  <td class="leo-td text-xs" style="color:{t.avgRevImpact >= 0 ? '#16a34a' : '#dc2626'}">
                    {t.avgRevImpact >= 0 ? '+' : ''}{(t.avgRevImpact * 100).toFixed(1)}%
                  </td>
                  <td class="leo-td text-xs">{(t.forecastAccuracy * 100).toFixed(0)}%</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="text-sm text-[#9ca3af] py-4 text-center">No override tags used yet</p>
      {/if}
    </div>
  </div>

  {/if}
</div>
{/if}
