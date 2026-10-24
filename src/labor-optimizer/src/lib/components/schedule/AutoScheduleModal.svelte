<script lang="ts">
  import { formatCurrency, formatPct } from '$lib/utils/labor-math';

  let {
    open = $bindable(false),
    result = null,
    onAccept,
    onDiscard,
  } = $props<{
    open?: boolean;
    result?: {
      status: string;
      score: number;
      totalShifts: number;
      newShiftsAdded: number;
      totalHours: number;
      totalCost: number;
      laborCostPct: number;
      projectedRevenue: number;
      warnings: Array<{ type: string; message: string; severity: string }>;
      unfilledSlots: Array<{ date: string; role: string; startTime: string; endTime: string; reason: string }>;
      stats: {
        totalSlotsToFill: number;
        slotsFilled: number;
        slotsUnfilled: number;
        candidatesEvaluated: number;
        overtimeShifts: number;
        avgEmployeeHours: number;
        hoursStdDev: number;
      };
    } | null;
    onAccept?: () => void;
    onDiscard?: () => void;
  }>();

  let scoreColor = $derived(
    !result ? 'text-gray-500' :
    result.score >= 80 ? 'text-green-600' :
    result.score >= 60 ? 'text-amber-600' :
    'text-red-600'
  );

  let scoreLabel = $derived(
    !result ? '' :
    result.score >= 80 ? 'Excellent' :
    result.score >= 60 ? 'Good' :
    result.score >= 40 ? 'Fair' :
    'Needs Review'
  );

  let showDetails = $state(false);
</script>

{#if open && result}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onclick={() => open = false}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white shadow-xl" onclick={(e) => e.stopPropagation()}>
    <!-- Header -->
    <div class="border-b border-gray-200 px-6 py-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-lg font-semibold text-gray-900">AI Schedule Optimization Complete</h2>
          <p class="mt-0.5 text-sm text-gray-500">
            {result.stats.candidatesEvaluated} candidates evaluated across {result.stats.totalSlotsToFill} slots
          </p>
        </div>
        <div class="text-center">
          <div class="text-3xl font-bold {scoreColor}">{result.score}</div>
          <div class="text-xs {scoreColor}">{scoreLabel}</div>
        </div>
      </div>
    </div>

    <div class="px-6 py-4 space-y-4">
      <!-- Key Metrics -->
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div class="rounded-lg bg-gray-50 p-3 text-center">
          <p class="text-xs text-gray-500">New Shifts</p>
          <p class="mt-1 text-xl font-bold text-gray-900">{result.newShiftsAdded}</p>
        </div>
        <div class="rounded-lg bg-gray-50 p-3 text-center">
          <p class="text-xs text-gray-500">Total Hours</p>
          <p class="mt-1 text-xl font-bold text-gray-900">{result.totalHours.toFixed(0)}</p>
        </div>
        <div class="rounded-lg bg-gray-50 p-3 text-center">
          <p class="text-xs text-gray-500">Labor Cost</p>
          <p class="mt-1 text-xl font-bold text-gray-900">{formatCurrency(result.totalCost)}</p>
        </div>
        <div class="rounded-lg p-3 text-center {result.laborCostPct > 0.31 ? 'bg-red-50' : result.laborCostPct > 0.28 ? 'bg-amber-50' : 'bg-green-50'}">
          <p class="text-xs text-gray-500">Labor %</p>
          <p class="mt-1 text-xl font-bold {result.laborCostPct > 0.31 ? 'text-red-700' : result.laborCostPct > 0.28 ? 'text-amber-700' : 'text-green-700'}">
            {formatPct(result.laborCostPct)}
          </p>
        </div>
      </div>

      <!-- Fill Rate Bar -->
      <div>
        <div class="flex items-center justify-between text-sm">
          <span class="text-gray-600">Slot Fill Rate</span>
          <span class="font-medium text-gray-900">
            {result.stats.slotsFilled}/{result.stats.totalSlotsToFill} filled
          </span>
        </div>
        <div class="mt-1 h-3 rounded-full bg-gray-200 overflow-hidden">
          {@const fillPct = result.stats.totalSlotsToFill > 0 ? (result.stats.slotsFilled / result.stats.totalSlotsToFill) * 100 : 0}
          <div
            class="h-full rounded-full transition-all {fillPct >= 90 ? 'bg-green-500' : fillPct >= 70 ? 'bg-amber-500' : 'bg-red-500'}"
            style="width: {fillPct}%"
          ></div>
        </div>
      </div>

      <!-- Warnings -->
      {#if result.warnings.length > 0}
        <div class="space-y-2">
          <h3 class="text-sm font-medium text-gray-700">Warnings</h3>
          {#each result.warnings as warning}
            <div class="flex items-start gap-2 rounded-lg p-2 text-sm
              {warning.severity === 'critical' ? 'bg-red-50 text-red-700' :
               warning.severity === 'warning' ? 'bg-amber-50 text-amber-700' :
               'bg-blue-50 text-blue-700'}">
              <span class="mt-0.5 flex-shrink-0">
                {warning.severity === 'critical' ? '!!' : warning.severity === 'warning' ? '!' : 'i'}
              </span>
              <span>{warning.message}</span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Unfilled Slots -->
      {#if result.unfilledSlots.length > 0}
        <div>
          <button
            class="flex items-center gap-1 text-sm font-medium text-gray-700"
            onclick={() => showDetails = !showDetails}
          >
            <svg class="h-4 w-4 transition-transform {showDetails ? 'rotate-90' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
            </svg>
            {result.unfilledSlots.length} Unfilled Slots
          </button>
          {#if showDetails}
            <div class="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-200">
              <table class="min-w-full text-xs">
                <thead class="bg-gray-50">
                  <tr>
                    <th class="px-3 py-1.5 text-left text-gray-500">Date</th>
                    <th class="px-3 py-1.5 text-left text-gray-500">Role</th>
                    <th class="px-3 py-1.5 text-left text-gray-500">Time</th>
                    <th class="px-3 py-1.5 text-left text-gray-500">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {#each result.unfilledSlots as slot}
                    <tr class="border-t border-gray-100">
                      <td class="px-3 py-1.5 text-gray-900">{slot.date}</td>
                      <td class="px-3 py-1.5 text-gray-900">{slot.role}</td>
                      <td class="px-3 py-1.5 text-gray-600">{slot.startTime}-{slot.endTime}</td>
                      <td class="px-3 py-1.5 text-gray-500">{slot.reason}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Stats Summary -->
      <div class="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 grid grid-cols-3 gap-2">
        <div>Avg hours/employee: <span class="font-medium text-gray-700">{result.stats.avgEmployeeHours.toFixed(1)}h</span></div>
        <div>Hours std dev: <span class="font-medium text-gray-700">{result.stats.hoursStdDev.toFixed(1)}h</span></div>
        <div>Overtime shifts: <span class="font-medium text-gray-700">{result.stats.overtimeShifts}</span></div>
      </div>
    </div>

    <!-- Actions -->
    <div class="border-t border-gray-200 px-6 py-4 flex items-center justify-between">
      <p class="text-xs text-gray-400">
        Projected revenue: {formatCurrency(result.projectedRevenue)}
      </p>
      <div class="flex gap-2">
        <button
          onclick={() => { onDiscard?.(); open = false; }}
          class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Discard
        </button>
        <button
          onclick={() => { onAccept?.(); open = false; }}
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Accept Schedule
        </button>
      </div>
    </div>
  </div>
</div>
{/if}
