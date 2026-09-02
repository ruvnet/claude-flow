<script lang="ts">
  import type { ShiftTemplate } from '$lib/types/Schedule';

  let {
    templates = [],
    onApply,
    onSaveAsCurrent,
  } = $props<{
    templates: ShiftTemplate[];
    onApply?: (template: ShiftTemplate) => void;
    onSaveAsCurrent?: () => void;
  }>();

  let open = $state(false);
</script>

<div class="relative">
  <button
    onclick={() => open = !open}
    class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
  >
    Templates
  </button>

  {#if open}
    <div class="absolute right-0 top-full z-20 mt-1 w-64 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
      {#if templates.length === 0}
        <p class="px-3 py-2 text-sm text-gray-500">No templates saved yet</p>
      {:else}
        {#each templates as template}
          <button
            class="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-50"
            onclick={() => { onApply?.(template); open = false; }}
          >
            <span class="font-medium text-gray-900">{template.name}</span>
            <span class="text-xs text-gray-500">{template.shiftSlots.length} slots</span>
          </button>
        {/each}
      {/if}
      <div class="mt-1 border-t border-gray-100 pt-1">
        <button
          class="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-brand-600 hover:bg-brand-50"
          onclick={() => { onSaveAsCurrent?.(); open = false; }}
        >
          + Save current day as template
        </button>
      </div>
    </div>
  {/if}
</div>
