<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  let loading = $state(false);
  let error = $state('');
  let data = $state<any>(null);
  let authChecked = $state(false);
  let hasAccess = $state(false);
  let period = $state(0);
  let year = $state(2026);

  function fmt(n: number): string {
    return '$' + Math.round(n).toLocaleString();
  }
  function pct(n: number): string {
    return (n * 100).toFixed(1) + '%';
  }
  function signPct(n: number): string {
    const s = (n * 100).toFixed(1);
    return n >= 0 ? '+' + s + '%' : s + '%';
  }
  function scoreColor(score: number | null): string {
    if (score == null) return '#9ca3af';
    if (score >= 80) return '#16a34a';
    if (score >= 60) return '#ca8a04';
    return '#dc2626';
  }
  function varColor(v: number): string {
    if (v > 0.005) return '#16a34a';
    if (v < -0.005) return '#dc2626';
    return '#6b7280';
  }
  function laborColor(actual: number, target: number): string {
    if (actual <= target) return '#16a34a';
    if (actual <= target + 0.02) return '#ca8a04';
    return '#dc2626';
  }
  function rankBadge(rank: number): string {
    if (rank === 1) return '#d4a017';
    if (rank === 2) return '#a8a8a8';
    if (rank === 3) return '#cd7f32';
    return 'transparent';
  }
  function statusArrow(s: string): string {
    if (s === 'up') return '\u25B2';
    if (s === 'down') return '\u25BC';
    return '\u25CF';
  }
  function statusColor(s: string): string {
    if (s === 'up') return '#16a34a';
    if (s === 'down') return '#dc2626';
    return '#9ca3af';
  }

  async function loadData() {
    loading = true;
    error = '';
    try {
      const params = new URLSearchParams({ year: String(year) });
      if (period > 0) params.set('period', String(period));
      const res = await fetch(`/api/v1/executive-summary?${params}`);
      if (!res.ok) {
        error = (await res.json()).error || 'Failed to load';
        return;
      }
      data = await res.json();
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  function detectCurrentPeriod(): number {
    const fyStart = new Date(year - 1, 11, 29);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - fyStart.getTime()) / 86400000);
    return Math.min(13, Math.max(1, Math.floor(diffDays / 28) + 1));
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
            hasAccess = role === 'super_admin' || role === 'director';
          }
        } catch { hasAccess = false; }
      }
      authChecked = true;
      if (!hasAccess) { goto('/dashboard'); return; }
      period = detectCurrentPeriod();
      loadData();
    });
  });

  function changePeriod(p: number) {
    period = p;
    loadData();
  }
</script>

<svelte:head>
  <title>HELIXO | Executive Summary</title>
</svelte:head>

{#if !authChecked}
  <div class="flex items-center justify-center py-20">
    <p class="text-sm" style="color: #9ca3af;">Loading...</p>
  </div>
{:else if !hasAccess}
  <div class="flex items-center justify-center py-20">
    <p class="text-sm" style="color: #dc2626;">Access restricted to Super Admin and Director roles.</p>
  </div>
{:else}
  <div class="py-8">
    <!-- Header -->
    <div class="flex flex-col md:flex-row md:items-center md:justify-between mb-8 gap-4">
      <div>
        <h1 class="text-2xl font-bold tracking-tight" style="color: #1e3a5f;">
          HELIXO | Executive Summary
        </h1>
        {#if data?.meta}
          <p class="text-sm mt-1" style="color: #6b7280;">
            Week of {data.meta.wtdStart} through {data.meta.today}
            {#if data.meta.periodStart} &middot; Period {data.meta.period}{/if}
          </p>
        {/if}
      </div>
      <div class="flex items-center gap-3">
        <select
          bind:value={period}
          onchange={() => loadData()}
          class="leo-select">
          <option value={0}>All Periods (YTD)</option>
          {#each Array.from({length: 13}, (_, i) => i + 1) as p}
            <option value={p}>Period {p}</option>
          {/each}
        </select>
        <select
          bind:value={year}
          onchange={() => loadData()}
          class="leo-select">
          <option value={2025}>FY 2025</option>
          <option value={2026}>FY 2026</option>
        </select>
      </div>
    </div>

    {#if loading}
      <div class="flex items-center justify-center py-20">
        <p class="text-sm" style="color: #9ca3af;">Loading executive summary...</p>
      </div>
    {:else if error}
      <div class="leo-card p-6" style="border-left: 4px solid #dc2626;">
        <p class="text-sm" style="color: #dc2626;">{error}</p>
      </div>
    {:else if data}
      <!-- Row 1: Portfolio KPI Cards -->
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
        <!-- WTD Revenue -->
        <div class="leo-card p-5">
          <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #6b7280;">WTD Revenue</p>
          <p class="text-xl font-bold" style="color: #1e3a5f;">{fmt(data.portfolio.totalWTDRevenue)}</p>
          <p class="text-xs mt-1" style="color: {varColor(data.portfolio.wtdVarPct)};">
            {signPct(data.portfolio.wtdVarPct)} vs budget
          </p>
        </div>
        <!-- PTD Revenue -->
        <div class="leo-card p-5">
          <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #6b7280;">PTD Revenue</p>
          <p class="text-xl font-bold" style="color: #1e3a5f;">{fmt(data.portfolio.totalPTDRevenue)}</p>
          <p class="text-xs mt-1" style="color: {varColor(data.portfolio.ptdVarPct)};">
            {signPct(data.portfolio.ptdVarPct)} vs budget
          </p>
        </div>
        <!-- YTD Revenue -->
        <div class="leo-card p-5">
          <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #6b7280;">YTD Revenue</p>
          <p class="text-xl font-bold" style="color: #1e3a5f;">{fmt(data.portfolio.totalYTDRevenue)}</p>
          <p class="text-xs mt-1" style="color: {varColor(data.portfolio.ytdVarPct)};">
            {signPct(data.portfolio.ytdVarPct)} vs PY
          </p>
        </div>
        <!-- WTD Labor % -->
        <div class="leo-card p-5">
          <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #6b7280;">WTD Labor %</p>
          <p class="text-xl font-bold" style="color: {laborColor(data.portfolio.portfolioLaborPct, data.portfolio.avgTargetLaborPct)};">
            {pct(data.portfolio.portfolioLaborPct)}
          </p>
          <p class="text-xs mt-1" style="color: #6b7280;">
            Target: {pct(data.portfolio.avgTargetLaborPct)}
          </p>
        </div>
        <!-- Forecast Accuracy -->
        <div class="leo-card p-5">
          <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #6b7280;">Forecast Accuracy</p>
          <p class="text-xl font-bold" style="color: {scoreColor(data.portfolio.portfolioForecastAccuracy)};">
            {data.portfolio.portfolioForecastAccuracy != null ? Math.round(data.portfolio.portfolioForecastAccuracy) : '-'}
          </p>
          <p class="text-xs mt-1" style="color: #6b7280;">28-day avg</p>
        </div>
        <!-- Active Locations -->
        <div class="leo-card p-5">
          <p class="text-xs font-semibold uppercase tracking-wider mb-2" style="color: #6b7280;">Active Locations</p>
          <p class="text-xl font-bold" style="color: #1e3a5f;">{data.portfolio.activeLocations}</p>
          <p class="text-xs mt-1" style="color: #6b7280;">Portfolio</p>
        </div>
      </div>

      <!-- Row 2: Location Leaderboard -->
      <div class="leo-card mb-8">
        <div class="p-5 border-b" style="border-color: #e5e7eb;">
          <h2 class="leo-section-title">Location Leaderboard</h2>
        </div>
        <div class="leo-table-scroll">
          <table class="leo-table w-full text-sm">
            <thead>
              <tr>
                <th class="leo-th text-left">#</th>
                <th class="leo-th text-left">Location</th>
                <th class="leo-th text-left">City</th>
                <th class="leo-th text-right">WTD Revenue</th>
                <th class="leo-th text-right">WTD Budget</th>
                <th class="leo-th text-right">Var %</th>
                <th class="leo-th text-right">Labor %</th>
                <th class="leo-th text-right">Target</th>
                <th class="leo-th text-right">Accuracy</th>
                <th class="leo-th text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {#each data.leaderboard as loc, idx}
                {@const isBottom3 = idx >= data.leaderboard.length - 3 && data.leaderboard.length > 5}
                <tr style="{isBottom3 ? 'background: #fef2f2 !important;' : ''}">
                  <td class="leo-td text-left">
                    <span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
                      style="background: {rankBadge(idx + 1)}; color: {idx < 3 ? '#fff' : '#6b7280'};">
                      {idx + 1}
                    </span>
                  </td>
                  <td class="leo-td text-left font-medium" style="color: #1e3a5f;">{loc.name}</td>
                  <td class="leo-td text-left" style="color: #6b7280;">{loc.city}</td>
                  <td class="leo-td text-right font-mono" style="color: #1e3a5f;">{fmt(loc.wtdRevenue)}</td>
                  <td class="leo-td text-right font-mono" style="color: #6b7280;">{fmt(loc.wtdBudgetRevenue)}</td>
                  <td class="leo-td text-right font-mono" style="color: {varColor(loc.wtdVarPct)};">
                    {signPct(loc.wtdVarPct)}
                  </td>
                  <td class="leo-td text-right font-mono" style="color: {laborColor(loc.wtdLaborPct, loc.targetLaborPct)};">
                    {pct(loc.wtdLaborPct)}
                  </td>
                  <td class="leo-td text-right font-mono" style="color: #6b7280;">
                    {pct(loc.targetLaborPct)}
                  </td>
                  <td class="leo-td text-right font-mono" style="color: {scoreColor(loc.forecastAccuracyScore)};">
                    {loc.forecastAccuracyScore != null ? Math.round(loc.forecastAccuracyScore) : '-'}
                  </td>
                  <td class="leo-td text-center text-base" style="color: {statusColor(loc.status)};">
                    {statusArrow(loc.status)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Row 3: City Performance Summary -->
      {#if data.citySummaries && data.citySummaries.length > 0}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {#each data.citySummaries as city}
            <div class="leo-card p-5">
              <h3 class="text-sm font-bold mb-3" style="color: #1e3a5f;">
                {city.city}
              </h3>
              <div class="space-y-2">
                <div class="flex justify-between text-xs">
                  <span style="color: #6b7280;">Total Revenue</span>
                  <span class="font-mono font-medium" style="color: #1e3a5f;">{fmt(city.totalRevenue)}</span>
                </div>
                <div class="flex justify-between text-xs">
                  <span style="color: #6b7280;">Locations</span>
                  <span class="font-medium" style="color: #1e3a5f;">{city.locationCount}</span>
                </div>
                <div class="flex justify-between text-xs">
                  <span style="color: #6b7280;">Avg Labor %</span>
                  <span class="font-mono font-medium" style="color: {laborColor(city.avgLaborPct, 0.30)};">{pct(city.avgLaborPct)}</span>
                </div>
                <div class="pt-2 border-t" style="border-color: #f3f4f6;">
                  <p class="text-xs" style="color: #6b7280;">
                    Best: <span class="font-medium" style="color: #16a34a;">{city.bestPerformer}</span>
                  </p>
                  <p class="text-xs mt-1" style="color: #6b7280;">
                    Needs Attn: <span class="font-medium" style="color: #dc2626;">{city.worstPerformer}</span>
                  </p>
                </div>
              </div>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Row 4: Alerts & Actions -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Labor Alerts -->
        <div class="leo-card p-5">
          <h3 class="text-sm font-bold mb-3 flex items-center gap-2" style="color: #1e3a5f;">
            <span style="color: #dc2626;">&#9679;</span> Labor Over Target
          </h3>
          {#if data.alerts.laborOverTarget.length === 0}
            <p class="text-xs" style="color: #6b7280;">All locations within target labor range.</p>
          {:else}
            <div class="space-y-2">
              {#each data.alerts.laborOverTarget as alert}
                <div class="flex justify-between items-center text-xs p-2 rounded" style="background: #fef2f2;">
                  <span class="font-medium" style="color: #1e3a5f;">{alert.location}</span>
                  <span class="font-mono" style="color: #dc2626;">
                    {pct(alert.laborPct)} (target {pct(alert.targetPct)}) +{pct(alert.overBy)}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Forecast Accuracy Alerts -->
        <div class="leo-card p-5">
          <h3 class="text-sm font-bold mb-3 flex items-center gap-2" style="color: #1e3a5f;">
            <span style="color: #ca8a04;">&#9679;</span> Forecast Accuracy Alerts
          </h3>
          {#if data.alerts.lowForecastAccuracy.length === 0}
            <p class="text-xs" style="color: #6b7280;">All locations above 70% forecast accuracy.</p>
          {:else}
            <div class="space-y-2">
              {#each data.alerts.lowForecastAccuracy as alert}
                <div class="flex justify-between items-center text-xs p-2 rounded" style="background: #fffbeb;">
                  <span class="font-medium" style="color: #1e3a5f;">{alert.location}</span>
                  <span class="font-mono font-bold" style="color: {scoreColor(alert.score)};">
                    {alert.score != null ? Math.round(alert.score) : '-'}
                  </span>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Pending Schedules -->
        <div class="leo-card p-5">
          <h3 class="text-sm font-bold mb-3 flex items-center gap-2" style="color: #1e3a5f;">
            <span style="color: #2563eb;">&#9679;</span> Pending Schedule Approvals
          </h3>
          {#if data.alerts.pendingSchedules === 0}
            <p class="text-xs" style="color: #6b7280;">No schedules pending approval.</p>
          {:else}
            <p class="text-sm font-medium" style="color: #1e3a5f;">
              {data.alerts.pendingSchedules} schedule{data.alerts.pendingSchedules !== 1 ? 's' : ''} awaiting approval
            </p>
            <a href="/dashboard/schedule-approval" class="leo-btn inline-block mt-2">
              Review Schedules
            </a>
          {/if}
        </div>

        <!-- Quick Links -->
        <div class="leo-card p-5">
          <h3 class="text-sm font-bold mb-3" style="color: #1e3a5f;">
            Quick Navigation
          </h3>
          <div class="grid grid-cols-2 gap-2">
            <a href="/dashboard" class="leo-btn-secondary text-center">Dashboard</a>
            <a href="/dashboard/forecast" class="leo-btn-secondary text-center">Forecast</a>
            <a href="/dashboard/insights" class="leo-btn-secondary text-center">Insights</a>
            <a href="/dashboard/admin/forecast-accuracy" class="leo-btn-secondary text-center">Accuracy</a>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

