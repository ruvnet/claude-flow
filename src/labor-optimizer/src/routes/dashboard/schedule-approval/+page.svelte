<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  const foh = ['Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training'];
  const boh = ['Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let userEmail = $state<string | null>(null);
  let canApprove = $state(false);

  async function fetchRolePermissions(email: string) {
    try {
      const _roleCtrl = new AbortController(); setTimeout(() => _roleCtrl.abort(), 8000); const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: _roleCtrl.signal });
      if (res.ok) {
        const data = await res.json();
        canApprove = data.permissions?.scheduleApprove ?? false;
      }
    } catch { canApprove = false; }
  }

  let locationId = $state('');
  let locations = $state<{id: string; name: string}[]>([]);
  let singleLocation = $state(false);
  let year = $state(2026);

  // Period/week detection (matches other tabs)
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

  let data = $state<any>(null);
  let loading = $state(false);
  let submitting = $state(false);
  let reviewing = $state(false);
  let scheduleViewMode = $state<'dollars' | 'hours' | 'pctrev'>('dollars');
  let forecastData = $state<any[]>([]);
  let dolceSyncing = $state(false);
  let dolceSyncMessage = $state('');

  async function pullFromTeamWork() {
    dolceSyncing = true;
    dolceSyncMessage = '';
    try {
      const res = await fetch('/api/v1/dolce-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ weekStart: getWeekStartDate() }) });
      const result = await res.json();
      dolceSyncMessage = res.ok ? 'TeamWork sync triggered successfully. Data will refresh shortly.' : (result.message || 'Sync failed');
      if (res.ok) setTimeout(() => loadData(), 3000);
    } catch { dolceSyncMessage = 'Failed to trigger sync'; }
    dolceSyncing = false;
    setTimeout(() => { dolceSyncMessage = ''; }, 8000);
  }
  let reviewNotes = $state('');
  let editingCell = $state<string | null>(null);
  let editValue = $state('');

  // Compute weekStartDate from period + week (use noon to avoid timezone shift)
  function getWeekStartDate(): string {
    const p1Start = new Date('2025-12-29T12:00:00');
    const daysOffset = (periodNumber - 1) * 28 + (week - 1) * 7;
    const ws = new Date(p1Start);
    ws.setDate(ws.getDate() + daysOffset);
    return ws.toISOString().split('T')[0];
  }

  async function load() {
    if (!locationId) return;
    loading = true;
    const weekStart = getWeekStartDate();
    const [schedRes, fcstRes] = await Promise.all([
      fetch(`/api/v1/schedule-approval?locationId=${locationId}&weekStartDate=${weekStart}`),
      fetch(`/api/v1/forecast?locationId=${locationId}&period=${periodNumber}&week=${week}&year=${year}`)
    ]);
    data = await schedRes.json();
    const fcstData = await fcstRes.json();
    // Filter forecast to only the 7 days matching the schedule week
    const scheduleDates = new Set((data?.days || []).map((d: any) => d.date));
    const allSuggestions = (fcstData.suggestions || []).map((s: any) => ({
      date: s.date,
      revenue: s.suggestedRevenue || 0,
      covers: s.suggestedCovers || 0,
    }));
    forecastData = allSuggestions.filter((f: any) => scheduleDates.has(f.date));
    loading = false;
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      userEmail = session?.user?.email ?? null;
      if (userEmail) await fetchRolePermissions(userEmail);
    });
    const locUrl = userEmail ? `/api/v1/auth/my-locations?email=${encodeURIComponent(userEmail)}` : '/api/v1/locations';
    fetch(locUrl).then(r => r.json()).then(d => {
      locations = d.locations || d || [];
      singleLocation = locations.length === 1;
      if (locations.length > 0) {
        const saved = localStorage.getItem('helixo_selected_location');
        locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
        load();
      }
    });
  });

  let showConfirmDialog = $state(false);

  function requestSubmit() {
    showConfirmDialog = true;
  }

  async function submitForApproval() {
    showConfirmDialog = false;
    submitting = true;
    await fetch('/api/v1/schedule-approval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, weekStartDate: getWeekStartDate(), submittedBy: userEmail }),
    });
    await load();
    submitting = false;
  }

  async function handleReview(action: 'approve' | 'deny' | 'revision_requested') {
    reviewing = true;
    await fetch('/api/v1/schedule-approval', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        weekStartDate: getWeekStartDate(),
        action,
        reviewedBy: userEmail,
        reviewNotes: reviewNotes || null,
      }),
    });
    reviewNotes = '';
    await load();
    reviewing = false;
  }

  async function saveScheduledValue(date: string, position: string, dollars: number) {
    await fetch('/api/v1/schedule-approval', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId, date, position, scheduledDollars: dollars, scheduledHours: 0 }),
    });
    editingCell = null;
    editValue = '';
    await load();
  }

  function fmt(n: number): string { return n ? '$' + Math.round(n).toLocaleString() : '-'; }
  function fmtVar(n: number): string { return n === 0 ? '-' : (n > 0 ? '+' : '') + '$' + Math.round(Math.abs(n)).toLocaleString(); }

  function statusLabel(s: string): string {
    const map: Record<string, string> = { draft: 'Draft', submitted: 'Submitted', approved: 'Approved', denied: 'Denied', revision_requested: 'Revision Requested' };
    return map[s] || s;
  }

  function statusStyle(s: string): string {
    const map: Record<string, string> = {
      draft: 'background: #f3f4f6; color: #374151;',
      submitted: 'background: #1e3a5f; color: white;',
      approved: 'background: #16a34a; color: white;',
      denied: 'background: #dc2626; color: white;',
      revision_requested: 'background: #ea580c; color: white;',
    };
    return map[s] || '';
  }

  function varianceColor(scheduled: number, projected: number): string {
    if (!projected || !scheduled) return '';
    const pct = (scheduled - projected) / projected;
    if (pct > 0.10) return 'color: #dc2626; font-weight: 600;';
    if (pct > 0.05) return 'color: #ea580c; font-weight: 600;';
    if (pct < -0.05) return 'color: #16a34a; font-weight: 600;';
    return '';
  }

  // Aggregate helpers — respect scheduleViewMode
  function getVal(p: any, field: 'projected' | 'scheduled'): number {
    if (scheduleViewMode === 'hours') return p[field + 'Hours'] || 0;
    return p[field] || 0;
  }
  function getDayRevenue(dayIdx: number): number {
    return forecastData[dayIdx]?.revenue || 0;
  }
  function dayTotalProjected(dayIdx: number, posNames: string[]): number {
    if (!data?.days?.[dayIdx]) return 0;
    return data.days[dayIdx].positions.filter((p: any) => posNames.includes(p.position)).reduce((s: number, p: any) => s + getVal(p, 'projected'), 0);
  }
  function dayTotalScheduled(dayIdx: number, posNames: string[]): number {
    if (!data?.days?.[dayIdx]) return 0;
    return data.days[dayIdx].positions.filter((p: any) => posNames.includes(p.position)).reduce((s: number, p: any) => s + getVal(p, 'scheduled'), 0);
  }
  function weekTotalProjected(posNames: string[]): number {
    let t = 0;
    for (let i = 0; i < 7; i++) t += dayTotalProjected(i, posNames);
    return t;
  }
  function weekTotalScheduled(posNames: string[]): number {
    let t = 0;
    for (let i = 0; i < 7; i++) t += dayTotalScheduled(i, posNames);
    return t;
  }
  function fmtVal(v: number, dayIdx?: number): string {
    if (scheduleViewMode === 'hours') return v > 0 ? v.toFixed(1) : '-';
    if (scheduleViewMode === 'pctrev' && dayIdx !== undefined) {
      const rev = getDayRevenue(dayIdx);
      return rev > 0 ? (v / rev * 100).toFixed(1) + '%' : '-';
    }
    if (scheduleViewMode === 'pctrev') return '-';
    return fmt(v);
  }

  let status = $derived(data?.schedule?.status || 'draft');
  let canSubmit = $derived(status === 'draft' || status === 'revision_requested');
  let canReview = $derived(canApprove && status === 'submitted');
</script>

<div class="p-3 md:p-4">
  <div class="flex items-center justify-between mb-1">
    <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Schedule Approval</h1>
    {#if data?.schedule}
      <span class="px-4 py-1.5 rounded-full text-sm font-semibold" style={statusStyle(status)}>
        {statusLabel(status)}
      </span>
    {/if}
  </div>
  <p class="text-sm text-[#6b7280] mb-6">Compare scheduled labor against AI-projected targets, then submit for approval.</p>

  {#if data?.isEstimated}
    <div class="leo-card p-3 mb-4" style="border-left: 3px solid #ea580c; background: #fff7ed;">
      <p class="text-xs text-[#9a3412]">
        <strong>Estimated Projections</strong> — Not all days have accepted forecasts yet. Labor targets are extrapolated from accepted days. Accept remaining forecasts in the Forecast tab for confirmed projections.
      </p>
    </div>
  {/if}

  <!-- Selectors -->
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
      <button onclick={() => { week = w; load(); }}
        class="px-4 py-2 rounded text-sm font-medium transition-colors"
        style="{week === w ? 'background: #1e3a5f; color: white;' : 'background: white; border: 1px solid #e5e7eb; color: #374151;'}">
        Week {w}
      </button>
    {/each}
    <span class="text-sm font-medium text-[#374151]">{year}</span>
    <div class="flex items-center gap-1.5 ml-auto">
      <span class="text-xs font-medium text-[#6b7280]">Display As</span>
      <div class="flex rounded-lg overflow-hidden" style="border: 1px solid #d1d5db;">
        <button type="button" onclick={() => { scheduleViewMode = 'dollars'; }} class="px-3 py-1.5 text-xs font-medium" style="{scheduleViewMode === 'dollars' ? 'background:#1e3a5f;color:white;' : 'background:white;color:#374151;'}">$</button>
        <button type="button" onclick={() => { scheduleViewMode = 'hours'; }} class="px-3 py-1.5 text-xs font-medium" style="{scheduleViewMode === 'hours' ? 'background:#1e3a5f;color:white;' : 'background:white;color:#374151;'}">Hours</button>
        <button type="button" onclick={() => { scheduleViewMode = 'pctrev'; }} class="px-3 py-1.5 text-xs font-medium" style="{scheduleViewMode === 'pctrev' ? 'background:#1e3a5f;color:white;' : 'background:white;color:#374151;'}">% Rev</button>
      </div>
    </div>
    <button onclick={pullFromTeamWork} disabled={dolceSyncing} class="leo-btn" style="font-size: 12px; padding: 6px 14px; background: {dolceSyncing ? '#9ca3af' : '#1e3a5f'};">
      {dolceSyncing ? 'Syncing...' : '↻ Pull from TeamWork'}
    </button>
    {#if dolceSyncMessage}<span class="text-xs ml-2" style="color: {dolceSyncMessage.includes('success') ? '#16a34a' : '#dc2626'};">{dolceSyncMessage}</span>{/if}
  </div>

  <!-- Integration note -->
  <div class="leo-card p-3 mb-6" style="border-left: 3px solid #1e3a5f; background: #f8fafc;">
    <p class="text-xs text-[#6b7280]">
      <strong class="text-[#1e3a5f]">Dolce TeamWork</strong> — Scheduled labor syncs automatically every Thursday at 1:00 PM EST.
    </p>
  </div>

  {#if loading}
    <div class="text-center py-20 text-[#9ca3af]">Loading...</div>
  {:else if data?.days}
    <!-- Approved Forecast Revenue -->
    {#if forecastData.length > 0}
    <h2 class="leo-section-title mt-4 mb-3">Approved Forecast</h2>
    <div class="leo-card leo-table-scroll mb-6">
      <table class="w-full leo-table">
        <thead>
          <tr>
            <th class="leo-th" style="text-align: left; width: 100px;"></th>
            {#each data.days as day, i}
            <th class="leo-th" style="text-align: center;">{dayLabels[i]}<br/><span style="font-size:10px;font-weight:400;">{parseInt(day.date.split('-')[1])}/{parseInt(day.date.split('-')[2])}</span></th>
            {/each}
            <th class="leo-th" style="text-align: center;">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="leo-td font-medium" style="text-align: left;">Revenue</td>
            {#each forecastData as fc}
            <td class="leo-td" style="text-align: center;">{fmt(Math.round(fc.revenue))}</td>
            {/each}
            <td class="leo-td font-bold" style="text-align: center;">{fmt(Math.round(forecastData.reduce((s, f) => s + f.revenue, 0)))}</td>
          </tr>
          <tr>
            <td class="leo-td font-medium" style="text-align: left;">Covers</td>
            {#each forecastData as fc}
            <td class="leo-td" style="text-align: center;">{fc.covers}</td>
            {/each}
            <td class="leo-td font-bold" style="text-align: center;">{forecastData.reduce((s, f) => s + f.covers, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    {/if}
    <!-- Comparison table -->
    {#each [{title:'FOH Positions', positions: foh}, {title:'BOH Positions', positions: boh}] as section}
      <h2 class="leo-section-title mt-6 mb-3">{section.title}</h2>
      <div class="leo-card mb-4 leo-table-scroll">
        <table class="w-full leo-table" style="min-width: 900px;">
          <thead>
            <tr>
              <th class="leo-th" rowspan="2" style="width: 110px; text-align: left;">Position</th>
              {#each data.days as day, i}
                <th class="leo-th" style="font-size: 10px; min-width: 110px; text-align: center; padding: 4px 8px;" colspan="2">
                  {new Date(day.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                </th>
              {/each}
              <th class="leo-th" style="font-weight: 700; min-width: 110px; text-align: center; padding: 4px 8px;" colspan="2">TOTAL</th>
              <th class="leo-th" rowspan="2" style="font-weight: 700; width: 80px; text-align: center;">Var</th>
            </tr>
            <tr>
              {#each data.days as day}
                <th class="leo-th" style="font-size: 9px; text-align: center; padding: 2px 4px;">PROJ</th>
                <th class="leo-th" style="font-size: 9px; text-align: center; padding: 2px 4px;">SCHED</th>
              {/each}
              <th class="leo-th" style="font-size: 9px; text-align: center; padding: 2px 4px;">PROJ</th>
              <th class="leo-th" style="font-size: 9px; text-align: center; padding: 2px 4px;">SCHED</th>
            </tr>
          </thead>
          <tbody>
            {#each section.positions as position}
              {@const weekProj = data.days.reduce((s: number, d: any, i: number) => { const p = d.positions.find((p: any) => p.position === position); return s + getVal(p || {}, 'projected'); }, 0)}
              {@const weekSched = data.days.reduce((s: number, d: any, i: number) => { const p = d.positions.find((p: any) => p.position === position); return s + getVal(p || {}, 'scheduled'); }, 0)}
              {@const weekVar = weekSched - weekProj}
              <tr>
                <td class="leo-td font-medium text-[#1a1a1a]" style="font-size: 12px;">{position}</td>
                {#each data.days as day, dayIdx}
                  {@const posData = day.positions.find((p: any) => p.position === position)}
                  <td class="leo-td" style="font-size: 12px; text-align: center; color: #1a1a1a;">{fmtVal(getVal(posData || {}, 'projected'), dayIdx)}</td>
                  <td class="leo-td" style="font-size: 12px; text-align: center; {varianceColor(getVal(posData || {}, 'scheduled'), getVal(posData || {}, 'projected'))}">
                    {#if editingCell === `${day.date}-${position}` && canSubmit && scheduleViewMode === 'dollars'}
                      <input
                        type="number"
                        bind:value={editValue}
                        onblur={() => saveScheduledValue(day.date, position, Number(editValue) || 0)}
                        onkeydown={(e) => { if (e.key === 'Enter') saveScheduledValue(day.date, position, Number(editValue) || 0); if (e.key === 'Escape') { editingCell = null; editValue = ''; } }}
                        class="w-16 px-1 py-0.5 text-xs border rounded"
                        style="border-color: #1e3a5f;"
                      />
                    {:else}
                      <button
                        onclick={() => { if (canSubmit && scheduleViewMode === 'dollars') { editingCell = `${day.date}-${position}`; editValue = String(posData?.scheduled || ''); } }}
                        class="w-full text-center {canSubmit && scheduleViewMode === 'dollars' ? 'cursor-pointer hover:bg-blue-50' : ''}"
                        style="font-size: 12px; background: none; border: none; padding: 2px 4px; {getVal(posData || {}, 'scheduled') ? '' : 'color: #d1d5db;'}"
                        disabled={!canSubmit || scheduleViewMode !== 'dollars'}>
                        {fmtVal(getVal(posData || {}, 'scheduled'), dayIdx)}
                      </button>
                    {/if}
                  </td>
                {/each}
                <td class="leo-td font-bold" style="font-size: 12px; text-align: center; color: #1a1a1a;">{scheduleViewMode === 'pctrev' ? (forecastData.reduce((s,f) => s+f.revenue, 0) > 0 ? (weekProj / forecastData.reduce((s,f) => s+f.revenue, 0) * 100).toFixed(1) + '%' : '-') : scheduleViewMode === 'hours' ? weekProj.toFixed(1) : fmt(weekProj)}</td>
                <td class="leo-td font-bold" style="font-size: 12px; text-align: center;">{scheduleViewMode === 'pctrev' ? (forecastData.reduce((s,f) => s+f.revenue, 0) > 0 ? (weekSched / forecastData.reduce((s,f) => s+f.revenue, 0) * 100).toFixed(1) + '%' : '-') : scheduleViewMode === 'hours' ? weekSched.toFixed(1) : fmt(weekSched)}</td>
                <td class="leo-td font-bold" style="font-size: 12px; {varianceColor(weekSched, weekProj)}">{weekProj || weekSched ? fmtVar(weekVar) : '-'}</td>
              </tr>
            {/each}
            <!-- Section subtotal row -->
            <tr style="background: #f8fafc; border-top: 2px solid #e5e7eb;">
              <td class="leo-td font-bold text-[#1a1a1a]" style="font-size: 12px;">{section.title.includes('FOH') ? 'FOH Total' : 'BOH Total'}</td>
              {#each data.days as _, dayIdx}
                <td class="leo-td font-bold" style="font-size: 12px; text-align: center; color: #1a1a1a;">{fmtVal(dayTotalProjected(dayIdx, section.positions), dayIdx)}</td>
                <td class="leo-td font-bold" style="font-size: 12px; text-align: center; {varianceColor(dayTotalScheduled(dayIdx, section.positions), dayTotalProjected(dayIdx, section.positions))}">{fmtVal(dayTotalScheduled(dayIdx, section.positions), dayIdx)}</td>
              {/each}
              <td class="leo-td font-bold" style="font-size: 12px; text-align: center; color: #1a1a1a;">{scheduleViewMode === 'pctrev' ? (forecastData.reduce((s: any,f: any) => s+f.revenue, 0) > 0 ? (weekTotalProjected(section.positions) / forecastData.reduce((s: any,f: any) => s+f.revenue, 0) * 100).toFixed(1) + '%' : '-') : scheduleViewMode === 'hours' ? weekTotalProjected(section.positions).toFixed(1) : fmt(weekTotalProjected(section.positions))}</td>
              <td class="leo-td font-bold" style="font-size: 12px; text-align: center;">{scheduleViewMode === 'pctrev' ? (forecastData.reduce((s: any,f: any) => s+f.revenue, 0) > 0 ? (weekTotalScheduled(section.positions) / forecastData.reduce((s: any,f: any) => s+f.revenue, 0) * 100).toFixed(1) + '%' : '-') : scheduleViewMode === 'hours' ? weekTotalScheduled(section.positions).toFixed(1) : fmt(weekTotalScheduled(section.positions))}</td>
              <td class="leo-td font-bold" style="font-size: 12px; text-align: center; {varianceColor(weekTotalScheduled(section.positions), weekTotalProjected(section.positions))}">{fmtVar(weekTotalScheduled(section.positions) - weekTotalProjected(section.positions))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    {/each}

    <!-- Grand total row -->
    <div class="leo-card mb-6 leo-table-scroll">
      <table class="w-full leo-table" style="min-width: 900px;">
        <tbody>
          {#each [{ allPos: [...foh, ...boh] }] as ctx}
          <tr style="background: #f1f5f9; border-top: 2px solid #1e3a5f; font-weight: 600;">
            <td class="leo-td font-bold" style="width: 110px; font-size: 13px; color: #1e3a5f;">TOTAL</td>
            {#each data.days as _, dayIdx}
              <td class="leo-td font-bold" style="font-size: 12px; text-align: center;">{fmtVal(dayTotalProjected(dayIdx, ctx.allPos), dayIdx)}</td>
              <td class="leo-td font-bold" style="font-size: 12px; text-align: center;">{fmtVal(dayTotalScheduled(dayIdx, ctx.allPos), dayIdx)}</td>
            {/each}
            <td class="leo-td font-bold" style="font-size: 12px; text-align: center;">{scheduleViewMode === 'pctrev' ? (forecastData.reduce((s: any,f: any) => s+f.revenue, 0) > 0 ? (weekTotalProjected(ctx.allPos) / forecastData.reduce((s: any,f: any) => s+f.revenue, 0) * 100).toFixed(1) + '%' : '-') : scheduleViewMode === 'hours' ? weekTotalProjected(ctx.allPos).toFixed(1) : fmt(weekTotalProjected(ctx.allPos))}</td>
            <td class="leo-td font-bold" style="font-size: 12px; text-align: center;">{scheduleViewMode === 'pctrev' ? (forecastData.reduce((s: any,f: any) => s+f.revenue, 0) > 0 ? (weekTotalScheduled(ctx.allPos) / forecastData.reduce((s: any,f: any) => s+f.revenue, 0) * 100).toFixed(1) + '%' : '-') : scheduleViewMode === 'hours' ? weekTotalScheduled(ctx.allPos).toFixed(1) : fmt(weekTotalScheduled(ctx.allPos))}</td>
            <td class="leo-td font-bold" style="font-size: 12px; width: 80px; text-align: center;">{fmtVar(weekTotalScheduled(ctx.allPos) - weekTotalProjected(ctx.allPos))}</td>
          </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Actions -->
    <div class="flex flex-col gap-4">
      {#if canSubmit}
        <div class="flex items-center gap-3">
          <button onclick={requestSubmit} disabled={submitting}
            class="leo-btn" style="background: #1e3a5f; color: white; {submitting ? 'opacity: 0.5;' : ''}">
            {submitting ? 'Submitting...' : 'Submit for Approval'}
          </button>
          {#if status === 'revision_requested'}
            <span class="text-sm text-[#ea580c]">Revision requested — update schedule and resubmit.</span>
          {/if}
        </div>
      {/if}

      {#if canReview}
        <div class="leo-card p-5">
          <h3 class="text-sm font-semibold text-[#1a1a1a] mb-3">Admin Review</h3>
          <textarea bind:value={reviewNotes} placeholder="Review notes (optional)..."
            class="w-full border rounded px-3 py-2 text-sm mb-3" style="border-color: #e5e7eb; min-height: 60px;"></textarea>
          <div class="flex gap-2">
            <button onclick={() => handleReview('approve')} disabled={reviewing}
              class="px-4 py-2 rounded text-sm font-medium" style="background: #16a34a; color: white;">
              {reviewing ? '...' : 'Approve'}
            </button>
            <button onclick={() => handleReview('deny')} disabled={reviewing}
              class="px-4 py-2 rounded text-sm font-medium" style="background: #dc2626; color: white;">
              {reviewing ? '...' : 'Deny'}
            </button>
            <button onclick={() => handleReview('revision_requested')} disabled={reviewing}
              class="px-4 py-2 rounded text-sm font-medium" style="background: #ea580c; color: white;">
              {reviewing ? '...' : 'Request Revision'}
            </button>
          </div>
        </div>
      {/if}

      <!-- Status timeline -->
      {#if data.schedule?.submitted_at || data.schedule?.reviewed_at}
        <div class="leo-card p-5">
          <h3 class="text-sm font-semibold text-[#1a1a1a] mb-3">Status History</h3>
          <div class="space-y-2">
            {#if data.schedule?.submitted_at}
              <div class="flex items-center gap-2 text-sm">
                <span class="w-2 h-2 rounded-full" style="background: #1e3a5f;"></span>
                <span class="text-[#374151]">Submitted by <strong>{data.schedule.submitted_by}</strong></span>
                <span class="text-[#9ca3af]">{new Date(data.schedule.submitted_at).toLocaleString()}</span>
              </div>
            {/if}
            {#if data.schedule?.reviewed_at}
              <div class="flex items-center gap-2 text-sm">
                <span class="w-2 h-2 rounded-full" style="background: {status === 'approved' ? '#16a34a' : status === 'denied' ? '#dc2626' : '#ea580c'};"></span>
                <span class="text-[#374151]">{statusLabel(status)} by <strong>{data.schedule.reviewed_by}</strong></span>
                <span class="text-[#9ca3af]">{new Date(data.schedule.reviewed_at).toLocaleString()}</span>
              </div>
              {#if data.schedule.review_notes}
                <div class="ml-4 p-2 rounded text-sm text-[#6b7280]" style="background: #f3f4f6;">
                  {data.schedule.review_notes}
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="text-center py-20 text-[#9ca3af]">Select a location to view schedule.</div>
  {/if}

  <!-- Confirmation Dialog -->
  {#if showConfirmDialog}
    <div style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; display: flex; align-items: center; justify-content: center;">
      <div class="leo-card p-6" style="max-width: 400px; width: 100%;">
        <h3 class="text-lg font-bold text-[#1a1a1a] mb-2">Confirm Submission</h3>
        <p class="text-sm text-[#6b7280] mb-6">Are you sure you want to submit this schedule for approval? Once submitted, it cannot be edited until reviewed.</p>
        <div class="flex justify-end gap-3">
          <button onclick={() => showConfirmDialog = false}
            class="leo-btn-secondary" style="padding: 8px 20px;">Cancel</button>
          <button onclick={submitForApproval}
            class="leo-btn" style="background: #1e3a5f; padding: 8px 20px;">Submit</button>
        </div>
      </div>
    </div>
  {/if}
</div>
