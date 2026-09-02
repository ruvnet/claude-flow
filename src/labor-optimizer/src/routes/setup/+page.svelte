<script lang="ts">
  let step = $state(1);
  let clientId = $state('');
  let clientSecret = $state('');
  let restaurantGuid = $state('');
  let restaurants = $state<{guid: string; name: string; address?: string}[]>([]);
  let selectedGuid = $state('');
  let selectedName = $state('');
  let toastJobs = $state<{guid: string; title: string}[]>([]);
  let jobMappings = $state<Record<string, string>>({});
  let p1StartDate = $state('2026-01-05');
  let loading = $state(false);
  let error = $state('');
  let locationName = $state('');

  const positions = [
    'Server', 'Bartender', 'Host', 'Barista', 'Support', 'Training',
    'Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers', 'EXCLUDE'
  ];

  async function authenticateToast() {
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/v1/setup/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, restaurantGuid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      restaurants = data.restaurants || [];
      step = 2;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function selectRestaurant(guid: string, name: string) {
    selectedGuid = guid;
    selectedName = name;
    locationName = name;
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/v1/setup/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret, restaurantGuid: guid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch jobs');
      toastJobs = data.jobs || [];
      for (const job of toastJobs) {
        const title = job.title.toLowerCase();
        if (title.includes('server') || title.includes('waiter') || title.includes('waitress')) jobMappings[job.title] = 'Server';
        else if (title.includes('bartend') || title.includes('bar tend')) jobMappings[job.title] = 'Bartender';
        else if (title.includes('host')) jobMappings[job.title] = 'Host';
        else if (title.includes('barista') || title.includes('coffee')) jobMappings[job.title] = 'Barista';
        else if (title.includes('busser') || title.includes('runner') || title.includes('support') || title.includes('back waiter')) jobMappings[job.title] = 'Support';
        else if (title.includes('train')) jobMappings[job.title] = 'Training';
        else if (title.includes('line cook') || title.includes('saute') || title.includes('grill') || title.includes('fry')) jobMappings[job.title] = 'Line Cooks';
        else if (title.includes('prep')) jobMappings[job.title] = 'Prep Cooks';
        else if (title.includes('pastry') || title.includes('baker') || title.includes('dessert')) jobMappings[job.title] = 'Pastry';
        else if (title.includes('dish') || title.includes('ware')) jobMappings[job.title] = 'Dishwashers';
        else jobMappings[job.title] = 'EXCLUDE';
      }
      step = 3;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }

  async function saveLocation() {
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/v1/setup/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: locationName,
          toastGuid: selectedGuid,
          clientId,
          clientSecret,
          jobMappings,
          p1StartDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      step = 5;
    } catch (e: any) {
      error = e.message;
    } finally {
      loading = false;
    }
  }
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6">
  <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a] mb-1">Add New Location</h1>
  <p class="text-sm text-[#6b7280] mb-6 md:mb-8">Connect your Toast POS and configure the KPI dashboard</p>

  <!-- Progress Steps -->
  <div class="flex items-center mb-8 md:mb-10 gap-1 sm:gap-2 overflow-x-auto pb-2">
    {#each ['Toast Credentials', 'Select Restaurant', 'Map Jobs', 'Period Setup', 'Done'] as label, i}
      <div class="flex items-center gap-1 sm:gap-2 flex-shrink-0">
        <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center text-xs sm:text-sm font-bold"
          style="{step > i + 1
            ? 'background: #16a34a; color: white;'
            : step === i + 1
              ? 'background: #1e3a5f; color: white;'
              : 'background: #e5e7eb; color: #6b7280;'}">
          {step > i + 1 ? '\u2713' : i + 1}
        </div>
        <span class="text-xs sm:text-sm hidden sm:inline" style="{step === i + 1 ? 'font-weight: 600; color: #1a1a1a;' : 'color: #9ca3af;'}">{label}</span>
        {#if i < 4}<div class="w-4 sm:w-8 h-px" style="background: #d1d5db;"></div>{/if}
      </div>
    {/each}
  </div>

  {#if error}
    <div class="px-4 py-3 rounded mb-6" style="background: #fef2f2; border: 1px solid #fecaca; color: #dc2626;">{error}</div>
  {/if}

  <!-- Step 1: Toast Credentials -->
  {#if step === 1}
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4" style="font-size: 18px; text-transform: none;">Toast POS Credentials</h2>
      <p class="text-sm text-[#6b7280] mb-6">Enter your Toast API credentials. These are stored securely and used to pull daily revenue and labor data.</p>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-[#374151] mb-1">Client ID</label>
          <input bind:value={clientId} type="text" class="leo-select w-full" placeholder="Your Toast Client ID" />
        </div>
        <div>
          <label class="block text-sm font-medium text-[#374151] mb-1">Client Secret</label>
          <input bind:value={clientSecret} type="password" class="leo-select w-full" placeholder="Your Toast Client Secret" />
        </div>
        <div>
          <label class="block text-sm font-medium text-[#374151] mb-1">Restaurant GUID <span class="text-[#9ca3af] font-normal">(optional -- found in Toast Admin)</span></label>
          <input bind:value={restaurantGuid} type="text" class="leo-select w-full" placeholder="e.g. 094d90b5-47fd-4adf-b892-153dc7cd034f" />
        </div>
        <button onclick={authenticateToast} disabled={loading || !clientId || !clientSecret} class="leo-btn">
          {loading ? 'Connecting...' : 'Connect to Toast'}
        </button>
      </div>
    </div>

  <!-- Step 2: Select Restaurant -->
  {:else if step === 2}
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4" style="font-size: 18px; text-transform: none;">Select Restaurant</h2>
      <p class="text-sm text-[#6b7280] mb-6">Choose the location you want to set up.</p>
      <div class="space-y-3">
        {#each restaurants as r}
          <button onclick={() => selectRestaurant(r.guid, r.name === 'Current Restaurant' && restaurantGuid ? 'Restaurant' : r.name)}
            class="w-full text-left rounded-lg p-4 transition-colors"
            style="border: 1px solid #e5e7eb; background: white;"
            onmouseenter={(e) => { e.currentTarget.style.borderColor = '#1e3a5f'; e.currentTarget.style.background = 'rgba(30,58,95,0.03)'; }}
            onmouseleave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.background = 'white'; }}>
            <div class="font-semibold text-[#1a1a1a]">{r.name === 'Current Restaurant' && restaurantGuid ? 'Connected Restaurant' : r.name}</div>
            {#if r.address}<div class="text-sm text-[#6b7280]">{r.address}</div>{/if}
            <div class="text-xs text-[#9ca3af] mt-1">{r.guid || restaurantGuid}</div>
          </button>
        {/each}
      </div>
      {#if loading}
        <div class="mt-4" style="color: #1e3a5f;">Fetching job list...</div>
      {/if}
    </div>

  <!-- Step 3: Map Toast Jobs -->
  {:else if step === 3}
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4" style="font-size: 18px; text-transform: none;">Map Toast Jobs to Dashboard Positions</h2>
      <p class="text-sm text-[#6b7280] mb-6">Map each Toast job title to the position it should report under. Select EXCLUDE to ignore a job.</p>
      <div class="space-y-3 max-h-96 overflow-y-auto">
        {#each toastJobs as job}
          <div class="flex items-center gap-4 py-2" style="border-bottom: 1px solid #e5e7eb;">
            <div class="flex-1 font-medium text-[#1a1a1a]">{job.title}</div>
            <select bind:value={jobMappings[job.title]} class="leo-select"
              style="{jobMappings[job.title] === 'EXCLUDE' ? 'color: #9ca3af;' : ''}">
              {#each positions as pos}
                <option value={pos}>{pos}</option>
              {/each}
            </select>
          </div>
        {/each}
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick={() => step = 2} class="leo-btn-secondary">Back</button>
        <button onclick={() => step = 4} class="leo-btn">Next: Period Setup</button>
      </div>
    </div>

  <!-- Step 4: Period Configuration -->
  {:else if step === 4}
    <div class="leo-card p-6">
      <h2 class="leo-section-title mb-4" style="font-size: 18px; text-transform: none;">Period Configuration</h2>
      <p class="text-sm text-[#6b7280] mb-6">Set the start date for Period 1. Each period is 4 weeks (28 days), creating 13 periods per year.</p>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-[#374151] mb-1">Location Name</label>
          <input bind:value={locationName} type="text" class="leo-select w-full" />
        </div>
        <div>
          <label class="block text-sm font-medium text-[#374151] mb-1">Period 1 Start Date (should be a Monday)</label>
          <input bind:value={p1StartDate} type="date" class="leo-select w-full" />
        </div>
        <div class="rounded-lg p-4 text-sm text-[#4b5563]" style="background: #f8f9fa;">
          <strong>Period structure:</strong> 13 periods x 4 weeks (28 days) = 364 days<br/>
          P1: {p1StartDate} to {(() => { const d = new Date(p1StartDate + 'T12:00:00'); d.setDate(d.getDate() + 27); return d.toISOString().split('T')[0]; })()}<br/>
          P13 ends: {(() => { const d = new Date(p1StartDate + 'T12:00:00'); d.setDate(d.getDate() + 363); return d.toISOString().split('T')[0]; })()}
        </div>
      </div>
      <div class="flex gap-3 mt-6">
        <button onclick={() => step = 3} class="leo-btn-secondary">Back</button>
        <button onclick={saveLocation} disabled={loading} class="leo-btn" style="background: #16a34a;" onmouseenter={(e) => e.currentTarget.style.background='#15803d'} onmouseleave={(e) => e.currentTarget.style.background='#16a34a'}>
          {loading ? 'Saving...' : 'Save & Complete Setup'}
        </button>
      </div>
    </div>

  <!-- Step 5: Done -->
  {:else if step === 5}
    <div class="leo-card p-6 text-center">
      <div class="text-5xl mb-4">&#x2705;</div>
      <h2 class="text-2xl font-bold text-[#1a1a1a] mb-2">{locationName} is ready!</h2>
      <p class="text-sm text-[#6b7280] mb-6">Toast data will sync automatically at 5:00 AM EST daily. You can now configure the labor thresholds and start forecasting.</p>
      <div class="flex justify-center gap-4">
        <a href="/dashboard" class="leo-btn inline-block">Go to Dashboard</a>
        <a href="/dashboard/settings" class="leo-btn-secondary inline-block">Configure Thresholds</a>
      </div>
    </div>
  {/if}
</div>
