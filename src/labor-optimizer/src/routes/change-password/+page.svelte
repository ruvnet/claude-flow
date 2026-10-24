<script lang="ts">
  import { goto } from '$app/navigation';
  import { getClientSupabase } from '$lib/supabase-client';

  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');
  let error = $state('');
  let loading = $state(false);
  let success = $state(false);

  async function handleChangePassword() {
    error = '';

    if (!currentPassword || !newPassword || !confirmPassword) {
      error = 'All fields are required.';
      return;
    }

    if (newPassword.length < 8) {
      error = 'New password must be at least 8 characters.';
      return;
    }

    if (newPassword !== confirmPassword) {
      error = 'New passwords do not match.';
      return;
    }

    if (newPassword === currentPassword) {
      error = 'New password must be different from your current password.';
      return;
    }

    loading = true;
    try {
      const supabase = getClientSupabase();

      // Verify current password by attempting sign-in
      const { data: { session } } = await supabase.auth.getSession();
      const userEmail = session?.user?.email;
      if (!userEmail) {
        error = 'No active session. Please log in again.';
        loading = false;
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
      });

      if (signInError) {
        error = 'Current password is incorrect.';
        loading = false;
        return;
      }

      // Update password
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        error = updateError.message;
        loading = false;
        return;
      }

      // Clear must_change_password flag
      const { error: flagError } = await supabase
        .from('location_users')
        .update({ must_change_password: false })
        .eq('user_email', userEmail);

      if (flagError) {
        console.warn('Failed to clear must_change_password flag:', flagError.message);
      }

      success = true;
      setTimeout(() => goto('/dashboard'), 1500);
    } catch (e: any) {
      error = e.message || 'An unexpected error occurred.';
    } finally {
      loading = false;
    }
  }
</script>

<div class="min-h-screen flex items-center justify-center px-4" style="background: #fafafa;">
  <div class="leo-card p-6 sm:p-8 w-full max-w-sm">
    <div class="text-center mb-6">
      <div class="inline-flex items-center justify-center w-12 h-12 rounded-lg mb-3" style="background: #1e3a5f;">
        <span class="text-white font-bold text-lg">H</span>
      </div>
      <h1 class="text-xl font-bold text-[#1a1a1a]">Change Your Password</h1>
      <p class="text-sm text-[#6b7280] mt-1">Please set a new password to continue.</p>
    </div>

    {#if success}
      <div class="mb-4 px-3 py-2 rounded text-sm" style="background: #f0fdf4; color: #16a34a; border: 1px solid #bbf7d0;">
        Password changed successfully. Redirecting...
      </div>
    {/if}

    {#if error}
      <div class="mb-4 px-3 py-2 rounded text-sm" style="background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;">
        {error}
      </div>
    {/if}

    <form onsubmit={(e) => { e.preventDefault(); handleChangePassword(); }}>
      <div class="mb-4">
        <label for="current-password" class="block text-xs font-medium text-[#374151] mb-1">Current Password</label>
        <input
          id="current-password"
          type="password"
          bind:value={currentPassword}
          placeholder="Enter current password"
          class="leo-select w-full"
          autocomplete="current-password"
        />
      </div>

      <div class="mb-4">
        <label for="new-password" class="block text-xs font-medium text-[#374151] mb-1">New Password</label>
        <input
          id="new-password"
          type="password"
          bind:value={newPassword}
          placeholder="Min 8 characters"
          class="leo-select w-full"
          autocomplete="new-password"
        />
      </div>

      <div class="mb-6">
        <label for="confirm-password" class="block text-xs font-medium text-[#374151] mb-1">Confirm New Password</label>
        <input
          id="confirm-password"
          type="password"
          bind:value={confirmPassword}
          placeholder="Confirm new password"
          class="leo-select w-full"
          autocomplete="new-password"
        />
      </div>

      <button
        type="submit"
        disabled={loading || success}
        class="leo-btn w-full disabled:opacity-50"
      >
        {loading ? 'Updating...' : 'Change Password'}
      </button>
    </form>
  </div>
</div>
