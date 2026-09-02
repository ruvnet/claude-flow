<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  let locationId = $state('');
  let locations = $state<{id: string; name: string}[]>([]);
  let singleLocation = $state(false);
  let year = $state(2026);
  let kpiData = $state<any>(null);
  const foh = ['Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training'];
  const boh = ['Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  function detectCurrentPeriodAndWeek(): { period: number; week: number } {
    const p1Start = new Date('2025-12-29T12:00:00');
    const today = new Date();
    const daysSinceP1 = Math.floor((today.getTime() - p1Start.getTime()) / (1000 * 60 * 60 * 24));
    const period = Math.min(13, Math.max(1, Math.floor(daysSinceP1 / 28) + 1));
    const dayInPeriod = daysSinceP1 % 28;
    const week = Math.min(4, Math.floor(dayInPeriod / 7) + 1);
    return { period, week };
  }

  const detected = detectCurrentPeriodAndWeek();
  let periodNumber = $state(detected.period);
  let week = $state(detected.week);

  async function load() {
    if (!locationId) return;
    const res = await fetch(`/api/v1/kpi?locationId=${locationId}&period=${periodNumber}&year=${year}`);
    kpiData = await res.json();
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email;
      const url = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(url).then(r => r.json()).then(d => {
        locations = d.locations || d || [];
        singleLocation = locations.length === 1;
        if (locations.length > 0) {
          const saved = localStorage.getItem('helixo_selected_location');
          locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
          load();
        }
      });
    });
  });

  function getWeekDays(allDays: any[], w: number): any[] { return (allDays || []).slice((w - 1) * 7, w * 7); }

  function getPositionData(days: any[], pos: string) {
    return days.map(d => {
      const p = (d.laborByPosition || []).find((x: any) => x.position === pos);
      return {
        actual: p?.actual || 0, projected: p?.projected || 0, budget: p?.budget || 0,
        hasActual: (d.revenue || 0) > 0,
        revenue: d.revenue || 0,
        forecastRevenue: d.forecastRevenue || 0,
        budgetRevenue: d.budgetRevenue || 0,
      };
    });
  }

  function fmt(n: number): string { return n ? '$' + Math.round(n).toLocaleString() : '-'; }
  function fmtVar(n: number): string { return n === 0 ? '-' : (n > 0 ? '+' : '') + '$' + Math.round(Math.abs(n)).toLocaleString(); }
  function fmtPct(labor: number, rev: number): string { return labor > 0 && rev > 0 ? (labor / rev * 100).toFixed(1) + '%' : ''; }
  function fmtPctVar(a: number, b: number): string {
    if (!a && !b) return '';
    const diff = a - b;
    return (diff > 0 ? '+' : '') + diff.toFixed(1) + 'pp';
  }

  /** PTD total: only sum days that have actual data. */
  function ptdTotal(pd: {actual: number; budget: number; projected: number; hasActual: boolean}[], field: 'actual' | 'budget' | 'projected') {
    return pd.filter(d => d.hasActual).reduce((s, d) => s + (d as any)[field], 0);
  }
  function ptdRevSum(pd: {hasActual: boolean; revenue: number; forecastRevenue: number; budgetRevenue: number}[], field: 'revenue' | 'forecastRevenue' | 'budgetRevenue') {
    return pd.filter(d => d.hasActual).reduce((s, d) => s + d[field], 0);
  }
</script>

<div class="p-3 md:p-4">
  <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a] mb-1">Labor Detail</h1>
  <p class="text-sm text-[#6b7280] mb-6">Position-level weekly breakdown: Actual vs Projected vs Budget</p>
  <div class="flex gap-2 mb-6 flex-wrap items-center">
    {#if singleLocation}
      <span class="text-sm font-medium text-[#374151]">{locations[0]?.name}</span>
    {:else}
      <select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); load(); }} class="leo-select">
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
    {/if}
    <select bind:value={periodNumber} onchange={load} class="leo-select">
      {#each Array.from({length:13},(_,i)=>i+1) as p}<option value={p}>P{p}</option>{/each}
    </select>
    {#each [1,2,3,4] as w}
      <button onclick={() => week = w}
        class="px-4 py-2 rounded text-sm font-medium transition-colors"
        style="{week === w ? 'background: #1e3a5f; color: white;' : 'background: white; border: 1px solid #e5e7eb; color: #374151;'}">
        Week {w}
      </button>
    {/each}
    <span class="text-sm font-medium text-[#374151]">{year}</span>
  </div>

  {#if kpiData?.days}
    {@const weekDays = getWeekDays(kpiData.days, week)}
    {@const fohActual = foh.reduce((s, p) => s + getPositionData(weekDays, p).filter(d => d.hasActual).reduce((a, d) => a + d.actual, 0), 0)}
    {@const fohBudget = foh.reduce((s, p) => s + getPositionData(weekDays, p).filter(d => d.hasActual).reduce((a, d) => a + d.budget, 0), 0)}
    {@const fohProj = foh.reduce((s, p) => s + getPositionData(weekDays, p).filter(d => d.hasActual).reduce((a, d) => a + d.projected, 0), 0)}
    {@const bohActual = boh.reduce((s, p) => s + getPositionData(weekDays, p).filter(d => d.hasActual).reduce((a, d) => a + d.actual, 0), 0)}
    {@const bohBudget = boh.reduce((s, p) => s + getPositionData(weekDays, p).filter(d => d.hasActual).reduce((a, d) => a + d.budget, 0), 0)}
    {@const bohProj = boh.reduce((s, p) => s + getPositionData(weekDays, p).filter(d => d.hasActual).reduce((a, d) => a + d.projected, 0), 0)}
    {@const totalActual = fohActual + bohActual}
    {@const totalBudget = fohBudget + bohBudget}
    {@const totalProj = fohProj + bohProj}

    <!-- Summary Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
      <div class="leo-card p-4">
        <p class="text-[10px] uppercase tracking-wider text-[#6b7280] mb-1">FOH Labor</p>
        <p class="text-lg font-bold text-[#1a1a1a]">{fmt(fohActual)}</p>
        <div class="mt-2 text-[11px] space-y-1">
          <div class="flex justify-between">
            <span class="text-[#6b7280]">vs Projected ({fmt(fohProj)})</span>
            <span style="color: {fohActual - fohProj > 0 ? '#dc2626' : '#16a34a'};">{fmtVar(fohActual - fohProj)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#6b7280]">vs Budget ({fmt(fohBudget)})</span>
            <span style="color: {fohActual - fohBudget > 0 ? '#dc2626' : '#16a34a'};">{fmtVar(fohActual - fohBudget)}</span>
          </div>
        </div>
      </div>
      <div class="leo-card p-4">
        <p class="text-[10px] uppercase tracking-wider text-[#6b7280] mb-1">BOH Labor</p>
        <p class="text-lg font-bold text-[#1a1a1a]">{fmt(bohActual)}</p>
        <div class="mt-2 text-[11px] space-y-1">
          <div class="flex justify-between">
            <span class="text-[#6b7280]">vs Projected ({fmt(bohProj)})</span>
            <span style="color: {bohActual - bohProj > 0 ? '#dc2626' : '#16a34a'};">{fmtVar(bohActual - bohProj)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#6b7280]">vs Budget ({fmt(bohBudget)})</span>
            <span style="color: {bohActual - bohBudget > 0 ? '#dc2626' : '#16a34a'};">{fmtVar(bohActual - bohBudget)}</span>
          </div>
        </div>
      </div>
      <div class="leo-card p-4">
        <p class="text-[10px] uppercase tracking-wider text-[#6b7280] mb-1">Total Labor</p>
        <p class="text-lg font-bold text-[#1a1a1a]">{fmt(totalActual)}</p>
        <div class="mt-2 text-[11px] space-y-1">
          <div class="flex justify-between">
            <span class="text-[#6b7280]">vs Projected ({fmt(totalProj)})</span>
            <span style="color: {totalActual - totalProj > 0 ? '#dc2626' : '#16a34a'};">{fmtVar(totalActual - totalProj)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-[#6b7280]">vs Budget ({fmt(totalBudget)})</span>
            <span style="color: {totalActual - totalBudget > 0 ? '#dc2626' : '#16a34a'};">{fmtVar(totalActual - totalBudget)}</span>
          </div>
        </div>
      </div>
    </div>

    {#each [{title:'FOH Positions',positions:foh},{title:'BOH Positions',positions:boh}] as section}
      <h2 class="leo-section-title mt-8 mb-3">{section.title}</h2>
      {#each section.positions as position}
        {@const pd = getPositionData(weekDays, position)}
        {@const tBudget = ptdTotal(pd, 'budget')}
        {@const tProjected = ptdTotal(pd, 'projected')}
        {@const tActual = ptdTotal(pd, 'actual')}
        {@const tVar = tActual - tBudget}
        <div class="leo-card mb-3 overflow-hidden leo-table-scroll">
          <div style="background: #1e3a5f; color: white; padding: 8px 16px; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.03em;">
            {position}
          </div>
          {#if position === 'Pastry' && (locationId === 'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce' || locationId === '84f4ea7f-722d-4296-894b-6ecfe389b2d5' || locationId === 'b4035001-0928-4ada-a0f0-f2a272393147')}
            <div style="background: #fef3c7; border-bottom: 1px solid #f59e0b; padding: 4px 16px; font-size: 11px; color: #92400e;">
              {locationId === 'ae99ee33-1b8e-4c8f-8451-e9f3d0fa28ce' ? 'Actuals reflect 70% of Le Supreme pastry team (shared: 25% Anthology, 5% HIROKI-SAN)' : locationId === '84f4ea7f-722d-4296-894b-6ecfe389b2d5' ? 'Actuals include 25% allocation from Le Supreme shared pastry team' : 'Actuals include 5% allocation from Le Supreme shared pastry team'}
            </div>
          {/if}
          <table class="w-full leo-table" style="min-width: 600px;">
            <thead>
              <tr>
                <th class="leo-th" style="width: 90px; background: #f1f5f9; color: #374151;"></th>
                {#each weekDays as d, i}
                  <th class="leo-th" style="background: #f1f5f9; color: #374151; font-size: 12px;">
                    {dayLabels[i] || ''}<br/><span style="font-size: 10px; color: #9ca3af; font-weight: 400;">{d.date?.slice(5)}</span>
                  </th>
                {/each}
                <th class="leo-th" style="background: #f1f5f9; color: #1a1a1a; font-weight: 700;">PTD</th>
              </tr>
            </thead>
            <tbody>
              {@const ptdRev = ptdRevSum(pd, 'revenue')}
              {@const ptdFcstRev = ptdRevSum(pd, 'forecastRevenue')}
              {@const ptdBudgRev = ptdRevSum(pd, 'budgetRevenue')}
              <tr>
                <td class="leo-td font-medium text-[#1a1a1a]" style="font-size: 12px;">Actual</td>
                {#each pd as d}
                  <td class="leo-td {d.hasActual ? 'font-medium' : 'text-[#d1d5db]'}" style="font-size: 12px;">
                    {d.hasActual ? fmt(d.actual) : '-'}
                    {#if d.hasActual && fmtPct(d.actual, d.revenue)}<div style="font-size:10px;color:#6b7280;font-weight:400;">{fmtPct(d.actual, d.revenue)}</div>{/if}
                  </td>
                {/each}
                <td class="leo-td font-bold" style="font-size: 12px;">
                  {fmt(tActual)}
                  {#if fmtPct(tActual, ptdRev)}<div style="font-size:10px;color:#6b7280;font-weight:400;">{fmtPct(tActual, ptdRev)}</div>{/if}
                </td>
              </tr>
              <tr>
                <td class="leo-td text-[#6b7280]" style="font-size: 12px;">Projected</td>
                {#each pd as d}
                  <td class="leo-td" style="font-size: 12px;">
                    {fmt(d.projected)}
                    {#if fmtPct(d.projected, d.forecastRevenue)}<div style="font-size:10px;color:#6b7280;">{fmtPct(d.projected, d.forecastRevenue)}</div>{/if}
                  </td>
                {/each}
                <td class="leo-td font-bold" style="font-size: 12px;">
                  {fmt(tProjected)}
                  {#if fmtPct(tProjected, ptdFcstRev)}<div style="font-size:10px;color:#6b7280;font-weight:400;">{fmtPct(tProjected, ptdFcstRev)}</div>{/if}
                </td>
              </tr>
              <tr>
                <td class="leo-td text-[#6b7280]" style="font-size: 12px;">Var (A-P)</td>
                {#each pd as d}
                  {@const v = d.hasActual && d.projected ? d.actual - d.projected : 0}
                  {@const pctA = d.hasActual && d.revenue ? d.actual / d.revenue * 100 : 0}
                  {@const pctP = d.forecastRevenue ? d.projected / d.forecastRevenue * 100 : 0}
                  <td class="leo-td {!d.hasActual || !d.projected ? 'text-[#d1d5db]' : v < 0 ? 'leo-positive' : v > 0 ? 'leo-negative' : ''}" style="font-size: 12px;">
                    {d.hasActual && d.projected ? fmtVar(v) : '-'}
                    {#if d.hasActual && d.projected && pctA && pctP}<div style="font-size:10px;">{fmtPctVar(pctA, pctP)}</div>{/if}
                  </td>
                {/each}
                {@const ptdPctA = ptdRev ? tActual / ptdRev * 100 : 0}
                {@const ptdPctP = ptdFcstRev ? tProjected / ptdFcstRev * 100 : 0}
                <td class="leo-td font-bold {(tActual - tProjected) < 0 ? 'leo-positive' : (tActual - tProjected) > 0 ? 'leo-negative' : ''}" style="font-size: 12px;">
                  {tActual > 0 && tProjected > 0 ? fmtVar(tActual - tProjected) : '-'}
                  {#if tActual > 0 && tProjected > 0 && ptdPctA && ptdPctP}<div style="font-size:10px;">{fmtPctVar(ptdPctA, ptdPctP)}</div>{/if}
                </td>
              </tr>
              <tr>
                <td class="leo-td text-[#6b7280]" style="font-size: 12px;">Budget</td>
                {#each pd as d}
                  <td class="leo-td" style="font-size: 12px;">
                    {fmt(d.budget)}
                    {#if fmtPct(d.budget, d.budgetRevenue)}<div style="font-size:10px;color:#6b7280;">{fmtPct(d.budget, d.budgetRevenue)}</div>{/if}
                  </td>
                {/each}
                <td class="leo-td font-bold" style="font-size: 12px;">
                  {fmt(tBudget)}
                  {#if fmtPct(tBudget, ptdBudgRev)}<div style="font-size:10px;color:#6b7280;font-weight:400;">{fmtPct(tBudget, ptdBudgRev)}</div>{/if}
                </td>
              </tr>
              <tr>
                <td class="leo-td text-[#6b7280]" style="font-size: 12px;">Var (A-B)</td>
                {#each pd as d}
                  {@const v = d.hasActual ? d.actual - d.budget : 0}
                  {@const pctA = d.hasActual && d.revenue ? d.actual / d.revenue * 100 : 0}
                  {@const pctB = d.budgetRevenue ? d.budget / d.budgetRevenue * 100 : 0}
                  <td class="leo-td {!d.hasActual ? 'text-[#d1d5db]' : v < 0 ? 'leo-positive' : v > 0 ? 'leo-negative' : ''}" style="font-size: 12px;">
                    {d.hasActual ? fmtVar(v) : '-'}
                    {#if d.hasActual && pctA && pctB}<div style="font-size:10px;">{fmtPctVar(pctA, pctB)}</div>{/if}
                  </td>
                {/each}
                {@const ptdPctA = ptdRev ? tActual / ptdRev * 100 : 0}
                {@const ptdPctB = ptdBudgRev ? tBudget / ptdBudgRev * 100 : 0}
                <td class="leo-td font-bold {tVar < 0 ? 'leo-positive' : tVar > 0 ? 'leo-negative' : ''}" style="font-size: 12px;">
                  {tActual > 0 ? fmtVar(tVar) : '-'}
                  {#if tActual > 0 && ptdPctA && ptdPctB}<div style="font-size:10px;">{fmtPctVar(ptdPctA, ptdPctB)}</div>{/if}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      {/each}
    {/each}
  {:else}<div class="text-center py-20 text-[#9ca3af]">Loading...</div>{/if}
</div>
