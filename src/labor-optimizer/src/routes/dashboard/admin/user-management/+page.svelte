<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';
  import {
    ALL_PLANNING_TABS, ALL_ADMIN_TABS,
  } from '$lib/roles';

  // ---- Tab definition maps ----
  const TAB_LABELS: Record<string, string> = {
    // Reporting
    dashboard: 'Dashboard', labor_detail: 'Labor Detail', insights: 'Insights',
    guest_analytics: 'Guest Analytics', events: 'Events',
    // Executive Reporting
    executive_summary: 'Executive Summary', location_comparison: 'Location Comparison',
    monthly_report: 'Monthly Report',
    // Planning
    forecast: 'Forecast', staffing: 'Staffing',
    schedule_builder: 'Schedule Builder', schedule_approval: 'Schedule Approval',
    approval_workflow: 'Approval Workflow',
    // Admin
    user_management: 'User Management', employees: 'Employees',
    forecast_accuracy: 'Forecast Accuracy', engine_audit: 'Engine Audit',
    competitive_set: 'Competitive Set', settings: 'Settings',
    labor_questionnaire: 'Labor Questionnaire', guiding_principles: 'Guiding Principles',
    data_sources: 'Data Sources',
  };

  type TabPerms = { reporting: string[]; planning: string[]; admin: string[] };

  // 4 visual sections — Reporting & Executive Reporting both map to the 'reporting' key
  const CATEGORIES: { key: keyof TabPerms; label: string; color: string; tabs: readonly string[] }[] = [
    {
      key: 'reporting', label: 'REPORTING', color: '#1e3a5f',
      tabs: ['dashboard', 'labor_detail', 'insights', 'guest_analytics', 'events'] as const,
    },
    {
      key: 'reporting', label: 'EXECUTIVE REPORTING', color: '#1d4ed8',
      tabs: ['executive_summary', 'location_comparison', 'monthly_report'] as const,
    },
    { key: 'planning', label: 'PLANNING', color: '#92400e', tabs: ALL_PLANNING_TABS },
    { key: 'admin',   label: 'ADMIN',    color: '#7c3aed', tabs: ALL_ADMIN_TABS },
  ];

  // ---- State ----
  let isAdmin = $state(false);
  let isSuperAdmin = $state(false);
  let authChecked = $state(false);
  let loading = $state(true);
  let error = $state('');
  let successMsg = $state('');
  let groups = $state<any[]>([]);
  let unassignedUsers = $state<{ id: string; email: string; created_at: string; last_sign_in_at: string | null }[]>([]);
  let locations = $state<{ id: string; name: string }[]>([]);
  let saving = $state(false);
  let resettingEmail = $state<string | null>(null);

  // Assign unassigned user state
  let assigningUserId = $state<string | null>(null);
  let assignGroupId = $state('');

  // Expand/collapse state for permission sections per group
  let expandedPerms = $state<Record<string, boolean>>({});

  // Edit group state
  let editingGroupId = $state<string | null>(null);
  let editName = $state('');
  let editDescription = $state('');
  let editTabPerms = $state<TabPerms>({ reporting: [], planning: [], admin: [] });

  // Add member state
  let addingToGroupId = $state<string | null>(null);
  let memberEmail = $state('');
  let memberName = $state('');
  let memberLocationIds = $state<string[]>([]);
  let createNewUser = $state(false);
  let newUserPassword = $state('');

  // Create group state
  let showCreateGroup = $state(false);
  let newGroupName = $state('');
  let newGroupDescription = $state('');
  let newGroupTabPerms = $state<TabPerms>({ reporting: [], planning: [], admin: [] });

  // ---- Auth check ----
  let accessToken = $state<string | null>(null);

  function authHeaders(): Record<string, string> {
    return accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {};
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      accessToken = session?.access_token ?? null;
      const email = session?.user?.email ?? null;
      if (email) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 8000);
          const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: controller.signal });
          clearTimeout(timeout);
          if (res.ok) {
            const data = await res.json();
            const tp = data.tabPermissions;
            isAdmin = tp?.admin?.includes('user_management') || data.permissions?.admin || false;
            isSuperAdmin = data.role === 'super_admin';
          }
        } catch { isAdmin = false; }
      }
      authChecked = true;
      if (!isAdmin) { goto('/dashboard'); return; }
      loadAll();
    });
  });

  async function loadAll() {
    loading = true; error = '';
    try {
      const [grpRes, locRes] = await Promise.all([
        fetch('/api/v1/admin/user-management', { headers: authHeaders() }),
        fetch('/api/v1/locations'),
      ]);
      if (!grpRes.ok) { error = (await grpRes.json()).error || 'Failed to load groups'; return; }
      const grpData = await grpRes.json();
      groups = grpData.groups || [];
      unassignedUsers = grpData.unassignedUsers || [];
      locations = (await locRes.json()).locations || [];
    } catch (e: any) { error = e.message; }
    finally { loading = false; }
  }

  async function apiPost(body: Record<string, unknown>) {
    saving = true; error = '';
    try {
      const res = await fetch('/api/v1/admin/user-management', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { error = data.error || 'Request failed'; return null; }
      return data;
    } catch (e: any) { error = e.message; return null; }
    finally { saving = false; }
  }

  // ---- Tab permission helpers ----
  const emptyPerms = (): TabPerms => ({ reporting: [], planning: [], admin: [] });
  function getGroupTabPerms(group: any): TabPerms {
    const tp = group.tab_permissions;
    if (!tp || typeof tp !== 'object') return emptyPerms();
    return { reporting: Array.isArray(tp.reporting) ? tp.reporting : [], planning: Array.isArray(tp.planning) ? tp.planning : [], admin: Array.isArray(tp.admin) ? tp.admin : [] };
  }

  function toggleTab(perms: TabPerms, cat: keyof TabPerms, tab: string): TabPerms {
    const arr = [...perms[cat]]; const idx = arr.indexOf(tab);
    if (idx >= 0) arr.splice(idx, 1); else arr.push(tab);
    return { ...perms, [cat]: arr };
  }
  // Toggle only the tabs in THIS section — never touches other sections in the same category
  function toggleAllInSection(perms: TabPerms, cat: keyof TabPerms, sectionTabs: readonly string[]): TabPerms {
    const current = [...perms[cat]];
    const allSelected = sectionTabs.every(t => current.includes(t));
    return {
      ...perms,
      [cat]: allSelected
        ? current.filter(t => !sectionTabs.includes(t))           // deselect section tabs only
        : [...current, ...sectionTabs.filter(t => !current.includes(t))], // add missing
    };
  }
  function allInSectionSelected(perms: TabPerms, cat: keyof TabPerms, sectionTabs: readonly string[]): boolean {
    return sectionTabs.length > 0 && sectionTabs.every(t => perms[cat].includes(t));
  }
  function countTabPerms(tp: TabPerms): number { return tp.reporting.length + tp.planning.length + tp.admin.length; }

  // ---- Group CRUD ----
  function startEditGroup(group: any) { editingGroupId = group.id; editName = group.name; editDescription = group.description || ''; editTabPerms = getGroupTabPerms(group); }
  function cancelEditGroup() { editingGroupId = null; }

  async function saveEditGroup() {
    const result = await apiPost({
      action: 'update_group', groupId: editingGroupId,
      name: editName, description: editDescription, tab_permissions: editTabPerms,
    });
    if (result) { editingGroupId = null; await loadAll(); }
  }

  async function deleteGroup(groupId: string, groupName: string) {
    if (!confirm(`Delete group "${groupName}" and all its members?`)) return;
    const result = await apiPost({ action: 'delete_group', groupId });
    if (result) await loadAll();
  }

  // ---- Member CRUD ----
  function startAddMember(groupId: string) { addingToGroupId = groupId; memberEmail = ''; memberName = ''; memberLocationIds = []; createNewUser = false; newUserPassword = ''; }
  function cancelAddMember() { addingToGroupId = null; }
  async function submitAddMember() {
    if (!addingToGroupId) return;
    if (createNewUser && !newUserPassword) { error = 'Password is required when creating a new user'; return; }
    const payload = createNewUser
      ? { action: 'create_user', email: memberEmail, password: newUserPassword, name: memberName, groupId: addingToGroupId, locationIds: memberLocationIds }
      : { action: 'add_member', groupId: addingToGroupId, email: memberEmail, name: memberName, locationIds: memberLocationIds };
    const result = await apiPost(payload);
    if (result) { addingToGroupId = null; await loadAll(); }
  }
  async function removeMember(memberId: string, mName: string) {
    if (!confirm(`Remove ${mName || 'this member'} from the group?`)) return;
    const result = await apiPost({ action: 'remove_member', memberId }); if (result) await loadAll();
  }

  // ---- Create Group ----
  function startCreateGroup() { showCreateGroup = true; newGroupName = ''; newGroupDescription = ''; newGroupTabPerms = { reporting: [], planning: [], admin: [] }; }
  function cancelCreateGroup() { showCreateGroup = false; }

  async function submitCreateGroup() {
    if (!newGroupName.trim()) { error = 'Group name is required'; return; }
    const result = await apiPost({
      action: 'create_group', name: newGroupName.trim(),
      description: newGroupDescription.trim(), tab_permissions: newGroupTabPerms,
    });
    if (result) { showCreateGroup = false; await loadAll(); }
  }

  // ---- Move member ----
  let movingMemberId = $state<string | null>(null);
  let movingFromGroupId = $state<string | null>(null);
  function startMove(memberId: string, fromGroupId: string) { movingMemberId = memberId; movingFromGroupId = fromGroupId; }
  function cancelMove() { movingMemberId = null; movingFromGroupId = null; }
  async function moveMember(toGroupId: string, mName: string, toGroupName: string) {
    if (!movingMemberId || !movingFromGroupId) return;
    if (!confirm(`Move ${mName || 'this member'} to ${toGroupName}?`)) return;
    const result = await apiPost({ action: 'move_member', memberId: movingMemberId, fromGroupId: movingFromGroupId, toGroupId });
    if (result) { cancelMove(); await loadAll(); }
  }

  // ---- Location toggle state ----
  const SHORT_NAMES: Record<string, string> = {
    'Lowland': 'LOW', 'Le Supreme & Bar Rotunda': 'LSB',
    "Wm. Mulherin's Sons": 'WMS', 'The Quoin': 'QUN',
    'HIROKI-SAN Detroit': 'HSD', "Kamper's": 'KMP',
    'HIROKI Philadelphia': 'HSP', 'Little Wing': 'LWG',
    'Vessel': 'VSL', 'Rosemary Rose': 'RMR', 'Anthology': 'ANT',
  };
  let togglingKey = $state<string | null>(null);
  let savedFlash = $state<string | null>(null);

  function shortName(loc: { id: string; name: string }): string {
    return SHORT_NAMES[loc.name] || loc.name.slice(0, 3).toUpperCase();
  }

  async function toggleLocation(memberId: string, locationId: string, assign: boolean) {
    const key = `${memberId}-${locationId}`;
    togglingKey = key;
    try {
      const res = await fetch('/api/v1/admin/user-management', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'toggle_location', memberId, locationId, assign }),
      });
      const data = await res.json();
      if (!res.ok) { error = data.error || 'Toggle failed'; return; }
      // Update local state without full reload
      for (const g of groups) {
        const m = g.members?.find((mem: any) => mem.id === memberId);
        if (m) { m.location_ids = data.location_ids; break; }
      }
      groups = [...groups]; // trigger reactivity
      savedFlash = key;
      setTimeout(() => { if (savedFlash === key) savedFlash = null; }, 1200);
    } catch (e: any) { error = e.message; }
    finally { togglingKey = null; }
  }

  // ---- Helpers ----
  function locationName(id: string): string {
    return locations.find((l) => l.id === id)?.name || id.slice(0, 8);
  }

  function getUserStatus(member: any): { label: string; color: string; bg: string } {
    const auth = member.auth_status;
    if (!auth) return { label: 'Unknown', color: '#6b7280', bg: '#f3f4f6' };
    if (auth.banned_until && new Date(auth.banned_until) > new Date())
      return { label: 'Locked', color: '#dc2626', bg: '#fee2e2' };
    if (!auth.email_confirmed_at)
      return { label: 'Invited', color: '#2563eb', bg: '#dbeafe' };
    return { label: 'Active', color: '#16a34a', bg: '#dcfce7' };
  }

  function toggleList(list: string[], item: string): string[] {
    return list.includes(item) ? list.filter((i) => i !== item) : [...list, item];
  }

  async function assignUnassignedUser(user: { id: string; email: string }) {
    if (!assignGroupId) { error = 'Select a group first'; return; }
    const result = await apiPost({
      action: 'add_member', groupId: assignGroupId,
      email: user.email, name: '',
    });
    if (result) { assigningUserId = null; assignGroupId = ''; await loadAll(); }
  }

  async function resetPassword(email: string) {
    if (!confirm(`Send a password reset email to ${email}?`)) return;
    resettingEmail = email; error = ''; successMsg = '';
    try {
      const res = await fetch('/api/v1/admin/user-management', {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ action: 'reset_password', email }),
      });
      const data = await res.json();
      if (!res.ok) { error = data.error || 'Failed'; return; }
      successMsg = data.message || `Reset sent to ${email}`;
      setTimeout(() => successMsg = '', 5000);
    } catch (e: any) { error = e.message; }
    finally { resettingEmail = null; }
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
    <div class="mb-6">
      <h1 class="text-xl font-bold" style="color: #1a1a1a;">User Management</h1>
      <p class="text-sm mt-1" style="color: #6b7280;">Manage groups, tab permissions, and member location assignments</p>
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
        <button onclick={() => successMsg = ''} class="ml-2 underline text-xs">dismiss</button>
      </div>
    {/if}

    {#snippet tabPermEditor(perms: TabPerms, setPerms: (p: TabPerms) => void)}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {#each CATEGORIES as cat}
          <div>
            <div class="flex items-center gap-2 px-3 py-1.5 rounded-t" style="background:{cat.color};">
              <label class="flex items-center gap-2 cursor-pointer flex-1">
                <input type="checkbox" class="w-4 h-4 rounded" style="accent-color:#16a34a;"
                  checked={allInSectionSelected(perms, cat.key, cat.tabs)}
                  onchange={() => setPerms(toggleAllInSection(perms, cat.key, cat.tabs))} />
                <span class="text-[11px] font-bold tracking-widest text-white uppercase">{cat.label}</span>
              </label>
              <span class="text-[10px]" style="color:rgba(255,255,255,0.5);">Select All</span>
            </div>
            <div class="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 rounded-b" style="background:#f8fafc;border:1px solid #e5e7eb;border-top:none;min-height:40px;">
              {#each cat.tabs as tab}
                <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none py-0.5">
                  <input type="checkbox" class="w-3.5 h-3.5 rounded" style="accent-color:#16a34a;"
                    checked={perms[cat.key].includes(tab)}
                    onchange={() => setPerms(toggleTab(perms, cat.key, tab))} />
                  <span style="color:#374151;">{TAB_LABELS[tab] || tab}</span>
                </label>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    {/snippet}

    {#if loading}
      <div class="leo-card p-8 text-center">
        <p class="text-sm" style="color: #9ca3af;">Loading groups...</p>
      </div>
    {:else}
      {#if unassignedUsers.length > 0}
        <div class="leo-card mb-4 overflow-hidden" style="border-left: 4px solid #f59e0b;">
          <div class="flex items-center gap-2 p-4" style="background: #fffbeb; border-bottom: 1px solid #fde68a;">
            <svg class="w-5 h-5 flex-shrink-0" style="color:#d97706;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
            <span class="text-sm font-semibold" style="color:#92400e;">{unassignedUsers.length} registered user{unassignedUsers.length !== 1 ? 's' : ''} not assigned to any group</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full"><thead><tr style="background:#1e3a5f;">
              <th class="leo-th text-left" style="width:30%;color:#fff;">Email</th>
              <th class="leo-th text-left" style="width:20%;color:#fff;">Created</th>
              <th class="leo-th text-left" style="width:20%;color:#fff;">Last Sign-In</th>
              <th class="leo-th text-right" style="width:30%;color:#fff;">Actions</th>
            </tr></thead><tbody>
              {#each unassignedUsers as user (user.id)}
                <tr class="hover:bg-[#f8f9fa]">
                  <td class="leo-td text-left" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">{user.email}</td>
                  <td class="leo-td text-left text-xs" style="color:#6b7280;">{user.created_at ? new Date(user.created_at).toLocaleDateString() : '-'}</td>
                  <td class="leo-td text-left text-xs" style="color:#6b7280;">{user.last_sign_in_at ? new Date(user.last_sign_in_at).toLocaleDateString() : 'Never'}</td>
                  <td class="leo-td text-right">
                    {#if assigningUserId === user.id}
                      <div class="flex items-center justify-end gap-2">
                        <select class="leo-select text-xs py-1" bind:value={assignGroupId}><option value="">Select group...</option>{#each groups as g}<option value={g.id}>{g.name}</option>{/each}</select>
                        <button class="leo-btn text-xs" onclick={() => assignUnassignedUser(user)} disabled={saving || !assignGroupId}>{saving ? '...' : 'Assign'}</button>
                        <button class="text-xs" style="color:#6b7280;" onclick={() => { assigningUserId = null; assignGroupId = ''; }}>Cancel</button>
                      </div>
                    {:else}
                      <button class="leo-btn-secondary text-xs" onclick={() => { assigningUserId = user.id; assignGroupId = ''; }}>Assign to Group</button>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody></table>
          </div>
        </div>
      {/if}

      {#each groups as group (group.id)}
        {@const tp = getGroupTabPerms(group)}
        {@const permCount = countTabPerms(tp)}
        {@const permExpanded = expandedPerms[group.id] ?? false}
        <div class="leo-card mb-4 overflow-hidden">
          <!-- Group Header -->
          <div class="p-4" style="border-bottom: 1px solid #e5e7eb;">
            {#if editingGroupId === group.id}
              <!-- Editing mode -->
              <div class="space-y-3">
                <div class="flex gap-3">
                  <input type="text" bind:value={editName} class="leo-select flex-1" placeholder="Group name" />
                  <input type="text" bind:value={editDescription} class="leo-select flex-1" placeholder="Description" />
                </div>
                {@render tabPermEditor(editTabPerms, (p) => editTabPerms = p)}
                <div class="flex items-center gap-3 flex-wrap">
                  <button class="leo-btn text-xs" onclick={saveEditGroup} disabled={saving}>
                    {saving ? 'Saving...' : 'Save Permissions'}
                  </button>
                  <button class="leo-btn-secondary text-xs" onclick={cancelEditGroup}>Cancel</button>
                  <span class="text-[11px]" style="color:#6b7280;">
                    ✓ Changes apply instantly to all {group.members?.length || 0} member{(group.members?.length || 0) !== 1 ? 's' : ''} in this group
                  </span>
                </div>
              </div>
            {:else}
              <div class="flex items-start justify-between">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h2 class="text-base font-semibold" style="color:#1a1a1a;">{group.name}</h2>
                    <span class="text-[11px] px-2 py-0.5 rounded-full font-medium" style="background:#f3f4f6;color:#6b7280;">{group.members?.length || 0} member{(group.members?.length || 0) !== 1 ? 's' : ''}</span>
                    <span class="text-[11px] px-2 py-0.5 rounded-full font-medium" style="background:#dcfce7;color:#16a34a;">{permCount} tab{permCount !== 1 ? 's' : ''}</span>
                  </div>
                  {#if group.description}<p class="text-xs mt-0.5" style="color:#6b7280;">{group.description}</p>{/if}
                </div>
                <div class="flex gap-2 flex-shrink-0 ml-3">
                  <button class="leo-btn-secondary text-xs" onclick={() => expandedPerms[group.id] = !permExpanded}>{permExpanded ? 'Hide Tabs' : 'Show Tabs'}</button>
                  <button class="leo-btn-secondary text-xs" onclick={() => startEditGroup(group)}>Edit</button>
                  <button class="text-xs px-3 py-1.5 rounded" style="color:#dc2626;border:1px solid #fecaca;" onclick={() => deleteGroup(group.id, group.name)}>Delete</button>
                </div>
              </div>
              {#if !permExpanded}
                {@const cs = [{tabs: tp.reporting, bg:'#dbeafe', c:'#1d4ed8'}, {tabs: tp.planning, bg:'#fef3c7', c:'#92400e'}, {tabs: tp.admin, bg:'#fce7f3', c:'#9d174d'}]}
                <div class="flex flex-wrap gap-1 mt-2">
                  {#each cs as s}{#each s.tabs as tab}<span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium" style="background:{s.bg};color:{s.c};">{TAB_LABELS[tab] || tab}</span>{/each}{/each}
                </div>
              {:else}
                <div class="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {#each CATEGORIES as cat}
                    <div>
                      <div class="px-3 py-1 rounded-t" style="background:{cat.color};"><span class="text-[11px] font-bold tracking-widest text-white uppercase">{cat.label}</span></div>
                      <div class="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 rounded-b" style="background:#f8fafc;border:1px solid #e5e7eb;border-top:none;min-height:32px;">
                        {#each cat.tabs as tab}{@const has = tp[cat.key].includes(tab)}<div class="flex items-center gap-1.5 text-xs py-0.5"><span class="inline-block w-3.5 h-3.5 rounded {has ? 'text-center leading-[14px] text-[10px] font-bold' : 'border'}" style="{has ? 'background:#16a34a;color:white;' : 'border-color:#d1d5db;'}">{has ? '\u2713' : ''}</span><span style="color:{has ? '#374151' : '#9ca3af'};">{TAB_LABELS[tab] || tab}</span></div>{/each}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>

          <!-- Members Table -->
          <div class="overflow-x-auto">
            {#if group.members && group.members.length > 0}
              <table class="w-full" style="table-layout: fixed;">
                <thead>
                  <tr style="background: #1e3a5f;">
                    <th class="leo-th text-left" style="width: 14%; color: #fff;">Name</th>
                    <th class="leo-th text-left" style="width: 18%; color: #fff;">Email</th>
                    <th class="leo-th text-left" style="width: 6%; color: #fff;">Status</th>
                    <th class="leo-th text-left" style="width: 42%; color: #fff;">Locations</th>
                    <th class="leo-th text-right" style="width: 20%; color: #fff;">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {#each group.members as member (member.id)}
                    {@const status = getUserStatus(member)}
                    <tr class="hover:bg-[#f8f9fa]">
                      <td class="leo-td text-left" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        {member.user_name || '-'}
                      </td>
                      <td class="leo-td text-left" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                        {member.user_email}
                      </td>
                      <td class="leo-td text-left">
                        <span class="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium"
                          style="background: {status.bg}; color: {status.color};">
                          {status.label}
                        </span>
                      </td>
                      <td class="leo-td text-left">
                        <div class="flex flex-wrap gap-x-1 gap-y-0.5">
                          {#each locations as loc}
                            {@const checked = member.location_ids?.includes(loc.id) ?? false}
                            {@const tKey = `${member.id}-${loc.id}`}
                            {@const isToggling = togglingKey === tKey}
                            {@const justSaved = savedFlash === tKey}
                            <button
                              class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium transition-all duration-150 border cursor-pointer disabled:opacity-50"
                              style="background:{checked ? '#1e3a5f' : '#f3f4f6'};color:{checked ? 'white' : '#6b7280'};border-color:{checked ? '#1e3a5f' : '#d1d5db'};{justSaved ? 'outline:2px solid #16a34a;outline-offset:1px;' : ''}"
                              disabled={isToggling}
                              onclick={() => toggleLocation(member.id, loc.id, !checked)}
                              title={loc.name}
                            >
                              <span class="inline-block w-3 h-3 rounded-sm text-center leading-3 text-[8px] font-bold flex-shrink-0" style="background:{checked ? 'rgba(255,255,255,0.25)' : '#e5e7eb'};">{checked ? '\u2713' : ''}</span>
                              {shortName(loc)}{#if justSaved}<span class="text-[8px] ml-0.5" style="color:{checked ? '#bbf7d0' : '#16a34a'};">Saved</span>{/if}
                            </button>
                          {/each}
                        </div>
                      </td>
                      <td class="leo-td text-right">
                        <div class="flex items-center justify-end gap-2 flex-wrap">
                          {#if isSuperAdmin}
                            <button class="text-xs px-2 py-1 rounded font-medium transition-colors"
                              style="background:#7c3aed;color:white;border:1px solid #6d28d9;"
                              title="View site as this user"
                              onclick={() => {
                                localStorage.setItem('helixo_ghost_email', member.user_email);
                                window.dispatchEvent(new CustomEvent('helixo-ghost-set', { detail: { email: member.user_email } }));
                                goto('/dashboard');
                              }}>
                              👻 View as
                            </button>
                          {/if}
                          {#if isSuperAdmin}<button class="text-xs px-2 py-1 rounded" style="color:#1e3a5f;border:1px solid #cbd5e1;" disabled={resettingEmail === member.user_email} onclick={() => resetPassword(member.user_email)}>{resettingEmail === member.user_email ? 'Sending...' : 'Reset PW'}</button>{/if}
                          {#if movingMemberId === member.id}
                            <select class="leo-select text-xs py-1" onchange={(e) => { const val = e.currentTarget.value; if (val) { const tg = groups.find((g) => g.id === val); moveMember(val, member.user_name, tg?.name || 'group'); } e.currentTarget.value = ''; }}>
                              <option value="">Select group...</option>
                              {#each groups.filter((g) => g.id !== group.id) as og}<option value={og.id}>{og.name}</option>{/each}
                            </select>
                            <button class="text-xs" style="color:#6b7280;" onclick={cancelMove}>Cancel</button>
                          {:else}
                            <button class="text-xs px-2 py-1 rounded" style="color:#1e3a5f;border:1px solid #cbd5e1;" onclick={() => startMove(member.id, group.id)}>Move</button>
                          {/if}
                          <button class="text-xs underline" style="color:#dc2626;" onclick={() => removeMember(member.id, member.user_name)}>Remove</button>
                        </div>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {:else}
              <div class="p-4 text-center"><p class="text-xs" style="color:#9ca3af;">No members in this group</p></div>
            {/if}
          </div>

          <div class="p-4" style="border-top: 1px solid #e5e7eb;">
            {#if addingToGroupId === group.id}
              <div class="space-y-3">
                <div class="flex gap-3 flex-wrap">
                  <input type="email" bind:value={memberEmail} class="leo-select" style="min-width:200px;" placeholder="Email address" />
                  <input type="text" bind:value={memberName} class="leo-select" style="min-width:160px;" placeholder="Full name" />
                </div>
                <p class="text-xs font-medium mb-1" style="color:#374151;">Assign Locations</p>
                <div class="flex flex-wrap gap-2">
                  {#each locations as loc}
                    {@const sel = memberLocationIds.includes(loc.id)}
                    <label class="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2 py-1 rounded" style="background:{sel ? '#1e3a5f' : '#f3f4f6'};color:{sel ? 'white' : '#374151'};">
                      <input type="checkbox" class="sr-only" checked={sel} onchange={() => memberLocationIds = toggleList(memberLocationIds, loc.id)} />{loc.name}
                    </label>
                  {/each}
                </div>
                <p class="text-[11px]" style="color:#9ca3af;">Leave empty for access to all locations</p>
                <label class="flex items-center gap-2 text-xs cursor-pointer" style="color:#374151;">
                  <input type="checkbox" bind:checked={createNewUser} class="rounded" style="accent-color:#1e3a5f;" /> Create new auth user (if email doesn't exist yet)
                </label>
                {#if createNewUser}<input type="password" bind:value={newUserPassword} class="leo-select" style="min-width:200px;" placeholder="Password for new user" />{/if}
                <div class="flex gap-2">
                  <button class="leo-btn text-xs" onclick={submitAddMember} disabled={saving || !memberEmail}>{saving ? 'Adding...' : createNewUser ? 'Create User & Add' : 'Add Member'}</button>
                  <button class="leo-btn-secondary text-xs" onclick={cancelAddMember}>Cancel</button>
                </div>
              </div>
            {:else}
              <button class="leo-btn-secondary text-xs" onclick={() => startAddMember(group.id)}>+ Add Member</button>
            {/if}
          </div>
        </div>
      {/each}

      {#if showCreateGroup}
        <div class="leo-card mb-4 p-4">
          <h3 class="text-sm font-semibold mb-3" style="color:#1a1a1a;">Create New Group</h3>
          <div class="space-y-3">
            <div class="flex gap-3">
              <input type="text" bind:value={newGroupName} class="leo-select flex-1" placeholder="Group name" />
              <input type="text" bind:value={newGroupDescription} class="leo-select flex-1" placeholder="Description" />
            </div>
            {@render tabPermEditor(newGroupTabPerms, (p) => newGroupTabPerms = p)}
            <div class="flex gap-2">
              <button class="leo-btn text-xs" onclick={submitCreateGroup} disabled={saving || !newGroupName.trim()}>{saving ? 'Creating...' : 'Create Group'}</button>
              <button class="leo-btn-secondary text-xs" onclick={cancelCreateGroup}>Cancel</button>
            </div>
          </div>
        </div>
      {:else}
        <button class="leo-btn text-sm" onclick={startCreateGroup}>+ Create New Group</button>
      {/if}
    {/if}
  </div>
{/if}
