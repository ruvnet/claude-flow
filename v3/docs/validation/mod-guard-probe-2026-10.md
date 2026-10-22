# Mod guard fleet probe — 2026-10

Adversarial probe of every `plugins/*/hooks/guard.ts` verdict function (37 guards), run by `node scripts/probe-mod-guards.mjs`
(full corpus; `--fast` is the subset wired into `scripts/smoke-all-plugins.mjs`). No plugin code was changed: this report records
what the probe found. The section below the marker is generated; the **Findings** section is hand-written from it (regenerate with
`--report <tmp>` and splice, do not overwrite this file blindly).

## Method

- Each guard is bundled with esbuild into a private temp dir and run in a worker thread; a watchdog kills a hung probe and reports it.
- **Calibration** finds where each guard actually bites: it tries every tool name the guard source mentions (plus a static list) under
  several namespaces/fields, and keeps a (tool, namespace, field) only if a secret is refused **and** the benign corpus passes. Every
  evasion probe is therefore a mutation of a payload the same guard *does* refuse in the same slot, so a miss is a real bypass, not a
  guard that never looked there. Up to 3 distinct tools per plugin are probed.
- Corpus (97 probes): secrets split by zero-width/bidi/soft-hyphen characters; nested 3 to 5000 levels (object, array, mixed); wide arrays
  and objects; secrets as object keys; 1 MB strings with the secret at the start, middle, end, and after 25 k / 200 k of padding;
  JSON-in-string (plain, double-encoded, `\u` escaped); base64, hex, URL-encoding; fullwidth and Cyrillic confusables; 36 stress inputs
  (1 MB near-miss secrets, `-----BEGIN` runs, `curl ` repeats, 100 000-deep nesting, 100 000-wide arrays and objects) timed per call.
- Gate: a call over 50 ms (best of up to 3 runs) fails; a throw fails; a hang fails; benign look-alikes (10 shapes) must pass.
- Tiers: `must` fails the run. `advisory` (base64, hex, URL-encoding, `\u`-escaped JSON, fullwidth/Cyrillic confusables) is an encoding a
  pattern guard is not designed to decode; it is reported and fails only under `--strict`.

## Headline numbers (full corpus, 37 guards, 2 997 probe runs)

| result | count |
|---|---:|
| pass | 1 760 |
| fail (`must`) | 820 |
| advisory miss | 192 |
| skipped (no secret surface to mutate) | 225 |

- 32 of 37 guards have a secret surface; 5 are policy-only (`ruflo-browser`, `ruflo-business-pods`, `ruflo-chatgpt-federation`,
  `ruflo-deepseek-harness`) or observe-only (`ruflo-testgen`, never refuses). They get the stress and crash probes only (36 pass, 45 skipped
  each); their URL/path/command policy rules are **not** covered by the secret-evasion corpus.
- **No regex-DoS, no crash, no hang.** Across all 37 guards the slowest stress call outside the wide-object case was 15.9 ms
  (`ruflo-browser`, 1 MB of zero-width spaces); no guard threw on 5000- or 100 000-deep input; no probe hung.
- The 820 failures are 4 root causes, each present in all 32 guards that share the copied `textsOf` + `screen.ts` template.

## Findings

Reproducers run against the real `ruflo-adr` bundle (`namespace: 'adr'`, `memory_store`, value as shown; `tok` is a GitHub-token-shaped
string built at runtime). `refused` is the correct answer; `LET THROUGH` is the hole.

| # | hole | reproducer (value) | result | guards |
|---|---|---|---|---|
| 1 | **Depth cap fails open.** `textsOf` returns `[]` past depth 6 | `{k:{k:{k:{k:{k:{k:tok}}}}}}` (secret at depth 7); also 12, 60, 5000, arrays, mixed | LET THROUGH (3 levels: refused) | 32 |
| 2 | **Sibling cap fails open.** `slice(0, 200)` on arrays and `Object.values` | `[...200 × 'x', tok]`; object with 250 keys, secret last; 5000-element array | LET THROUGH | 32 |
| 3 | **Character budget fails open.** `budget.left = 20_000`, and `hasSecret` slices to 20 000 chars | `'lorem '.repeat(4200) + tok`; same at 1 MB (middle and end). Secret at the start of 1 MB is caught | LET THROUGH | 32 |
| 4 | **Object keys are never read.** `Object.values` only | `{ [tok]: 'v' }`, the same nested 3 deep, or inside an array of objects | LET THROUGH | 28 (the four that scan keys: `ruflo-migrations`, `ruflo-music`, `ruflo-neural-trader`, `ruflo-observability`) |
| 5 | **Invisible-character class is incomplete.** The strip set covers C0/C1 controls, U+200B-U+200F, U+2028-U+202E, U+2060-U+2064 and U+FEFF, and nothing else | the token with U+00AD (soft hyphen) inserted after its third character; with U+2067 U+2069 (bidi isolates); with U+180E (Mongolian vowel separator) | LET THROUGH (U+200B, U+200D, U+FEFF, U+2060, U+202E are all refused) | 32 |
| 6 | **Object with 100 000 keys costs 60–184 ms.** `Object.values(input)` allocates every value before `.slice(0, 200)` | `Object.fromEntries(100 000 × ['k'+i,'x'])` | 63.6–68.3 ms on `ruflo-adr`; 60.5–184.2 ms across the 32 (worst `ruflo-bbs-federation`) | 32 |

Repro for 1 to 5 (about 12 lines, runs standalone after bundling `plugins/ruflo-adr/hooks/guard.ts` with esbuild):

```js
import { verdict } from './adr.mjs'
const tok = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'
const call = value => verdict('mcp__plugin_ruflo-core_ruflo__memory_store', { namespace: 'adr', value }) === undefined ? 'LET THROUGH' : 'refused'
const nest = (leaf, d) => { let v = leaf; for (let i = 0; i < d; i++) v = { k: v }; return v }
call(tok)                                   // refused (control)
call(nest(tok, 3))                          // refused
call(nest(tok, 6))                          // LET THROUGH  (#1)
call([...Array(200).fill('x'), tok])        // LET THROUGH  (#2)
call('lorem '.repeat(4200) + tok)           // LET THROUGH  (#3)
call({ [tok]: 'v' })                        // LET THROUGH  (#4)
call(tok.slice(0, 3) + String.fromCharCode(0xad) + tok.slice(3))   // LET THROUGH (#5)
```

Why these matter: every cap is a fail-open. A caller (or a model told to work around the guard) pads, nests or widens the
payload until the secret sits past the cap, and the write is allowed. The fix pattern is the same everywhere: scan iteratively with no
depth/sibling cap, scan keys as well as values, and when a work limit is hit **refuse** (fail closed) instead of returning "nothing
found"; strip `\p{Cf}` plus U+00AD, U+034F and U+180E rather than a hand-listed range; iterate keys with `for…in` and stop at the
limit instead of materialising `Object.values`.

### Advisory (not failures; 192 misses, 6 probes × 32 guards)

`base64`, `hex`, `url-encoded`, `json-unicode-escape` (`"ghp_…"`), `fullwidth-confusable`, `cyrillic-confusable`. A pattern guard
does not decode, so every guard misses these. They are only a risk when the destination decodes before use; decide per tool whether to
add a decode pass. Run `--strict` to make them fail.

### What passed everywhere

Plain secrets, secrets in JSON-in-string and double-encoded JSON, zero-width space/joiner/non-joiner, BOM, word joiner, bidi override
and LRM wrapping, depth ≤ 6 nesting, every stress input, and all 10 benign look-alikes (no false positives on `sk-learn`, a SHA-256
digest, a UUID, "api key rotation ticket", prose about JWTs).

### Not covered

- The 5 policy-only guards' own rules (URL scheme, template path traversal, public channel names, destructive-command patterns).
- Real host input shapes: calibration uses synthetic `{namespace, value}`-style carriers, not captured tool calls. A guard that reads a
  field the carrier list does not contain would show as "no secret surface" rather than a hole.
- `ruflo-iot-cognitum`'s Bash-command path (it needs a `cognitum-iot` prefix the generic carriers do not produce); only its
  `memory_store` path is probed.

### Budget probes (loop cap-r3, ranked improvement #3)

Three probe classes were added to the corpus: `structured` (`{key:'api_key', value}`, a nested `{field, content}`, a `['token', value]` pair), and `budget`
(a secret after 25 000 list nodes, and after 2.8 M characters). Result: **32 guards let a secret through past the
25 000-node walker budget** (`over-node-cap-25000`); the shared `textsOf` drops the rest silently. Only `ruflo-agentdb` refuses oversize input
(PR #3728). The structured and character-budget probes pass everywhere (a bare credential value is caught on its own; `bare()` keeps head and tail).
Not fixed here: the root cause is the vendored shared region, which `scripts/sync-mod-screen.mjs` (reworked by PR #3731) regenerates in every plugin.
The holes are recorded in the baseline so a new one still fails the smoke. Fix: make the shared `textsOf` report truncation and have each guard
refuse on it, once, in the generator, then shrink the baseline.

## Gate

`scripts/probe-mod-guards.known-holes.json` records the current holes. **Closed in cap-r4**: the shared `textsOf` now appends a `TRUNCATED` marker whenever it drops input (node, character or per-string budget), and `names`/`hasSecretIn` count it as a finding, so every guard refuses what it could not read in full (message never echoes input). The baseline is empty (it held 32 `over-node-cap-25000` entries as of cap-r3). `smoke-all-plugins.mjs` runs `--fast --known-holes` last, so a
**new** hole (a regression, or a new guard copied from the capped template) fails the smoke while this backlog does not. Fixed holes
print as "known holes that now pass"; remove them from the baseline. Fix a root cause, rerun `--write-known-holes`, commit the shrink.

<!-- generated below: node scripts/probe-mod-guards.mjs --report <path> -->

Generated by `node scripts/probe-mod-guards.mjs` in 30.6s. Timing: a probe fails only above 1000 ms (median of 3: hang / catastrophic backtracking); 50-1000 ms, or >50x the guard's own trivial-input time, is reported as advisory slow, not failed.

## Per-plugin summary

| plugin | secret surface found (tool[namespace].field) | pass | fail | advisory miss | skipped | worst ms (probe) |
|---|---|---:|---:|---:|---:|---|
| ruflo-adr | `memory_store[adr].value`<br>`agentdb_hierarchical-store[adr].value`<br>`agentdb_causal-edge[adr].value` | 50 | 25 | 6 | 0 | 86.2 (s-wide-keys-100k) |
| ruflo-agent | `wasm_agent_prompt.value`<br>`wasm_agent_tool.value`<br>`wasm_agent_create.value` | 50 | 25 | 6 | 0 | 95.3 (s-wide-keys-100k) |
| ruflo-agentdb | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_causal-edge.value` | 50 | 25 | 6 | 0 | 98.9 (s-wide-keys-100k) |
| ruflo-ai-team | `task_create.value`<br>`memory_remember.value`<br>`task_update.value` | 50 | 25 | 6 | 0 | 89.3 (s-wide-keys-100k) |
| ruflo-aidefence | `aidefence_learn.value` | 50 | 25 | 6 | 0 | 90.1 (s-wide-keys-100k) |
| ruflo-autopilot | `autopilot_log.value`<br>`autopilot_learn.value`<br>`autopilot_config.value` | 50 | 25 | 6 | 0 | 90.3 (s-wide-keys-100k) |
| ruflo-bbs-federation | `federation_bbs_publish.value`<br>`federation_bbs_human_join.value` | 50 | 25 | 6 | 0 | 183.2 (s-wide-keys-100k) |
| ruflo-browser | none (policy guard) | 36 | 0 | 0 | 45 | 16.6 (s-zwsp) |
| ruflo-business-pods | none (policy guard) | 36 | 0 | 0 | 45 | 0.0 (-) |
| ruflo-chatgpt-federation | none (policy guard) | 36 | 0 | 0 | 45 | 0.1 (s-zwsp) |
| ruflo-daa | `daa_knowledge_share.value`<br>`daa_x.value` | 50 | 25 | 6 | 0 | 89.8 (s-wide-keys-100k) |
| ruflo-ddd | `memory_store[ddd-model].value`<br>`agentdb_hierarchical-store[ddd-model].value` | 50 | 25 | 6 | 0 | 88.5 (s-wide-keys-100k) |
| ruflo-deepseek-harness | none (policy guard) | 36 | 0 | 0 | 45 | 0.0 (-) |
| ruflo-docs | `memory_store[docs].value`<br>`hooks_worker-dispatch[document].value` | 50 | 25 | 6 | 0 | 94.3 (s-wide-keys-100k) |
| ruflo-federation | `memory_store[federation].value`<br>`federation_bbs_publish.value` | 50 | 25 | 6 | 0 | 91.2 (s-wide-keys-100k) |
| ruflo-goals | `memory_store[goals].value`<br>`agentdb_hierarchical-store[goals].value`<br>`agentdb_pattern-store[goals].value` | 50 | 25 | 6 | 0 | 78.8 (s-wide-keys-100k) |
| ruflo-graph-intelligence | `sublinear_solve.value`<br>`sublinear_x.value` | 50 | 25 | 6 | 0 | 91.4 (s-wide-keys-100k) |
| ruflo-intelligence | `memory_store[patterns].value`<br>`hooks_intelligence_pattern-store.value`<br>`hooks_transfer.value` | 50 | 25 | 6 | 0 | 101.9 (s-wide-keys-100k) |
| ruflo-iot-cognitum | `memory_store[iot-devices].value` | 50 | 25 | 6 | 0 | 106.3 (s-wide-keys-100k) |
| ruflo-jujutsu | `github_pr_manage.value` | 53 | 22 | 6 | 0 | 121.6 (s-wide-keys-100k) |
| ruflo-knowledge-graph | `agentdb_hierarchical-store.value`<br>`agentdb_causal-edge.value`<br>`agentdb_pattern-store.value` | 53 | 22 | 6 | 0 | 108.5 (s-wide-keys-100k) |
| ruflo-loop-workers | `hooks_worker-dispatch.value` | 53 | 22 | 6 | 0 | 110.2 (s-wide-keys-100k) |
| ruflo-market-data | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_pattern-store.value` | 53 | 22 | 6 | 0 | 114.7 (s-wide-keys-100k) |
| ruflo-metaharness | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_causal-edge.value` | 53 | 22 | 6 | 0 | 95.8 (s-wide-keys-100k) |
| ruflo-migrations | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_pattern-store.value` | 53 | 22 | 6 | 0 | 97.0 (s-wide-keys-100k) |
| ruflo-music | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_pattern-store.value` | 53 | 22 | 6 | 0 | 118.0 (s-wide-keys-100k) |
| ruflo-neural-trader | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_pattern-store.value` | 53 | 22 | 6 | 0 | 103.7 (s-wide-keys-100k) |
| ruflo-observability | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_pattern-store.value` | 53 | 22 | 6 | 0 | 94.3 (s-wide-keys-100k) |
| ruflo-rag-memory | `memory_store.value`<br>`agentdb_hierarchical-store.value`<br>`agentdb_pattern-store.value` | 53 | 22 | 6 | 0 | 118.6 (s-wide-keys-100k) |
| ruflo-ruvector | `memory_store.value` | 53 | 22 | 6 | 0 | 103.9 (s-wide-keys-100k) |
| ruflo-ruvllm | `ruvllm_hnsw_add.value` | 53 | 22 | 6 | 0 | 110.4 (s-wide-keys-100k) |
| ruflo-rvf | `memory_store.value`<br>`hooks_transfer.value` | 53 | 22 | 6 | 0 | 120.0 (s-wide-keys-100k) |
| ruflo-security-audit | `memory_store[security].value`<br>`agentdb_hierarchical-store[security].value`<br>`agentdb_pattern-store[security].value` | 53 | 22 | 6 | 0 | 121.1 (s-wide-keys-100k) |
| ruflo-sparc | `memory_store[sparc].value`<br>`agentdb_hierarchical-store[sparc].value`<br>`agentdb_pattern-store[sparc].value` | 53 | 22 | 6 | 0 | 116.3 (s-wide-keys-100k) |
| ruflo-testgen | none (policy guard) | 36 | 0 | 0 | 45 | 0.0 (-) |
| ruflo-workflows | `memory_store[workflows].value`<br>`agentdb_hierarchical-store[workflows].value`<br>`agentdb_pattern-store[workflows].value` | 53 | 22 | 6 | 0 | 94.3 (s-wide-keys-100k) |
| ruflo-x-gateway | `x_federation_publish.value`<br>`x_federation_channel_publish.value` | 53 | 22 | 6 | 0 | 85.8 (s-wide-keys-100k) |

## Probe matrix (✓ pass · ✗ fail · ~ advisory miss · · not applicable)

Columns are plugins in the order of the summary table above (1 = first row).

| probe | class | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 | 36 | 37 |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| plain | control | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| zwsp-prefix | invisible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| zwj-mid | invisible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| bom-mid | invisible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| shy-split | invisible | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| word-joiner | invisible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| bidi-isolate | invisible | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| bidi-override-wrap | invisible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| mongolian-vs | invisible | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| every-char-zwsp | invisible | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| nest-obj-3 | nesting | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| nest-obj-6 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-obj-12 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-obj-60 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-obj-5000 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-arr-3 | nesting | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| nest-arr-6 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-arr-12 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-arr-60 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-arr-5000 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-mix-3 | nesting | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| nest-mix-6 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-mix-12 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-mix-60 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| nest-mix-5000 | nesting | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| wide-array-250 | wide | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| wide-object-250 | wide | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| wide-array-5000 | wide | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| key-name | keys | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| key-name-nested-3 | keys | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| key-name-in-array | keys | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| json-in-string | json | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| json-double-encoded | json | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| json-unicode-escape | encoding | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | · | · | ~ | ~ | · | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | ~ | ~ |
| base64 | encoding | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | · | · | ~ | ~ | · | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | ~ | ~ |
| hex | encoding | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | · | · | ~ | ~ | · | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | ~ | ~ |
| url-encoded | encoding | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | · | · | ~ | ~ | · | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | ~ | ~ |
| fullwidth-confusable | confusable | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | · | · | ~ | ~ | · | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | ~ | ~ |
| cyrillic-confusable | confusable | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | · | · | ~ | ~ | · | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | ~ | · | ~ | ~ |
| huge-start | huge | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |
| huge-middle | huge | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| huge-end | huge | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| after-25k-padding | huge | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| after-200k-padding | huge | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | · | · | ✗ | ✗ | · | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | · | ✗ | ✗ |
| s-a | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-a-bang | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-sk-near-miss | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-ghp-near-miss | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-akia-near-miss | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-assign-spaces | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-assign-long-value | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-bearer | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-pem-spaces | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-pem-upper | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-jwt-dots | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-curl-repeat | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-ignore-repeat | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-role-tags | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-send-secrets | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-newlines | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-spaces-x | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-lt | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-brace | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-backslash | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-zwsp | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-zwsp-in-secret | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-emoji | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-email | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-email-dots | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-url | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-url-userinfo | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-path-dots | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-words | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-eq-run | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-deep-obj-5000 | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-deep-arr-5000 | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-deep-obj-100000 | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-wide-array-100k | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-wide-keys-100k | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| s-many-1kb-strings | stress | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| benign-lookalikes | benign | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | · | · | ✓ | ✓ | · | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ |

## Failures by probe

- **shy-split** (must) — 32/37: all but none
- **bidi-isolate** (must) — 32/37: all but none
- **mongolian-vs** (must) — 32/37: all but none
- **nest-obj-6** (must) — 32/37: all but none
- **nest-obj-12** (must) — 32/37: all but none
- **nest-obj-60** (must) — 32/37: all but none
- **nest-obj-5000** (must) — 32/37: all but none
- **nest-arr-6** (must) — 32/37: all but none
- **nest-arr-12** (must) — 32/37: all but none
- **nest-arr-60** (must) — 32/37: all but none
- **nest-arr-5000** (must) — 32/37: all but none
- **nest-mix-6** (must) — 32/37: all but none
- **nest-mix-12** (must) — 32/37: all but none
- **nest-mix-60** (must) — 32/37: all but none
- **nest-mix-5000** (must) — 32/37: all but none
- **wide-array-250** (must) — 32/37: all but none
- **wide-object-250** (must) — 32/37: all but none
- **wide-array-5000** (must) — 32/37: all but none
- **key-name** (must) — 15/37: ruflo-adr, ruflo-agent, ruflo-agentdb, ruflo-ai-team, ruflo-aidefence, ruflo-autopilot, ruflo-bbs-federation, ruflo-daa, ruflo-ddd, ruflo-docs, ruflo-federation, ruflo-goals, ruflo-graph-intelligence, ruflo-intelligence, ruflo-iot-cognitum
- **key-name-nested-3** (must) — 15/37: ruflo-adr, ruflo-agent, ruflo-agentdb, ruflo-ai-team, ruflo-aidefence, ruflo-autopilot, ruflo-bbs-federation, ruflo-daa, ruflo-ddd, ruflo-docs, ruflo-federation, ruflo-goals, ruflo-graph-intelligence, ruflo-intelligence, ruflo-iot-cognitum
- **key-name-in-array** (must) — 15/37: ruflo-adr, ruflo-agent, ruflo-agentdb, ruflo-ai-team, ruflo-aidefence, ruflo-autopilot, ruflo-bbs-federation, ruflo-daa, ruflo-ddd, ruflo-docs, ruflo-federation, ruflo-goals, ruflo-graph-intelligence, ruflo-intelligence, ruflo-iot-cognitum
- **json-unicode-escape** (advisory) — 32/37: all but none
- **base64** (advisory) — 32/37: all but none
- **hex** (advisory) — 32/37: all but none
- **url-encoded** (advisory) — 32/37: all but none
- **fullwidth-confusable** (advisory) — 32/37: all but none
- **cyrillic-confusable** (advisory) — 32/37: all but none
- **huge-middle** (must) — 32/37: all but none
- **huge-end** (must) — 32/37: all but none
- **after-25k-padding** (must) — 32/37: all but none
- **after-200k-padding** (must) — 32/37: all but none
