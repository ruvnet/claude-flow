# ADR 488: `compactKeep`, a richer carry through compaction

Status: Proposed (design only; nothing is implemented)

Date: 2026-10-10

Builds on: ADR-451 item 7 (`compactCarry`, shipped 0.3.9), ADR-486 (session workspace; the leak lesson is issue #3981), ADR-477 (toasts).
Evidence: [ruflo-mods-compact-live-2026-10.md](../validation/ruflo-mods-compact-live-2026-10.md).

## 1. Context

`compactCarry` appends at most 600 characters to the compaction `instructions`: swarm id, topology word, agent count, open claim ids and
status, last route agent, budget and policy words. The live run shows the hook works: the block reached the summarizer on every compaction
(observed through a second plugin), the id survived into the summary in 9/9 instrumented runs, and the model could answer it 10/14 times
(control 0/7, malformed state fails open 6/6). So the mechanism is proven; **recall by the model is not guaranteed**, and any extra fact
inherits that ceiling.

### 1.1 Corrections to the premises (checked against the kit types shipped with engine 2.1.289)

The brief for this ADR said mods cannot trigger or veto compaction, cannot see the window size and cannot rewrite history. The types say more:

- `$.session.usage()` returns `context.percent` (the engine's own window fill, "as the status line has it"): a mod CAN see window size.
- `$.session.compact({ instructions })` triggers a compaction between turns; a `session.compact` hook can answer `{ skip: reason }` (veto), and on
  `precompute` nothing is installed.
- `session.compact`'s input carries `messages`, and `next({ ...e, messages })` "changes what is summarized". A mod CAN rewrite what is summarized.
- A classic `PreCompact` hook exists (`trigger`, `custom_instructions`) but is no richer than the function hook; there is no reason to use it.

All of this is **from the type declarations only; none of it was exercised live** (UNVERIFIED). `compactKeep` below deliberately uses only the
one thing proven: appending to `instructions`. Rewriting `messages` or vetoing is out of scope and would need its own ADR and live proof.

## 2. Decision (proposed)

Add a second, separate option `compactKeep` (default off), leaving `compactCarry` byte-for-byte as is. When `compactKeep` is on, the same
`session.compact` hook builds the carry block with extra fixed-word facts, under the same framing line and the same screen. `compactKeep`
implies the `compactCarry` facts (it is a superset, not a second block); turning on both is the same as `compactKeep` alone. Naming: the
ADR-451 design name was `compactKeep`; the shipped option took `compactCarry`, so this reuses the reserved name for the upgrade.

### 2.1 Candidate facts, source, and verdict

| fact | source | form | verdict |
|---|---|---|---|
| mission phase | mission store (`mission_get` state), if a file the mod can `$.fs.read` | enumerated word (`planning, running, awaiting, done, failed`) | include if the file shape is verified (UNVERIFIED) |
| open mission id | same | plain identifier, `^[A-Za-z0-9_-]{1,40}$` | include with the id screen; **never the goal text** |
| failing-test count | needs a durable source; none verified (the test run's output is not a stable file) | integer, capped 9999 | **exclude until a source is found** |
| active ADR numbers | no authoritative "active" source | `ADR-nnn`, max 5 | **exclude**: a heuristic would carry guesses as facts |
| open confirm cards | console/room pending-confirm store (ADR-444/448) | count only, never card text | include as a count if the store is readable (UNVERIFIED) |
| cross-project data | any other project's state | n/a | **never** |

What is never carried: prompt text, tool inputs, paths, file contents, goal/title text, branch names, secrets, anything from another project's
root or session. Issue #3981 showed free-text fields (branch names, cwd) reaching the model through a "structure only" path; the rule here is
therefore stricter than "validated": **only enumerated words, integers and identifiers that match a fixed pattern**, and an unknown value becomes
the word `other` or is dropped, never quoted.

### 2.2 Budget and priority

Hard cap stays 600 characters for `compactCarry`; `compactKeep` gets 800 (a deliberate, documented raise, still about 200 tokens). Lines in
priority order; when over budget drop from the bottom, never truncate a line: (1) framing line, (2) swarm line, (3) open claim ids (up to 5, then
count only), (4) mission id + phase, (5) confirm-card count, (6) session line (route, budget, policy). If even (1)+(2)+(3 as count) does not fit,
carry nothing (the existing rule). The finished text goes through `scan()` for secrets and injection phrases as today.

### 2.3 Threat model

| threat | control |
|---|---|
| state files are attacker-writable (a hostile repo) and the block reaches a model as instructions | fixed-shape fields only, framing line says data not instructions, `scan()`, 800 cap; a hostile id fails the pattern and is dropped (kit-tested for `compactCarry`; same tests extend) |
| cross-project leak | read only `state.root`'s own files; never enumerate other sessions (the ADR-486 workspace lists them; `compactKeep` must not import that code) |
| the block steers the summary against the person's own `/compact` text | append only, after the person's text, as today |
| false facts | a stale file is read as it is; the line names status words, not freshness. Add an `updatedAt` age cut (drop swarms/missions older than 24 h) UNVERIFIED as useful |
| cost | one block, about 200 tokens added to the summarizer request per compaction; no extra model call |

### 2.4 Measuring value

Reuse `scripts/live-ruflo-mods-compact.mjs`: seed K canary facts (one per carried line), ON vs OFF vs `compactCarry`, n >= 10 per arm,
metric = fraction of the K canaries named after `/compact` (recall), plus summary-contains as the upper bound. Report cost per run. Gate:
`compactKeep` ships only if recall of the NEW facts is no worse than `compactCarry`'s id recall in the same run and the added cost per
compaction is under about $0.002 (haiku summariser, estimate UNVERIFIED). The current baseline is 10/14 model recall, 9/9 summary-contains, so the
first thing to improve is not more facts but recall of the existing ones (e.g. reword the framing line so the summarizer keeps it verbatim:
the probe showed it paraphrases it away).

### 2.5 PreCompact / state-save

Not needed: the `session.compact` hook already sees `trigger`, `instructions` and `messages` and runs before the summary is made; a
`PreCompact` function hook adds nothing a mod can use. A durable state-save before compaction would need `$.fs.write` to a project file; not
proposed (a write on every compaction is a new side effect with no demonstrated benefit).

### 2.6 Advisory "consider /compact" signal from the console

`$.session.usage().context.percent` is the engine's own figure, so the console should read it rather than estimate from transcript size
(ADR-486 reads transcripts for the workspace; a size-based estimate would be a worse copy of a number the engine already gives). Proposal: a
toast through the ADR-477 policy at >= 80% once per session, advisory only, never triggering `$.session.compact`. Whether `percent` is populated
in each surface, and how it moves after a compaction, is UNVERIFIED; the transcript-size estimate accuracy was NOT measured and is dropped
unless `percent` proves unavailable.

## 3. Recommendation: conditional go, small slice

- **No-go now** on: failing-test count, active ADR numbers, anything with free text, rewriting `messages`, vetoing, auto-triggering `/compact`.
- **Go (small) after two verifications**: (a) confirm the mission store file shape and the confirm-card store are readable by a mod through
  `$.fs` at `state.root`; (b) improve recall of the existing block (framing wording) and re-measure with n >= 10 per arm.
- **Slice to build**: mission id + phase word and confirm-card count as two more lines in `carryBlock`, a `compactKeep` boolean in `options.ts`
  and `plugin.json`, kit tests mirroring `compact.test.ts` (hostile state, over-cap order, secrets), README row, evidence doc from the extended
  live script. Estimate: about 120 lines of source, 150 of tests, one mods version bump, one focused PR, half a day including the live run
  (under $2).
- Not implemented here: step 1 showed the base hook works but model recall is 10/14, and the two source files above are unverified, so the
  safe, small change is not yet proven.
