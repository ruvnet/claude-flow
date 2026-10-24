<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';

  let locationId = $state('');
  let locations = $state<any[]>([]);
  let activeTab = $state('mapping');
  let jobMappings = $state<any[]>([]);
  let thresholds = $state<any[]>([]);
  let dolceMappings = $state<any[]>([]);
  let saving = $state(false);
  let savingDolce = $state(false);
  let syncingDolce = $state(false);
  let dolceSyncMessage = $state('');
  let resyUploading = $state(false);
  let resyUploadMessage = $state('');
  let resyDragOver = $state(false);
  let isAdmin = $state(false);
  let authChecked = $state(false);

  // Email Recipients state
  let emailRecipients = $state<any[]>([]);
  let loadingRecipients = $state(false);
  let newRecipientEmail = $state('');
  let newRecipientName = $state('');
  let newRecipientRole = $state('manager');
  let addingRecipient = $state(false);
  let recipientMessage = $state('');

  // Staffing Constraints state
  let staffingConstraints = $state<any[]>([]);
  let loadingConstraints = $state(false);
  let savingConstraints = $state(false);
  let constraintMessage = $state('');

  // Tripleseat state
  let tsConfig = $state<any>(null);
  let tsConsumerKey = $state('');
  let tsConsumerSecret = $state('');
  let tsSiteId = $state('');
  let tsEnabled = $state(true);
  let savingTs = $state(false);
  let testingTs = $state(false);
  let tsMessage = $state('');

  // Role-based access — admin check via API
  const positions = ['Server','Bartender','Host','Barista','Support','Training','Line Cooks','Prep Cooks','Pastry','Dishwashers','EXCLUDE'];
  const roles = ['manager', 'director', 'admin'];

  async function loadSettings() {
    if (!locationId) return;
    const [mapRes, thrRes, dolceRes] = await Promise.all([
      fetch(`/api/v1/settings/mappings?locationId=${locationId}`),
      fetch(`/api/v1/settings/thresholds?locationId=${locationId}`),
      fetch(`/api/v1/settings/dolce-mappings?locationId=${locationId}`)
    ]);
    jobMappings = (await mapRes.json()).mappings || [];
    thresholds = (await thrRes.json()).thresholds || [];
    dolceMappings = (await dolceRes.json()).mappings || [];
    // Also load email recipients, staffing constraints, and tripleseat config
    await Promise.all([loadEmailRecipients(), loadStaffingConstraints(), loadTripleseatConfig()]);
  }

  async function loadStaffingConstraints() {
    if (!locationId) return;
    loadingConstraints = true;
    try {
      const res = await fetch(`/api/v1/staffing-constraints?locationId=${locationId}`);
      const data = await res.json();
      staffingConstraints = data.constraints || [];
    } catch (err: any) {
      staffingConstraints = [];
    }
    loadingConstraints = false;
  }

  async function loadTripleseatConfig() {
    if (!locationId) return;
    try {
      const res = await fetch(`/api/v1/admin/tripleseat-config?locationId=${locationId}`);
      const data = await res.json();
      const cfg = data.configs?.[0];
      if (cfg) {
        tsConfig = cfg;
        tsConsumerKey = cfg.consumer_key || '';
        tsConsumerSecret = cfg.consumer_secret || '';
        tsSiteId = cfg.tripleseat_site_id || '';
        tsEnabled = cfg.enabled !== false;
      } else {
        tsConfig = null;
        tsConsumerKey = '';
        tsConsumerSecret = '';
        tsSiteId = '';
        tsEnabled = true;
      }
    } catch {
      tsConfig = null;
    }
  }

  async function saveStaffingConstraints() {
    if (!locationId || staffingConstraints.length === 0) return;
    savingConstraints = true;
    constraintMessage = '';
    try {
      const res = await fetch('/api/v1/staffing-constraints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          constraints: staffingConstraints.map((c: any) => ({
            position: c.position,
            minHeadcount: Number(c.minHeadcount),
            maxHeadcount: Number(c.maxHeadcount),
            minHoursPerShift: Number(c.minHoursPerShift),
            maxHoursPerShift: Number(c.maxHoursPerShift),
          })),
        }),
      });
      const data = await res.json();
      if (res.ok) {
        constraintMessage = `Saved ${data.saved} constraints.` + (data.errors?.length ? ` Errors: ${data.errors.join(', ')}` : '');
      } else {
        constraintMessage = 'Error: ' + (data.error || 'Failed to save');
      }
    } catch (err: any) {
      constraintMessage = 'Error: ' + err.message;
    }
    savingConstraints = false;
  }

  async function loadEmailRecipients() {
    if (!locationId) return;
    loadingRecipients = true;
    try {
      const res = await fetch(`/api/v1/admin/email-recipients?locationId=${locationId}`);
      const data = await res.json();
      emailRecipients = data.recipients || [];
    } catch (err: any) {
      emailRecipients = [];
    }
    loadingRecipients = false;
  }

  async function addRecipient() {
    if (!newRecipientEmail || !locationId) return;
    addingRecipient = true;
    recipientMessage = '';
    try {
      const res = await fetch('/api/v1/admin/email-recipients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          email: newRecipientEmail,
          name: newRecipientName || null,
          role: newRecipientRole,
          receives_daily_email: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        recipientMessage = 'Recipient added.';
        newRecipientEmail = '';
        newRecipientName = '';
        newRecipientRole = 'manager';
        await loadEmailRecipients();
      } else {
        recipientMessage = 'Error: ' + (data.error || 'Failed to add');
      }
    } catch (err: any) {
      recipientMessage = 'Error: ' + err.message;
    }
    addingRecipient = false;
  }

  async function removeRecipient(id: string) {
    recipientMessage = '';
    try {
      const res = await fetch('/api/v1/admin/email-recipients', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        await loadEmailRecipients();
      } else {
        const data = await res.json();
        recipientMessage = 'Error: ' + (data.error || 'Failed to remove');
      }
    } catch (err: any) {
      recipientMessage = 'Error: ' + err.message;
    }
  }

  async function toggleDailyEmail(id: string, currentValue: boolean) {
    try {
      await fetch('/api/v1/admin/email-recipients', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, receives_daily_email: !currentValue }),
      });
      await loadEmailRecipients();
    } catch (_) {}
  }

  async function saveMappings() {
    saving = true;
    await fetch('/api/v1/settings/mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId, mappings: jobMappings }) });
    saving = false;
  }

  async function saveDolceMappings() {
    savingDolce = true;
    await fetch('/api/v1/settings/dolce-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locationId, mappings: dolceMappings }) });
    savingDolce = false;
  }

  let toastSyncing = $state(false);
  let toastSyncMessage = $state('');

  async function triggerSync() {
    toastSyncing = true;
    toastSyncMessage = 'Triggering sync...';
    try {
      const supabase = getClientSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/v1/admin/trigger-sync', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await res.json();
      if (res.ok) {
        const results = data.results?.map((r: any) => `${r.location}: ${r.status}`).join(', ');
        toastSyncMessage = results ? `Done — ${results}` : 'Sync completed';
      } else {
        toastSyncMessage = data.error || `Error ${res.status}`;
      }
    } catch (err: any) {
      toastSyncMessage = 'Error: ' + err.message;
    }
    toastSyncing = false;
  }

  async function uploadResyCsv(file: File) {
    if (!locationId) { resyUploadMessage = 'Error: No location selected'; return; }
    resyUploading = true;
    resyUploadMessage = '';
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('locationId', locationId);
      const res = await fetch('/api/v1/resy-upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        resyUploadMessage = data.message || `Imported ${data.daysProcessed} days of reservation data`;
      } else {
        resyUploadMessage = 'Error: ' + (data.error || 'Upload failed');
      }
    } catch (err: any) {
      resyUploadMessage = 'Error: ' + err.message;
    }
    resyUploading = false;
  }

  async function triggerDolceSync() {
    syncingDolce = true;
    dolceSyncMessage = '';
    try {
      const res = await fetch('/api/v1/dolce-sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      const data = await res.json();
      dolceSyncMessage = data.message || (data.triggered ? 'Sync triggered successfully.' : 'Sync could not be triggered.');
    } catch (err: any) {
      dolceSyncMessage = 'Error: ' + err.message;
    }
    syncingDolce = false;
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
      const locUrl = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(locUrl).then(r => r.json()).then(d => {
        locations = d.locations || d || [];
        if (locations.length > 0) {
          const saved = localStorage.getItem('helixo_selected_location');
          locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
          loadSettings();
        }
      });
    });
  });
</script>

<div class="p-3 md:p-4">
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
    <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a]">Settings</h1>
    <select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); loadSettings(); }} class="leo-select">
      {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
    </select>
  </div>
  <div class="flex gap-2 mb-6 flex-wrap">
    {#each [['mapping','Toast Job Mapping'],['thresholds','Labor Thresholds'],['staffing','Staffing Limits'],['sync','Toast Sync'],['dolce','Dolce Mapping'],['resy','Resy Upload'],['email','Email Recipients'],['tripleseat','Tripleseat']] as [key, label]}
      <button onclick={() => activeTab = key}
        class="px-4 py-2 rounded text-sm font-medium transition-colors"
        style="{activeTab === key ? 'background: #1e3a5f; color: white;' : 'background: white; border: 1px solid #e5e7eb; color: #374151;'}">
        {label}
      </button>
    {/each}
  </div>

  {#if activeTab === 'mapping'}
  <div class="leo-card p-6">
    <h2 class="leo-section-title mb-4">Toast Job Mapping</h2>
    <div class="space-y-2 max-h-96 overflow-y-auto">
      {#each jobMappings as m, i}
        <div class="flex items-center gap-4 py-2" style="border-bottom: 1px solid #e5e7eb;">
          <span class="flex-1 text-sm text-[#1a1a1a]">{m.toast_job_name}</span>
          <select bind:value={jobMappings[i].dashboard_position} class="leo-select">
            {#each positions as p}<option value={p}>{p}</option>{/each}
          </select>
        </div>
      {/each}
    </div>
    <button onclick={saveMappings} disabled={saving} class="leo-btn mt-4">{saving ? 'Saving...' : 'Save Mappings'}</button>
  </div>
  {:else if activeTab === 'thresholds'}
  <div class="leo-card p-6">
    <h2 class="leo-section-title mb-4">Labor Thresholds</h2>
    {#if thresholds.length > 0}
    <table class="w-full leo-table">
      <thead>
        <tr>
          <th class="leo-th">Bracket</th>
          <th class="leo-th">Position</th>
          <th class="leo-th">Weekly $</th>
          <th class="leo-th">%</th>
        </tr>
      </thead>
      <tbody>
        {#each thresholds as t}
          <tr>
            <td class="leo-td" style="text-align: left;">${Math.round(t.revenue_bracket_low).toLocaleString()} - ${Math.round(t.revenue_bracket_high).toLocaleString()}</td>
            <td class="leo-td" style="text-align: left;">{t.position}</td>
            <td class="leo-td">${Math.round(t.weekly_labor_dollars).toLocaleString()}</td>
            <td class="leo-td">{t.labor_pct ? (t.labor_pct*100).toFixed(2)+'%' : '-'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {:else}<p class="text-[#9ca3af] text-sm">No thresholds configured.</p>{/if}
  </div>
  {:else if activeTab === 'staffing'}
  <div class="leo-card p-6">
    <h2 class="leo-section-title mb-2">Staffing Limits</h2>
    <p class="text-[#6b7280] text-sm mb-4">Set minimum and maximum headcount per position for this location. The scheduling engine will enforce these bounds when generating shift assignments.</p>
    {#if loadingConstraints}
      <p class="text-[#9ca3af] text-sm">Loading constraints...</p>
    {:else if staffingConstraints.length > 0}
      <div class="overflow-x-auto">
        <table class="w-full leo-table">
          <thead>
            <tr>
              <th class="leo-th" style="text-align: left;">Position</th>
              <th class="leo-th" style="text-align: center;">Min Headcount</th>
              <th class="leo-th" style="text-align: center;">Max Headcount</th>
              <th class="leo-th" style="text-align: center;">Min Hrs/Shift</th>
              <th class="leo-th" style="text-align: center;">Max Hrs/Shift</th>
            </tr>
          </thead>
          <tbody>
            {#each staffingConstraints as c, i}
              <tr>
                <td class="leo-td" style="text-align: left; font-weight: 500;">{c.position}</td>
                <td class="leo-td" style="text-align: center;">
                  <input type="number" min="0" max="50" bind:value={staffingConstraints[i].minHeadcount}
                    class="leo-input w-20 text-center" />
                </td>
                <td class="leo-td" style="text-align: center;">
                  <input type="number" min="0" max="50" bind:value={staffingConstraints[i].maxHeadcount}
                    class="leo-input w-20 text-center" />
                </td>
                <td class="leo-td" style="text-align: center;">
                  <input type="number" min="1" max="12" step="0.5" bind:value={staffingConstraints[i].minHoursPerShift}
                    class="leo-input w-20 text-center" />
                </td>
                <td class="leo-td" style="text-align: center;">
                  <input type="number" min="1" max="16" step="0.5" bind:value={staffingConstraints[i].maxHoursPerShift}
                    class="leo-input w-20 text-center" />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <button onclick={saveStaffingConstraints} disabled={savingConstraints} class="leo-btn mt-4">
        {savingConstraints ? 'Saving...' : 'Save Staffing Limits'}
      </button>
    {:else}
      <p class="text-[#9ca3af] text-sm">No positions configured. Select a location to load defaults.</p>
    {/if}
    {#if constraintMessage}
      <div class="mt-3 p-3 rounded-lg text-sm" style="background: {constraintMessage.includes('Error') ? '#fef2f2; color: #dc2626;' : '#f0fdf4; color: #16a34a;'}">
        {constraintMessage}
      </div>
    {/if}
  </div>
  {:else if activeTab === 'sync'}
  <div class="leo-card p-6">
    <h2 class="leo-section-title mb-4">Toast Sync</h2>
    <p class="text-[#6b7280] text-sm mb-4">Auto sync: 5:00 AM EST and 10:00 PM EST daily for all locations.</p>
    <div class="flex items-center gap-4">
      <button onclick={triggerSync} disabled={toastSyncing} class="leo-btn">{toastSyncing ? 'Syncing...' : 'Sync Now'}</button>
      {#if toastSyncMessage}<span class="text-sm text-[#6b7280]">{toastSyncMessage}</span>{/if}
    </div>
  </div>
  {:else if activeTab === 'dolce'}
  <div class="space-y-6">
    <!-- Dolce Role Mapping -->
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4">Dolce Role Mapping</h2>
      <p class="text-[#6b7280] text-sm mb-4">Map Dolce TeamWork role names to dashboard positions. Set to EXCLUDE to skip roles that should not appear in labor tracking.</p>
      {#if dolceMappings.length > 0}
      <div class="space-y-2 max-h-96 overflow-y-auto">
        {#each dolceMappings as m, i}
          <div class="flex items-center gap-4 py-2" style="border-bottom: 1px solid #e5e7eb;">
            <span class="flex-1 text-sm text-[#1a1a1a]">{m.dolce_role_name}</span>
            <select bind:value={dolceMappings[i].dashboard_position} class="leo-select">
              {#each positions as p}<option value={p}>{p}</option>{/each}
            </select>
          </div>
        {/each}
      </div>
      <button onclick={saveDolceMappings} disabled={savingDolce} class="leo-btn mt-4">{savingDolce ? 'Saving...' : 'Save Dolce Mappings'}</button>
      {:else}
      <p class="text-[#9ca3af] text-sm">No Dolce role mappings found. Mappings are seeded when the Dolce sync runs for the first time, or can be added via SQL.</p>
      {/if}
    </div>

    <!-- Dolce Sync -->
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4">Dolce Schedule Sync</h2>
      <p class="text-[#6b7280] text-sm mb-4">Scheduled labor syncs automatically every Thursday at 1 PM EST via GitHub Actions. You can also trigger a manual sync below.</p>
      <div class="flex items-center gap-4">
        <button onclick={triggerDolceSync} disabled={syncingDolce} class="leo-btn">{syncingDolce ? 'Triggering...' : 'Sync Now'}</button>
        {#if dolceSyncMessage}
          <span class="text-sm text-[#6b7280]">{dolceSyncMessage}</span>
        {/if}
      </div>
      <p class="text-xs text-[#9ca3af] mt-3">The sync scrapes the Dolce Role Analytics report for the current week, maps roles to dashboard positions using the mappings above, and distributes weekly totals to daily using DOW weights.</p>
    </div>
  </div>
  {:else if activeTab === 'resy'}
  <div class="space-y-6">
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4">Resy Reservation Upload</h2>
      <p class="text-[#6b7280] text-sm mb-4">Upload a CSV export from the Resy dashboard to import reservation data. This data feeds into the AI forecast engine as a forward-looking demand signal.</p>
      <p class="text-xs text-[#9ca3af] mb-4">Expected columns: Date, Covers/Party Size, Status (booked/walked-in/no-show/cancelled), Time. Resy API integration coming soon -- upload CSV exports for now.</p>

      <!-- Drop zone -->
      <div
        class="border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer"
        style="border-color: {resyDragOver ? '#1e3a5f' : '#e5e7eb'}; background: {resyDragOver ? '#f0f4f8' : '#fafafa'};"
        role="button"
        tabindex="0"
        ondragover={(e) => { e.preventDefault(); resyDragOver = true; }}
        ondragleave={() => { resyDragOver = false; }}
        ondrop={async (e) => {
          e.preventDefault();
          resyDragOver = false;
          const file = e.dataTransfer?.files[0];
          if (file) await uploadResyCsv(file);
        }}
        onclick={() => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.csv';
          input.onchange = async (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) await uploadResyCsv(file);
          };
          input.click();
        }}
        onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.currentTarget.click(); }}
      >
        {#if resyUploading}
          <p class="text-sm text-[#6b7280]">Uploading...</p>
        {:else}
          <p class="text-sm text-[#374151] font-medium">Drop a Resy CSV here or click to browse</p>
          <p class="text-xs text-[#9ca3af] mt-1">.csv files only</p>
        {/if}
      </div>

      {#if resyUploadMessage}
        <div class="mt-4 p-3 rounded-lg text-sm" style="background: {resyUploadMessage.includes('Error') || resyUploadMessage.includes('error') ? '#fef2f2; color: #dc2626;' : '#f0fdf4; color: #16a34a;'}">
          {resyUploadMessage}
        </div>
      {/if}
    </div>
  </div>
  {:else if activeTab === 'email'}
  <div class="space-y-6">
    <!-- Current Recipients -->
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-2">Email Recipients</h2>
      <p class="text-[#6b7280] text-sm mb-4">Manage who receives the daily KPI insights email for this location. Emails are sent at 5:30 AM EST with a PDF report of the prior day's performance.</p>

      {#if loadingRecipients}
        <p class="text-[#9ca3af] text-sm">Loading recipients...</p>
      {:else if emailRecipients.length > 0}
        <div class="overflow-x-auto">
          <table class="w-full leo-table">
            <thead>
              <tr>
                <th class="leo-th" style="text-align: left;">Email</th>
                <th class="leo-th" style="text-align: left;">Name</th>
                <th class="leo-th" style="text-align: left;">Role</th>
                <th class="leo-th" style="text-align: center;">Daily Email</th>
                <th class="leo-th" style="text-align: center;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each emailRecipients as r}
                <tr>
                  <td class="leo-td" style="text-align: left;">{r.user_email}</td>
                  <td class="leo-td" style="text-align: left;">{r.user_name || '-'}</td>
                  <td class="leo-td" style="text-align: left;">
                    <span class="inline-block px-3 py-1 rounded text-xs font-semibold text-white"
                      style="background: #1e3a5f;">
                      {r.role.charAt(0).toUpperCase() + r.role.slice(1)}
                    </span>
                  </td>
                  <td class="leo-td" style="text-align: center;">
                    <button
                      onclick={() => toggleDailyEmail(r.id, r.receives_daily_email)}
                      class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
                      style="background: {r.receives_daily_email ? '#1e3a5f' : '#d1d5db'};"
                    >
                      <span
                        class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
                        style="transform: translateX({r.receives_daily_email ? '18px' : '3px'});"
                      ></span>
                    </button>
                  </td>
                  <td class="leo-td" style="text-align: center;">
                    <button
                      onclick={() => removeRecipient(r.id)}
                      class="text-xs text-[#dc2626] hover:underline"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="text-[#9ca3af] text-sm">No email recipients configured for this location.</p>
      {/if}

      {#if recipientMessage}
        <div class="mt-3 p-3 rounded-lg text-sm" style="background: {recipientMessage.includes('Error') ? '#fef2f2; color: #dc2626;' : '#f0fdf4; color: #16a34a;'}">
          {recipientMessage}
        </div>
      {/if}
    </div>

    <!-- Add New Recipient -->
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4">Add Recipient</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <div>
          <label class="block text-xs text-[#6b7280] mb-1">Email *</label>
          <input
            type="email"
            bind:value={newRecipientEmail}
            placeholder="user@methodco.com"
            class="leo-input w-full"
          />
        </div>
        <div>
          <label class="block text-xs text-[#6b7280] mb-1">Name</label>
          <input
            type="text"
            bind:value={newRecipientName}
            placeholder="First Last"
            class="leo-input w-full"
          />
        </div>
        <div>
          <label class="block text-xs text-[#6b7280] mb-1">Role</label>
          <select bind:value={newRecipientRole} class="leo-select w-full">
            {#each roles as r}<option value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>{/each}
          </select>
        </div>
      </div>
      <button
        onclick={addRecipient}
        disabled={addingRecipient || !newRecipientEmail}
        class="leo-btn"
      >
        {addingRecipient ? 'Adding...' : 'Add Recipient'}
      </button>
    </div>
  </div>
  {:else if activeTab === 'tripleseat'}
  <div class="leo-card p-6">
    <h2 class="leo-section-title mb-2">Tripleseat Integration</h2>
    <p class="text-[#6b7280] text-sm mb-4">Connect Tripleseat to sync private dining & events data for the PACE report.</p>

    <div class="space-y-4">
      <div>
        <label class="block text-xs text-[#6b7280] mb-1">Consumer Key *</label>
        <input type="text" bind:value={tsConsumerKey} class="leo-input w-full" placeholder="vS81k59x..." />
      </div>
      <div>
        <label class="block text-xs text-[#6b7280] mb-1">Consumer Secret *</label>
        <input type="password" bind:value={tsConsumerSecret} class="leo-input w-full" placeholder="WkoHlfGI..." />
      </div>
      <div>
        <label class="block text-xs text-[#6b7280] mb-1">Site ID (optional)</label>
        <input type="text" bind:value={tsSiteId} class="leo-input w-full" placeholder="Auto-detected if blank" />
      </div>
      <div class="flex items-center gap-3">
        <label class="text-sm text-[#374151]">Enabled</label>
        <button
          onclick={() => tsEnabled = !tsEnabled}
          class="relative inline-flex h-5 w-9 items-center rounded-full transition-colors"
          style="background: {tsEnabled ? '#1e3a5f' : '#d1d5db'};"
        >
          <span
            class="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform"
            style="transform: translateX({tsEnabled ? '18px' : '3px'});"
          ></span>
        </button>
      </div>

      {#if tsConfig?.last_synced_at}
        <div class="text-xs text-[#6b7280]">
          Last synced: {new Date(tsConfig.last_synced_at).toLocaleString()}
        </div>
      {/if}

      {#if tsMessage}
        <div class="p-3 rounded-lg text-sm" style="background: {tsMessage.includes('Error') || tsMessage.includes('fail') ? '#fef2f2; color: #dc2626;' : '#f0fdf4; color: #16a34a;'}">
          {tsMessage}
        </div>
      {/if}

      <div class="flex gap-3 pt-2">
        <button
          onclick={async () => {
            testingTs = true;
            tsMessage = '';
            try {
              const r = await fetch('/api/v1/admin/tripleseat-config?action=test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ consumerKey: tsConsumerKey, consumerSecret: tsConsumerSecret }),
              });
              const d = await r.json();
              tsMessage = d.ok ? `Connected! Found ${d.sites} site(s).` : `Error: ${d.error}`;
            } catch (e) { tsMessage = 'Error: Network error'; }
            finally { testingTs = false; }
          }}
          disabled={testingTs || !tsConsumerKey || !tsConsumerSecret}
          class="px-4 py-2 text-sm border border-[#d1d5db] rounded-lg hover:bg-[#f9fafb] disabled:opacity-50"
        >
          {testingTs ? 'Testing...' : 'Test Connection'}
        </button>
        <button
          onclick={async () => {
            savingTs = true;
            tsMessage = '';
            try {
              const r = await fetch('/api/v1/admin/tripleseat-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  locationId,
                  consumerKey: tsConsumerKey,
                  consumerSecret: tsConsumerSecret,
                  tripleseatSiteId: tsSiteId || null,
                  enabled: tsEnabled,
                }),
              });
              const d = await r.json();
              if (d.ok) {
                tsConfig = d.config;
                tsMessage = 'Saved successfully!';
              } else {
                tsMessage = `Error: ${d.error}`;
              }
            } catch (e) { tsMessage = 'Error: Network error'; }
            finally { savingTs = false; }
          }}
          disabled={savingTs || !tsConsumerKey || !tsConsumerSecret}
          class="px-4 py-2 text-sm bg-[#1e3a5f] text-white rounded-lg hover:bg-[#15304f] disabled:opacity-50"
        >
          {savingTs ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>
    </div>
  </div>
  {/if}
</div>
