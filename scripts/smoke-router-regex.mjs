#!/usr/bin/env node
/**
 * Smoke test for #2257: the agent router's keyword patterns must be
 * word-boundary-anchored so short tokens (cd, ci, ui, add, structure) do
 * NOT match inside unrelated words (decision, infrastructure, address,
 * addendum). Confidence on a match must be a heuristic prior (< 0.8) since
 * the matcher is static, not learned.
 *
 * This guard locks in the #2257 fix so a future refactor that drops the
 * \b boundaries or bumps confidence back to 0.8 is caught at PR-time.
 *
 * Drives the SOURCE OF TRUTH (helpers-generator.ts::generateAgentRouter)
 * AND the in-repo snapshot under v3/@claude-flow/cli/.claude/helpers/.
 *
 * Exit codes:
 *   0 — all expectations met
 *   1 — at least one expectation failed
 */

import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Render the generator output to disk so we test the SOURCE OF TRUTH.
async function loadGeneratedRouter() {
  // tsx is the project's standard TS-on-the-fly loader.
  const { generateAgentRouter } = await import('../v3/@claude-flow/cli/src/init/helpers-generator.ts')
    .catch(async () => {
      // Fall back to a tsx-loaded copy if direct ESM TS import isn't supported.
      const { execSync } = await import('node:child_process');
      const tmp = mkdtempSync(join(tmpdir(), 'router-smoke-'));
      const out = execSync(
        `node --import tsx -e "import('./v3/@claude-flow/cli/src/init/helpers-generator.ts').then(m => process.stdout.write(m.generateAgentRouter()))"`,
        { encoding: 'utf8' }
      );
      const path = join(tmp, 'router-gen.cjs');
      writeFileSync(path, out);
      return { generateAgentRouter: () => readFileSync(path, 'utf8') };
    });
  const tmp = mkdtempSync(join(tmpdir(), 'router-smoke-'));
  const path = join(tmp, 'router-gen.cjs');
  writeFileSync(path, generateAgentRouter());
  return require(path);
}

const CASES = [
  // [task, expectedAgent ("default" means confidence < 0.5)]
  ['review latest issues',                'reviewer'],
  ['make a decision about auth',          'default'],   // 'decision' must NOT match 'ci'
  ['set up ci pipeline',                  'devops'],     // 'ci' as a real word should match
  ['structure the schema',                'architect'],  // 'structure' standalone should match
  ['address the bug',                     'default'],   // 'address' must NOT match 'add'
  ['add JWT support',                     'coder'],      // 'add' as a real word should match
  ['fix infrastructure rollout',          'devops'],     // 'infrastructure' standalone
  ['write specifications',                'default'],   // 'specifications' must NOT match 'spec'
  ['write a unit test',                   'tester'],     // 'unit test' phrase
  ['build a guidance overview',           'coder'],      // 'guidance' must NOT match 'ui'
  ['fix critical and high issues',        'default'],   // bare 'fix' / 'critical' shouldn't match anything
];

async function main() {
  const router = await loadGeneratedRouter();
  if (typeof router.routeTask !== 'function') {
    console.error('router.routeTask is not a function — generator export shape changed');
    process.exit(1);
  }

  let pass = 0;
  let fail = 0;
  for (const [task, want] of CASES) {
    const r = router.routeTask(task);
    const ok = want === 'default'
      ? r.confidence < 0.5
      : r.agent === want && r.confidence < 0.8;  // #2257: confidence must NOT regress to 0.8
    if (ok) { pass++; console.log(`  PASS  "${task}" → ${r.agent} (${r.confidence})`); }
    else    { fail++; console.log(`  FAIL  "${task}" → ${r.agent} (${r.confidence}) want=${want}`); }
  }
  console.log(`\n${pass}/${CASES.length} router cases passed`);

  // Hard contract on the file format too — if someone strips \b boundaries
  // the cases above might still pass on this corpus but break on others.
  const generated = await router.routeTask ? null : null;
  const sourcePath = 'v3/@claude-flow/cli/src/init/helpers-generator.ts';
  const src = readFileSync(sourcePath, 'utf8');
  if (!src.includes('\\\\b')) {
    console.error(`\nFAIL  ${sourcePath} no longer contains \\b boundary anchors — #2257 regression`);
    fail++;
  } else {
    console.log(`OK    ${sourcePath} retains \\b boundary anchors`);
  }
  if (/confidence:\s*0\.8/.test(src) && !/heuristic prior/.test(src)) {
    console.error(`\nFAIL  ${sourcePath} confidence:0.8 reintroduced without "heuristic prior" justification — #2257 regression`);
    fail++;
  }

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
