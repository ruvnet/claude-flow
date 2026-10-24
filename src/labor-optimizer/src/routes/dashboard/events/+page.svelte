<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  let locationId = $state('');
  let locations = $state<{ id: string; name: string }[]>([]);
  let singleLocation = $state(false);
  let year = $state(new Date().getFullYear());
  let selectedMonth = $state<number | null>(null);
  let loading = $state(false);
  let error = $state('');
  let paceData = $state<any>(null);

  // Budget modal
  let showBudgetModal = $state(false);
  let budgetMonth = $state(1);
  let budgetForm = $state({ food: 0, beverage: 0, rental: 0, av: 0, other: 0 });
  let savingBudget = $state(false);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // Industry best-in-class tentative pickup rate for private events (~60%)
  const TENTATIVE_PICKUP_PCT = 0.60;

  function fmt(n: number | null | undefined): string {
    if (n == null) return '-';
    return '$' + Math.round(n).toLocaleString();
  }

  function pct(n: number | null | undefined): string {
    if (n == null) return '-';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }

  function varClass(n: number | null | undefined): string {
    if (n == null) return '';
    return n >= 0 ? 'text-emerald-600' : 'text-red-500';
  }

  async function loadPaceData() {
    if (!locationId) return;
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams({ locationId, year: String(year) });
      if (selectedMonth) params.set('month', String(selectedMonth));
      const res = await fetch(`/api/v1/events/pace?${params}`);
      if (!res.ok) {
        const d = await res.json();
        error = d.error || 'Failed to load pace data';
        return;
      }
      paceData = await res.json();
    } catch (e: any) {
      error = e.message || 'Network error';
    } finally {
      loading = false;
    }
  }

  async function saveBudget() {
    savingBudget = true;
    try {
      await fetch('/api/v1/events/budget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          year,
          month: budgetMonth,
          food_budget: budgetForm.food,
          beverage_budget: budgetForm.beverage,
          rental_budget: budgetForm.rental,
          av_budget: budgetForm.av,
          other_budget: budgetForm.other,
        }),
      });
      showBudgetModal = false;
      await loadPaceData();
    } catch (e: any) {
      error = e.message;
    } finally {
      savingBudget = false;
    }
  }

  function openBudgetModal(month: number) {
    budgetMonth = month;
    // Pre-fill from existing PACE data if available
    const existing = paceData?.paceByMonth?.find((m: any) => m.month === month);
    budgetForm = { food: 0, beverage: 0, rental: 0, av: 0, other: 0 };
    showBudgetModal = true;
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email;
      const url = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(url)
        .then(r => r.json())
        .then(d => {
          locations = d.locations || d || [];
          singleLocation = locations.length === 1;
          if (locations.length > 0) {
            const saved = localStorage.getItem('helixo_selected_location');
            locationId = (saved && locations.some(l => l.id === saved)) ? saved : locations[0].id;
          }
        });
    });
  });

  $effect(() => {
    if (locationId) loadPaceData();
  });

  // Derived KPI totals
  let totalOTB = $derived(paceData?.paceByMonth?.reduce((s: number, m: any) => s + m.totalOTB, 0) ?? 0);
  let totalBudget = $derived(paceData?.paceByMonth?.reduce((s: number, m: any) => s + (m.budget || 0), 0) ?? 0);
  let totalSTLY = $derived(paceData?.paceByMonth?.reduce((s: number, m: any) => s + (m.stly || 0), 0) ?? 0);
  let budgetVarPct = $derived(totalBudget ? ((totalOTB - totalBudget) / totalBudget) * 100 : null);
  let stlyVarPct = $derived(totalSTLY ? ((totalOTB - totalSTLY) / totalSTLY) * 100 : null);
</script>

<div class="p-3 md:p-4">
  <div class="mb-6">
    <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Events PACE Report</h1>
    <p class="text-sm text-[#6b7280]">Revenue on the books, pacing vs budget, STLY, and event segmentation</p>
  </div>

  <!-- Controls -->
  <div class="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-6 sm:items-end flex-wrap">
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Location</label>
      {#if singleLocation}
        <span class="text-sm font-medium text-[#374151] py-2">{locations[0]?.name}</span>
      {:else}
        <select bind:value={locationId} onchange={() => localStorage.setItem('helixo_selected_location', locationId)} class="leo-select">
          {#each locations as loc}
            <option value={loc.id}>{loc.name}</option>
          {/each}
        </select>
      {/if}
    </div>
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Year</label>
      <select bind:value={year} class="leo-select">
        <option value={2025}>2025</option>
        <option value={2026}>2026</option>
        <option value={2027}>2027</option>
      </select>
    </div>
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Month</label>
      <select bind:value={selectedMonth} class="leo-select">
        <option value={null}>Full Year</option>
        {#each MONTHS as m, i}
          <option value={i + 1}>{m}</option>
        {/each}
      </select>
    </div>
    <button onclick={loadPaceData} class="leo-btn-primary h-9 px-4 text-sm">Refresh</button>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-16">
      <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1e3a5f]"></div>
    </div>
  {:else if error}
    <div class="bg-red-50 text-red-700 p-4 rounded-lg text-sm">{error}</div>
  {:else if paceData}

    <!-- KPI Cards -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <div class="bg-white rounded-lg border border-[#e5e7eb] p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide">Total OTB</div>
        <div class="text-2xl font-bold text-[#1e3a5f] mt-1">{fmt(totalOTB)}</div>
        <div class="text-xs text-[#6b7280] mt-1">{paceData.kpiSummary.totalEvents} events</div>
      </div>
      <div class="bg-white rounded-lg border border-[#e5e7eb] p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide">vs Budget</div>
        {#if totalBudget}
          <div class="text-2xl font-bold {varClass(budgetVarPct)} mt-1">{pct(budgetVarPct)}</div>
          <div class="text-xs text-[#6b7280] mt-1">{fmt(totalOTB - totalBudget)}</div>
        {:else}
          <div class="text-2xl font-bold text-[#9ca3af] mt-1">--</div>
          <div class="text-xs text-[#6b7280] mt-1">No budget set</div>
        {/if}
      </div>
      <div class="bg-white rounded-lg border border-[#e5e7eb] p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide">vs STLY</div>
        {#if totalSTLY}
          <div class="text-2xl font-bold {varClass(stlyVarPct)} mt-1">{pct(stlyVarPct)}</div>
          <div class="text-xs text-[#6b7280] mt-1">{fmt(totalOTB - totalSTLY)}</div>
        {:else}
          <div class="text-2xl font-bold text-[#9ca3af] mt-1">--</div>
        {/if}
      </div>
      <div class="bg-white rounded-lg border border-[#e5e7eb] p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide">Lead Response</div>
        <div class="text-2xl font-bold text-[#1e3a5f] mt-1">{paceData.leadMetrics.responseRate.toFixed(0)}%</div>
        <div class="text-xs text-[#6b7280] mt-1">{paceData.leadMetrics.responded}/{paceData.leadMetrics.totalLeads} responded</div>
      </div>
    </div>

    <!-- PACE Table -->
    <div class="bg-white rounded-lg border border-[#e5e7eb] mb-6 overflow-x-auto">
      <div class="flex items-center justify-between p-4 border-b border-[#e5e7eb]">
        <h2 class="text-sm font-semibold text-[#1a1a1a]">Monthly PACE</h2>
        <button onclick={() => openBudgetModal(selectedMonth || new Date().getMonth() + 1)} class="text-xs text-[#1e3a5f] hover:underline">Edit Budget</button>
      </div>
      <table class="w-full text-xs">
        <thead>
          <tr class="bg-[#f9fafb] text-[#6b7280] uppercase tracking-wide">
            <th class="text-left px-3 py-2">Month</th>
            <th class="text-right px-3 py-2">Definite</th>
            <th class="text-right px-3 py-2">Closed</th>
            <th class="text-right px-3 py-2 bg-[#f0f7ff]">Total OTB</th>
            <th class="text-right px-3 py-2 text-amber-700">Tentative</th>
            <th class="text-right px-3 py-2">Prospect</th>
            <th class="text-right px-3 py-2 bg-[#f5f0ff]" title="OTB + 60% of Tentative pickup">Act/For</th>
            <th class="text-right px-3 py-2">BUDGET (Goals)</th>
            <th class="text-right px-3 py-2">Var $</th>
            <th class="text-right px-3 py-2">Var %</th>
            <th class="text-right px-3 py-2">STLY</th>
            <th class="text-right px-3 py-2">vs STLY</th>
          </tr>
        </thead>
        <tbody>
          {#each paceData.paceByMonth as row}
            {@const actFor = row.totalOTB + (row.tentative.revenue * TENTATIVE_PICKUP_PCT)}
            <tr class="border-t border-[#f3f4f6] hover:bg-[#f9fafb]">
              <td class="px-3 py-2 font-medium text-[#374151]">{MONTHS[row.month - 1]} {row.year}</td>
              <td class="text-right px-3 py-2">{fmt(row.definite.revenue)}</td>
              <td class="text-right px-3 py-2">{fmt(row.closed.revenue)}</td>
              <td class="text-right px-3 py-2 font-semibold bg-[#f0f7ff] text-[#1e3a5f]">{fmt(row.totalOTB)}</td>
              <td class="text-right px-3 py-2 text-amber-600">{fmt(row.tentative.revenue)}</td>
              <td class="text-right px-3 py-2 text-[#9ca3af]">{fmt(row.prospect.revenue)}</td>
              <td class="text-right px-3 py-2 font-semibold bg-[#f5f0ff] text-[#6b21a8]">{fmt(actFor)}</td>
              <td class="text-right px-3 py-2">{row.budget ? fmt(row.budget) : '-'}</td>
              <td class="text-right px-3 py-2 {varClass(row.varianceToBudget)}">{row.varianceToBudget != null ? fmt(row.varianceToBudget) : '-'}</td>
              <td class="text-right px-3 py-2 {varClass(row.varianceToBudgetPct)}">{row.varianceToBudgetPct != null ? pct(row.varianceToBudgetPct) : '-'}</td>
              <td class="text-right px-3 py-2">{fmt(row.stly)}</td>
              <td class="text-right px-3 py-2 {varClass(row.varianceToSTLYPct)}">{row.varianceToSTLYPct != null ? pct(row.varianceToSTLYPct) : '-'}</td>
            </tr>
          {/each}
          <!-- Totals Row -->
          {#if paceData.paceByMonth.length > 1}
            {@const totals = paceData.paceByMonth.reduce((acc: any, r: any) => ({
              definite: acc.definite + r.definite.revenue,
              closed: acc.closed + r.closed.revenue,
              tentative: acc.tentative + r.tentative.revenue,
              prospect: acc.prospect + r.prospect.revenue,
              otb: acc.otb + r.totalOTB,
              budget: acc.budget + (r.budget || 0),
              stly: acc.stly + (r.stly || 0),
            }), { definite: 0, closed: 0, tentative: 0, prospect: 0, otb: 0, budget: 0, stly: 0 })}
            {@const totActFor = totals.otb + (totals.tentative * TENTATIVE_PICKUP_PCT)}
            <tr class="border-t-2 border-[#1e3a5f] font-semibold bg-[#f9fafb]">
              <td class="px-3 py-2 text-[#1e3a5f]">TOTAL</td>
              <td class="text-right px-3 py-2">{fmt(totals.definite)}</td>
              <td class="text-right px-3 py-2">{fmt(totals.closed)}</td>
              <td class="text-right px-3 py-2 bg-[#f0f7ff] text-[#1e3a5f]">{fmt(totals.otb)}</td>
              <td class="text-right px-3 py-2 text-amber-600">{fmt(totals.tentative)}</td>
              <td class="text-right px-3 py-2 text-[#9ca3af]">{fmt(totals.prospect)}</td>
              <td class="text-right px-3 py-2 bg-[#f5f0ff] text-[#6b21a8]">{fmt(totActFor)}</td>
              <td class="text-right px-3 py-2">{totals.budget ? fmt(totals.budget) : '-'}</td>
              <td class="text-right px-3 py-2 {varClass(totals.budget ? totals.otb - totals.budget : null)}">{totals.budget ? fmt(totals.otb - totals.budget) : '-'}</td>
              <td class="text-right px-3 py-2 {varClass(totals.budget ? ((totals.otb - totals.budget)/totals.budget)*100 : null)}">{totals.budget ? pct(((totals.otb - totals.budget)/totals.budget)*100) : '-'}</td>
              <td class="text-right px-3 py-2">{fmt(totals.stly)}</td>
              <td class="text-right px-3 py-2 {varClass(totals.stly ? ((totals.otb - totals.stly)/totals.stly)*100 : null)}">{totals.stly ? pct(((totals.otb - totals.stly)/totals.stly)*100) : '-'}</td>
            </tr>
          {/if}
        </tbody>
      </table>
    </div>

    <!-- Top Events + Event Type side by side -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

      <!-- Top Events -->
      <div class="bg-white rounded-lg border border-[#e5e7eb]">
        <div class="p-4 border-b border-[#e5e7eb]">
          <h2 class="text-sm font-semibold text-[#1a1a1a]">Top Events</h2>
          <p class="text-xs text-[#6b7280] mt-0.5">3 highest-revenue confirmed events</p>
        </div>
        <div class="divide-y divide-[#f3f4f6]">
          {#each (paceData.topEvents || []) as evt, i}
            <div class="p-4">
              <div class="flex items-start gap-3">
                <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5"
                  style="background: {i === 0 ? '#fef9c3' : i === 1 ? '#f3f4f6' : '#fef2f2'}; color: {i === 0 ? '#a16207' : i === 1 ? '#374151' : '#dc2626'};">
                  {i + 1}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="text-sm font-semibold text-[#1e3a5f]">{evt.name}</div>
                  <!-- Contact + Account -->
                  {#if evt.contactName || evt.accountName}
                    <div class="text-xs text-[#374151] mt-0.5">
                      {#if evt.contactName}<span class="font-medium">{evt.contactName}</span>{/if}
                      {#if evt.contactName && evt.accountName}<span class="text-[#9ca3af]"> · </span>{/if}
                      {#if evt.accountName}<span class="text-[#6b7280]">{evt.accountName}</span>{/if}
                    </div>
                  {/if}
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1">
                    <span class="text-xs text-[#6b7280]">{evt.type}</span>
                    {#if evt.date}
                      <span class="text-xs text-[#9ca3af]">·</span>
                      <span class="text-xs text-[#6b7280]">{new Date(evt.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    {/if}
                    {#if evt.covers}
                      <span class="text-xs text-[#9ca3af]">·</span>
                      <span class="text-xs text-[#6b7280]">{evt.covers} covers</span>
                    {/if}
                    {#if evt.roomName}
                      <span class="text-xs text-[#9ca3af]">·</span>
                      <span class="text-xs text-[#6b7280]">{evt.roomName}</span>
                    {/if}
                    {#if evt.salesManager}
                      <span class="text-xs text-[#9ca3af]">·</span>
                      <span class="text-xs text-[#6b7280]">Mgr: {evt.salesManager}</span>
                    {/if}
                  </div>
                  <!-- Revenue breakdown -->
                  <div class="mt-2 grid grid-cols-3 gap-1 text-xs">
                    {#if evt.foodRevenue > 0}<div class="bg-[#f0fdf4] rounded px-1.5 py-0.5"><span class="text-[#6b7280]">Food</span> <span class="font-medium text-[#374151]">{fmt(evt.foodRevenue)}</span></div>{/if}
                    {#if evt.beverageRevenue > 0}<div class="bg-[#eff6ff] rounded px-1.5 py-0.5"><span class="text-[#6b7280]">Bev</span> <span class="font-medium text-[#374151]">{fmt(evt.beverageRevenue)}</span></div>{/if}
                    {#if evt.rentalRevenue > 0}<div class="bg-[#faf5ff] rounded px-1.5 py-0.5"><span class="text-[#6b7280]">Rental</span> <span class="font-medium text-[#374151]">{fmt(evt.rentalRevenue)}</span></div>{/if}
                    {#if evt.avRevenue > 0}<div class="bg-[#fff7ed] rounded px-1.5 py-0.5"><span class="text-[#6b7280]">AV</span> <span class="font-medium text-[#374151]">{fmt(evt.avRevenue)}</span></div>{/if}
                    {#if evt.otherRevenue > 0}<div class="bg-[#f9fafb] rounded px-1.5 py-0.5"><span class="text-[#6b7280]">Other</span> <span class="font-medium text-[#374151]">{fmt(evt.otherRevenue)}</span></div>{/if}
                    {#if evt.serviceCharge > 0}<div class="bg-[#f9fafb] rounded px-1.5 py-0.5"><span class="text-[#6b7280]">Svc</span> <span class="font-medium text-[#374151]">{fmt(evt.serviceCharge)}</span></div>{/if}
                  </div>
                </div>
                <div class="flex-shrink-0 text-right">
                  <div class="text-sm font-bold text-[#1e3a5f]">{fmt(evt.revenue)}</div>
                  {#if evt.grandTotal > evt.revenue}<div class="text-xs text-[#6b7280]">Grand: {fmt(evt.grandTotal)}</div>{/if}
                </div>
              </div>
            </div>
          {/each}
          {#if !paceData.topEvents || paceData.topEvents.length === 0}
            <div class="p-6 text-center text-xs text-[#9ca3af]">No confirmed events found</div>
          {/if}
        </div>
      </div>

      <!-- Events by Market Segment -->
      <div class="bg-white rounded-lg border border-[#e5e7eb]">
        <div class="p-4 border-b border-[#e5e7eb]">
          <h2 class="text-sm font-semibold text-[#1a1a1a]">Events by Market Segment</h2>
        </div>
        <table class="w-full text-xs">
          <thead>
            <tr class="bg-[#f9fafb] text-[#6b7280] uppercase tracking-wide">
              <th class="text-left px-3 py-2">Type</th>
              <th class="text-right px-3 py-2">Count</th>
              <th class="text-right px-3 py-2">Revenue</th>
              <th class="text-right px-3 py-2">Avg Rev</th>
              <th class="text-right px-3 py-2">Avg Covers</th>
            </tr>
          </thead>
          <tbody>
            {#each paceData.byEventType as row}
              <tr class="border-t border-[#f3f4f6]">
                <td class="px-3 py-2 font-medium text-[#374151]">{row.type}</td>
                <td class="text-right px-3 py-2">{row.count}</td>
                <td class="text-right px-3 py-2">{fmt(row.revenue)}</td>
                <td class="text-right px-3 py-2">{fmt(row.avgRevenue)}</td>
                <td class="text-right px-3 py-2">{row.avgCovers}</td>
              </tr>
            {/each}
            {#if paceData.byEventType.length === 0}
              <tr><td colspan="5" class="px-3 py-6 text-center text-[#9ca3af]">No events found</td></tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Lead Metrics + KPI Summary -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

      <!-- Lead Funnel -->
      <div class="bg-white rounded-lg border border-[#e5e7eb]">
        <div class="p-4 border-b border-[#e5e7eb]">
          <h2 class="text-sm font-semibold text-[#1a1a1a]">Lead Metrics</h2>
        </div>
        <div class="p-4 grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Total Leads</div>
            <div class="text-xl font-bold text-[#1e3a5f]">{paceData.leadMetrics.totalLeads}</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Response Rate</div>
            <div class="text-xl font-bold text-[#1e3a5f]">{paceData.leadMetrics.responseRate.toFixed(0)}%</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Conversion Rate</div>
            <div class="text-xl font-bold text-[#1e3a5f]">{paceData.leadMetrics.conversionRate.toFixed(0)}%</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Avg Response Time</div>
            <div class="text-xl font-bold text-[#1e3a5f]">{paceData.leadMetrics.avgResponseTimeHours ?? '-'} hrs</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Converted</div>
            <div class="text-xl font-bold text-emerald-600">{paceData.leadMetrics.convertedCount}</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Responded</div>
            <div class="text-xl font-bold text-[#374151]">{paceData.leadMetrics.responded}</div>
          </div>
        </div>
      </div>

      <!-- KPI Summary -->
      <div class="bg-white rounded-lg border border-[#e5e7eb]">
        <div class="p-4 border-b border-[#e5e7eb]">
          <h2 class="text-sm font-semibold text-[#1a1a1a]">Event KPIs</h2>
        </div>
        <div class="p-4 grid grid-cols-2 gap-4">
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Revenue / Cover</div>
            <div class="text-xl font-bold text-[#1e3a5f]">{fmt(paceData.kpiSummary.revenuePerCover)}</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Avg Check / Event</div>
            <div class="text-xl font-bold text-[#1e3a5f]">{fmt(paceData.kpiSummary.avgCheckPerEvent)}</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Total Covers</div>
            <div class="text-xl font-bold text-[#374151]">{paceData.kpiSummary.totalCovers.toLocaleString()}</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase">Total Events</div>
            <div class="text-xl font-bold text-[#374151]">{paceData.kpiSummary.totalEvents}</div>
          </div>
          <!-- Pipeline breakdown -->
          <div class="col-span-2 flex gap-3 mt-2 pt-3 border-t border-[#f3f4f6]">
            <div class="flex-1 text-center">
              <div class="text-xs text-[#6b7280]">Definite</div>
              <div class="text-sm font-bold text-emerald-600">{paceData.kpiSummary.definiteCount}</div>
            </div>
            <div class="flex-1 text-center">
              <div class="text-xs text-[#6b7280]">Tentative</div>
              <div class="text-sm font-bold text-amber-600">{paceData.kpiSummary.tentativeCount}</div>
            </div>
            <div class="flex-1 text-center">
              <div class="text-xs text-[#6b7280]">Prospect</div>
              <div class="text-sm font-bold text-[#9ca3af]">{paceData.kpiSummary.prospectCount}</div>
            </div>
            <div class="flex-1 text-center">
              <div class="text-xs text-[#6b7280]">Closed</div>
              <div class="text-sm font-bold text-[#1e3a5f]">{paceData.kpiSummary.closedCount}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Deposits / AR Section -->
    {#if paceData.depositsSection}
      {@const ds = paceData.depositsSection}
      <div class="bg-white rounded-lg border border-[#e5e7eb] mb-6">
        <div class="p-4 border-b border-[#e5e7eb] flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-[#1a1a1a]">Deposits &amp; AR</h2>
            <p class="text-xs text-[#6b7280] mt-0.5">Contracted amounts and outstanding balances for confirmed events</p>
          </div>
          <span class="text-xs text-[#9ca3af] italic">Payment sync required for actual deposit tracking</span>
        </div>
        <div class="p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div class="text-xs text-[#6b7280] uppercase tracking-wide">Total Contracted</div>
            <div class="text-xl font-bold text-[#1e3a5f] mt-1">{fmt(ds.totalContracted)}</div>
            <div class="text-xs text-[#9ca3af] mt-0.5">Food + bev + rental</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase tracking-wide">Total Invoiced</div>
            <div class="text-xl font-bold text-[#374151] mt-1">{fmt(ds.totalInvoiced)}</div>
            <div class="text-xs text-[#9ca3af] mt-0.5">Incl. svc charge + tax</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase tracking-wide">Outstanding AR</div>
            <div class="text-xl font-bold text-amber-600 mt-1">{fmt(ds.outstandingAR)}</div>
            <div class="text-xs text-[#9ca3af] mt-0.5">{ds.upcomingEventCount} upcoming definite events</div>
          </div>
          <div>
            <div class="text-xs text-[#6b7280] uppercase tracking-wide">Svc Charge + Tax</div>
            <div class="text-xl font-bold text-[#374151] mt-1">{fmt(ds.totalServiceCharge + ds.totalTax)}</div>
            <div class="text-xs text-[#9ca3af] mt-0.5">
              {fmt(ds.totalServiceCharge)} svc · {fmt(ds.totalTax)} tax
            </div>
          </div>
        </div>
        <div class="px-4 pb-3 border-t border-[#f3f4f6] pt-2">
          <p class="text-xs text-[#9ca3af]">
            ⓘ Outstanding AR reflects the grand total for future confirmed events not yet occurred. To track actual deposits received and remaining balances, enable TripleSeat payment sync.
          </p>
        </div>
      </div>
    {/if}

  {:else}
    <div class="text-center py-16 text-[#9ca3af]">Select a location to view event pace data</div>
  {/if}
</div>

<!-- Budget Modal -->
{#if showBudgetModal}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onclick={() => showBudgetModal = false}>
    <div class="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 p-6" onclick={(e) => e.stopPropagation()}>
      <h3 class="text-lg font-semibold text-[#1a1a1a] mb-4">Event Budget — {MONTHS[budgetMonth - 1]} {year}</h3>
      <div class="space-y-3">
        <div>
          <label class="text-xs text-[#6b7280] uppercase block mb-1">Food Revenue Budget</label>
          <input type="number" bind:value={budgetForm.food} class="leo-input w-full" placeholder="0" />
        </div>
        <div>
          <label class="text-xs text-[#6b7280] uppercase block mb-1">Beverage Revenue Budget</label>
          <input type="number" bind:value={budgetForm.beverage} class="leo-input w-full" placeholder="0" />
        </div>
        <div>
          <label class="text-xs text-[#6b7280] uppercase block mb-1">Room Rental Budget</label>
          <input type="number" bind:value={budgetForm.rental} class="leo-input w-full" placeholder="0" />
        </div>
        <div>
          <label class="text-xs text-[#6b7280] uppercase block mb-1">AV Budget</label>
          <input type="number" bind:value={budgetForm.av} class="leo-input w-full" placeholder="0" />
        </div>
        <div>
          <label class="text-xs text-[#6b7280] uppercase block mb-1">Other Budget</label>
          <input type="number" bind:value={budgetForm.other} class="leo-input w-full" placeholder="0" />
        </div>
        <div class="border-t border-[#e5e7eb] pt-3">
          <div class="text-xs text-[#6b7280] uppercase">Total</div>
          <div class="text-lg font-bold text-[#1e3a5f]">{fmt(budgetForm.food + budgetForm.beverage + budgetForm.rental + budgetForm.av + budgetForm.other)}</div>
        </div>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick={() => showBudgetModal = false} class="flex-1 px-4 py-2 text-sm border border-[#d1d5db] rounded-lg hover:bg-[#f9fafb]">Cancel</button>
        <button onclick={saveBudget} disabled={savingBudget} class="flex-1 px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#15304f] disabled:opacity-50">
          {savingBudget ? 'Saving...' : 'Save Budget'}
        </button>
      </div>
    </div>
  </div>
{/if}
