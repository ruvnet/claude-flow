<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  type WorkflowItem = {
    id: string;
    type: 'schedule' | 'forecast';
    locationName: string;
    location_id: string;
    title: string;
    status: string;
    submitted_by: string;
    submitted_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_notes: string | null;
    amount: number | null;
    projected: number | null;
    variance: number | null;
    variancePct: number | null;
    week_start_date?: string;
    period_number?: number;
    year?: number;
    week_number?: number;
    manager_notes?: string;
  };

  let userEmail = $state<string | null>(null);
  let canApprove = $state(false);
  let accessToken = $state<string | null>(null);

  let items = $state<WorkflowItem[]>([]);
  let loading = $state(true);
  let statusFilter = $state<'all' | 'pending' | 'reviewed'>('pending');
  let typeFilter = $state<'all' | 'schedule' | 'forecast'>('all');
  let locationFilter = $state<string>('all');

  // Review modal state
  let reviewing = $state<WorkflowItem | null>(null);
  let reviewAction = $state<'approve' | 'deny' | 'revision_requested' | null>(null);
  let reviewNotes = $state('');
  let saving = $state(false);
  let successMsg = $state('');
  let errorMsg = $state('');

  function authHeaders(): Record<string, string> {
    return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      accessToken = session?.access_token ?? null;
      const email = session?.user?.email ?? null;
      userEmail = email;
      if (email) {
        const _roleCtrl = new AbortController(); setTimeout(() => _roleCtrl.abort(), 8000); const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: _roleCtrl.signal });
        if (res.ok) {
          const data = await res.json();
          canApprove = data.permissions?.scheduleApprove ?? false;
        }
        await loadItems();
      } else {
        loading = false;
      }
    });
  });

  async function loadItems() {
    if (!userEmail) return;
    loading = true;
    try {
      const res = await fetch(
        `/api/v1/approval-workflow?email=${encodeURIComponent(userEmail)}&status=${statusFilter}`,
        { headers: authHeaders() },
      );
      if (res.ok) {
        const data = await res.json();
        items = data.items || [];
      } else {
        errorMsg = 'Failed to load submissions';
      }
    } catch (e: any) {
      errorMsg = e.message;
    } finally {
      loading = false;
    }
  }

  // Filtered items
  let filteredItems = $derived(items.filter((item) => {
    if (typeFilter !== 'all' && item.type !== typeFilter) return false;
    if (locationFilter !== 'all' && item.location_id !== locationFilter) return false;
    return true;
  }));

  // Unique locations from items for filter
  let locationOptions = $derived([...new Map(items.map((i) => [i.location_id, i.locationName])).entries()]);

  // Counts
  let pendingCount = $derived(items.filter((i) => i.status === 'submitted').length);
  let scheduleCount = $derived(items.filter((i) => i.type === 'schedule' && i.status === 'submitted').length);
  let forecastCount = $derived(items.filter((i) => i.type === 'forecast' && i.status === 'submitted').length);

  function openReview(item: WorkflowItem, action: 'approve' | 'deny' | 'revision_requested') {
    reviewing = item;
    reviewAction = action;
    reviewNotes = '';
  }

  function closeReview() {
    reviewing = null;
    reviewAction = null;
    reviewNotes = '';
  }

  async function submitReview() {
    if (!reviewing || !reviewAction || !userEmail) return;
    saving = true;
    errorMsg = '';
    try {
      const res = await fetch('/api/v1/approval-workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          action: reviewAction,
          itemId: reviewing.id,
          itemType: reviewing.type,
          locationId: reviewing.location_id,
          reviewedBy: userEmail,
          notes: reviewNotes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { errorMsg = data.error || 'Review failed'; return; }

      successMsg = `${reviewing.type === 'schedule' ? 'Schedule' : 'Forecast'} ${reviewAction === 'approve' ? 'approved' : reviewAction === 'deny' ? 'denied' : 'revision requested'} successfully.`;
      closeReview();
      await loadItems();
      setTimeout(() => { successMsg = ''; }, 4000);
    } catch (e: any) {
      errorMsg = e.message;
    } finally {
      saving = false;
    }
  }

  function statusBadge(status: string) {
    const map: Record<string, { bg: string; color: string; label: string }> = {
      submitted: { bg: '#fef3c7', color: '#92400e', label: 'Pending Review' },
      approved:  { bg: '#dcfce7', color: '#166534', label: 'Approved' },
      denied:    { bg: '#fee2e2', color: '#991b1b', label: 'Denied' },
      revision_requested: { bg: '#ede9fe', color: '#5b21b6', label: 'Revision Needed' },
    };
    return map[status] || { bg: '#f3f4f6', color: '#374151', label: status };
  }

  function typeBadge(type: 'schedule' | 'forecast') {
    return type === 'schedule'
      ? { bg: '#dbeafe', color: '#1d4ed8', label: 'Schedule' }
      : { bg: '#fce7f3', color: '#9d174d', label: 'Forecast' };
  }

  function fmt$(n: number | null | undefined): string {
    if (n == null) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function fmtDateTime(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  const actionLabels: Record<string, { label: string; bg: string; color: string; border: string }> = {
    approve: { label: 'Approve', bg: '#16a34a', color: 'white', border: '#15803d' },
    deny: { label: 'Deny', bg: 'white', color: '#dc2626', border: '#fecaca' },
    revision_requested: { label: 'Request Revision', bg: 'white', color: '#7c3aed', border: '#ddd6fe' },
  };
</script>

<div class="p-3 md:p-4 max-w-6xl">

  <!-- Header -->
  <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
    <div>
      <h1 class="text-xl font-bold" style="color: #1a1a1a;">Approval Workflow</h1>
      <p class="text-sm mt-0.5" style="color: #6b7280;">
        Revenue forecast and schedule submissions awaiting review
      </p>
    </div>
    {#if pendingCount > 0}
      <div class="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-semibold"
        style="background: #fef3c7; color: #92400e; border: 1px solid #fde68a;">
        {pendingCount} pending review
      </div>
    {/if}
  </div>

  <!-- Summary cards -->
  <div class="grid grid-cols-3 gap-3 mb-6">
    <div class="leo-card p-4">
      <p class="text-xs uppercase tracking-wide font-medium mb-1" style="color: #6b7280;">Total Pending</p>
      <p class="text-2xl font-bold" style="color: #1e3a5f;">{pendingCount}</p>
    </div>
    <div class="leo-card p-4">
      <p class="text-xs uppercase tracking-wide font-medium mb-1" style="color: #1d4ed8;">Schedules</p>
      <p class="text-2xl font-bold" style="color: #1d4ed8;">{scheduleCount}</p>
    </div>
    <div class="leo-card p-4">
      <p class="text-xs uppercase tracking-wide font-medium mb-1" style="color: #9d174d;">Forecasts</p>
      <p class="text-2xl font-bold" style="color: #9d174d;">{forecastCount}</p>
    </div>
  </div>

  <!-- Filters -->
  <div class="leo-card p-3 mb-4 flex flex-wrap items-center gap-3">
    <!-- Status filter -->
    <div class="flex rounded-lg overflow-hidden border" style="border-color: #e5e7eb;">
      {#each ['pending', 'reviewed', 'all'] as s}
        <button
          onclick={() => { statusFilter = s as any; loadItems(); }}
          class="px-3 py-1.5 text-xs font-medium transition-colors"
          style="{statusFilter === s
            ? 'background: #1e3a5f; color: white;'
            : 'background: white; color: #6b7280;'}">
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      {/each}
    </div>

    <!-- Type filter -->
    <div class="flex rounded-lg overflow-hidden border" style="border-color: #e5e7eb;">
      {#each [['all','All Types'], ['schedule','Schedules'], ['forecast','Forecasts']] as [val, label]}
        <button
          onclick={() => typeFilter = val as any}
          class="px-3 py-1.5 text-xs font-medium transition-colors"
          style="{typeFilter === val
            ? 'background: #1e3a5f; color: white;'
            : 'background: white; color: #6b7280;'}">
          {label}
        </button>
      {/each}
    </div>

    <!-- Location filter -->
    {#if locationOptions.length > 1}
      <select
        bind:value={locationFilter}
        class="leo-select text-xs py-1.5">
        <option value="all">All Locations</option>
        {#each locationOptions as [id, name]}
          <option value={id}>{name}</option>
        {/each}
      </select>
    {/if}

    <button onclick={loadItems} class="ml-auto text-xs px-3 py-1.5 rounded"
      style="color: #6b7280; border: 1px solid #e5e7eb;">
      ↻ Refresh
    </button>
  </div>

  {#if successMsg}
    <div class="mb-4 p-3 rounded-lg text-sm" style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0;">
      {successMsg}
    </div>
  {/if}
  {#if errorMsg}
    <div class="mb-4 p-3 rounded-lg text-sm" style="background: #fee2e2; color: #dc2626; border: 1px solid #fecaca;">
      {errorMsg}
      <button onclick={() => errorMsg = ''} class="ml-2 underline text-xs">dismiss</button>
    </div>
  {/if}

  <!-- Submissions list -->
  {#if loading}
    <div class="leo-card p-8 text-center">
      <p class="text-sm" style="color: #9ca3af;">Loading submissions...</p>
    </div>
  {:else if filteredItems.length === 0}
    <div class="leo-card p-8 text-center">
      <svg class="w-10 h-10 mx-auto mb-3" style="color: #d1d5db;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p class="text-sm font-medium" style="color: #374151;">
        {statusFilter === 'pending' ? 'No pending submissions' : 'No submissions found'}
      </p>
      <p class="text-xs mt-1" style="color: #9ca3af;">
        {statusFilter === 'pending' ? 'All caught up! Check back later.' : 'Try adjusting the filters above.'}
      </p>
    </div>
  {:else}
    <div class="space-y-3">
      {#each filteredItems as item (item.id)}
        {@const badge = statusBadge(item.status)}
        {@const tBadge = typeBadge(item.type)}
        {@const isPending = item.status === 'submitted'}
        <div class="leo-card overflow-hidden"
          style="{isPending ? 'border-left: 4px solid #f59e0b;' : 'border-left: 4px solid #e5e7eb;'}">
          <div class="p-4">
            <div class="flex flex-col sm:flex-row sm:items-start gap-3">
              <!-- Left: info -->
              <div class="flex-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2 mb-1">
                  <span class="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                    style="background: {tBadge.bg}; color: {tBadge.color};">
                    {tBadge.label}
                  </span>
                  <span class="text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style="background: {badge.bg}; color: {badge.color};">
                    {badge.label}
                  </span>
                  <span class="text-sm font-semibold" style="color: #1a1a1a;">{item.locationName}</span>
                </div>
                <p class="text-sm font-medium" style="color: #374151;">{item.title}</p>

                <div class="flex flex-wrap gap-x-4 gap-y-0.5 mt-2 text-xs" style="color: #6b7280;">
                  <span>Submitted by <strong style="color:#374151;">{item.submitted_by}</strong></span>
                  <span>{fmtDateTime(item.submitted_at)}</span>
                  {#if item.type === 'schedule' && item.week_start_date}
                    <span>Week of {fmtDate(item.week_start_date)}</span>
                  {/if}
                </div>

                {#if item.type === 'forecast' && item.manager_notes}
                  <p class="text-xs mt-1 italic" style="color: #6b7280;">"{item.manager_notes}"</p>
                {/if}
              </div>

              <!-- Right: amounts -->
              <div class="flex-shrink-0 text-right">
                {#if item.amount != null}
                  <p class="text-lg font-bold" style="color: #1e3a5f;">{fmt$(item.amount)}</p>
                  {#if item.type === 'schedule' && item.projected != null}
                    <p class="text-xs" style="color: #6b7280;">vs {fmt$(item.projected)} projected</p>
                    {#if item.variance != null}
                      {@const isOver = item.variance > 0}
                      <p class="text-xs font-semibold" style="color: {isOver ? '#dc2626' : '#16a34a'};">
                        {isOver ? '+' : ''}{fmt$(item.variance)} ({item.variancePct != null ? (item.variancePct * 100).toFixed(1) : '0.0'}%)
                      </p>
                    {/if}
                  {/if}
                {/if}
              </div>
            </div>

            <!-- Review info (if reviewed) -->
            {#if item.reviewed_by}
              <div class="mt-3 pt-3 border-t" style="border-color: #f3f4f6;">
                <p class="text-xs" style="color: #6b7280;">
                  Reviewed by <strong style="color:#374151;">{item.reviewed_by}</strong>
                  on {fmtDateTime(item.reviewed_at)}
                  {#if item.review_notes} — "{item.review_notes}"{/if}
                </p>
              </div>
            {/if}

            <!-- Actions (pending items only, approvers only) -->
            {#if isPending && canApprove}
              <div class="flex flex-wrap gap-2 mt-3 pt-3 border-t" style="border-color: #f3f4f6;">
                {#each [['approve','Approve'],['revision_requested','Request Revision'],['deny','Deny']] as [act, lbl]}
                  {@const style = act === 'approve'
                    ? 'background:#16a34a;color:white;border-color:#15803d;'
                    : act === 'deny'
                    ? 'background:white;color:#dc2626;border-color:#fecaca;'
                    : 'background:white;color:#7c3aed;border-color:#ddd6fe;'}
                  <button
                    onclick={() => openReview(item, act as any)}
                    class="px-4 py-1.5 text-xs font-semibold rounded border transition-opacity hover:opacity-80"
                    style={style}>
                    {lbl}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Review Modal -->
{#if reviewing && reviewAction}
  {@const aStyle = actionLabels[reviewAction] ?? { label: reviewAction, bg: '#1e3a5f', color: 'white', border: '#1e3a5f' }}
  <div class="fixed inset-0 z-50 flex items-center justify-center p-4"
    style="background: rgba(0,0,0,0.5);"
    onclick={(e) => { if (e.target === e.currentTarget) closeReview(); }}>
    <div class="leo-card w-full max-w-md p-5" role="dialog" aria-modal="true">
      <h2 class="text-base font-bold mb-1" style="color: #1a1a1a;">{aStyle.label}</h2>
      <p class="text-sm mb-4" style="color: #6b7280;">
        {reviewing.locationName} — {reviewing.title}
      </p>

      <label class="block text-xs font-medium mb-1" style="color: #374151;">
        Notes {reviewAction === 'revision_requested' ? '(required — describe what needs to change)' : '(optional)'}
      </label>
      <textarea
        bind:value={reviewNotes}
        rows="3"
        placeholder="Add a note for the submitter..."
        class="w-full leo-select text-sm resize-none"
        style="min-height: 80px;">
      </textarea>

      <div class="flex gap-2 mt-4">
        <button
          onclick={submitReview}
          disabled={saving || (reviewAction === 'revision_requested' && !reviewNotes.trim())}
          class="flex-1 py-2 text-sm font-semibold rounded border transition-opacity hover:opacity-80 disabled:opacity-50"
          style="background: {aStyle.bg}; color: {aStyle.color}; border-color: {aStyle.border};">
          {saving ? 'Saving...' : aStyle.label}
        </button>
        <button onclick={closeReview} class="px-4 py-2 text-sm rounded" style="color: #6b7280; border: 1px solid #e5e7eb;">
          Cancel
        </button>
      </div>

      {#if errorMsg}
        <p class="text-xs mt-2" style="color: #dc2626;">{errorMsg}</p>
      {/if}
    </div>
  </div>
{/if}
