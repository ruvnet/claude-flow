<script lang="ts">
  import { STAFF_ROLE_LABELS } from '$lib/types';

  let searchQuery = $state('');
  let roleFilter = $state('all');
  let employees = $state<any[]>([]);

  const roles = Object.entries(STAFF_ROLE_LABELS);
</script>

<div class="space-y-6">
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-gray-900">Employees</h1>
      <p class="mt-1 text-sm text-gray-500">{employees.length} team members</p>
    </div>
    <button class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
      + Add Employee
    </button>
  </div>

  <!-- Filters -->
  <div class="flex gap-3">
    <input
      type="text"
      placeholder="Search employees..."
      bind:value={searchQuery}
      class="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
    />
    <select
      bind:value={roleFilter}
      class="rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-brand-500 focus:outline-none"
    >
      <option value="all">All Roles</option>
      {#each roles as [value, label]}
        <option {value}>{label}</option>
      {/each}
    </select>
  </div>

  <!-- Employee Table -->
  <div class="overflow-hidden rounded-xl border border-gray-200 bg-white">
    {#if employees.length === 0}
      <div class="flex flex-col items-center justify-center py-12">
        <span class="text-4xl">👥</span>
        <p class="mt-3 text-sm font-medium text-gray-900">No employees yet</p>
        <p class="mt-1 text-sm text-gray-500">Add your first team member to get started</p>
        <button class="mt-4 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          + Add Employee
        </button>
      </div>
    {:else}
      <table class="min-w-full divide-y divide-gray-200">
        <thead class="bg-gray-50">
          <tr>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Name</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Roles</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Location</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Rate</th>
            <th class="px-6 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200">
          <!-- Populated from API -->
        </tbody>
      </table>
    {/if}
  </div>
</div>
