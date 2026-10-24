<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';

  const fohPositions = ['Server', 'Bartender', 'Host', 'Barista', 'Support'];
  const bohPositions = ['Line Cooks', 'Prep Cooks', 'Pastry', 'Dishwashers'];
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  let locationId = $state('');
  let locations = $state<{id: string; name: string}[]>([]);
  let singleLocation = $state(false);
  let year = $state(2026);
  let loading = $state(false);
  let generating = $state(false);
  let saving = $state(false);
  let generated = $state(false);

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

  function getWeekStartDate(): string {
    const p1Start = new Date('2025-12-29T12:00:00');
    const daysOffset = (periodNumber - 1) * 28 + (weekNumber - 1) * 7;
    const ws = new Date(p1Start);
    ws.setDate(ws.getDate() + daysOffset);
    return ws.toISOString().split('T')[0];
  }

  function getWeekDates(): string[] {
    const start = new Date(getWeekStartDate() + 'T12:00:00');
    return Array.from({length: 7}, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d.toISOString().split('T')[0];
    });
  }

  function formatShortDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    return `${d.getMonth()+1}/${d.getDate()}`;
  }

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------
  interface ShiftAssignment {
    employeeId: string; employeeName: string; position: string;
    startTime: string; endTime: string; shiftType: 'opener' | 'peak' | 'closer';
    hours: number; cost: number;
  }
  interface ScheduleDay { date: string; assignments: ShiftAssignment[]; }
  interface Employee {
    id: string; name: string; position: string; hourlyRate: number;
    weekHours: number; available: boolean[];
  }
  interface PositionSummary {
    position: string; needed: number; assigned: number; hours: number; cost: number;
  }

  let schedule = $state<ScheduleDay[]>([]);
  let employees = $state<Employee[]>([]);
  let projectedLabor = $state(0);
  let editingCell = $state<string | null>(null);

  // ---------------------------------------------------------------------------
  // Summary derivations
  // ---------------------------------------------------------------------------
  let totalScheduledHours = $derived(
    schedule.reduce((s, d) => s + d.assignments.reduce((a, x) => a + x.hours, 0), 0)
  );
  let totalScheduledCost = $derived(
    schedule.reduce((s, d) => s + d.assignments.reduce((a, x) => a + x.cost, 0), 0)
  );
  let costVariance = $derived(totalScheduledCost - projectedLabor);
  let weeklyForecastRevenue = $state(0);
  let laborPctOfRevenue = $derived(weeklyForecastRevenue > 0 ? (totalScheduledCost / weeklyForecastRevenue * 100) : 0);

  let employeeWeekHours = $derived(() => {
    const map: Record<string, {name: string; position: string; hours: number; cost: number}> = {};
    for (const day of schedule) {
      for (const a of day.assignments) {
        if (!map[a.employeeId]) map[a.employeeId] = {name: a.employeeName, position: a.position, hours: 0, cost: 0};
        map[a.employeeId].hours += a.hours;
        map[a.employeeId].cost += a.cost;
      }
    }
    return map;
  });

  let overtimeWarnings = $derived(() => {
    const ewh = employeeWeekHours();
    return Object.entries(ewh).filter(([_, e]) => e.hours >= 35)
      .map(([id, e]) => ({id, ...e, otHours: Math.max(0, e.hours - 40), otCost: Math.max(0, e.hours - 40) * (e.cost / e.hours) * 0.5}))
      .sort((a, b) => b.hours - a.hours);
  });

  let unfilledShifts = $derived(() => {
    const unfilled: {date: string; dayLabel: string; position: string}[] = [];
    schedule.forEach((day, i) => {
      const allPos = [...fohPositions, ...bohPositions];
      for (const pos of allPos) {
        const hasAssignment = day.assignments.some(a => a.position === pos);
        if (!hasAssignment) {
          // Only flag if position is typically staffed (simplified: always flag)
        }
      }
    });
    return unfilled;
  });

  let positionBreakdown = $derived(() => {
    const map: Record<string, PositionSummary> = {};
    for (const pos of [...fohPositions, ...bohPositions]) {
      map[pos] = { position: pos, needed: 0, assigned: 0, hours: 0, cost: 0 };
    }
    for (const day of schedule) {
      for (const a of day.assignments) {
        if (map[a.position]) {
          map[a.position].assigned++;
          map[a.position].hours += a.hours;
          map[a.position].cost += a.cost;
        }
      }
    }
    return Object.values(map).filter(p => p.assigned > 0 || p.needed > 0);
  });

  // Grouped employees by position for the grid
  let gridRows = $derived(() => {
    const rows: {employeeId: string; name: string; position: string; group: 'FOH' | 'BOH'; shifts: (ShiftAssignment | null)[]}[] = [];
    const seen = new Set<string>();
    for (const day of schedule) {
      for (const a of day.assignments) {
        if (!seen.has(a.employeeId)) {
          seen.add(a.employeeId);
          const group = fohPositions.includes(a.position) ? 'FOH' as const : 'BOH' as const;
          const shifts = schedule.map(d => d.assignments.find(x => x.employeeId === a.employeeId) ?? null);
          const totalH = shifts.reduce((s, x) => s + (x?.hours ?? 0), 0);
          const totalC = shifts.reduce((s, x) => s + (x?.cost ?? 0), 0);
          rows.push({employeeId: a.employeeId, name: a.employeeName, position: a.position, group, shifts});
        }
      }
    }
    // Sort FOH first, then BOH, alphabetical within
    rows.sort((a, b) => {
      if (a.group !== b.group) return a.group === 'FOH' ? -1 : 1;
      return a.position.localeCompare(b.position) || a.name.localeCompare(b.name);
    });
    return rows;
  });

  // ---------------------------------------------------------------------------
  // Load / Generate
  // ---------------------------------------------------------------------------
  async function loadLocations() {
    const supabase = getClientSupabase();
    const { data: { session } } = await supabase.auth.getSession();
    const email = session?.user?.email;
    const url = email ? `/api/v1/auth/my-locations?email=${encodeURIComponent(email)}` : '/api/v1/locations';
    const res = await fetch(url);
    const d = await res.json();
    locations = d.locations || d || [];
    singleLocation = locations.length === 1;
    if (locations.length > 0 && !locationId) {
      const saved = localStorage.getItem('helixo_selected_location');
      locationId = (saved && locations.some(l => l.id === saved)) ? saved : locations[0].id;
    }
  }

  async function generateSchedule() {
    if (!locationId) return;
    generating = true;
    try {
      const ws = getWeekStartDate();
      const res = await fetch(`/api/v1/schedule-builder?locationId=${locationId}&weekStart=${ws}&period=${periodNumber}&week=${weekNumber}&year=${year}`);
      const data = await res.json();
      // Flatten API response: data.days[].positions[].shifts[] → ScheduleDay[].assignments[]
      schedule = (data.days || []).map((day: any) => ({
        date: day.date,
        assignments: (day.positions || []).flatMap((pos: any) =>
          (pos.shifts || []).map((s: any) => ({
            employeeId: s.employeeId,
            employeeName: s.employeeName,
            position: s.position || pos.position,
            startTime: s.startTime,
            endTime: s.endTime,
            shiftType: s.shiftType,
            hours: s.hours,
            cost: s.cost,
          }))
        ),
      }));
      projectedLabor = data.totalCost || 0;
      // Fetch weekly forecast revenue for % of revenue calculation
      try {
        const fRes = await fetch(`/api/v1/forecast?locationId=${locationId}&startDate=${getWeekStartDate()}&endDate=${getWeekDates()[6]}`);
        if (fRes.ok) {
          const fData = await fRes.json();
          weeklyForecastRevenue = (fData.suggestions || []).reduce((s: number, f: any) => s + (f.managerRevenue || f.suggestedRevenue || 0), 0);
        }
      } catch {}
      generated = true;
    } catch (e) { console.error('Failed to generate schedule:', e); }
    generating = false;
  }

  async function saveDraft() {
    saving = true;
    try {
      await fetch('/api/v1/schedule-builder', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({locationId, weekStart: getWeekStartDate(), schedule, action: 'save_draft'}),
      });
    } catch (e) { console.error('Failed to save draft:', e); }
    saving = false;
  }

  async function submitForApproval() {
    saving = true;
    try {
      const supabase = getClientSupabase();
      const { data: { session } } = await supabase.auth.getSession();
      await fetch('/api/v1/schedule-builder', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({locationId, weekStart: getWeekStartDate(), schedule, action: 'submit', submittedBy: session?.user?.email}),
      });
    } catch (e) { console.error('Failed to submit:', e); }
    saving = false;
  }

  // ---------------------------------------------------------------------------
  // Cell editing
  // ---------------------------------------------------------------------------
  function cellKey(empId: string, dayIdx: number): string { return `${empId}-${dayIdx}`; }

  function startEdit(empId: string, dayIdx: number) { editingCell = cellKey(empId, dayIdx); }

  function removeAssignment(empId: string, dayIdx: number) {
    const day = schedule[dayIdx];
    if (day) {
      day.assignments = day.assignments.filter(a => a.employeeId !== empId);
      schedule = [...schedule];
    }
    editingCell = null;
  }

  function swapEmployee(empId: string, dayIdx: number, newEmpId: string) {
    const day = schedule[dayIdx];
    const assignment = day?.assignments.find(a => a.employeeId === empId);
    const newEmp = employees.find(e => e.id === newEmpId);
    if (assignment && newEmp) {
      assignment.employeeId = newEmp.id;
      assignment.employeeName = newEmp.name;
      assignment.cost = assignment.hours * newEmp.hourlyRate;
      schedule = [...schedule];
    }
    editingCell = null;
  }

  function getEligibleEmployees(position: string, dayIdx: number, excludeId: string): Employee[] {
    const ewh = employeeWeekHours();
    return employees.filter(e =>
      e.position === position && e.id !== excludeId &&
      (e.available?.[dayIdx] !== false) &&
      ((ewh[e.id]?.hours ?? 0) < 40)
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function fmt$(n: number): string { return '$' + Math.round(n).toLocaleString('en-US'); }

  function shiftBg(type: string): string {
    if (type === 'opener') return 'background: #dbeafe; color: #1e3a5f;';
    if (type === 'peak') return 'background: #1e3a5f; color: white;';
    if (type === 'closer') return 'background: #e5e7eb; color: #374151;';
    return 'background: #f9fafb; color: #9ca3af;';
  }

  function formatTime(t: string): string {
    if (!t) return '';
    const [h, m] = t.split(':').map(Number);
    const ampm = h >= 12 ? 'p' : 'a';
    const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return m === 0 ? `${hr}:00${ampm}` : `${hr}:${m.toString().padStart(2,'0')}${ampm}`;
  }

  // ---------------------------------------------------------------------------
  // Employee individual schedule modal
  // ---------------------------------------------------------------------------
  let selectedEmployeeId = $state<string | null>(null);

  let selectedEmployeeData = $derived(() => {
    if (!selectedEmployeeId) return null;
    const row = gridRows().find(r => r.employeeId === selectedEmployeeId);
    if (!row) return null;
    const weekDates = getWeekDates();
    const shifts = row.shifts.map((s, i) => ({
      dayLabel: dayLabels[i],
      date: weekDates[i],
      shift: s,
    }));
    const totalHours = row.shifts.reduce((s, x) => s + (x?.hours ?? 0), 0);
    const totalCost = row.shifts.reduce((s, x) => s + (x?.cost ?? 0), 0);
    const daysWorked = row.shifts.filter(x => x !== null).length;
    return { name: row.name, position: row.position, group: row.group, shifts, totalHours, totalCost, daysWorked };
  });

  function openEmployeeSchedule(empId: string, e: MouseEvent) {
    e.stopPropagation();
    selectedEmployeeId = empId;
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  $effect(() => { loadLocations(); });
</script>

<div class="p-3 md:p-4">
  <h1 class="text-xl md:text-2xl font-bold text-[#1a1a1a] mb-1">Schedule Builder</h1>
  <p class="text-sm text-[#6b7280] mb-6">Generate and adjust the AI-powered weekly employee schedule.</p>

  <!-- Selectors -->
  <div class="flex gap-2 mb-6 flex-wrap items-center">
    {#if singleLocation}
      <span class="text-sm font-medium text-[#374151]">{locations[0]?.name}</span>
    {:else}
      <select bind:value={locationId} onchange={() => { localStorage.setItem('helixo_selected_location', locationId); generated = false; }} class="leo-select">
        {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
      </select>
    {/if}
    <select bind:value={periodNumber} onchange={() => { generated = false; }} class="leo-select">
      {#each Array.from({length:13},(_,i)=>i+1) as p}<option value={p}>P{p}</option>{/each}
    </select>
    {#each [1,2,3,4] as w}
      <button onclick={() => { weekNumber = w; generated = false; }}
        class="px-4 py-2 rounded text-sm font-medium transition-colors"
        style="{weekNumber === w ? 'background: #1e3a5f; color: white;' : 'background: white; border: 1px solid #e5e7eb; color: #374151;'}">
        Week {w}
      </button>
    {/each}
    <span class="text-sm font-medium text-[#374151]">{year}</span>
    <button onclick={generateSchedule} disabled={generating || !locationId} class="leo-btn ml-auto">
      {generating ? 'Generating...' : generated ? '↻ Regenerate' : '⚡ Generate AI Schedule'}
    </button>
  </div>

  {#if generating}
    <div class="text-center py-20 text-[#9ca3af]">Generating AI schedule...</div>
  {:else if !generated}
    <div class="leo-card p-12 text-center">
      <p class="text-[#6b7280] text-sm mb-4">Select a location and week, then click <strong>Generate AI Schedule</strong> to create an optimized employee schedule based on forecasted demand.</p>
    </div>
  {:else}
    <!-- Summary Cards -->
    <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
      <div class="leo-card p-4 text-center">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Scheduled Hours</div>
        <div class="text-xl font-bold text-[#1a1a1a]">{totalScheduledHours.toFixed(1)}</div>
      </div>
      <div class="leo-card p-4 text-center">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Scheduled Labor $</div>
        <div class="text-xl font-bold text-[#1a1a1a]">{fmt$(totalScheduledCost)}</div>
      </div>
      <div class="leo-card p-4 text-center">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">vs Projected</div>
        <div class="text-xl font-bold" style="color: {costVariance > 0 ? '#dc2626' : costVariance < 0 ? '#16a34a' : '#1a1a1a'}">
          {costVariance >= 0 ? '+' : ''}{fmt$(costVariance)}
        </div>
      </div>
      <div class="leo-card p-4 text-center">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">OT Warnings</div>
        <div class="text-xl font-bold" style="color: {overtimeWarnings().length > 0 ? '#dc2626' : '#1a1a1a'}">
          {overtimeWarnings().length}
          {#if overtimeWarnings().length > 0}<span class="inline-block ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-[#dc2626] text-white">{overtimeWarnings().length}</span>{/if}
        </div>
      </div>
      <div class="leo-card p-4 text-center">
        <div class="text-xs text-[#6b7280] uppercase tracking-wide mb-1">Unfilled Shifts</div>
        <div class="text-xl font-bold" style="color: {unfilledShifts().length > 0 ? '#ea580c' : '#1a1a1a'}">
          {unfilledShifts().length}
          {#if unfilledShifts().length > 0}<span class="inline-block ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-[#ea580c] text-white">{unfilledShifts().length}</span>{/if}
        </div>
      </div>
    </div>

    <!-- Schedule Grid -->
    {#each [{title: 'FOH', positions: fohPositions}, {title: 'BOH', positions: bohPositions}] as section}
      {@const sectionRows = gridRows().filter(r => r.group === section.title)}
      {#if sectionRows.length > 0}
        <h2 class="leo-section-title mt-6 mb-3">{section.title} Positions</h2>
        <div class="leo-card mb-4 leo-table-scroll">
          <table class="w-full leo-table" style="min-width: 900px;">
            <thead>
              <tr>
                <th class="leo-th" style="text-align: left; width: 140px;">Employee</th>
                <th class="leo-th" style="text-align: left; width: 90px;">Position</th>
                {#each dayLabels as dl, i}
                  <th class="leo-th" style="min-width: 110px;">{dl}<br/><span style="font-size:10px;font-weight:400;">{formatShortDate(getWeekDates()[i])}</span></th>
                {/each}
                <th class="leo-th" style="width: 70px;">Hours</th>
                <th class="leo-th" style="width: 80px;">Cost</th>
                <th class="leo-th" style="width: 70px;">% Rev</th>
              </tr>
            </thead>
            <tbody>
              {#each sectionRows as row}
                {@const rowHours = row.shifts.reduce((s, x) => s + (x?.hours ?? 0), 0)}
                {@const rowCost = row.shifts.reduce((s, x) => s + (x?.cost ?? 0), 0)}
                <tr>
                  <td class="leo-td font-medium" style="text-align: left;">
                    <button class="text-left hover:underline" style="color: #1e3a5f; font-weight: 600; cursor: pointer; background: none; border: none; padding: 0;"
                            onclick={(e) => openEmployeeSchedule(row.employeeId, e)}>
                      {row.name}
                    </button>
                  </td>
                  <td class="leo-td text-xs text-[#6b7280]" style="text-align: left;">{row.position}</td>
                  {#each row.shifts as shift, dayIdx}
                    <td class="leo-td relative cursor-pointer" style="{shift ? shiftBg(shift.shiftType) : 'background: #f9fafb; color: #d1d5db;'}"
                        onclick={() => startEdit(row.employeeId, dayIdx)}>
                      {#if editingCell === cellKey(row.employeeId, dayIdx)}
                        <div class="absolute top-full left-0 z-20 bg-white border border-[#e5e7eb] rounded shadow-lg p-2 min-w-[200px]" style="margin-top: 2px;"
                             onclick={(e) => e.stopPropagation()}>
                          <div class="text-xs font-semibold text-[#374151] mb-1">Swap Employee</div>
                          {#each getEligibleEmployees(row.position, dayIdx, row.employeeId) as emp}
                            <button class="block w-full text-left px-2 py-1 text-xs hover:bg-[#f1f5f9] rounded"
                                    onclick={() => swapEmployee(row.employeeId, dayIdx, emp.id)}>
                              {emp.name} <span class="text-[#9ca3af]">({fmt$(emp.hourlyRate)}/hr, {(employeeWeekHours()[emp.id]?.hours ?? 0).toFixed(1)}h)</span>
                            </button>
                          {/each}
                          {#if getEligibleEmployees(row.position, dayIdx, row.employeeId).length === 0}
                            <div class="text-xs text-[#9ca3af] py-1">No eligible employees available</div>
                          {/if}
                          <hr class="my-1 border-[#e5e7eb]"/>
                          <button class="block w-full text-left px-2 py-1 text-xs text-[#dc2626] hover:bg-red-50 rounded"
                                  onclick={() => removeAssignment(row.employeeId, dayIdx)}>Remove Assignment</button>
                          <button class="block w-full text-left px-2 py-1 text-xs text-[#6b7280] hover:bg-[#f1f5f9] rounded"
                                  onclick={() => { editingCell = null; }}>Cancel</button>
                        </div>
                      {:else if shift}
                        <div class="text-xs font-medium">{formatTime(shift.startTime)} - {formatTime(shift.endTime)}</div>
                      {:else}
                        <span class="text-xs">—</span>
                      {/if}
                    </td>
                  {/each}
                  <td class="leo-td font-semibold" style="{rowHours >= 40 ? 'color: #dc2626;' : ''}">{rowHours.toFixed(1)}</td>
                  <td class="leo-td font-semibold">{fmt$(rowCost)}</td>
                  <td class="leo-td text-center" style="font-size: 12px;">{weeklyForecastRevenue > 0 ? (rowCost / weeklyForecastRevenue * 100).toFixed(1) + '%' : '-'}</td>
                </tr>
              {/each}
            </tbody>
            {#snippet sectionTotals()}
              {@const sHrs = sectionRows.reduce((s, r) => s + r.shifts.reduce((a, x) => a + (x?.hours ?? 0), 0), 0)}
              {@const sCost = sectionRows.reduce((s, r) => s + r.shifts.reduce((a, x) => a + (x?.cost ?? 0), 0), 0)}
              <tr style="background: #f1f5f9; border-top: 2px solid #1e3a5f;">
                <td colspan="2" style="text-align: left; font-weight: 700; padding: 5px 6px; font-size: 11px;">{section.title} TOTAL</td>
                {#each dayLabels as _, i}
                  <td style="font-weight: 600; padding: 5px 6px; font-size: 11px; text-align: center; background: #f1f5f9;">{fmt$(sectionRows.reduce((s, r) => s + (r.shifts[i]?.cost ?? 0), 0))}</td>
                {/each}
                <td style="font-weight: 700; padding: 5px 6px; font-size: 11px; text-align: center; background: #f1f5f9;">{sHrs.toFixed(1)}</td>
                <td style="font-weight: 700; padding: 5px 6px; font-size: 11px; text-align: center; background: #f1f5f9;">{fmt$(sCost)}</td>
                <td style="font-weight: 700; padding: 5px 6px; font-size: 11px; text-align: center; background: #f1f5f9;">{weeklyForecastRevenue > 0 ? (sCost / weeklyForecastRevenue * 100).toFixed(1) + '%' : '-'}</td>
              </tr>
            {/snippet}
            <tfoot>
              {@render sectionTotals()}
            </tfoot>
          </table>
        </div>
      {/if}
    {/each}

    <!-- Position Breakdown -->
    <h2 class="leo-section-title mt-6 mb-3">Position Breakdown</h2>
    <div class="leo-card mb-4 leo-table-scroll">
      <table class="w-full leo-table">
        <thead>
          <tr>
            <th class="leo-th" style="text-align: left;">Position</th>
            <th class="leo-th">Headcount</th>
            <th class="leo-th">Hours</th>
            <th class="leo-th">Cost</th>
          </tr>
        </thead>
        <tbody>
          {#each positionBreakdown() as pb}
            <tr>
              <td class="leo-td font-medium" style="text-align: left;">{pb.position}</td>
              <td class="leo-td" style="{pb.needed > 0 && pb.assigned < pb.needed ? 'color: #dc2626; font-weight: 600;' : pb.assigned >= pb.needed ? 'color: #16a34a;' : ''}">{pb.assigned}{pb.needed > 0 ? ` / ${pb.needed}` : ''}</td>
              <td class="leo-td">{pb.hours.toFixed(1)}</td>
              <td class="leo-td">{fmt$(pb.cost)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <!-- Overtime Warnings -->
    {#if overtimeWarnings().length > 0}
      <h2 class="leo-section-title mt-6 mb-3">Overtime Warnings</h2>
      <div class="leo-card mb-4 leo-table-scroll">
        <table class="w-full leo-table">
          <thead>
            <tr>
              <th class="leo-th" style="text-align: left;">Employee</th>
              <th class="leo-th">Position</th>
              <th class="leo-th">Scheduled Hrs</th>
              <th class="leo-th">OT Hours</th>
              <th class="leo-th">Est. OT Cost</th>
            </tr>
          </thead>
          <tbody>
            {#each overtimeWarnings() as ow}
              <tr>
                <td class="leo-td font-medium" style="text-align: left;">{ow.name}</td>
                <td class="leo-td">{ow.position}</td>
                <td class="leo-td" style="{ow.hours >= 40 ? 'color: #dc2626; font-weight: 600;' : 'color: #ea580c; font-weight: 600;'}">{ow.hours.toFixed(1)}</td>
                <td class="leo-td" style="color: #dc2626; font-weight: 600;">{ow.otHours.toFixed(1)}</td>
                <td class="leo-td" style="color: #dc2626; font-weight: 600;">{fmt$(ow.otCost)}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}

    <!-- Action Buttons -->
    <div class="flex gap-3 mt-6 flex-wrap">
      <button onclick={generateSchedule} disabled={generating} class="leo-btn-secondary">{generating ? 'Regenerating...' : '↻ Regenerate'}</button>
      <button onclick={saveDraft} disabled={saving} class="leo-btn-secondary">{saving ? 'Saving...' : 'Save Draft'}</button>
      <button onclick={submitForApproval} disabled={saving} class="leo-btn">Submit for Approval</button>
      <button disabled class="leo-btn-secondary opacity-50 cursor-not-allowed" title="Coming soon — push shifts to Dolce TeamWork">Push to Dolce</button>
    </div>
  {/if}
</div>

<!-- Employee Individual Schedule Modal -->
{#if selectedEmployeeId && selectedEmployeeData()}
  {@const emp = selectedEmployeeData()!}
  <!-- Backdrop -->
  <div class="fixed inset-0 z-40" style="background: rgba(0,0,0,0.4);"
       onclick={() => { selectedEmployeeId = null; }}></div>
  <!-- Modal -->
  <div class="fixed z-50 bg-white rounded-lg shadow-xl" style="top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(520px, calc(100vw - 32px)); max-height: 90vh; overflow-y: auto;">
    <!-- Header -->
    <div class="flex items-center justify-between px-5 py-4" style="border-bottom: 1px solid #e5e7eb;">
      <div>
        <h2 class="text-base font-bold" style="color: #1e3a5f;">{emp.name}</h2>
        <p class="text-xs text-[#6b7280]">{emp.position} · {emp.group} · {emp.daysWorked} day{emp.daysWorked !== 1 ? 's' : ''} this week</p>
      </div>
      <button onclick={() => { selectedEmployeeId = null; }}
              style="color: #9ca3af; font-size: 20px; line-height: 1; background: none; border: none; cursor: pointer; padding: 4px 8px;">&times;</button>
    </div>
    <!-- Week Grid -->
    <div class="px-5 py-4">
      <div class="space-y-2">
        {#each emp.shifts as s}
          <div class="flex items-center rounded" style="padding: 8px 10px; {s.shift ? shiftBg(s.shift.shiftType) : 'background: #f9fafb; color: #d1d5db;'}">
            <div style="width: 60px; font-size: 11px; font-weight: 600; flex-shrink: 0;">{s.dayLabel}</div>
            <div style="width: 56px; font-size: 11px; color: inherit; opacity: 0.7; flex-shrink: 0;">{formatShortDate(s.date)}</div>
            {#if s.shift}
              <div style="flex: 1; font-size: 12px; font-weight: 500;">{formatTime(s.shift.startTime)} – {formatTime(s.shift.endTime)}</div>
              <div style="font-size: 11px; margin-right: 12px;">{s.shift.hours.toFixed(1)}h</div>
              <div style="font-size: 11px; font-weight: 600;">{fmt$(s.shift.cost)}</div>
            {:else}
              <div style="flex: 1; font-size: 12px;">Off</div>
            {/if}
          </div>
        {/each}
      </div>
      <!-- Totals -->
      <div class="flex justify-between mt-4 pt-3" style="border-top: 2px solid #1e3a5f;">
        <span class="text-sm font-bold" style="color: #1e3a5f;">Weekly Total</span>
        <div class="flex gap-6">
          <span class="text-sm font-bold" style="color: {emp.totalHours >= 40 ? '#dc2626' : '#1e3a5f'};">{emp.totalHours.toFixed(1)} hrs</span>
          <span class="text-sm font-bold" style="color: #1e3a5f;">{fmt$(emp.totalCost)}</span>
        </div>
      </div>
      {#if emp.totalHours >= 35}
        <div class="mt-2 px-3 py-2 rounded text-xs font-medium" style="background: #fef2f2; color: #dc2626;">
          {emp.totalHours >= 40 ? `Overtime: ${(emp.totalHours - 40).toFixed(1)} hrs over 40` : `Approaching overtime — ${(40 - emp.totalHours).toFixed(1)} hrs remaining`}
        </div>
      {/if}
    </div>
  </div>
{/if}

<!-- Close dropdown on outside click -->
<svelte:window onclick={() => { if (editingCell) editingCell = null; }} />
