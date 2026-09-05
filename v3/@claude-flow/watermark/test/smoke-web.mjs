// Web-entry smoke test, run under Node ESM: init the WASM from bytes, then
// generate + detect through the browser-facing API. Mirrors what a browser does
// after `await init()` (in a browser, init() auto-fetches the .wasm).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { init, isReady, Watermarker, detect, detectSelfSync, detectExact } from '../web/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(join(here, '..', 'web', 'ruflo_watermark_bg.wasm'));

let ok = true;
const check = (name, cond, detail) => {
  console.log(`  ${cond ? 'ok:  ' : 'FAIL:'} ${name} — ${detail}`);
  if (!cond) ok = false;
};

// Guard before init.
let threw = false;
try {
  detect(Uint32Array.from([1, 2, 3]), { key: 'k' });
} catch {
  threw = true;
}
check('throws before init()', threw, `isReady=${isReady()}`);

await init(wasmBytes);
check('isReady() after init', isReady(), 'true');

const KEY = '8F3A91C7';
const VOCAB = 128;
const tokens = Uint32Array.from({ length: VOCAB }, (_, i) => i);
const probs = new Float32Array(VOCAB).fill(1 / VOCAB);

for (const scheme of ['tournament', 'tournament_nd', 'gumbel']) {
  const wm = new Watermarker({ key: KEY, scheme, layers: 6 });
  const out = new Uint32Array(600);
  for (let i = 0; i < 600; i++) out[i] = tokens[wm.step(tokens, probs)];
  wm.free();
  const hit = detect(out, { key: KEY, scheme, layers: 6 });
  const wrong = detect(out, { key: 'WRONG', scheme, layers: 6 });
  check(`${scheme}: detects own output`, hit.isWatermarked(1e-6), `z=${hit.zScore.toFixed(1)}`);
  check(`${scheme}: wrong key rejected`, !wrong.isWatermarked(1e-6), `z=${wrong.zScore.toFixed(2)}`);
}

const g = new Watermarker({ key: KEY, scheme: 'gumbel' });
const gs = new Uint32Array(600);
for (let i = 0; i < 600; i++) gs[i] = tokens[g.step(tokens, probs)];
g.free();
check('self-sync detector fires', detectSelfSync(gs, { key: KEY }).zScore > 8, 'z>8');
check('exact short-text detector fires', detectExact(gs.slice(0, 120), { key: KEY }).log10P < -3, 'log10p<-3');

console.log(ok ? '\nWEB SMOKE OK' : '\nWEB SMOKE FAILED');
process.exit(ok ? 0 : 1);
