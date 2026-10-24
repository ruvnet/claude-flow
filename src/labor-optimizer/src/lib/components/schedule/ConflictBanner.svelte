<script lang="ts">
  let { conflicts = [] } = $props<{
    conflicts: Array<{
      type: string;
      severity: 'error' | 'warning';
      message: string;
    }>;
  }>();

  let errors = $derived(conflicts.filter(c => c.severity === 'error'));
  let warnings = $derived(conflicts.filter(c => c.severity === 'warning'));
  let expanded = $state(false);
</script>

{#if conflicts.length > 0}
<div class="rounded-xl border {errors.length > 0 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'} p-4">
  <button
    class="flex w-full items-center justify-between"
    onclick={() => expanded = !expanded}
  >
    <div class="flex items-center gap-2">
      {#if errors.length > 0}
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700">
          {errors.length}
        </span>
        <span class="text-sm font-medium text-red-800">
          {errors.length} error{errors.length !== 1 ? 's' : ''}
        </span>
      {/if}
      {#if warnings.length > 0}
        <span class="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-xs font-bold text-amber-700">
          {warnings.length}
        </span>
        <span class="text-sm font-medium text-amber-800">
          {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
        </span>
      {/if}
    </div>
    <svg class="h-4 w-4 text-gray-500 transition-transform {expanded ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  {#if expanded}
    <ul class="mt-3 space-y-1">
      {#each conflicts as conflict}
        <li class="flex items-start gap-2 text-sm {conflict.severity === 'error' ? 'text-red-700' : 'text-amber-700'}">
          <span class="mt-0.5">{conflict.severity === 'error' ? '!!' : '!'}</span>
          <span>{conflict.message}</span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
{/if}
