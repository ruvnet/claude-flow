<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { getClientSupabase } from '$lib/supabase-client';

  // FY2025: Dec 30 2024 – Dec 28 2025 (364 days, same-DOW as FY2026)
  const FY2025_START = '2024-12-30';
  const FY2025_END   = '2025-12-28';

  const PERIODS = [
    { label: 'FY2026 Full Year (Dec 29 2025 – Dec 27 2026)', start: '2025-12-29', end: '2026-12-27', fy: 2026 },
    { label: 'FY2026 P4 (Mar 23 – Apr 19 2026)', start: '2026-03-23', end: '2026-04-19', fy: 2026 },
    { label: 'FY2026 P3 (Feb 23 – Mar 22 2026)', start: '2026-02-23', end: '2026-03-22', fy: 2026 },
    { label: 'FY2026 P2 (Jan 26 – Feb 22 2026)', start: '2026-01-26', end: '2026-02-22', fy: 2026 },
    { label: 'FY2026 P1 (Dec 29 – Jan 25 2026)', start: '2025-12-29', end: '2026-01-25', fy: 2026 },
    { label: 'FY2025 Full Year (Dec 30 2024 – Dec 28 2025)', start: '2024-12-30', end: '2025-12-28', fy: 2025 },
    { label: 'FY2025 P1', start: '2024-12-30', end: '2025-01-26', fy: 2025 },
    { label: 'FY2025 P2', start: '2025-01-27', end: '2025-02-23', fy: 2025 },
    { label: 'FY2025 P3', start: '2025-02-24', end: '2025-03-23', fy: 2025 },
    { label: 'FY2025 P4', start: '2025-03-24', end: '2025-04-20', fy: 2025 },
    { label: 'FY2025 P5', start: '2025-04-21', end: '2025-05-18', fy: 2025 },
    { label: 'FY2025 P6', start: '2025-05-19', end: '2025-06-15', fy: 2025 },
    { label: 'FY2025 P7', start: '2025-06-16', end: '2025-07-13', fy: 2025 },
    { label: 'FY2025 P8', start: '2025-07-14', end: '2025-08-10', fy: 2025 },
    { label: 'FY2025 P9', start: '2025-08-11', end: '2025-09-07', fy: 2025 },
    { label: 'FY2025 P10', start: '2025-09-08', end: '2025-10-05', fy: 2025 },
    { label: 'FY2025 P11', start: '2025-10-06', end: '2025-11-02', fy: 2025 },
    { label: 'FY2025 P12', start: '2025-11-03', end: '2025-11-30', fy: 2025 },
    { label: 'FY2025 P13', start: '2025-12-01', end: '2025-12-28', fy: 2025 },
    { label: 'Custom Date Range', start: '', end: '', fy: 0 },
  ];

  type LocStatus = {
    id: string;
    name: string;
    daysTotal: number;
    daysDone: number;
    status: 'idle' | 'running' | 'done' | 'error';
    currentDate: string;
    errors: string[];
    revenue: number;
  };

  let sessionToken = $state('');
  let locations = $state<LocStatus[]>([]);
  let loadingLocations = $state(true);
  let running   = $state(false);
  let globalMsg = $state('');
  let filterPeriod = $state(0); // index into PERIODS array
  let customStart = $state('');
  let customEnd   = $state('');

  const isCustom = $derived(PERIODS[filterPeriod]?.fy === 0);

  // Build list of all dates in a range
  function buildDates(start: string, end: string): string[] {
    const dates: string[] = [];
    const s = new Date(start + 'T12:00:00Z');
    const e = new Date(end   + 'T12:00:00Z');
    for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    return dates;
  }

  // Total days for the chosen range
  function getRangeStart(): string {
    if (isCustom) return customStart;
    return PERIODS[filterPeriod]?.start || FY2025_START;
  }
  function getRangeEnd(): string {
    if (isCustom) return customEnd;
    return PERIODS[filterPeriod]?.end || FY2025_END;
  }
  function getRangeDays(): number {
    const s = getRangeStart();
    const e = getRangeEnd();
    if (!s || !e) return 0;
    return buildDates(s, e).length;
  }

  onMount(() => {
    const supabase = getClientSupabase();

    // Fetch session token and locations in parallel — don't gate locations on session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) sessionToken = session.access_token;
    }).catch(() => null);

    // Locations fetch is independent of auth session
    fetch('/api/v1/locations')
      .then(r => r.json())
      .then(d => {
        const locs: any[] = d.locations || d || [];
        if (locs.length > 0) {
          locations = locs.map(l => ({
            id: l.id,
            name: l.name,
            daysTotal: getRangeDays(),
            daysDone: 0,
            status: 'idle',
            currentDate: '',
            errors: [],
            revenue: 0,
          }));
        }
        loadingLocations = false;
      })
      .catch(() => { loadingLocations = false; });
  });

  // When period filter changes, reset totals (untrack locations read to avoid infinite loop)
  $effect(() => {
    const total = getRangeDays();
    untrack(() => {
      locations = locations.map(l =>
        l.status === 'idle' ? { ...l, daysTotal: total, daysDone: 0 } : l
      );
    });
  });

  async function refreshToken() {
    const supabase = getClientSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) sessionToken = session.access_token;
  }

  async function backfillLocation(locIdx: number) {
    const startDate = getRangeStart();
    const endDate   = getRangeEnd();

    locations[locIdx].status      = 'running';
    locations[locIdx].daysDone    = 0;
    locations[locIdx].daysTotal   = getRangeDays();
    locations[locIdx].errors      = [];
    locations[locIdx].revenue     = 0;
    locations[locIdx].currentDate = startDate;

    let nextDate: string | null = startDate;

    while (nextDate) {
      try {
        const res = await fetch('/api/v1/admin/backfill', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            locationId: locations[locIdx].id,
            startDate: nextDate,
            endDate,
            includeRevenue: true,
            includeLabor: true,
            lite: true,
          }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          locations[locIdx].errors = [...locations[locIdx].errors, `${nextDate}: ${err.error}`];
          break;
        }

        const result = await res.json();
        const processed: any[] = result.results || [];

        for (const r of processed) {
          locations[locIdx].daysDone++;
          locations[locIdx].currentDate = r.date;
          if (r.revenue) locations[locIdx].revenue += r.revenue;
          if (r.error) locations[locIdx].errors = [...locations[locIdx].errors, `${r.date}: ${r.error}`];
        }

        nextDate = result.nextStartDate ?? null;
      } catch (e: any) {
        locations[locIdx].errors = [...locations[locIdx].errors, e.message];
        break;
      }
    }

    locations[locIdx].status = locations[locIdx].errors.length > 0 ? 'error' : 'done';
    locations[locIdx].currentDate = '';
  }

  async function runAll() {
    if (!sessionToken) { await refreshToken(); }
    if (!sessionToken) { globalMsg = 'Session expired — please refresh the page.'; return; }
    if (!getRangeStart() || !getRangeEnd()) { globalMsg = 'Select a start and end date.'; return; }
    running = true;
    globalMsg = 'Running backfill for all locations sequentially…';

    // Run locations one at a time to avoid Toast rate limit
    for (let i = 0; i < locations.length; i++) {
      if (locations[i].status !== 'idle' && locations[i].status !== 'error') continue;
      globalMsg = `Backfilling ${locations[i].name} (${i + 1} of ${locations.length})…`;
      await backfillLocation(i);
    }

    running = false;
    const done  = locations.filter(l => l.status === 'done').length;
    const errs  = locations.filter(l => l.status === 'error').length;
    globalMsg = `Complete: ${done} succeeded, ${errs} with errors.`;
  }

  async function runSingle(idx: number) {
    if (!sessionToken) { await refreshToken(); }
    if (!sessionToken) { globalMsg = 'Session expired — please refresh the page.'; return; }
    running = true;
    await backfillLocation(idx);
    running = false;
  }

  function resetAll() {
    if (running) return;
    const total = getRangeDays();
    locations = locations.map(l => ({ ...l, status: 'idle', daysDone: 0, daysTotal: total, errors: [], revenue: 0, currentDate: '' }));
    globalMsg = '';
  }

  function fmt$(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
  }

  function pct(done: number, total: number): number {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  const totalDone  = $derived(locations.reduce((s, l) => s + l.daysDone, 0));
  const totalDays  = $derived(locations.reduce((s, l) => s + l.daysTotal, 0));
  const totalRev   = $derived(locations.reduce((s, l) => s + l.revenue, 0));
  const allDone    = $derived(locations.length > 0 && locations.every(l => l.status === 'done'));
</script>

<!-- Page -->
<div class="max-w-5xl mx-auto px-4 py-8">
  <h1 class="text-2xl font-bold text-[#1e3a5f] mb-1">Bulk Backfill</h1>
  <p class="text-sm text-[#6b7280] mb-6">
    Re-pulls Toast revenue + labor for all locations across any period and saves to Supabase.
    Use FY2026 P4 to re-sync current period data, or FY2025 periods to lock in LY/SDLY figures.
  </p>

  <!-- Config row -->
  <div class="flex flex-wrap gap-4 mb-6 items-end">
    <div>
      <label class="block text-xs text-[#6b7280] mb-1" for="period-filter">Period / Range</label>
      <select id="period-filter" bind:value={filterPeriod} class="leo-select">
        {#each PERIODS as p, i}
          <option value={i}>{p.label}</option>
        {/each}
      </select>
    </div>
    {#if isCustom}
      <div>
        <label class="block text-xs text-[#6b7280] mb-1" for="custom-start">Start Date</label>
        <input id="custom-start" type="date" bind:value={customStart} class="leo-input" />
      </div>
      <div>
        <label class="block text-xs text-[#6b7280] mb-1" for="custom-end">End Date</label>
        <input id="custom-end" type="date" bind:value={customEnd} class="leo-input" />
      </div>
    {/if}
    <div class="flex gap-2">
      <button
        onclick={runAll}
        disabled={running}
        class="px-4 py-2 rounded text-sm font-medium text-white"
        style="background: #1e3a5f; opacity: {running ? 0.5 : 1};"
      >
        {running ? 'Running…' : 'Run All Locations'}
      </button>
      <button
        onclick={resetAll}
        disabled={running}
        class="px-4 py-2 rounded text-sm font-medium text-[#1e3a5f]"
        style="border: 1px solid #cbd5e1; opacity: {running ? 0.5 : 1};"
      >
        Reset
      </button>
    </div>
  </div>

  <!-- Global status -->
  {#if globalMsg}
    <div class="mb-4 px-4 py-2 rounded text-sm" style="background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe;">
      {globalMsg}
    </div>
  {/if}

  <!-- Summary bar -->
  {#if totalDays > 0}
    <div class="mb-6 p-4 rounded-lg" style="background: #f8fafc; border: 1px solid #e2e8f0;">
      <div class="flex flex-wrap gap-6 text-sm mb-3">
        <span><span class="font-semibold text-[#1e3a5f]">{totalDone}</span> <span class="text-[#6b7280]">/ {totalDays} day-slots processed</span></span>
        <span><span class="font-semibold text-[#1e3a5f]">{fmt$(totalRev)}</span> <span class="text-[#6b7280]">revenue captured</span></span>
        {#if allDone}
          <span class="font-semibold text-green-700">✓ All locations complete</span>
        {/if}
      </div>
      <div class="w-full h-2 rounded-full" style="background: #e2e8f0;">
        <div
          class="h-2 rounded-full transition-all"
          style="width: {pct(totalDone, totalDays)}%; background: #1e3a5f;"
        ></div>
      </div>
      <div class="text-xs text-[#9ca3af] mt-1">{pct(totalDone, totalDays)}% complete</div>
    </div>
  {/if}

  <!-- Location table -->
  {#if loadingLocations}
    <div class="text-sm text-[#9ca3af] py-6 text-center">Loading locations…</div>
  {:else if locations.length === 0}
    <div class="text-sm text-[#9ca3af] py-6 text-center">No locations found. Refresh the page.</div>
  {/if}
  <div class="rounded-lg overflow-hidden" style="border: 1px solid #e2e8f0; {locations.length === 0 ? 'display:none;' : ''}">
    <table class="w-full text-sm">
      <thead>
        <tr style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
          <th class="text-left px-4 py-2 text-xs font-semibold text-[#6b7280]">Location</th>
          <th class="text-left px-4 py-2 text-xs font-semibold text-[#6b7280]">Progress</th>
          <th class="text-right px-4 py-2 text-xs font-semibold text-[#6b7280]">Revenue</th>
          <th class="text-center px-4 py-2 text-xs font-semibold text-[#6b7280]">Status</th>
          <th class="text-center px-4 py-2 text-xs font-semibold text-[#6b7280]">Action</th>
        </tr>
      </thead>
      <tbody>
        {#each locations as loc, idx}
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td class="px-4 py-3">
              <div class="font-medium text-[#1e3a5f]">{loc.name}</div>
              {#if loc.currentDate}
                <div class="text-xs text-[#9ca3af] mt-0.5">Syncing {loc.currentDate}…</div>
              {/if}
            </td>
            <td class="px-4 py-3" style="min-width: 160px;">
              <div class="flex items-center gap-2">
                <div class="flex-1 h-1.5 rounded-full" style="background: #e2e8f0;">
                  <div
                    class="h-1.5 rounded-full transition-all"
                    style="width: {pct(loc.daysDone, loc.daysTotal)}%; background: {loc.status === 'done' ? '#16a34a' : loc.status === 'error' ? '#dc2626' : '#1e3a5f'};"
                  ></div>
                </div>
                <span class="text-xs text-[#6b7280] whitespace-nowrap">{loc.daysDone}/{loc.daysTotal}</span>
              </div>
              {#if loc.errors.length > 0}
                <details class="mt-1">
                  <summary class="text-xs text-red-500 cursor-pointer">{loc.errors.length} error{loc.errors.length > 1 ? 's' : ''}</summary>
                  <ul class="text-xs text-red-400 mt-1 space-y-0.5 pl-2">
                    {#each loc.errors.slice(0, 5) as e}<li>{e}</li>{/each}
                    {#if loc.errors.length > 5}<li>…and {loc.errors.length - 5} more</li>{/if}
                  </ul>
                </details>
              {/if}
            </td>
            <td class="px-4 py-3 text-right font-medium text-[#374151]">
              {loc.revenue > 0 ? fmt$(loc.revenue) : '—'}
            </td>
            <td class="px-4 py-3 text-center">
              {#if loc.status === 'idle'}
                <span class="text-xs text-[#9ca3af]">Idle</span>
              {:else if loc.status === 'running'}
                <span class="text-xs text-blue-600 font-medium">Running…</span>
              {:else if loc.status === 'done'}
                <span class="text-xs text-green-700 font-medium">✓ Done</span>
              {:else if loc.status === 'error'}
                <span class="text-xs text-red-600 font-medium">Errors</span>
              {/if}
            </td>
            <td class="px-4 py-3 text-center">
              <button
                onclick={() => runSingle(idx)}
                disabled={running || loc.status === 'running'}
                class="text-xs px-3 py-1 rounded font-medium text-[#1e3a5f]"
                style="border: 1px solid #cbd5e1; opacity: {running || loc.status === 'running' ? 0.4 : 1};"
              >
                {loc.status === 'done' ? 'Re-run' : loc.status === 'error' ? 'Retry' : 'Run'}
              </button>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Period reference -->
  <details class="mt-6">
    <summary class="text-xs text-[#6b7280] cursor-pointer">FY2025 Period Schedule</summary>
    <div class="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
      {#each PERIODS as p}
        <div class="text-xs p-2 rounded" style="background: #f8fafc; border: 1px solid #e2e8f0;">
          <span class="font-semibold text-[#1e3a5f]">P{p.p}</span>
          <span class="text-[#6b7280] ml-1">{p.start} → {p.end}</span>
        </div>
      {/each}
    </div>
  </details>
</div>
