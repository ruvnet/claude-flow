<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  let locationId = $state('');
  let locations = $state<{id: string; name: string}[]>([]);
  let entries = $state<any[]>([]);
  let positionFilter = $state('');
  let showUnexplainedOnly = $state(false);
  let editingId = $state<string | null>(null);
  let editExplanation = $state('');
  let year = $state(2026);
  const positions = ['', 'Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training', 'Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'];

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
  let weekNumber = $state(detected.week);

  function getDateRange(period: number, week: number): { startDate: string; endDate: string } {
    const p1Start = new Date('2025-12-29T12:00:00');
    const periodStart = new Date(p1Start.getTime() + (period - 1) * 28 * 86400000);
    if (week === 0) {
      const periodEnd = new Date(periodStart.getTime() + 27 * 86400000);
      return { startDate: periodStart.toISOString().split('T')[0], endDate: periodEnd.toISOString().split('T')[0] };
    }
    const weekStart = new Date(periodStart.getTime() + (week - 1) * 7 * 86400000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    return { startDate: weekStart.toISOString().split('T')[0], endDate: weekEnd.toISOString().split('T')[0] };
  }

  let dateRange = $derived(getDateRange(periodNumber, weekNumber));

  async function loadEntries() {
    if (!locationId) return;
    const { startDate, endDate } = getDateRange(periodNumber, weekNumber);
    const p = new URLSearchParams({ locationId, startDate, endDate });
    if (positionFilter) p.set('position', positionFilter);
    if (showUnexplainedOnly) p.set('unexplainedOnly', 'true');
    const res = await fetch(`/api/v1/variance?${p}`);
    entries = (await res.json()).entries || [];
  }

  async function saveExplanation(entry: any) {
    await fetch('/api/v1/variance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, date: entry.business_date, position: entry.position, projectedDollars: entry.projected_dollars, actualDollars: entry.actual_dollars, explanation: editExplanation, createdBy: 'manager' }),
    });
    editingId = null; editExplanation = ''; await loadEntries();
  }

  function fmt(n: number | null): string { return n == null ? '-' : '$' + Math.round(n).toLocaleString(); }
  function exportCsv() {
    const h = ['Date','Position','Projected','Actual','Variance $','Variance %','Explanation'];
    const rows = entries.map(e => [e.business_date, e.position, e.projected_dollars, e.actual_dollars, e.variance_dollars, ((e.variance_pct||0)*100).toFixed(1)+'%', (e.explanation||'').replace(/,/g,';')]);
    const csv = [h,...rows].map(r => r.join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download = `variance-log.csv`; a.click();
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email;
      const url = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(url).then(r => r.json()).then(d => {
        locations = d.locations || d || [];
        if (locations.length > 0) { locationId = locations[0].id; loadEntries(); }
      });
    });
  });
</script>

<div class="p-3 md:p-4">
  <div class="flex items-center justify-between mb-6">
    <div>
      <h1 class="text-2xl font-bold text-[#1a1a1a]">Variance Log</h1>
      <p class="text-sm text-[#6b7280]">Daily position-level variance explanations</p>
    </div>
    <button onclick={exportCsv} class="leo-btn-secondary">Export CSV</button>
  </div>

  <div class="flex gap-4 mb-6 items-end flex-wrap">
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Location</label>
      <select bind:value={locationId} onchange={loadEntries} class="leo-select">
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
    </div>
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Period</label>
      <select bind:value={periodNumber} onchange={loadEntries} class="leo-select">
        {#each Array.from({length: 13}, (_, i) => i + 1) as p}<option value={p}>P{p}</option>{/each}
      </select>
    </div>
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Week</label>
      <select bind:value={weekNumber} onchange={loadEntries} class="leo-select">
        <option value={0}>Full Period</option>
        {#each [1,2,3,4] as w}<option value={w}>W{w}</option>{/each}
      </select>
    </div>
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Year</label>
      <span class="text-sm font-medium text-[#374151]">{year}</span>
    </div>
    <div>
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Position</label>
      <select bind:value={positionFilter} onchange={loadEntries} class="leo-select">
        {#each positions as p}<option value={p}>{p || 'All'}</option>{/each}
      </select>
    </div>
    <label class="flex items-center gap-2 text-sm text-[#374151] pb-1 cursor-pointer">
      <input bind:checked={showUnexplainedOnly} onchange={loadEntries} type="checkbox" class="accent-[#1e3a5f]" />
      Unexplained only
    </label>
  </div>

  <div class="text-xs text-[#9ca3af] mb-2 uppercase tracking-wide">Showing: {dateRange.startDate} to {dateRange.endDate}</div>

  <div class="leo-card overflow-x-auto">
    <table class="w-full leo-table">
      <thead>
        <tr>
          <th class="leo-th">Date</th>
          <th class="leo-th">Position</th>
          <th class="leo-th">Projected</th>
          <th class="leo-th">Actual</th>
          <th class="leo-th">Variance $</th>
          <th class="leo-th">Var %</th>
          <th class="leo-th" style="text-align: left;">Explanation</th>
          <th class="leo-th" style="text-align: center;">Action</th>
        </tr>
      </thead>
      <tbody>
        {#each entries as entry}
          <tr class="{!entry.explanation ? 'bg-[#fef2f2]' : ''}">
            <td class="leo-td" style="text-align: left;">{entry.business_date}</td>
            <td class="leo-td" style="text-align: left;">{entry.position}</td>
            <td class="leo-td">{fmt(entry.projected_dollars)}</td>
            <td class="leo-td">{fmt(entry.actual_dollars)}</td>
            <td class="leo-td {(entry.variance_dollars||0) > 0 ? 'leo-positive' : 'leo-negative'}">{fmt(entry.variance_dollars)}</td>
            <td class="leo-td">{entry.variance_pct ? ((entry.variance_pct*100).toFixed(1)+'%') : '-'}</td>
            <td class="leo-td" style="text-align: left;">
              {#if editingId === entry.id}
                <input bind:value={editExplanation} type="text" class="leo-select w-full" />
              {:else}
                <span class="{entry.explanation ? '' : 'italic'}" style="{entry.explanation ? '' : 'color: #ef4444;'}">{entry.explanation || 'No explanation'}</span>
              {/if}
            </td>
            <td class="leo-td" style="text-align: center;">
              {#if editingId === entry.id}
                <button onclick={() => saveExplanation(entry)} class="text-xs font-medium px-2 py-1 rounded" style="background: #16a34a; color: white;">Save</button>
              {:else}
                <button onclick={() => { editingId = entry.id; editExplanation = entry.explanation || ''; }} class="text-xs font-medium" style="color: #1e3a5f;" onmouseenter={(e) => e.currentTarget.style.textDecoration='underline'} onmouseleave={(e) => e.currentTarget.style.textDecoration='none'}>
                  {entry.explanation ? 'Edit' : 'Add'}
                </button>
              {/if}
            </td>
          </tr>
        {/each}
        {#if entries.length === 0}
          <tr><td colspan="8" class="px-3 py-8 text-center text-[#9ca3af]">No variance entries found</td></tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
