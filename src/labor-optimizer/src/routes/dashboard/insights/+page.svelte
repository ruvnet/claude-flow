<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  let locationId = $state('');
  let locations = $state<{ id: string; name: string }[]>([]);
  let singleLocation = $state(false);
  let selectedDate = $state('');
  let loading = $state(false);
  let insights = $state<any>(null);
  let error = $state('');
  let managerNotes = $state('');
  let notesSaved = $state(false);
  let savingNotes = $state(false);
  let laborVarianceNotes = $state('');
  let varianceNotesSaved = $state(false);
  let savingVarianceNotes = $state(false);

  function getYesterday(): string {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  }

  selectedDate = getYesterday();

  function fmt(n: number | null | undefined): string {
    if (n == null) return '-';
    return '$' + Math.round(n).toLocaleString();
  }

  function pct(n: number | null | undefined): string {
    if (n == null) return '-';
    return (n * 100).toFixed(1) + '%';
  }

  function signFmt(n: number): string {
    const prefix = n >= 0 ? '+' : '';
    return prefix + fmt(n);
  }

  async function generateInsights() {
    if (!locationId || !selectedDate) return;
    loading = true;
    error = '';
    insights = null;
    try {
      const params = new URLSearchParams({ locationId, date: selectedDate });
      const res = await fetch(`/api/v1/insights?${params}`);
      if (!res.ok) {
        const data = await res.json();
        error = data.error || 'Failed to load insights';
        return;
      }
      insights = await res.json();
      managerNotes = insights.managerNotes || '';
      laborVarianceNotes = insights.laborVarianceNotes || '';
      notesSaved = false;
      varianceNotesSaved = false;
    } catch (e: any) {
      error = e.message || 'Network error';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email;
      const url = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(url)
        .then((r) => r.json())
        .then((d) => {
          locations = d.locations || d || [];
          singleLocation = locations.length === 1;
          if (locations.length > 0) {
            const saved = localStorage.getItem('helixo_selected_location');
            locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
          }
        });
    });
  });
</script>

<div class="p-3 md:p-4">
  <div class="mb-6">
    <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Daily Insights</h1>
    <p class="text-sm text-[#6b7280]">AI-generated narrative summary of daily performance</p>
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
      <label class="text-xs text-[#6b7280] uppercase tracking-wide block mb-1">Date</label>
      <input bind:value={selectedDate} type="date" class="leo-select" />
    </div>
    <button onclick={generateInsights} disabled={loading || !locationId} class="leo-btn">
      {loading ? 'Loading...' : 'Generate Insights'}
    </button>
  </div>

  {#if error}
    <div class="leo-card p-4 mb-6" style="border-color: #fca5a5; background: #fef2f2;">
      <p class="text-sm text-[#dc2626]">{error}</p>
    </div>
  {/if}

  {#if insights}
    <!-- Metric Summary Cards -->
    <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
      <div class="leo-card p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Revenue</div>
        <div class="text-xl font-bold text-[#1a1a1a]">{fmt(insights.metrics.revenue)}</div>
        <div class="text-xs mt-1 {insights.metrics.revVsBudgetDollars >= 0 ? 'leo-positive' : 'leo-negative'}">
          {signFmt(insights.metrics.revVsBudgetDollars)} vs budget
        </div>
        {#if insights.metrics.weather}
          <div class="text-xs mt-2 text-[#6b7280] flex items-center gap-1">
            {#if insights.metrics.weather.icon}
              <img src="https://openweathermap.org/img/wn/{insights.metrics.weather.icon}.png" alt="" class="w-5 h-5 inline-block" />
            {/if}
            <span>{insights.metrics.weather.description || insights.metrics.weather.condition}, {Math.round(insights.metrics.weather.tempHigh || 0)}°F</span>
          </div>
        {/if}
      </div>
      <div class="leo-card p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Covers</div>
        <div class="text-xl font-bold text-[#1a1a1a]">{insights.metrics.covers?.toLocaleString() ?? '-'}</div>
        <div class="text-xs mt-1 text-[#6b7280]">
          Avg check: {fmt(insights.metrics.avgCheck)}
        </div>
        {#if insights.metrics.reservations}
          <div class="text-xs mt-2 text-[#6b7280]">
            Resy: {insights.metrics.reservations.bookedCovers} booked
            {#if insights.metrics.reservations.avgPartySize}
              (avg {insights.metrics.reservations.avgPartySize.toFixed(1)} pax)
            {/if}
          </div>
        {/if}
      </div>
      <div class="leo-card p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Total Labor</div>
        <div class="text-xl font-bold text-[#1a1a1a]">{fmt(insights.metrics.totalLaborActual)}</div>
        <div class="text-xs mt-1 text-[#6b7280]">
          Proj: {fmt(insights.metrics.totalLaborProjected)} ({signFmt(insights.metrics.totalLaborActual - insights.metrics.totalLaborProjected)})
        </div>
      </div>
      <div class="leo-card p-4">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Labor %</div>
        <div class="text-xl font-bold text-[#1a1a1a]">{pct(insights.metrics.laborPctOfRevenue)}</div>
        <div class="text-xs mt-1 text-[#6b7280]">
          Target: {pct(insights.metrics.targetLaborPct)}
        </div>
      </div>
    </div>

    <!-- Narrative Sections -->
    <div class="space-y-4">
      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">Revenue Summary</h3>
        <p class="text-sm text-[#374151] leading-relaxed">{insights.sections.revenueSummary}</p>
      </div>

      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">Covers & Average Check</h3>
        <p class="text-sm text-[#374151] leading-relaxed">{insights.sections.coversSummary}</p>
      </div>

      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">Comps & Discounts</h3>
        <p class="text-sm text-[#374151] leading-relaxed">{insights.sections.compsAndDiscounts}</p>
      </div>

      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">Sales Mix</h3>
        <p class="text-sm text-[#374151] leading-relaxed">{insights.sections.salesMix}</p>
      </div>

      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">PMIX Movers</h3>
        <p class="text-sm text-[#374151] leading-relaxed">{insights.sections.pmixMovers}</p>
      </div>

      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">Labor Variance</h3>
        <p class="text-sm text-[#374151] leading-relaxed">{insights.sections.laborVariance}</p>

        {#if insights.metrics.flaggedPositions && insights.metrics.flaggedPositions.length > 0}
          <div class="mt-4 leo-table-scroll">
            <table class="w-full leo-table">
              <thead>
                <tr>
                  <th class="leo-th" style="text-align: left;">Position</th>
                  <th class="leo-th">Actual</th>
                  <th class="leo-th">Projected</th>
                  <th class="leo-th">Variance</th>
                  <th class="leo-th">% of Revenue</th>
                </tr>
              </thead>
              <tbody>
                {#each insights.metrics.flaggedPositions as fp}
                  <tr>
                    <td class="leo-td" style="text-align: left; font-weight: 500;">{fp.position}</td>
                    <td class="leo-td">{fmt(fp.actual)}</td>
                    <td class="leo-td">{fmt(fp.projected)}</td>
                    <td class="leo-td {fp.varianceDollars > 0 ? 'leo-negative' : 'leo-positive'}">
                      {signFmt(fp.varianceDollars)}
                    </td>
                    <td class="leo-td">{pct(fp.variancePct)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}

        <!-- Labor Variance Explanation -->
        <div class="mt-4">
          <label class="text-xs text-[#6b7280] uppercase tracking-wide font-medium mb-2 block">Labor Variance Explanation</label>
          <textarea
            bind:value={laborVarianceNotes}
            placeholder="Labor variance explanation here..."
            rows="3"
            class="w-full rounded-lg px-4 py-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
            style="background: #f3f4f6; border: 1px solid #e5e7eb; color: #374151;"
          ></textarea>
          <div class="flex items-center gap-3 mt-2">
            <button
              onclick={async () => {
                if (!laborVarianceNotes.trim()) return;
                savingVarianceNotes = true;
                varianceNotesSaved = false;
                try {
                  await fetch('/api/v1/insights', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ locationId, date: selectedDate, notes: managerNotes, laborVarianceNotes }),
                  });
                  varianceNotesSaved = true;
                  setTimeout(() => varianceNotesSaved = false, 3000);
                } catch (e) { console.error(e); }
                finally { savingVarianceNotes = false; }
              }}
              disabled={savingVarianceNotes || !laborVarianceNotes.trim()}
              class="leo-btn text-xs"
              style="{!laborVarianceNotes.trim() ? 'opacity: 0.5; cursor: not-allowed;' : ''}; padding: 6px 16px;"
            >
              {savingVarianceNotes ? 'Saving...' : 'Submit'}
            </button>
            {#if varianceNotesSaved}
              <span class="text-xs" style="color: #16a34a;">Saved</span>
            {/if}
          </div>
        </div>
      </div>

      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">Labor Savings Opportunity</h3>
        <p class="text-sm text-[#374151] leading-relaxed">{insights.sections.laborSavings}</p>
      </div>

      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-2">Hourly Efficiency</h3>
        <p class="text-sm text-[#374151] leading-relaxed mb-4">{insights.sections.hourlyEfficiency}</p>

        {#if insights.metrics.hourlyData && insights.metrics.hourlyData.length > 0}
          {@const maxRevenue = Math.max(...insights.metrics.hourlyData.map((h: any) => h.revenue))}
          <div class="space-y-1.5">
            {#each insights.metrics.hourlyData as h}
              {@const barWidth = maxRevenue > 0 ? (h.revenue / maxRevenue) * 100 : 0}
              {@const hourLabel = h.hour === 0 ? '12AM' : h.hour < 12 ? `${h.hour}AM` : h.hour === 12 ? '12PM' : `${h.hour - 12}PM`}
              <div class="flex items-center gap-2">
                <span class="text-xs text-[#6b7280] w-10 text-right font-mono">{hourLabel}</span>
                <div class="flex-1 h-5 rounded overflow-hidden" style="background: #f3f4f6;">
                  <div
                    class="h-full rounded transition-all"
                    style="width: {barWidth}%; background: {h.hour >= 17 && h.hour <= 21 ? '#1e3a5f' : h.hour >= 11 && h.hour <= 14 ? '#2d5a8e' : '#8ba8c9'};"
                  ></div>
                </div>
                <span class="text-xs text-[#374151] w-16 text-right font-medium">{fmt(h.revenue)}</span>
              </div>
            {/each}
          </div>
          <div class="flex items-center gap-4 mt-3 text-xs text-[#6b7280]">
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded" style="background: #1e3a5f;"></span> Dinner (5-9PM)</span>
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded" style="background: #2d5a8e;"></span> Lunch (11AM-2PM)</span>
            <span class="flex items-center gap-1"><span class="inline-block w-3 h-3 rounded" style="background: #8ba8c9;"></span> Other</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- FOH/BOH Labor Breakdown -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-3">FOH Labor</h3>
        <div class="flex justify-between text-sm mb-1">
          <span class="text-[#6b7280]">Actual</span>
          <span class="font-medium text-[#1a1a1a]">{fmt(insights.metrics.fohActual)}</span>
        </div>
        <div class="flex justify-between text-sm mb-1">
          <span class="text-[#6b7280]">Projected</span>
          <span class="font-medium text-[#1a1a1a]">{fmt(insights.metrics.fohProjected)}</span>
        </div>
        <div class="flex justify-between text-sm border-t pt-1 mt-1" style="border-color: #e5e7eb;">
          <span class="text-[#6b7280]">Variance</span>
          <span class="font-medium {insights.metrics.fohActual - insights.metrics.fohProjected > 0 ? 'leo-negative' : 'leo-positive'}">
            {signFmt(insights.metrics.fohActual - insights.metrics.fohProjected)}
          </span>
        </div>
      </div>
      <div class="leo-card p-5">
        <h3 class="leo-section-title mb-3">BOH Labor</h3>
        <div class="flex justify-between text-sm mb-1">
          <span class="text-[#6b7280]">Actual</span>
          <span class="font-medium text-[#1a1a1a]">{fmt(insights.metrics.bohActual)}</span>
        </div>
        <div class="flex justify-between text-sm mb-1">
          <span class="text-[#6b7280]">Projected</span>
          <span class="font-medium text-[#1a1a1a]">{fmt(insights.metrics.bohProjected)}</span>
        </div>
        <div class="flex justify-between text-sm border-t pt-1 mt-1" style="border-color: #e5e7eb;">
          <span class="text-[#6b7280]">Variance</span>
          <span class="font-medium {insights.metrics.bohActual - insights.metrics.bohProjected > 0 ? 'leo-negative' : 'leo-positive'}">
            {signFmt(insights.metrics.bohActual - insights.metrics.bohProjected)}
          </span>
        </div>
      </div>
    </div>
    <!-- Manager Narrative -->
    <div class="leo-card p-5 mt-4">
      <h3 class="leo-section-title mb-3">Manager Narrative</h3>
      <textarea
        bind:value={managerNotes}
        placeholder="Manager comments here..."
        rows="4"
        class="w-full rounded-lg px-4 py-3 text-sm leading-relaxed resize-y focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
        style="background: #f3f4f6; border: 1px solid #e5e7eb; color: #374151;"
      ></textarea>
      <div class="flex items-center gap-3 mt-3">
        <button
          onclick={async () => {
            if (!managerNotes.trim()) return;
            savingNotes = true;
            notesSaved = false;
            try {
              await fetch('/api/v1/insights', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ locationId, date: selectedDate, notes: managerNotes }),
              });
              notesSaved = true;
              setTimeout(() => notesSaved = false, 3000);
            } catch (e) { console.error(e); }
            finally { savingNotes = false; }
          }}
          disabled={savingNotes || !managerNotes.trim()}
          class="leo-btn"
          style="{!managerNotes.trim() ? 'opacity: 0.5; cursor: not-allowed;' : ''}"
        >
          {savingNotes ? 'Saving...' : 'Submit'}
        </button>
        {#if notesSaved}
          <span class="text-xs" style="color: #16a34a;">Saved</span>
        {/if}
      </div>
    </div>

  {:else if !loading && !error}
    <div class="leo-card p-12 text-center">
      <p class="text-[#9ca3af] text-sm">Select a location and date, then click "Generate Insights" to view the daily performance narrative.</p>
    </div>
  {/if}
</div>
