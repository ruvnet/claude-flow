# ADR 452: Mod-system overnight hardening: what was found, what changed, what is still open

Status: Accepted (a record of work already merged; #3734 was still open when this was written; #3733 merged afterwards)

Date: 2026-10-05

Builds on: ADR-404 (ruflo as a mod), ADR-444 (Claude controls the console), ADR-445 (AgentDB as a mod), ADR-446 (the plugin fleet as mods), ADR-450 (threat model), ADR-451 (capability roadmap)

Evidence: `v3/docs/validation/mod-guard-probe-2026-10.md`, `v3/docs/validation/mod-capability-review-2026-10.md`; pull requests named inline, each read with `gh pr view N` on 2026-10-05

## 1. Context

Between 2026-10-04 and 2026-10-05 a series of pull requests (#3695 to #3734) tested the mod system adversarially and fixed what the tests found. The fixes landed one PR at a time, with their own numbers, and the numbers do not all agree. This ADR is the single account: what each probe found, which PR changed it, which counts are reliable, and what is still open. It makes no new design decision.

## 2. What was found and what changed

### 2.1 Guard-probe corpus and the 788 to 0 journey

- **#3706** added `scripts/check-guard-tool-names.mjs`: every tool name a plugin guard watches must exist in the CLI registry, so a renamed tool cannot silently stop being guarded. No mismatches were found.
- **#3714** added `scripts/probe-mod-guards.mjs`. It bundles each `plugins/*/hooks/guard.ts`, calibrates where the guard really refuses a secret, then mutates that payload (nesting, width, size, invisible characters, secrets as object keys, encodings). The first corpus was 97 probes, 2 997 runs over 37 guards. No regex-DoS, crash or hang was found. It recorded a known-holes baseline so the smoke fails only on a new hole.
- Four root causes sat in the copied traversal (`textsOf`): a depth cap (about 6), sibling and character caps that failed open, object keys never read (28 guards), and an incomplete invisible-character set (U+00AD, U+2066 to 2069, U+180E passed).
- **#3711** first made one source for the screen (`sync-mod-screen.mjs` regenerates the shared region of 37 copies, `--check` in CI). **#3719** then replaced every local `textsOf` with one iterative breadth-first walker and widened the invisible set. Result in #3719's own words: "old guards 788 holes → new 0", with the empty baseline reporting 0 holes.
- **#3715** changed only the shared block: fewer false positives (`getTokenFromHeader(request)`, placeholders, `sk-learn-…`), more vendor keys, URL credentials and env assignments caught, and 200 KB scanned in one pass.
- **#3727** added guard coverage for the secret-bearing MCP tools ADR-450 T6 named as unwatched (`browser_fill`, `browser_type`, `x_federation_invite_mint`, `config_import`, `memory_import`, `session_import`) in five plugins.

**Honest correction: the count was never one number, and "0 holes" was relative to a corpus that then grew.**

| Where | Count |
|---|---|
| #3714 title and baseline file on merge | 749 holes |
| Headline table in the probe report (generated section, not regenerated since the fix) | 820 `must` failures, 192 advisory, 2 997 runs |
| #3719 same probe code against old and new guards | 788 holes before, 0 after |

I could not reconcile 749, 788 and 820 from the repository. They were measured on different bases while neighbouring PRs were merging, and I do not claim which is "the" number. What holds across all three is the root-cause list and the 0 after #3719 on the 2 997-run corpus.

**#3732** then added five probe classes (three name/value pairs, two budget cases): 5 cases for 37 guards is 185 runs, so the corpus is **3 182 runs**. Against it, **32 guards still let a secret through** once input passed the walker's node budget, because the walker dropped the rest silently. Those 32 were recorded in the baseline (`{}` became 32 entries). So "0 holes" was true for the 2 997-run corpus and false for the 3 182-run corpus the moment it was extended.

**#3734 (open)** fixes that once, in the shared region: `textsOf` appends a `TRUNCATED` marker whenever it drops anything, and every guard that asks "is there a secret in these texts" refuses on it. Its description reports 3 182 runs, 0 holes against an empty baseline. Until it merges, the 32-entry baseline stands. Its own caveats: the walker's node cap in code is 20 000, not the 25 000 the probe doc names; about 74 guard files keep refusal wording that is slightly wrong for an oversize input.

Still not covered by the corpus: the policy rules of the five policy-only or observe-only guards, real captured host input shapes, and `ruflo-iot-cognitum`'s Bash path. Base64, hex, URL-encoding, `\u` escapes and confusables (192 advisory misses) are deliberately not decoded.

### 2.2 A shell command at level `write` (#3717)

`dt-term-exec` ("run the command in a ruflo terminal") carries the note "RUNS A SHELL COMMAND in this project, as you", but `classOf` read it as an ordinary `write`. With control at `write` and the autopilot default, Claude's `console_run` ran `echo hello` (reproduced live on main; after the fix: `Refused: … is a delete action and control is set to "write" (it needs "full")`). The class bug was broader: of 60 hand-written adversarial labels, 52 were under-classified. `classOf` is now stem-based plus shell, network and billed phrases; on the 288 real palette entries the counts moved from delete 13 / spend 2 to delete 17 / spend 5. The PR also fixed typed text that could cancel a note ("not", "no", "without"). It carried ADR-450 (18 threats, Proposed).

### 2.3 The remembered-allow bypass (#3713)

`ask()` ran an action whose kind a person had once marked "always allow" and left nothing pending; the control level and confirm mode are applied only when something is pending. So with control at `read`, Claude could run any remembered-kind action. `state.control.viaModel` is now set for the duration of a model tool call and `ask()` skips the remembered fast path while it is set. A person's own click is unchanged. Mutation check in the PR: removing the condition fails the new test.

### 2.4 The truncation hole (#3732, #3734)

Same class as 2.1, found by the extended probe: a work limit that returns "nothing found" is a fail-open. The rule it taught, applied in #3734: when a limit is hit, refuse. The agentdb guard already did (#3728).

### 2.5 `agentTrim` and dispatch (#3733, merged; corrected by the measurement in the trim-measure PR)

A live headless run of `ruflo-mods` 0.3.1 appeared to show that `agentTrim` removes unused agent types from the listing only and that a hidden type could still be spawned by name. **That was too broad.** The follow-up measurement (`v3/docs/validation/ruflo-mods-trim-measure-2026-10.md`) found the spawn in the first run had named the type in its prompt, which keeps it at dispatch: with trim on, a hidden type the prompt does not name is refused ("Agent type ... not found"), and one the prompt names plainly is accepted. The measured saving is 4,236 prompt tokens per request with 59 of 69 types hidden. The text in the option and in the #3729 description said "listing and dispatch", which was wrong; #3733 corrects it (0.3.2, no behaviour change). Also found: a type named in the prompt is not reliably kept in a headless session, because the listing is built before the first prompt; `agentTrimKeep` is the reliable way. Interactive sessions were not tested.

### 2.6 Version-collision hazard when merging concurrent PRs

Each PR bumps the patch version of the plugins it touches and the smoke scripts pin that string. Two PRs that bump the same plugin from the same base produce the same version for different content. This happened: commit `aa4b1bc04` is "bump the six plugins whose version collided with main after merge" (on the `loop/cap-r2` line, merged by #3731). #3734 bumps 39 plugins at once, so it is the most exposed; its description records a check against `origin/main` that no plugin was left on main's version string. Rule: after merging main into a branch, compare every touched `plugin.json` version with `origin/main` before merging, and re-bump on a match.

### 2.7 Vendored shared kits and the sync check

Two kits are now vendored from `ruflo-agentdb` into the other plugins between marker pairs: the secret **screen** (`hooks/screen.ts`, `// BEGIN/END SHARED SCREEN`, #3711, 37 copies at the time, 38 by the later PRs) and the **flag** option parser (`hooks/options.ts`, `// BEGIN/END SHARED FLAG`, commit `21adb5ce2`, reworked into the script by #3731; `ruflo-mods` skipped, it parses a richer set). `node scripts/sync-mod-screen.mjs` rewrites, `--check` fails on a drifted copy, a lost marker or zero copies, and rejects raw invisible characters in the shared block. CI runs `--check` in `all-plugins-smoke.yml`. Anything outside the markers stays per plugin. This is why #3719 and #3734 could fix 38 guards with one edit, and why a fix to a shared region must be followed by a patch bump of every plugin whose copy changed (2.6).

## 3. Still open

- **#3734** is open; the 32-entry known-holes baseline stands until it merges. #3733 merged and corrected the `agentTrim` wording (ruflo-mods 0.3.2).
- Policy-only guards, captured host input, the iot Bash path and the advisory encodings are not probed (2.1).
- ADR-450's remaining T8 controls (session budget per class, plugin-install as full, default confirm ask) are separate work (#3727 says so).
- The probe report's generated tables still show the pre-fix 820 failures; regenerate with `--report <tmp>` and splice.

## 4. Consequences

The probe, the tool-name check, the drift check and the known-holes gate now run in `smoke-all-plugins`, so a new hole, a renamed tool or a drifted copy fails CI. The cost is a shared region that every fix must regenerate and re-bump. The lesson recorded here is that a hole count is only meaningful with its corpus size beside it.
