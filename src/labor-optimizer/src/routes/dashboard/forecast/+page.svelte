<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import ForecastDetailPanel from '$lib/components/dashboard/ForecastDetailPanel.svelte';
  import ForecastSummaryCards from '$lib/components/dashboard/ForecastSummaryCards.svelte';
  import ForecastDataSignals from '$lib/components/dashboard/ForecastDataSignals.svelte';
  import RevenueHeatmapCalendar from '$lib/components/dashboard/RevenueHeatmapCalendar.svelte';
  import ConfidenceHeatmapDOW from '$lib/components/dashboard/ConfidenceHeatmapDOW.svelte';
  import RevenueWaterfallChart from '$lib/components/dashboard/RevenueWaterfallChart.svelte';
  import ManagerOverrideTracker from '$lib/components/dashboard/ManagerOverrideTracker.svelte';

  let locationId = $state('');
  let locations = $state<{id: string; name: string}[]>([]);
  let singleLocation = $state(false);
  let forecasts = $state<any[]>([]);
  let modelStats = $state<any>(null);
  let managerAccuracySummary = $state<any>(null);
  let trailing2Weeks = $state<any[]>([]);
  let sameWeekLastYear = $state<any[]>([]);
  let loading = $state(false);
  let expandedIdx = $state<number | null>(null);
  let overrideIdx = $state<number | null>(null);
  let overrideRevenue = $state(0);
  let overrideMode = $state<'revenue' | 'covers'>('revenue');
  let overrideCovers = $state(0);
  let overrideTags = $state<string[]>([]);
  let overrideOtherNote = $state('');
  let year = $state(2026);
  let chartLegend = $state<Record<string, boolean>>({ helixo: true, manager: true, t2w: true, py: true, budget: true });
  let chartMetric = $state<'revenue' | 'covers' | 'avgcheck'>('revenue');
  let filterDropdownOpen = $state(false);
  let toastMessage = $state('');
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showToast(msg: string) { toastMessage = msg; if (toastTimer) clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastMessage = ''; }, 4000); }

  // Intraday tracker
  let intradayData = $state<any>(null);
  let intradayLoading = $state(false);
  function isViewingToday(): boolean { const d = detectCurrentPeriodAndWeek(); return periodNumber === d.period && (weekFilter === d.week || weekFilter === 0); }
  async function loadIntradayTracker() { if (!locationId) return; intradayLoading = true; try { const r = await fetch(`/api/v1/forecast/intraday?locationId=${locationId}`); if (r.ok) intradayData = await r.json(); } catch (e) { console.error('[Intraday]', e); } finally { intradayLoading = false; } }

  function toggleTag(tag: string) { overrideTags = overrideTags.includes(tag) ? overrideTags.filter(t => t !== tag) : [...overrideTags, tag]; if (tag === 'Other' && !overrideTags.includes('Other')) overrideOtherNote = ''; }
  function hasValidTags(): boolean { if (overrideTags.length === 0) return false; if (overrideTags.length === 1 && overrideTags[0] === 'Other' && !overrideOtherNote.trim()) return false; return true; }

  let currentUserEmail = $state<string | null>(null);
  let canUnlock = $state(false);
  async function fetchRolePermissions(email: string) { try { const _c = new AbortController(); setTimeout(() => _c.abort(), 8000); const r = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: _c.signal }); if (r.ok) { const d = await r.json(); canUnlock = d.permissions?.forecastUnlock ?? false; } } catch { canUnlock = false; } }

  function detectCurrentPeriodAndWeek(): { period: number; week: number } {
    const p1Start = new Date('2025-12-29T12:00:00');
    const today = new Date();
    const daysSinceP1 = Math.floor((today.getTime() - p1Start.getTime()) / (1000 * 60 * 60 * 24));
    return { period: Math.min(13, Math.max(1, Math.floor(daysSinceP1 / 28) + 1)), week: Math.min(4, Math.floor((daysSinceP1 % 28) / 7) + 1) };
  }
  const detected = detectCurrentPeriodAndWeek();
  let periodNumber = $state(detected.period);
  let weekFilter = $state(detected.week);

  function getWeekDateRange(period: number, week: number) {
    const p1Start = new Date('2025-12-29T12:00:00');
    const periodStart = new Date(p1Start.getTime() + (period - 1) * 28 * 86400000);
    const weekStart = new Date(periodStart.getTime() + (week - 1) * 7 * 86400000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    return { start: weekStart.toISOString().split('T')[0], end: weekEnd.toISOString().split('T')[0] };
  }

  let filteredForecasts = $derived.by(() => { if (weekFilter === 0) return forecasts; const r = getWeekDateRange(periodNumber, weekFilter); return forecasts.filter(f => f.date >= r.start && f.date <= r.end); });

  // Filter sameWeekLastYear to only the dates that correspond to the current week view.
  // sameWeekLastYear contains PY dates (e.g. "2025-04-01"); each maps forward +364 days to the current date.
  // When viewing a specific week we only want that week's LY totals for an accurate "vs LY" comparison.
  let filteredSWLY = $derived.by(() => {
    if (weekFilter === 0 || sameWeekLastYear.length === 0) return sameWeekLastYear;
    const { start, end } = getWeekDateRange(periodNumber, weekFilter);
    return sameWeekLastYear.filter((d: any) => {
      if (!d.date) return false;
      const lyDate = new Date(d.date + 'T12:00:00');
      lyDate.setDate(lyDate.getDate() + 364);
      const mapped = lyDate.toISOString().split('T')[0];
      return mapped >= start && mapped <= end;
    });
  });

  async function loadForecasts() {
    if (!locationId) return; loading = true;
    try {
      const periodRes = await fetch(`/api/v1/kpi?locationId=${locationId}&period=${periodNumber}&year=${year}`);
      const periodData = await periodRes.json();
      if (!periodData.period) { loading = false; return; }
      const { startDate, endDate } = periodData.period;
      const res = await fetch(`/api/v1/forecast?locationId=${locationId}&startDate=${startDate}&endDate=${endDate}`);
      const data = await res.json();
      forecasts = data.suggestions || [];
      modelStats = data.modelStats || null;
      managerAccuracySummary = data.managerAccuracySummary || null;
      trailing2Weeks = data.trailing2Weeks || [];
      sameWeekLastYear = data.sameWeekLastYear || [];
      if (isViewingToday()) loadIntradayTracker();
    } catch (e) { console.error(e); } finally { loading = false; }
  }

  let weekLockBanner = $state('');
  let weekSubmitting = $state(false);

  async function acceptForecast(idx: number) {
    const f = filteredForecasts[idx];
    const res = await fetch('/api/v1/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId, date: f.date, revenue: Math.round(f.suggestedRevenue), isOverride: false, acceptedBy: currentUserEmail || 'manager' }) });
    if (res.ok) {
      const r = await res.json();
      const srcIdx = forecasts.findIndex(fc => fc.date === f.date);
      if (srcIdx !== -1) { forecasts[srcIdx] = { ...f, accepted: true, locked: false, managerRevenue: f.suggestedRevenue, acceptedBy: currentUserEmail }; forecasts = [...forecasts]; }
      showToast('Forecast accepted');
    } else { showToast('Error accepting forecast: ' + res.status); }
  }

  async function submitOverride(idx: number) {
    const f = filteredForecasts[idx];
    if (!hasValidTags()) return;
    const tags = overrideTags.includes('Other') && overrideOtherNote.trim() ? overrideTags.map(t => t === 'Other' ? `Other: ${overrideOtherNote.trim()}` : t) : [...overrideTags];
    const res = await fetch('/api/v1/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId, date: f.date, revenue: Math.round(overrideRevenue), isOverride: true, overrideTags: tags, acceptedBy: currentUserEmail || 'manager' }) });
    if (res.ok) {
      const srcIdx = forecasts.findIndex(fc => fc.date === f.date);
      if (srcIdx !== -1) { forecasts[srcIdx] = { ...f, accepted: true, overridden: true, locked: false, managerRevenue: overrideRevenue, acceptedBy: currentUserEmail, overrideTags: tags }; forecasts = [...forecasts]; }
      overrideIdx = null; expandedIdx = null; overrideTags = []; overrideOtherNote = ''; overrideMode = 'revenue';
    } else { showToast('Error overriding forecast: ' + res.status); }
  }

  async function unlockForecast(idx: number) {
    const f = filteredForecasts[idx];
    const res = await fetch('/api/v1/forecast', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId, date: f.date, userEmail: currentUserEmail }) });
    if (res.ok) { const srcIdx = forecasts.findIndex(fc => fc.date === f.date); if (srcIdx !== -1) forecasts[srcIdx] = { ...f, locked: false, accepted: false, managerRevenue: null, overridden: false, overrideTags: [] }; }
    else { const err = await res.json(); showToast(err.error || 'Failed to unlock'); }
  }

  let remainingCount = $derived(filteredForecasts.filter(f => !f.accepted && !f.locked).length);
  let allAcceptedNotLocked = $derived.by(() => { if (weekFilter === 0) return false; const w = filteredForecasts; return w.length === 7 && w.every(f => f.accepted) && !w.every(f => f.locked); });
  let anyLocked = $derived(filteredForecasts.some(f => f.locked));
  let currentWeekTotal = $derived(filteredForecasts.reduce((s, f) => s + (f.managerRevenue || f.suggestedRevenue || 0), 0));

  async function acceptAllRemaining() { for (let i = 0; i < filteredForecasts.length; i++) { if (!filteredForecasts[i].accepted && !filteredForecasts[i].locked) await acceptForecast(i); } }

  async function submitWeekForecast() {
    if (weekFilter === 0) return;
    const range = getWeekDateRange(periodNumber, weekFilter);
    weekSubmitting = true;
    try {
      const res = await fetch('/api/v1/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'submit_week', locationId, weekStartDate: range.start, acceptedBy: currentUserEmail || 'manager' }) });
      if (res.ok) {
        const r = await res.json();
        for (let j = 0; j < forecasts.length; j++) { if (forecasts[j].date >= range.start && forecasts[j].date <= range.end && forecasts[j].accepted) forecasts[j] = { ...forecasts[j], locked: true, lockedBy: currentUserEmail }; }
        forecasts = [...forecasts];
        weekLockBanner = 'Weekly forecast submitted and locked';
        setTimeout(() => { weekLockBanner = ''; }, 8000);

        // Also submit to the Approval Workflow queue for director/super_admin review
        const weDate = new Date(range.start + 'T12:00:00');
        weDate.setDate(weDate.getDate() + 6);
        const weekEndDate = weDate.toISOString().split('T')[0];
        fetch('/api/v1/approval-workflow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'submit_forecast',
            locationId,
            periodNumber,
            year,
            weekNumber: weekFilter,
            weekStartDate: range.start,
            weekEndDate,
            totalForecastRevenue: Math.round(currentWeekTotal),
            submittedBy: currentUserEmail || 'manager',
          }),
        }).catch(() => {/* non-fatal — approval queue is best-effort */});
      } else { const err = await res.json(); showToast(err.error || 'Failed to submit'); }
    } catch (e) { showToast('Error submitting week forecast'); } finally { weekSubmitting = false; }
  }

  function fmt(n: number): string { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n); }

  function toggleRow(i: number) {
    if (expandedIdx === i && overrideIdx !== i) { expandedIdx = null; }
    else { expandedIdx = i; if (overrideIdx !== null && overrideIdx !== i) overrideIdx = null; }
  }

  function startOverride(i: number) {
    const f = filteredForecasts[i];
    overrideIdx = i; expandedIdx = i; overrideRevenue = f.suggestedRevenue; overrideCovers = f.suggestedCovers || 0; overrideMode = 'revenue';
  }

  function confidenceBorderColor(c: number): string { return c >= 0.75 ? '#16a34a' : c >= 0.5 ? '#eab308' : '#dc2626'; }
  function statusBorderColor(f: any): string { return f.locked ? '#374151' : f.accepted ? '#16a34a' : '#d1d5db'; }

  $effect(() => {
    const supabase = getClientSupabase();
    (async () => {
      // Use getSession() (localStorage — instant) instead of getUser() (network — slow/unreliable on refresh)
      let { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        await new Promise(r => setTimeout(r, 600));
        ({ data: { session } } = await supabase.auth.getSession());
      }
      currentUserEmail = session?.user?.email ?? null;
      if (currentUserEmail) await fetchRolePermissions(currentUserEmail);
      const locUrl = currentUserEmail
        ? `/api/v1/auth/my-locations?email=${encodeURIComponent(currentUserEmail)}`
        : '/api/v1/locations';
      try {
        const d = await fetch(locUrl).then(r => r.json());
        locations = d.locations || d || [];
      } catch { locations = []; }
      singleLocation = locations.length === 1;
      if (locations.length > 0) {
        const saved = localStorage.getItem('helixo_selected_location');
        locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
        loadForecasts();
      } else if (!currentUserEmail) {
        // Auth state hasn't resolved yet — wait for it
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
          if (s?.user?.email && locations.length === 0) {
            subscription.unsubscribe();
            currentUserEmail = s.user.email;
            await fetchRolePermissions(currentUserEmail!);
            const d2 = await fetch(`/api/v1/auth/my-locations?email=${encodeURIComponent(currentUserEmail!)}`).then(r => r.json());
            locations = d2.locations || d2 || [];
            singleLocation = locations.length === 1;
            if (locations.length > 0) {
              const saved = localStorage.getItem('helixo_selected_location');
              locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
              loadForecasts();
            }
          }
        });
        setTimeout(() => subscription.unsubscribe(), 10000);
      }
    })();
  });
</script>

<div class="p-3 md:p-4">
  <!-- Header -->
  <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
    <div>
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Revenue Forecast Manager</h1>
      <p class="text-sm text-[#6b7280]">AI-suggested revenue forecasts -- click a day to explore, accept, or override</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
      {#if singleLocation}<span class="text-sm font-medium text-[#374151]">{locations[0]?.name}</span>
      {:else}<select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); loadForecasts(); }} class="leo-select flex-1 sm:flex-none">{#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}</select>{/if}
      <select bind:value={periodNumber} onchange={loadForecasts} class="leo-select">{#each Array.from({length: 13}, (_, i) => i + 1) as p}<option value={p}>P{p}</option>{/each}</select>
      <select bind:value={weekFilter} class="leo-select"><option value={0}>Full Period</option>{#each [1,2,3,4] as w}<option value={w}>W{w}</option>{/each}</select>
      <span class="text-sm font-medium text-[#374151]">{year}</span>
      {#if remainingCount > 0}<button onclick={acceptAllRemaining} class="leo-btn w-full sm:w-auto" style="background: #16a34a;">Accept All ({remainingCount})</button>{/if}
    </div>
  </div>

  {#if weekLockBanner}<div class="mb-4 p-3 rounded-lg text-sm font-medium" style="background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0;">{weekLockBanner}</div>{/if}

  {#if loading}<div class="text-center py-20 text-[#9ca3af]">Generating forecasts...</div>
  {:else}

  <!-- KPI Summary Cards (top of page) -->
  <ForecastSummaryCards forecasts={filteredForecasts} {modelStats} {managerAccuracySummary} {trailing2Weeks} sameWeekLastYear={filteredSWLY} {fmt} showPreSubmit={false} weekTotal={currentWeekTotal} />

  <!-- RevPASH Card Row -->
  {#if filteredForecasts.length > 0}
  {@const totalRevPASH = filteredForecasts.reduce((s, f) => s + (f.managerRevenue || f.suggestedRevenue || 0), 0)}
  {@const totalCoversRevPASH = filteredForecasts.reduce((s, f) => s + (f.suggestedCovers || 0), 0)}
  {@const revPASH = totalCoversRevPASH > 0 ? totalRevPASH / (totalCoversRevPASH * 1.5) : 0}
  {@const avgCheck = totalCoversRevPASH > 0 ? totalRevPASH / totalCoversRevPASH : 0}
  {@const peakRevDay = filteredForecasts.reduce((m, f) => (f.managerRevenue || f.suggestedRevenue || 0) > (m.managerRevenue || m.suggestedRevenue || 0) ? f : m, filteredForecasts[0])}
  {@const wkT2WComp = filteredForecasts.reduce((s,f) => s+(f.trailing2wAvg||0), 0)}
  {@const wkSDLYComp = filteredForecasts.reduce((s,f) => s+(f.samePeriodPY||0), 0)}
  {@const wkBudget2 = filteredForecasts.reduce((s,f) => s+(f.budgetRevenue||0), 0)}
  {@const t2wAvgCheck = totalCoversRevPASH > 0 ? wkT2WComp / totalCoversRevPASH : 0}
  {@const lyAvgCheck  = totalCoversRevPASH > 0 ? wkSDLYComp  / totalCoversRevPASH : 0}
  {@const t2wRevPASH  = totalCoversRevPASH > 0 ? wkT2WComp / (totalCoversRevPASH * 1.5) : 0}
  {@const lyRevPASH   = totalCoversRevPASH > 0 ? wkSDLYComp  / (totalCoversRevPASH * 1.5) : 0}
  {@const overrideCount = filteredForecasts.filter(f => f.overridden).length}
  {@const acceptedCount = filteredForecasts.filter(f => f.accepted || f.locked).length}
  {@const avgConf2 = filteredForecasts.length > 0 ? filteredForecasts.reduce((s,f) => s+(f.confidence||0),0) / filteredForecasts.length : 0}
  {@const budgetDeltaPct = wkBudget2 > 0 ? ((totalRevPASH - wkBudget2) / wkBudget2 * 100) : null}
  {@const sdlyDeltaPct = wkSDLYComp > 0 ? ((totalRevPASH - wkSDLYComp) / wkSDLYComp * 100) : null}
  <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
    <div class="leo-card p-3">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">RevPASH (est.)</div>
      <div class="text-lg font-bold text-[#1e3a5f]">{fmt(Math.round(revPASH))}</div>
      <div class="flex gap-3 mt-1">
        {#if t2wRevPASH > 0}<span class="text-xs" style="color:{revPASH >= t2wRevPASH ? '#16a34a' : '#dc2626'};">vs T2W: {revPASH >= t2wRevPASH ? '▲' : '▼'} {fmt(Math.round(t2wRevPASH))}</span>{/if}
        {#if lyRevPASH > 0}<span class="text-xs text-[#9ca3af]">LY: {fmt(Math.round(lyRevPASH))}</span>{/if}
      </div>
    </div>
    <div class="leo-card p-3">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Avg Check</div>
      <div class="text-lg font-bold text-[#1e3a5f]">{fmt(Math.round(avgCheck))}</div>
      <div class="flex gap-3 mt-1">
        {#if t2wAvgCheck > 0}<span class="text-xs" style="color:{avgCheck >= t2wAvgCheck ? '#16a34a' : '#dc2626'};">vs T2W: {avgCheck >= t2wAvgCheck ? '▲' : '▼'} {fmt(Math.round(t2wAvgCheck))}</span>{/if}
        {#if lyAvgCheck > 0}<span class="text-xs text-[#9ca3af]">LY: {fmt(Math.round(lyAvgCheck))}</span>{/if}
      </div>
    </div>
    <div class="leo-card p-3">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">vs Budget</div>
      {#if wkBudget2 > 0 && budgetDeltaPct !== null}
        <div class="text-lg font-bold" style="color:{budgetDeltaPct >= 0 ? '#16a34a' : '#dc2626'};">{budgetDeltaPct >= 0 ? '+' : ''}{budgetDeltaPct.toFixed(1)}%</div>
        <div class="flex gap-3 mt-1">
          <span class="text-xs text-[#6b7280]">Bdgt: {fmt(Math.round(wkBudget2))}</span>
          {#if sdlyDeltaPct !== null}<span class="text-xs" style="color:{sdlyDeltaPct >= 0 ? '#16a34a' : '#dc2626'};">vs LY: {sdlyDeltaPct >= 0 ? '+' : ''}{sdlyDeltaPct.toFixed(1)}%</span>{/if}
        </div>
      {:else}
        <div class="text-lg font-bold text-[#9ca3af]">--</div>
        <div class="text-xs text-[#9ca3af] mt-1">No budget set</div>
      {/if}
    </div>
    <div class="leo-card p-3">
      <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Forecast Status</div>
      <div class="text-lg font-bold text-[#1e3a5f]">{acceptedCount}<span class="text-sm font-normal text-[#9ca3af]"> / {filteredForecasts.length} days</span></div>
      <div class="flex gap-3 mt-1">
        <span class="text-xs" style="color:{overrideCount === 0 ? '#16a34a' : '#ea580c'};">{overrideCount === 0 ? 'All HELIXO' : `${overrideCount} override${overrideCount > 1 ? 's' : ''}`}</span>
        <span class="text-xs text-[#9ca3af]">Conf: {(avgConf2 * 100).toFixed(0)}%</span>
      </div>
    </div>
  </div>
  {/if}

  <!-- Forecast Table -->
  <div class="leo-card leo-table-scroll mb-4">
    <table class="w-full leo-table" style="min-width: 800px;">
      <thead><tr>
        <th class="leo-th">Date</th><th class="leo-th">Day</th><th class="leo-th" style="text-align:center;">Weather</th>
        <th class="leo-th">HELIXO Forecast</th><th class="leo-th">Covers</th><th class="leo-th">Avg Check</th>
        <th class="leo-th" title="Revenue Per Available Seat-Hour (estimated: revenue ÷ covers × 1.5h dwell)">RevPASH</th>
        <th class="leo-th">SDLY</th><th class="leo-th">T2W Avg</th><th class="leo-th">Budget</th>
        <th class="leo-th">User Forecast</th><th class="leo-th" style="text-align:center;">Confidence</th>
        <th class="leo-th" style="text-align:center;">Status</th><th class="leo-th" style="text-align:center;">Actions</th>
      </tr></thead>
      <tbody>
        {#each filteredForecasts as f, i}
        <tr class="cursor-pointer hover:bg-gray-50 transition-colors" onclick={() => toggleRow(i)} style="border-left: 3px solid {f.locked ? '#374151' : f.accepted ? '#16a34a' : confidenceBorderColor(f.confidence)};">
          <td class="leo-td" style="text-align:left;">{parseInt(f.date.split('-')[1])}/{parseInt(f.date.split('-')[2])}</td>
          <td class="leo-td text-[#6b7280]" style="text-align:left;">{new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', {weekday: 'short'})}</td>
          <td class="leo-td" style="text-align:center;">{#if f.weatherIcon}<div class="flex items-center justify-center gap-1"><img src="https://openweathermap.org/img/wn/{f.weatherIcon}@2x.png" alt="" width="28" height="28" />{#if f.weatherTempHigh}<span style="font-size:13px;font-weight:600;color:#374151;">{Math.round(f.weatherTempHigh)}°</span>{/if}</div>{:else}<span style="font-size:11px;color:#d1d5db;">--</span>{/if}</td>
          <td class="leo-td font-medium">
            <div>{fmt(Math.round(f.suggestedRevenue))}</div>
            <ForecastDataSignals bookingPace={f.bookingPace ?? null} events={f.events ?? []} competitiveDemand={f.competitiveDemand ?? null} wowTrend={null} />
          </td>
          <td class="leo-td text-[#6b7280]">{f.suggestedCovers}</td>
          <td class="leo-td text-[#9ca3af]" style="font-size:12px;">{fmt(Math.round(f.avgCheck || 70))}</td>
          <td class="leo-td text-[#9ca3af]" style="font-size:12px;">{f.suggestedCovers > 0 ? fmt(Math.round((f.managerRevenue || f.suggestedRevenue || 0) / (f.suggestedCovers * 1.5))) : '-'}</td>
          <td class="leo-td text-[#6b7280]">{f.samePeriodPY ? fmt(Math.round(f.samePeriodPY)) : '-'}</td>
          <td class="leo-td text-[#6b7280]">{f.trailing2wAvg ? fmt(Math.round(f.trailing2wAvg)) : '-'}</td>
          <td class="leo-td text-[#6b7280]">{f.budgetRevenue ? fmt(Math.round(f.budgetRevenue)) : '-'}</td>
          <td class="leo-td">{#if f.accepted}<span class="font-medium" style="{f.overridden ? 'color:#ea580c;' : ''}">{fmt(Math.round(f.managerRevenue || f.suggestedRevenue))}</span>{:else}-{/if}</td>
          <td class="leo-td" style="text-align:center;">
            <span class="inline-block px-2 py-0.5 rounded text-xs font-medium" style="{f.confidence >= 0.7 ? 'background:#dcfce7;color:#16a34a;' : f.confidence >= 0.5 ? 'background:#fef9c3;color:#a16207;' : 'background:#fef2f2;color:#dc2626;'}">{(f.confidence * 100).toFixed(0)}%</span>
          </td>
          <td class="leo-td" style="text-align:center;">
            {#if f.locked}<span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded font-medium" style="background:#f3f4f6;color:#374151;border:1px solid #d1d5db;">Locked</span>
            {:else if f.accepted && f.overridden}<div class="flex flex-wrap gap-1 justify-center">{#if f.overrideTags?.length > 0}{#each f.overrideTags as tag}<span class="inline-block rounded-xl font-medium" style="background:#1e3a5f;color:white;padding:2px 10px;font-size:11px;">{tag}</span>{/each}{:else}<span class="text-xs px-2 py-0.5 rounded font-medium" style="background:#fff7ed;color:#ea580c;">Override</span>{/if}</div>
            {:else if f.accepted}<span class="text-xs px-2 py-0.5 rounded font-medium" style="background:#dcfce7;color:#16a34a;">Accepted</span>
            {:else}<span class="text-xs px-2 py-0.5 rounded font-medium" style="background:#f3f4f6;color:#6b7280;">Pending</span>{/if}
          </td>
          <td class="leo-td" style="text-align:center;" onclick={(e) => e.stopPropagation()}>
            {#if f.locked}
              {#if canUnlock}<button onclick={() => unlockForecast(i)} class="text-xs font-medium px-2 py-1 rounded" style="background:#374151;color:white;">Unlock</button>{:else}<span class="text-xs text-[#9ca3af]">--</span>{/if}
            {:else if f.accepted}
              <button onclick={() => unlockForecast(i)} class="text-xs font-medium px-2 py-1 rounded" style="background:#6b7280;color:white;">Edit</button>
            {:else}
              <div class="flex gap-1 justify-center">
                <button onclick={() => acceptForecast(i)} class="text-xs font-medium px-2 py-1 rounded" style="background:#16a34a;color:white;">Accept</button>
                <button onclick={() => startOverride(i)} class="text-xs font-medium px-2 py-1 rounded" style="background:#ea580c;color:white;">Override</button>
              </div>
            {/if}
          </td>
        </tr>
        <!-- Expandable Detail Panel -->
        {#if expandedIdx === i}
        <tr style="background: #f8fafc;">
          <ForecastDetailPanel {f} {overrideRevenue} {overrideCovers} {overrideMode} {overrideTags} {overrideOtherNote}
            weekTotal={currentWeekTotal} {fmt}
            onAccept={() => acceptForecast(i)}
            onSubmitOverride={() => submitOverride(i)}
            onCancel={() => { overrideIdx = null; expandedIdx = null; overrideTags = []; overrideOtherNote = ''; overrideMode = 'revenue'; }}
            onOverrideRevenueChange={(v) => overrideRevenue = v}
            onOverrideCoversChange={(v) => overrideCovers = v}
            onOverrideModeChange={(m) => overrideMode = m}
            onToggleTag={toggleTag}
            onOtherNoteChange={(v) => overrideOtherNote = v}
            {hasValidTags}
            isOverrideMode={overrideIdx === i}
          />
        </tr>
        {/if}
        {/each}
        <!-- Weekly Total Row -->
        {#if filteredForecasts.length > 0}
        {@const totalForecast = filteredForecasts.reduce((s, f) => s + (f.suggestedRevenue || 0), 0)}
        {@const totalCovers = filteredForecasts.reduce((s, f) => s + (f.suggestedCovers || 0), 0)}
        {@const totalSDLY = filteredForecasts.reduce((s, f) => s + (f.samePeriodPY || 0), 0)}
        {@const totalT2W = filteredForecasts.reduce((s, f) => s + (f.trailing2wAvg || 0), 0)}
        {@const totalBudget = filteredForecasts.reduce((s, f) => s + (f.budgetRevenue || 0), 0)}
        {@const totalManager = filteredForecasts.reduce((s, f) => s + (f.accepted ? (f.managerRevenue || f.suggestedRevenue || 0) : 0), 0)}
        {@const hasAnyAccepted = filteredForecasts.some(f => f.accepted)}
        {@const avgConf = filteredForecasts.reduce((s, f) => s + (f.confidence || 0), 0) / filteredForecasts.length}
        <tr class="leo-footer" style="background: #d1d5db; font-weight: 700;">
          <td class="leo-td" colspan="3">TOTAL</td>
          <td class="leo-td text-center">{fmt(Math.round(totalForecast))}</td>
          <td class="leo-td text-center">{totalCovers}</td>
          <td class="leo-td text-center">{totalCovers > 0 ? fmt(Math.round(totalForecast / totalCovers)) : '-'}</td>
          <td class="leo-td text-center">{totalCovers > 0 ? fmt(Math.round(totalForecast / (totalCovers * 1.5))) : '-'}</td>
          <td class="leo-td text-center">{totalSDLY > 0 ? fmt(Math.round(totalSDLY)) : '-'}</td>
          <td class="leo-td text-center">{totalT2W > 0 ? fmt(Math.round(totalT2W)) : '-'}</td>
          <td class="leo-td text-center">{totalBudget > 0 ? fmt(Math.round(totalBudget)) : '-'}</td>
          <td class="leo-td text-center">{hasAnyAccepted ? fmt(Math.round(totalManager)) : '-'}</td>
          <td class="leo-td text-center"><span class="inline-block px-2 py-0.5 rounded text-xs font-medium" style="{avgConf >= 0.7 ? 'background:#dcfce7;color:#16a34a;' : avgConf >= 0.5 ? 'background:#fef9c3;color:#a16207;' : 'background:#fef2f2;color:#dc2626;'}">{(avgConf * 100).toFixed(0)}%</span></td>
          <td class="leo-td text-center" colspan="3">--</td>
        </tr>
        {/if}
      </tbody>
    </table>
  </div>

  <!-- Pre-Submit Summary + Submit Button -->
  {#if allAcceptedNotLocked && weekFilter > 0}
  <div class="mt-4 mb-4">
    <ForecastSummaryCards forecasts={filteredForecasts} {modelStats} {managerAccuracySummary} {trailing2Weeks} sameWeekLastYear={filteredSWLY} {fmt} showPreSubmit={true} weekTotal={currentWeekTotal} />
    <button onclick={submitWeekForecast} disabled={weekSubmitting} class="w-full py-3 px-6 rounded-lg text-white font-semibold text-sm transition-colors disabled:opacity-60" style="background: #1e3a5f;" onmouseenter={(e) => { if (!weekSubmitting) e.currentTarget.style.background='#162d4a'; }} onmouseleave={(e) => e.currentTarget.style.background='#1e3a5f'}>
      {weekSubmitting ? 'Submitting...' : `Submit Weekly Forecast (${fmt(Math.round(currentWeekTotal))}) -- Finalize & Update Projections`}
    </button>
  </div>
  {:else if anyLocked && weekFilter > 0}
  <div class="w-full mt-4 mb-4 py-3 px-6 rounded-lg text-sm font-medium text-center" style="background: #f0fdf4; color: #15803d; border: 1px solid #bbf7d0;">Week forecast submitted -- projections are up to date</div>
  {/if}

  <!-- Forecast Comparison: compact chart + metrics panel -->
  {#if filteredForecasts.length > 0}
  {#key chartMetric}
  {@const chartSeries = [
    {key:'helixo', label:'HELIXO Forecast', color:'#1e3a5f'},
    {key:'manager',label:'User Forecast',   color:'#0d9488'},
    {key:'t2w',    label:'T2W Avg',          color:'#f59e0b'},
    {key:'py',     label:'Same Week LY',     color:'#93c5fd'},
    {key:'budget', label:'Budget',           color:'#9ca3af'},
  ]}
  {@const chartDays = filteredForecasts.map(f => {
    const d = new Date(f.date + 'T12:00:00');
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + (d.getMonth()+1) + '/' + d.getDate();
    const avgChk = f.avgCheck || 70;
    const managerRev = (f.overridden && f.managerRevenue && f.managerRevenue !== f.suggestedRevenue) ? f.managerRevenue : null;
    if (chartMetric === 'covers') return { label: dayLabel, helixo: f.suggestedCovers||0, manager: managerRev?Math.round(managerRev/avgChk):null, t2w: f.trailing2wAvg?Math.round(f.trailing2wAvg/avgChk):0, py: f.samePeriodPY?Math.round(f.samePeriodPY/avgChk):0, budget: f.budgetRevenue?Math.round(f.budgetRevenue/avgChk):0 };
    return { label: dayLabel, helixo: f.suggestedRevenue||0, manager: managerRev, t2w: f.trailing2wAvg||0, py: f.samePeriodPY||0, budget: f.budgetRevenue||0 };
  })}
  {@const allVals = chartDays.flatMap(d => [d.helixo, d.manager||0, d.t2w||0, d.py, d.budget].filter(v => v > 0))}
  {@const rawMax = Math.max(...allVals, 1)}
  {@const yStep = rawMax <= 10000 ? 2500 : rawMax <= 25000 ? 5000 : rawMax <= 50000 ? 10000 : 25000}
  {@const yMax = Math.ceil(rawMax * 1.15 / yStep) * yStep}
  {@const gridLines = Array.from({ length: Math.floor(yMax / yStep) + 1 }, (_, i) => i * yStep)}
  {@const cDim = { padL: 56, padR: 12, padT: 10, padB: 30, svgW: 560, svgH: 200, groupGap: 16, barGap: 3 }}
  {@const plotW = cDim.svgW - cDim.padL - cDim.padR}
  {@const plotH = cDim.svgH - cDim.padT - cDim.padB}
  {@const nGroups = chartDays.length}
  {@const groupW = nGroups > 0 ? (plotW - (nGroups - 1) * cDim.groupGap) / nGroups : 0}
  {@const barW = Math.min(14, nGroups > 0 ? (groupW - 4 * cDim.barGap) / 5 : 14)}

  <!-- Weekly comparison metrics -->
  {@const wkHelixo = filteredForecasts.reduce((s,f) => s+(f.suggestedRevenue||0),0)}
  {@const wkUser   = filteredForecasts.filter(f=>f.accepted).reduce((s,f) => s+(f.managerRevenue||f.suggestedRevenue||0),0)}
  {@const wkT2W    = filteredForecasts.reduce((s,f) => s+(f.trailing2wAvg||0),0)}
  {@const wkSDLY   = filteredForecasts.reduce((s,f) => s+(f.samePeriodPY||0),0)}
  {@const wkBudget = filteredForecasts.reduce((s,f) => s+(f.budgetRevenue||0),0)}
  {@const wkActual = filteredForecasts.reduce((s,f) => s+(f.actualRevenue||0),0)}

  <div class="grid grid-cols-1 md:grid-cols-5 gap-3 mt-4 mb-4">
    <!-- Compact Bar Chart (2/5 width) -->
    <div class="leo-card md:col-span-2" style="min-width:0;">
      <div class="px-3 pt-3 pb-1 flex items-center justify-between gap-2 flex-wrap">
        <h3 class="text-xs font-semibold text-[#1e3a5f] uppercase tracking-wide">Daily Comparison</h3>
        <div class="flex items-center gap-2">
          <select class="leo-select" style="font-size:11px;padding:2px 6px;height:24px;" onchange={(e) => { chartMetric = e.currentTarget.value as any; }}>
            <option value="revenue">Revenue</option><option value="covers">Covers</option>
          </select>
          <div class="relative">
            <button type="button" class="leo-select flex items-center gap-1" style="font-size:11px;padding:2px 6px;height:24px;cursor:pointer;" onclick={() => filterDropdownOpen = !filterDropdownOpen}>
              <span>{Object.values(chartLegend).filter(Boolean).length} series</span>
            </button>
            {#if filterDropdownOpen}<div class="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border z-50" style="min-width:180px;border-color:#d1d5db;">
              {#each chartSeries as s}<label class="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-gray-50"><input type="checkbox" checked={chartLegend[s.key]} onchange={() => chartLegend[s.key] = !chartLegend[s.key]} style="accent-color:{s.color};" /><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:{s.color};"></span>{s.label}</label>{/each}
              <div class="px-3 py-1.5 border-t" style="border-color:#e5e7eb;"><button type="button" class="text-xs w-full text-center py-1 rounded font-medium" style="background:#1e3a5f;color:white;" onclick={() => filterDropdownOpen = false}>Done</button></div>
            </div>{/if}
          </div>
        </div>
      </div>
      <div class="px-2 pb-2" style="overflow-x:auto;">
        <svg viewBox="0 0 {cDim.svgW} {cDim.svgH}" style="width:100%;display:block;" role="img" aria-label="Forecast comparison">
          {#each gridLines as gv}{@const gy = cDim.padT + plotH - (gv / yMax) * plotH}
            <line x1={cDim.padL} y1={gy} x2={cDim.svgW-cDim.padR} y2={gy} stroke="#f3f4f6" stroke-width="1"/>
            <text x={cDim.padL-4} y={gy+3} text-anchor="end" fill="#9ca3af" font-size="9" font-family="Inter,sans-serif">{gv>=1000?'$'+(gv/1000)+'K':'$'+gv}</text>
          {/each}
          {#each chartDays as day, gi}
            {@const gx = cDim.padL + gi*(groupW+cDim.groupGap)}
            {@const allS = [{key:'helixo',val:day.helixo,color:'#1e3a5f'},{key:'manager',val:day.manager,color:'#0d9488'},{key:'t2w',val:day.t2w,color:'#f59e0b'},{key:'py',val:day.py,color:'#93c5fd'},{key:'budget',val:day.budget,color:'#9ca3af'}]}
            {@const visBars = allS.filter(s => chartLegend[s.key] && s.val != null && s.val > 0)}
            {@const visOff = (groupW - (visBars.length*barW + Math.max(0,visBars.length-1)*cDim.barGap))/2}
            {#each visBars as vb, vi}{@const bx=gx+visOff+vi*(barW+cDim.barGap)}{@const bh=(vb.val/yMax)*plotH}{@const by=cDim.padT+plotH-bh}
              <rect x={bx} y={by} width={barW} height={bh} fill={vb.color} rx="1.5"><title>{chartSeries.find(cs=>cs.key===vb.key)?.label}: {fmt(Math.round(vb.val))}</title></rect>
            {/each}
            <text x={gx+groupW/2} y={cDim.svgH-4} text-anchor="middle" fill="#6b7280" font-size="9" font-family="Inter,sans-serif">{day.label.split(' ')[0]}</text>
          {/each}
          <line x1={cDim.padL} y1={cDim.padT} x2={cDim.padL} y2={cDim.padT+plotH} stroke="#e5e7eb" stroke-width="1"/>
          <line x1={cDim.padL} y1={cDim.padT+plotH} x2={cDim.svgW-cDim.padR} y2={cDim.padT+plotH} stroke="#e5e7eb" stroke-width="1"/>
        </svg>
      </div>
      <div class="px-3 pb-2 flex flex-wrap gap-2 justify-center">
        {#each chartSeries.filter(s => chartLegend[s.key]) as s}
        <div class="flex items-center gap-1"><span style="display:inline-block;width:8px;height:8px;border-radius:1px;background:{s.color};"></span><span style="font-size:10px;color:#374151;">{s.label}</span></div>
        {/each}
      </div>
    </div>

    <!-- Weekly Metrics Panel (3/5 width) -->
    <div class="leo-card md:col-span-3 p-3">
      <h3 class="text-xs font-semibold text-[#1e3a5f] uppercase tracking-wide mb-3">Weekly Snapshot{weekFilter > 0 ? ' — Week ' + weekFilter : ''}</h3>
      <div class="grid grid-cols-2 gap-2 mb-3">
        {#each [
          { label: 'HELIXO Forecast', val: wkHelixo, color: '#1e3a5f', always: true },
          { label: 'User Forecast',   val: wkUser,   color: '#0d9488', always: false },
          { label: 'T2W Avg',         val: wkT2W,    color: '#f59e0b', always: true },
          { label: 'Same Week LY',    val: wkSDLY,   color: '#93c5fd', always: true },
          { label: 'Budget',          val: wkBudget, color: '#9ca3af', always: true },
          { label: 'Actual PTD',      val: wkActual, color: '#16a34a', always: true },
        ] as m}
          {#if m.always || m.val > 0}
          <div style="padding: 8px 10px; background: #f8fafc; border-radius: 8px; border-left: 3px solid {m.color};">
            <p style="font-size: 10px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">{m.label}</p>
            <p style="font-size: 16px; font-weight: 700; color: #1a1a1a;">{m.val > 0 ? fmt(Math.round(m.val)) : '—'}</p>
            {#if m.val > 0 && wkHelixo > 0 && m.label !== 'HELIXO Forecast'}
              {@const diff = m.val - wkHelixo}
              {@const pct = (diff / wkHelixo * 100)}
              <p style="font-size: 10px; color: {Math.abs(pct) < 3 ? '#6b7280' : pct > 0 ? '#16a34a' : '#dc2626'};">
                {pct > 0 ? '+' : ''}{pct.toFixed(1)}% vs HELIXO
              </p>
            {/if}
          </div>
          {/if}
        {/each}
      </div>
      <!-- DOW variance mini-table -->
      {#if filteredForecasts.length === 7}
      <div>
        <p class="text-xs text-[#9ca3af] uppercase tracking-wide mb-1">Day-by-Day vs T2W</p>
        <div class="flex gap-1 flex-wrap">
          {#each filteredForecasts as f}
            {@const dow = new Date(f.date + 'T12:00:00').toLocaleDateString('en-US', {weekday: 'short'})}
            {@const diff = f.trailing2wAvg ? f.suggestedRevenue - f.trailing2wAvg : null}
            {@const pct = (diff != null && f.trailing2wAvg) ? (diff / f.trailing2wAvg * 100) : null}
            <div style="flex: 1; min-width: 40px; text-align: center; padding: 4px 3px; background: {pct == null ? '#f3f4f6' : pct > 5 ? '#dcfce7' : pct < -5 ? '#fee2e2' : '#f3f4f6'}; border-radius: 6px;">
              <p style="font-size: 9px; color: #6b7280;">{dow}</p>
              <p style="font-size: 10px; font-weight: 600; color: {pct == null ? '#9ca3af' : pct > 0 ? '#16a34a' : '#dc2626'};">
                {pct != null ? (pct > 0 ? '+' : '') + pct.toFixed(0) + '%' : '—'}
              </p>
            </div>
          {/each}
        </div>
      </div>
      {/if}
    </div>
  </div>
  {/key}
  {/if}

  <!-- Accuracy / Override Tracker — above heatmap -->
  <div class="mb-4">
    <ManagerOverrideTracker {managerAccuracySummary} {modelStats} />
  </div>

  <!-- Revenue Heatmap Calendar -->
  <RevenueHeatmapCalendar forecasts={forecasts} {fmt} />

  <!-- Visual Insights Row: Revenue Momentum + Confidence DOW -->
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
    <!-- Revenue Momentum: last 4 weeks actuals + current week forecast -->
    {#if forecasts.length > 0}
    {@const today = new Date().toISOString().split('T')[0]}
    {@const weekBuckets = (() => {
      const weeks: { label: string; total: number; isForecast: boolean }[] = [];
      // Build 4-week windows ending at last complete week before today
      const t = new Date(); t.setHours(12,0,0,0);
      for (let w = 3; w >= 0; w--) {
        const wEnd = new Date(t); wEnd.setDate(wEnd.getDate() - w * 7 - (t.getDay() === 0 ? 0 : t.getDay()));
        const wStart = new Date(wEnd); wStart.setDate(wEnd.getDate() - 6);
        const wStartStr = wStart.toISOString().split('T')[0];
        const wEndStr = wEnd.toISOString().split('T')[0];
        const days = forecasts.filter(f => f.date >= wStartStr && f.date <= wEndStr);
        const total = days.reduce((s, f) => s + (f.actualRevenue || 0), 0);
        const isCurrent = wEnd >= today;
        const fcTotal = days.reduce((s, f) => s + (f.managerRevenue || f.suggestedRevenue || 0), 0);
        weeks.push({ label: 'W/' + (wEnd.getMonth()+1) + '/' + wEnd.getDate(), total: isCurrent ? fcTotal : total, isForecast: isCurrent });
      }
      return weeks;
    })()}
    {@const momMax = Math.max(...weekBuckets.map(w => w.total), 1)}
    {@const wowChange = weekBuckets.length >= 2 && weekBuckets[weekBuckets.length-2].total > 0 ? ((weekBuckets[weekBuckets.length-1].total - weekBuckets[weekBuckets.length-2].total) / weekBuckets[weekBuckets.length-2].total * 100) : null}
    <div class="leo-card p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-xs font-semibold text-[#1e3a5f] uppercase tracking-wide">Revenue Momentum — Last 4 Weeks</h3>
        {#if wowChange !== null}
          <span class="text-xs font-semibold px-2 py-0.5 rounded" style="background:{wowChange >= 0 ? '#dcfce7' : '#fee2e2'};color:{wowChange >= 0 ? '#16a34a' : '#dc2626'};">
            {wowChange >= 0 ? '▲' : '▼'} {Math.abs(wowChange).toFixed(1)}% WoW
          </span>
        {/if}
      </div>
      <div class="flex items-end gap-3">
        {#each weekBuckets as wb}
        <div class="flex-1 flex flex-col items-center gap-1">
          <span class="text-xs font-semibold" style="color:{wb.isForecast ? '#0d9488' : '#1e3a5f'};">{wb.total > 0 ? fmt(Math.round(wb.total / 1000)) + 'K' : '—'}</span>
          <div style="width:100%;height:64px;display:flex;align-items:flex-end;justify-content:center;">
            <div style="width:70%;border-radius:4px 4px 0 0;background:{wb.isForecast ? '#0d9488' : '#1e3a5f'};opacity:{wb.isForecast ? 0.7 : 1};height:{wb.total > 0 ? Math.round((wb.total / momMax) * 64) : 2}px;{wb.isForecast ? 'border:2px dashed #0d9488;background:rgba(13,148,136,0.15);' : ''}"></div>
          </div>
          <span class="text-xs text-[#9ca3af]">{wb.label}</span>
          {#if wb.isForecast}<span class="text-xs font-medium" style="color:#0d9488;">Forecast</span>{/if}
        </div>
        {/each}
      </div>
      {#if weekBuckets.every(w => w.total === 0)}<p class="text-xs text-center text-[#9ca3af] mt-2">No actuals data yet for this period</p>{/if}
    </div>
    {/if}
    <ConfidenceHeatmapDOW forecasts={filteredForecasts} />
  </div>

  {/if}

  <!-- Toast -->
  {#if toastMessage}<div style="position:fixed;bottom:24px;right:24px;z-index:100;background:#16a34a;color:white;padding:12px 20px;border-radius:8px;font-size:14px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.15);display:flex;align-items:center;gap:8px;">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.3 4.3L6 11.6 2.7 8.3" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>{toastMessage}
  </div>{/if}
</div>
