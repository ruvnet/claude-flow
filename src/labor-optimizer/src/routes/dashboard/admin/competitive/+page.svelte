<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let locationId = $state('');
  let locations = $state<{ id: string; name: string }[]>([]);
  let loading = $state(false);
  let error = $state('');
  let isAdmin = $state(false);
  let authChecked = $state(false);

  // Availability data (multi-day)
  let snapshots = $state<any[]>([]);
  let singleSnapshot = $state<any>(null);
  let days = $state(7);

  // Config panel
  let showConfig = $state(false);
  let competitors = $state<any[]>([]);
  let saving = $state(false);

  // New competitor form
  let newName = $state('');
  let newResyId = $state('');
  let newCuisine = $state('');
  let newCity = $state('');
  let newPriceTier = $state('$$');
  let newDistance = $state('');

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function todayStr(): string {
    return new Date().toISOString().split('T')[0];
  }

  function shortDate(d: string): string {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  }

  function pctStr(n: number): string {
    return (n * 100).toFixed(0) + '%';
  }

  function demandColor(level: string): string {
    if (level === 'high') return '#16a34a';
    if (level === 'medium') return '#ca8a04';
    return '#dc2626';
  }

  function demandBg(level: string): string {
    if (level === 'high') return '#dcfce7';
    if (level === 'medium') return '#fef9c3';
    return '#fee2e2';
  }

  function bookedColor(pct: number): string {
    if (pct >= 0.8) return '#16a34a';
    if (pct >= 0.5) return '#ca8a04';
    return '#6b7280';
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function loadAvailability() {
    if (!locationId) return;
    loading = true;
    error = '';
    snapshots = [];
    singleSnapshot = null;
    try {
      const date = todayStr();
      const params = new URLSearchParams({ locationId, date, days: String(days) });
      const res = await fetch(`/api/v1/competitive?${params}`);
      if (!res.ok) { error = (await res.json()).error || 'Failed'; return; }
      const data = await res.json();
      if (data.snapshots) {
        snapshots = data.snapshots;
      } else {
        singleSnapshot = data;
      }
    } catch (e: any) { error = e.message; }
    finally { loading = false; }
  }

  async function loadConfig() {
    if (!locationId) return;
    try {
      const params = new URLSearchParams({ locationId, config: 'true' });
      const res = await fetch(`/api/v1/competitive?${params}`);
      if (res.ok) {
        const data = await res.json();
        competitors = data.competitors || [];
      }
    } catch { /* ignore */ }
  }

  async function saveCompetitor() {
    if (!newName.trim() || !locationId) return;
    saving = true;
    try {
      const res = await fetch('/api/v1/competitive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location_id: locationId,
          competitor_name: newName.trim(),
          competitor_resy_id: newResyId.trim() || null,
          competitor_cuisine: newCuisine.trim() || null,
          competitor_city: newCity.trim() || null,
          competitor_price_tier: newPriceTier,
          distance_miles: newDistance ? parseFloat(newDistance) : null,
        }),
      });
      if (res.ok) {
        newName = ''; newResyId = ''; newCuisine = ''; newCity = '';
        newPriceTier = '$$'; newDistance = '';
        await loadConfig();
        await loadAvailability();
      }
    } catch { /* ignore */ }
    finally { saving = false; }
  }

  async function removeCompetitor(id: string) {
    try {
      await fetch(`/api/v1/competitive?id=${id}`, { method: 'DELETE' });
      await loadConfig();
      await loadAvailability();
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const email = session?.user?.email ?? null;
      if (email) {
        try {
          const _roleCtrl = new AbortController(); setTimeout(() => _roleCtrl.abort(), 8000); const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: _roleCtrl.signal });
          if (res.ok) {
            const data = await res.json();
            isAdmin = data.permissions?.admin ?? false;
          }
        } catch { isAdmin = false; }
      }
      authChecked = true;
      if (!isAdmin) { goto('/dashboard'); return; }
      const locUrl = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(locUrl).then(r => r.json()).then(d => {
        locations = d.locations || d || [];
        if (locations.length > 0) {
          const saved = localStorage.getItem('helixo_selected_location');
          locationId = (saved && locations.some((l: any) => l.id === saved))
            ? saved : locations[0].id;
          loadAvailability();
          loadConfig();
        }
      });
    });
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
      <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Competitive Set</h1>
      <p class="text-sm text-[#6b7280]">Monitor competitor availability as a demand signal</p>
    </div>
    <div class="flex flex-wrap items-center gap-2 sm:gap-3">
      <select bind:value={days} onchange={loadAvailability} class="leo-select">
        <option value={1}>Today</option>
        <option value={3}>3 days</option>
        <option value={7}>7 days</option>
        <option value={14}>14 days</option>
      </select>
      <select bind:value={locationId} onchange={() => {
        localStorage.setItem('helixo_selected_location', locationId);
        loadAvailability(); loadConfig();
      }} class="leo-select flex-1 sm:flex-none">
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
      <button class="leo-btn-secondary" onclick={() => showConfig = !showConfig}>
        {showConfig ? 'Hide Config' : 'Configure'}
      </button>
    </div>
  </div>

  <!-- Demand Signal Summary -->
  {#if !loading && (singleSnapshot || snapshots.length > 0)}
    {@const snap = singleSnapshot || snapshots[0]}
    {#if snap?.demandSignal}
      <div class="leo-card p-4 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div class="flex items-center gap-3">
          <span class="inline-block px-3 py-1 rounded-full text-sm font-semibold"
            style="background: {demandBg(snap.demandSignal.level)}; color: {demandColor(snap.demandSignal.level)};">
            Market Demand: {snap.demandSignal.level.toUpperCase()}
          </span>
          <span class="text-sm text-[#6b7280]">
            Avg booked: {pctStr(snap.demandSignal.avgPercentBooked)}
          </span>
        </div>
        <p class="text-sm text-[#374151] flex-1">{snap.demandSignal.summary}</p>
      </div>
    {/if}
  {/if}

  <!-- Loading / Error -->
  {#if loading}
    <div class="leo-card p-12 text-center">
      <p class="text-sm text-[#9ca3af]">Fetching competitor availability...</p>
    </div>
  {:else if error}
    <div class="leo-card p-6">
      <p class="text-sm text-[#dc2626]">{error}</p>
    </div>

  <!-- Multi-day view -->
  {:else if snapshots.length > 0}
    <div class="leo-card overflow-hidden mb-6">
      <div class="leo-table-scroll">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="leo-th text-left">Competitor</th>
              <th class="leo-th">Cuisine</th>
              <th class="leo-th">Price</th>
              {#each snapshots as snap}
                <th class="leo-th">{shortDate(snap.date)}</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#if snapshots[0]?.competitors?.length > 0}
              {#each snapshots[0].competitors as comp, ci}
                <tr class="{ci % 2 === 1 ? 'bg-[#f8f9fa]' : ''}">
                  <td class="leo-td text-left font-medium">{comp.competitor.competitor_name}</td>
                  <td class="leo-td text-[#6b7280]">{comp.competitor.competitor_cuisine || '-'}</td>
                  <td class="leo-td">{comp.competitor.competitor_price_tier || '-'}</td>
                  {#each snapshots as snap}
                    {@const entry = snap.competitors[ci]}
                    {#if entry}
                      <td class="leo-td">
                        {#if entry.dataAvailable === false}
                          <span class="text-[10px] text-[#9ca3af] italic">Scan pending</span>
                        {:else}
                          <span class="font-medium" style="color: {bookedColor(entry.percentBooked)}">
                            {entry.availableSlots} slots
                          </span>
                          <br/>
                          <span class="text-[10px] text-[#9ca3af]">{pctStr(entry.percentBooked)} booked</span>
                        {/if}
                      </td>
                    {:else}
                      <td class="leo-td text-[#9ca3af]">-</td>
                    {/if}
                  {/each}
                </tr>
              {/each}
            {:else}
              <tr>
                <td colspan="99" class="leo-td text-[#9ca3af] py-8">
                  No competitors configured. Use the Configure button to add competitors.
                </td>
              </tr>
            {/if}
          </tbody>
          <!-- Demand signal footer row -->
          {#if snapshots[0]?.competitors?.length > 0}
            <tfoot>
              <tr class="leo-footer">
                <td colspan="3" class="text-left font-semibold">Market Demand</td>
                {#each snapshots as snap}
                  <td class="text-center">
                    <span class="inline-block px-2 py-0.5 rounded text-xs font-semibold"
                      style="background: {demandBg(snap.demandSignal.level)}; color: {demandColor(snap.demandSignal.level)};">
                      {snap.demandSignal.level.toUpperCase()}
                    </span>
                  </td>
                {/each}
              </tr>
            </tfoot>
          {/if}
        </table>
      </div>
    </div>

  <!-- Single-day view -->
  {:else if singleSnapshot}
    <div class="leo-card overflow-hidden mb-6">
      <div class="leo-table-scroll">
        <table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="leo-th text-left">Competitor</th>
              <th class="leo-th">Cuisine</th>
              <th class="leo-th">Price Tier</th>
              <th class="leo-th">Available Slots</th>
              <th class="leo-th">% Booked</th>
              <th class="leo-th">First Available</th>
              <th class="leo-th">Last Available</th>
              <th class="leo-th">Demand Signal</th>
            </tr>
          </thead>
          <tbody>
            {#if singleSnapshot.competitors.length > 0}
              {#each singleSnapshot.competitors as entry, i}
                <tr class="{i % 2 === 1 ? 'bg-[#f8f9fa]' : ''}">
                  <td class="leo-td text-left font-medium">{entry.competitor.competitor_name}</td>
                  <td class="leo-td text-[#6b7280]">{entry.competitor.competitor_cuisine || '-'}</td>
                  <td class="leo-td">{entry.competitor.competitor_price_tier || '-'}</td>
                  <td class="leo-td font-medium">
                    {#if entry.dataAvailable === false}
                      <span class="text-[#9ca3af] italic text-xs">—</span>
                    {:else}
                      {entry.availableSlots}
                    {/if}
                  </td>
                  <td class="leo-td">
                    {#if entry.dataAvailable === false}
                      <span class="text-[10px] text-[#9ca3af] italic">Scan pending</span>
                    {:else}
                      <span class="font-semibold" style="color: {bookedColor(entry.percentBooked)}">
                        {pctStr(entry.percentBooked)}
                      </span>
                    {/if}
                  </td>
                  <td class="leo-td text-[#6b7280]">{entry.firstAvailable || '-'}</td>
                  <td class="leo-td text-[#6b7280]">{entry.lastAvailable || '-'}</td>
                  <td class="leo-td">
                    {#if entry.dataAvailable === false}
                      <span class="text-[#9ca3af] text-xs italic">—</span>
                    {:else if entry.percentBooked >= 0.8}
                      <span class="text-[#16a34a] font-semibold">HIGH</span>
                    {:else if entry.percentBooked >= 0.5}
                      <span class="text-[#ca8a04] font-semibold">MED</span>
                    {:else}
                      <span class="text-[#6b7280]">LOW</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            {:else}
              <tr>
                <td colspan="8" class="leo-td text-[#9ca3af] py-8">
                  No competitors configured. Use the Configure button to add competitors.
                </td>
              </tr>
            {/if}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  <!-- Configuration Panel -->
  {#if showConfig}
    <div class="leo-card p-4 mb-6">
      <h2 class="leo-section-title mb-4">Competitor Configuration</h2>

      <!-- Existing competitors -->
      {#if competitors.length > 0}
        <div class="leo-table-scroll mb-4">
          <table class="w-full border-collapse">
            <thead>
              <tr>
                <th class="leo-th text-left">Name</th>
                <th class="leo-th">Resy ID</th>
                <th class="leo-th">City</th>
                <th class="leo-th">Cuisine</th>
                <th class="leo-th">Price</th>
                <th class="leo-th">Distance</th>
                <th class="leo-th">Active</th>
                <th class="leo-th">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each competitors as comp, i}
                <tr class="{i % 2 === 1 ? 'bg-[#f8f9fa]' : ''}">
                  <td class="leo-td text-left font-medium">{comp.competitor_name}</td>
                  <td class="leo-td text-[#6b7280]">{comp.competitor_resy_id || '-'}</td>
                  <td class="leo-td text-[#6b7280]">{comp.competitor_city || '-'}</td>
                  <td class="leo-td">{comp.competitor_cuisine || '-'}</td>
                  <td class="leo-td">{comp.competitor_price_tier || '-'}</td>
                  <td class="leo-td">{comp.distance_miles ? comp.distance_miles + ' mi' : '-'}</td>
                  <td class="leo-td">
                    {#if comp.is_active}
                      <span class="text-[#16a34a]">Yes</span>
                    {:else}
                      <span class="text-[#9ca3af]">No</span>
                    {/if}
                  </td>
                  <td class="leo-td">
                    {#if comp.is_active}
                      <button class="text-xs text-[#dc2626] hover:underline"
                        onclick={() => removeCompetitor(comp.id)}>Remove</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}

      <!-- Add new competitor -->
      <div class="border-t border-[#e5e7eb] pt-4">
        <h3 class="text-sm font-semibold text-[#374151] mb-3">Add Competitor</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 mb-3">
          <div>
            <label class="block text-xs text-[#6b7280] mb-1">Name *</label>
            <input bind:value={newName} class="leo-select w-full" placeholder="Restaurant name" />
          </div>
          <div>
            <label class="block text-xs text-[#6b7280] mb-1">Resy Venue ID</label>
            <input bind:value={newResyId} class="leo-select w-full" placeholder="e.g. 12345" />
          </div>
          <div>
            <label class="block text-xs text-[#6b7280] mb-1">City</label>
            <input bind:value={newCity} class="leo-select w-full" placeholder="e.g. New York" />
          </div>
          <div>
            <label class="block text-xs text-[#6b7280] mb-1">Cuisine</label>
            <input bind:value={newCuisine} class="leo-select w-full" placeholder="e.g. Italian" />
          </div>
          <div>
            <label class="block text-xs text-[#6b7280] mb-1">Price Tier</label>
            <select bind:value={newPriceTier} class="leo-select w-full">
              <option value="$">$</option>
              <option value="$$">$$</option>
              <option value="$$$">$$$</option>
              <option value="$$$$">$$$$</option>
            </select>
          </div>
          <div>
            <label class="block text-xs text-[#6b7280] mb-1">Distance (miles)</label>
            <input bind:value={newDistance} class="leo-select w-full" type="number"
              step="0.1" min="0" placeholder="e.g. 0.5" />
          </div>
        </div>
        <button class="leo-btn" disabled={!newName.trim() || saving} onclick={saveCompetitor}>
          {saving ? 'Saving...' : 'Add Competitor'}
        </button>
        <p class="text-xs text-[#9ca3af] mt-2">
          Tip: Find the Resy Venue ID from the restaurant's Resy URL.
          For example, resy.com/cities/ny/venues/<strong>venue-name</strong> — the numeric ID
          is in the page source or network requests.
        </p>
      </div>
    </div>
  {/if}
</div>
{/if}
