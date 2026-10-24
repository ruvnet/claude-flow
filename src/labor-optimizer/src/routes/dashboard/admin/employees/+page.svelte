<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  const POSITIONS = [
    'Server', 'Bartender', 'Host', 'Support', 'Training',
    'Line Cooks', 'Prep Cooks', 'Dishwashers', 'Barista', 'Pastry',
  ];
  const EMPLOYMENT_TYPES = [
    { value: 'full_time', label: 'Full-Time' },
    { value: 'part_time', label: 'Part-Time' },
    { value: 'seasonal', label: 'Seasonal' },
  ];
  const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let authChecked = $state(false);
  let isAdmin = $state(false);
  let loading = $state(true);
  let error = $state('');
  let successMsg = $state('');
  let saving = $state(false);

  let locations = $state<{ id: string; name: string }[]>([]);
  let selectedLocationId = $state('');
  let employees = $state<any[]>([]);
  let searchQuery = $state('');
  let filterPosition = $state('');

  // Add/Edit form
  let showForm = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state(emptyForm());

  // Expanded row
  let expandedId = $state<string | null>(null);

  function emptyForm() {
    return {
      name: '', email: '', phone: '', position: 'Server',
      secondary_positions: [] as string[], hourly_rate: '',
      employment_type: 'full_time', max_hours_per_week: '40',
      overtime_threshold: '40', hire_date: '',
      toast_employee_id: '', dolce_employee_id: '',
      availability: Object.fromEntries(DAYS.map(d => [d, { start: '16:00', end: '23:00', available: true }])),
    };
  }

  function formToPayload() {
    const avail: Record<string, any> = {};
    for (const d of DAYS) {
      const slot = form.availability[d];
      avail[d] = slot.available ? { start: slot.start, end: slot.end } : null;
    }
    return {
      location_id: selectedLocationId,
      name: form.name, email: form.email || null, phone: form.phone || null,
      position: form.position, secondary_positions: form.secondary_positions,
      hourly_rate: form.hourly_rate ? Number(form.hourly_rate) : null,
      employment_type: form.employment_type,
      max_hours_per_week: Number(form.max_hours_per_week) || 40,
      overtime_threshold: Number(form.overtime_threshold) || 40,
      hire_date: form.hire_date || null, availability: avail,
      toast_employee_id: form.toast_employee_id || null,
      dolce_employee_id: form.dolce_employee_id || null,
    };
  }

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

      // Load locations
      const locRes = await fetch('/api/v1/locations');
      const locData = await locRes.json();
      locations = locData.locations || [];

      // Default to saved location or Lowland
      const saved = typeof localStorage !== 'undefined' ? localStorage.getItem('selectedLocationId') : null;
      const lowland = locations.find(l => l.name?.toLowerCase().includes('lowland'));
      selectedLocationId = saved && locations.some(l => l.id === saved) ? saved : (lowland?.id || locations[0]?.id || '');
      if (selectedLocationId) loadEmployees();
    });
  });

  async function loadEmployees() {
    if (!selectedLocationId) return;
    loading = true;
    error = '';
    try {
      const res = await fetch(`/api/v1/employees?locationId=${selectedLocationId}`);
      const data = await res.json();
      if (!res.ok) { error = data.error || 'Failed to load'; return; }
      employees = data.employees || [];
    } catch (e: any) { error = e.message; }
    finally { loading = false; }
  }

  function onLocationChange() {
    if (typeof localStorage !== 'undefined') localStorage.setItem('selectedLocationId', selectedLocationId);
    expandedId = null;
    loadEmployees();
  }

  function startAdd() {
    editingId = null;
    form = emptyForm();
    showForm = true;
  }

  function startEdit(emp: any) {
    editingId = emp.id;
    form = {
      name: emp.name, email: emp.email || '', phone: emp.phone || '',
      position: emp.position, secondary_positions: emp.secondary_positions || [],
      hourly_rate: emp.hourly_rate?.toString() || '',
      employment_type: emp.employment_type || 'full_time',
      max_hours_per_week: (emp.max_hours_per_week ?? 40).toString(),
      overtime_threshold: (emp.overtime_threshold ?? 40).toString(),
      hire_date: emp.hire_date || '',
      toast_employee_id: emp.toast_employee_id || '',
      dolce_employee_id: emp.dolce_employee_id || '',
      availability: Object.fromEntries(DAYS.map(d => {
        const slot = emp.availability?.[d];
        return [d, slot ? { start: slot.start || '16:00', end: slot.end || '23:00', available: true }
          : { start: '16:00', end: '23:00', available: false }];
      })),
    };
    showForm = true;
  }

  function cancelForm() { showForm = false; editingId = null; }

  async function submitForm() {
    if (!form.name.trim() || !form.position) { error = 'Name and position are required'; return; }
    saving = true; error = '';
    try {
      const payload = formToPayload();
      const isEdit = !!editingId;
      const res = await fetch('/api/v1/employees', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: editingId, ...payload } : payload),
      });
      const data = await res.json();
      if (!res.ok) { error = data.error || 'Save failed'; return; }
      successMsg = isEdit ? 'Employee updated' : 'Employee added';
      setTimeout(() => successMsg = '', 3000);
      showForm = false; editingId = null;
      await loadEmployees();
    } catch (e: any) { error = e.message; }
    finally { saving = false; }
  }

  async function deactivate(emp: any) {
    if (!confirm(`Deactivate ${emp.name}?`)) return;
    saving = true; error = '';
    try {
      const res = await fetch(`/api/v1/employees?id=${emp.id}`, { method: 'DELETE' });
      if (!res.ok) { error = (await res.json()).error || 'Failed'; return; }
      successMsg = `${emp.name} deactivated`;
      setTimeout(() => successMsg = '', 3000);
      await loadEmployees();
    } catch (e: any) { error = e.message; }
    finally { saving = false; }
  }

  function toggleSecondary(pos: string) {
    if (form.secondary_positions.includes(pos)) {
      form.secondary_positions = form.secondary_positions.filter(p => p !== pos);
    } else {
      form.secondary_positions = [...form.secondary_positions, pos];
    }
  }

  let filteredEmployees = $derived(
    employees.filter(e => {
      if (searchQuery && !e.name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      if (filterPosition && e.position !== filterPosition &&
        !(e.secondary_positions || []).includes(filterPosition)) return false;
      return true;
    })
  );

  function typeLabel(t: string) {
    return EMPLOYMENT_TYPES.find(e => e.value === t)?.label || t;
  }
</script>

{#if !authChecked || (!isAdmin && authChecked)}
  <div class="min-h-screen flex items-center justify-center" style="background: #fafafa;">
    <p class="text-sm" style="color: #9ca3af;">
      {authChecked ? 'Access denied. Redirecting...' : 'Checking access...'}
    </p>
  </div>
{:else}
  <div class="p-3 md:p-4">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <div>
        <h1 class="text-xl font-bold" style="color: #1a1a1a;">Employees</h1>
        <p class="text-sm mt-0.5" style="color: #6b7280;">Manage roster and availability</p>
      </div>
      <div class="flex items-center gap-3">
        <select class="leo-select" bind:value={selectedLocationId} onchange={onLocationChange}>
          {#each locations as loc}
            <option value={loc.id}>{loc.name}</option>
          {/each}
        </select>
        <button class="leo-btn text-sm" onclick={startAdd}>+ Add Employee</button>
      </div>
    </div>

    {#if error}
      <div class="mb-4 p-3 rounded-lg text-sm" style="background: #fee2e2; color: #dc2626; border: 1px solid #fecaca;">
        {error}
        <button onclick={() => error = ''} class="ml-2 underline text-xs">dismiss</button>
      </div>
    {/if}
    {#if successMsg}
      <div class="mb-4 p-3 rounded-lg text-sm" style="background: #dcfce7; color: #16a34a; border: 1px solid #bbf7d0;">
        {successMsg}
      </div>
    {/if}

    <!-- Add/Edit Form -->
    {#if showForm}
      <div class="leo-card p-4 mb-4">
        <h3 class="text-sm font-semibold mb-3" style="color: #1a1a1a;">
          {editingId ? 'Edit Employee' : 'Add Employee'}
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <input class="leo-select" placeholder="Full Name *" bind:value={form.name} />
          <input class="leo-select" placeholder="Email" type="email" bind:value={form.email} />
          <input class="leo-select" placeholder="Phone" bind:value={form.phone} />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <select class="leo-select" bind:value={form.position}>
            {#each POSITIONS as p}<option value={p}>{p}</option>{/each}
          </select>
          <select class="leo-select" bind:value={form.employment_type}>
            {#each EMPLOYMENT_TYPES as t}<option value={t.value}>{t.label}</option>{/each}
          </select>
          <input class="leo-select" placeholder="Hourly Rate" type="number" step="0.01" bind:value={form.hourly_rate} />
          <input class="leo-select" placeholder="Hire Date" type="date" bind:value={form.hire_date} />
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <input class="leo-select" placeholder="Max Hrs/Week" type="number" bind:value={form.max_hours_per_week} />
          <input class="leo-select" placeholder="OT Threshold" type="number" bind:value={form.overtime_threshold} />
          <input class="leo-select" placeholder="Toast Employee ID" bind:value={form.toast_employee_id} />
          <input class="leo-select" placeholder="Dolce Employee ID" bind:value={form.dolce_employee_id} />
        </div>

        <!-- Secondary Positions -->
        <div class="mb-3">
          <p class="text-xs font-medium mb-1.5" style="color: #374151;">Secondary Positions</p>
          <div class="flex flex-wrap gap-2">
            {#each POSITIONS.filter(p => p !== form.position) as pos}
              <label class="flex items-center gap-1 text-xs cursor-pointer px-2 py-1 rounded"
                style="background: {form.secondary_positions.includes(pos) ? '#1e3a5f' : '#f3f4f6'}; color: {form.secondary_positions.includes(pos) ? 'white' : '#374151'};">
                <input type="checkbox" class="sr-only"
                  checked={form.secondary_positions.includes(pos)}
                  onchange={() => toggleSecondary(pos)} />
                {pos}
              </label>
            {/each}
          </div>
        </div>

        <!-- Availability Grid -->
        <div class="mb-3">
          <p class="text-xs font-medium mb-1.5" style="color: #374151;">Weekly Availability</p>
          <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2">
            {#each DAYS as day, i}
              <div class="p-2 rounded" style="background: #f8f9fa; border: 1px solid #e5e7eb;">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-medium" style="color: #374151;">{DAY_LABELS[i]}</span>
                  <label class="text-[10px] cursor-pointer" style="color: #6b7280;">
                    <input type="checkbox" bind:checked={form.availability[day].available}
                      class="mr-0.5" style="accent-color: #1e3a5f;" />
                    Avail
                  </label>
                </div>
                {#if form.availability[day].available}
                  <input type="time" class="leo-select w-full text-xs mb-1" bind:value={form.availability[day].start} />
                  <input type="time" class="leo-select w-full text-xs" bind:value={form.availability[day].end} />
                {:else}
                  <p class="text-[10px] text-center py-2" style="color: #9ca3af;">Unavailable</p>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <div class="flex gap-2">
          <button class="leo-btn text-xs" onclick={submitForm} disabled={saving}>
            {saving ? 'Saving...' : editingId ? 'Update' : 'Add Employee'}
          </button>
          <button class="leo-btn-secondary text-xs" onclick={cancelForm}>Cancel</button>
        </div>
      </div>
    {/if}

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <input class="leo-select" placeholder="Search by name..." style="min-width: 200px;"
        bind:value={searchQuery} />
      <select class="leo-select" bind:value={filterPosition}>
        <option value="">All Positions</option>
        {#each POSITIONS as p}<option value={p}>{p}</option>{/each}
      </select>
      <span class="text-xs" style="color: #6b7280;">
        {filteredEmployees.length} employee{filteredEmployees.length !== 1 ? 's' : ''}
      </span>
    </div>

    <!-- Employee Table -->
    {#if loading}
      <div class="leo-card p-8 text-center">
        <p class="text-sm" style="color: #9ca3af;">Loading employees...</p>
      </div>
    {:else if filteredEmployees.length === 0}
      <div class="leo-card p-8 text-center">
        <p class="text-sm" style="color: #9ca3af;">
          {employees.length === 0 ? 'No employees yet. Click "Add Employee" to get started.' : 'No employees match your filters.'}
        </p>
      </div>
    {:else}
      <div class="leo-card overflow-hidden">
        <div class="leo-table-scroll">
          <table class="w-full leo-table">
            <thead>
              <tr>
                <th class="leo-th text-left">Name</th>
                <th class="leo-th text-left">Position</th>
                <th class="leo-th text-left">Secondary</th>
                <th class="leo-th text-right">Rate</th>
                <th class="leo-th text-center">Type</th>
                <th class="leo-th text-right">Max Hrs</th>
                <th class="leo-th text-right">This Week</th>
                <th class="leo-th text-center">Status</th>
                <th class="leo-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredEmployees as emp (emp.id)}
                <tr class="cursor-pointer hover:bg-[#f1f5f9]"
                  onclick={() => expandedId = expandedId === emp.id ? null : emp.id}>
                  <td class="leo-td text-left font-medium" style="color: #1a1a1a;">{emp.name}</td>
                  <td class="leo-td text-left">{emp.position}</td>
                  <td class="leo-td text-left">
                    {#if emp.secondary_positions?.length > 0}
                      <div class="flex flex-wrap gap-1">
                        {#each emp.secondary_positions as sp}
                          <span class="inline-block px-1.5 py-0.5 rounded text-[10px]"
                            style="background: #f3f4f6; color: #374151;">{sp}</span>
                        {/each}
                      </div>
                    {:else}
                      <span class="text-xs" style="color: #9ca3af;">-</span>
                    {/if}
                  </td>
                  <td class="leo-td text-right">
                    {emp.hourly_rate ? `$${Number(emp.hourly_rate).toFixed(2)}` : '-'}
                  </td>
                  <td class="leo-td text-center">
                    <span class="text-[11px] px-2 py-0.5 rounded-full"
                      style="background: {emp.employment_type === 'full_time' ? '#dbeafe' : emp.employment_type === 'part_time' ? '#fef3c7' : '#e0e7ff'};
                             color: {emp.employment_type === 'full_time' ? '#1d4ed8' : emp.employment_type === 'part_time' ? '#92400e' : '#4338ca'};">
                      {typeLabel(emp.employment_type)}
                    </span>
                  </td>
                  <td class="leo-td text-right">{emp.max_hours_per_week ?? 40}</td>
                  <td class="leo-td text-right">
                    {#if emp.week_hours}
                      <span style="color: {(emp.week_hours.actual_hours || 0) > (emp.overtime_threshold || 40) ? '#dc2626' : '#1a1a1a'};">
                        {(emp.week_hours.actual_hours || 0).toFixed(1)}h
                      </span>
                    {:else}
                      <span style="color: #9ca3af;">0h</span>
                    {/if}
                  </td>
                  <td class="leo-td text-center">
                    <span class="inline-block w-2 h-2 rounded-full"
                      style="background: {emp.is_active ? '#16a34a' : '#9ca3af'};"></span>
                  </td>
                  <td class="leo-td text-right">
                    <div class="flex items-center justify-end gap-2" onclick={(e) => e.stopPropagation()}>
                      <button class="text-xs px-2 py-1 rounded"
                        style="color: #1e3a5f; border: 1px solid #cbd5e1;"
                        onclick={(e) => { e.stopPropagation(); startEdit(emp); }}>Edit</button>
                      <button class="text-xs px-2 py-1 rounded"
                        style="color: #dc2626; border: 1px solid #fecaca;"
                        onclick={(e) => { e.stopPropagation(); deactivate(emp); }}>Deactivate</button>
                    </div>
                  </td>
                </tr>

                <!-- Expanded Detail Row -->
                {#if expandedId === emp.id}
                  <tr>
                    <td colspan="9" class="p-4" style="background: #f8f9fa; border-bottom: 1px solid #e5e7eb;">
                      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mb-3">
                        <div>
                          <span style="color: #6b7280;">Email:</span>
                          <span class="ml-1" style="color: #1a1a1a;">{emp.email || '-'}</span>
                        </div>
                        <div>
                          <span style="color: #6b7280;">Phone:</span>
                          <span class="ml-1" style="color: #1a1a1a;">{emp.phone || '-'}</span>
                        </div>
                        <div>
                          <span style="color: #6b7280;">Hire Date:</span>
                          <span class="ml-1" style="color: #1a1a1a;">{emp.hire_date || '-'}</span>
                        </div>
                        <div>
                          <span style="color: #6b7280;">OT Threshold:</span>
                          <span class="ml-1" style="color: #1a1a1a;">{emp.overtime_threshold ?? 40}h</span>
                        </div>
                      </div>

                      <!-- Availability mini-grid -->
                      <p class="text-xs font-medium mb-1" style="color: #374151;">Availability</p>
                      <div class="flex gap-2 flex-wrap">
                        {#each DAYS as day, i}
                          {@const slot = emp.availability?.[day]}
                          <div class="px-2 py-1 rounded text-[11px] text-center" style="min-width: 60px;
                            background: {slot ? '#dcfce7' : '#f3f4f6'};
                            color: {slot ? '#16a34a' : '#9ca3af'};">
                            <div class="font-medium">{DAY_LABELS[i]}</div>
                            {#if slot}
                              <div>{slot.start}-{slot.end}</div>
                            {:else}
                              <div>Off</div>
                            {/if}
                          </div>
                        {/each}
                      </div>
                    </td>
                  </tr>
                {/if}
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  </div>
{/if}
