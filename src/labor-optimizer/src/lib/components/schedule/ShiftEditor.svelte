<script lang="ts">
  import type { Shift } from '$lib/types/Schedule';
  import type { Employee, StaffRole } from '$lib/types/Employee';
  import { STAFF_ROLE_LABELS } from '$lib/types/Employee';
  import { formatCurrency, calculateShiftHours, calculateShiftCost } from '$lib/utils/labor-math';

  let {
    open = $bindable(false),
    shift = null,
    employees = [],
    date = '',
    role = '' as StaffRole,
    scheduleId = '',
    locationId = '',
    onSave,
    onDelete,
  } = $props<{
    open?: boolean;
    shift?: Shift | null;
    employees: Employee[];
    date: string;
    role: StaffRole;
    scheduleId: string;
    locationId: string;
    onSave?: (data: any) => void;
    onDelete?: (shiftId: string) => void;
  }>();

  let selectedEmployeeId = $state(shift?.employeeId || '');
  let startTime = $state(shift?.startTime || '11:00');
  let endTime = $state(shift?.endTime || '19:00');
  let breakMinutes = $state(shift?.breakMinutes || 30);
  let notes = $state(shift?.notes || '');

  // Filter employees who have this role
  let eligibleEmployees = $derived(
    employees.filter(e => e.isActive && e.roles.includes(role))
  );

  let selectedEmployee = $derived(
    employees.find(e => e._id === selectedEmployeeId)
  );

  let shiftHours = $derived(
    calculateShiftHours(startTime, endTime, breakMinutes)
  );

  let estimatedCost = $derived(
    selectedEmployee
      ? calculateShiftCost(startTime, endTime, breakMinutes, selectedEmployee.hourlyRate, false)
      : 0
  );

  // Reset form when shift changes
  $effect(() => {
    if (shift) {
      selectedEmployeeId = shift.employeeId;
      startTime = shift.startTime;
      endTime = shift.endTime;
      breakMinutes = shift.breakMinutes;
      notes = shift.notes || '';
    } else {
      selectedEmployeeId = '';
      startTime = '11:00';
      endTime = '19:00';
      breakMinutes = 30;
      notes = '';
    }
  });

  function handleSave() {
    if (!selectedEmployeeId) return;

    onSave?.({
      scheduleId,
      shiftId: shift?._id,
      employeeId: selectedEmployeeId,
      locationId,
      role,
      date,
      startTime,
      endTime,
      breakMinutes,
      notes: notes || undefined,
    });

    open = false;
  }

  function handleDelete() {
    if (shift) {
      onDelete?.(shift._id);
      open = false;
    }
  }
</script>

{#if open}
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onclick={() => open = false}>
  <div class="w-full max-w-md rounded-xl bg-white p-6 shadow-xl" onclick={(e) => e.stopPropagation()}>
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold text-gray-900">
        {shift ? 'Edit Shift' : 'Add Shift'}
      </h2>
      <button onclick={() => open = false} class="text-gray-400 hover:text-gray-600">
        <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>

    <div class="mt-1 text-sm text-gray-500">
      {STAFF_ROLE_LABELS[role] || role} — {date}
    </div>

    <div class="mt-4 space-y-4">
      <!-- Employee Select -->
      <div>
        <label class="block text-sm font-medium text-gray-700">Employee</label>
        <select
          bind:value={selectedEmployeeId}
          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">Select employee...</option>
          {#each eligibleEmployees as emp}
            <option value={emp._id}>
              {emp.firstName} {emp.lastName} ({formatCurrency(emp.hourlyRate)}/hr)
            </option>
          {/each}
        </select>
        {#if eligibleEmployees.length === 0}
          <p class="mt-1 text-xs text-amber-600">No employees with the {STAFF_ROLE_LABELS[role]} role</p>
        {/if}
      </div>

      <!-- Time Range -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium text-gray-700">Start</label>
          <input
            type="time"
            bind:value={startTime}
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700">End</label>
          <input
            type="time"
            bind:value={endTime}
            class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
      </div>

      <!-- Break -->
      <div>
        <label class="block text-sm font-medium text-gray-700">Break (minutes)</label>
        <select
          bind:value={breakMinutes}
          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        >
          <option value={0}>No break</option>
          <option value={15}>15 min</option>
          <option value={30}>30 min</option>
          <option value={45}>45 min</option>
          <option value={60}>60 min</option>
        </select>
      </div>

      <!-- Notes -->
      <div>
        <label class="block text-sm font-medium text-gray-700">Notes (optional)</label>
        <input
          type="text"
          bind:value={notes}
          placeholder="e.g., Training shift, Closing duties"
          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
      </div>

      <!-- Summary -->
      <div class="rounded-lg bg-gray-50 p-3">
        <div class="flex justify-between text-sm">
          <span class="text-gray-600">Duration</span>
          <span class="font-medium text-gray-900">{shiftHours.toFixed(1)} hrs</span>
        </div>
        <div class="mt-1 flex justify-between text-sm">
          <span class="text-gray-600">Estimated Cost</span>
          <span class="font-medium text-gray-900">{formatCurrency(estimatedCost)}</span>
        </div>
        {#if selectedEmployee}
          <div class="mt-1 flex justify-between text-sm">
            <span class="text-gray-600">Rate</span>
            <span class="text-gray-500">{formatCurrency(selectedEmployee.hourlyRate)}/hr</span>
          </div>
        {/if}
      </div>
    </div>

    <!-- Actions -->
    <div class="mt-6 flex items-center justify-between">
      <div>
        {#if shift}
          <button
            onclick={handleDelete}
            class="rounded-lg px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
          >
            Delete Shift
          </button>
        {/if}
      </div>
      <div class="flex gap-2">
        <button
          onclick={() => open = false}
          class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          onclick={handleSave}
          disabled={!selectedEmployeeId}
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {shift ? 'Update' : 'Add'} Shift
        </button>
      </div>
    </div>
  </div>
</div>
{/if}
