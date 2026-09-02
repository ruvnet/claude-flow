<script lang="ts">
  import type { DemandForecast, DemandSignal } from '$lib/types/DemandForecast';
  import { formatCurrency } from '$lib/utils/labor-math';
  import { formatDateShort } from '$lib/utils/date';

  let { data } = $props();

  let selectedLocationId = $state(data.locationId || (data.locations[0]?._id ?? ''));
  let selectedDate = $state(new Date().toISOString().split('T')[0]);
  let generating = $state(false);
  let currentForecast = $state<DemandForecast | null>(null);
  let similarDays = $state<any[]>([]);
  let patterns = $state<any[]>([]);
  let confidence = $state<number>(0);
  let error = $state('');

  async function generateForecast() {
    if (!selectedLocationId) {
      error = 'Select a location first';
      return;
    }

    generating = true;
    error = '';

    try {
      const response = await fetch('/api/v1/forecasts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: selectedLocationId,
          date: selectedDate,
          includePatterns: true,
        }),
      });

      const result = await response.json();

      if (result.error) {
        error = result.error;
      } else {
        currentForecast = result.forecast;
        similarDays = result.similarDays || [];
        patterns = result.patterns || [];
        confidence = result.confidence || 0;
      }
    } catch (e) {
      error = 'Failed to generate forecast';
    } finally {
      generating = false;
    }
  }

  // Signal source display names
  const signalLabels: Record<string, string> = {
    historical_pos: 'Historical POS',
    resy_reservations: 'Resy Reservations',
    day_of_week: 'Day of Week',
    seasonal: 'Seasonal Factor',
    weather: 'Weather Impact',
    local_events: 'Local Events',
    holiday: 'Holiday',
  };

  // Confidence color
  let confidenceColor = $derived(
    confidence >= 0.7 ? 'text-green-600 bg-green-50' :
    confidence >= 0.4 ? 'text-amber-600 bg-amber-50' :
    'text-red-600 bg-red-50'
  );
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Demand Forecasting</h1>
      <p class="mt-1 text-sm text-gray-500">AI-powered demand predictions using Toast + Resy data</p>
    </div>
    <div class="flex items-center gap-3">
      <select
        bind:value={selectedLocationId}
        class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
      >
        <option value="">Select location...</option>
        {#each data.locations as loc}
          <option value={loc._id}>{loc.name}</option>
        {/each}
      </select>
      <input
        type="date"
        bind:value={selectedDate}
        class="rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
      <button
        onclick={generateForecast}
        disabled={generating || !selectedLocationId}
        class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {generating ? 'Generating...' : 'Generate Forecast'}
      </button>
    </div>
  </div>

  {#if error}
    <div class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
  {/if}

  {#if currentForecast}
    <!-- Forecast Results -->
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-4">
      <div class="rounded-xl border border-gray-200 bg-white p-5">
        <p class="text-sm text-gray-500">Forecasted Covers</p>
        <p class="mt-2 text-3xl font-bold text-gray-900">{currentForecast.forecastedCovers}</p>
        <p class="mt-1 text-xs text-gray-400">{formatDateShort(currentForecast.date)}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5">
        <p class="text-sm text-gray-500">Forecasted Revenue</p>
        <p class="mt-2 text-3xl font-bold text-gray-900">{formatCurrency(currentForecast.forecastedRevenue)}</p>
        <p class="mt-1 text-xs text-gray-400">Avg check: {formatCurrency(currentForecast.forecastedRevenue / Math.max(currentForecast.forecastedCovers, 1))}</p>
      </div>
      <div class="rounded-xl border border-gray-200 bg-white p-5">
        <p class="text-sm text-gray-500">Model</p>
        <p class="mt-2 text-lg font-bold text-gray-900">{currentForecast.model.replace(/_/g, ' ')}</p>
        <p class="mt-1 text-xs text-gray-400">{similarDays.length} similar days used</p>
      </div>
      <div class="rounded-xl border {confidenceColor} p-5">
        <p class="text-sm opacity-70">Confidence</p>
        <p class="mt-2 text-3xl font-bold">{Math.round(confidence * 100)}%</p>
        <p class="mt-1 text-xs opacity-60">
          {confidence >= 0.7 ? 'High' : confidence >= 0.4 ? 'Moderate' : 'Low'} — {confidence < 0.7 ? 'sync more Toast data' : 'good data coverage'}
        </p>
      </div>
    </div>

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <!-- Hourly Breakdown -->
      <div class="col-span-2 rounded-xl border border-gray-200 bg-white p-6">
        <h2 class="text-lg font-semibold text-gray-900">Hourly Demand</h2>
        <p class="mt-1 text-sm text-gray-500">Expected covers by hour</p>
        <div class="mt-4 space-y-1">
          {#each currentForecast.hourlyBreakdown.filter(h => h.expectedCovers > 0) as hourData}
            {@const maxCovers = Math.max(...currentForecast.hourlyBreakdown.map(h => h.expectedCovers))}
            {@const pct = maxCovers > 0 ? (hourData.expectedCovers / maxCovers) * 100 : 0}
            {@const hour12 = hourData.hour % 12 || 12}
            {@const ampm = hourData.hour >= 12 ? 'PM' : 'AM'}
            <div class="flex items-center gap-3">
              <span class="w-16 text-right text-xs text-gray-500">{hour12}:00 {ampm}</span>
              <div class="flex-1 h-6 rounded bg-gray-100 overflow-hidden">
                <div
                  class="h-full rounded bg-brand-500 transition-all"
                  style="width: {pct}%"
                ></div>
              </div>
              <span class="w-16 text-xs font-medium text-gray-700">{hourData.expectedCovers} covers</span>
            </div>
          {/each}
        </div>
      </div>

      <!-- Demand Signals -->
      <div class="rounded-xl border border-gray-200 bg-white p-6">
        <h2 class="text-lg font-semibold text-gray-900">Demand Signals</h2>
        <p class="mt-1 text-sm text-gray-500">What's driving the forecast</p>
        <div class="mt-4 space-y-3">
          {#each currentForecast.signals as signal}
            {@const weightPct = Math.round(signal.weight * 100)}
            <div class="rounded-lg bg-gray-50 p-3">
              <div class="flex items-center justify-between">
                <span class="text-sm font-medium text-gray-900">
                  {signalLabels[signal.source] || signal.source}
                </span>
                <span class="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700">
                  {weightPct}%
                </span>
              </div>
              <p class="mt-1 text-xs text-gray-500">{signal.description}</p>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Similar Historical Days -->
    {#if similarDays.length > 0}
      <div class="rounded-xl border border-gray-200 bg-white p-6">
        <h2 class="text-lg font-semibold text-gray-900">Similar Historical Days</h2>
        <p class="mt-1 text-sm text-gray-500">Most similar past days used for this forecast (HNSW retrieval)</p>
        <div class="mt-4 overflow-x-auto">
          <table class="min-w-full">
            <thead>
              <tr class="border-b border-gray-200">
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">Date</th>
                <th class="px-4 py-2 text-left text-xs font-medium text-gray-500">Day</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">Covers</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">Revenue</th>
                <th class="px-4 py-2 text-right text-xs font-medium text-gray-500">Similarity</th>
              </tr>
            </thead>
            <tbody>
              {#each similarDays as day}
                {@const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']}
                <tr class="border-b border-gray-100">
                  <td class="px-4 py-2 text-sm text-gray-900">{formatDateShort(day.date)}</td>
                  <td class="px-4 py-2 text-sm text-gray-600">{dayNames[day.dayOfWeek]}</td>
                  <td class="px-4 py-2 text-right text-sm font-medium text-gray-900">{day.covers}</td>
                  <td class="px-4 py-2 text-right text-sm text-gray-600">{formatCurrency(day.revenue)}</td>
                  <td class="px-4 py-2 text-right">
                    <span class="rounded-full px-2 py-0.5 text-xs font-medium
                      {day.similarity > 0.7 ? 'bg-green-100 text-green-700' : day.similarity > 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}">
                      {Math.round(day.similarity * 100)}%
                    </span>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {:else}
    <!-- Empty State -->
    <div class="rounded-xl border border-gray-200 bg-white p-12 text-center">
      <span class="text-5xl">📈</span>
      <h3 class="mt-4 text-lg font-semibold text-gray-900">Generate a Demand Forecast</h3>
      <p class="mt-2 text-sm text-gray-500 max-w-md mx-auto">
        Select a location and date, then click Generate. The AI engine will analyze historical Toast POS data,
        Resy reservations, day-of-week patterns, and seasonal trends to predict demand.
      </p>
      <p class="mt-3 text-xs text-gray-400">
        More Toast data synced = higher forecast confidence. SONA learns from accuracy over time.
      </p>
    </div>
  {/if}

  <!-- SONA Pattern Insights -->
  <div class="rounded-xl border border-gray-200 bg-white p-6">
    <h2 class="text-lg font-semibold text-gray-900">SONA Pattern Insights</h2>
    <p class="mt-1 text-sm text-gray-500">Discovered demand patterns from historical data</p>
    <div class="mt-4">
      {#if patterns.length > 0}
        <div class="space-y-2">
          {#each patterns as pattern}
            <div class="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
              <div>
                <span class="text-sm font-medium text-gray-900">{pattern.name}</span>
                <p class="text-xs text-gray-500">{pattern.description}</p>
              </div>
              <div class="flex items-center gap-2">
                <span class="rounded-full px-2 py-0.5 text-xs font-medium
                  {pattern.impactPct > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
                  {pattern.impactPct > 0 ? '+' : ''}{Math.round(pattern.impactPct * 100)}%
                </span>
                <span class="text-xs text-gray-400">{Math.round(pattern.confidence * 100)}% confidence</span>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <p class="py-4 text-center text-sm text-gray-400">
          Patterns will appear after syncing 2+ weeks of Toast POS data. SONA continuously learns.
        </p>
      {/if}
    </div>
  </div>
</div>
