<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  let locationId = $state('');
  let locations = $state<{id: string; name: string}[]>([]);
  let singleLocation = $state(false);
  let monthNumber = $state(0);
  let kpiData = $state<any>(null);
  let loading = $state(false);

  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  function detectCurrentMonth(): number {
    return new Date().getMonth() + 1;
  }

  async function loadLocations() {
    const supabase = getClientSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;
    const url = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
    const res = await fetch(url);
    const data = await res.json();
    locations = data.locations || data || [];
    singleLocation = locations.length === 1;
    if (locations.length > 0 && !locationId) {
      const saved = localStorage.getItem('helixo_selected_location');
      locationId = (saved && locations.some(l => l.id === saved)) ? saved : locations[0].id;
      if (monthNumber === 0) {
        monthNumber = detectCurrentMonth();
      }
      await loadKPIs();
    }
  }

  async function loadKPIs() {
    if (!locationId) return;
    loading = true;
    try {
      const res = await fetch(`/api/v1/monthly-kpi?locationId=${locationId}&month=${monthNumber}&year=2026`);
      kpiData = await res.json();
    } catch (e) {
      console.error('Failed to load KPIs:', e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    loadLocations();
  });

  function fmtDate(d: string | null): string {
    if (!d) return '-';
    const [, m, day] = d.split('-');
    return `${parseInt(m)}/${parseInt(day)}`;
  }

  function formatCurrency(n: number | null): string {
    if (n == null) return '-';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
  }

  let showPct = $state(false);

  function laborVal(dollars: number | null, revenue: number | null): string {
    if (dollars == null || !dollars) return '-';
    if (showPct && revenue && revenue > 0) return ((dollars / revenue) * 100).toFixed(1) + '%';
    return formatCurrency(dollars);
  }

  function laborVarPct(actDollars: number | null, compDollars: number | null, actRev: number | null, compRev: number | null): string {
    if (actDollars == null || !actDollars) return '-';
    if (compDollars == null || !compDollars) return '-';
    if (showPct) {
      const actPct = actRev && actRev > 0 ? (actDollars / actRev) * 100 : 0;
      const compPct = compRev && compRev > 0 ? (compDollars / compRev) * 100 : 0;
      const diff = compPct - actPct;
      return (diff >= 0 ? '+' : '') + diff.toFixed(1) + '%';
    }
    return formatCurrency(compDollars - actDollars);
  }
</script>

<div class="p-3 md:p-4">
  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
    <div>
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Monthly Report</h1>
      <p class="text-sm text-[#6b7280]">Revenue & Labor Performance</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:gap-4">
      {#if singleLocation}
        <span class="text-sm font-medium text-[#374151]">{locations[0]?.name}</span>
      {:else}
        <select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); loadKPIs(); }} class="leo-select flex-1 sm:flex-none">
          {#each locations as loc}
            <option value={loc.id}>{loc.name}</option>
          {/each}
        </select>
      {/if}
      <select bind:value={monthNumber} onchange={loadKPIs} class="leo-select">
        {#each monthNames as name, i}
          <option value={i + 1}>{name}</option>
        {/each}
      </select>
      <button onclick={() => showPct = !showPct}
        class="text-xs px-3 py-2 rounded transition-colors"
        style="{showPct ? 'background: #1e3a5f; color: white;' : 'background: #f3f4f6; color: #374151; border: 1px solid #d1d5db;'}; min-height: 44px;">
        {showPct ? '% Mode' : '$ Mode'}
      </button>
    </div>
  </div>

  {#if loading}
    <div class="text-center py-20 text-[#9ca3af]">Loading...</div>
  {:else if kpiData?.summary}
    <!-- Daily Table -->
    <div class="leo-card leo-table-scroll leo-table-freeze">
      <table class="w-full leo-table" style="font-size: 12px; min-width: 1100px;">
        <thead>
          <tr>
            <th class="leo-th" rowspan="2" colspan="2" style="text-align:center; min-width:90px;">Date</th>
            <th class="leo-th" colspan="4" style="text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">Revenue</th>
            <th class="leo-th" colspan="5" style="text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">FOH Labor</th>
            <th class="leo-th" colspan="5" style="text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">BOH Labor</th>
            <th class="leo-th" colspan="5" style="text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">Total Labor</th>
          </tr>
          <tr>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">Act</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Bud</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Var</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">For</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">Act</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Proj</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Var</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Bud</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Var</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">Act</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Proj</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Var</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Bud</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Var</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center; border-left: 2px solid rgba(255,255,255,0.3);">Act</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Proj</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Var</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Bud</th>
            <th class="leo-th" style="padding:4px 8px; font-size:10px; text-align:center;">Var</th>
          </tr>
        </thead>
        <tbody>
          {#each kpiData.days || [] as day, dayIdx}
            {@const budVar = day.revenue != null && day.budgetRevenue != null ? day.revenue - day.budgetRevenue : null}
            <tr>
              <td class="leo-td text-[#6b7280]" style="font-size:11px;">{day.dayName?.slice(0,3)}</td>
              <td class="leo-td text-[#9ca3af]" style="font-size:11px;">{fmtDate(day.date)}</td>
              <td class="leo-td font-medium" style="border-left: 2px solid #e5e7eb;">{formatCurrency(day.revenue)}</td>
              <td class="leo-td">{formatCurrency(day.budgetRevenue)}</td>
              <td class="leo-td">{budVar != null ? formatCurrency(budVar) : '-'}</td>
              <td class="leo-td">{formatCurrency(day.forecastRevenue)}</td>
              <!-- FOH -->
              <td class="leo-td" style="border-left: 2px solid #e5e7eb;">{laborVal(day.foh.actual, day.revenue)}</td>
              <td class="leo-td">{laborVal(day.foh.projected, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(day.foh.actual, day.foh.projected, day.revenue, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVal(day.foh.budget, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(day.foh.actual, day.foh.budget, day.revenue, day.budgetRevenue)}</td>
              <!-- BOH -->
              <td class="leo-td" style="border-left: 2px solid #e5e7eb;">{laborVal(day.boh.actual, day.revenue)}</td>
              <td class="leo-td">{laborVal(day.boh.projected, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(day.boh.actual, day.boh.projected, day.revenue, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVal(day.boh.budget, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(day.boh.actual, day.boh.budget, day.revenue, day.budgetRevenue)}</td>
              <!-- Total -->
              <td class="leo-td font-medium" style="border-left: 2px solid #e5e7eb;">{laborVal(day.totalLabor.actual, day.revenue)}</td>
              <td class="leo-td">{laborVal(day.totalLabor.projected, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(day.totalLabor.actual, day.totalLabor.projected, day.revenue, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVal(day.totalLabor.budget, day.budgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(day.totalLabor.actual, day.totalLabor.budget, day.revenue, day.budgetRevenue)}</td>
            </tr>
          {/each}
        </tbody>
        {#if kpiData.summary}
          <tfoot>
            <tr class="leo-footer">
              <td class="leo-td font-semibold" colspan="2">MTD Total</td>
              <td class="leo-td font-semibold" style="border-left: 2px solid #e5e7eb;">{formatCurrency(kpiData.summary.totalRevenue)}</td>
              <td class="leo-td">{formatCurrency(kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{formatCurrency(kpiData.summary.budgetRevenueVariance)}</td>
              <td class="leo-td">{formatCurrency(kpiData.summary.totalForecast)}</td>
              <!-- FOH -->
              <td class="leo-td" style="border-left: 2px solid #e5e7eb;">{laborVal(kpiData.summary.foh.actual, kpiData.summary.totalRevenue)}</td>
              <td class="leo-td">{laborVal(kpiData.summary.foh.projected, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(kpiData.summary.foh.actual, kpiData.summary.foh.projected, kpiData.summary.totalRevenue, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVal(kpiData.summary.foh.budget, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(kpiData.summary.foh.actual, kpiData.summary.foh.budget, kpiData.summary.totalRevenue, kpiData.summary.totalBudgetRevenue)}</td>
              <!-- BOH -->
              <td class="leo-td" style="border-left: 2px solid #e5e7eb;">{laborVal(kpiData.summary.boh.actual, kpiData.summary.totalRevenue)}</td>
              <td class="leo-td">{laborVal(kpiData.summary.boh.projected, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(kpiData.summary.boh.actual, kpiData.summary.boh.projected, kpiData.summary.totalRevenue, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVal(kpiData.summary.boh.budget, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(kpiData.summary.boh.actual, kpiData.summary.boh.budget, kpiData.summary.totalRevenue, kpiData.summary.totalBudgetRevenue)}</td>
              <!-- Total -->
              <td class="leo-td" style="border-left: 2px solid #e5e7eb;">{laborVal(kpiData.summary.totalLaborActual, kpiData.summary.totalRevenue)}</td>
              <td class="leo-td">{laborVal(kpiData.summary.totalLaborProjected, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(kpiData.summary.totalLaborActual, kpiData.summary.totalLaborProjected, kpiData.summary.totalRevenue, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVal(kpiData.summary.totalLaborBudget, kpiData.summary.totalBudgetRevenue)}</td>
              <td class="leo-td">{laborVarPct(kpiData.summary.totalLaborActual, kpiData.summary.totalLaborBudget, kpiData.summary.totalRevenue, kpiData.summary.totalBudgetRevenue)}</td>
            </tr>
            {#if kpiData.fullMonthTotals}
              {@const fmt = kpiData.fullMonthTotals}
              {@const fmtMonthName = monthNames[monthNumber - 1]?.toUpperCase() || 'MONTH'}
              <tr class="leo-footer" style="background: #d1d5db;">
                <td class="leo-td font-bold" colspan="2">{fmtMonthName} Total</td>
                <td class="leo-td font-bold" style="border-left: 2px solid #e5e7eb;">{formatCurrency(fmt.revenue)}</td>
                <td class="leo-td font-semibold">{formatCurrency(fmt.budgetRevenue)}</td>
                <td class="leo-td font-semibold">{formatCurrency(fmt.revenue - fmt.budgetRevenue)}</td>
                <td class="leo-td">-</td>
                <!-- FOH -->
                <td class="leo-td font-semibold" style="border-left: 2px solid #e5e7eb;">{laborVal(fmt.fohLabor, fmt.revenue)}</td>
                <td class="leo-td">-</td>
                <td class="leo-td">-</td>
                <td class="leo-td">{laborVal(fmt.fohBudgetLabor, fmt.budgetRevenue)}</td>
                <td class="leo-td">{fmt.fohLabor && fmt.fohBudgetLabor ? formatCurrency(fmt.fohBudgetLabor - fmt.fohLabor) : '-'}</td>
                <!-- BOH -->
                <td class="leo-td font-semibold" style="border-left: 2px solid #e5e7eb;">{laborVal(fmt.bohLabor, fmt.revenue)}</td>
                <td class="leo-td">-</td>
                <td class="leo-td">-</td>
                <td class="leo-td">{laborVal(fmt.bohBudgetLabor, fmt.budgetRevenue)}</td>
                <td class="leo-td">{fmt.bohLabor && fmt.bohBudgetLabor ? formatCurrency(fmt.bohBudgetLabor - fmt.bohLabor) : '-'}</td>
                <!-- Total -->
                <td class="leo-td font-bold" style="border-left: 2px solid #e5e7eb;">{laborVal(fmt.labor, fmt.revenue)}</td>
                <td class="leo-td">-</td>
                <td class="leo-td">-</td>
                <td class="leo-td">{laborVal(fmt.budgetLabor, fmt.budgetRevenue)}</td>
                <td class="leo-td">{fmt.labor && fmt.budgetLabor ? formatCurrency(fmt.budgetLabor - fmt.labor) : '-'}</td>
              </tr>
            {/if}
          </tfoot>
        {/if}
      </table>
    </div>

  {:else}
    <div class="text-center py-20">
      <p class="text-[#9ca3af] mb-4">No data available for this month</p>
      <a href="/setup" class="leo-btn inline-block">Set up a location</a>
    </div>
  {/if}
</div>
