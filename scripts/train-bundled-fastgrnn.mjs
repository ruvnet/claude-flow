// Train a tiny-dancer FastGRNN safetensors artifact from the measured v2
// seed corpus (ADR-149 iter 10). Pipes the same `{embedding, scores}` rows
// the KRR trainer consumes through `@metaharness/router`'s `trainNativeRouter`
// (which internally calls `@ruvector/tiny-dancer`'s `trainRouter`).
//
// USAGE
//   node scripts/train-bundled-fastgrnn.mjs                # default output
//   node scripts/train-bundled-fastgrnn.mjs --out ./my.safetensors
//
// Then to use the artifact:
//   CLAUDE_FLOW_ROUTER_NEURAL=1 \
//   CLAUDE_FLOW_ROUTER_MODEL_PATH=./assets/model-router/seed-router.fastgrnn.safetensors \
//   node ...

import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import * as mh from '@metaharness/router';
// iter 35 — single source of truth for prices.
import { blendedPrice } from '../v3/@claude-flow/cli/dist/src/ruvector/model-prices.js';

const args = (() => {
  const a = { out: resolve('v3/@claude-flow/cli/assets/model-router/seed-router.fastgrnn.safetensors'), epochs: 40, hiddenDim: 12, lr: 0.05 };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--out') a.out = process.argv[++i];
    else if (process.argv[i] === '--epochs') a.epochs = parseInt(process.argv[++i], 10);
    else if (process.argv[i] === '--hidden') a.hiddenDim = parseInt(process.argv[++i], 10);
    else if (process.argv[i] === '--lr') a.lr = parseFloat(process.argv[++i]);
  }
  return a;
})();

const seedPath = resolve('v3/@claude-flow/cli/assets/model-router/seed-rows.json');
console.log(`[fastgrnn] reading measured seed corpus from ${seedPath}`);
const rows = JSON.parse(readFileSync(seedPath, 'utf8'));
console.log(`[fastgrnn] ${rows.length} rows, dim=${rows[0].embedding.length}, candidates=${Object.keys(rows[0].scores).length}`);

// iter 35 — derive per-candidate blended price from the shared module
// instead of inlining a table that drifts from train-bundled-krr.mjs.
const PRICES = Object.fromEntries(Object.keys(rows[0].scores).map(m => [m, blendedPrice(m)]));

console.log(`[fastgrnn] checking native backend availability...`);
const nativeAvailable = await mh.isNativeRouterAvailable();
console.log(`[fastgrnn] tiny-dancer native: ${nativeAvailable ? 'available' : 'NOT available — install @ruvector/tiny-dancer'}`);
if (!nativeAvailable) {
  console.error('[fastgrnn] cannot train without the native backend.');
  process.exit(2);
}

console.log(`[fastgrnn] training: epochs=${args.epochs} hiddenDim=${args.hiddenDim} lr=${args.lr}`);
const t0 = performance.now();
const res = await mh.trainNativeRouter(rows, PRICES, {
  outputPath: args.out,
  hiddenDim: args.hiddenDim,
  epochs: args.epochs,
  learningRate: args.lr,
});
const trainMs = performance.now() - t0;

const size = statSync(args.out).size;
console.log(`[fastgrnn] trained in ${trainMs.toFixed(0)}ms`);
console.log(`[fastgrnn] epochsRun=${res.epochsRun} trainLoss=${res.trainLoss.toFixed(4)} trainAcc=${res.trainAccuracy.toFixed(3)} valAcc=${res.valAccuracy.toFixed(3)}`);
console.log(`[fastgrnn] wrote ${args.out} (${size} bytes)`);
console.log(`[fastgrnn] to use: CLAUDE_FLOW_ROUTER_NEURAL=1 CLAUDE_FLOW_ROUTER_MODEL_PATH=${args.out}`);
