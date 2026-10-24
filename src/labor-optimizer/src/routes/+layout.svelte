<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { getClientSupabase } from '$lib/supabase-client';
  import {
    type UserRole,
    type RolePermissions,
    type TabPermissions,
    ROLE_PERMISSIONS,
    EMPTY_TAB_PERMISSIONS,
  } from '$lib/roles';
  import NotificationBell from '$lib/components/dashboard/NotificationBell.svelte';
  import '../app.css';

  let sidebarExpanded = $state(false);
  let mobileMenuOpen = $state(false);
  let userEmail = $state<string | null>(null);
  let authChecked = $state(false);
  let mustChangePassword = $state(false);
  let userRole = $state<UserRole>('viewer');
  let userPermissions = $state<RolePermissions>(ROLE_PERMISSIONS.viewer);
  let tabPermissions = $state<TabPermissions>(EMPTY_TAB_PERMISSIONS);

  // Ghost View (admin impersonation) state
  let ghostEmail = $state<string | null>(null);
  let isSuperAdmin = $state(false);

  // The email used for all permission/location lookups — ghost when active, real otherwise
  let effectiveEmail = $derived(ghostEmail || userEmail);

  // Module-level cache to avoid re-fetching on every navigation
  let cachedRoleEmail: string | null = null;
  let cachedRole: UserRole | null = null;
  let cachedPermissions: RolePermissions | null = null;
  let cachedTabPermissions: TabPermissions | null = null;

  // Nav items derived from tabPermissions
  let reportingItems = $derived(buildReportingItems(tabPermissions));
  let planningItems = $derived(buildPlanningItems(tabPermissions));
  let executiveItems = $derived(buildExecutiveItems(tabPermissions));
  let adminItems = $derived(buildAdminItems(tabPermissions));

  let hasReporting = $derived(reportingItems.length > 0);
  let hasPlanning = $derived(planningItems.length > 0);
  let hasExecutive = $derived(executiveItems.length > 0);
  let isAdmin = $derived(adminItems.length > 0);

  let allNavItems = $derived([...reportingItems, ...planningItems, ...executiveItems, ...adminItems]);

  function buildReportingItems(tp: TabPermissions): { href: string; label: string }[] {
    const items: { href: string; label: string }[] = [];
    if (tp.reporting.includes('dashboard')) items.push({ href: '/dashboard', label: 'Dashboard' });
    if (tp.reporting.includes('labor_detail')) items.push({ href: '/dashboard/labor-detail', label: 'Labor Detail' });
    if (tp.reporting.includes('insights')) items.push({ href: '/dashboard/insights', label: 'Insights' });
    if (tp.reporting.includes('guest_analytics')) items.push({ href: '/dashboard/guest-analytics', label: 'Guest Analytics' });
    if (tp.reporting.includes('events')) items.push({ href: '/dashboard/events', label: 'Events' });
    if (tp.reporting.includes('snapshot')) items.push({ href: '/dashboard/snapshot', label: 'Snapshot' });
    return items;
  }

  function buildExecutiveItems(tp: TabPermissions): { href: string; label: string }[] {
    const items: { href: string; label: string }[] = [];
    if (tp.reporting.includes('executive_summary')) items.push({ href: '/dashboard/executive', label: 'Executive Summary' });
    if (tp.reporting.includes('location_comparison')) items.push({ href: '/dashboard/location-comparison', label: 'Location Comparison' });
    if (tp.reporting.includes('monthly_report')) items.push({ href: '/dashboard/monthly-report', label: 'Monthly Report' });
    return items;
  }

  function buildPlanningItems(tp: TabPermissions): { href: string; label: string }[] {
    const items: { href: string; label: string }[] = [];
    if (tp.planning.includes('forecast')) items.push({ href: '/dashboard/forecast', label: 'Forecast' });
    if (tp.planning.includes('staffing')) items.push({ href: '/dashboard/staffing', label: 'Staffing' });
    if (tp.planning.includes('schedule_builder')) items.push({ href: '/dashboard/schedule-builder', label: 'Schedule Builder' });
    if (tp.planning.includes('schedule_approval')) items.push({ href: '/dashboard/schedule-approval', label: 'Schedule' });
    if (tp.planning.includes('approval_workflow')) items.push({ href: '/dashboard/approval-workflow', label: 'Approvals' });
    return items;
  }

  function buildAdminItems(tp: TabPermissions): { href: string; label: string }[] {
    const items: { href: string; label: string }[] = [];
    if (tp.admin.includes('user_management')) items.push({ href: '/dashboard/admin/user-management', label: 'User Management' });
    if (tp.admin.includes('employees')) items.push({ href: '/dashboard/admin/employees', label: 'Employees' });
    if (tp.admin.includes('forecast_accuracy')) items.push({ href: '/dashboard/admin/forecast-accuracy', label: 'Forecast Accuracy' });
    if (tp.admin.includes('engine_audit')) items.push({ href: '/dashboard/admin/engine-audit', label: 'Engine Audit' });
    if (tp.admin.includes('competitive_set')) items.push({ href: '/dashboard/admin/competitive', label: 'Competitive Set' });
    if (tp.admin.includes('settings')) items.push({ href: '/dashboard/settings', label: 'Settings' });
    if (tp.admin.includes('labor_questionnaire')) items.push({ href: '/dashboard/settings/questionnaire', label: 'Labor Questionnaire' });
    if (tp.admin.includes('guiding_principles')) items.push({ href: '/dashboard/admin/principles', label: 'Guiding Principles' });
    if (tp.admin.includes('data_sources')) items.push({ href: '/dashboard/admin/data-source-map', label: 'Data Sources' });
    if (tp.admin.includes('user_management')) items.push({ href: '/dashboard/admin/toast-reconcile', label: 'Toast Reconcile' });
    if (tp.admin.includes('user_management')) items.push({ href: '/dashboard/admin/bulk-backfill', label: 'Bulk Backfill' });
    return items;
  }

  async function fetchUserRole(email: string) {
    if (cachedRoleEmail === email && cachedRole !== null) {
      userRole = cachedRole;
      userPermissions = cachedPermissions || ROLE_PERMISSIONS.viewer;
      tabPermissions = cachedTabPermissions || EMPTY_TAB_PERMISSIONS;
      return;
    }
    try {
      const controller = new AbortController();
      // 8s timeout — Vercel cold-starts can take 4-6s; 4s was too aggressive
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        userRole = data.role || 'viewer';
        userPermissions = data.permissions || ROLE_PERMISSIONS.viewer;
        tabPermissions = data.tabPermissions || EMPTY_TAB_PERMISSIONS;
        isSuperAdmin = data.role === 'super_admin';
        cachedRoleEmail = email;
        cachedRole = userRole;
        cachedPermissions = userPermissions;
        cachedTabPermissions = tabPermissions;
        // Persist tab permissions so nav renders immediately on next page load
        try { sessionStorage.setItem('helixo_tab_permissions', JSON.stringify(tabPermissions)); } catch {}
      }
    } catch {
      // On network failure / timeout, preserve any existing permissions rather than blanking the nav.
      // This prevents hard-refresh from wiping navigation when the role API is slow or cold-starting.
      if (tabPermissions === EMPTY_TAB_PERMISSIONS) {
        // Nothing cached in memory — try sessionStorage fallback before defaulting to viewer
        try {
          const saved = sessionStorage.getItem('helixo_tab_permissions');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.reporting) tabPermissions = parsed;
          }
        } catch {}
      }
      // Only fall back to viewer if we genuinely have nothing
      if (tabPermissions === EMPTY_TAB_PERMISSIONS) {
        userRole = 'viewer';
        userPermissions = ROLE_PERMISSIONS.viewer;
      }
    }
  }

  function exitGhostView() {
    localStorage.removeItem('helixo_ghost_email');
    ghostEmail = null;
    // Re-fetch real user's role
    if (userEmail) {
      cachedRoleEmail = null;
      cachedRole = null;
      cachedPermissions = null;
      cachedTabPermissions = null;
      fetchUserRole(userEmail).catch(() => {});
    }
    goto('/dashboard');
  }

  onMount(() => {
    // Restore nav immediately from sessionStorage to prevent flash of empty nav.
    // The fetchUserRole call below will update this with fresh data.
    try {
      const saved = sessionStorage.getItem('helixo_tab_permissions');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.reporting) tabPermissions = parsed;
      }
    } catch {}

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const reg of registrations) reg.unregister();
      });
      if ('caches' in window) {
        caches.keys().then((names) => {
          for (const name of names) caches.delete(name);
        });
      }
    }

    const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
    if (isNative) {
      document.body.classList.add('native-app');
      import('$lib/push-notifications').then((m) => m.initPushNotifications());
    }

    const supabase = getClientSupabase();

    // Set up auth state listener SYNCHRONOUSLY first so we can return cleanup correctly.
    // onMount must return void | (() => void) — can't be async.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      userEmail = session?.user?.email ?? null;
      if (userEmail) {
        // Clear cache on auth state change so we get fresh permissions
        cachedRoleEmail = null;
        cachedRole = null;
        cachedPermissions = null;
        cachedTabPermissions = null;
        // Check real user's super_admin status before applying ghost mode
        await fetchUserRole(userEmail);
        await checkMustChangePassword(userEmail);
        // Re-apply ghost role if ghost mode is active
        const ghost = localStorage.getItem('helixo_ghost_email');
        if (ghost && isSuperAdmin) {
          ghostEmail = ghost;
          cachedRoleEmail = null;
          await fetchUserRole(ghost);
        }
      } else {
        userRole = 'viewer';
        userPermissions = ROLE_PERMISSIONS.viewer;
        tabPermissions = EMPTY_TAB_PERMISSIONS;
        mustChangePassword = false;
        ghostEmail = null;
      }
      if (!session && !isPublicPage()) {
        goto('/login');
      }
    });

    // Async auth init in an IIFE — fire-and-forget, does not affect cleanup return type.
    (async () => {
      // FAST PATH: getSession() reads from localStorage — no network call, instant.
      // This shows the page immediately without any stalling on Supabase latency.
      const { data: { session } } = await supabase.auth.getSession();

      if (!session) {
        // No local session at all — go to login immediately
        authChecked = true;
        if (!isPublicPage()) goto('/login');
        return;
      }

      // Session found locally — show page right away
      userEmail = session.user?.email ?? null;
      authChecked = true;

      // Read ghost email from localStorage (set by user-management "View as" button)
      const storedGhost = localStorage.getItem('helixo_ghost_email');

      // Kick off role/password fetch without blocking page render
      if (userEmail) {
        Promise.race([
          (async () => {
            await fetchUserRole(userEmail!);
            await checkMustChangePassword(userEmail!);
            // Apply ghost mode only if the real user is super_admin
            if (storedGhost && isSuperAdmin) {
              ghostEmail = storedGhost;
              cachedRoleEmail = null;
              await fetchUserRole(storedGhost);
            }
          })(),
          new Promise(resolve => setTimeout(resolve, 4000)),
        ]).catch(() => {/* non-fatal */});
      }

      // BACKGROUND VALIDATION: getUser() validates token over network.
      // If token is truly expired/invalid, silently redirect — but only after
      // page has already rendered, to avoid jarring mid-session kicks.
      supabase.auth.getUser().then(async ({ data: { user }, error }) => {
        if (error || !user) {
          // Try refresh first — session might just need a token refresh
          const { data: refreshed } = await supabase.auth.refreshSession();
          if (!refreshed.session) {
            await supabase.auth.signOut();
            if (!isPublicPage()) goto('/login');
          }
        }
      }).catch(() => {/* network error — don't kick user, onAuthStateChange will handle expiry */});
    })();

    // HARD REFRESH SAFEGUARD: if auth state hasn't resolved in 8s, unblock the page.
    // Raised from 3s → 8s to accommodate Vercel cold-start latency on the role API.
    const authTimeout = setTimeout(() => {
      if (!authChecked) {
        authChecked = true;
        if (!userEmail && !isPublicPage()) goto('/login');
      }
    }, 8000);

    // Ghost view: apply immediately when user-management dispatches the event
    // (avoids needing a full logout/login to see ghost permissions in nav)
    const onGhostSet = async (e: Event) => {
      const ghostUserEmail = (e as CustomEvent).detail?.email as string | undefined;
      if (!ghostUserEmail || !isSuperAdmin) return;
      ghostEmail = ghostUserEmail;
      cachedRoleEmail = null;
      cachedRole = null;
      cachedPermissions = null;
      cachedTabPermissions = null;
      await fetchUserRole(ghostUserEmail);
    };
    window.addEventListener('helixo-ghost-set', onGhostSet);

    // Synchronous cleanup — Svelte calls this on component destroy
    return () => {
      subscription.unsubscribe();
      clearTimeout(authTimeout);
      window.removeEventListener('helixo-ghost-set', onGhostSet);
    };
  });

  function isLoginPage(): boolean {
    return $page.url.pathname === '/login';
  }

  function isChangePasswordPage(): boolean {
    return $page.url.pathname === '/change-password';
  }

  function isPublicPage(): boolean {
    return isLoginPage() || isChangePasswordPage();
  }

  async function checkMustChangePassword(email: string) {
    try {
      const supabase = getClientSupabase();
      const { data } = await supabase
        .from('location_users')
        .select('must_change_password')
        .eq('user_email', email)
        .limit(1)
        .maybeSingle();

      mustChangePassword = data?.must_change_password === true;
      if (mustChangePassword && !isChangePasswordPage()) {
        goto('/change-password');
      }
    } catch {
      mustChangePassword = false;
    }
  }

  async function handleLogout() {
    try {
      const supabase = getClientSupabase();
      await supabase.auth.signOut();
    } catch (e) {
      console.error('[Layout] Sign out error:', e);
    } finally {
      window.location.href = '/login';
    }
  }
</script>

{#if !authChecked}
  <div class="min-h-screen flex items-center justify-center" style="background: #000000;">
    <svg width="64" height="64" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:0.85;">
      <circle cx="26" cy="26" r="24.5" stroke="white" stroke-width="1.5"/>
      <polygon points="26,8 44,40 8,40" stroke="white" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
      <circle cx="26" cy="30" r="7" stroke="white" stroke-width="1.5" fill="none"/>
    </svg>
  </div>
{:else if isLoginPage() || isChangePasswordPage()}
  <slot />
{:else if !userEmail}
  <div class="min-h-screen flex items-center justify-center" style="background: #000000;">
    <svg width="64" height="64" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" style="opacity:0.85;">
      <circle cx="26" cy="26" r="24.5" stroke="white" stroke-width="1.5"/>
      <polygon points="26,8 44,40 8,40" stroke="white" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
      <circle cx="26" cy="30" r="7" stroke="white" stroke-width="1.5" fill="none"/>
    </svg>
  </div>
{:else}
  <!-- Mobile Header -->
  <div class="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4" style="height: 52px; background: #0e0e0e;">
    <button onclick={() => mobileMenuOpen = !mobileMenuOpen}
      class="flex items-center justify-center w-10 h-10 rounded-lg"
      style="color: white; background: rgba(255,255,255,0.08); min-height: 44px; min-width: 44px;"
      aria-label="Toggle menu">
      {#if mobileMenuOpen}
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      {:else}
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      {/if}
    </button>
    <a href="/dashboard" class="text-white font-bold text-sm tracking-wide">HELIXO</a>
    <div class="flex items-center">
      {#if authChecked && userEmail}
        <NotificationBell {userEmail} />
      {:else}
        <span class="w-10"></span>
      {/if}
    </div>
  </div>

  <!-- Mobile Overlay -->
  {#if mobileMenuOpen}
    <div class="md:hidden fixed inset-0 z-30" style="background: rgba(0,0,0,0.5);" onclick={() => mobileMenuOpen = false} role="presentation"></div>
  {/if}

  <!-- Mobile Slide-in Nav -->
  <div class="md:hidden fixed top-[52px] left-0 bottom-0 z-30 flex flex-col py-4 overflow-y-auto transition-transform duration-200"
    style="width: 240px; background: #111111; transform: {mobileMenuOpen ? 'translateX(0)' : 'translateX(-100%)'};">

    {#if reportingItems.length > 0}
      <div class="px-4 mb-1">
        <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Reporting</span>
      </div>
      {#each reportingItems as item}
        <a href={item.href} onclick={() => mobileMenuOpen = false}
          class="block px-4 py-3 text-sm transition-colors"
          style="{$page.url.pathname === item.href
            ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
            : 'color: rgba(255,255,255,0.55);'}; min-height: 44px; display: flex; align-items: center;">
          {item.label}
        </a>
      {/each}
    {/if}

    {#if planningItems.length > 0}
      <div class="px-4 mb-1 mt-4">
        <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Planning</span>
      </div>
      {#each planningItems as item}
        <a href={item.href} onclick={() => mobileMenuOpen = false}
          class="block px-4 py-3 text-sm transition-colors"
          style="{$page.url.pathname === item.href
            ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
            : 'color: rgba(255,255,255,0.55);'}; min-height: 44px; display: flex; align-items: center;">
          {item.label}
        </a>
      {/each}
    {/if}

    {#if executiveItems.length > 0}
      <div class="px-4 mb-1 mt-4">
        <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Executive</span>
      </div>
      {#each executiveItems as item}
        <a href={item.href} onclick={() => mobileMenuOpen = false}
          class="block px-4 py-3 text-sm transition-colors"
          style="{$page.url.pathname === item.href
            ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
            : 'color: rgba(255,255,255,0.55);'}; min-height: 44px; display: flex; align-items: center;">
          {item.label}
        </a>
      {/each}
    {/if}

    {#if adminItems.length > 0}
      <div class="px-4 mb-1 mt-4">
        <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Admin</span>
      </div>
      {#each adminItems as item}
        <a href={item.href} onclick={() => mobileMenuOpen = false}
          class="block px-4 py-3 text-sm transition-colors"
          style="{$page.url.pathname === item.href
            ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
            : 'color: rgba(255,255,255,0.55);'}; min-height: 44px; display: flex; align-items: center;">
          {item.label}
        </a>
      {/each}
    {/if}

    <div class="mt-auto px-4 pt-4 border-t" style="border-color: rgba(255,255,255,0.1);">
      <p class="text-xs truncate mb-2" style="color: rgba(255,255,255,0.5);" title={userEmail}>{userEmail}</p>
      <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded" style="background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.5);">{userRole.replace('_', ' ')}</span>
      <button onclick={handleLogout} class="text-xs transition-colors py-2 mt-1" style="color: rgba(255,255,255,0.4); min-height: 44px;">
        Sign Out
      </button>
    </div>
  </div>

  <div class="min-h-screen flex" style="background: #ffffff;">
    <!-- Desktop Icon Rail -->
    <div class="hidden md:flex flex-col items-center py-4 gap-0.5 flex-shrink-0" style="width: 56px; background: #111111;">
      <!-- Logo mark -->
      <a href="/dashboard" class="flex items-center justify-center w-10 h-10 rounded-lg mb-3" style="background: rgba(255,255,255,0.06);" title="HELIXO">
        <svg width="22" height="22" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="26" cy="26" r="24.5" stroke="white" stroke-width="1.5"/>
          <polygon points="26,8 44,40 8,40" stroke="white" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
          <circle cx="26" cy="30" r="7" stroke="white" stroke-width="1.5" fill="none"/>
        </svg>
      </a>

      {#if hasReporting}
        <button onclick={() => sidebarExpanded = !sidebarExpanded}
          class="flex items-center justify-center w-10 h-10 rounded-lg transition-colors"
          style="{reportingItems.some(i => $page.url.pathname === i.href) ? 'background: rgba(59,91,219,0.2); color: #7c9ef0;' : 'color: rgba(255,255,255,0.4);'}"
          onmouseenter={(e) => { if (!reportingItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
          onmouseleave={(e) => { if (!reportingItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          title="Reporting">
          <!-- Bar chart icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>
        </button>
      {/if}

      {#if hasPlanning}
        <button onclick={() => sidebarExpanded = !sidebarExpanded}
          class="flex items-center justify-center w-10 h-10 rounded-lg transition-colors"
          style="{planningItems.some(i => $page.url.pathname === i.href) ? 'background: rgba(59,91,219,0.2); color: #7c9ef0;' : 'color: rgba(255,255,255,0.4);'}"
          onmouseenter={(e) => { if (!planningItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
          onmouseleave={(e) => { if (!planningItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          title="Planning">
          <!-- Calendar icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        </button>
      {/if}

      {#if hasExecutive}
        <button onclick={() => sidebarExpanded = !sidebarExpanded}
          class="flex items-center justify-center w-10 h-10 rounded-lg transition-colors"
          style="{executiveItems.some(i => $page.url.pathname === i.href) ? 'background: rgba(59,91,219,0.2); color: #7c9ef0;' : 'color: rgba(255,255,255,0.4);'}"
          onmouseenter={(e) => { if (!executiveItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
          onmouseleave={(e) => { if (!executiveItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          title="Executive Reporting">
          <!-- Layers / briefcase icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        </button>
      {/if}

      {#if isAdmin}
        <button onclick={() => sidebarExpanded = !sidebarExpanded}
          class="flex items-center justify-center w-10 h-10 rounded-lg transition-colors"
          style="{adminItems.some(i => $page.url.pathname === i.href) ? 'background: rgba(59,91,219,0.2); color: #7c9ef0;' : 'color: rgba(255,255,255,0.4);'}"
          onmouseenter={(e) => { if (!adminItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.75)'; }}
          onmouseleave={(e) => { if (!adminItems.some(i => $page.url.pathname === i.href)) e.currentTarget.style.color = 'rgba(255,255,255,0.4)'; }}
          title="Admin">
          <!-- Settings / cog icon -->
          <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      {/if}

      <!-- Bottom: notifications, user avatar, sign out -->
      <div class="mt-auto flex flex-col items-center gap-1">
        {#if authChecked && userEmail}
          <NotificationBell {userEmail} placement="sidebar" />
        {/if}
        <!-- User initials avatar -->
        <div class="flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold select-none"
          style="background: rgba(59,91,219,0.25); color: #7c9ef0; letter-spacing: 0.02em;"
          title={userEmail ?? ''}>
          {(userEmail ?? '').split('@')[0].slice(0, 2).toUpperCase()}
        </div>
        <button onclick={handleLogout}
          class="flex items-center justify-center w-10 h-10 rounded-lg transition-colors"
          style="color: rgba(255,255,255,0.35);"
          onmouseenter={(e) => e.currentTarget.style.color = '#fff'}
          onmouseleave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}
          title="Sign Out">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        </button>
      </div>
    </div>

    <!-- Desktop Expandable Nav Panel -->
    {#if sidebarExpanded}
      <div class="hidden md:flex flex-col flex-shrink-0 py-5 overflow-y-auto" style="width: 192px; background: #1a1a1a; border-right: 1px solid rgba(255,255,255,0.06);">
        <div class="flex items-center justify-between px-4 mb-5">
          <span class="text-white font-semibold text-sm tracking-widest" style="letter-spacing: 0.1em;">HELIXO</span>
          <button onclick={() => sidebarExpanded = false}
            class="flex items-center justify-center w-6 h-6 rounded transition-colors"
            style="color: rgba(255,255,255,0.35);"
            onmouseenter={(e) => e.currentTarget.style.color = '#fff'}
            onmouseleave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>

        {#if reportingItems.length > 0}
          <div class="px-4 mb-1.5">
            <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Reporting</span>
          </div>
          {#each reportingItems as item}
            <a href={item.href}
              class="flex items-center px-4 py-1.5 text-[13px] transition-colors rounded-sm mx-1"
              style="{$page.url.pathname === item.href
                ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
                : 'color: rgba(255,255,255,0.5);'}">
              {item.label}
            </a>
          {/each}
        {/if}

        {#if planningItems.length > 0}
          <div class="px-4 mb-1.5 mt-4">
            <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Planning</span>
          </div>
          {#each planningItems as item}
            <a href={item.href}
              class="flex items-center px-4 py-1.5 text-[13px] transition-colors rounded-sm mx-1"
              style="{$page.url.pathname === item.href
                ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
                : 'color: rgba(255,255,255,0.5);'}">
              {item.label}
            </a>
          {/each}
        {/if}

        {#if executiveItems.length > 0}
          <div class="px-4 mb-1.5 mt-4">
            <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Executive</span>
          </div>
          {#each executiveItems as item}
            <a href={item.href}
              class="flex items-center px-4 py-1.5 text-[13px] transition-colors rounded-sm mx-1"
              style="{$page.url.pathname === item.href
                ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
                : 'color: rgba(255,255,255,0.5);'}">
              {item.label}
            </a>
          {/each}
        {/if}

        {#if adminItems.length > 0}
          <div class="px-4 mb-1.5 mt-4">
            <span class="text-[9px] uppercase tracking-[0.12em] font-semibold" style="color: rgba(255,255,255,0.3);">Admin</span>
          </div>
          {#each adminItems as item}
            <a href={item.href}
              class="flex items-center px-4 py-1.5 text-[13px] transition-colors rounded-sm mx-1"
              style="{$page.url.pathname === item.href
                ? 'color: white; background: rgba(59,91,219,0.18); font-weight: 500;'
                : 'color: rgba(255,255,255,0.5);'}">
              {item.label}
            </a>
          {/each}
        {/if}

        <div class="mt-auto px-4 pt-4 border-t" style="border-color: rgba(255,255,255,0.07);">
          <p class="text-[11px] truncate mb-1" style="color: rgba(255,255,255,0.4);" title={userEmail}>{userEmail}</p>
          <p class="text-[10px] uppercase tracking-wider mb-3" style="color: rgba(255,255,255,0.25);">{userRole.replace('_', ' ')}</p>
          <button onclick={handleLogout}
            class="flex items-center gap-1.5 text-[12px] transition-colors"
            style="color: rgba(255,255,255,0.35);"
            onmouseenter={(e) => e.currentTarget.style.color = '#fff'}
            onmouseleave={(e) => e.currentTarget.style.color = 'rgba(255,255,255,0.35)'}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>
      </div>
    {/if}

    <!-- Main Content -->
    <div class="flex-1 min-w-0 overflow-auto pt-[52px] md:pt-0 px-[5%] md:px-[7%]">
      {#if ghostEmail}
        <div class="sticky top-0 z-50 flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium"
          style="background: #7c3aed; color: white; border-bottom: 2px solid #6d28d9;">
          <div class="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span>Ghost View — viewing as <strong>{ghostEmail}</strong></span>
          </div>
          <button
            onclick={exitGhostView}
            class="flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-opacity hover:opacity-80"
            style="background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.4);">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Exit Ghost View
          </button>
        </div>
      {/if}
      <slot />
    </div>
  </div>
{/if}
