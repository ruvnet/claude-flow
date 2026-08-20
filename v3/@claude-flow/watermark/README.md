# @claude-flow/watermark

SynthID-Text-style **LLM text watermarking** (generation + detection) as a
WebAssembly module — no native addon, runs in Node. A watermark rides the
tie-break randomness among *already-plausible* tokens: it never injects an
out-of-distribution word, costs no extra tokens, and is detectable only by a
holder of the secret key. Built for EU AI Act AI-content marking and for
measuring watermark robustness.

Backed by the Rust crate [`ruflo-watermark`](https://github.com/ruvnet/ruflo/tree/main/v3/crates/ruflo-watermark).

> This package intentionally ships **no watermark-removal / laundering tool**.
> The legitimate way to produce un-marked output of your own model is not to
> apply the mark (or to regenerate) — see the crate's `unmarked.rs`.

## Install

```bash
npm install @claude-flow/watermark
```

## Use

The module is model-agnostic: at each step you pass the model's candidate token
ids and their probabilities (typically a top-k slice); the watermarker picks
which candidate to emit.

```js
const { Watermarker, detect } = require('@claude-flow/watermark');

const key = '8F3A91C7';                 // secret key material (carries no user info)

// Generate a watermarked sequence.
const wm = new Watermarker({ key, scheme: 'gumbel' });
const tokens = Uint32Array.from({ length: 128 }, (_, i) => i);
const probs = new Float32Array(128).fill(1 / 128);
const out = new Uint32Array(600);
for (let i = 0; i < out.length; i++) out[i] = tokens[wm.step(tokens, probs)];
wm.free();

// Detect it.
const r = detect(out, { key, scheme: 'gumbel' });
console.log(r.zScore, r.log10P, r.isWatermarked(1e-6)); // strong, true
```

## Schemes

| `scheme` | Property |
|---|---|
| `gumbel` (default) | Aaronson/Kuditipudi exponential-min — **per-instance distortion-free** (marginal token distribution unchanged). |
| `tournament` | SynthID-Text tournament (Nature 2024) — strong, mildly distortionary; strength grows with `layers`. |
| `tournament_nd` | Tournament with continuous g + masking — **key-averaged non-distortionary** (measured < 0.3% drift). |

## API

- `new Watermarker({ key, scheme?, contextWidth?, layers? })` → `.step(tokens, probs)`, `.free()`
- `detect(tokens, { key, scheme?, contextWidth?, layers? })` → `Detection`
- `detectSelfSync(tokens, { key, contextWidth? })` — indel-robust (stronger on edited / repetitive text)
- `detectExact(tokens, { key, contextWidth? })` — exact Gamma-tail p-values for short texts

`Detection` = `{ zScore, pValue, log10P, scoredPositions, isWatermarked(alpha = 1e-6) }`.
`key` may be a string (UTF-8) or `Uint8Array`. Detection is key-specific: a wrong
key sees nothing. Confidence grows with the number of low-stakes token choices,
so short or low-entropy (factual/code) text carries little to no mark.

## Browser / Deno / bundler

The `@claude-flow/watermark/web` entry is an ESM build. Instantiate the WASM once
with `await init()`, then use the same API. In a browser, `init()` with no
argument fetches the sibling `.wasm`; pass a `URL` / `Response` / bytes to
override.

```js
import { init, Watermarker, detect } from '@claude-flow/watermark/web';

await init(); // browser: auto-fetches the wasm

const wm = new Watermarker({ key: '8F3A91C7', scheme: 'gumbel' });
const tokens = Uint32Array.from({ length: 128 }, (_, i) => i);
const probs = new Float32Array(128).fill(1 / 128);
const out = new Uint32Array(600);
for (let i = 0; i < out.length; i++) out[i] = tokens[wm.step(tokens, probs)];
wm.free();

console.log(detect(out, { key: '8F3A91C7', scheme: 'gumbel' }).isWatermarked(1e-6));
```

The `.` entry is the Node (CommonJS) build shown earlier; the `/web` entry is for
browser / Deno / bundlers.

## Scope

Bindings are generated from the Rust crate with `npm run build:wasm`
(`wasm-pack`, both `nodejs` and `web` targets). The crate exposes more than this
WASM surface — the Bayesian/Higher-Criticism detectors, the robustness-evaluation
harness, the Darwin/flywheel detector tuner, and the authorized un-marked-
generation governance path are Rust-only for now.
