<script lang="ts">
  import { goto } from '$app/navigation';
  import { getClientSupabase } from '$lib/supabase-client';

  let email = $state('');
  let password = $state('');
  let error = $state('');
  let loading = $state(false);
  let showPassword = $state(false);

  async function handleSignIn() {
    error = '';
    if (!email || !password) {
      error = 'Email and password are required.';
      return;
    }
    loading = true;
    try {
      const supabase = getClientSupabase();
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) {
        error = authError.message;
      } else {
        goto('/dashboard');
      }
    } catch (e: any) {
      error = e.message || 'An unexpected error occurred.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center px-4" style="background: #ffffff;">
  <div class="w-full max-w-sm">
    <!-- Logo + brand -->
    <div class="text-center mb-8">
      <div class="flex justify-center mb-4">
        <!-- HELIXO geometric mark — circle · triangle · inner circle -->
        <svg width="52" height="52" viewBox="0 0 52 52" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="26" cy="26" r="24.5" stroke="#111111" stroke-width="1.5"/>
          <polygon points="26,8 44,40 8,40" stroke="#111111" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
          <circle cx="26" cy="30" r="7" stroke="#111111" stroke-width="1.5" fill="none"/>
        </svg>
      </div>
      <h1 class="text-2xl font-semibold tracking-tight" style="color: #111111; letter-spacing: -0.01em;">HELIXO</h1>
      <p class="text-sm mt-1" style="color: #6b7280;">Sign in to your account</p>
    </div>

    <!-- Form card -->
    <div>
      <div class="mb-5">
        <h2 class="text-sm font-semibold" style="color: #111111;">Sign In</h2>
        <p class="text-xs mt-0.5" style="color: #6b7280;">Enter your credentials to access your dashboard</p>
      </div>

      {#if error}
        <div class="mb-4 px-3 py-2 rounded text-xs" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;">
          {error}
        </div>
      {/if}

      <form onsubmit={(e) => { e.preventDefault(); handleSignIn(); }}>
        <div class="mb-4">
          <label for="email" class="block text-xs font-medium mb-1.5" style="color: #374151;">Email</label>
          <input
            id="email"
            type="email"
            bind:value={email}
            placeholder="you@methodco.com"
            class="w-full px-3 py-2 text-sm rounded-md outline-none transition-all"
            style="border: 1px solid #e5e7eb; color: #111; background: #fff;"
            onfocus={(e) => (e.currentTarget as HTMLInputElement).style.borderColor = '#3b5bdb'}
            onblur={(e) => (e.currentTarget as HTMLInputElement).style.borderColor = '#e5e7eb'}
            autocomplete="email"
          />
        </div>

        <div class="mb-4">
          <label for="password" class="block text-xs font-medium mb-1.5" style="color: #374151;">Password</label>
          <div class="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              bind:value={password}
              placeholder="Enter your password"
              class="w-full px-3 py-2 pr-10 text-sm rounded-md outline-none transition-all"
              style="border: 1px solid #e5e7eb; color: #111; background: #fff;"
              onfocus={(e) => (e.currentTarget as HTMLInputElement).style.borderColor = '#3b5bdb'}
              onblur={(e) => (e.currentTarget as HTMLInputElement).style.borderColor = '#e5e7eb'}
              autocomplete="current-password"
            />
            <button
              type="button"
              onclick={() => showPassword = !showPassword}
              class="absolute inset-y-0 right-0 flex items-center px-3"
              style="color: #9ca3af;"
              tabindex="-1"
            >
              {#if showPassword}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              {:else}
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              {/if}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          class="w-full py-2.5 text-sm font-semibold rounded-md text-white transition-opacity disabled:opacity-60"
          style="background: #3b5bdb;"
          onmouseenter={(e) => { if (!loading) (e.currentTarget as HTMLButtonElement).style.background = '#3451c7'; }}
          onmouseleave={(e) => (e.currentTarget as HTMLButtonElement).style.background = '#3b5bdb'}
        >
          {loading ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  </div>
</div>
