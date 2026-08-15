# Independent minimal repro (adversarial critic)

Deliberately written from scratch, sharing no code with
`bench-flash-attention-topk-quality.mjs`, so a bug in the verification tooling
itself cannot masquerade as a confirmed fix. Hand-constructed (non-random)
input vectors via `sin()`, not the seeded PRNG used elsewhere tonight.

```js
for (const numK of [16, 32, 33, 64, 100, 128, 129, 200]) {
  const Q = mkVecs(3, 8, 1), K = mkVecs(numK, 8, 2), V = mkVecs(numK, 8, 3);
  const b = new Baseline({ dimensions: 8 });   // git HEAD, unpatched
  const c = new Candidate({ dimensions: 8 });  // working tree, patched
  const outB = b.cpuOptimizedAttention(Q, K, V);
  const outC = c.cpuOptimizedAttention(Q, K, V);
  ...
}
```

Output (`node --experimental-strip-types`, no npm deps):

```text
numK=16: baseline NaN=false  candidate NaN=false  baseline[0][0]=-0.04601271077990532  candidate[0][0]=-0.04601271077990532
numK=32: baseline NaN=false  candidate NaN=false  baseline[0][0]=-0.07618803530931473  candidate[0][0]=-0.07618803530931473
numK=33: baseline NaN=true   candidate NaN=false  baseline[0][0]=NaN                    candidate[0][0]=-0.07046490162611008
numK=64: baseline NaN=true   candidate NaN=false  baseline[0][0]=NaN                    candidate[0][0]=-0.06678657978773117
numK=100: baseline NaN=true  candidate NaN=false  baseline[0][0]=NaN                    candidate[0][0]=-0.0721828043460846
numK=128: baseline NaN=true  candidate NaN=false  baseline[0][0]=NaN                    candidate[0][0]=-0.07012700289487839
numK=129: baseline NaN=false candidate NaN=false  baseline[0][0]=-0.33834972977638245   candidate[0][0]=-0.33834972977638245
numK=200: baseline NaN=false candidate NaN=false  baseline[0][0]=-0.33834972977638245   candidate[0][0]=-0.33834972977638245
```

**Confirms, independently:**
1. Baseline is NaN for exactly `33 <= numK <= 128` (the predicted buggy range), and only there.
2. Candidate is finite everywhere in that range.
3. Candidate is byte-identical to baseline outside that range (`numK=16,32,129,200`) — no regression.

This matches the main benchmark's finding exactly, with completely independent code and inputs.
