<script lang="ts">
  import { onMount } from 'svelte';
  interface SourceStatus { source: string; table: string; lastSync: string | null; recordCount: number; healthy: boolean; }
  interface CronStatus { name: string; label: string; status: string; lastRun: string | null; details: Record<string, unknown>; }
  interface FlowNode { id: string; label: string; schedule: string; dataTypes: string[]; column: 'source' | 'processing' | 'infra' | 'output'; comingSoon?: boolean; icon?: string; }
  interface FlowEdge { from: string; to: string; }

  let statuses = $state<SourceStatus[]>([]);
  let cronStatuses = $state<CronStatus[]>([]);
  let loading = $state(true);
  let isMobile = $state(false);

  const sources: FlowNode[] = [
    { id: 'toast', label: 'Toast POS', schedule: 'Daily 5 AM EST', dataTypes: ['Revenue', 'Covers', 'Labor Hrs/$', 'Sales Mix', 'PMIX', 'Hourly Sales', 'Table Turns'], column: 'source' },
    { id: 'dolce', label: 'Dolce TeamWork', schedule: 'Thu 1 PM EST', dataTypes: ['Scheduled Labor by Position'], column: 'source' },
    { id: 'resy', label: 'Resy OS', schedule: 'Daily 9 AM EST', dataTypes: ['Reservations', 'Covers Booked', 'Walk-ins', 'No-shows'], column: 'source' },
    { id: 'weather', label: 'OpenWeatherMap', schedule: 'Daily sync', dataTypes: ['5-Day Weather Forecast'], column: 'source' },
    { id: 'tripleseat', label: 'TripleSeat', schedule: 'Real-time', dataTypes: ['Private Events', 'Event Revenue', 'Guest Counts', 'Event Types', 'Lead Pipeline', 'PACE vs Budget'], column: 'source' },
    { id: 'events', label: 'Ticketmaster / PredictHQ', schedule: 'Coming soon', dataTypes: ['Local Events'], column: 'source', comingSoon: true },
    { id: 'economic', label: 'EIA / BLS', schedule: 'Coming soon', dataTypes: ['Gas Prices', 'CPI/Inflation'], column: 'source', comingSoon: true },
    { id: 'manager', label: 'Manager Input', schedule: 'On demand', dataTypes: ['Budget Excel', 'Forecast Overrides', 'Variance Notes', 'Schedule Submissions'], column: 'source' },
  ];
  const processing: FlowNode[] = [
    { id: 'toast_sync', label: 'Toast Daily Sync', schedule: '5 AM EST Cron', dataTypes: ['daily_actuals', 'daily_labor', 'daily_sales_mix', 'daily_pmix', 'daily_hourly_sales'], column: 'processing' },
    { id: 'ai_forecast', label: 'AI Forecast Engine', schedule: 'On sync', dataTypes: ['8-signal weighted blend', 'Adaptive weights', 'Neural ensemble'], column: 'processing' },
    { id: 'labor_proj', label: 'Labor Projection Engine', schedule: 'On sync', dataTypes: ['Threshold cascade', 'DOW weight distribution', 'Weekly recalc'], column: 'processing' },
    { id: 'dow_adapter', label: 'DOW Weight Adapter', schedule: 'Sunday recal', dataTypes: ['Weekly self-calibration from actuals'], column: 'processing' },
    { id: 'accuracy', label: 'Forecast Accuracy Tracker', schedule: 'Daily', dataTypes: ['Self-grading', 'Bias detection', 'Weight adjustment'], column: 'processing' },
    { id: 'cross_loc', label: 'Cross-Location Learning', schedule: 'Weekly', dataTypes: ['Cluster analysis', 'Market trends', 'Seasonal transfer'], column: 'processing' },
    { id: 'insights_gen', label: 'Insights Generator', schedule: 'Daily 5:15 AM', dataTypes: ['AI narrative', 'Sales mix analysis', 'Labor flags'], column: 'processing' },
  ];
  const infra: FlowNode[] = [
    { id: 'supabase', label: 'Supabase (PostgreSQL)', schedule: 'Always on', icon: 'db', dataTypes: ['20+ tables (actuals, labor, budget...)', 'Row Level Security enabled', 'REST API for all data access'], column: 'infra' },
    { id: 'vercel', label: 'Vercel', schedule: 'Always on', icon: 'cloud', dataTypes: ['SvelteKit SSR + serverless', 'helixoapp.com / helixokpi.com', '11 API routes + 2 cron jobs', 'Edge network (iad1)'], column: 'infra' },
    { id: 'gh_actions', label: 'GitHub Actions', schedule: 'Scheduled', icon: 'ci', dataTypes: ['Dolce sync (Thu 1 PM EST)', 'Resy sync (Daily 9 AM EST)', 'Playwright headless browser'], column: 'infra' },
    { id: 'resend', label: 'Resend', schedule: 'On event', icon: 'mail', dataTypes: ['Daily insights PDF (5:30 AM)', 'Schedule approval notifications', 'Welcome emails', 'From: notifications@helixokpi.com'], column: 'infra' },
    { id: 'toast_api', label: 'Toast POS API', schedule: 'On demand', icon: 'api', dataTypes: ['Partner API authentication', 'Orders, Labor, Jobs, Menus', 'Rate limited'], column: 'infra' },
    { id: 'owm_api', label: 'OpenWeatherMap API', schedule: 'Daily', icon: 'api', dataTypes: ['5-day forecast', 'Free tier'], column: 'infra' },
  ];
  const outputs: FlowNode[] = [
    { id: 'dashboard', label: 'Dashboard', schedule: 'Real-time', dataTypes: ['Period/monthly revenue & labor'], column: 'output' },
    { id: 'forecast_mgr', label: 'Forecast Manager', schedule: 'Real-time', dataTypes: ['AI suggestions', 'Override workflow', 'Comparison chart'], column: 'output' },
    { id: 'labor_detail', label: 'Labor Detail', schedule: 'Real-time', dataTypes: ['Position-level projected vs actual vs budget'], column: 'output' },
    { id: 'insights_out', label: 'Insights', schedule: 'Daily', dataTypes: ['AI narrative + manager comments'], column: 'output' },
    { id: 'schedule_app', label: 'Schedule Approval', schedule: 'Real-time', dataTypes: ['Projected vs scheduled', 'Approval workflow'], column: 'output' },
    { id: 'accuracy_out', label: 'Forecast Accuracy', schedule: 'Daily', dataTypes: ['Self-grading analytics', 'DOW heatmap'], column: 'output' },
    { id: 'daily_email', label: 'Daily Email', schedule: '5:30 AM EST', dataTypes: ['PDF insights report'], column: 'output' },
    { id: 'schedule_email', label: 'Schedule Email', schedule: 'On event', dataTypes: ['Submission/approval notifications'], column: 'output' },
    { id: 'events_pace', label: 'Events PACE', schedule: 'Real-time', dataTypes: ['OTB vs Budget vs STLY', 'Lead Pipeline', 'Top Events', 'Event KPIs'], column: 'output' },
  ];
  const edges: FlowEdge[] = [
    { from: 'toast', to: 'toast_sync' }, { from: 'dolce', to: 'labor_proj' },
    { from: 'tripleseat', to: 'supabase' }, { from: 'supabase', to: 'events_pace' },
    { from: 'resy', to: 'ai_forecast' }, { from: 'weather', to: 'ai_forecast' },
    { from: 'manager', to: 'ai_forecast' }, { from: 'manager', to: 'labor_proj' },
    { from: 'toast_sync', to: 'ai_forecast' }, { from: 'toast_sync', to: 'insights_gen' },
    { from: 'ai_forecast', to: 'labor_proj' }, { from: 'ai_forecast', to: 'accuracy' },
    { from: 'labor_proj', to: 'dow_adapter' }, { from: 'accuracy', to: 'cross_loc' },
    { from: 'dow_adapter', to: 'labor_proj' }, { from: 'cross_loc', to: 'ai_forecast' },
    // Processing -> Infrastructure
    { from: 'toast_sync', to: 'supabase' }, { from: 'ai_forecast', to: 'supabase' },
    { from: 'labor_proj', to: 'supabase' }, { from: 'insights_gen', to: 'vercel' },
    { from: 'insights_gen', to: 'resend' },
    // Sources -> Infrastructure (external APIs)
    { from: 'toast', to: 'toast_api' }, { from: 'weather', to: 'owm_api' },
    { from: 'dolce', to: 'gh_actions' }, { from: 'resy', to: 'gh_actions' },
    // Infrastructure -> Infrastructure
    { from: 'toast_api', to: 'supabase' }, { from: 'owm_api', to: 'supabase' },
    { from: 'gh_actions', to: 'supabase' }, { from: 'vercel', to: 'resend' },
    // Infrastructure -> Outputs
    { from: 'supabase', to: 'dashboard' }, { from: 'supabase', to: 'forecast_mgr' },
    { from: 'supabase', to: 'labor_detail' }, { from: 'supabase', to: 'schedule_app' },
    { from: 'supabase', to: 'accuracy_out' }, { from: 'vercel', to: 'insights_out' },
    { from: 'resend', to: 'daily_email' }, { from: 'resend', to: 'schedule_email' },
  ];

  const sourceTableMap: Record<string, string[]> = {
    toast: ['toast_actuals', 'toast_labor', 'toast_sales_mix', 'toast_pmix', 'toast_hourly'],
    tripleseat: ['tripleseat_events', 'tripleseat_leads'],
    dolce: ['dolce_schedule'], resy: ['resy'], weather: ['weather'],
    toast_sync: ['toast_actuals', 'toast_labor'], ai_forecast: ['daily_forecasts'],
    labor_proj: ['daily_labor_targets'], dow_adapter: ['dow_weights'],
  };

  function getHealthForNode(nodeId: string): { healthy: boolean; lastSync: string | null } | null {
    const tables = sourceTableMap[nodeId];
    if (!tables || statuses.length === 0) return null;
    const matched = statuses.filter((s) => tables.includes(s.source));
    if (matched.length === 0) return null;
    const allHealthy = matched.every((m) => m.healthy);
    const latest = matched.reduce((a, b) => {
      if (!a.lastSync) return b; if (!b.lastSync) return a;
      return new Date(a.lastSync) > new Date(b.lastSync) ? a : b;
    });
    return { healthy: allHealthy, lastSync: latest.lastSync };
  }

  function timeAgo(iso: string | null): string {
    if (!iso) return 'Never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  const COL_X = { source: 20, processing: 370, infra: 720, output: 1070 };
  const BOX_W = 280; const BOX_H_BASE = 62; const GAP = 12;

  function boxY(index: number, colNodes: FlowNode[]): number {
    let y = 20;
    for (let i = 0; i < index; i++) y += boxHeight(colNodes[i]) + GAP;
    return y;
  }
  function boxHeight(node: FlowNode): number { return BOX_H_BASE + Math.ceil(node.dataTypes.length / 2) * 12; }
  function colHeight(nodes: FlowNode[]): number {
    let h = 20; for (const n of nodes) h += boxHeight(n) + GAP; return h;
  }
  function svgHeight(): number { return Math.max(colHeight(sources), colHeight(processing), colHeight(infra), colHeight(outputs)) + 20; }

  const allColumns: [string, FlowNode[]][] = [['source', sources], ['processing', processing], ['infra', infra], ['output', outputs]];
  function nodeCenter(nodeId: string): { x: number; y: number } {
    for (const [col, nodes] of allColumns) {
      const idx = nodes.findIndex((n) => n.id === nodeId);
      if (idx >= 0) return { x: COL_X[col as keyof typeof COL_X] + BOX_W / 2, y: boxY(idx, nodes) + boxHeight(nodes[idx]) / 2 };
    }
    return { x: 0, y: 0 };
  }
  function getNodeCol(nodeId: string): keyof typeof COL_X {
    if (sources.find(n => n.id === nodeId)) return 'source';
    if (processing.find(n => n.id === nodeId)) return 'processing';
    if (infra.find(n => n.id === nodeId)) return 'infra';
    return 'output';
  }

  const INFRA_ICONS: Record<string, string> = { db: '\u{1F5C4}', cloud: '\u2601', ci: '\u2699', mail: '\u2709', api: '\u{1F517}' };

  onMount(async () => {
    isMobile = window.innerWidth < 768;
    window.addEventListener('resize', () => { isMobile = window.innerWidth < 768; });
    const [srcRes, cronRes] = await Promise.all([
      fetch('/api/v1/admin/data-sources').catch(() => null),
      fetch('/api/v1/admin/cron-status').catch(() => null),
    ]);
    try { if (srcRes?.ok) { const d = await srcRes.json(); statuses = d.sources ?? []; } } catch { /* silently fail */ }
    try { if (cronRes?.ok) { const d = await cronRes.json(); cronStatuses = d.crons ?? []; } } catch { /* silently fail */ }
    loading = false;
  });
</script>

<svelte:head><title>HELIXO | Data Source Map</title></svelte:head>

<div class="py-8">
  <h1 class="text-2xl font-bold mb-1" style="color: #1e3a5f; font-family: 'Inter', sans-serif;">Data Source Map</h1>
  <p class="text-sm mb-6" style="color: #6b7280;">How data flows from source systems through processing and infrastructure to the dashboard.</p>

  {#if loading}
    <div class="flex items-center justify-center py-20"><p class="text-sm" style="color: #9ca3af;">Loading data source status...</p></div>
  {:else if isMobile}
    <div class="space-y-6">
      {#snippet mobileArrow()}<div class="flex justify-center"><svg width="24" height="40" viewBox="0 0 24 40"><path d="M12 0 L12 30 L6 24 M12 30 L18 24" stroke="#9ca3af" fill="none" stroke-width="2"/></svg></div>{/snippet}
      <!-- Sources -->
      <div>
        <h2 class="text-xs font-semibold uppercase tracking-wider mb-3" style="color: #1e3a5f;">Source Systems</h2>
        <div class="space-y-3">
          {#each sources as node}
            {@const health = getHealthForNode(node.id)}
            <div class="rounded-lg p-4 border" style="background: {node.comingSoon ? '#f3f4f6' : '#e8f0fe'}; border-color: #d1d5db;">
              <div class="flex items-center gap-2 mb-1">
                {#if health}<span class="inline-block w-2 h-2 rounded-full" style="background: {health.healthy ? '#16a34a' : '#dc2626'};"></span>{/if}
                <span class="font-semibold text-sm" style="color: #1e3a5f;">{node.label}</span>
                {#if node.comingSoon}<span class="text-[10px] px-1.5 py-0.5 rounded" style="background: #e5e7eb; color: #6b7280;">SOON</span>{/if}
              </div>
              <p class="text-[11px] mb-1" style="color: #6b7280;">{node.schedule}</p>
              <p class="text-[11px]" style="color: #4b5563;">{node.dataTypes.join(', ')}</p>
              {#if health?.lastSync}<p class="text-[10px] mt-1" style="color: {health.healthy ? '#16a34a' : '#dc2626'};">Last sync: {timeAgo(health.lastSync)}</p>{/if}
            </div>
          {/each}
        </div>
      </div>
      {@render mobileArrow()}
      <!-- Processing -->
      <div>
        <h2 class="text-xs font-semibold uppercase tracking-wider mb-3" style="color: #1e3a5f;">Processing Layer</h2>
        <div class="space-y-3">
          {#each processing as node}
            {@const health = getHealthForNode(node.id)}
            <div class="rounded-lg p-4" style="background: #1e3a5f; color: white;">
              <div class="flex items-center gap-2 mb-1">
                {#if health}<span class="inline-block w-2 h-2 rounded-full" style="background: {health.healthy ? '#4ade80' : '#f87171'};"></span>{/if}
                <span class="font-semibold text-sm">{node.label}</span>
              </div>
              <p class="text-[11px] mb-1" style="color: rgba(255,255,255,0.6);">{node.schedule}</p>
              <p class="text-[11px]" style="color: rgba(255,255,255,0.8);">{node.dataTypes.join(', ')}</p>
              {#if health?.lastSync}<p class="text-[10px] mt-1" style="color: {health.healthy ? '#4ade80' : '#f87171'};">Last sync: {timeAgo(health.lastSync)}</p>{/if}
            </div>
          {/each}
        </div>
      </div>
      {@render mobileArrow()}
      <!-- Infrastructure -->
      <div>
        <h2 class="text-xs font-semibold uppercase tracking-wider mb-3" style="color: #065f46;">Infrastructure</h2>
        <div class="space-y-3">
          {#each infra as node}
            <div class="rounded-lg p-4" style="background: #065f46; color: white;">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-sm">{INFRA_ICONS[node.icon ?? ''] ?? ''}</span>
                <span class="font-semibold text-sm">{node.label}</span>
              </div>
              <p class="text-[11px] mb-1" style="color: rgba(255,255,255,0.6);">{node.schedule}</p>
              <p class="text-[11px]" style="color: rgba(255,255,255,0.8);">{node.dataTypes.join(', ')}</p>
            </div>
          {/each}
        </div>
      </div>
      {@render mobileArrow()}
      <!-- Outputs -->
      <div>
        <h2 class="text-xs font-semibold uppercase tracking-wider mb-3" style="color: #1e3a5f;">Dashboard Outputs</h2>
        <div class="space-y-3">
          {#each outputs as node}
            <div class="rounded-lg p-4 border" style="background: white; border-color: #1e3a5f;">
              <span class="font-semibold text-sm" style="color: #1e3a5f;">{node.label}</span>
              <p class="text-[11px] mb-1" style="color: #6b7280;">{node.schedule}</p>
              <p class="text-[11px]" style="color: #4b5563;">{node.dataTypes.join(', ')}</p>
            </div>
          {/each}
        </div>
      </div>
    </div>
  {:else}
    <!-- Desktop: SVG flowchart -->
    <div class="leo-card" style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px;">
      <div class="flex flex-wrap gap-x-8 gap-y-2 mb-4 px-2">
        <div class="flex items-center gap-2"><span class="inline-block w-4 h-3 rounded" style="background: #e8f0fe; border: 1px solid #d1d5db;"></span><span class="text-xs" style="color: #4b5563;">Sources</span></div>
        <div class="flex items-center gap-2"><span class="inline-block w-4 h-3 rounded" style="background: #1e3a5f;"></span><span class="text-xs" style="color: #4b5563;">Processing</span></div>
        <div class="flex items-center gap-2"><span class="inline-block w-4 h-3 rounded" style="background: #065f46;"></span><span class="text-xs" style="color: #4b5563;">Infrastructure</span></div>
        <div class="flex items-center gap-2"><span class="inline-block w-4 h-3 rounded" style="background: white; border: 1px solid #1e3a5f;"></span><span class="text-xs" style="color: #4b5563;">Outputs</span></div>
        <div class="flex items-center gap-2"><span class="inline-block w-2 h-2 rounded-full" style="background: #16a34a;"></span><span class="text-xs" style="color: #4b5563;">Healthy</span></div>
        <div class="flex items-center gap-2"><span class="inline-block w-2 h-2 rounded-full" style="background: #dc2626;"></span><span class="text-xs" style="color: #4b5563;">Stale</span></div>
      </div>
      <svg width="100%" height={svgHeight()} viewBox="0 0 1380 {svgHeight()}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#9ca3af" /></marker>
          <marker id="ah-grn" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="#6ee7b7" /></marker>
        </defs>
        <!-- Column headers -->
        <text x={COL_X.source + BOX_W / 2} y="14" text-anchor="middle" font-size="11" font-weight="600" fill="#1e3a5f" font-family="Inter, sans-serif">SOURCE SYSTEMS</text>
        <text x={COL_X.processing + BOX_W / 2} y="14" text-anchor="middle" font-size="11" font-weight="600" fill="#1e3a5f" font-family="Inter, sans-serif">PROCESSING LAYER</text>
        <text x={COL_X.infra + BOX_W / 2} y="14" text-anchor="middle" font-size="11" font-weight="600" fill="#065f46" font-family="Inter, sans-serif">INFRASTRUCTURE</text>
        <text x={COL_X.output + BOX_W / 2} y="14" text-anchor="middle" font-size="11" font-weight="600" fill="#1e3a5f" font-family="Inter, sans-serif">DASHBOARD OUTPUTS</text>
        <!-- Edges -->
        {#each edges as edge}
          {@const from = nodeCenter(edge.from)}
          {@const to = nodeCenter(edge.to)}
          {@const fromCol = getNodeCol(edge.from)}
          {@const toCol = getNodeCol(edge.to)}
          {@const x1 = COL_X[fromCol] + BOX_W}
          {@const x2 = COL_X[toCol]}
          {@const isInfra = fromCol === 'infra' || toCol === 'infra'}
          {#if fromCol === toCol}
            <path d="M {x1} {from.y} C {x1 + 25} {from.y}, {x1 + 25} {to.y}, {x1} {to.y}" stroke={isInfra ? '#6ee7b7' : '#c4cdd8'} stroke-width="1.2" fill="none" stroke-dasharray="4 3" marker-end={isInfra ? 'url(#ah-grn)' : 'url(#arrowhead)'}/>
          {:else}
            {@const midX = (x1 + x2) / 2}
            <path d="M {x1} {from.y} C {midX} {from.y}, {midX} {to.y}, {x2} {to.y}" stroke={isInfra ? '#6ee7b7' : '#9ca3af'} stroke-width="1.2" fill="none" marker-end={isInfra ? 'url(#ah-grn)' : 'url(#arrowhead)'}/>
          {/if}
        {/each}
        <!-- Source boxes -->
        {#each sources as node, i}
          {@const y = boxY(i, sources)}{@const h = boxHeight(node)}{@const health = getHealthForNode(node.id)}
          <rect x={COL_X.source} {y} width={BOX_W} height={h} rx="8" fill={node.comingSoon ? '#f3f4f6' : '#e8f0fe'} stroke="#d1d5db" stroke-width="1" opacity={node.comingSoon ? 0.7 : 1}/>
          {#if health}<circle cx={COL_X.source + 14} cy={y + 16} r="4" fill={health.healthy ? '#16a34a' : '#dc2626'} />{/if}
          <text x={COL_X.source + (health ? 24 : 12)} y={y + 20} font-size="11" font-weight="600" fill="#1e3a5f" font-family="Inter, sans-serif">{node.label}{#if node.comingSoon}<tspan font-size="9" fill="#9ca3af" font-weight="400"> SOON</tspan>{/if}</text>
          <text x={COL_X.source + 12} y={y + 34} font-size="9" fill="#6b7280" font-family="Inter, sans-serif">{node.schedule}</text>
          {#each node.dataTypes as dt, di}<text x={COL_X.source + 12 + (di % 2 === 1 ? 135 : 0)} y={y + 48 + Math.floor(di / 2) * 12} font-size="8" fill="#4b5563" font-family="Inter, sans-serif">{dt}</text>{/each}
          {#if health?.lastSync}<text x={COL_X.source + BOX_W - 8} y={y + h - 6} text-anchor="end" font-size="9" fill={health.healthy ? '#16a34a' : '#dc2626'} font-family="Inter, sans-serif">{timeAgo(health.lastSync)}</text>{/if}
        {/each}
        <!-- Processing boxes -->
        {#each processing as node, i}
          {@const y = boxY(i, processing)}{@const h = boxHeight(node)}{@const health = getHealthForNode(node.id)}
          <rect x={COL_X.processing} {y} width={BOX_W} height={h} rx="8" fill="#1e3a5f" />
          {#if health}<circle cx={COL_X.processing + 14} cy={y + 16} r="4" fill={health.healthy ? '#4ade80' : '#f87171'} />{/if}
          <text x={COL_X.processing + (health ? 24 : 12)} y={y + 20} font-size="11" font-weight="600" fill="white" font-family="Inter, sans-serif">{node.label}</text>
          <text x={COL_X.processing + 12} y={y + 34} font-size="9" fill="rgba(255,255,255,0.6)" font-family="Inter, sans-serif">{node.schedule}</text>
          {#each node.dataTypes as dt, di}<text x={COL_X.processing + 12} y={y + 48 + di * 12} font-size="8" fill="rgba(255,255,255,0.85)" font-family="Inter, sans-serif">{dt}</text>{/each}
          {#if health?.lastSync}<text x={COL_X.processing + BOX_W - 8} y={y + h - 6} text-anchor="end" font-size="9" fill={health.healthy ? '#4ade80' : '#f87171'} font-family="Inter, sans-serif">{timeAgo(health.lastSync)}</text>{/if}
        {/each}
        <!-- Infrastructure boxes -->
        {#each infra as node, i}
          {@const y = boxY(i, infra)}{@const h = boxHeight(node)}
          <rect x={COL_X.infra} {y} width={BOX_W} height={h} rx="8" fill="#065f46" />
          {#if node.icon === 'db'}
            <ellipse cx={COL_X.infra + 14} cy={y + 14} rx="6" ry="3" stroke="white" stroke-width="1.2" fill="none" />
            <line x1={COL_X.infra + 8} y1={y + 14} x2={COL_X.infra + 8} y2={y + 22} stroke="white" stroke-width="1.2" />
            <line x1={COL_X.infra + 20} y1={y + 14} x2={COL_X.infra + 20} y2={y + 22} stroke="white" stroke-width="1.2" />
            <ellipse cx={COL_X.infra + 14} cy={y + 22} rx="6" ry="3" stroke="white" stroke-width="1.2" fill="none" />
          {:else if node.icon === 'cloud'}
            <path d="M {COL_X.infra + 18} {y + 16} a4 4 0 0 0 -8 0 a3 3 0 0 0 0 6 h10 a3 3 0 0 0 0 -6z" stroke="white" stroke-width="1.2" fill="none" />
          {:else if node.icon === 'ci'}
            <circle cx={COL_X.infra + 14} cy={y + 17} r="5" stroke="white" stroke-width="1.2" fill="none" /><circle cx={COL_X.infra + 14} cy={y + 17} r="2" fill="white" />
          {:else if node.icon === 'mail'}
            <rect x={COL_X.infra + 7} y={y + 11} width="14" height="10" rx="2" stroke="white" stroke-width="1.2" fill="none" />
            <path d="M {COL_X.infra + 7} {y + 13} l7 5 7-5" stroke="white" stroke-width="1.2" fill="none" />
          {:else}
            <circle cx={COL_X.infra + 14} cy={y + 17} r="5" stroke="white" stroke-width="1.2" fill="none" />
          {/if}
          <text x={COL_X.infra + 26} y={y + 20} font-size="11" font-weight="600" fill="white" font-family="Inter, sans-serif">{node.label}</text>
          <text x={COL_X.infra + 12} y={y + 34} font-size="9" fill="rgba(255,255,255,0.6)" font-family="Inter, sans-serif">{node.schedule}</text>
          {#each node.dataTypes as dt, di}<text x={COL_X.infra + 12} y={y + 48 + di * 12} font-size="8" fill="rgba(255,255,255,0.85)" font-family="Inter, sans-serif">{dt}</text>{/each}
        {/each}
        <!-- Output boxes -->
        {#each outputs as node, i}
          {@const y = boxY(i, outputs)}{@const h = boxHeight(node)}
          <rect x={COL_X.output} {y} width={BOX_W} height={h} rx="8" fill="white" stroke="#1e3a5f" stroke-width="1.5" />
          <text x={COL_X.output + 12} y={y + 20} font-size="11" font-weight="600" fill="#1e3a5f" font-family="Inter, sans-serif">{node.label}</text>
          <text x={COL_X.output + 12} y={y + 34} font-size="9" fill="#6b7280" font-family="Inter, sans-serif">{node.schedule}</text>
          {#each node.dataTypes as dt, di}<text x={COL_X.output + 12} y={y + 48 + di * 12} font-size="8" fill="#4b5563" font-family="Inter, sans-serif">{dt}</text>{/each}
        {/each}
      </svg>
    </div>
  {/if}

  <!-- Summary table -->
  <div class="mt-8 leo-card" style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px;">
    <h2 class="text-sm font-semibold mb-4" style="color: #1e3a5f;">Sync Status Summary</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm" style="border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <th class="text-left py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Source</th>
            <th class="text-left py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Table</th>
            <th class="text-right py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Records</th>
            <th class="text-left py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Last Sync</th>
            <th class="text-center py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each statuses as s}
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td class="py-2 px-3 font-medium" style="color: #1e3a5f;">{s.source}</td>
              <td class="py-2 px-3" style="color: #6b7280; font-family: monospace; font-size: 12px;">{s.table}</td>
              <td class="py-2 px-3 text-right" style="color: #4b5563;">{s.recordCount.toLocaleString()}</td>
              <td class="py-2 px-3" style="color: #4b5563;">{s.lastSync ? timeAgo(s.lastSync) : 'Never'}</td>
              <td class="py-2 px-3 text-center">
                <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style="background: {s.healthy ? '#dcfce7' : '#fee2e2'}; color: {s.healthy ? '#166534' : '#991b1b'};">
                  <span class="inline-block w-1.5 h-1.5 rounded-full" style="background: {s.healthy ? '#16a34a' : '#dc2626'};"></span>
                  {s.healthy ? 'Healthy' : 'Stale'}
                </span>
              </td>
            </tr>
          {/each}
          {#if statuses.length === 0}
            <tr><td colspan="5" class="py-6 text-center text-sm" style="color: #9ca3af;">No sync data available</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Cron Job Health -->
  <div class="mt-8 leo-card" style="background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px;">
    <h2 class="text-sm font-semibold mb-4" style="color: #1e3a5f;">Cron Job Health</h2>
    <div class="overflow-x-auto">
      <table class="w-full text-sm" style="border-collapse: collapse;">
        <thead>
          <tr style="border-bottom: 1px solid #e5e7eb;">
            <th class="text-left py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Job</th>
            <th class="text-left py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Last Run</th>
            <th class="text-right py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Succeeded</th>
            <th class="text-right py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Failed</th>
            <th class="text-center py-2 px-3 text-xs font-semibold uppercase" style="color: #6b7280;">Status</th>
          </tr>
        </thead>
        <tbody>
          {#each cronStatuses as c}
            {@const succeeded = (c.details?.succeeded as number) ?? 0}
            {@const failed = (c.details?.failed as number) ?? 0}
            {@const isHealthy = c.status === 'healthy'}
            {@const isDegraded = c.status === 'degraded'}
            {@const statusBg = isHealthy ? '#dcfce7' : isDegraded ? '#fef3c7' : c.status === 'unknown' ? '#f3f4f6' : '#fee2e2'}
            {@const statusColor = isHealthy ? '#166534' : isDegraded ? '#92400e' : c.status === 'unknown' ? '#6b7280' : '#991b1b'}
            {@const dotColor = isHealthy ? '#16a34a' : isDegraded ? '#d97706' : c.status === 'unknown' ? '#9ca3af' : '#dc2626'}
            {@const statusLabel = isHealthy ? 'Healthy' : isDegraded ? 'Degraded' : c.status === 'unknown' ? 'No Data' : 'Down'}
            <tr style="border-bottom: 1px solid #f3f4f6;">
              <td class="py-2 px-3 font-medium" style="color: #1e3a5f;">{c.label}</td>
              <td class="py-2 px-3" style="color: #4b5563;">{c.lastRun ? timeAgo(c.lastRun) : 'Never'}</td>
              <td class="py-2 px-3 text-right" style="color: #4b5563;">{succeeded}</td>
              <td class="py-2 px-3 text-right" style="color: {failed > 0 ? '#dc2626' : '#4b5563'};">{failed}</td>
              <td class="py-2 px-3 text-center">
                <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style="background: {statusBg}; color: {statusColor};">
                  <span class="inline-block w-1.5 h-1.5 rounded-full" style="background: {dotColor};"></span>
                  {statusLabel}
                </span>
              </td>
            </tr>
          {/each}
          {#if cronStatuses.length === 0}
            <tr><td colspan="5" class="py-6 text-center text-sm" style="color: #9ca3af;">No cron status data available</td></tr>
          {/if}
        </tbody>
      </table>
    </div>
  </div>
</div>
