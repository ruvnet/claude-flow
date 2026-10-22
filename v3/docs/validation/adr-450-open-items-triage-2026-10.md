# ADR-450 open items T2, T7, T10, T11, T14, T15: triage (2026-10-05)

Read-only triage of the six threats that [ADR-450](../adr/ADR-450-mod-system-threat-model.md) section 9 lists as Open and that have no owner. T5 (PR #3777) and T13 (a worker) are excluded. Checked against `origin/main` at `040c70326`. No code was changed.

How to read the evidence: **Reproduced** means I ran something. **Code-read** means I read the lines named and the behaviour follows from them without running. **Not tried** means exactly that. **(inference)** marks a claim I did not check. Scratch tests ran from the worktree against the main checkout's vitest and were deleted; nothing from them is committed.

## Summary

| T | Threat in one sentence | Still true on main | Fix size | Risk of fix | Who |
|---|---|---|---|---|---|
| T2 | A symlink or FIFO named `status.json` is read through the engine's `fs.read` | Not tried (needs the live engine); the code has no guard | ~10 lines + 1 test, if the engine exposes link kind | Low | Worker, after one engine probe |
| T7 | Nothing forbids a mod from forwarding another mod's status file into a prompt | Code-read: true, and no mod does it today | ~40-line test, no product change | None | Worker |
| T10 | A committed policy projection can switch ruflo's own rules off, and the band says nothing | Code-read: true | Two layers; the cheap one is ~15 lines, the real one needs signing | Cheap: low. Signing: medium | Cheap part worker; signing is a human decision |
| T11 | Any file writer can fake "guard on" for a mod that is not running | **Reproduced** | Cannot be closed inside this threat model; a labelling change is ~10 lines | Low | Human decision (accept or relabel) |
| T14 | In `ask` mode the model's own text sits in the confirm prompt the person answers | Code-read: true | ~50 lines across 5 files + spec | Low-medium (UI) | Worker, then drive the console |
| T15 | A prompt-injected Claude stores an instruction that a later session recalls as memory | Code-read: true; **a provenance mechanism already exists and is unused by recall** | ~30 lines for the plumbing | Medium (drops legacy memories unless decided) | Worker for plumbing, human for the `unknown` default |

Recommended order: **T7, T14, T15 (plumbing), T10 (cheap layer), T2 (probe first), T11 (decision, no code).** The reasoning is under each item.

## T2. Hostile `status.json` that is a link or a FIFO

**Threat.** F (a process or file writer in the project) makes `.claude-flow/<x>-mod/status.json` a symlink to a huge or blocking file, or a FIFO, and the console reads it through the engine.

**Reproduces on main?** Not tried. The 14-payload content tests in ADR-450 T2 still stand (read in `hooks/data/mods.ts`: folder pattern, 60-folder cap, 8192-byte cap, `version === 1`, numeric coercion), so this item is only about the file's kind. What I verified:

- `readBounded` (`ruflo-console/hooks/data/files.ts:68`) calls `fs.stat` and refuses a `size` above the cap before it reads. `ReaderFs.stat` is typed `{ mtimeMs?, size? }`: **no file kind and no `lstat`**. The ADR's "lstat if the host exposes it" is therefore not available through the type the console uses.
- `fs.list` entries do carry a `kind` string, and `data/mods.ts:113` already uses it (`entry.kind !== 'file'` for the folder level). Listing the mod folder and checking that the `status.json` entry's `kind` is `'file'` would be a link-free check, **if** the engine reports a symlink as something other than `'file'`. (inference: I did not find the engine's contract in the repo and did not try it.)
- Because `stat` follows a link, a link to a huge file reports the target's size and is refused; a link to a FIFO or a device reports size 0 and goes on to `fs.read`. Whether that blocks is engine behaviour (unverified, as in ADR-450).

**Smallest fix.** In `data/mods.ts`, list each mod folder and require a `kind === 'file'` entry named `status.json` before reading it. About 10 lines plus one fake-fs test. Needs a one-time probe first: a throwaway mod calling `$.fs.list` on a folder holding a symlink and a FIFO, to see what `kind` says.

**Risk.** Low. Failure mode is a mod row disappearing if the engine labels real files oddly, which the test and the probe cover.

**Decision.** Worker, but only after the probe; if the engine reports a link as `'file'`, the fix does not exist at this layer and T2 moves to "engine behaviour, record and close".

## T7. Cross-mod injection by forwarding

**Threat.** One mod's status or command output reaches another mod's prompt context or the model.

**Reproduces on main?** Code-read: the guard is still absent, and the hazard is still absent too. Facts:

- Exactly two sources attach prompt context: `ruflo-agentdb/hooks/register.ts:180` and `ruflo-mods/hooks/route/index.ts:42` (`grep` for `context: [` over `plugins/*/hooks`). Neither names a `-mod/` path.
- Every `.claude-flow/<x>-mod/` string in `plugins/*/hooks` is a writer's own `STATUS_PATH` (35 `status.ts` files) or the console's reader (`data/mods.ts`, `data/files.ts`). The console shows those rows to the model only through `console_state`, which runs every line through `plain(...)`.
- There is no test that would fail if a future mod began reading a neighbour's status file into `context`.

**Smallest fix.** A conformance test (in `ruflo-console/tests/conformance.spec.ts` or the CLI `__tests__/mods` set) that walks `plugins/*/hooks/**/*.ts`, finds files that build `context` for `prompt.submit` or `session.start`, and fails if one also reads a `*-mod/` path other than its own `STATUS_PATH`. About 40 lines. It is a grep-level test and can be defeated by building the path from pieces; it is a tripwire, not a proof.

**Risk.** None for product behaviour. It can only fail a build.

**Decision.** Worker. Do it first: it is the cheapest and it holds the line while the others are decided.

## T10. Policy projection written by A or F

**Threat.** A committed `.claude-flow/policy/claude-code.json` makes ruflo's added rules inert and nothing tells the person.

**Reproduces on main?** Code-read: yes. Facts:

- `policyOpinion` (`ruflo-mods/hooks/guard/policy.ts:166`) returns `{}` for `mode === 'legacy'` or an empty rules list, and `{ wouldBe }` (no verdict) for `observe`. A valid `legacy` file parses (`parseProjection` accepts it).
- The projection is read from the project root (`under(state, PROJECTION_PATH)`, `guard/index.ts:53`), which A controls.
- The status band hides the mode for `none` and `legacy` (`state.ts:128`), so the spoofed case shows nothing; `observe` shows `policy observe` only when `statusLine` is on.
- **The CLI never writes a legacy file.** `projectionOf` returns `null` for legacy (`cli/src/mods/policy-projection.ts:38`) and `syncPolicyProjection` then *deletes* the file. So a projection that exists with `mode: "legacy"` was hand-written by definition.
- A file that is merely deleted, set to `observe`, or given an empty rules list is indistinguishable from a legitimate state. That part cannot be closed without a signature.

**Smallest fix, two layers.**
1. Cheap (worker, ~15 lines + test): in `parseProjection`, reject `mode: "legacy"` so it takes the existing fail-closed path (`state.policy = 'unreadable'`, the call is put to the person), and show `policy <mode>` in the band whenever a projection file exists and the mode is not `enforce`, not only when `statusLine` is on. This closes the one shape that is provably not CLI-written and makes the others visible.
2. Real (human decision): sign the projection with the config signing key, or read it only from user scope. The ADR names `ruflo-config-signing-key`; `cli/src/config/proven-config.ts` and `scripts/sign-proven-config.mjs` are the existing signing code (I read their names, not their contents). User scope conflicts with the CLI writing the projection per project (`syncPolicyProjection(projectRoot, ...)`), so it is a design change, not a patch. (inference on the conflict)

**Risk.** Layer 1: low; a person who hand-wrote a legacy file now gets an ask prompt (a behaviour change they would notice, so say it in the release note). Layer 2: medium, it touches CLI and mod together and the release train (the CLI is bundled, `ruflo-mods` is not).

**Decision.** Layer 1 worker; layer 2 human.

## T11. Status-file spoof

**Threat.** F writes `{"version":1,"guard":true,"blocked":0,"updatedMs":<now>}` for a mod that is not running and the console shows "guard on".

**Reproduces on main?** **Reproduced.** A scratch vitest calling `parseModStatus('foo-mod', '{"version":1,"guard":true,"blocked":0,"updatedMs":1}')` returned `{"name":"foo","guard":true,"calls":null,"blocked":0,"updatedMs":1,"startedMs":null}`: accepted, `guard: true`. Also: all 35 `ruflo-*/hooks/status.ts` writers are identical in shape and none carries a nonce or signature (`grep -L nonce`).

**Smallest fix.** The ADR's per-session nonce cannot work as stated: the console and each mod are separate hook modules and the console has no channel to learn the mod's in-memory nonce except a file, and F can read that file too. Any secret F can read is not a secret. (inference from the architecture; I did not find a shared in-memory channel between mods and did not try one.) A real fix is a signature F cannot forge, which means a key F cannot read, which is outside what a same-user file writer is denied today. What is achievable and honest: label the Mods rows "reported by file, unauthenticated" and show file age (the console already does stale at 6 h), about 10 lines in `views/mods.ts`.

**Risk.** Low for the relabel. A nonce would add 35 plugin edits (every `status.ts`) for no real gain.

**Decision.** Human: accept the residual and relabel, or fund a signing design. I would recommend accepting. No worker until then.

## T14. Confirmation prompt shows attacker-chosen text

**Threat.** In `ask` mode the person answers a prompt whose label embeds model-written text, and nothing says the model asked or what class of action it is.

**Reproduces on main?** Code-read: yes. Facts:

- `confirmRow` (`ruflo-console/hooks/views/common.ts:351`) draws `Confirm: <pending.label>?` and the argv. The one-line forms (`views/pane.ts:194`, the Room banner via `pendingBanner` in `data/room.ts:86`) draw `confirm needed: <label>`. `Pending` carries `label`, `expect`, `note`, `scope`, `view`: no class, no level, no source.
- The class is computed only on the model path (`settlePending` in `model-tools.ts:208`, `kind`); it never reaches `state.pending`.
- The state needed for attribution exists: `state.control.viaModel` is set during `console_run` and cleared in its `finally` (`model-tools.ts:292 and :374`).
- Control characters are already stripped from the label (ADR-450 T3); persuasion text is not and cannot be.

**Smallest fix.** When `viaModel` is true at the time `runner.ask` records the pending slot, store `{ source: 'claude', class: classOf(...) }` on `Pending`; render, before the quoted label, a fixed line such as `Claude asked for a <class> action (needs <level>):` and dim the label. Files: `state.ts` (type), `runner.ts` (set), `model-tools.ts` (pass the class), `views/common.ts`, `views/pane.ts`, `data/room.ts` (render), plus one spec. About 50 lines. Needs a console drive to see the three renderings (confirm row, one-line, Room banner), which is where regressions would show.

**Risk.** Low-medium: pure presentation, but it touches three views and the narrow-terminal clipping (the pane line is clipped to `columns - 40`, so the fixed prefix must not push the action out of sight).

**Decision.** Worker; then drive the console. Second in order because it is the only item that changes what the person sees at the moment of consent.

## T15. Poisoned memory laundering

**Threat.** A prompt-injected Claude writes an instruction with `memory_store` (directly, or through the console's `store` and `hooks remember` entries) and a later session's recall attaches it as "memory".

**Reproduces on main?** Code-read: yes, but with a finding that changes the fix. **ADR-323 typed provenance already exists and is not used by this path:**

- `memory_store` (MCP) takes `provenance_type` in `user_claim | agent_output | system_observation | tool_result | unknown` and `memory_search` takes `provenance_filter` and returns `provenanceType` (`cli/src/mcp-tools/memory-tools.ts:462`, `:628`, `:701`). The CLI has `--provenance` and `--provenance-filter` (`commands/memory.ts:148`, `:496`).
- The agentdb recall reader asks `memory_search` with `{ query, limit }` only (`ruflo-agentdb/hooks/tools.ts:19`), so no filter. The console's `memoryStore` (`hooks/ops.ts:109`) passes no `--provenance`, so its entries are `unknown`. `vec-hooks-remember` writes to ruvector, which has no provenance field I found.
- The three other readers (`agentdb_hierarchical-recall`, `agentdb_pattern-search`, `hooks_recall`) have no filter parameter I could find in this repo (not checked beyond the tool list).
- The ADR said "grep found no provenance marker in agentdb hooks"; that is true of the hooks and misses the underlying tool.

**Smallest fix.**
1. Console `memoryStore` adds `--provenance agent_output` when `viaModel` is true (else `user_claim`). Cheap, ~5 lines + test.
2. agentdb recall passes `provenance_filter` for the `memory_search` reader. ~10 lines + test.
3. Optionally (inference, not checked) the agentdb `tool.call` guard rewrites `memory_store` calls from the model to carry `provenance_type: 'agent_output'`, if a `tool.call` hook may change the input; I did not verify that it can.

**The catch (human decision).** The filter is an include list. The model storing straight through the MCP tool, with no provenance, writes `unknown`, so excluding model-written memory means excluding `unknown`, and that drops every legacy memory ever stored. The choices are: (a) recall `user_claim`, `system_observation`, `tool_result` only (safe, loses all legacy memory until the person promotes or re-tags it); (b) also allow `unknown` (keeps legacy, leaves the model's own direct writes as a hole); (c) filter only what the console and guard tagged `agent_output` (a partial close). That choice is the person's, not a worker's. Also note `hooks_recall`/ruvector has no provenance at all.

**Risk.** Medium: recall quality changes visibly under (a), and the live recall runs in `agentdb-recall-live-2026-10.md` would need repeating.

**Decision.** Worker for steps 1-2 behind a default-off option; human for the `unknown` policy.

## Order and dependencies

1. **T7** conformance test. No dependency, no risk.
2. **T14** attribution in the confirm row. Independent of the rest; drive the console.
3. **T15** steps 1-2 plus the `unknown` decision. Independent of T14; both touch `ruflo-console` (T15 only `ops.ts`), so they do not collide. Repeat the live recall run.
4. **T10** layer 1 (reject legacy, show mode). Touches `ruflo-mods` only; run `__tests__/mods` (the harness that CI runs). Layer 2 waits on a human.
5. **T2** after the engine probe.
6. **T11** relabel or accept, by a human; do not spend worker time on a nonce.

Items 1-4 can run in parallel in separate worktrees: no two share a file. The shared-file caveat: T14 and T11's relabel both edit console views (`common.ts`/`pane.ts` vs `mods.ts`), so run those two in sequence if the same worker owns them.

## What was not done

- No engine probe for T2's link behaviour; no live-console run for any item. The only runs were two scratch vitest cases (T11 parse: accepted as shown; a T13 fuzzy probe that returned `false`, which proves nothing about T13 and is not used here).
- T14's attribution path and T15's step 3 were read, not run.
- The regression-test counts in ADR-450 section 7 were not re-run.
