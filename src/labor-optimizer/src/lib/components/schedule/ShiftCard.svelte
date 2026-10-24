<script lang="ts">
  import type { Shift } from '$lib/types/Schedule';
  import type { Employee } from '$lib/types/Employee';
  import { formatTime } from '$lib/utils/date';
  import { formatCurrency } from '$lib/utils/labor-math';

  let {
    shift,
    employeeName = 'Unassigned',
    onEdit,
    onDelete,
  } = $props<{
    shift: Shift;
    employeeName?: string;
    onEdit?: (shift: Shift) => void;
    onDelete?: (shiftId: string) => void;
  }>();

  const statusColors: Record<string, string> = {
    scheduled: 'bg-blue-50 border-blue-200 text-blue-800',
    confirmed: 'bg-green-50 border-green-200 text-green-800',
    in_progress: 'bg-amber-50 border-amber-200 text-amber-800',
    completed: 'bg-gray-50 border-gray-200 text-gray-600',
    no_show: 'bg-red-50 border-red-200 text-red-800',
    called_off: 'bg-red-50 border-red-200 text-red-800',
  };

  let showActions = $state(false);
</script>

<div
  class="group relative rounded-lg border p-2 text-xs transition-all cursor-pointer hover:shadow-sm {statusColors[shift.status] || statusColors.scheduled}"
  onmouseenter={() => showActions = true}
  onmouseleave={() => showActions = false}
  onclick={() => onEdit?.(shift)}
  role="button"
  tabindex="0"
>
  <div class="font-medium truncate">{employeeName}</div>
  <div class="mt-0.5 text-[10px] opacity-75">
    {formatTime(shift.startTime)} - {formatTime(shift.endTime)}
  </div>
  {#if shift.isOvertimeShift}
    <span class="mt-0.5 inline-block rounded bg-red-100 px-1 text-[9px] font-medium text-red-700">OT</span>
  {/if}
  <div class="mt-0.5 text-[10px] opacity-60">{formatCurrency(shift.laborCost)}</div>

  {#if showActions && onDelete}
    <button
      class="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
      onclick={(e) => { e.stopPropagation(); onDelete(shift._id); }}
    >
      x
    </button>
  {/if}
</div>
