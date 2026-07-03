# ADR-168: GAIA Harness Evidence Recording — Trajectory Persistence, Split Provenance, Signed Judge Cache

**ID**: ADR-168
**Status**: Proposed — implements the ADR-167 §7 forward contract
**Date**: 2026-07-03
**Authors**: rUv (drafted with Claude Code)
**Related ADRs**:
- ADR-167 (GAIA submission integrity — the audit whose checks this ADR unblocks)
- ADR-133 (GAIA benchmark harness — loader/agent/judge/tools)
- ADR-103 (Witness manifest — Ed25519 signing reused for the judge cache)

---

## 1. Context

ADR-167 shipped a pre-submission exploit audit (AUD-1..7) for GAIA leaderboard
submissions. Its most valuable finding was about ruflo itself: **four of seven
checks cannot run because the harness does not record the evidence.**
Concretely (verified against source, ADR-167 §2/§7):

1. `gaia-agent.ts` builds the `messages[]` array (agent-visible prompts +
   fetched tool outputs) but it is local to `runGaiaAgent` and never returned
   or persisted — so no `trajectories.jsonl` exists, despite `gaia-submit.md`
   documenting one. AUD-1 (answer-leakage — **GAIA's #1 exploit vector,
   ~98% leakage per Berkeley RDI**) and AUD-3 (oracle-leakage) are dark.
2. Tool calls are persisted as per-tool **counts** (`toolCallsByName`), not
   names + arguments. AUD-4 (grader-isolation) cannot attest that no tool call
   touched the judge or grading path.
3. `gaia-loader.ts` hard-codes `split=validation` — the public-gold split —
   and the split is not recorded in run metadata, so AUD-7 (split-integrity)
   can only warn when the field happens to exist.
4. The judge cache (`~/.cache/ruflo/gaia/judgments`) is an **unsigned
   filesystem oracle**: any local process can write a `correct: true` entry
   and the harness will trust it on the next run.

All four gaps are **serialization-only** — the data already exists in memory
at run time; the harness simply does not write it out (ADR-167 §7). Until it
does, every signed submission carries `harness_gaps[]` and the strongest
possible attestation is "clean, except the #1 vector was not checkable."

## 2. Decision

Instrument the harness to record the evidence ADR-167 §5 specifies, in four
parts. Recording is **on by default for submission-bound runs** (`gaia run`
invoked with `--submit-intent`, and always when `/gaia submit` packages) and
controllable via `--record-evidence[=false]` for local iteration.

### 2.1 Trajectory persistence (`gaia-agent.ts` → `gaia-bench.ts`)

`runGaiaAgent` returns an `evidence` object alongside `GaiaAgentResult`;
`gaia-bench.ts` appends one JSON line per task to `trajectories.jsonl` in the
run output dir, matching the ADR-167 §5 record shape:

- `steps[]` — ordered, typed records:
  - `{type: "prompt", content_sha256, head: <first 2 KiB>}` — the agent-visible
    prompt per turn
  - `{type: "tool_call", name, args}` — full tool name + arguments (args
    truncated at 8 KiB each, truncation flagged)
  - `{type: "tool_result", name, output_sha256, head: <first 4 KiB>, bytes}`
    — fetched content is hashed in full and excerpted, not stored whole
- `task_id`, `model`, `turns`, `final_answer`, token counts.

**Hash-plus-head, not full content**: full page bodies would bloat the signed
package by orders of magnitude and drag PII along. AUD-1 scans the recorded
head excerpt for gold-answer occurrences and can demand the full body be
reproduced (hash-verified) only for flagged records. The full-body retention
knob (`--evidence-full-bodies`) exists for forensic runs but is off by default.

### 2.2 Split provenance (`gaia-loader.ts`, run metadata)

- `gaia-loader.ts` accepts `split` as a parameter (`validation` remains the
  default — GAIA's test split is gated); the hard-coded constant is removed.
- `gaia-bench.ts` writes `gaia_split` and `voting_attempts` into
  `BenchRunOutput.summary` and `/gaia submit` copies both into
  `metadata.json`. This flips AUD-6/AUD-7 from "enforceable if the field
  exists" to always-enforceable.

### 2.3 Signed judge cache

Each judge-cache entry gains an Ed25519 signature over
`sha256(task_id | answer | expected | verdict | model)` using the ADR-103
witness key. On read, `gaia-judge` verifies the signature and **treats
verification failure as a cache miss** (re-judges, logs a warning, and
records the event in run metadata as `judge_cache_integrity_events`). The
audit (AUD-4) checks that count is zero for submission runs. Legacy unsigned
entries are treated as misses — the cache re-warms signed within one run; no
migration step.

### 2.4 Documentation truth

`gaia-submit.md` currently documents a `trajectories.jsonl` that does not
exist. Docs are updated in the same PR that makes them true — never before.

## 3. Consequences

**Unblocked**: AUD-1 (answer-leakage), AUD-3 (oracle-leakage), AUD-4
(grader-isolation) become enforceable; AUD-6/AUD-7 become unconditional.
A ruflo submission can then attest earning-integrity on the full ADR-167
check set with zero `harness_gaps[]`.

**Costs**:
- Disk: hash-plus-head keeps a 165-task L1 run's trajectories in the tens of
  MB, not GB. Signed-package size grows accordingly; acceptable.
- Runtime: hashing + line-append per step is negligible against LLM latency;
  judge-cache signing adds one Ed25519 sign/verify per judgment (~µs).
- Privacy: recorded heads may contain fetched web content. The package
  README discloses this; `--record-evidence=false` remains available for
  runs that will never be submitted.

**Risks**:
- Evidence recording that silently fails would resurrect the false-pass
  problem inverted (audit skips ↔ run looks clean). Recording failures are
  therefore **fatal to submission-bound runs** (the run completes but is
  marked non-submittable), matching ADR-167's fail-closed posture.
- `@noble/ed25519` remains on v2 (see the deps-security review, 2026-07-03);
  the cache-signing helper must go through the shared witness signing path so
  the eventual v3 migration touches one call site.

## 4. Implementation checkpoints

1. `evidence` capture in `gaia-agent.ts` behind the flag; unit test asserts
   `messages[]`-derived steps survive to the returned object.
2. `trajectories.jsonl` writer in `gaia-bench.ts`; golden-file test.
3. Loader split parameter + metadata fields; ADR-167 AUD-6/7 fixtures updated.
4. Judge-cache signing + tamper test (hand-edited entry → cache miss +
   integrity event).
5. Run ADR-167's audit end-to-end on a real L1 run and confirm
   `harness_gaps[] == []`.
