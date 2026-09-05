#!/usr/bin/env node
/**
 * Smoke test for ADR-126 Phase 5 (#2068) — SendMessage risk-gate pipeline.
 *
 * The four neural-trader agents (`market-analyst`, `trading-strategist`,
 * `risk-analyst`, `backtest-engineer`) coordinate as a typed SendMessage
 * pipeline with `risk-analyst` as a structural BLOCKING GATE — the live
 * broker call cannot fire without an explicit `RiskDecision` with
 * `decision: 'approved'` for the proposal's signalId.
 *
 * Pipeline:
 *   market-analyst       — (RegimeVerdict)    ─→ trading-strategist
 *   trading-strategist   — (SignalProposal[]) ─→ risk-analyst   ◄── BLOCKING
 *   risk-analyst         — (RiskDecision)     ─→ trading-strategist
 *                                              └─→ execute-or-halt
 *   backtest-engineer    — orthogonal (signed promotion candidates only)
 *
 * Locks in four layers:
 *
 *   [1/4] AGENT FRONTMATTER — each of the four agent .md files declares
 *         `name:` in YAML frontmatter (so they're addressable via SendMessage).
 *
 *   [2/4] COMMS PROTOCOL SECTION — each of the four agent .md files has a
 *         "Comms protocol" section that names the upstream + downstream
 *         agents correctly.
 *
 *   [3/4] STRUCTURAL RISK-GATE — `trading-strategist.md` contains explicit
 *         refusal logic when `--broker` is invoked without a `risk-analyst`
 *         approval. The guard pattern must mention `risk-analyst`, the
 *         broker call, the refusal, AND link to the RiskDecision schema.
 *
 *   [4/4] MESSAGE SCHEMAS + BEHAVIORAL MOCK — `src/pipeline-messages.ts`
 *         exports the three message types with the expected field shapes.
 *         A small mock pipeline (constructed in this smoke) drives the
 *         flow and asserts that:
 *           (a) market-analyst → strategist → risk-analyst (approved) →
 *               broker-execute   SUCCEEDS
 *           (b) market-analyst → strategist → broker-execute (NO risk-analyst
 *               event)            IS REFUSED with structural guard
 *
 * If a future PR drops the guard, removes a `name` field, or breaks the
 * pipeline-messages schema, this smoke catches it before merge.
 *
 * Usage:  node scripts/smoke-neural-trader-pipeline.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PLUGIN_DIR = join(REPO_ROOT, 'plugins', 'ruflo-neural-trader');
const AGENTS_DIR = join(PLUGIN_DIR, 'agents');
const MESSAGES_TS = join(PLUGIN_DIR, 'src', 'pipeline-messages.ts');

const AGENTS = [
  {
    name: 'market-analyst',
    file: 'market-analyst.md',
    upstream: null, // entry point
    downstream: 'trading-strategist',
  },
  {
    name: 'trading-strategist',
    file: 'trading-strategist.md',
    upstream: 'market-analyst',
    downstream: 'risk-analyst',
  },
  {
    name: 'risk-analyst',
    file: 'risk-analyst.md',
    upstream: 'trading-strategist',
    downstream: 'trading-strategist', // returns RiskDecision
  },
  {
    name: 'backtest-engineer',
    file: 'backtest-engineer.md',
    upstream: null, // orthogonal lane
    downstream: null,
  },
];

const failures = [];
function check(label, ok, detail = '') {
  if (ok) console.log(`  ✓ ${label}`);
  else {
    console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    failures.push(label);
  }
}

// ---------------------------------------------------------------------------
// Part 1 — Agent frontmatter (each agent must be addressable by name)
// ---------------------------------------------------------------------------

console.log('[1/4] Agent frontmatter — `name:` declared for SendMessage addressing');

const agentBodies = new Map();
for (const a of AGENTS) {
  const path = join(AGENTS_DIR, a.file);
  if (!existsSync(path)) {
    check(`${a.file} exists`, false);
    continue;
  }
  const src = readFileSync(path, 'utf8');
  agentBodies.set(a.name, src);
  // Frontmatter: between leading `---` and the next `---`
  const fmMatch = /^---\n([\s\S]+?)\n---/m.exec(src);
  if (!fmMatch) {
    check(`${a.file} has YAML frontmatter`, false);
    continue;
  }
  const nameDecl = new RegExp(`^name:\\s*${a.name}\\b`, 'm');
  check(
    `${a.file} declares \`name: ${a.name}\``,
    nameDecl.test(fmMatch[1]),
    `frontmatter must declare \`name: ${a.name}\` so SendMessage can address the agent`,
  );
}

// ---------------------------------------------------------------------------
// Part 2 — Comms protocol section + upstream/downstream references
// ---------------------------------------------------------------------------

console.log('\n[2/4] Comms protocol — section + upstream/downstream wiring');

for (const a of AGENTS) {
  const src = agentBodies.get(a.name);
  if (!src) continue;
  check(
    `${a.file} declares a "Comms protocol" section`,
    /Comms protocol/i.test(src),
    'each agent must document its SendMessage wiring under "Comms protocol"',
  );
  if (a.upstream) {
    check(
      `${a.file} references upstream agent \`${a.upstream}\``,
      new RegExp(`\\b${a.upstream}\\b`).test(src),
      `${a.name} must wait for SendMessage from ${a.upstream}`,
    );
  }
  if (a.downstream) {
    check(
      `${a.file} references downstream agent \`${a.downstream}\``,
      new RegExp(`\\b${a.downstream}\\b`).test(src),
      `${a.name} must send to ${a.downstream}`,
    );
  }
}

// backtest-engineer is orthogonal — assert it documents that
const beSrc = agentBodies.get('backtest-engineer');
if (beSrc) {
  check(
    'backtest-engineer.md documents orthogonal-lane status (NOT in live pipeline)',
    /orthogonal/i.test(beSrc) && /not.*participate|does NOT participate|NOT a hot-path/i.test(beSrc),
    'backtest-engineer must be marked as orthogonal so it does not pollute the live pipeline',
  );
}

// ---------------------------------------------------------------------------
// Part 3 — Structural risk-gate enforcement in trading-strategist.md
// ---------------------------------------------------------------------------

console.log('\n[3/4] Structural risk-gate — trading-strategist refuses --broker without approval');

const strategistSrc = agentBodies.get('trading-strategist');
if (strategistSrc) {
  // Look for the guard pattern: must mention --broker, must mention
  // risk-analyst approval, must mention refusal.
  const hasBroker = /--broker/.test(strategistSrc);
  const hasRiskAnalystApproval =
    /risk-analyst.*approval|approval.*risk-analyst|RiskDecision.*approved/i.test(strategistSrc);
  const hasRefusal = /REFUSE|[Rr]efus(e|ing)\s+to\s+(invoke|call|fire|execute)/.test(strategistSrc);
  const hasErrorBranch = /\[ERROR\].*trading-strategist|halt and emit|refusing --broker/i.test(strategistSrc);

  check(
    'trading-strategist mentions --broker live execution',
    hasBroker,
  );
  check(
    'trading-strategist references risk-analyst RiskDecision approval',
    hasRiskAnalystApproval,
    'the guard must explicitly require a RiskDecision approval event',
  );
  check(
    'trading-strategist declares structural REFUSAL of --broker without approval',
    hasRefusal,
    'the gate is structural — refusal logic must be explicit, not implied',
  );
  check(
    'trading-strategist emits an [ERROR] line on guard violation',
    hasErrorBranch,
    'failure mode must be observable in logs, not silent',
  );
  // The non-negotiable hint should be present so a future refactor that
  // softens the guard is at least noted in-file.
  check(
    'trading-strategist marks the risk-gate as NON-NEGOTIABLE or structural',
    /NON-NEGOTIABLE|structural risk-gate/i.test(strategistSrc),
    'language strength matters — anyone editing this file must see the gate is mandatory',
  );
}

// ---------------------------------------------------------------------------
// Part 4 — Message schemas + behavioral mock
// ---------------------------------------------------------------------------

console.log('\n[4/4] Message schemas + behavioral mock pipeline');

if (!existsSync(MESSAGES_TS)) {
  failures.push('pipeline-messages.ts not found');
} else {
  const src = readFileSync(MESSAGES_TS, 'utf8');
  check(
    'pipeline-messages.ts exports `RegimeVerdict` with `type: "regime-verdict/v1"`',
    /export\s+interface\s+RegimeVerdict/.test(src) &&
      /type:\s*'regime-verdict\/v1'/.test(src),
  );
  check(
    'pipeline-messages.ts exports `SignalProposal` with `signalId`',
    /export\s+interface\s+SignalProposal/.test(src) &&
      /signalId:\s*string/.test(src) &&
      /type:\s*'signal-proposal\/v1'/.test(src),
  );
  check(
    'pipeline-messages.ts exports `RiskDecision` with `decision: \'approved\' | \'rejected\'`',
    /export\s+interface\s+RiskDecision/.test(src) &&
      /decision:\s*'approved'\s*\|\s*'rejected'/.test(src) &&
      /signalId:\s*string/.test(src) &&
      /type:\s*'risk-decision\/v1'/.test(src),
    'RiskDecision must carry signalId for correlation + the approved/rejected enum',
  );
  check(
    'pipeline-messages.ts declares `PipelineMessage` union of the three types',
    /export\s+type\s+PipelineMessage\s*=\s*RegimeVerdict\s*\|\s*SignalProposal\s*\|\s*RiskDecision/.test(src),
  );
}

// Behavioral mock — drive a mini pipeline through a structural-gate function
// that mirrors the trading-strategist.md guard. The function MUST refuse to
// execute the broker call when no approval RiskDecision is present.

const mockEvents = [];
function record(event) {
  mockEvents.push(event);
}

function mockExecuteBroker({ events, signalId }) {
  // Mirror the trading-strategist.md guard exactly: REFUSE unless a
  // RiskDecision with decision==='approved' for this signalId exists.
  const approval = events.find(
    (e) =>
      e.type === 'risk-decision/v1' &&
      e.signalId === signalId &&
      e.decision === 'approved' &&
      e.from === 'risk-analyst',
  );
  if (!approval) {
    throw new Error(
      `[ERROR] trading-strategist: refusing --broker call — no risk-analyst approval RiskDecision event found for signalId=${signalId}. ADR-126 Phase 5 risk-gate is structural; route the SignalProposal through risk-analyst first.`,
    );
  }
  // Use adjustedSizePct if present
  const size = approval.adjustedSizePct ?? 0;
  record({ type: 'broker-executed', signalId, size });
  return { ok: true, signalId, size };
}

// Scenario (a): full happy path
record({
  type: 'regime-verdict/v1',
  from: 'market-analyst',
  timestamp: '2026-05-19T12:00:00.000Z',
  regime: 'bull-trending',
  symbols: ['SPY'],
  confidence: 0.82,
});
record({
  type: 'signal-proposal/v1',
  from: 'trading-strategist',
  signalId: 'sig-001',
  timestamp: '2026-05-19T12:00:05.000Z',
  symbol: 'SPY',
  side: 'long',
  strategyId: 'momentum-v2',
  sizePct: 0.02,
  confidence: 0.78,
  regime: 'bull-trending',
});
record({
  type: 'risk-decision/v1',
  from: 'risk-analyst',
  signalId: 'sig-001',
  timestamp: '2026-05-19T12:00:08.000Z',
  decision: 'approved',
  adjustedSizePct: 0.015,
  reasons: ['VaR within limits', 'portfolio correlation 0.62 < 0.85'],
});

let happyOk = false;
try {
  const r = mockExecuteBroker({ events: mockEvents, signalId: 'sig-001' });
  happyOk = r.ok === true && r.size === 0.015;
} catch (err) {
  happyOk = false;
}
check(
  'happy path: market-analyst → strategist → risk-analyst (approved) → broker SUCCEEDS',
  happyOk,
  'the full pipeline with an approval event must let the broker call through',
);

// Scenario (b): missing risk-analyst approval — must be refused
const noApprovalEvents = [
  {
    type: 'regime-verdict/v1',
    from: 'market-analyst',
    timestamp: '2026-05-19T12:01:00.000Z',
    regime: 'bull-trending',
    symbols: ['SPY'],
    confidence: 0.82,
  },
  {
    type: 'signal-proposal/v1',
    from: 'trading-strategist',
    signalId: 'sig-002',
    timestamp: '2026-05-19T12:01:05.000Z',
    symbol: 'SPY',
    side: 'long',
    strategyId: 'momentum-v2',
    sizePct: 0.02,
    confidence: 0.78,
  },
  // NB: no risk-decision/v1 event for sig-002
];

let refusedOk = false;
let refusalMessage = '';
try {
  mockExecuteBroker({ events: noApprovalEvents, signalId: 'sig-002' });
  refusedOk = false; // shouldn't reach here
} catch (err) {
  refusedOk = /refusing --broker.*no risk-analyst approval/i.test(err.message);
  refusalMessage = err.message;
}
check(
  'refusal path: strategist → broker WITHOUT risk-analyst event IS REFUSED structurally',
  refusedOk,
  `expected structural refusal; got: ${refusalMessage}`,
);

// Scenario (c): rejected RiskDecision must NOT allow execution
const rejectedEvents = [
  ...noApprovalEvents,
  {
    type: 'risk-decision/v1',
    from: 'risk-analyst',
    signalId: 'sig-002',
    timestamp: '2026-05-19T12:01:08.000Z',
    decision: 'rejected',
    reasons: ['concentration > 10%'],
  },
];

let rejectedRefused = false;
try {
  mockExecuteBroker({ events: rejectedEvents, signalId: 'sig-002' });
  rejectedRefused = false;
} catch (err) {
  rejectedRefused = /refusing --broker/i.test(err.message);
}
check(
  'rejection path: RiskDecision.decision=="rejected" does NOT count as approval',
  rejectedRefused,
  'only decision==="approved" should let the broker call through',
);

// Scenario (d): signalId mismatch — approval for a different signal must
// NOT approve the current one
const mismatchedEvents = [
  {
    type: 'risk-decision/v1',
    from: 'risk-analyst',
    signalId: 'sig-OTHER',
    timestamp: '2026-05-19T12:02:00.000Z',
    decision: 'approved',
    reasons: ['fine'],
  },
];
let mismatchRefused = false;
try {
  mockExecuteBroker({ events: mismatchedEvents, signalId: 'sig-002' });
  mismatchRefused = false;
} catch (err) {
  mismatchRefused = /refusing --broker/i.test(err.message);
}
check(
  'signalId correlation: approval for sig-OTHER does NOT approve sig-002',
  mismatchRefused,
  'the gate correlates by signalId — replaying an old approval for a new signal must be refused',
);

// ---------------------------------------------------------------------------
console.log('');
if (failures.length > 0) {
  console.log(`FAIL: ${failures.length} issue(s) — see above`);
  process.exit(1);
} else {
  console.log('OK: ADR-126 Phase 5 SendMessage risk-gate pipeline — agent wiring + structural gate verified');
  process.exit(0);
}
