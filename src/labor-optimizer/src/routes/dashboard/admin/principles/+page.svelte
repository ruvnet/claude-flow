<script lang="ts">
  import { getClientSupabase } from '$lib/supabase-client';
  import { goto } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';

  let isAdmin = $state(false);
  let authChecked = $state(false);
  let expandAll = $state(false);

  interface Learning {
    id: string;
    location_id: string | null;
    category: string;
    learning: string;
    source: string;
    confidence: number;
    created_at: string;
    locations: { name: string } | null;
  }

  let learnings = $state<Learning[]>([]);
  let learningsLoading = $state(true);
  let learningsFilter = $state('all');
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  $effect(() => {
    const supabase = getClientSupabase();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const email = session?.user?.email ?? null;
      if (email) {
        try {
          const _roleCtrl = new AbortController(); setTimeout(() => _roleCtrl.abort(), 8000); const res = await fetch(`/api/v1/auth/role?email=${encodeURIComponent(email)}`, { signal: _roleCtrl.signal });
          if (res.ok) {
            const data = await res.json();
            isAdmin = data.permissions?.admin ?? false;
          }
        } catch { isAdmin = false; }
      }
      authChecked = true;
      if (!isAdmin && authChecked) goto('/dashboard');
    });
  });

  async function fetchLearnings() {
    try {
      const params = learningsFilter !== 'all' ? `?category=${learningsFilter}` : '';
      const res = await fetch(`/api/v1/admin/learnings${params}`);
      if (res.ok) {
        const data = await res.json();
        learnings = data.learnings || [];
      }
    } catch { /* silent */ }
    learningsLoading = false;
  }

  $effect(() => {
    // Re-fetch when filter changes
    learningsFilter;
    fetchLearnings();
  });

  onMount(() => {
    refreshTimer = setInterval(fetchLearnings, 60_000);
  });

  onDestroy(() => {
    if (refreshTimer) clearInterval(refreshTimer);
  });

  function toggleAll() {
    expandAll = !expandAll;
    const details = document.querySelectorAll('.principles-section');
    details.forEach((el) => {
      (el as HTMLDetailsElement).open = expandAll;
    });
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  const categoryColors: Record<string, string> = {
    forecast: '#2563eb',
    labor: '#7c3aed',
    weather: '#0891b2',
    scheduling: '#059669',
    sales_mix: '#d97706',
  };

  const sourceLabels: Record<string, string> = {
    dow_weight_adapter: 'DOW Weights',
    forecast_accuracy: 'Forecast Accuracy',
    bias_correction: 'Bias Correction',
    weather_correlation: 'Weather',
    toast_sync: 'Toast Sync',
  };

  let groupedLearnings = $derived.by(() => {
    const groups: Record<string, Learning[]> = {};
    for (const l of learnings) {
      if (!groups[l.category]) groups[l.category] = [];
      groups[l.category].push(l);
    }
    return groups;
  });
</script>

<svelte:head>
  <title>Guiding Principles - HELIXO</title>
</svelte:head>

{#if !authChecked}
  <div class="min-h-screen flex items-center justify-center">
    <p class="text-sm text-gray-400">Loading...</p>
  </div>
{:else if !isAdmin}
  <div class="min-h-screen flex items-center justify-center">
    <p class="text-sm text-gray-400">Access denied</p>
  </div>
{:else}
  <div class="px-3 py-4 md:px-4 max-w-[1100px] mx-auto">
    <!-- Header -->
    <div class="mb-8">
      <div class="flex items-center gap-3 mb-2">
        <a href="/dashboard/settings" class="text-sm" style="color: #1e3a5f;">Settings</a>
        <span class="text-gray-300">/</span>
        <span class="text-sm text-gray-500">Guiding Principles</span>
      </div>
      <div class="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 class="text-2xl font-bold" style="color: #1e3a5f;">Guiding Principles</h1>
          <p class="text-sm text-gray-500 mt-1">Methodology, assumptions, and underlying logic for all KPI dashboard features.</p>
        </div>
        <button onclick={toggleAll} class="leo-btn-secondary text-xs">
          {expandAll ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
    </div>

    <!-- Table of Contents -->
    <div class="leo-card p-5 mb-6">
      <h2 class="leo-section-title mb-3">Contents</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <a href="#revenue-forecasting" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">1. Revenue Forecasting</a>
        <a href="#labor-thresholds" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">2. Labor Threshold System</a>
        <a href="#dow-weights" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">3. Daily Labor Projection (DOW Weights)</a>
        <a href="#schedule-approval" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">4. Schedule Approval Workflow</a>
        <a href="#toast-integration" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">5. Toast POS Integration</a>
        <a href="#budget-methodology" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">6. Budget Methodology</a>
        <a href="#variance-analysis" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">7. Variance Analysis</a>
        <a href="#ai-insights" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">8. AI Insights Engine</a>
        <a href="#forecast-accuracy" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">9. Forecast Accuracy & Self-Learning</a>
        <a href="#external-data" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">10. External Data Signals</a>
        <a href="#covers-check" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">11. Covers & Average Check</a>
        <a href="#ptd-totals" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">12. Period-to-Date (PTD) Totals</a>
        <a href="#predictive-staffing" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">13. Predictive Staffing</a>
        <a href="#labor-scheduling" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">14. Labor Scheduling Intelligence</a>
        <a href="#engine-audit" class="text-sm py-1 hover:underline" style="color: #1e3a5f;">15. Engine Audit Framework</a>
        <a href="#system-learnings" class="text-sm py-1 hover:underline" style="color: #7c3aed;">System Learnings (Live)</a>
      </div>
    </div>

    <!-- Sections -->
    <div class="space-y-4">

      <!-- 1. Revenue Forecasting -->
      <details id="revenue-forecasting" class="principles-section leo-card" open>
        <summary class="section-header">
          <span class="section-number">1</span>
          Revenue Forecasting
        </summary>
        <div class="section-body">
          <p class="body-text" style="font-weight: 500; color: #1e3a5f;">HELIXO Proprietary Revenue Forecast Engine</p>
          <p class="body-text">The forecast uses a 14-signal ensemble with adaptive weights and a self-learning neural network.</p>

          <h4 class="subsection-title">Core Signals (Base Weights)</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Signal</th>
                <th class="leo-th" style="border-radius: 0 6px 0 0;">Base Weight</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">1</td><td class="leo-td text-left font-medium">Trailing 2-Week DOW Average</td><td class="leo-td">40%</td></tr>
              <tr><td class="leo-td text-left">2</td><td class="leo-td text-left font-medium">Prior Year Adjusted (364-day lookback w/ YOY growth factor)</td><td class="leo-td">25%</td></tr>
              <tr><td class="leo-td text-left">3</td><td class="leo-td text-left font-medium">Momentum (7-day trend direction and magnitude)</td><td class="leo-td">20%</td></tr>
              <tr><td class="leo-td text-left">4</td><td class="leo-td text-left font-medium">Budget Baseline (daily budget from annual operating plan)</td><td class="leo-td">15%</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Environmental Signals</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Signal</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Details</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">5</td><td class="leo-td text-left font-medium">Weather Intelligence (10%)</td><td class="leo-td text-left">OpenWeatherMap with learned historical correlation. Rain -5-15%, extreme temps -5-10%, perfect weather +2-3%</td></tr>
              <tr><td class="leo-td text-left">6</td><td class="leo-td text-left font-medium">Resy Reservations (15%)</td><td class="leo-td text-left">Booking velocity, walk-in estimates, booked cover counts</td></tr>
              <tr><td class="leo-td text-left">7</td><td class="leo-td text-left font-medium">Cross-Location Learning (5-10%)</td><td class="leo-td text-left">Market trends, concept trends, peer momentum across all 11 locations</td></tr>
              <tr><td class="leo-td text-left">8</td><td class="leo-td text-left font-medium">Event Intelligence (multiplier)</td><td class="leo-td text-left">Ticketmaster/PredictHQ local events + US holiday calendar</td></tr>
              <tr><td class="leo-td text-left">9</td><td class="leo-td text-left font-medium">Market Signals (+/-5%)</td><td class="leo-td text-left">Gas prices (EIA), CPI inflation (BLS)</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Behavioral Signals</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Signal</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Details</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">10</td><td class="leo-td text-left font-medium">Guest Behavior (+/-12%)</td><td class="leo-td text-left">Booking velocity, no-show prediction, party mix, check avg trends</td></tr>
              <tr><td class="leo-td text-left">11</td><td class="leo-td text-left font-medium">Hourly Revenue Curves</td><td class="leo-td text-left">Intra-day pattern modeling for real-time projection</td></tr>
              <tr><td class="leo-td text-left">12</td><td class="leo-td text-left font-medium">Override Tag Learning</td><td class="leo-td text-left">Historical impact of Private Events, Holidays, etc.</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Neural Ensemble (auto-enables with 30+ training samples)</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Signal</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Details</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">13</td><td class="leo-td text-left font-medium">Neural MLP</td><td class="leo-td text-left">19-feature TypeScript neural network [32 > 16 > 8 > 1]</td></tr>
              <tr><td class="leo-td text-left">14</td><td class="leo-td text-left font-medium">Analogy-Based</td><td class="leo-td text-left">Most similar historical day by feature distance</td></tr>
              <tr><td class="leo-td text-left">+</td><td class="leo-td text-left font-medium">Manager Consensus</td><td class="leo-td text-left">Historical override patterns from manager adjustments</td></tr>
            </tbody>
          </table>

          <!-- Neural Revenue Predictor Deep Dive -->
          <div class="neural-callout">
            <div class="neural-callout-header">
              <div class="neural-callout-badge">PROPRIETARY</div>
              <h4 class="neural-callout-title">HELIXO Neural Revenue Predictor</h4>
            </div>

            <div class="neural-callout-body">
              <h5 class="neural-sub">Architecture</h5>
              <ul class="body-list">
                <li>Pure TypeScript implementation &mdash; no external ML libraries, no Python, no GPU required</li>
                <li>Multi-Layer Perceptron: <span class="code-inline">19 inputs &rarr; 32 &rarr; 16 &rarr; 8 &rarr; 1 output</span></li>
                <li>ReLU activation on hidden layers, linear output</li>
                <li>Xavier weight initialization for stable training</li>
                <li>Mini-batch stochastic gradient descent with early stopping</li>
              </ul>

              <h5 class="neural-sub">19 Input Features</h5>
              <div class="neural-features-grid">
                <div class="neural-feature-group">
                  <span class="neural-feature-label">1&ndash;7</span>
                  <span>Day of week (one-hot encoded, 7 features)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">8</span>
                  <span>Week-in-period (1&ndash;4, normalized)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">9</span>
                  <span>Period number (1&ndash;13, normalized)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">10</span>
                  <span>Month (1&ndash;12, normalized)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">11</span>
                  <span>Is holiday (binary)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">12</span>
                  <span>Weather temperature (normalized)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">13</span>
                  <span>Weather precipitation probability (0&ndash;1)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">14</span>
                  <span>Resy booked covers (normalized by location max)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">15</span>
                  <span>Prior year same-DOW revenue (normalized)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">16</span>
                  <span>Trailing 2-week DOW average (normalized)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">17</span>
                  <span>Budget for the day (normalized)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">18</span>
                  <span>Check average trend (% change last 30 days)</span>
                </div>
                <div class="neural-feature-group">
                  <span class="neural-feature-label">19</span>
                  <span>DOW revenue share (% of weekly total)</span>
                </div>
              </div>

              <h5 class="neural-sub">Training</h5>
              <ul class="body-list">
                <li>Trains on all historical daily_actuals for each location</li>
                <li>Retrains weekly during Sunday cron (fresh weights with latest data)</li>
                <li>Early stopping prevents overfitting (monitors validation loss)</li>
                <li>Weights stored as JSON in Supabase &mdash; portable, inspectable, versioned</li>
              </ul>

              <h5 class="neural-sub">What Makes It Special</h5>
              <ul class="body-list">
                <li>Runs in Vercel serverless &mdash; no GPU infrastructure needed</li>
                <li>Learns non-linear interactions between signals (e.g., rain on Saturday in March affects Lowland differently than Kamper's)</li>
                <li>Each location gets its own trained model &mdash; personalized to that venue's patterns</li>
                <li>Auto-enables only when sufficient training data exists (30+ samples, MAPE &lt; 30%)</li>
                <li>Part of a 4-model ensemble &mdash; never operates alone, always weighted by accuracy</li>
              </ul>

              <h5 class="neural-sub">4-Model Ensemble</h5>
              <table class="signal-table">
                <thead>
                  <tr>
                    <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                    <th class="leo-th text-left">Model</th>
                    <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Role</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td class="leo-td text-left">1</td><td class="leo-td text-left font-medium">Statistical (weighted signal blend)</td><td class="leo-td text-left">Reliable baseline</td></tr>
                  <tr><td class="leo-td text-left">2</td><td class="leo-td text-left font-medium">Neural MLP</td><td class="leo-td text-left">Captures non-linear patterns</td></tr>
                  <tr><td class="leo-td text-left">3</td><td class="leo-td text-left font-medium">Analogy-based</td><td class="leo-td text-left">Finds most similar historical day by feature distance</td></tr>
                  <tr><td class="leo-td text-left">4</td><td class="leo-td text-left font-medium">Manager consensus</td><td class="leo-td text-left">Learns from override patterns</td></tr>
                </tbody>
              </table>
              <p class="body-text" style="margin-top: 8px;">Ensemble weights are inversely proportional to each model's recent MAPE (more accurate = higher weight). When models agree, confidence is high. When they disagree, it flags for manager review.</p>
            </div>
          </div>

          <h4 class="subsection-title">Self-Improvement</h4>
          <ul class="body-list">
            <li>Adaptive weights recalibrate weekly based on component accuracy</li>
            <li>Bias detection corrects systematic over/under-forecasting by DOW</li>
            <li>YTD trend scaling adjusts for macro revenue trajectory</li>
            <li>Cross-location pattern sharing accelerates learning for newer locations</li>
            <li>Neural model retrains weekly on latest actuals</li>
            <li>Forecast accuracy self-grades on 0-100 scale with per-DOW analysis</li>
          </ul>

          <h4 class="subsection-title">Revenue Enhancement Signals (v3.0)</h4>
          <p class="body-text">Seven additional revenue adjustment factors are computed as a composite multiplier applied after the base 14-signal ensemble:</p>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Enhancement</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">1</td><td class="leo-td text-left font-medium">Price Elasticity</td><td class="leo-td text-left">Measures how menu price changes affect order volume; uses 60-day trailing check average to detect price-sensitivity shifts</td></tr>
              <tr><td class="leo-td text-left">2</td><td class="leo-td text-left font-medium">Booking Pace</td><td class="leo-td text-left">Compares current Resy reservation pace vs same-DOW trailing average; fast-fill days get upward adjustment (+2-5%)</td></tr>
              <tr><td class="leo-td text-left">3</td><td class="leo-td text-left font-medium">Neighborhood Demand</td><td class="leo-td text-left">Aggregates cross-location booking and revenue trends for locations in the same neighborhood or market cluster</td></tr>
              <tr><td class="leo-td text-left">4</td><td class="leo-td text-left font-medium">Causal Impact</td><td class="leo-td text-left">Detects revenue impact of specific events (menu launches, PR, private events) using before/after comparison with control periods</td></tr>
              <tr><td class="leo-td text-left">5</td><td class="leo-td text-left font-medium">Day-Part Decomposition</td><td class="leo-td text-left">Splits revenue forecast into lunch / happy hour / dinner / late-night segments using hourly sales curves for more precise intra-day modeling</td></tr>
              <tr><td class="leo-td text-left">6</td><td class="leo-td text-left font-medium">Cross-Sell Index</td><td class="leo-td text-left">Tracks beverage attach rate and dessert capture rate trends; rising cross-sell lifts per-cover revenue projections</td></tr>
              <tr><td class="leo-td text-left">7</td><td class="leo-td text-left font-medium">Check Average Momentum</td><td class="leo-td text-left">14-day exponential moving average of check size change; detects mix shifts (e.g., wine-heavy weekends) that affect total revenue</td></tr>
            </tbody>
          </table>
          <div class="formula-box">
            Final Forecast = Base Ensemble Output &times; Composite Revenue Enhancement Factor
          </div>
          <p class="body-text">Each enhancement factor defaults to 1.0 (neutral). When data supports a signal, the factor adjusts between 0.92 and 1.08. All seven factors are multiplied into a single composite that applies after the base 14-signal blend. Enhancements with insufficient data are automatically excluded (factor = 1.0).</p>

          <h4 class="subsection-title">Confidence Scoring</h4>
          <p class="body-text">Each forecast includes a confidence score (0-100) based on data availability, historical accuracy for that day-of-week, signal agreement, and neural model confidence. Low-confidence forecasts are flagged for manager review.</p>

          <h4 class="subsection-title">Forecast Locking</h4>
          <p class="body-text">Once a manager accepts a forecast, it locks and becomes the official projection for scheduling and labor targets. Only admin/director roles can unlock a previously accepted forecast.</p>
        </div>
      </details>

      <!-- 2. Labor Threshold System -->
      <details id="labor-thresholds" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">2</span>
          Labor Threshold System
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Revenue Bracket Structure</h4>
          <p class="body-text">Weekly revenue is bucketed into brackets ranging from $60K to $125K in $5K increments. Each bracket determines total weekly labor dollar allocation per position type.</p>

          <h4 class="subsection-title">Position Allocations</h4>
          <p class="body-text">Each bracket defines weekly labor dollars for the following positions:</p>
          <div class="tag-row">
            <span class="tag">Server</span>
            <span class="tag">Bartender</span>
            <span class="tag">Host</span>
            <span class="tag">Support</span>
            <span class="tag">Training</span>
            <span class="tag">Line Cooks</span>
            <span class="tag">Prep Cooks</span>
            <span class="tag">Dishwashers</span>
          </div>

          <h4 class="subsection-title">Bracket Calibration</h4>
          <p class="body-text">Threshold brackets are calibrated using three inputs: the annual budget, historical labor-to-revenue ratios, and the Restaurant Questionnaire (which captures operational characteristics like service style, menu complexity, and layout).</p>

          <h4 class="subsection-title">Change Control</h4>
          <p class="body-text">Any modification to threshold brackets requires admin approval. Changes are logged with timestamp, user, and justification.</p>
        </div>
      </details>

      <!-- 3. Daily Labor Projection (DOW Weights) -->
      <details id="dow-weights" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">3</span>
          Daily Labor Projection (DOW Weights)
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Purpose</h4>
          <p class="body-text">Weekly labor targets (from the threshold system) must be distributed across seven days. Day-of-week weights reflect actual business volume patterns, allocating more labor to high-volume days.</p>

          <h4 class="subsection-title">Default Weights</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Day</th>
                <th class="leo-th">Mon</th>
                <th class="leo-th">Tue</th>
                <th class="leo-th">Wed</th>
                <th class="leo-th">Thu</th>
                <th class="leo-th">Fri</th>
                <th class="leo-th">Sat</th>
                <th class="leo-th" style="border-radius: 0 6px 0 0;">Sun</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="leo-td text-left font-medium">Weight</td>
                <td class="leo-td">10.2%</td>
                <td class="leo-td">10.2%</td>
                <td class="leo-td">11.7%</td>
                <td class="leo-td">15.1%</td>
                <td class="leo-td">20.1%</td>
                <td class="leo-td">20.1%</td>
                <td class="leo-td">12.6%</td>
              </tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Adaptive Learning</h4>
          <p class="body-text">Weights adapt weekly using a blended approach: 70% current weight + 30% actual labor distribution from the prior week. This allows gradual convergence toward real patterns without overreacting to single-week anomalies.</p>

          <h4 class="subsection-title">Reconciliation</h4>
          <p class="body-text">Daily projections always sum to the weekly threshold total. If manual adjustments are made to individual days, the system redistributes the remainder proportionally across untouched days.</p>
        </div>
      </details>

      <!-- 4. Schedule Approval Workflow -->
      <details id="schedule-approval" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">4</span>
          Schedule Approval Workflow
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Weekly Timeline</h4>
          <div class="timeline">
            <div class="timeline-step">
              <span class="timeline-dot"></span>
              <div>
                <p class="font-medium text-sm" style="color: #1e3a5f;">Wednesday (by EOD)</p>
                <p class="body-text mt-0">Manager reviews and accepts the AI forecast in HELIXO. Accepted forecast locks revenue projections and generates projected labor targets per position per day.</p>
              </div>
            </div>
            <div class="timeline-step">
              <span class="timeline-dot"></span>
              <div>
                <p class="font-medium text-sm" style="color: #1e3a5f;">Wed-Thu</p>
                <p class="body-text mt-0">Team builds schedules in Dolce TeamWork using the projected labor dollar targets as their guide.</p>
              </div>
            </div>
            <div class="timeline-step">
              <span class="timeline-dot"></span>
              <div>
                <p class="font-medium text-sm" style="color: #1e3a5f;">Thursday 1:00 PM EST</p>
                <p class="body-text mt-0">Dolce scheduled labor auto-syncs to HELIXO. Scheduled hours and dollars by position populate the schedule approval screen.</p>
              </div>
            </div>
            <div class="timeline-step">
              <span class="timeline-dot"></span>
              <div>
                <p class="font-medium text-sm" style="color: #1e3a5f;">Thursday (afternoon)</p>
                <p class="body-text mt-0">Manager reviews scheduled vs projected labor variance and submits the schedule for approval through HELIXO.</p>
              </div>
            </div>
            <div class="timeline-step">
              <span class="timeline-dot"></span>
              <div>
                <p class="font-medium text-sm" style="color: #1e3a5f;">Thu-Fri</p>
                <p class="body-text mt-0">Admin/Director reviews the submitted schedule in HELIXO and approves or denies. An email notification is sent to the manager with the decision and any notes.</p>
              </div>
            </div>
          </div>

          <h4 class="subsection-title">Email Notifications</h4>
          <p class="body-text">HELIXO sends branded email notifications at each stage: submission confirmation to admin, and approval/denial notification to the submitting manager. Denial emails include the admin's revision notes.</p>

          <h4 class="subsection-title">Schedule Builder Integration</h4>
          <p class="body-text">The Schedule Builder provides an AI-powered drag-and-drop interface for building weekly schedules. It reads the accepted forecast, labor targets, and staffing constraints to pre-populate recommended shifts. Managers can then adjust individual assignments before submitting for approval. The builder enforces min/max headcount constraints per position and flags overtime or fatigue risks in real time.</p>
        </div>
      </details>

      <!-- 5. Toast POS Integration -->
      <details id="toast-integration" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">5</span>
          Toast POS Integration
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Daily Sync</h4>
          <p class="body-text">Data syncs daily at <strong>5:00 AM EST</strong>. Each sync pulls the following for the prior business day:</p>
          <ul class="body-list">
            <li>Net revenue (excluding tax and tips)</li>
            <li>Cover counts</li>
            <li>Labor by job position (hours and dollars)</li>
            <li>Sales mix breakdown</li>
            <li>PMIX (product mix) detail</li>
          </ul>

          <h4 class="subsection-title">Revenue Calculation</h4>
          <p class="body-text">Revenue uses <code class="code-inline">checks[].amount</code> (net), not <code class="code-inline">totalAmount</code> (which includes tax and tips). This ensures consistency with industry-standard net revenue reporting.</p>

          <h4 class="subsection-title">Labor Calculation</h4>
          <p class="body-text">Labor cost is calculated from time entries multiplied by hourly rate for each employee, grouped by their Toast job position.</p>

          <h4 class="subsection-title">Position Mapping</h4>
          <p class="body-text">Toast job positions are mapped to dashboard positions. This mapping is configurable in Settings to accommodate location-specific naming conventions.</p>

          <h4 class="subsection-title">Sales Mix Categories</h4>
          <div class="tag-row">
            <span class="tag">Food</span>
            <span class="tag">Cocktails</span>
            <span class="tag">Liquor</span>
            <span class="tag">Wine</span>
            <span class="tag">Beer</span>
            <span class="tag">Non-Alcoholic</span>
            <span class="tag">Other</span>
          </div>
        </div>
      </details>

      <!-- 6. Budget Methodology -->
      <details id="budget-methodology" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">6</span>
          Budget Methodology
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Source Data</h4>
          <p class="body-text">Annual budget is loaded from the Excel Lead Sheet. The fiscal year spans 364 days (52 weeks) on a Monday-through-Sunday calendar.</p>

          <h4 class="subsection-title">Fiscal Year Structure</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Parameter</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left font-medium">Fiscal year start</td><td class="leo-td text-left">Last Monday of December (12/29/2025 for FY2026)</td></tr>
              <tr><td class="leo-td text-left font-medium">Duration</td><td class="leo-td text-left">364 days (52 weeks)</td></tr>
              <tr><td class="leo-td text-left font-medium">Period structure</td><td class="leo-td text-left">13 four-week periods (P1 through P13)</td></tr>
              <tr><td class="leo-td text-left font-medium">Week definition</td><td class="leo-td text-left">Monday through Sunday</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Budget Provides</h4>
          <ul class="body-list">
            <li>Daily revenue targets</li>
            <li>Daily labor dollars by position</li>
          </ul>

          <h4 class="subsection-title">Variance Convention</h4>
          <p class="body-text">Variance = Actual - Budget. For labor costs, a positive variance means actual spending exceeded the budget (unfavorable). For revenue, a positive variance means outperformance (favorable).</p>
        </div>
      </details>

      <!-- 7. Variance Analysis -->
      <details id="variance-analysis" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">7</span>
          Variance Analysis
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Revenue Variance</h4>
          <ul class="body-list">
            <li><strong>Actual vs Budget:</strong> How actual revenue compares to the annual plan</li>
            <li><strong>Actual vs Forecast:</strong> How actual revenue compares to the AI-generated forecast</li>
          </ul>

          <h4 class="subsection-title">Labor Variance</h4>
          <ul class="body-list">
            <li><strong>Actual vs Projected:</strong> Actual labor compared to the threshold-driven target (primary operational metric)</li>
            <li><strong>Actual vs Budget:</strong> Actual labor compared to the annual plan</li>
          </ul>

          <h4 class="subsection-title">Flagging Threshold</h4>
          <p class="body-text">Positions where actual labor exceeds projected by more than 1.5% of revenue are automatically flagged for review. This identifies meaningful overages while filtering out noise.</p>

          <h4 class="subsection-title">Percentage Mode Convention</h4>
          <p class="body-text">When viewing data in percentage mode, variance is calculated as the <em>difference of percentages</em>, not percentage change. For example: if Actual Labor % is 22.5% and Projected Labor % is 20.0%, variance = +2.5 percentage points (not +12.5%).</p>

          <h4 class="subsection-title">Color Convention</h4>
          <div class="flex items-center gap-4 mt-2">
            <span class="inline-flex items-center gap-2 text-sm"><span class="w-3 h-3 rounded-full inline-block" style="background: #dc2626;"></span> Positive labor variance = over budget (unfavorable)</span>
            <span class="inline-flex items-center gap-2 text-sm"><span class="w-3 h-3 rounded-full inline-block" style="background: #16a34a;"></span> Negative labor variance = under budget (favorable)</span>
          </div>
        </div>
      </details>

      <!-- 8. AI Insights Engine -->
      <details id="ai-insights" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">8</span>
          AI Insights Engine
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Daily Narrative</h4>
          <p class="body-text">An automated narrative is generated each day from multiple data sources:</p>
          <ul class="body-list">
            <li>Revenue performance vs budget and forecast</li>
            <li>Cover count and average check trends</li>
            <li>Sales mix shifts and PMIX movers (top gaining/declining items)</li>
            <li>Labor variance by position</li>
            <li>Weather conditions and reservation data</li>
          </ul>

          <h4 class="subsection-title">Comps & Discounts</h4>
          <p class="body-text">Comps and discounts are tracked as a percentage of revenue and included in daily reporting when they exceed normal thresholds.</p>

          <h4 class="subsection-title">Labor Savings Suggestions</h4>
          <p class="body-text">The system analyzes hourly labor efficiency and identifies potential savings opportunities based on periods of low revenue-per-labor-hour.</p>

          <h4 class="subsection-title">Manager Notes</h4>
          <p class="body-text">Each day includes a free-text narrative field where managers can add operational context (e.g., staffing issues, special circumstances, equipment problems).</p>

          <h4 class="subsection-title">PDF Distribution</h4>
          <p class="body-text">A PDF report is compiled and emailed daily at <strong>5:30 AM EST</strong> to the location's distribution group.</p>
        </div>
      </details>

      <!-- 9. Forecast Accuracy & Self-Learning -->
      <details id="forecast-accuracy" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">9</span>
          Forecast Accuracy & Self-Learning
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Self-Grading System</h4>
          <p class="body-text">Forecast accuracy is scored on a 0-100 scale composed of five weighted components:</p>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Component</th>
                <th class="leo-th">Weight</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left font-medium">Accuracy</td><td class="leo-td">30%</td><td class="leo-td text-left">How close forecasts are to actual revenue (MAPE inverse)</td></tr>
              <tr><td class="leo-td text-left font-medium">Consistency</td><td class="leo-td">20%</td><td class="leo-td text-left">Stability of forecast quality across days</td></tr>
              <tr><td class="leo-td text-left font-medium">Bias Control</td><td class="leo-td">20%</td><td class="leo-td text-left">Absence of systematic over- or under-forecasting</td></tr>
              <tr><td class="leo-td text-left font-medium">Improvement</td><td class="leo-td">15%</td><td class="leo-td text-left">Trend of accuracy improving over time</td></tr>
              <tr><td class="leo-td text-left font-medium">Coverage</td><td class="leo-td">15%</td><td class="leo-td text-left">Percentage of days with sufficient data for forecasting</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">MAPE Tracking</h4>
          <p class="body-text">Mean Absolute Percentage Error is tracked per day-of-week to identify which days are more or less predictable. This informs both weight adjustments and confidence scoring.</p>

          <h4 class="subsection-title">Bias Detection</h4>
          <p class="body-text">If the system detects a systematic bias greater than 3% (consistently over- or under-forecasting), it auto-corrects by applying a bias offset to future forecasts until the bias returns to acceptable levels.</p>

          <h4 class="subsection-title">Override Tag Learning</h4>
          <p class="body-text">When managers tag a forecast with an event type (e.g., "Holiday," "Weather"), the system tracks the actual revenue impact. Over time, it builds a profile of how each event type affects revenue and can pre-adjust forecasts when similar events are anticipated.</p>

          <h4 class="subsection-title">Adaptive Signal Weights</h4>
          <p class="body-text">Forecast signal weights shift based on performance. A signal that has been more accurate recently can rise to a 50% weight; a consistently poor signal drops to a 10% floor. This ensures the forecast model self-improves continuously.</p>

          <h4 class="subsection-title">Target</h4>
          <p class="body-text">The goal is continuous improvement toward 99% accuracy through iterative learning, bias correction, and event impact modeling.</p>
        </div>
      </details>

      <!-- 10. External Data Signals -->
      <details id="external-data" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">10</span>
          External Data Signals
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Weather (OpenWeatherMap)</h4>
          <ul class="body-list">
            <li>5-day forecast pulled daily</li>
            <li>Historical weather-to-revenue correlation tracked per location</li>
            <li>Learned impact: rain -5-15%, extreme temps -5-10%, perfect weather +2-3%</li>
            <li>Weighted at approximately <strong>10%</strong> of forecast when data is available</li>
          </ul>

          <h4 class="subsection-title">Reservations (Resy)</h4>
          <ul class="body-list">
            <li>Upcoming covers pulled from Resy daily at <strong>9:00 AM EST</strong></li>
            <li>Booking velocity and walk-in ratio estimated from historical reservation-to-actual-cover ratio</li>
            <li>Booked cover counts used directly in forecast ensemble</li>
            <li>Weighted at approximately <strong>15%</strong> of forecast when data is available</li>
          </ul>

          <h4 class="subsection-title">Event Intelligence (Ticketmaster / PredictHQ)</h4>
          <ul class="body-list">
            <li>Local event detection within configurable radius of each location</li>
            <li>US holiday calendar with learned per-location holiday impact multipliers</li>
            <li>Applied as a multiplier on top of the base forecast blend</li>
          </ul>

          <h4 class="subsection-title">Market Signals</h4>
          <ul class="body-list">
            <li>Gas prices from EIA (Energy Information Administration)</li>
            <li>CPI inflation data from BLS (Bureau of Labor Statistics)</li>
            <li>Applied as +/-5% adjustment when macro trends diverge from normal</li>
          </ul>

          <h4 class="subsection-title">Cross-Location Learning</h4>
          <ul class="body-list">
            <li>Market-wide trends aggregated across all 11 locations</li>
            <li>Concept-level trends (e.g., all Italian concepts, all cocktail bars)</li>
            <li>Peer momentum signals accelerate learning for newer locations</li>
            <li>Weighted at <strong>5-10%</strong> depending on location data maturity</li>
          </ul>

          <h4 class="subsection-title">Signal Availability</h4>
          <p class="body-text">All external signals are optional. When unavailable, their weight is redistributed proportionally to the four core signals. Confidence score adjusts downward when external data is missing.</p>
        </div>
      </details>

      <!-- 11. Covers & Average Check -->
      <details id="covers-check" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">11</span>
          Covers & Average Check
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Cover Calculation</h4>
          <p class="body-text">Projected covers are derived from the forecast:</p>
          <div class="formula-box">
            Projected Covers = Forecast Revenue / Trailing 2-Week Average Check
          </div>

          <h4 class="subsection-title">Average Check Decomposition</h4>
          <p class="body-text">Average check is calculated as:</p>
          <div class="formula-box">
            Avg Check = SUM(revenue) / SUM(covers) over prior 14 days where revenue > 0
          </div>
          <p class="body-text">Only days with actual revenue are included. If fewer than 7 qualifying days exist in the trailing 14-day window, the system falls back to a <strong>$70 default</strong>.</p>
          <p class="body-text">Average check is further decomposed into food vs beverage trends. The food-to-beverage ratio is tracked over time, allowing the system to detect shifts in guest spending behavior (e.g., beverage-heavy weekends vs food-driven weeknight dining).</p>

          <h4 class="subsection-title">Party Mix Forecasting</h4>
          <p class="body-text">The system tracks party size distribution (2-tops, 4-tops, 6+ parties) and their impact on average check and covers. Larger parties tend to have lower per-cover spend but higher total check values. Party mix shifts directly affect cover-to-revenue ratios and are factored into cover projections.</p>

          <h4 class="subsection-title">Manager Workflow</h4>
          <p class="body-text">Managers set revenue only during the forecast acceptance process. Cover counts are auto-calculated and displayed as a reference; they do not need to be manually entered.</p>
        </div>
      </details>

      <!-- 12. Period-to-Date (PTD) Totals -->
      <details id="ptd-totals" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">12</span>
          Period-to-Date (PTD) Totals
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">Actuals-Only Summation</h4>
          <p class="body-text">Dashboard totals (weekly, period, monthly) only sum days that have actual sales data. This prevents mixing real actuals with zeros or unfulfilled forecasts, which would produce misleading running totals.</p>

          <h4 class="subsection-title">Monthly Report Distinction</h4>
          <p class="body-text">The monthly report provides two views:</p>
          <ul class="body-list">
            <li><strong>MTD (Month-to-Date):</strong> Sum of actuals only, for days that have occurred and been synced</li>
            <li><strong>Full Month Total:</strong> Actuals for past days + forecast for remaining future days, giving a projected month-end picture</li>
          </ul>
          <p class="body-text">This dual view allows operators to see both current reality and expected outcome for planning purposes.</p>
        </div>
      </details>

      <!-- 13. Predictive Staffing -->
      <details id="predictive-staffing" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">13</span>
          Predictive Staffing
        </summary>
        <div class="section-body">
          <h4 class="subsection-title">How It Works</h4>
          <p class="body-text">The predictive staffing pipeline converts a revenue forecast into position-level headcount recommendations:</p>
          <div class="formula-box">
            Revenue Forecast &rarr; Threshold Bracket &rarr; Position-Level Labor $ &rarr; Shift Distribution
          </div>
          <ul class="body-list">
            <li>The accepted forecast revenue determines the weekly labor threshold bracket</li>
            <li>Each bracket defines weekly labor dollars per position (Server, Bartender, Host, Line Cooks, etc.)</li>
            <li>DOW weights distribute the weekly total to daily amounts</li>
            <li>The staffing engine converts daily labor dollars into headcount recommendations</li>
          </ul>

          <h4 class="subsection-title">Shift Templates</h4>
          <p class="body-text">Three service styles are auto-detected from hourly sales data:</p>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Service Style</th>
                <th class="leo-th text-left">Example Locations</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Shift Pattern</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left font-medium">Dinner Only</td><td class="leo-td text-left">Lowland, Mulherin's</td><td class="leo-td text-left">Shifts start 4-6 PM; stagger openers / peak / closers</td></tr>
              <tr><td class="leo-td text-left font-medium">Lunch + Dinner</td><td class="leo-td text-left">Le Supreme, The Quoin</td><td class="leo-td text-left">Split shifts with lunch (11 AM-3 PM) and dinner (4 PM-close)</td></tr>
              <tr><td class="leo-td text-left font-medium">All Day</td><td class="leo-td text-left">Little Wing</td><td class="leo-td text-left">Continuous coverage from open to close</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Headcount Calculation</h4>
          <p class="body-text">Daily labor dollars are converted to headcount per position:</p>
          <div class="formula-box">
            Daily Labor $ &divide; Avg Hourly Rate = Total Hours Needed
          </div>
          <div class="formula-box">
            Total Hours &divide; Avg Shift Length = Headcount
          </div>
          <p class="body-text">Headcount is then distributed across shift slots:</p>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Slot</th>
                <th class="leo-th" style="border-radius: 0 6px 0 0;">% of Headcount</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left font-medium">Opener</td><td class="leo-td">30%</td></tr>
              <tr><td class="leo-td text-left font-medium">Peak</td><td class="leo-td">50%</td></tr>
              <tr><td class="leo-td text-left font-medium">Closer</td><td class="leo-td">20%</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Average Hourly Rates</h4>
          <p class="body-text">Hourly rates are pulled from the last 30 days of actual Toast labor data, calculated per position per location. Rates self-update as wages change, ensuring headcount projections stay calibrated without manual intervention.</p>

          <h4 class="subsection-title">Integration with Schedule Approval</h4>
          <ul class="body-list">
            <li>Predictive staffing outputs become the "Projected" numbers on the Schedule Approval tab</li>
            <li>Managers use these as a guide when building schedules in Dolce TeamWork</li>
            <li>Variance between projected and scheduled headcount/dollars is flagged during the approval workflow</li>
          </ul>

          <h4 class="subsection-title">Future: Export to Dolce</h4>
          <p class="body-text">A planned feature will push recommended shifts directly into Dolce TeamWork scheduling, allowing managers to start from the AI-generated staffing plan rather than building from scratch.</p>
        </div>
      </details>

      <!-- 14. Labor Scheduling Intelligence -->
      <details id="labor-scheduling" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">14</span>
          Labor Scheduling Intelligence
        </summary>
        <div class="section-body">
          <p class="body-text" style="font-weight: 500; color: #1e3a5f;">7-Layer Neural Scheduling Engine</p>
          <p class="body-text">The scheduling engine transforms revenue forecasts into optimized employee assignments through seven sequential processing layers. Each layer adds intelligence to the schedule, from basic rule compliance through self-learning feedback.</p>

          <div class="neural-callout">
            <div class="neural-callout-header">
              <div class="neural-callout-badge">PROPRIETARY</div>
              <h4 class="neural-callout-title">HELIXO Neural Scheduling Engine</h4>
            </div>
            <div class="neural-callout-body">
              <h5 class="neural-sub">Layer 1: Rule-Based Scoring</h5>
              <ul class="body-list">
                <li>Position eligibility: only employees trained for the role are considered</li>
                <li>Hourly rate optimization: assigns lower-rate employees first when skill is equal</li>
                <li>Hours compliance: respects min/max shift lengths from staffing_constraints</li>
                <li>Seniority weighting: tenure-based tiebreaker when scores are equal</li>
              </ul>

              <h5 class="neural-sub">Layer 2: Employee Performance Scoring</h5>
              <ul class="body-list">
                <li><strong>Revenue per labor hour (RPLH):</strong> trailing 30-day average of revenue generated during shifts</li>
                <li><strong>Check average impact:</strong> difference between employee's shifts and location mean check average</li>
                <li><strong>Turn speed:</strong> average covers served per hour vs position benchmark</li>
                <li><strong>Reliability score:</strong> attendance rate, no-shows, late arrivals over 90 days</li>
              </ul>

              <h5 class="neural-sub">Layer 3: Full-Week Constraint Optimization</h5>
              <p class="body-text">Simultaneously optimizes all 7 days of the schedule against hard and soft constraints:</p>
              <table class="signal-table">
                <thead>
                  <tr>
                    <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Type</th>
                    <th class="leo-th text-left">Constraint</th>
                    <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Penalty</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td class="leo-td text-left font-medium">Hard</td><td class="leo-td text-left">Min/max headcount per position per day</td><td class="leo-td text-left">Schedule rejected</td></tr>
                  <tr><td class="leo-td text-left font-medium">Hard</td><td class="leo-td text-left">Max weekly hours per employee (40h default)</td><td class="leo-td text-left">Schedule rejected</td></tr>
                  <tr><td class="leo-td text-left font-medium">Soft</td><td class="leo-td text-left">Target labor $ per position per day</td><td class="leo-td text-left">Weighted penalty score</td></tr>
                  <tr><td class="leo-td text-left font-medium">Soft</td><td class="leo-td text-left">Even distribution of hours across eligible staff</td><td class="leo-td text-left">Weighted penalty score</td></tr>
                  <tr><td class="leo-td text-left font-medium">Soft</td><td class="leo-td text-left">Consecutive day limits (max 6 in a row)</td><td class="leo-td text-left">Weighted penalty score</td></tr>
                </tbody>
              </table>

              <h5 class="neural-sub">Layer 4: Revenue Attribution</h5>
              <ul class="body-list">
                <li>High-performing employees (top 20% by RPLH) are preferentially assigned to peak revenue shifts (Friday/Saturday dinner)</li>
                <li>Revenue impact score: estimates the dollar uplift of placing a specific employee on a specific shift</li>
                <li>Cross-trains are identified and slotted for flex coverage on moderate-volume days</li>
              </ul>

              <h5 class="neural-sub">Layer 5: Fatigue Prevention</h5>
              <ul class="body-list">
                <li>4-week rolling hours tracker prevents chronic overwork</li>
                <li>Consecutive days worked: warns at 5, blocks at 7 without override</li>
                <li>Shift intensity scoring: double shifts and clopens (close then open) are penalized</li>
                <li>Recovery period enforcement: minimum 10-hour gap between shifts</li>
              </ul>

              <h5 class="neural-sub">Layer 6: Self-Learning Feedback Loop</h5>
              <ul class="body-list">
                <li>Weekly retraining from actuals: compares scheduled vs actual labor outcomes</li>
                <li>Learns which employee-shift pairings produce best revenue results</li>
                <li>Adjusts performance scores based on real operational data (not just manager input)</li>
                <li>Captures seasonal patterns (e.g., certain staff perform better during brunch vs dinner)</li>
              </ul>

              <h5 class="neural-sub">Layer 7: What-If Simulator</h5>
              <ul class="body-list">
                <li>Instant impact analysis: shows projected labor cost, headcount, and RPLH changes for any schedule modification</li>
                <li>Scenario comparison: managers can fork a schedule, make changes, and compare financial impact side-by-side</li>
                <li>Constraint validation: real-time feedback on which constraints are violated by proposed changes</li>
              </ul>
            </div>
          </div>

          <h4 class="subsection-title">Staffing Constraints</h4>
          <p class="body-text">Each location defines per-position min/max headcount floors and ceilings, along with min/max shift hours. These constraints ensure safe coverage (e.g., always at least 1 host, never more than 8 servers) regardless of what the revenue model suggests.</p>
          <div class="formula-box">
            staffing_constraints(location_id, position, min_headcount, max_headcount, min_hours_per_shift, max_hours_per_shift)
          </div>

          <h4 class="subsection-title">Labor Enhancement Signals (v3.0)</h4>
          <p class="body-text">Six additional labor-side intelligence signals improve scheduling quality:</p>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Enhancement</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Description</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">1</td><td class="leo-td text-left font-medium">Productivity Curves</td><td class="leo-td text-left">Models employee output by hour-of-shift; performance typically peaks at hours 2-4 and declines after hour 6</td></tr>
              <tr><td class="leo-td text-left">2</td><td class="leo-td text-left font-medium">Task-Based Signals</td><td class="leo-td text-left">Differentiates between guest-facing tasks (serving, bartending) and operational tasks (side work, prep); assigns labor accordingly</td></tr>
              <tr><td class="leo-td text-left">3</td><td class="leo-td text-left font-medium">Patio Staffing</td><td class="leo-td text-left">Weather-adjusted staffing for locations with patio seating; adds 1-2 servers/bussers on patio-favorable days (temperature 60-85&deg;F, no rain)</td></tr>
              <tr><td class="leo-td text-left">4</td><td class="leo-td text-left font-medium">Callout Prediction</td><td class="leo-td text-left">Forecasts no-show probability per employee using historical patterns, day-of-week, and season; recommends on-call backup staffing</td></tr>
              <tr><td class="leo-td text-left">5</td><td class="leo-td text-left font-medium">RPLH Optimization</td><td class="leo-td text-left">Revenue Per Labor Hour is the primary efficiency metric; engine optimizes schedule to maximize RPLH while respecting service quality minimums</td></tr>
              <tr><td class="leo-td text-left">6</td><td class="leo-td text-left font-medium">Break Intelligence</td><td class="leo-td text-left">Auto-schedules breaks to comply with state labor laws while minimizing coverage gaps during peak service windows</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      <!-- 15. Engine Audit Framework -->
      <details id="engine-audit" class="principles-section leo-card">
        <summary class="section-header">
          <span class="section-number">15</span>
          Engine Audit Framework
        </summary>
        <div class="section-body">
          <p class="body-text">The Engine Audit runs a suite of automated tests against both the revenue forecast engine and the labor scheduling engine. Each test validates a specific assumption or calculation, producing a pass/fail result and a grade.</p>

          <h4 class="subsection-title">Revenue Engine Tests (14 Tests)</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Test</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Pass Criteria</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">R1</td><td class="leo-td text-left font-medium">Signal weights sum to 100%</td><td class="leo-td text-left">All active signal weights sum to 1.0 &plusmn; 0.01</td></tr>
              <tr><td class="leo-td text-left">R2</td><td class="leo-td text-left font-medium">Trailing average populated</td><td class="leo-td text-left">&ge; 7 days of trailing DOW data available</td></tr>
              <tr><td class="leo-td text-left">R3</td><td class="leo-td text-left font-medium">Prior year data exists</td><td class="leo-td text-left">364-day lookback finds actual revenue for same DOW</td></tr>
              <tr><td class="leo-td text-left">R4</td><td class="leo-td text-left font-medium">Budget baseline loaded</td><td class="leo-td text-left">Daily budget &gt; $0 for forecast period</td></tr>
              <tr><td class="leo-td text-left">R5</td><td class="leo-td text-left font-medium">Weather signal active</td><td class="leo-td text-left">OpenWeatherMap returned valid data within 24h</td></tr>
              <tr><td class="leo-td text-left">R6</td><td class="leo-td text-left font-medium">Reservation signal active</td><td class="leo-td text-left">Resy sync returned covers for forecast dates</td></tr>
              <tr><td class="leo-td text-left">R7</td><td class="leo-td text-left font-medium">Neural model trained</td><td class="leo-td text-left">&ge; 30 training samples, MAPE &lt; 30%</td></tr>
              <tr><td class="leo-td text-left">R8</td><td class="leo-td text-left font-medium">Ensemble agreement</td><td class="leo-td text-left">All 4 models within 15% of ensemble mean</td></tr>
              <tr><td class="leo-td text-left">R9</td><td class="leo-td text-left font-medium">Bias within threshold</td><td class="leo-td text-left">Systematic bias &lt; 3% over trailing 14 days</td></tr>
              <tr><td class="leo-td text-left">R10</td><td class="leo-td text-left font-medium">Confidence calibration</td><td class="leo-td text-left">High-confidence forecasts (80+) have lower MAPE than low-confidence ones</td></tr>
              <tr><td class="leo-td text-left">R11</td><td class="leo-td text-left font-medium">Enhancement factors in range</td><td class="leo-td text-left">All 7 revenue enhancement factors between 0.85 and 1.15</td></tr>
              <tr><td class="leo-td text-left">R12</td><td class="leo-td text-left font-medium">Cross-location sync</td><td class="leo-td text-left">Market trend data updated within 48h</td></tr>
              <tr><td class="leo-td text-left">R13</td><td class="leo-td text-left font-medium">Holiday calendar loaded</td><td class="leo-td text-left">Next 30 days of holidays/events are populated</td></tr>
              <tr><td class="leo-td text-left">R14</td><td class="leo-td text-left font-medium">Forecast vs actual (7-day)</td><td class="leo-td text-left">Trailing 7-day MAPE &lt; 12%</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Labor Engine Tests (8 Tests)</h4>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">#</th>
                <th class="leo-th text-left">Test</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Pass Criteria</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left">L1</td><td class="leo-td text-left font-medium">Threshold brackets loaded</td><td class="leo-td text-left">At least 5 revenue brackets with position allocations</td></tr>
              <tr><td class="leo-td text-left">L2</td><td class="leo-td text-left font-medium">DOW weights sum to 100%</td><td class="leo-td text-left">All 7 day weights sum to 1.0 &plusmn; 0.01 per position</td></tr>
              <tr><td class="leo-td text-left">L3</td><td class="leo-td text-left font-medium">Staffing constraints defined</td><td class="leo-td text-left">Min/max headcount set for all active positions</td></tr>
              <tr><td class="leo-td text-left">L4</td><td class="leo-td text-left font-medium">Avg hourly rates populated</td><td class="leo-td text-left">Rates computed from trailing 30-day Toast labor data</td></tr>
              <tr><td class="leo-td text-left">L5</td><td class="leo-td text-left font-medium">Position mapping complete</td><td class="leo-td text-left">All Toast jobs mapped to dashboard positions or EXCLUDE</td></tr>
              <tr><td class="leo-td text-left">L6</td><td class="leo-td text-left font-medium">Labor target accuracy</td><td class="leo-td text-left">Projected vs actual labor $ within 10% for trailing week</td></tr>
              <tr><td class="leo-td text-left">L7</td><td class="leo-td text-left font-medium">Overtime detection</td><td class="leo-td text-left">No employees scheduled &gt; 40h without explicit admin approval</td></tr>
              <tr><td class="leo-td text-left">L8</td><td class="leo-td text-left font-medium">Employee data freshness</td><td class="leo-td text-left">Employee roster synced from Toast within 7 days</td></tr>
            </tbody>
          </table>

          <h4 class="subsection-title">Threshold Validation</h4>
          <p class="body-text">The audit compares three values for each position on each day:</p>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Metric</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Source</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left font-medium">Original (Projected)</td><td class="leo-td text-left">Threshold bracket &times; DOW weight</td></tr>
              <tr><td class="leo-td text-left font-medium">Actual</td><td class="leo-td text-left">Toast labor sync (real hours &times; rates)</td></tr>
              <tr><td class="leo-td text-left font-medium">Suggested (AI)</td><td class="leo-td text-left">Neural scheduling engine recommendation</td></tr>
            </tbody>
          </table>
          <p class="body-text">Large discrepancies between these three values indicate either a calibration issue (thresholds need updating), a scheduling issue (managers deviated from targets), or a model issue (AI recommendation was off).</p>

          <h4 class="subsection-title">Self-Grading System</h4>
          <p class="body-text">Each engine receives a letter grade based on the percentage of tests passed:</p>
          <table class="signal-table">
            <thead>
              <tr>
                <th class="leo-th text-left" style="border-radius: 6px 0 0 0;">Grade</th>
                <th class="leo-th text-left">Pass Rate</th>
                <th class="leo-th text-left" style="border-radius: 0 6px 0 0;">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr><td class="leo-td text-left font-medium" style="color: #16a34a;">A</td><td class="leo-td text-left">90-100%</td><td class="leo-td text-left">All systems nominal; engine operating at full capacity</td></tr>
              <tr><td class="leo-td text-left font-medium" style="color: #2563eb;">B</td><td class="leo-td text-left">80-89%</td><td class="leo-td text-left">Minor issues; some optional signals unavailable</td></tr>
              <tr><td class="leo-td text-left font-medium" style="color: #d97706;">C</td><td class="leo-td text-left">65-79%</td><td class="leo-td text-left">Degraded accuracy; manual review recommended</td></tr>
              <tr><td class="leo-td text-left font-medium" style="color: #ea580c;">D</td><td class="leo-td text-left">50-64%</td><td class="leo-td text-left">Significant gaps; forecasts may be unreliable</td></tr>
              <tr><td class="leo-td text-left font-medium" style="color: #dc2626;">F</td><td class="leo-td text-left">&lt; 50%</td><td class="leo-td text-left">Critical failure; engine outputs should not be trusted</td></tr>
            </tbody>
          </table>
          <p class="body-text">The audit dashboard is accessible to admin users at <strong>Admin &rarr; Engine Audit</strong> and runs on-demand. Results are stored in system_learnings for trend tracking.</p>
        </div>
      </details>

    </div>

    <!-- System Learnings -->
    <div class="mt-10" id="system-learnings">
      <div class="flex items-center justify-between flex-wrap gap-4 mb-4">
        <div>
          <h2 class="text-xl font-bold" style="color: #1e3a5f;">System Learnings</h2>
          <p class="text-sm text-gray-500 mt-1">Auto-discovered insights from the self-learning engine. Refreshes every 60s.</p>
        </div>
        <div class="flex items-center gap-2">
          {#each ['all', 'forecast', 'labor', 'weather', 'scheduling', 'sales_mix'] as cat}
            <button
              onclick={() => learningsFilter = cat}
              class="text-xs px-3 py-1.5 rounded-full transition-colors"
              style="{learningsFilter === cat
                ? 'background: #1e3a5f; color: white;'
                : 'background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0;'}">
              {cat === 'all' ? 'All' : cat === 'sales_mix' ? 'Sales Mix' : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          {/each}
        </div>
      </div>

      {#if learningsLoading}
        <div class="leo-card p-8 text-center">
          <p class="text-sm text-gray-400">Loading learnings...</p>
        </div>
      {:else if learnings.length === 0}
        <div class="leo-card p-8 text-center">
          <p class="text-sm text-gray-400">No system learnings recorded yet. Learnings will appear as the forecasting and labor engines adapt over time.</p>
        </div>
      {:else}
        {#each Object.entries(groupedLearnings) as [category, items]}
          <div class="mb-6">
            <h3 class="text-sm font-semibold uppercase tracking-wider mb-3"
              style="color: {categoryColors[category] || '#64748b'};">
              {category === 'sales_mix' ? 'Sales Mix' : category.charAt(0).toUpperCase() + category.slice(1)}
              <span class="text-xs font-normal text-gray-400 ml-2">({items.length})</span>
            </h3>
            <div class="space-y-2">
              {#each items as item}
                <div class="leo-card p-4">
                  <div class="flex items-start gap-3">
                    <div class="flex-1 min-w-0">
                      <p class="text-sm leading-relaxed" style="color: #374151;">{item.learning}</p>
                      <div class="flex items-center gap-3 mt-2 flex-wrap">
                        <span class="text-[11px] font-medium px-2 py-0.5 rounded"
                          style="background: {categoryColors[item.category] || '#64748b'}15; color: {categoryColors[item.category] || '#64748b'};">
                          {sourceLabels[item.source] || item.source}
                        </span>
                        {#if item.locations?.name}
                          <span class="text-[11px] text-gray-400">{item.locations.name}</span>
                        {/if}
                        <span class="text-[11px] text-gray-400">{formatDate(item.created_at)}</span>
                        <div class="flex items-center gap-1.5">
                          <div class="w-16 h-1.5 rounded-full" style="background: #e5e7eb;">
                            <div class="h-full rounded-full" style="width: {item.confidence * 100}%; background: {item.confidence >= 0.8 ? '#16a34a' : item.confidence >= 0.5 ? '#d97706' : '#dc2626'};"></div>
                          </div>
                          <span class="text-[10px] text-gray-400">{(item.confidence * 100).toFixed(0)}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Footer -->
    <div class="mt-8 pt-6 border-t border-gray-200 text-center">
      <p class="text-xs text-gray-400">HELIXO Performance Dashboard -- Guiding Principles v3.0</p>
      <p class="text-xs text-gray-400 mt-1">Last updated: March 28, 2026</p>
    </div>
  </div>
{/if}

<style>
  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    cursor: pointer;
    font-size: 15px;
    font-weight: 600;
    color: #1e3a5f;
    user-select: none;
    list-style: none;
  }
  .section-header::-webkit-details-marker {
    display: none;
  }
  .section-header::after {
    content: '';
    margin-left: auto;
    width: 8px;
    height: 8px;
    border-right: 2px solid #9ca3af;
    border-bottom: 2px solid #9ca3af;
    transform: rotate(45deg);
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  details[open] > .section-header::after {
    transform: rotate(-135deg);
  }
  .section-number {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: #1e3a5f;
    color: white;
    font-size: 13px;
    font-weight: 600;
    flex-shrink: 0;
  }
  .section-body {
    padding: 0 20px 20px 60px;
  }
  .subsection-title {
    font-size: 13px;
    font-weight: 600;
    color: #374151;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    margin-top: 16px;
    margin-bottom: 6px;
  }
  .subsection-title:first-child {
    margin-top: 0;
  }
  .body-text {
    font-size: 14px;
    line-height: 1.65;
    color: #4b5563;
    margin-top: 4px;
  }
  .body-list {
    margin-top: 4px;
    padding-left: 20px;
    list-style: disc;
  }
  .body-list li {
    font-size: 14px;
    line-height: 1.65;
    color: #4b5563;
    margin-top: 2px;
  }
  .signal-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 8px;
    margin-bottom: 4px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid #e5e7eb;
  }
  .tag-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .tag {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 4px;
    background: #f1f5f9;
    color: #1e3a5f;
    font-size: 12px;
    font-weight: 500;
    border: 1px solid #e2e8f0;
  }
  .code-inline {
    background: #f1f5f9;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'SFMono-Regular', Menlo, monospace;
    color: #1e3a5f;
  }
  .formula-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 3px solid #1e3a5f;
    padding: 10px 16px;
    margin: 8px 0;
    font-size: 14px;
    font-weight: 500;
    color: #1e3a5f;
    border-radius: 0 6px 6px 0;
    font-family: 'SFMono-Regular', Menlo, monospace;
  }
  .timeline {
    display: flex;
    flex-direction: column;
    gap: 0;
    margin-top: 8px;
    padding-left: 4px;
  }
  .timeline-step {
    display: flex;
    gap: 14px;
    padding: 10px 0;
    border-left: 2px solid #e5e7eb;
    padding-left: 16px;
    position: relative;
  }
  .timeline-step:last-child {
    border-left-color: transparent;
  }
  .timeline-dot {
    position: absolute;
    left: -6px;
    top: 14px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #1e3a5f;
    flex-shrink: 0;
  }

  /* Neural Callout */
  .neural-callout {
    margin: 20px 0 16px 0;
    border: 1px solid #c7d2fe;
    border-radius: 8px;
    background: linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%);
    overflow: hidden;
    box-shadow: 0 1px 4px rgba(30, 58, 95, 0.06);
  }
  .neural-callout-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: linear-gradient(90deg, #1e3a5f 0%, #2d5a8e 100%);
  }
  .neural-callout-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.18);
    color: #c7d2fe;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    border: 1px solid rgba(255, 255, 255, 0.15);
  }
  .neural-callout-title {
    font-size: 14px;
    font-weight: 600;
    color: #ffffff;
    margin: 0;
  }
  .neural-callout-body {
    padding: 16px;
  }
  .neural-sub {
    font-size: 12px;
    font-weight: 700;
    color: #1e3a5f;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 16px;
    margin-bottom: 6px;
  }
  .neural-sub:first-child {
    margin-top: 0;
  }
  .neural-features-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    margin-top: 6px;
  }
  .neural-feature-group {
    display: flex;
    align-items: baseline;
    gap: 8px;
    font-size: 13px;
    color: #4b5563;
    line-height: 1.6;
  }
  .neural-feature-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    padding: 0 4px;
    height: 20px;
    border-radius: 4px;
    background: #1e3a5f;
    color: white;
    font-size: 11px;
    font-weight: 600;
    flex-shrink: 0;
  }

  @media (max-width: 767px) {
    .section-body {
      padding: 0 16px 16px 16px;
    }
    .section-header {
      padding: 14px 16px;
      font-size: 14px;
    }
    .neural-features-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
