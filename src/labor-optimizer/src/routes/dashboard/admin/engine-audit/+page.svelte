<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  let locationId = $state('');
  let locations = $state<{ id: string; name: string }[]>([]);
  let dateRange = $state('4w');
  let loading = $state(false);
  let data = $state<any>(null);
  let error = $state('');
  let isAdmin = $state(false);
  let authChecked = $state(false);
  let expandedRow = $state<string | null>(null);

  function fmt(n: number | null): string {
    if (n == null) return '-';
    return '$' + Math.round(n).toLocaleString();
  }
  function pct(n: number | null): string {
    if (n == null) return '-';
    return (n * 100).toFixed(1) + '%';
  }
  function scoreColor(score: number): string {
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#ca8a04';
    return '#dc2626';
  }
  function gradeColor(g: string): string {
    if (g === 'A') return '#16a34a';
    if (g === 'B') return '#2563eb';
    if (g === 'C') return '#ca8a04';
    return '#dc2626';
  }
  function passColor(pass: boolean): string { return pass ? '#16a34a' : '#dc2626'; }
  function passBg(pass: boolean): string { return pass ? '#dcfce7' : '#fee2e2'; }
  function statusColor(s: string): string {
    if (s === 'Confirmed') return '#16a34a';
    if (s === 'Minor adjustment suggested') return '#ca8a04';
    return '#dc2626';
  }
  function statusBg(s: string): string {
    if (s === 'Confirmed') return '#dcfce7';
    if (s === 'Minor adjustment suggested') return '#fef9c3';
    return '#fee2e2';
  }

  function getDateRange(): { startDate: string; endDate: string } {
    const end = new Date();
    const start = new Date();
    if (dateRange === '2w') start.setDate(start.getDate() - 14);
    else if (dateRange === '4w') start.setDate(start.getDate() - 28);
    else if (dateRange === '8w') start.setDate(start.getDate() - 56);
    else start.setDate(start.getDate() - 91);
    return {
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    };
  }

  async function loadData() {
    if (!locationId) return;
    loading = true;
    error = '';
    data = null;
    try {
      const { startDate, endDate } = getDateRange();
      const params = new URLSearchParams({ locationId, startDate, endDate, engine: 'both' });
      const res = await fetch(`/api/v1/admin/engine-audit?${params}`);
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

  function gauge(score: number, size: number = 100): string {
    const r = size * 0.42, c = size / 2, circ = 2 * Math.PI * r;
    const offset = circ * (1 - score / 100);
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${size * 0.08}"/>
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${scoreColor(score)}" stroke-width="${size * 0.08}"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round"
        transform="rotate(-90 ${c} ${c})"/>
      <text x="${c}" y="${c - 4}" text-anchor="middle" font-size="${size * 0.22}" font-weight="700" fill="#1a1a1a">${score}</text>
      <text x="${c}" y="${c + size * 0.14}" text-anchor="middle" font-size="${size * 0.11}" font-weight="600" fill="${scoreColor(score)}">${score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D'}</text>
    </svg>`;
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
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Engine Audit</h1>
      <p class="text-sm text-[#6b7280]">Revenue forecast and labor scheduling accuracy testing</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
      <select bind:value={dateRange} onchange={loadData} class="leo-select">
        <option value="2w">2 weeks</option>
        <option value="4w">4 weeks</option>
        <option value="8w">8 weeks</option>
        <option value="13w">Full quarter</option>
      </select>
      <select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); loadData(); }} class="leo-select flex-1 sm:flex-none">
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
    </div>
  </div>

  {#if loading}
    <div class="leo-card p-12 text-center"><p class="text-sm text-[#9ca3af]">Running engine audit...</p></div>
  {:else if error}
    <div class="leo-card p-6"><p class="text-sm text-[#dc2626]">{error}</p></div>
  {:else if data}

  <!-- Top Score Cards -->
  <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
    <div class="leo-card p-5 flex items-center gap-4">
      <div class="flex-shrink-0">{@html gauge(data.revenueEngine.overallScore, 100)}</div>
      <div>
        <p class="text-xs uppercase tracking-wider text-[#6b7280] mb-1">Revenue Engine</p>
        <p class="text-sm text-[#374151]">{data.revenueEngine.testsPassed}/{data.revenueEngine.testsRun} tests passed</p>
      </div>
    </div>
    <div class="leo-card p-5 flex items-center gap-4">
      <div class="flex-shrink-0">{@html gauge(data.laborEngine.overallScore, 100)}</div>
      <div>
        <p class="text-xs uppercase tracking-wider text-[#6b7280] mb-1">Labor Engine</p>
        <p class="text-sm text-[#374151]">{data.laborEngine.testsPassed}/{data.laborEngine.testsRun} tests passed</p>
      </div>
    </div>
    <div class="leo-card p-5 flex items-center gap-4">
      <div class="flex-shrink-0">
        {@html gauge(
          data.thresholdValidation.confirmedCount + data.thresholdValidation.adjustmentSuggested + data.thresholdValidation.significantVariance > 0
            ? Math.round(data.thresholdValidation.confirmedCount / (data.thresholdValidation.confirmedCount + data.thresholdValidation.adjustmentSuggested + data.thresholdValidation.significantVariance) * 100)
            : 0,
          100
        )}
      </div>
      <div>
        <p class="text-xs uppercase tracking-wider text-[#6b7280] mb-1">Threshold Validation</p>
        <p class="text-sm text-[#374151]">{data.thresholdValidation.confirmedCount} confirmed of {data.thresholdValidation.confirmedCount + data.thresholdValidation.adjustmentSuggested + data.thresholdValidation.significantVariance}</p>
      </div>
    </div>
  </div>

  <!-- Revenue Engine Section -->
  <div class="leo-card p-4 md:p-5 mb-6">
    <h2 class="leo-section-title mb-3">Revenue Forecast Engine ({data.revenueEngine.testsRun} Tests)</h2>
    <div class="leo-table-scroll" style="max-height:600px;overflow-y:auto;">
      <table class="w-full leo-table">
        <thead class="sticky top-0">
          <tr>
            <th class="leo-th text-left">#</th>
            <th class="leo-th text-left">Component</th>
            <th class="leo-th">Sample</th>
            <th class="leo-th">MAPE</th>
            <th class="leo-th">Bias</th>
            <th class="leo-th">Direction</th>
            <th class="leo-th">Grade</th>
            <th class="leo-th">Status</th>
            <th class="leo-th text-left">Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {#each data.revenueEngine.tests as test, i}
            <tr class="cursor-pointer hover:bg-[#f9fafb]" onclick={() => expandedRow = expandedRow === `rev-${i}` ? null : `rev-${i}`}>
              <td class="leo-td text-xs">{i + 1}</td>
              <td class="leo-td text-left text-xs font-medium">{test.component}</td>
              <td class="leo-td text-xs">{test.sampleSize}</td>
              <td class="leo-td text-xs" style="color:{test.mape > 0 ? (test.mape < 0.10 ? '#16a34a' : test.mape < 0.15 ? '#ca8a04' : '#dc2626') : '#6b7280'}">{test.mape > 0 ? pct(test.mape) : '-'}</td>
              <td class="leo-td text-xs" style="color:{test.bias !== 0 ? (test.bias > 0 ? '#ca8a04' : '#2563eb') : '#6b7280'}">{test.bias !== 0 ? (test.bias > 0 ? '+' : '') + pct(test.bias) : '-'}</td>
              <td class="leo-td text-xs">{test.directionalAccuracy > 0 ? pct(test.directionalAccuracy) : '-'}</td>
              <td class="leo-td"><span class="text-xs font-bold" style="color:{gradeColor(test.grade)}">{test.grade}</span></td>
              <td class="leo-td"><span class="text-[10px] font-medium px-2 py-0.5 rounded" style="background:{passBg(test.passFail)};color:{passColor(test.passFail)}">{test.passFail ? 'PASS' : 'FAIL'}</span></td>
              <td class="leo-td text-left text-xs text-[#6b7280]">{test.recommendation}</td>
            </tr>
            {#if expandedRow === `rev-${i}` && (test.bestDay || test.worstDay)}
              <tr>
                <td colspan="9" class="px-4 py-3" style="background:#f9fafb;">
                  <div class="flex gap-6 text-xs">
                    {#if test.bestDay}
                      <div><span class="font-semibold text-[#16a34a]">Best:</span> {test.bestDay.date} — Predicted {fmt(test.bestDay.predicted)}, Actual {fmt(test.bestDay.actual)} ({pct(test.bestDay.error)} error)</div>
                    {/if}
                    {#if test.worstDay}
                      <div><span class="font-semibold text-[#dc2626]">Worst:</span> {test.worstDay.date} — Predicted {fmt(test.worstDay.predicted)}, Actual {fmt(test.worstDay.actual)} ({pct(test.worstDay.error)} error)</div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Labor Engine Section -->
  <div class="leo-card p-4 md:p-5 mb-6">
    <h2 class="leo-section-title mb-3">Labor Scheduling Engine ({data.laborEngine.testsRun} Tests)</h2>
    <div class="leo-table-scroll" style="max-height:500px;overflow-y:auto;">
      <table class="w-full leo-table">
        <thead class="sticky top-0">
          <tr>
            <th class="leo-th text-left">#</th>
            <th class="leo-th text-left">Layer</th>
            <th class="leo-th">Sample</th>
            <th class="leo-th">MAPE</th>
            <th class="leo-th">Bias</th>
            <th class="leo-th">Direction</th>
            <th class="leo-th">Grade</th>
            <th class="leo-th">Status</th>
            <th class="leo-th text-left">Recommendation</th>
          </tr>
        </thead>
        <tbody>
          {#each data.laborEngine.tests as test, i}
            <tr class="cursor-pointer hover:bg-[#f9fafb]" onclick={() => expandedRow = expandedRow === `lab-${i}` ? null : `lab-${i}`}>
              <td class="leo-td text-xs">{i + 1}</td>
              <td class="leo-td text-left text-xs font-medium">{test.component}</td>
              <td class="leo-td text-xs">{test.sampleSize}</td>
              <td class="leo-td text-xs" style="color:{test.mape > 0 ? (test.mape < 0.10 ? '#16a34a' : test.mape < 0.15 ? '#ca8a04' : '#dc2626') : '#6b7280'}">{test.mape > 0 ? pct(test.mape) : '-'}</td>
              <td class="leo-td text-xs" style="color:{test.bias !== 0 ? (test.bias > 0 ? '#ca8a04' : '#2563eb') : '#6b7280'}">{test.bias !== 0 ? (test.bias > 0 ? '+' : '') + pct(test.bias) : '-'}</td>
              <td class="leo-td text-xs">{test.directionalAccuracy > 0 ? pct(test.directionalAccuracy) : '-'}</td>
              <td class="leo-td"><span class="text-xs font-bold" style="color:{gradeColor(test.grade)}">{test.grade}</span></td>
              <td class="leo-td"><span class="text-[10px] font-medium px-2 py-0.5 rounded" style="background:{passBg(test.passFail)};color:{passColor(test.passFail)}">{test.passFail ? 'PASS' : 'FAIL'}</span></td>
              <td class="leo-td text-left text-xs text-[#6b7280]">{test.recommendation}</td>
            </tr>
            {#if expandedRow === `lab-${i}` && (test.bestDay || test.worstDay)}
              <tr>
                <td colspan="9" class="px-4 py-3" style="background:#f9fafb;">
                  <div class="flex gap-6 text-xs">
                    {#if test.bestDay}
                      <div><span class="font-semibold text-[#16a34a]">Best:</span> {test.bestDay.date} — Target {fmt(test.bestDay.predicted)}, Actual {fmt(test.bestDay.actual)} ({pct(test.bestDay.error)} error)</div>
                    {/if}
                    {#if test.worstDay}
                      <div><span class="font-semibold text-[#dc2626]">Worst:</span> {test.worstDay.date} — Target {fmt(test.worstDay.predicted)}, Actual {fmt(test.worstDay.actual)} ({pct(test.worstDay.error)} error)</div>
                    {/if}
                  </div>
                </td>
              </tr>
            {/if}
          {/each}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Threshold Validation Section -->
  {#if data.thresholdValidation.details.length > 0}
  <div class="leo-card p-4 md:p-5 mb-6">
    <h2 class="leo-section-title mb-1">Threshold Validation</h2>
    <p class="text-xs text-[#9ca3af] mb-3">Comparing your original labor thresholds (BASE truth) against what actuals suggest</p>
    <div class="leo-table-scroll" style="max-height:500px;overflow-y:auto;">
      <table class="w-full leo-table">
        <thead class="sticky top-0">
          <tr>
            <th class="leo-th text-left">Revenue Bracket</th>
            <th class="leo-th text-left">Position</th>
            <th class="leo-th">Original Threshold</th>
            <th class="leo-th">Actual Labor</th>
            <th class="leo-th">Suggested</th>
            <th class="leo-th">Variance</th>
            <th class="leo-th">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each data.thresholdValidation.details as tv}
            <tr>
              <td class="leo-td text-left text-xs font-medium">{tv.bracket}</td>
              <td class="leo-td text-left text-xs">{tv.position}</td>
              <td class="leo-td text-xs">{fmt(tv.originalThreshold)}</td>
              <td class="leo-td text-xs font-medium">{fmt(tv.actualLabor)}</td>
              <td class="leo-td text-xs" style="color:{tv.status === 'Confirmed' ? '#6b7280' : '#1e3a5f'}">{fmt(tv.suggestedThreshold)}</td>
              <td class="leo-td text-xs" style="color:{Math.abs(tv.variance) <= 0.03 ? '#16a34a' : Math.abs(tv.variance) <= 0.08 ? '#ca8a04' : '#dc2626'}">
                {tv.variance >= 0 ? '+' : ''}{pct(tv.variance)}
              </td>
              <td class="leo-td">
                <span class="text-[10px] font-medium px-2 py-0.5 rounded" style="background:{statusBg(tv.status)};color:{statusColor(tv.status)}">
                  {tv.status === 'Confirmed' ? 'Confirmed' : tv.status === 'Minor adjustment suggested' ? 'Minor Adj' : 'Review'}
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="flex gap-4 mt-3 text-[10px] text-[#9ca3af]">
      <span><span class="inline-block w-3 h-3 rounded" style="background:#dcfce7"></span> Within 3% = Confirmed</span>
      <span><span class="inline-block w-3 h-3 rounded" style="background:#fef9c3"></span> 3-8% = Minor adjustment</span>
      <span><span class="inline-block w-3 h-3 rounded" style="background:#fee2e2"></span> >8% = Significant variance</span>
    </div>
  </div>
  {/if}

  <!-- Info Note -->
  <div class="leo-card p-4 mb-6" style="background:#f0f4ff;border-left:3px solid #1e3a5f;">
    <p class="text-xs text-[#374151]">
      <strong>Note:</strong> Your original labor thresholds (from Excel) are the BASE truth. All intelligence layers exist to validate, challenge, or refine those assumptions. Threshold Validation above compares actuals back to your original thresholds and suggests adjustments only when data consistently supports a change.
    </p>
  </div>

  {/if}
</div>
{/if}
