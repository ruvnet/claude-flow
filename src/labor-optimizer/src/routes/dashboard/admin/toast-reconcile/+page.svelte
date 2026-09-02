<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  let locationId   = $state('');
  let locations    = $state<{ id: string; name: string }[]>([]);
  let startDate    = $state('');
  let endDate      = $state('');
  let loading      = $state(false);
  let data         = $state<any>(null);
  let error        = $state('');
  let isAdmin      = $state(false);
  let authChecked  = $state(false);
  let resyncing    = $state<Set<string>>(new Set());

  // Default: last 7 days
  function initDates() {
    const end   = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 6);
    endDate   = end.toISOString().split('T')[0];
    startDate = start.toISOString().split('T')[0];
  }
  initDates();

  function fmtMoney(n: number | null): string {
    if (n == null) return '—';
    return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtDiff(n: number | null): string {
    if (n == null) return '—';
    const sign = n > 0 ? '+' : '';
    return sign + '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtPct(n: number | null): string {
    if (n == null) return '';
    return (n * 100).toFixed(1) + '%';
  }
  function fmtDate(d: string): string {
    const dt = new Date(d + 'T12:00:00Z');
    return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  type Status = 'match' | 'over' | 'under' | 'missing_helixo' | 'missing_toast' | 'no_data';

  function statusLabel(s: Status): string {
    if (s === 'match')          return '✓ Match';
    if (s === 'under')          return '↓ Under';
    if (s === 'over')           return '↑ Over';
    if (s === 'missing_helixo') return '⚠ Missing';
    if (s === 'missing_toast')  return '⚠ API Error';
    return 'Closed';
  }
  function statusColor(s: Status): string {
    if (s === 'match')          return '#16a34a';
    if (s === 'under')          return '#dc2626';
    if (s === 'over')           return '#ca8a04';
    if (s === 'missing_helixo') return '#7c3aed';
    if (s === 'missing_toast')  return '#6b7280';
    return '#9ca3af';
  }
  function statusBg(s: Status): string {
    if (s === 'match')          return '#dcfce7';
    if (s === 'under')          return '#fee2e2';
    if (s === 'over')           return '#fef9c3';
    if (s === 'missing_helixo') return '#ede9fe';
    if (s === 'missing_toast')  return '#f3f4f6';
    return '#f9fafb';
  }

  async function runReconcile() {
    if (!locationId || !startDate || !endDate) return;
    loading = true;
    error = '';
    data = null;
    try {
      const params = new URLSearchParams({
        locationId, startDate, endDate,
        adminKey: 'helixo-admin-2026',
      });
      const res = await fetch(`/api/v1/admin/toast-reconcile?${params}`);
      if (!res.ok) { error = (await res.json()).error || 'Request failed'; return; }
      data = await res.json();
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function resyncDate(date: string) {
    if (!locationId) return;
    resyncing = new Set([...resyncing, date]);
    try {
      const params = new URLSearchParams({ locationId, startDate: date, endDate: date });
      params.set('adminKey', 'helixo-admin-2026');
      // Use the backfill endpoint to re-pull a single day
      const res = await fetch(`/api/v1/admin/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('helixo_cron_secret') || ''}` },
        body: JSON.stringify({ locationId, startDate: date, endDate: date, includeRevenue: true, includeLabor: false }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(`Re-sync failed: ${d.error || 'Unknown error'}`);
      } else {
        // Refresh reconcile data
        await runReconcile();
      }
    } catch (e: any) {
      alert(`Re-sync error: ${e.message}`);
    } finally {
      const next = new Set(resyncing);
      next.delete(date);
      resyncing = next;
    }
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
        }
      });
    });
  });

  // Summary metrics derived from data
  const summary = $derived.by(() => {
    if (!data) return null;
    const actionable = (data.days as any[]).filter((d: any) => d.status === 'under' || d.status === 'over' || d.status === 'missing_helixo');
    const maxGap = actionable.reduce((m: number, d: any) => Math.max(m, Math.abs(d.diff ?? 0)), 0);
    return { actionable: actionable.length, maxGap };
  });
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
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Toast Reconciliation</h1>
      <p class="text-sm text-[#6b7280]">Compare HELIXO stored revenue vs. live Toast API figures</p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      <select
        bind:value={locationId}
        onchange={() => localStorage.setItem('helixo_selected_location', locationId)}
        class="leo-select"
      >
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
      <input type="date" bind:value={startDate} class="leo-input text-sm" />
      <span class="text-[#9ca3af] text-sm">→</span>
      <input type="date" bind:value={endDate} class="leo-input text-sm" />
      <button onclick={runReconcile} disabled={loading} class="leo-button-primary">
        {loading ? 'Running...' : 'Run Check'}
      </button>
    </div>
  </div>

  {#if error}
    <div class="leo-card p-4 mb-4 border-l-4 border-[#dc2626]">
      <p class="text-sm text-[#dc2626]">{error}</p>
    </div>
  {/if}

  {#if loading}
    <div class="leo-card p-12 text-center">
      <p class="text-sm text-[#9ca3af]">Fetching live Toast revenue data…<br>
        <span class="text-xs">This re-queries Toast's API for each date — may take 30–60 seconds</span>
      </p>
    </div>
  {:else if data}
    {@const diff = data.totalDiff}
    {@const pct = data.toastTotal > 0 ? diff / data.toastTotal : 0}

    <!-- Summary Banner -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <div class="leo-card p-4">
        <p class="text-xs text-[#6b7280] mb-1">HELIXO Total</p>
        <p class="text-xl font-bold text-[#1a1a1a]">{fmtMoney(data.helixoTotal)}</p>
      </div>
      <div class="leo-card p-4">
        <p class="text-xs text-[#6b7280] mb-1">Toast Total</p>
        <p class="text-xl font-bold text-[#1a1a1a]">{fmtMoney(data.toastTotal)}</p>
      </div>
      <div class="leo-card p-4" style="border-left: 4px solid {diff === 0 ? '#16a34a' : diff > 0 ? '#dc2626' : '#ca8a04'}">
        <p class="text-xs text-[#6b7280] mb-1">Gap (Toast − HELIXO)</p>
        <p class="text-xl font-bold" style="color: {diff === 0 ? '#16a34a' : diff > 0 ? '#dc2626' : '#ca8a04'}">
          {fmtDiff(diff)}
        </p>
        {#if data.toastTotal > 0}
          <p class="text-xs text-[#9ca3af] mt-0.5">{fmtPct(pct)} of Toast revenue</p>
        {/if}
      </div>
      <div class="leo-card p-4">
        <p class="text-xs text-[#6b7280] mb-1">Days Needing Re-sync</p>
        <p class="text-xl font-bold text-[#1a1a1a]">{summary?.actionable ?? 0}</p>
        {#if summary && summary.maxGap > 0}
          <p class="text-xs text-[#9ca3af] mt-0.5">Largest gap: {fmtMoney(summary.maxGap)}</p>
        {/if}
      </div>
    </div>

    <!-- Day-by-Day Table -->
    <div class="leo-card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-[#e5e7eb] bg-[#f9fafb]">
              <th class="text-left px-4 py-3 font-semibold text-[#374151]">Date</th>
              <th class="text-right px-4 py-3 font-semibold text-[#374151]">HELIXO</th>
              <th class="text-right px-4 py-3 font-semibold text-[#374151]">Toast</th>
              <th class="text-right px-4 py-3 font-semibold text-[#374151]">Difference</th>
              <th class="text-center px-4 py-3 font-semibold text-[#374151]">Status</th>
              <th class="text-center px-4 py-3 font-semibold text-[#374151]">Action</th>
            </tr>
          </thead>
          <tbody>
            {#each data.days as day (day.date)}
              <tr class="border-b border-[#f3f4f6] hover:bg-[#f9fafb] transition-colors">
                <td class="px-4 py-3 font-medium text-[#1a1a1a]">{fmtDate(day.date)}</td>
                <td class="px-4 py-3 text-right tabular-nums text-[#374151]">
                  {#if day.helixo != null}{fmtMoney(day.helixo)}{:else}<span class="text-[#9ca3af]">—</span>{/if}
                </td>
                <td class="px-4 py-3 text-right tabular-nums text-[#374151]">
                  {#if day.toast != null}{fmtMoney(day.toast)}{:else}<span class="text-[#9ca3af]">—</span>{/if}
                </td>
                <td class="px-4 py-3 text-right tabular-nums font-medium"
                    style="color: {day.diff == null ? '#9ca3af' : day.diff > 0 ? '#dc2626' : day.diff < 0 ? '#ca8a04' : '#16a34a'}">
                  {day.diff != null ? fmtDiff(day.diff) : '—'}
                  {#if day.diffPct != null && Math.abs(day.diffPct) > 0.005}
                    <span class="text-xs font-normal ml-1 text-[#9ca3af]">({fmtPct(day.diffPct)})</span>
                  {/if}
                </td>
                <td class="px-4 py-3 text-center">
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                        style="background: {statusBg(day.status)}; color: {statusColor(day.status)}">
                    {statusLabel(day.status)}
                  </span>
                </td>
                <td class="px-4 py-3 text-center">
                  {#if day.status === 'under' || day.status === 'missing_helixo'}
                    <button
                      onclick={() => resyncDate(day.date)}
                      disabled={resyncing.has(day.date)}
                      class="text-xs px-3 py-1 rounded bg-[#1e3a5f] text-white hover:bg-[#2d5282] transition-colors disabled:opacity-50"
                    >
                      {resyncing.has(day.date) ? 'Syncing…' : 'Re-sync'}
                    </button>
                  {:else}
                    <span class="text-[#d1d5db]">—</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
          <tfoot>
            <tr class="bg-[#f9fafb] border-t-2 border-[#e5e7eb] font-semibold">
              <td class="px-4 py-3 text-[#1a1a1a]">Total</td>
              <td class="px-4 py-3 text-right tabular-nums text-[#1a1a1a]">{fmtMoney(data.helixoTotal)}</td>
              <td class="px-4 py-3 text-right tabular-nums text-[#1a1a1a]">{fmtMoney(data.toastTotal)}</td>
              <td class="px-4 py-3 text-right tabular-nums font-bold"
                  style="color: {data.totalDiff > 0 ? '#dc2626' : data.totalDiff < 0 ? '#ca8a04' : '#16a34a'}">
                {fmtDiff(data.totalDiff)}
              </td>
              <td class="px-4 py-3"></td>
              <td class="px-4 py-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>

    <!-- Legend -->
    <div class="mt-4 flex flex-wrap gap-4 text-xs text-[#6b7280]">
      <span><span class="font-medium text-[#dc2626]">↓ Under</span> — HELIXO has less than Toast (missing revenue)</span>
      <span><span class="font-medium text-[#ca8a04]">↑ Over</span> — HELIXO has more than Toast (possible duplicate)</span>
      <span><span class="font-medium text-[#7c3aed]">⚠ Missing</span> — Date has no HELIXO record at all</span>
      <span><span class="font-medium text-[#16a34a]">✓ Match</span> — Within 0.5% tolerance</span>
    </div>

    <!-- API Errors (if any) -->
    {#if data.errors?.length > 0}
      <div class="mt-4 leo-card p-4 border-l-4 border-[#ca8a04]">
        <p class="text-sm font-semibold text-[#ca8a04] mb-2">Toast API Warnings</p>
        {#each data.errors as err}
          <p class="text-xs text-[#6b7280]">{err}</p>
        {/each}
      </div>
    {/if}

    <p class="mt-4 text-xs text-[#9ca3af]">
      Completed in {(data.durationMs / 1000).toFixed(1)}s · Live Toast data as of {new Date().toLocaleTimeString()}
    </p>

  {:else}
    <!-- Idle state -->
    <div class="leo-card p-12 text-center">
      <p class="text-4xl mb-3">⚖️</p>
      <p class="text-sm font-medium text-[#374151] mb-1">Select a location and date range, then run the check</p>
      <p class="text-xs text-[#9ca3af]">
        This queries Toast's API live and compares against HELIXO's stored figures.<br>
        Days marked "Under" have less revenue than Toast reported — use Re-sync to correct them.
      </p>
    </div>
  {/if}

</div>
{/if}
