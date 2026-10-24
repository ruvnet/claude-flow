<script lang="ts">
  interface Props {
    managerAccuracySummary: any;
    modelStats: any;
  }

  let { managerAccuracySummary, modelStats }: Props = $props();

  let hasData = $derived(managerAccuracySummary && managerAccuracySummary.mape != null);

  let aiMape = $derived(modelStats?.mape ?? modelStats?.overall_mape ?? null);

  let comparison = $derived.by(() => {
    if (!hasData || aiMape == null) return null;
    const mgrMape = managerAccuracySummary.mape;
    const better = mgrMape < aiMape ? 'manager' : aiMape < mgrMape ? 'ai' : 'tie';
    const diff = Math.abs(mgrMape - aiMape).toFixed(1);
    return { mgrMape, aiMape, better, diff };
  });

  let weakDays = $derived.by(() => {
    if (!managerAccuracySummary?.notes) return [];
    return managerAccuracySummary.notes;
  });

  // Bar width as percentage (cap at 20% MAPE for visual scale)
  function barPct(mape: number): number {
    return Math.min(100, (mape / 20) * 100);
  }
</script>

{#if hasData}
<div class="leo-card mb-4">
  <div class="px-4 pt-3 pb-3">
    <h3 class="text-sm font-semibold mb-2" style="color: #1e3a5f;">Override Accuracy</h3>
    <div class="flex flex-col gap-2">
      <!-- Manager MAPE bar -->
      <div>
        <div class="flex items-center justify-between mb-0.5">
          <span class="text-xs font-medium" style="color: #374151;">Your Overrides</span>
          <span class="text-xs font-bold" style="color: {comparison?.better === 'manager' ? '#16a34a' : '#ea580c'};">{managerAccuracySummary.mape.toFixed(1)}% MAPE</span>
        </div>
        <div class="h-2 rounded-full overflow-hidden" style="background: #f3f4f6;">
          <div class="h-full rounded-full" style="width: {barPct(managerAccuracySummary.mape)}%; background: {comparison?.better === 'manager' ? '#16a34a' : '#ea580c'};"></div>
        </div>
      </div>
      <!-- AI MAPE bar -->
      {#if aiMape != null}
      <div>
        <div class="flex items-center justify-between mb-0.5">
          <span class="text-xs font-medium" style="color: #374151;">AI Forecast</span>
          <span class="text-xs font-bold" style="color: {comparison?.better === 'ai' ? '#16a34a' : '#1e3a5f'};">{aiMape.toFixed(1)}% MAPE</span>
        </div>
        <div class="h-2 rounded-full overflow-hidden" style="background: #f3f4f6;">
          <div class="h-full rounded-full" style="width: {barPct(aiMape)}%; background: {comparison?.better === 'ai' ? '#16a34a' : '#1e3a5f'};"></div>
        </div>
      </div>
      {/if}
      <!-- Summary text -->
      {#if comparison}
        <p class="text-xs mt-1" style="color: #6b7280;">
          {#if comparison.better === 'manager'}
            Your overrides have been <strong style="color: #16a34a;">{comparison.diff}% more accurate</strong> than AI alone.
          {:else if comparison.better === 'ai'}
            AI forecasts have been <strong style="color: #1e3a5f;">{comparison.diff}% more accurate</strong> than overrides.
          {:else}
            AI and your overrides are equally accurate.
          {/if}
        </p>
      {/if}
      <!-- Weak days -->
      {#if weakDays.length > 0}
        <div class="mt-1">
          {#each weakDays as note}
            <p class="text-xs" style="color: #9ca3af;">{note}</p>
          {/each}
        </div>
      {/if}
      <!-- Grade badge -->
      {#if managerAccuracySummary.grade}
        <div class="flex items-center gap-2 mt-1">
          <span class="text-xs" style="color: #6b7280;">Overall Grade:</span>
          <span class="inline-block px-2 py-0.5 rounded text-xs font-bold" style="
            background: {managerAccuracySummary.grade === 'A' ? '#dcfce7' : managerAccuracySummary.grade === 'B' ? '#dbeafe' : managerAccuracySummary.grade === 'C' ? '#fef9c3' : '#fef2f2'};
            color: {managerAccuracySummary.grade === 'A' ? '#16a34a' : managerAccuracySummary.grade === 'B' ? '#1e3a5f' : managerAccuracySummary.grade === 'C' ? '#a16207' : '#dc2626'};
          ">{managerAccuracySummary.grade}</span>
          <span class="text-xs" style="color: #9ca3af;">({managerAccuracySummary.records} records)</span>
        </div>
      {/if}
    </div>
  </div>
</div>
{/if}
