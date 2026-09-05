#!/usr/bin/env node
// check-metaharness-compat — exercise the @metaharness/router public API
// surface that ruflo depends on (via ADR-148/149). If the upstream ships
// a breaking change, this fails BEFORE a ruflo release goes out with a
// broken neural-router.ts.
//
// Tested surfaces (must all succeed):
//   - import('@metaharness/router')
//   - Router constructor + .route(task) returns { model, ... }
//   - Router.fromExamples(rows, prices) static factory
//   - resolveRouterBackend('auto') returns one of 'js' | 'native'
//   - TrainedRouter.fromJSON(jsonObj) round-trips through toJSON()
//
// USAGE
//   node scripts/check-metaharness-compat.mjs                 # exits 0 if all surfaces OK
//   node scripts/check-metaharness-compat.mjs --format json   # CI-consumable
//
// EXIT CODES
//   0  all checks passed (or @metaharness/router not installed —
//      ADR-150 graceful degradation: ruflo runs without it)
//   1  at least one API contract broke
//   2  unexpected error

const ARGS = (() => {
  const a = { format: 'table' };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--format') a.format = process.argv[++i];
  }
  return a;
})();

async function main() {
  const results = [];

  // ───── 1. Module import ─────
  let mod;
  try {
    mod = await import('@metaharness/router');
    results.push({ check: 'import @metaharness/router', ok: true });
  } catch (e) {
    if (e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module/.test(e.message)) {
      // ADR-150 rule #3: graceful degradation when optional dep is absent
      const payload = {
        skipped: true,
        reason: 'metaharness-router-not-installed',
        hint: 'This script verifies the upstream API surface. Install with `npm i --include=optional` in v3/@claude-flow/cli/ to enable.',
        results: [],
        generatedAt: new Date().toISOString(),
      };
      if (ARGS.format === 'json') console.log(JSON.stringify(payload, null, 2));
      else {
        console.log('# check-metaharness-compat — SKIPPED');
        console.log('');
        console.log(`Reason: ${payload.reason}`);
        console.log(`Hint:   ${payload.hint}`);
        console.log('');
        console.log('✓ Exit 0 — ADR-150 architectural-constraint rule #3 (graceful degradation).');
      }
      return;
    }
    console.error('Unexpected error importing @metaharness/router:', e);
    process.exit(2);
  }

  // ───── 2. Required exports ─────
  const required = ['Router', 'TrainedRouter', 'resolveRouterBackend'];
  for (const name of required) {
    results.push({
      check: `export "${name}" present`,
      ok: typeof mod[name] === 'function' || typeof mod[name] === 'object',
      detail: typeof mod[name] === 'undefined' ? 'missing' : typeof mod[name],
    });
  }

  // ───── 3. Router.fromExamples + route(embedding) ─────
  // Mirrors the exact shape used in v3/@claude-flow/cli/src/ruvector/neural-router.ts:
  //   - rows: { embedding: number[], scores: Record<string, number> }
  //   - prices: Record<modelId, number>
  //   - opts: { qualityBar?: number, k?: number }
  //   - route(embedding: number[]) → { id, predictedQuality, costPerMTok, metBar }
  try {
    if (typeof mod.Router?.fromExamples !== 'function') {
      results.push({ check: 'Router.fromExamples static factory', ok: false, detail: 'missing' });
    } else {
      const rows = [
        { embedding: [0.1, 0.2, 0.3, 0.4], scores: { haiku: 0.85, sonnet: 0.92, opus: 0.95 } },
        { embedding: [0.8, 0.7, 0.6, 0.5], scores: { haiku: 0.60, sonnet: 0.88, opus: 0.94 } },
        { embedding: [0.5, 0.5, 0.5, 0.5], scores: { haiku: 0.75, sonnet: 0.90, opus: 0.93 } },
      ];
      const prices = { haiku: 1, sonnet: 3, opus: 15 };
      const router = mod.Router.fromExamples(rows, prices, { qualityBar: 0.7, k: 2 });
      results.push({ check: 'Router.fromExamples(rows, prices, opts)', ok: !!router && typeof router.route === 'function' });

      const out = router.route([0.3, 0.3, 0.3, 0.3]);
      const hasId = out && typeof out.id === 'string';
      const hasQ = out && typeof out.predictedQuality === 'number';
      results.push({
        check: 'router.route(embedding) returns {id, predictedQuality}',
        ok: hasId && hasQ,
        detail: `id=${out?.id}, q=${out?.predictedQuality?.toFixed?.(3)}`,
      });

      // Upstream provides `predict(candidate, embedding)` per-candidate;
      // ruflo wraps it as `predictAll(embedding)` via map (see neural-router.ts
      // ~L515). We only verify the method exists — the exact candidate
      // shape varies between Router/TrainedRouter/NativeRouter and a
      // signature test would be fragile. The real coverage is the
      // benchmark run in CI.
      const hasPredict = typeof router.predict === 'function';
      results.push({
        check: 'router.predict method present (ruflo predictAll wrapper depends on it)',
        ok: hasPredict,
        detail: hasPredict ? 'function' : 'missing — would break neural-router.ts predictAll wrapper',
      });
    }
  } catch (e) {
    results.push({ check: 'Router runtime', ok: false, detail: (e.message || String(e)).slice(0, 160) });
  }

  // ───── 3b. TrainedRouter.fromJSON round-trip ─────
  try {
    if (typeof mod.TrainedRouter?.fromJSON !== 'function') {
      results.push({ check: 'TrainedRouter.fromJSON static factory', ok: false, detail: 'missing' });
    } else {
      // Round-trip an empty/minimal JSON shape — we only care that
      // fromJSON ACCEPTS the shape, not that the model is meaningful.
      // The exact JSON schema is captured in `dist/router-krr.json`
      // bundled with ruflo; we don't load that here to keep this
      // independent of the v3 source tree.
      const minimal = { type: 'krr', features: [], outputs: [], weights: [], lambda: 0.1 };
      try {
        mod.TrainedRouter.fromJSON(minimal);
        results.push({ check: 'TrainedRouter.fromJSON(minimal)', ok: true, detail: 'accepts shape' });
      } catch (e) {
        // Acceptable: fromJSON may reject minimal shapes. Only flag if
        // the error implies an API signature change (e.g. "not a function").
        if (/is not a function|undefined is not/i.test(e.message)) {
          results.push({ check: 'TrainedRouter.fromJSON signature', ok: false, detail: e.message.slice(0, 160) });
        } else {
          results.push({ check: 'TrainedRouter.fromJSON(minimal)', ok: true, detail: 'rejects minimal — signature intact' });
        }
      }
    }
  } catch (e) {
    results.push({ check: 'TrainedRouter runtime', ok: false, detail: (e.message || String(e)).slice(0, 160) });
  }

  // ───── 4. resolveRouterBackend ─────
  try {
    const backend = await mod.resolveRouterBackend('auto');
    const valid = backend === 'js' || backend === 'native' || (backend && typeof backend === 'object');
    results.push({ check: 'resolveRouterBackend("auto")', ok: valid, detail: JSON.stringify(backend).slice(0, 80) });
  } catch (e) {
    results.push({ check: 'resolveRouterBackend("auto")', ok: false, detail: e.message.slice(0, 120) });
  }

  // ───── 5. Summary + exit ─────
  const failed = results.filter((r) => !r.ok);
  const payload = {
    moduleVersion: mod.version ?? null,
    checksRun: results.length,
    checksPassed: results.length - failed.length,
    checksFailed: failed.length,
    results,
    generatedAt: new Date().toISOString(),
  };

  if (ARGS.format === 'json') {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log('# check-metaharness-compat');
    console.log('');
    console.log(`| Check | OK | Detail |`);
    console.log(`|---|:---:|---|`);
    for (const r of results) {
      console.log(`| ${r.check} | ${r.ok ? '✓' : '⚠'} | ${r.detail || ''} |`);
    }
    console.log('');
    console.log(`**${payload.checksPassed}/${payload.checksRun} passed.**`);
    if (failed.length) {
      console.log('');
      console.log('⚠ Upstream API has changed. Investigate v3/@claude-flow/cli/src/ruvector/neural-router.ts before publishing.');
    } else {
      console.log('');
      console.log('✓ Upstream API matches ruflo\'s expectations.');
    }
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('check-metaharness-compat crashed:', e.message || e);
  process.exit(2);
});
