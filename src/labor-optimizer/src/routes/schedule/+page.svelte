<script lang="ts">
  import { getWeekStart, getWeekDates, formatDateShort, getDayShort } from '$lib/utils/date';
  import { formatCurrency, formatPct } from '$lib/utils/labor-math';
  import { STAFF_ROLE_LABELS } from '$lib/types/Employee';
  import type { Shift } from '$lib/types/Schedule';
  import type { StaffRole } from '$lib/types/Employee';
  import ShiftCard from '$lib/components/schedule/ShiftCard.svelte';
  import ShiftEditor from '$lib/components/schedule/ShiftEditor.svelte';
  import ConflictBanner from '$lib/components/schedule/ConflictBanner.svelte';

  let { data } = $props();

  let currentWeekStart = $state(data.weekStartDate);
  let weekDates = $derived(getWeekDates(currentWeekStart));
  let schedule = $state(data.schedule);
  let employees = $state(data.employees);
  let conflicts = $state<Array<{ type: string; severity: 'error' | 'warning'; message: string }>>([]);

  // Shift editor state
  let editorOpen = $state(false);
  let editingShift = $state<Shift | null>(null);
  let editorDate = $state('');
  let editorRole = $state<StaffRole>('server');

  const roles: StaffRole[] = ['server', 'bartender', 'host', 'busser', 'food_runner', 'line_cook', 'prep_cook', 'dishwasher'];

  // Get shifts for a specific role and date
  function getShifts(role: StaffRole, date: string): Shift[] {
    if (!schedule?.shifts) return [];
    return schedule.shifts.filter((s: Shift) => s.role === role && s.date === date);
  }

  // Get employee name by ID
  function getEmployeeName(employeeId: string): string {
    const emp = employees.find((e: any) => e._id === employeeId);
    return emp ? `${emp.firstName} ${emp.lastName}` : 'Unknown';
  }

  // Open editor for new shift
  function openAddShift(role: StaffRole, date: string) {
    editingShift = null;
    editorDate = date;
    editorRole = role;
    editorOpen = true;
  }

  // Open editor for existing shift
  function openEditShift(shift: Shift) {
    editingShift = shift;
    editorDate = shift.date;
    editorRole = shift.role;
    editorOpen = true;
  }

  // Save shift (add or update)
  async function handleSaveShift(shiftData: any) {
    const isUpdate = !!shiftData.shiftId;
    const method = isUpdate ? 'PUT' : 'POST';

    const response = await fetch('/api/v1/schedules/shifts', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...shiftData,
        scheduleId: schedule?._id || await createSchedule(),
      }),
    });

    const result = await response.json();

    if (result.conflicts?.length) {
      conflicts = result.conflicts;
    }

    // Reload schedule
    await reloadSchedule();
  }

  // Delete shift
  async function handleDeleteShift(shiftId: string) {
    if (!schedule) return;

    await fetch('/api/v1/schedules/shifts', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: schedule._id, shiftId }),
    });

    await reloadSchedule();
  }

  // Create schedule if none exists
  async function createSchedule(): Promise<string> {
    const response = await fetch('/api/v1/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId: data.locationId || 'default',
        weekStartDate: currentWeekStart,
      }),
    });
    const result = await response.json();
    schedule = result.schedule;
    return result.schedule._id;
  }

  // Reload schedule data
  async function reloadSchedule() {
    const params = new URLSearchParams({ weekStartDate: currentWeekStart });
    if (data.locationId) params.set('locationId', data.locationId);

    const response = await fetch(`/api/v1/schedules?${params}`);
    const result = await response.json();
    if (result.schedules?.length) {
      schedule = result.schedules[0];
    }
  }

  // Trigger AI optimization
  async function autoSchedule() {
    if (!schedule) {
      await createSchedule();
    }

    const response = await fetch('/api/v1/schedules/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: schedule?._id }),
    });

    const result = await response.json();
    alert(result.message || 'Optimization queued');
  }

  // Publish schedule
  async function publishSchedule() {
    if (!schedule) return;
    if (!confirm('Publish this schedule? Notifications will be sent to all staff.')) return;

    const response = await fetch('/api/v1/schedules/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleId: schedule._id }),
    });

    const result = await response.json();
    if (result.status === 'published') {
      await reloadSchedule();
    }
  }

  function prevWeek() {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() - 7);
    currentWeekStart = d.toISOString().split('T')[0];
    schedule = null;
    conflicts = [];
    reloadSchedule();
  }

  function nextWeek() {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + 7);
    currentWeekStart = d.toISOString().split('T')[0];
    schedule = null;
    conflicts = [];
    reloadSchedule();
  }

  // Computed totals
  let totalHours = $derived(schedule?.totalScheduledHours || 0);
  let totalCost = $derived(schedule?.totalLaborCost || 0);
  let totalShifts = $derived(schedule?.shifts?.length || 0);
  let scheduleStatus = $derived(schedule?.status || 'draft');
  let isPublished = $derived(scheduleStatus === 'published');
</script>

<div class="space-y-4">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Schedule</h1>
      <p class="mt-1 text-sm text-gray-500">
        Week of {formatDateShort(currentWeekStart)}
        {#if scheduleStatus !== 'draft'}
          <span class="ml-2 rounded-full px-2 py-0.5 text-xs font-medium
            {scheduleStatus === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}">
            {scheduleStatus}
          </span>
        {/if}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <div class="flex items-center rounded-lg border border-gray-300 bg-white">
        <button onclick={prevWeek} class="px-3 py-2 text-gray-600 hover:bg-gray-50">&larr;</button>
        <span class="border-x border-gray-300 px-3 py-2 text-sm font-medium">
          {formatDateShort(weekDates[0])} - {formatDateShort(weekDates[6])}
        </span>
        <button onclick={nextWeek} class="px-3 py-2 text-gray-600 hover:bg-gray-50">&rarr;</button>
      </div>
      {#if !isPublished}
        <button
          onclick={autoSchedule}
          class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Auto-Schedule
        </button>
        <button
          onclick={publishSchedule}
          disabled={totalShifts === 0}
          class="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Publish
        </button>
      {/if}
    </div>
  </div>

  <!-- Conflict Banner -->
  <ConflictBanner {conflicts} />

  <!-- Schedule Grid -->
  <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white">
    <table class="min-w-full">
      <thead>
        <tr class="border-b border-gray-200 bg-gray-50">
          <th class="sticky left-0 z-10 bg-gray-50 px-4 py-3 text-left text-xs font-medium uppercase text-gray-500 w-32">Role</th>
          {#each weekDates as date}
            <th class="px-2 py-3 text-center text-xs font-medium uppercase text-gray-500 min-w-[150px]">
              <div>{getDayShort(new Date(date + 'T00:00:00').getDay())}</div>
              <div class="font-normal">{formatDateShort(date)}</div>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each roles as role}
          <tr class="border-b border-gray-100">
            <td class="sticky left-0 z-10 bg-white px-4 py-2 text-sm font-medium text-gray-900 align-top">
              {STAFF_ROLE_LABELS[role]}
            </td>
            {#each weekDates as date}
              <td class="px-1 py-1 align-top">
                <div class="space-y-1 min-h-[60px]">
                  {#each getShifts(role, date) as shift}
                    <ShiftCard
                      {shift}
                      employeeName={getEmployeeName(shift.employeeId)}
                      onEdit={openEditShift}
                      onDelete={isPublished ? undefined : handleDeleteShift}
                    />
                  {/each}
                  {#if !isPublished}
                    <button
                      class="w-full rounded border border-dashed border-gray-200 p-1.5 text-center text-[10px] text-gray-400 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-600 transition-colors"
                      onclick={() => openAddShift(role, date)}
                    >
                      + Add
                    </button>
                  {/if}
                </div>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <!-- Schedule Summary -->
  <div class="grid grid-cols-4 gap-4">
    <div class="rounded-xl border border-gray-200 bg-white p-4">
      <p class="text-sm text-gray-500">Total Shifts</p>
      <p class="mt-1 text-2xl font-bold text-gray-900">{totalShifts}</p>
    </div>
    <div class="rounded-xl border border-gray-200 bg-white p-4">
      <p class="text-sm text-gray-500">Total Hours</p>
      <p class="mt-1 text-2xl font-bold text-gray-900">{totalHours.toFixed(1)}</p>
    </div>
    <div class="rounded-xl border border-gray-200 bg-white p-4">
      <p class="text-sm text-gray-500">Projected Labor Cost</p>
      <p class="mt-1 text-2xl font-bold text-gray-900">{formatCurrency(totalCost)}</p>
    </div>
    <div class="rounded-xl border border-gray-200 bg-white p-4">
      <p class="text-sm text-gray-500">Labor Cost %</p>
      <p class="mt-1 text-2xl font-bold text-gray-900">
        {schedule?.projectedRevenue ? formatPct(totalCost / schedule.projectedRevenue) : '—'}
      </p>
    </div>
  </div>
</div>

<!-- Shift Editor Modal -->
<ShiftEditor
  bind:open={editorOpen}
  shift={editingShift}
  {employees}
  date={editorDate}
  role={editorRole}
  scheduleId={schedule?._id || ''}
  locationId={data.locationId || 'default'}
  onSave={handleSaveShift}
  onDelete={handleDeleteShift}
/>
