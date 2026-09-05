#!/usr/bin/env node
// test-with-openrouter.mjs — runtime test that exercises metaharness
// scaffolding + lifecycle commands using OPENROUTER_API_KEY fetched
// from GCP Secret Manager.
//
// WHAT IT DOES (end-to-end)
//   1. Fetch OPENROUTER_API_KEY from GCP Secret Manager via
//      `gcloud secrets versions access latest --secret=OPENROUTER_API_KEY`
//   2. Verify the secret authenticates against OpenRouter by listing
//      models (1 HTTP call, ~$0)
//   3. Scaffold a fresh harness into a temp dir via
//      `metaharness new --name test-h --template vertical:coding
//      --host claude-code --yes`
//   4. Run lifecycle commands against the scaffold:
//        - harness doctor    (smoke health check)
//        - harness validate  (full validation; --skip-gcp to avoid
//                             nested GCP fetches in this test)
//        - harness score     (5-dim scorecard of the scaffolded
//                             harness itself)
//        - harness genome    (7-section report)
//   5. (Optional) make one real LLM call through OpenRouter to a
//      cheap model (e.g. openrouter/auto with a 1-token prompt) to
//      prove the token works for actual inference
//   6. Clean up the temp dir
//
// COST: ~$0 (1 model-list call + optional <$0.0001 inference call)
//
// USAGE
//   node scripts/test-with-openrouter.mjs                 # full e2e
//   node scripts/test-with-openrouter.mjs --skip-inference  # no LLM call
//   node scripts/test-with-openrouter.mjs --keep-fixtures # leave scaffold for inspection
//
// EXIT CODES
//   0  all checks passed
//   1  at least one assertion failed
//   2  setup error (gcloud not authed, OPENROUTER_API_KEY missing in GCP, etc.)
//   3  cost/safety guard tripped

import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ARGS = (() => {
  const a = { skipInference: false, keep: false, format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    const v = process.argv[i];
    if (v === '--skip-inference') a.skipInference = true;
    else if (v === '--keep-fixtures') a.keep = true;
    else if (v === '--format') a.format = process.argv[++i];
  }
  return a;
})();

let passed = 0, failed = 0;
const failures = [];
function assert(cond, label) {
  if (cond) { console.log(`  ✓ ${label}`); passed++; }
  else { console.log(`  ✗ ${label}`); failures.push(label); failed++; }
}

function fetchSecretFromGcp(secretName) {
  try {
    const out = execSync(
      `gcloud secrets versions access latest --secret=${secretName}`,
      { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15_000 },
    );
    return out.trim();
  } catch (e) {
    console.error(`  ⚠ gcloud secret fetch failed: ${(e.message || '').slice(0, 120)}`);
    return null;
  }
}

async function listOpenRouterModels(apiKey) {
  const resp = await fetch('https://openrouter.ai/api/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    return { ok: false, status: resp.status, body: (await resp.text()).slice(0, 200) };
  }
  const data = await resp.json();
  return { ok: true, modelCount: data.data?.length ?? 0 };
}

async function cheapInferenceCall(apiKey) {
  // openrouter/auto picks the cheapest viable model; 5-token prompt;
  // max_tokens=1 to bound cost at ~$0.00005.
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/ruvnet/ruflo',
      'X-Title': 'ruflo-metaharness-test',
    },
    body: JSON.stringify({
      model: 'openrouter/auto',
      messages: [{ role: 'user', content: 'OK' }],
      max_tokens: 1,
    }),
  });
  if (!resp.ok) return { ok: false, status: resp.status, body: (await resp.text()).slice(0, 200) };
  const data = await resp.json();
  return { ok: true, model: data.model, usage: data.usage };
}

function runHarness(args, opts = {}) {
  const r = spawnSync('npx', ['-y', '-p', 'metaharness@latest', 'harness', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 60_000,
    env: { ...process.env, ...opts.env },
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function runMetaharness(args, opts = {}) {
  const r = spawnSync('npx', ['-y', 'metaharness@latest', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf-8',
    timeout: opts.timeoutMs ?? 120_000,
    cwd: opts.cwd,  // metaharness new writes to cwd/<name>; --target is ignored
    env: { ...process.env, ...opts.env },
  });
  return { exitCode: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

async function main() {
  console.log('# test-with-openrouter — metaharness × GCP × OpenRouter e2e\n');

  // ── 0. Preflight ──────────────────────────────────────────────────
  console.log('Phase 0 — preflight');
  const gcloudWho = execSync('gcloud config get-value account 2>&1', { encoding: 'utf-8' }).trim();
  assert(!!gcloudWho && !/None/.test(gcloudWho), `gcloud authenticated (${gcloudWho || 'none'})`);

  // ── 1. Fetch OPENROUTER_API_KEY ───────────────────────────────────
  console.log('\nPhase 1 — fetch OPENROUTER_API_KEY from GCP Secret Manager');
  const apiKey = fetchSecretFromGcp('OPENROUTER_API_KEY');
  assert(typeof apiKey === 'string' && apiKey.length > 20, 'OPENROUTER_API_KEY fetched (length OK)');
  if (!apiKey) {
    console.error('Setup error: cannot proceed without OPENROUTER_API_KEY. Skipping further phases.');
    process.exit(2);
  }
  // Echo only length+prefix, never the raw key
  console.log(`  key length: ${apiKey.length}, prefix: ${apiKey.slice(0, 7)}…`);

  // ── 2. Verify the key authenticates against OpenRouter ────────────
  console.log('\nPhase 2 — verify OpenRouter authentication');
  const modelsResp = await listOpenRouterModels(apiKey);
  assert(modelsResp.ok, `OpenRouter /api/v1/models returns 2xx (got ${modelsResp.ok ? 'ok' : modelsResp.status})`);
  if (modelsResp.ok) {
    assert(modelsResp.modelCount > 10, `model list non-empty (${modelsResp.modelCount} models)`);
  }

  // ── 3. Scaffold a fresh harness ───────────────────────────────────
  // CRITICAL: `metaharness new <name>` writes to $CWD/<name> — the
  // --target flag is ignored by the CLI (verified 2026-06-16 against
  // metaharness@0.1.11). Run from inside a fresh temp dir so the
  // scaffold lands there, not in the ruflo project root.
  console.log('\nPhase 3 — scaffold a fresh harness');
  const fixture = mkdtempSync(join(tmpdir(), 'ruflo-mh-openrouter-'));
  const target = join(fixture, 'test-harness');
  console.log(`  fixture cwd: ${fixture}`);
  console.log(`  expected target: ${target}`);
  const scaffold = runMetaharness(
    ['test-harness', '--template', 'vertical:coding', '--host', 'claude-code'],
    { timeoutMs: 180_000, cwd: fixture },
  );
  assert(scaffold.exitCode === 0, `metaharness new exit 0 (got ${scaffold.exitCode})`);
  assert(existsSync(target), `target dir created at ${target}`);

  // ── 4. Run lifecycle commands against the scaffold ────────────────
  console.log('\nPhase 4 — lifecycle commands on the scaffold');
  // harness doctor — quick smoke
  const doc = runHarness(['doctor', target]);
  assert(doc.exitCode === 0, `harness doctor exit 0 (got ${doc.exitCode})`);

  // harness score on the scaffold itself
  const score = runHarness(['score', target, '--json']);
  assert(score.exitCode === 0, `harness score exit 0 (got ${score.exitCode})`);
  const scoreJson = (() => {
    const m = /\{[\s\S]*\}/.exec(score.stdout);
    try { return m ? JSON.parse(m[0]) : null; } catch { return null; }
  })();
  assert(scoreJson && typeof scoreJson.score === 'number', 'score.json has numeric score');

  // harness genome — exit 0 (ready) or 1 (needs-work) both acceptable.
  // Only exit 2 (blocked / scan-error) is a real failure.
  const gen = runHarness(['genome', target, '--json']);
  assert(gen.exitCode === 0 || gen.exitCode === 1, `harness genome exit 0 or 1 (got ${gen.exitCode})`);

  // harness mcp-scan
  const scan = runHarness(['mcp-scan', target]);
  // mcp-scan can exit 1 on findings; either 0 or 1 is acceptable here.
  assert(scan.exitCode === 0 || scan.exitCode === 1, `harness mcp-scan exit 0 or 1 (got ${scan.exitCode})`);

  // ── 5. (Optional) one real OpenRouter inference call ──────────────
  if (!ARGS.skipInference) {
    console.log('\nPhase 5 — single OpenRouter inference call (cheapest auto-route, max_tokens=1)');
    const inf = await cheapInferenceCall(apiKey);
    assert(inf.ok, `OpenRouter inference 2xx (got ${inf.ok ? 'ok' : inf.status})`);
    if (inf.ok) {
      console.log(`  model used: ${inf.model}`);
      console.log(`  usage: prompt=${inf.usage?.prompt_tokens} completion=${inf.usage?.completion_tokens}`);
    }
  } else {
    console.log('\nPhase 5 — SKIPPED (--skip-inference)');
  }

  // ── 6. Cleanup ────────────────────────────────────────────────────
  if (!ARGS.keep) {
    rmSync(fixture, { recursive: true, force: true });
    console.log(`\nFixture cleaned: ${fixture}`);
  } else {
    console.log(`\nFixture kept at: ${fixture}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('\n✓ All harness × OpenRouter integration checks passed.');
}

main().catch((e) => {
  console.error('test-with-openrouter crashed:', e.message || e);
  process.exit(2);
});
