<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  let locationId = $state('');
  let locations = $state<{ id: string; name: string }[]>([]);
  let singleLocation = $state(false);
  let loading = $state(false);
  let year = $state(2026);

  // Period / Week detection (matches Dashboard, Forecast, Labor Detail, etc.)
  function detectCurrentPeriodAndWeek(): { period: number; week: number } {
    const p1Start = new Date('2025-12-29T12:00:00');
    const today = new Date();
    const daysSinceP1 = Math.floor((today.getTime() - p1Start.getTime()) / (1000 * 60 * 60 * 24));
    const period = Math.min(13, Math.max(1, Math.floor(daysSinceP1 / 28) + 1));
    const dayInPeriod = daysSinceP1 % 28;
    const week = Math.min(4, Math.floor(dayInPeriod / 7) + 1);
    return { period, week };
  }

  const detected = detectCurrentPeriodAndWeek();
  let periodNumber = $state(detected.period);
  let weekNumber = $state(detected.week);

  function getWeekDateRange(period: number, wk: number): { start: string; end: string } {
    const p1Start = new Date('2025-12-29T12:00:00');
    const daysOffset = (period - 1) * 28 + (wk - 1) * 7;
    const weekStart = new Date(p1Start.getTime() + daysOffset * 86400000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    return {
      start: weekStart.toISOString().split('T')[0],
      end: weekEnd.toISOString().split('T')[0],
    };
  }

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  interface ShiftSlot { start: string; end: string; count: number; role: string; }
  interface PositionStaffing {
    position: string; targetLaborDollars: number; avgHourlyRate: number;
    totalHoursNeeded: number; shifts: ShiftSlot[]; totalHeadcount: number;
  }
  interface DayRecommendation {
    date: string; forecastRevenue: number; positions: PositionStaffing[];
    totalHeadcount: number; totalLaborBudget: number; laborPctOfForecast: number;
    serviceStyle: string;
  }
  interface PositionActual { position: string; dollars: number; hours: number; }
  interface HourlyRevenue { hour: number; revenue: number; }
  interface DayActuals {
    date: string; laborByPosition: PositionActual[]; hourlyRevenue: HourlyRevenue[];
    totalLaborDollars: number; totalRevenue: number;
  }
  interface ShiftPattern {
    date: string; dayOfWeek: number; openHours: number[];
    peakHours: number[]; closeHours: number[]; peakRevenue: number;
  }

  let days = $state<DayRecommendation[]>([]);
  let actuals = $state<DayActuals[]>([]);
  let patterns = $state<ShiftPattern[]>([]);
  let selectedDayIdx = $state(0);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function fmt$(n: number): string { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n: number): string { return (n * 100).toFixed(1) + '%'; }

  function formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function formatDateFull(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function isPastDay(dateStr: string): boolean {
    const today = new Date().toISOString().split('T')[0];
    return dateStr < today;
  }

  function getActualsForDate(dateStr: string): DayActuals | null {
    return actuals.find(a => a.date === dateStr) ?? null;
  }

  function getPatternForDate(dateStr: string): ShiftPattern | null {
    return patterns.find(p => p.date === dateStr) ?? null;
  }

  function getActualForPosition(dayActuals: DayActuals | null, position: string): PositionActual | null {
    if (!dayActuals) return null;
    return dayActuals.laborByPosition.find(p => p.position === position) ?? null;
  }

  function timeToHour(t: string): number {
    const match = t.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if (!match) return 0;
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const ampm = match[3].toUpperCase();
    if (ampm === 'PM' && h !== 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h + m / 60;
  }

  function shiftBarStyle(shift: ShiftSlot): string {
    const rangeStart = 6; const rangeEnd = 24; const span = rangeEnd - rangeStart;
    const s = Math.max(rangeStart, timeToHour(shift.start));
    const e = Math.min(rangeEnd, timeToHour(shift.end));
    const left = ((s - rangeStart) / span) * 100;
    const width = ((e - s) / span) * 100;
    return `left: ${left.toFixed(1)}%; width: ${width.toFixed(1)}%;`;
  }

  function peakBarStyle(hour: number): string {
    const rangeStart = 6; const rangeEnd = 24; const span = rangeEnd - rangeStart;
    const left = ((hour - rangeStart) / span) * 100;
    const width = (1 / span) * 100;
    return `left: ${left.toFixed(1)}%; width: ${width.toFixed(1)}%;`;
  }

  const ROLE_COLORS: Record<string, string> = {
    opener: '#1e3a5f', peak: '#2d6a9f', closer: '#5b8cbf', full: '#3b7dbd',
  };

  function varianceColor(variance: number): string {
    return variance <= 0 ? '#16a34a' : '#dc2626';
  }

  /** Compute actual worked hour bar span from hourly revenue + position name. */
  function getActualBarSpan(da: DayActuals | null, pos: string, pa: PositionActual | null): { s: number; e: number } | null {
    if (!da || !pa || pa.hours <= 0) return null;
    const hr = da.hourlyRevenue;
    if (!hr || hr.length === 0) {
      const half = pa.hours / 2;
      return { s: Math.max(6, 14 - half), e: Math.min(24, 14 + half) };
    }
    const mx = Math.max(...hr.map(h => h.revenue));
    const active = hr.filter(h => h.revenue >= mx * 0.05).map(h => h.hour);
    if (active.length === 0) return null;
    const isBOH = /cook|kitchen|prep|dish|boh/i.test(pos);
    const first = Math.min(...active), last = Math.max(...active);
    return { s: Math.max(6, isBOH ? first - 1 : first), e: Math.min(24, last + 1) };
  }

  function actualBarStyle(s: number, e: number): string {
    const span = 18; // 24 - 6
    return `left: ${(((s - 6) / span) * 100).toFixed(1)}%; width: ${(((e - s) / span) * 100).toFixed(1)}%;`;
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  async function load() {
    if (!locationId) return;
    loading = true;
    try {
      const range = getWeekDateRange(periodNumber, weekNumber);
      const res = await fetch(
        `/api/v1/staffing?locationId=${locationId}&startDate=${range.start}&endDate=${range.end}`
      );
      const data = await res.json();
      days = data.days || [];
      actuals = data.actuals || [];
      patterns = data.patterns || [];
      selectedDayIdx = 0;
    } catch (e) {
      console.error('[Staffing]', e);
      days = []; actuals = []; patterns = [];
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email;
      const url = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
      fetch(url)
        .then((r) => r.json())
        .then((d) => {
          locations = d.locations || d || [];
          singleLocation = locations.length === 1;
          if (locations.length > 0) {
            const saved = localStorage.getItem('helixo_selected_location');
            locationId = saved && locations.some((l) => l.id === saved) ? saved : locations[0].id;
            load();
          }
        });
    });
  });

  function onLocationChange(e: Event) {
    locationId = (e.target as HTMLSelectElement).value;
    localStorage.setItem('helixo_selected_location', locationId);
    load();
  }

  let selectedDay = $derived(days[selectedDayIdx] ?? null);
  let selectedDayActuals = $derived(selectedDay ? getActualsForDate(selectedDay.date) : null);
  let selectedDayPattern = $derived(selectedDay ? getPatternForDate(selectedDay.date) : null);
  let selectedDayIsPast = $derived(selectedDay ? isPastDay(selectedDay.date) : false);
</script>

<svelte:head>
  <title>HELIXO | Predictive Staffing</title>
</svelte:head>

<div class="py-8">
  <!-- Header + Controls -->
  <div class="flex flex-col md:flex-row md:items-end gap-4 mb-8">
    <div class="flex-1">
      <h1 class="text-2xl font-bold tracking-tight" style="color: #1e3a5f; font-family: 'Inter', sans-serif;">
        Predictive Staffing
      </h1>
      <p class="text-sm mt-1" style="color: #6b7280;">
        Shift recommendations vs actuals by position and day
      </p>
    </div>

    <div class="flex flex-wrap items-end gap-3">
      <div>
        <label class="block text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Location</label>
        {#if singleLocation}
          <span class="text-sm font-medium text-[#374151] py-2">{locations[0]?.name}</span>
        {:else}
          <select onchange={onLocationChange} class="leo-select" value={locationId}>
            {#each locations as loc}
              <option value={loc.id}>{loc.name}</option>
            {/each}
          </select>
        {/if}
      </div>

      <div>
        <label class="block text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Period</label>
        <select bind:value={periodNumber} onchange={load} class="leo-select">
          {#each Array.from({length: 13}, (_, i) => i + 1) as p}
            <option value={p}>P{p}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="block text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Week</label>
        <select bind:value={weekNumber} onchange={load} class="leo-select">
          {#each [1, 2, 3, 4] as w}
            <option value={w}>W{w}</option>
          {/each}
        </select>
      </div>

      <div>
        <label class="block text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Year</label>
        <span class="text-sm font-medium px-3 py-2 inline-block" style="color: #374151;">{year}</span>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="flex items-center justify-center py-24">
      <p class="text-sm" style="color: #9ca3af;">Loading staffing recommendations...</p>
    </div>
  {:else if days.length === 0}
    <div class="leo-card p-8 text-center">
      <p class="text-sm" style="color: #6b7280;">No forecast data available for the selected week. Lock forecasts first.</p>
    </div>
  {:else}
    <!-- Day selector tabs (Mon-Sun) -->
    <div class="flex gap-2 mb-6 overflow-x-auto pb-2">
      {#each days as day, i}
        <button
          onclick={() => selectedDayIdx = i}
          class="flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          style="{selectedDayIdx === i
            ? 'background: #1e3a5f; color: white;'
            : isPastDay(day.date)
              ? 'background: #f0fdf4; color: #4b5563; border: 1px solid #bbf7d0;'
              : 'background: white; color: #4b5563; border: 1px solid #d1d5db;'}"
        >
          {formatDate(day.date)}
          {#if isPastDay(day.date)}
            <span class="text-[9px] block" style="color: {selectedDayIdx === i ? '#93c5fd' : '#16a34a'};">has actuals</span>
          {/if}
        </button>
      {/each}
    </div>

    {#if selectedDay}
      <!-- Grand totals card -->
      <div class="leo-card p-6 mb-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold" style="color: #1e3a5f; font-family: 'Inter', sans-serif;">
            {formatDateFull(selectedDay.date)}
          </h2>
          <div class="flex items-center gap-2">
            {#if selectedDayIsPast}
              <span class="text-xs uppercase tracking-wider px-3 py-1 rounded-full font-medium"
                style="background: rgba(22,163,74,0.1); color: #16a34a;">
                Actuals Available
              </span>
            {/if}
            <span class="text-xs uppercase tracking-wider px-3 py-1 rounded-full font-medium"
              style="background: rgba(30,58,95,0.08); color: #1e3a5f;">
              {selectedDay.serviceStyle.replace(/_/g, ' ')}
            </span>
          </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div class="rounded-lg p-4" style="background: #f8f9fa;">
            <p class="text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Forecast Revenue</p>
            <p class="text-xl font-bold" style="color: #1e3a5f;">{fmt$(selectedDay.forecastRevenue)}</p>
            {#if selectedDayIsPast && selectedDayActuals}
              <p class="text-xs mt-1" style="color: #6b7280;">Actual: {fmt$(selectedDayActuals.totalRevenue)}</p>
            {/if}
          </div>
          <div class="rounded-lg p-4" style="background: #f8f9fa;">
            <p class="text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Total Headcount</p>
            <p class="text-xl font-bold" style="color: #1e3a5f;">{selectedDay.totalHeadcount}</p>
          </div>
          <div class="rounded-lg p-4" style="background: #f8f9fa;">
            <p class="text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Projected Labor</p>
            <p class="text-xl font-bold" style="color: #1e3a5f;">{fmt$(selectedDay.totalLaborBudget)}</p>
            {#if selectedDayIsPast && selectedDayActuals}
              {@const variance = selectedDayActuals.totalLaborDollars - selectedDay.totalLaborBudget}
              <p class="text-xs mt-1 font-medium" style="color: {varianceColor(variance)};">
                Actual: {fmt$(selectedDayActuals.totalLaborDollars)} ({variance >= 0 ? '+' : ''}{fmt$(variance)})
              </p>
            {/if}
          </div>
          <div class="rounded-lg p-4" style="background: #f8f9fa;">
            <p class="text-[10px] uppercase tracking-widest font-semibold mb-1" style="color: #6b7280;">Labor % of Forecast</p>
            <p class="text-xl font-bold" style="color: {selectedDay.laborPctOfForecast > 0.32 ? '#dc2626' : '#1e3a5f'};">
              {pct(selectedDay.laborPctOfForecast)}
            </p>
          </div>
        </div>
      </div>

      <!-- Timeline legend -->
      <div class="flex items-center gap-5 mb-4">
        <div class="flex items-center gap-1.5 text-xs" style="color: #4b5563;">
          <span class="inline-block w-4 h-3 rounded" style="background: #1e3a5f;"></span> Projected
        </div>
        {#if selectedDayIsPast}
          <div class="flex items-center gap-1.5 text-xs" style="color: #4b5563;">
            <span class="inline-block w-4 h-3 rounded" style="background: #16a34a;"></span> Actual
          </div>
          <div class="flex items-center gap-1.5 text-xs" style="color: #4b5563;">
            <span class="inline-block w-4 h-1 rounded" style="background: #ef4444;"></span> Peak hours
          </div>
        {/if}
      </div>

      <!-- Position cards -->
      <div class="grid gap-4">
        {#each selectedDay.positions as pos}
          {@const posActual = selectedDayIsPast ? getActualForPosition(selectedDayActuals, pos.position) : null}
          {@const actualSpan = selectedDayIsPast ? getActualBarSpan(selectedDayActuals, pos.position, posActual) : null}
          <div class="leo-card p-5">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
              <div>
                <h3 class="text-base font-semibold" style="color: #1e3a5f; font-family: 'Inter', sans-serif;">
                  {pos.position}
                </h3>
                <div class="text-xs mt-1 flex flex-wrap gap-x-4 gap-y-0.5" style="color: #6b7280;">
                  <span style="color: #1e3a5f; font-weight: 600;">Projected: {pos.totalHeadcount} staff, {pos.totalHoursNeeded} hrs, {fmt$(pos.targetLaborDollars)}</span>
                  {#if posActual}
                    <span style="color: #16a34a; font-weight: 600;">Actual: {posActual.hours.toFixed(1)} hrs, {fmt$(posActual.dollars)}</span>
                    {@const hrsVar = posActual.hours - pos.totalHoursNeeded}
                    {@const dolVar = posActual.dollars - pos.targetLaborDollars}
                    <span style="color: {varianceColor(dolVar)}; font-weight: 600;">
                      Variance: {hrsVar >= 0 ? '+' : ''}{hrsVar.toFixed(1)} hrs, {dolVar >= 0 ? '+' : ''}{fmt$(dolVar)}
                    </span>
                  {/if}
                </div>
              </div>
              <div class="flex items-center gap-4">
                <div class="text-center">
                  <span class="text-[10px] uppercase tracking-wider font-semibold block" style="color: #6b7280;">Projected</span>
                  <span class="text-2xl font-bold" style="color: #1e3a5f;">{pos.totalHeadcount}</span>
                </div>
                {#if posActual}
                  <div class="text-center">
                    <span class="text-[10px] uppercase tracking-wider font-semibold block" style="color: #6b7280;">Actual $</span>
                    <span class="text-lg font-bold" style="color: #4b5563;">{fmt$(posActual.dollars)}</span>
                  </div>
                  {@const variance = posActual.dollars - pos.targetLaborDollars}
                  <div class="text-center">
                    <span class="text-[10px] uppercase tracking-wider font-semibold block" style="color: #6b7280;">Variance</span>
                    <span class="text-lg font-bold" style="color: {varianceColor(variance)};">
                      {variance >= 0 ? '+' : ''}{fmt$(variance)}
                    </span>
                  </div>
                {/if}
              </div>
            </div>

            <!-- Shift timeline -->
            <div class="mt-3">
              <div class="flex justify-between text-[10px] mb-1" style="color: #9ca3af;">
                <span>6 AM</span><span>9 AM</span><span>12 PM</span><span>3 PM</span><span>6 PM</span><span>9 PM</span><span>12 AM</span>
              </div>
              {#if true}
              {@const barRows = pos.shifts.length + (actualSpan ? 1 : 0)}
              {@const peakRow = selectedDayIsPast && selectedDayPattern ? 1 : 0}
              <div class="relative rounded-lg overflow-hidden" style="height: {Math.max(28, barRows * 28) + peakRow * 20}px; background: #f3f4f6;">
                <!-- Projected shift bars (navy) -->
                {#each pos.shifts as shift, si}
                  <div
                    class="absolute rounded"
                    style="
                      {shiftBarStyle(shift)}
                      top: {si * 28}px; height: 24px;
                      background: {ROLE_COLORS[shift.role] || '#1e3a5f'}; opacity: 0.9;
                    "
                    title="{shift.count}x {shift.role} ({shift.start} - {shift.end})"
                  >
                    <span class="text-[10px] text-white font-medium px-2 leading-6 truncate block">
                      {shift.count}x {shift.role} ({shift.start}-{shift.end})
                    </span>
                  </div>
                {/each}
                <!-- Actual worked hours bar (green) for past days -->
                {#if actualSpan}
                  <div
                    class="absolute rounded"
                    style="
                      {actualBarStyle(actualSpan.s, actualSpan.e)}
                      top: {pos.shifts.length * 28}px; height: 24px;
                      background: #16a34a; opacity: 0.85;
                    "
                    title="Actual: {posActual?.hours.toFixed(1)} hrs ({Math.floor(actualSpan.s)}:00 - {Math.floor(actualSpan.e)}:00)"
                  >
                    <span class="text-[10px] text-white font-medium px-2 leading-6 truncate block">
                      Actual {posActual?.hours.toFixed(1)} hrs
                    </span>
                  </div>
                {/if}
                <!-- Peak hour markers for past days -->
                {#if selectedDayIsPast && selectedDayPattern}
                  {#each selectedDayPattern.peakHours as peakHr}
                    <div
                      class="absolute rounded-sm"
                      style="
                        {peakBarStyle(peakHr)}
                        bottom: 0; height: 16px;
                        background: rgba(239,68,68,0.25); border-top: 2px solid #ef4444;
                      "
                      title="Actual peak: {peakHr}:00"
                    ></div>
                  {/each}
                {/if}
              </div>
              {/if}
            </div>

            <!-- Shift detail table -->
            <div class="mt-3 overflow-x-auto">
              <table class="w-full text-xs" style="color: #4b5563;">
                <thead>
                  <tr style="border-bottom: 1px solid #e5e7eb;">
                    <th class="leo-th text-left py-1.5">Shift</th>
                    <th class="leo-th text-left py-1.5">Time</th>
                    <th class="leo-th text-right py-1.5">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {#each pos.shifts as shift}
                    <tr style="border-bottom: 1px solid #f3f4f6;">
                      <td class="leo-td py-1.5 capitalize">{shift.role}</td>
                      <td class="leo-td py-1.5">{shift.start} - {shift.end}</td>
                      <td class="leo-td py-1.5 text-right font-medium" style="color: #1e3a5f;">{shift.count}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {/each}
      </div>

      <!-- Export button (future) -->
      <div class="mt-6 flex justify-end">
        <button
          disabled
          class="px-5 py-2.5 rounded-lg text-sm font-medium"
          style="background: #e5e7eb; color: #9ca3af; cursor: not-allowed;"
          title="Coming soon"
        >
          Export to Dolce (Coming Soon)
        </button>
      </div>
    {/if}
  {/if}
</div>
