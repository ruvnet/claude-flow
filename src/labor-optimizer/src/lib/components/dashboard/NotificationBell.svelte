<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  interface Notification {
    id: string;
    user_email: string;
    type: string;
    title: string;
    body: string | null;
    link: string | null;
    read: boolean;
    location_id: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }

  interface Props {
    userEmail: string;
    /** 'bottom' = dropdown opens below (mobile header). 'sidebar' = opens to the right (desktop rail). */
    placement?: 'bottom' | 'sidebar';
  }

  let { userEmail, placement = 'bottom' }: Props = $props();

  let notifications = $state<Notification[]>([]);
  let unreadCount = $state(0);
  let open = $state(false);
  let loading = $state(false);
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  async function getToken(): Promise<string | null> {
    try {
      const supabase = getClientSupabase();
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    } catch {
      return null;
    }
  }

  async function fetchNotifications() {
    const token = await getToken();
    if (!token) return;
    try {
      const res = await fetch('/api/v1/notifications', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        notifications = data.notifications ?? [];
        unreadCount = data.unreadCount ?? 0;
      }
    } catch {
      // Non-critical — silently fail
    }
  }

  async function markRead(id?: string) {
    const token = await getToken();
    if (!token) return;
    try {
      const body: Record<string, unknown> = { action: 'mark_read' };
      if (id) body.id = id;
      await fetch('/api/v1/notifications', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      // Optimistically update local state
      if (id) {
        notifications = notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
      } else {
        notifications = notifications.map((n) => ({ ...n, read: true }));
      }
      unreadCount = notifications.filter((n) => !n.read).length;
    } catch {
      // Non-critical
    }
  }

  async function handleNotificationClick(n: Notification) {
    if (!n.read) {
      await markRead(n.id);
    }
    if (n.link) {
      window.location.href = n.link;
    }
    open = false;
  }

  async function handleMarkAllRead() {
    await markRead();
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  function typeIcon(type: string): string {
    const icons: Record<string, string> = {
      schedule_submitted: '📋',
      schedule_approved: '✅',
      schedule_denied: '❌',
      schedule_revision: '🔄',
      forecast_submitted: '📊',
      forecast_locked: '🔒',
    };
    return icons[type] ?? '🔔';
  }

  $effect(() => {
    if (userEmail) {
      loading = true;
      fetchNotifications().finally(() => { loading = false; });
      pollInterval = setInterval(fetchNotifications, 60000);
    }
    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  });
</script>

<div style="position: relative; display: inline-block;">
  <!-- Bell button -->
  <button
    onclick={() => (open = !open)}
    style="position: relative; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 8px; background: rgba(255,255,255,0.08); border: none; cursor: pointer; color: rgba(255,255,255,0.7); transition: background 0.15s;"
    onmouseenter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.14)'; }}
    onmouseleave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
    aria-label="Notifications"
    title="Notifications"
  >
    <!-- Heroicons bell -->
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
    {#if unreadCount > 0}
      <span style="position: absolute; top: 4px; right: 4px; min-width: 16px; height: 16px; border-radius: 8px; background: #dc2626; color: white; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; padding: 0 3px; line-height: 1; font-family: 'Inter', sans-serif;">
        {unreadCount > 99 ? '99+' : unreadCount}
      </span>
    {/if}
  </button>

  <!-- Dropdown panel -->
  {#if open}
    <!-- Backdrop to close on outside click -->
    <div
      style="position: fixed; inset: 0; z-index: 40;"
      onclick={() => (open = false)}
      role="presentation"
    ></div>

    <div
      style="position: absolute; {placement === 'sidebar' ? 'left: calc(100% + 8px); bottom: 0; top: auto;' : 'right: 0; top: calc(100% + 8px);'} width: 320px; max-height: 420px; background: #1a2332; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,0.4); z-index: 50; display: flex; flex-direction: column; font-family: 'Inter', -apple-system, sans-serif; overflow: hidden;"
    >
      <!-- Header -->
      <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.08); flex-shrink: 0;">
        <span style="color: white; font-size: 13px; font-weight: 600; letter-spacing: 0.3px;">Notifications</span>
        {#if unreadCount > 0}
          <button
            onclick={handleMarkAllRead}
            style="font-size: 11px; color: #5b8cbf; background: none; border: none; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.1s;"
            onmouseenter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(91,140,191,0.15)'; }}
            onmouseleave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'none'; }}
          >
            Mark all read
          </button>
        {/if}
      </div>

      <!-- List -->
      <div style="overflow-y: auto; flex: 1;">
        {#if notifications.length === 0}
          <div style="padding: 32px 16px; text-align: center; color: rgba(255,255,255,0.35); font-size: 13px;">
            No notifications
          </div>
        {:else}
          {#each notifications as n (n.id)}
            <button
              onclick={() => handleNotificationClick(n)}
              style="width: 100%; text-align: left; display: block; padding: 12px 16px; border: none; border-bottom: 1px solid rgba(255,255,255,0.05); cursor: pointer; background: {n.read ? 'transparent' : 'rgba(30,58,95,0.25)'}; transition: background 0.1s;"
              onmouseenter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)'; }}
              onmouseleave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = n.read ? 'transparent' : 'rgba(30,58,95,0.25)'; }}
            >
              <div style="display: flex; align-items: flex-start; gap: 10px;">
                <span style="font-size: 16px; flex-shrink: 0; margin-top: 1px;">{typeIcon(n.type)}</span>
                <div style="flex: 1; min-width: 0;">
                  <p style="margin: 0 0 2px; font-size: 13px; font-weight: {n.read ? '400' : '600'}; color: {n.read ? 'rgba(255,255,255,0.55)' : 'white'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    {n.title}
                  </p>
                  {#if n.body}
                    <p style="margin: 0 0 4px; font-size: 11px; color: rgba(255,255,255,0.4); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      {n.body}
                    </p>
                  {/if}
                  <p style="margin: 0; font-size: 11px; color: rgba(255,255,255,0.3);">
                    {timeAgo(n.created_at)}
                  </p>
                </div>
                {#if !n.read}
                  <span style="width: 7px; height: 7px; border-radius: 50%; background: #3b82f6; flex-shrink: 0; margin-top: 4px;"></span>
                {/if}
              </div>
            </button>
          {/each}
        {/if}
      </div>
    </div>
  {/if}
</div>
