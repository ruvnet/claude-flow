<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getClientSupabase } from '$lib/supabase-client';
  import Chart from 'chart.js/auto';

  // ── State ──
  let locationId   = $state('');
  let locations    = $state<{ id: string; name: string }[]>([]);
  let activeTab    = $state('surveys');
  let range        = $state('all');
  let data         = $state<any>(null);
  let servers      = $state<any[]>([]);
  let comments     = $state<any[]>([]);
  let commentsTotal = $state(0);
  let commentsPage  = $state(1);
  let commentsTotalPages = $state(1);
  let commentSegment = $state('all');
  let loading      = $state(false);

  const TABS = [
    { id: 'surveys',   label: 'Guest Surveys' },
    { id: 'ratings',   label: 'Reservation Ratings' },
    { id: 'servers',   label: 'Server Performance' },
    { id: 'comments',  label: 'Guest Comments' },
    { id: 'guestinfo', label: 'Guest Info' },
    { id: 'pace',      label: 'Pace Report' },
  ];

  // ── Chart management ──
  let chartInstances: Record<string, Chart> = {};
  function destroyChart(id: string) { chartInstances[id]?.destroy(); delete chartInstances[id]; }
  function destroyAll() { Object.values(chartInstances).forEach(c => c.destroy()); chartInstances = {}; }

  const CHART_OPTS = { responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' as const, labels: { usePointStyle: true, padding: 14, font: { family: 'Inter', size: 11 } } } },
    scales: { x: { grid: { display: false }, ticks: { font: { family: 'Inter', size: 10 } } },
               y: { grid: { color: '#f0f2f5' }, ticks: { font: { family: 'Inter', size: 10 } } } },
  };

  function mkLine(id: string, labels: string[], datasets: any[], yMin?: number, yMax?: number) {
    destroyChart(id);
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (!el) return;
    const opts: any = { ...CHART_OPTS, scales: { ...CHART_OPTS.scales } };
    if (yMin != null || yMax != null) opts.scales.y = { ...opts.scales.y, ...(yMin != null ? { min: yMin } : {}), ...(yMax != null ? { max: yMax } : {}) };
    chartInstances[id] = new Chart(el, { type: 'line', data: { labels, datasets }, options: opts });
  }
  function mkBar(id: string, labels: string[], datasets: any[], opts: any = {}) {
    destroyChart(id);
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (!el) return;
    const merged = { ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { ...CHART_OPTS.plugins.legend, display: datasets.length > 1 } }, ...opts };
    chartInstances[id] = new Chart(el, { type: 'bar', data: { labels, datasets }, options: merged });
  }
  function mkDoughnut(id: string, labels: string[], values: number[], colors: string[]) {
    destroyChart(id);
    const el = document.getElementById(id) as HTMLCanvasElement | null;
    if (!el) return;
    chartInstances[id] = new Chart(el, { type: 'doughnut', data: { labels, datasets: [{ data: values, backgroundColor: colors }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } } });
  }

  function fmtM(ym: string): string {
    const [y, m] = ym.split('-');
    const abbr = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const mo = parseInt(m) - 1;
    return (mo === 0) ? `${abbr[mo]} '${y.slice(2)}` : abbr[mo];
  }

  // ── Init ──
  $effect(() => {
    const sb = getClientSupabase();
    sb.auth.getSession().then(({ data: { session } }) => {
      const email = session?.user?.email;
      if (!email) return;
      fetch(`/api/v1/auth/my-locations?email=${encodeURIComponent(email)}`)
        .then(r => r.json()).then(d => {
          locations = d.locations || d || [];
          if (locations.length > 0) {
            const saved = localStorage.getItem('helixo_selected_location');
            locationId = (saved && locations.some((l: any) => l.id === saved)) ? saved : locations[0].id;
            loadAll();
          }
        });
    });
  });

  onMount(() => () => destroyAll());

  async function loadAll() {
    if (!locationId) return;
    loading = true;
    destroyAll();
    try {
      const [analyticsRes, serverRes] = await Promise.all([
        fetch(`/api/v1/guest-analytics?locationId=${locationId}&range=${range}`),
        fetch(`/api/v1/satisfaction/server-performance?locationId=${locationId}&days=99999`),
      ]);
      data = await analyticsRes.json();
      const sd = await serverRes.json();
      servers = (sd.servers || []).sort((a: any, b: any) => (b.avgRecommend ?? 0) - (a.avgRecommend ?? 0));
      await loadComments(true);
    } finally {
      loading = false;
      await tick();
      buildActiveCharts();
    }
  }

  async function loadComments(reset = false) {
    if (!locationId) return;
    if (reset) commentsPage = 1;
    const p = new URLSearchParams({ locationId, comments: '1', page: String(commentsPage), segment: commentSegment, range });
    const d = await (await fetch(`/api/v1/guest-analytics?${p}`)).json();
    comments = d.comments || [];
    commentsTotal = d.totalCount || 0;
    commentsTotalPages = d.totalPages || 1;
  }

  function onLocationChange() { localStorage.setItem('helixo_selected_location', locationId); loadAll(); }
  function onRangeChange(r: string) { range = r; loadAll(); }
  async function switchTab(t: string) { activeTab = t; await tick(); buildActiveCharts(); if (t === 'comments') loadComments(true); }
  async function prevPage() { if (commentsPage > 1) { commentsPage--; await loadComments(); } }
  async function nextPage() { if (commentsPage < commentsTotalPages) { commentsPage++; await loadComments(); } }

  // ── Chart builders ──
  function buildActiveCharts() {
    if (!data) return;
    const trend: any[] = data.monthlyTrend ?? [];
    const labels = trend.map(m => fmtM(m.month));
    if (activeTab === 'surveys') buildSurveyCharts(trend, labels);
    else if (activeTab === 'ratings') buildRatingsCharts(trend, labels);
    else if (activeTab === 'servers') buildServerCharts();
    else if (activeTab === 'guestinfo') buildGuestCharts(trend, labels);
    else if (activeTab === 'pace') buildPaceCharts(trend, labels);
  }

  function buildSurveyCharts(trend: any[], labels: string[]) {
    mkLine('chartScoreTrends', labels, [
      { label: 'Overall',    data: trend.map(m => m.avgOverall  != null ? +(m.avgOverall  * 10).toFixed(1) : null), borderColor: '#1e3a5f', backgroundColor: 'rgba(30,58,95,0.06)', fill: true, tension: 0.3, pointRadius: 2 },
      { label: 'Service',    data: trend.map(m => m.avgService  != null ? +(m.avgService  * 10).toFixed(1) : null), borderColor: '#10b981', tension: 0.3, pointRadius: 2 },
      { label: 'Food',       data: trend.map(m => m.avgFood     != null ? +(m.avgFood     * 10).toFixed(1) : null), borderColor: '#f59e0b', tension: 0.3, pointRadius: 2 },
      { label: 'Atmosphere', data: trend.map(m => m.avgAmbiance != null ? +(m.avgAmbiance * 10).toFixed(1) : null), borderColor: '#8b5cf6', tension: 0.3, pointRadius: 2, borderDash: [4, 3] },
    ], 75, 100);
    const npsVals = trend.map(m => m.nps ?? 0);
    mkBar('chartNpsMonthly', labels, [{ label: 'NPS', data: npsVals, backgroundColor: npsVals.map((v: number) => v >= 60 ? '#10b981' : v >= 30 ? '#3b82f6' : '#ef4444'), borderRadius: 4 }]);
    mkBar('chartSurveyVolume', labels, [{ label: 'Surveys', data: trend.map(m => m.responses ?? 0), backgroundColor: 'rgba(30,58,95,0.6)', borderRadius: 4 }]);
    const dow: any[] = data.dowBreakdown ?? [];
    const dowOrder = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dowData = dowOrder.map(d => dow.find((r: any) => r.dow === d)?.nps ?? 0);
    mkBar('chartSurveyDow', dowOrder, [{ label: 'NPS by DOW', data: dowData, backgroundColor: dowData.map(v => v >= 50 ? '#10b981' : '#ef4444'), borderRadius: 4 }]);
  }

  function buildRatingsCharts(trend: any[], labels: string[]) {
    const ratingAvg = trend.map(m => m.avgOverall != null ? +(m.avgOverall * 0.5).toFixed(2) : null);
    mkLine('chartRatingAvg', labels, [{ label: 'Avg Rating', data: ratingAvg, borderColor: '#1e3a5f', backgroundColor: 'rgba(30,58,95,0.08)', fill: true, tension: 0.3, pointRadius: 3 }], 3.5, 5.0);
    mkBar('chartRatingVol', labels, [{ label: 'Surveys', data: trend.map(m => m.responses ?? 0), backgroundColor: 'rgba(30,58,95,0.6)', borderRadius: 4 }]);
    const totProm = trend.reduce((s, m) => s + (m.promoters ?? 0), 0);
    const totPass = trend.reduce((s, m) => s + (m.passives  ?? 0), 0);
    const totDetr = trend.reduce((s, m) => s + (m.detractors ?? 0), 0);
    mkDoughnut('chartRatingDist', ['5-Star','4-Star','1-3 Star'], [totProm, totPass, totDetr], ['#10b981','#3b82f6','#ef4444']);
    const pct5 = trend.map(m => { const t = (m.promoters||0) + (m.passives||0) + (m.detractors||0); return t > 0 ? +((m.promoters||0) / t * 100).toFixed(1) : null; });
    const pct1 = trend.map(m => { const t = (m.promoters||0) + (m.passives||0) + (m.detractors||0); return t > 0 ? +((m.detractors||0) / t * 100).toFixed(1) : null; });
    mkLine('chartRating5v1', labels, [
      { label: '5-Star %', data: pct5, borderColor: '#10b981', tension: 0.3, pointRadius: 2 },
      { label: '1-3 Star %', data: pct1, borderColor: '#ef4444', tension: 0.3, pointRadius: 2 },
    ]);
  }

  function buildServerCharts() {
    const buckets = [0,0,0,0];
    servers.forEach(s => {
      const score = (s.avgRecommend ?? 0) * 10;
      if (score >= 95) buckets[3]++;
      else if (score >= 90) buckets[2]++;
      else if (score >= 80) buckets[1]++;
      else buckets[0]++;
    });
    mkBar('chartServerHist', ['< 80','80-89','90-94','95-100'], [{ label: 'Servers', data: buckets, backgroundColor: ['#ef4444','#f59e0b','#3b82f6','#10b981'], borderRadius: 4 }]);
  }

  function buildGuestCharts(trend: any[], labels: string[]) {
    mkBar('chartGuestVol', labels, [{ label: 'Surveys', data: trend.map(m => m.responses ?? 0), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4 }]);
  }

  function buildPaceCharts(trend: any[], labels: string[]) {
    const volumes = trend.map(m => m.responses ?? 0);
    const rolling3 = trend.map((_, i) => {
      if (i < 2) return null;
      return +((volumes[i] + volumes[i-1] + volumes[i-2]) / 3).toFixed(1);
    });
    mkLine('chartSurveyPace', labels, [
      { label: 'Surveys', data: volumes, borderColor: '#1e3a5f', backgroundColor: 'rgba(30,58,95,0.06)', fill: true, tension: 0.3, pointRadius: 3 },
      { label: '3-Month Avg', data: rolling3, borderColor: '#8b5cf6', borderDash: [5,3], tension: 0.3, pointRadius: 0, spanGaps: true },
    ]);
    const rollingScore = trend.map((_, i) => {
      if (i < 2) return null;
      const slice = [trend[i], trend[i-1], trend[i-2]].filter(m => m.avgOverall != null);
      if (!slice.length) return null;
      return +(slice.reduce((s, m) => s + m.avgOverall * 10, 0) / slice.length).toFixed(1);
    });
    mkLine('chartScoreMomentum', labels, [{ label: '3-Month Rolling Score', data: rollingScore, borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,0.08)', fill: true, tension: 0.3, pointRadius: 3, spanGaps: true }], 75, 100);
    // YoY
    const byYear: Record<string, Record<number, number>> = {};
    trend.forEach(m => {
      const [y, mo] = m.month.split('-').map(Number);
      if (!byYear[y]) byYear[y] = {};
      if (m.avgOverall != null) byYear[y][mo] = +(m.avgOverall * 10).toFixed(1);
    });
    const yoYColors = ['#1e3a5f','#10b981','#f59e0b','#8b5cf6'];
    const moLabels = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const yoyDatasets = Object.keys(byYear).sort().map((y, i) => ({
      label: y, data: moLabels.map((_, mo) => byYear[y][mo + 1] ?? null),
      borderColor: yoYColors[i % yoYColors.length], tension: 0.3, pointRadius: 3, spanGaps: true,
    }));
    mkLine('chartYoY', moLabels, yoyDatasets, 75, 100);
  }

  // ── Derived display values ──
  const totals = $derived.by(() => {
    if (!data?.monthlyTrend) return { overall: 0, service: 0, food: 0, atmos: 0, surveys: 0, nps: 0, promoters: 0, passives: 0, detractors: 0 };
    const t = data.monthlyTrend as any[];
    const withOverall = t.filter(m => m.avgOverall != null);
    return {
      overall: withOverall.length ? +(withOverall.reduce((s: number, m: any) => s + m.avgOverall, 0) / withOverall.length * 10).toFixed(1) : 0,
      service: withOverall.length ? +(withOverall.reduce((s: number, m: any) => s + (m.avgService ?? m.avgOverall), 0) / withOverall.length * 10).toFixed(1) : 0,
      food:    withOverall.length ? +(withOverall.reduce((s: number, m: any) => s + (m.avgFood    ?? m.avgOverall), 0) / withOverall.length * 10).toFixed(1) : 0,
      atmos:   withOverall.length ? +(withOverall.reduce((s: number, m: any) => s + (m.avgAmbiance ?? m.avgOverall), 0) / withOverall.length * 10).toFixed(1) : 0,
      surveys: t.reduce((s: number, m: any) => s + (m.responses ?? 0), 0),
      nps: data.nps ?? 0,
      promoters: data.promoters ?? 0,
      passives:  data.passives  ?? 0,
      detractors: data.detractors ?? 0,
    };
  });

  const ratingsAvg = $derived.by(() => {
    if (!data?.monthlyTrend) return 0;
    const t = (data.monthlyTrend as any[]).filter(m => m.avgOverall != null);
    if (!t.length) return 0;
    return +(t.reduce((s: number, m: any) => s + m.avgOverall, 0) / t.length * 0.5).toFixed(2);
  });

  const topServers  = $derived(servers.filter(s => (s.avgRecommend ?? 0) * 10 >= 90).slice(0, 20));
  const lowServers  = $derived(servers.filter(s => (s.avgRecommend ?? 0) * 10 < 90).slice(0, 20));
  const keywords    = $derived.by((): { word: string; count: number }[] => data?.keywords ?? []);
  const posKw       = $derived(keywords.slice(0, 10));
  const negKw       = $derived(() => {
    // Use negative keywords from intelligence text or just last 10 keywords
    const intelligence: any[] = data?.intelligence ?? [];
    return intelligence;
  });
  const intelligence: any[] = $derived(data?.intelligence ?? []);

  function scoreColor(score: number): string {
    if (score >= 95) return '#10b981';
    if (score >= 90) return '#3b82f6';
    if (score >= 80) return '#f59e0b';
    return '#ef4444';
  }
  function npsColor(n: number): string { return n >= 60 ? '#10b981' : n >= 30 ? '#3b82f6' : '#ef4444'; }
  function sentClass(score: number): string { return score >= 90 ? 'positive' : score >= 70 ? 'mixed' : 'negative'; }
</script>

<div class="ga-page">
  <!-- Header -->
  <div class="ga-header">
    <div class="header-left">
      <h1>Guest Analytics</h1>
      <p class="subtitle">Resy survey data • NPS • Server performance</p>
    </div>
    <div class="header-controls">
      {#if locations.length > 1}
        <select class="leo-select" bind:value={locationId} onchange={onLocationChange}>
          {#each locations as loc}<option value={loc.id}>{loc.name}</option>{/each}
        </select>
      {/if}
      <select class="leo-select" value={range} onchange={(e) => onRangeChange((e.target as HTMLSelectElement).value)}>
        <option value="all">All Time</option>
        <option value="1yr">Last 12 Months</option>
        <option value="ytd">Year to Date</option>
        <option value="90d">Last 90 Days</option>
        <option value="30d">Last 30 Days</option>
      </select>
    </div>
  </div>

  <!-- Tab bar -->
  <div class="tab-bar">
    {#each TABS as tab}
      <button class="tab-btn {activeTab === tab.id ? 'active' : ''}" onclick={() => switchTab(tab.id)}>{tab.label}</button>
    {/each}
  </div>

  {#if loading}
    <div class="loading-state">Loading guest data…</div>
  {:else if !data}
    <div class="loading-state">No data available.</div>
  {:else}

  <!-- ═══ TAB: Guest Surveys ═══ -->
  {#if activeTab === 'surveys'}
    <div class="kpi-row">
      <div class="leo-card kpi-card"><div class="kpi-label">Overall Score</div><div class="kpi-value" style="color: {scoreColor(totals.overall)}">{totals.overall}</div><div class="kpi-sub">/100 across all time</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Service</div><div class="kpi-value" style="color:#10b981">{totals.service}</div><div class="kpi-sub">avg service score</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Food</div><div class="kpi-value" style="color:#f59e0b">{totals.food}</div><div class="kpi-sub">avg food score</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Atmosphere</div><div class="kpi-value" style="color:#8b5cf6">{totals.atmos}</div><div class="kpi-sub">avg atmosphere</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Total Surveys</div><div class="kpi-value" style="color:#1e3a5f">{totals.surveys.toLocaleString()}</div><div class="kpi-sub">all time</div></div>
    </div>

    {#if intelligence.length > 0}
    <div class="intel-grid">
      {#each intelligence as b}
        <div class="intel-card"><span class="intel-badge {b.type}">{b.type}</span><p>{b.text}</p></div>
      {/each}
    </div>
    {/if}

    <div class="chart-grid">
      <div class="leo-card chart-card span2"><h3>Score Trends</h3><div class="chart-wrap tall"><canvas id="chartScoreTrends"></canvas></div></div>
      <div class="leo-card chart-card"><h3>Net Promoter Score</h3>
        <div class="nps-row"><span class="nps-big" style="color:{npsColor(totals.nps)}">{totals.nps}</span>
          <div class="nps-bar-wrap">
            <div class="nps-bar">
              {#if totals.surveys > 0}
                <div class="nps-seg prom" style="width:{(totals.promoters/totals.surveys*100).toFixed(1)}%"></div>
                <div class="nps-seg pass" style="width:{(totals.passives/totals.surveys*100).toFixed(1)}%"></div>
                <div class="nps-seg detr" style="width:{(totals.detractors/totals.surveys*100).toFixed(1)}%"></div>
              {/if}
            </div>
            <div class="nps-labels">
              <span style="color:#10b981">Promoters {totals.promoters}</span>
              <span style="color:#f59e0b">Passives {totals.passives}</span>
              <span style="color:#ef4444">Detractors {totals.detractors}</span>
            </div>
          </div>
        </div>
        <div class="chart-wrap short"><canvas id="chartNpsMonthly"></canvas></div>
      </div>
      <div class="leo-card chart-card"><h3>Survey Volume</h3><div class="chart-wrap"><canvas id="chartSurveyVolume"></canvas></div></div>
      <div class="leo-card chart-card"><h3>Day-of-Week Performance</h3><div class="chart-wrap"><canvas id="chartSurveyDow"></canvas></div></div>
    </div>

    {#if keywords.length > 0}
    <div class="leo-card kw-card">
      <h3>Keyword Highlights</h3>
      <div class="kw-grid">
        <div>
          <p class="kw-section-title" style="color:#10b981">Top Positive Keywords</p>
          {#each posKw as kw}
            <div class="kw-bar-row">
              <span class="kw-label">{kw.word}</span>
              <div class="kw-bg"><div class="kw-fill" style="width:{(kw.count/posKw[0].count*100).toFixed(0)}%;background:#10b981"></div></div>
              <span class="kw-count">{kw.count}</span>
            </div>
          {/each}
        </div>
      </div>
    </div>
    {/if}
  {/if}

  <!-- ═══ TAB: Reservation Ratings ═══ -->
  {#if activeTab === 'ratings'}
    <div class="kpi-row">
      <div class="leo-card kpi-card"><div class="kpi-label">Overall Average</div><div class="kpi-value" style="color:#1e3a5f">{ratingsAvg} / 5.0</div><div class="kpi-sub">{totals.surveys.toLocaleString()} total surveys</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">5-Star Rate</div><div class="kpi-value" style="color:#10b981">{totals.surveys > 0 ? (totals.promoters/totals.surveys*100).toFixed(1) : '0'}%</div><div class="kpi-sub">{totals.promoters} promoters</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Low-Score Rate</div><div class="kpi-value" style="color:#ef4444">{totals.surveys > 0 ? (totals.detractors/totals.surveys*100).toFixed(1) : '0'}%</div><div class="kpi-sub">{totals.detractors} detractors</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">NPS Score</div><div class="kpi-value" style="color:{npsColor(totals.nps)}">{totals.nps}</div><div class="kpi-sub">net promoter score</div></div>
    </div>
    <div class="chart-grid">
      <div class="leo-card chart-card span2"><h3>Monthly Average Rating</h3><div class="chart-wrap tall"><canvas id="chartRatingAvg"></canvas></div></div>
      <div class="leo-card chart-card"><h3>Monthly Volume</h3><div class="chart-wrap"><canvas id="chartRatingVol"></canvas></div></div>
      <div class="leo-card chart-card"><h3>Rating Distribution</h3><div class="chart-wrap"><canvas id="chartRatingDist"></canvas></div></div>
      <div class="leo-card chart-card"><h3>Promoter vs Detractor %</h3><div class="chart-wrap"><canvas id="chartRating5v1"></canvas></div></div>
    </div>
  {/if}

  <!-- ═══ TAB: Server Performance ═══ -->
  {#if activeTab === 'servers'}
    <div class="kpi-row">
      <div class="leo-card kpi-card"><div class="kpi-label">Servers Tracked</div><div class="kpi-value" style="color:#1e3a5f">{servers.length}</div><div class="kpi-sub">with survey data</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Top Performer</div><div class="kpi-value small" style="color:#10b981">{servers.length ? servers[0].serverName : '—'}</div><div class="kpi-sub">{servers.length ? ((servers[0].avgRecommend ?? 0) * 10).toFixed(0) : '—'} score</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Above 90</div><div class="kpi-value" style="color:#10b981">{topServers.length}</div><div class="kpi-sub">strong performers</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Need Development</div><div class="kpi-value" style="color:#ef4444">{lowServers.length}</div><div class="kpi-sub">below 90 avg</div></div>
    </div>
    <div class="chart-grid">
      <div class="leo-card chart-card"><h3>Score Distribution</h3><div class="chart-wrap"><canvas id="chartServerHist"></canvas></div></div>
    </div>
    <div class="leo-card table-card">
      <h3>Top Performers (avg ≥ 90)</h3>
      <table class="data-table">
        <thead><tr><th>Server</th><th>Avg Score</th><th>Surveys</th><th>Positive</th><th>Negative</th><th>Performance</th></tr></thead>
        <tbody>
          {#each topServers as s}
            {@const score = +((s.avgRecommend ?? 0) * 10).toFixed(1)}
            <tr>
              <td class="name-cell">{s.serverName}</td>
              <td><span class="score-badge" style="color:{scoreColor(score)}">{score}</span></td>
              <td>{s.totalSurveys}</td>
              <td style="color:#10b981">{s.positiveMentions}</td>
              <td style="color:#ef4444">{s.negativeMentions}</td>
              <td><div class="perf-bar"><div class="perf-fill" style="width:{score}%;background:{scoreColor(score)}"></div></div></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {#if lowServers.length > 0}
    <div class="leo-card table-card" style="margin-top:16px">
      <h3>Needs Development (avg &lt; 90)</h3>
      <table class="data-table">
        <thead><tr><th>Server</th><th>Avg Score</th><th>Surveys</th><th>Positive</th><th>Negative</th><th>Performance</th></tr></thead>
        <tbody>
          {#each lowServers as s}
            {@const score = +((s.avgRecommend ?? 0) * 10).toFixed(1)}
            <tr>
              <td class="name-cell">{s.serverName}</td>
              <td><span class="score-badge" style="color:{scoreColor(score)}">{score}</span></td>
              <td>{s.totalSurveys}</td>
              <td style="color:#10b981">{s.positiveMentions}</td>
              <td style="color:#ef4444">{s.negativeMentions}</td>
              <td><div class="perf-bar"><div class="perf-fill" style="width:{score}%;background:{scoreColor(score)}"></div></div></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    {/if}
  {/if}

  <!-- ═══ TAB: Guest Comments ═══ -->
  {#if activeTab === 'comments'}
    <div class="filter-row">
      <div class="seg-btns">
        {#each [['all','All'],['promoter','Positive'],['passive','Mixed'],['detractor','Negative']] as [val, label]}
          <button class="seg-btn {commentSegment === val ? 'active' : ''}" onclick={async () => { commentSegment = val; await loadComments(true); }}>{label}</button>
        {/each}
      </div>
      <span class="comment-count">{commentsTotal.toLocaleString()} comments</span>
    </div>
    <div class="comments-list">
      {#each comments as c}
        {@const score = c.recommend_score ?? c.overall_score ?? 0}
        <div class="comment-card {sentClass(score)}">
          <div class="comment-meta">
            <span>{c.business_date} {c.server_name ? `· ${c.server_name}` : ''}</span>
            <span class="score-badge sm" style="color:{scoreColor(score)}">{score}/100</span>
          </div>
          <p class="comment-text">{c.comment}</p>
        </div>
      {/each}
      {#if comments.length === 0}<p style="color:#6b7280;padding:20px">No comments for this filter.</p>{/if}
    </div>
    {#if commentsTotalPages > 1}
    <div class="pagination">
      <button class="leo-btn-sm" onclick={prevPage} disabled={commentsPage === 1}>← Prev</button>
      <span>Page {commentsPage} of {commentsTotalPages}</span>
      <button class="leo-btn-sm" onclick={nextPage} disabled={commentsPage === commentsTotalPages}>Next →</button>
    </div>
    {/if}
  {/if}

  <!-- ═══ TAB: Guest Info ═══ -->
  {#if activeTab === 'guestinfo'}
    <div class="kpi-row">
      <div class="leo-card kpi-card"><div class="kpi-label">Total Surveys</div><div class="kpi-value" style="color:#1e3a5f">{totals.surveys.toLocaleString()}</div><div class="kpi-sub">across all time</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Months Active</div><div class="kpi-value" style="color:#3b82f6">{(data?.monthlyTrend?.length ?? 0)}</div><div class="kpi-sub">months with data</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Avg Monthly</div><div class="kpi-value" style="color:#10b981">{data?.monthlyTrend?.length ? Math.round(totals.surveys / data.monthlyTrend.length) : 0}</div><div class="kpi-sub">surveys per month</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">NPS</div><div class="kpi-value" style="color:{npsColor(totals.nps)}">{totals.nps}</div><div class="kpi-sub">net promoter score</div></div>
    </div>
    <div class="chart-grid">
      <div class="leo-card chart-card span2"><h3>Monthly Survey Volume</h3><div class="chart-wrap tall"><canvas id="chartGuestVol"></canvas></div></div>
    </div>
    {#if data?.monthlyTrend?.length > 0}
    <div class="leo-card table-card">
      <h3>Monthly Summary</h3>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Month</th><th>Surveys</th><th>Overall</th><th>Service</th><th>Food</th><th>Atmosphere</th><th>NPS</th></tr></thead>
          <tbody>
            {#each [...(data.monthlyTrend)].reverse().slice(0, 24) as m}
              <tr>
                <td>{m.month}</td>
                <td>{m.responses ?? 0}</td>
                <td style="color:{scoreColor(+(m.avgOverall??0)*10)}">{m.avgOverall != null ? (m.avgOverall*10).toFixed(0) : '—'}</td>
                <td>{m.avgService != null ? (m.avgService*10).toFixed(0) : '—'}</td>
                <td>{m.avgFood    != null ? (m.avgFood*10).toFixed(0)    : '—'}</td>
                <td>{m.avgAmbiance != null ? (m.avgAmbiance*10).toFixed(0) : '—'}</td>
                <td style="color:{npsColor(m.nps??0)}">{m.nps ?? '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    {/if}
  {/if}

  <!-- ═══ TAB: Pace Report ═══ -->
  {#if activeTab === 'pace'}
    {@const trend = data?.monthlyTrend ?? []}
    {@const recentMonths = trend.slice(-3)}
    {@const priorMonths = trend.slice(-6, -3)}
    {@const recentAvg = recentMonths.length ? Math.round(recentMonths.reduce((s: number, m: any) => s + (m.responses ?? 0), 0) / recentMonths.length) : 0}
    {@const priorAvg  = priorMonths.length  ? Math.round(priorMonths.reduce( (s: number, m: any) => s + (m.responses ?? 0), 0) / priorMonths.length)  : 0}
    <div class="kpi-row">
      <div class="leo-card kpi-card"><div class="kpi-label">Avg Surveys/Month</div><div class="kpi-value" style="color:#1e3a5f">{trend.length ? Math.round(totals.surveys/trend.length) : 0}</div><div class="kpi-sub">{trend.length} months</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Recent 3-Month Avg</div><div class="kpi-value" style="color:{recentAvg >= priorAvg ? '#10b981' : '#ef4444'}">{recentAvg}</div><div class="kpi-sub">{recentAvg >= priorAvg ? '▲' : '▼'} vs prior period ({priorAvg})</div></div>
      <div class="leo-card kpi-card"><div class="kpi-label">Best Month</div>
        {@const best = trend.reduce((b: any, m: any) => (m.responses ?? 0) > (b.responses ?? 0) ? m : b, trend[0] ?? {})}
        <div class="kpi-value small" style="color:#8b5cf6">{best?.month ?? '—'}</div>
        <div class="kpi-sub">{best?.responses ?? 0} surveys</div>
      </div>
      <div class="leo-card kpi-card"><div class="kpi-label">Coverage</div><div class="kpi-value" style="color:#3b82f6">{trend.filter((m: any) => (m.responses ?? 0) >= 5).length}/{trend.length}</div><div class="kpi-sub">months ≥ 5 surveys</div></div>
    </div>
    <div class="chart-grid">
      <div class="leo-card chart-card span2"><h3>Survey Pace</h3><div class="chart-wrap"><canvas id="chartSurveyPace"></canvas></div></div>
      <div class="leo-card chart-card"><h3>Score Momentum (3-Month Rolling)</h3><div class="chart-wrap"><canvas id="chartScoreMomentum"></canvas></div></div>
      <div class="leo-card chart-card"><h3>Year-over-Year Comparison</h3><div class="chart-wrap"><canvas id="chartYoY"></canvas></div></div>
    </div>
  {/if}

  {/if}<!-- end data check -->
</div>

<style>
  .ga-page { padding: 0 0 40px; }
  .ga-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; flex-wrap: wrap; gap: 12px; }
  .ga-header h1 { font-size: 20px; font-weight: 700; color: #1e3a5f; margin: 0; }
  .subtitle { font-size: 12px; color: #6b7280; margin: 2px 0 0; }
  .header-controls { display: flex; gap: 10px; flex-wrap: wrap; }
  .tab-bar { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 2px solid #e5e7eb; overflow-x: auto; padding-bottom: 0; flex-wrap: nowrap; }
  .tab-btn { padding: 8px 16px; font-size: 13px; font-weight: 500; border: none; background: none; cursor: pointer; color: #6b7280; border-bottom: 2px solid transparent; margin-bottom: -2px; white-space: nowrap; transition: color .15s; }
  .tab-btn.active { color: #1e3a5f; border-bottom-color: #1e3a5f; font-weight: 600; }
  .tab-btn:hover:not(.active) { color: #374151; }
  .kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi-card { padding: 16px 18px; }
  .kpi-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; margin-bottom: 4px; }
  .kpi-value { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
  .kpi-value.small { font-size: 16px; }
  .kpi-sub { font-size: 11px; color: #9ca3af; margin-top: 2px; }
  .chart-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 20px; }
  .chart-card { padding: 18px 20px; }
  .chart-card h3 { font-size: 13px; font-weight: 600; color: #1e3a5f; margin: 0 0 12px; }
  .span2 { grid-column: 1 / -1; }
  .chart-wrap { position: relative; height: 260px; }
  .chart-wrap.tall { height: 300px; }
  .chart-wrap.short { height: 200px; }
  .intel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .intel-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; font-size: 13px; line-height: 1.6; }
  .intel-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
  .intel-badge.insight { background: #dbeafe; color: #1d4ed8; }
  .intel-badge.action { background: #d1fae5; color: #065f46; }
  .intel-badge.alert { background: #fee2e2; color: #991b1b; }
  .intel-badge.coaching { background: #fef3c7; color: #92400e; }
  .nps-row { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
  .nps-big { font-size: 38px; font-weight: 800; letter-spacing: -1px; flex-shrink: 0; }
  .nps-bar-wrap { flex: 1; }
  .nps-bar { display: flex; height: 20px; border-radius: 4px; overflow: hidden; }
  .nps-seg { height: 100%; transition: width .3s; }
  .nps-seg.prom { background: #10b981; }
  .nps-seg.pass { background: #f59e0b; }
  .nps-seg.detr { background: #ef4444; }
  .nps-labels { display: flex; justify-content: space-between; font-size: 10px; margin-top: 3px; }
  .filter-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
  .seg-btns { display: flex; gap: 4px; }
  .seg-btn { padding: 6px 12px; font-size: 12px; font-weight: 500; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; color: #6b7280; transition: all .15s; }
  .seg-btn.active { background: #1e3a5f; color: #fff; border-color: #1e3a5f; }
  .comment-count { font-size: 12px; color: #6b7280; margin-left: auto; }
  .comments-list { display: flex; flex-direction: column; gap: 10px; }
  .comment-card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; border-left: 4px solid #e5e7eb; }
  .comment-card.positive { border-left-color: #10b981; }
  .comment-card.mixed    { border-left-color: #f59e0b; }
  .comment-card.negative { border-left-color: #ef4444; }
  .comment-meta { display: flex; justify-content: space-between; font-size: 11px; color: #6b7280; margin-bottom: 6px; }
  .comment-text { font-size: 13px; line-height: 1.55; color: #374151; }
  .score-badge { font-weight: 700; font-size: 12px; }
  .score-badge.sm { font-size: 11px; }
  .pagination { display: flex; align-items: center; gap: 12px; justify-content: center; margin-top: 20px; font-size: 13px; color: #6b7280; }
  .table-card { padding: 20px; overflow-x: auto; }
  .table-card h3 { font-size: 13px; font-weight: 600; color: #1e3a5f; margin: 0 0 14px; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .data-table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #e5e7eb; font-size: 11px; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: 0.4px; }
  .data-table td { padding: 9px 12px; border-bottom: 1px solid #f3f4f6; }
  .name-cell { font-weight: 500; color: #1e3a5f; }
  .perf-bar { height: 8px; background: #f3f4f6; border-radius: 4px; overflow: hidden; min-width: 80px; }
  .perf-fill { height: 100%; border-radius: 4px; }
  .kw-card { padding: 20px; margin-bottom: 16px; }
  .kw-card h3 { font-size: 13px; font-weight: 600; color: #1e3a5f; margin: 0 0 14px; }
  .kw-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .kw-section-title { font-size: 12px; font-weight: 600; margin-bottom: 10px; }
  .kw-bar-row { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; font-size: 12px; }
  .kw-label { width: 90px; text-align: right; font-weight: 500; color: #374151; }
  .kw-bg { flex: 1; height: 16px; background: #f3f4f6; border-radius: 4px; overflow: hidden; }
  .kw-fill { height: 100%; border-radius: 4px; }
  .kw-count { width: 32px; font-weight: 600; color: #6b7280; }
  .loading-state { padding: 60px 20px; text-align: center; color: #6b7280; font-size: 14px; }
  .leo-btn-sm { padding: 6px 14px; font-size: 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; cursor: pointer; color: #374151; }
  .leo-btn-sm:disabled { opacity: 0.4; cursor: default; }
  @media (max-width: 768px) { .chart-grid { grid-template-columns: 1fr; } .kpi-row { grid-template-columns: repeat(2, 1fr); } .kw-grid { grid-template-columns: 1fr; } }
</style>
