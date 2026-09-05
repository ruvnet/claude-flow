// Smoke test: generate a watermarked stream with each scheme and confirm the
// detector flags it under the right key, rejects the wrong key, and does not
// fire on a null stream. Exercises the specialized detectors too.
'use strict';

const { Watermarker, detect, detectSelfSync, detectExact } = require('..');

const KEY = '8F3A91C7';
const VOCAB = 128;
const tokens = Uint32Array.from({ length: VOCAB }, (_, i) => i);
const probs = new Float32Array(VOCAB).fill(1 / VOCAB);

function generate(scheme, n = 600) {
  const wm = new Watermarker({ key: KEY, scheme, contextWidth: 4, layers: 6 });
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) out[i] = tokens[wm.step(tokens, probs)];
  wm.free();
  return out;
}

let ok = true;
function check(name, cond, detail) {
  if (!cond) {
    ok = false;
    console.error(`  FAIL: ${name} — ${detail}`);
  } else {
    console.log(`  ok:   ${name} — ${detail}`);
  }
}

for (const scheme of ['tournament', 'tournament_nd', 'gumbel']) {
  const stream = generate(scheme);
  const hit = detect(stream, { key: KEY, scheme, layers: 6 });
  const wrong = detect(stream, { key: 'WRONGKEY', scheme, layers: 6 });
  const nul = detect(Uint32Array.from({ length: 600 }, (_, i) => (i * 2654435761 >>> 0) % VOCAB), { key: KEY, scheme, layers: 6 });
  check(`${scheme}: detects own output`, hit.isWatermarked(1e-6), `z=${hit.zScore.toFixed(1)}`);
  check(`${scheme}: wrong key not flagged`, !wrong.isWatermarked(1e-6), `z=${wrong.zScore.toFixed(2)}`);
  check(`${scheme}: null not flagged`, !nul.isWatermarked(1e-6), `z=${nul.zScore.toFixed(2)}`);
}

// Specialized detectors on a Gumbel stream.
const g = generate('gumbel');
const ss = detectSelfSync(g, { key: KEY });
const ex = detectExact(g.slice(0, 120), { key: KEY });
check('self-sync detector fires', ss.zScore > 8, `z=${ss.zScore.toFixed(1)}`);
check('exact short-text detector fires', ex.log10P < -3, `log10p=${ex.log10P.toFixed(1)}`);

console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAILED');
process.exit(ok ? 0 : 1);
