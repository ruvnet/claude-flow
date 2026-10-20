# Security SOTA Report — 2026-09-16

TL;DR: Tonight's `security` deep-dive found that PR #3291 (merged 2026-09-15, last
night's own dream-cycle candidate) closed a Sybil-vote attack on `hive-mind_consensus`
by binding `join`/`leave`/`vote` to a capability token minted by `hive-mind_init` —
but left **seven sibling MCP tools in the same file mutating the exact same hive state
with no such gate**: `hive-mind_spawn` (which pushes attacker-chosen agent ids straight
into `state.workers`, the same roster `vote` treats as legitimate — letting an
unauthenticated caller mint its own "workers" and then vote as them, bypassing #3291
entirely via a sibling tool rather than defeating it), `hive-mind_consensus`'s `propose`
action, `hive-mind_broadcast`, `hive-mind_shutdown`, `hive-mind_memory`'s `set`/`delete`
actions, and `hive-mind_optimize-memory`. All seven now call the existing
`requireHiveToken()` gate, fail-closed, with zero state change on denial. **Round-1
review (ruvnet) correctly REJECTed the first version of this fix**: gating sibling
tools behind `requireHiveToken` doesn't "establish authorization" while the
credential-issuance point, `hive-mind_init` itself, remained reachable by any caller —
either to mint the very first token, or to have the current one echoed back on
re-init. `hive-mind_init` now also requires its own same-machine `bootstrapSecret`
(a lazily-created 0600 file, the same same-machine trust boundary
`getHiveTokenForCli()` already relied on) for both first-time bootstrap and re-init,
and no longer echoes `hiveToken` in its response at all. Five research roles ran in
parallel tonight; three converged independently on the sibling-tool gap before
implementation began; the credential-issuance gap was caught by human review, not by
this session's own research or adversarial-critique passes — a real miss disclosed
here, not papered over.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| MCP spec's 2026-07-28 revision is the largest authorization hardening pass to date: Dynamic Client Registration deprecated for Client ID Metadata Documents, `iss` validation per RFC 9207, token-passthrough prohibited | [blog.modelcontextprotocol.io](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/) | A |
| Tool poisoning (malicious instructions embedded in tool metadata/descriptions) is identified as the most prevalent, highest-impact client-side MCP vulnerability class | arXiv:2603.22489 / MDPI 2624-800X/6/3/84 | A |
| "Authorization Propagation in Multi-Agent AI Systems" names exactly the failure mode Ruflo's own `mcp-caller-identity.ts` was built to close: authorization state persisting across calls without re-verifying *who* is presenting it | arXiv:2605.05440 | A |
| OWASP Top 10 for Agentic Applications 2026 (published 2025-12-09) categorizes unauthenticated inter-agent messages/shared-state mutation as **ASI07 — Insecure Inter-Agent Communication**, distinct from ASI03 (credential misuse) | OWASP GenAI Security Project | A |
| A2A protocol's own open design process (GitHub discussion #199, SEP #1404, RFC #1716) is actively proposing Ed25519 capability tokens scoped to skill invocations — directionally identical to Ruflo's `hiveToken` approach, but pre-production | github.com/a2aproject/A2A | B/C |
| LangGraph had 3 CVEs disclosed 2026-03-27 (CVE-2026-34070, CVE-2025-68664, CVE-2025-67644); no framework-native least-privilege tool gate exists | CSA research note, cross-checked | B |

## Ruflo Current Capability

`requireHiveToken()` (`hive-mind-tools.ts:177-190`) is a constant-time, fail-closed
bearer-capability check against a 32-byte token minted once by `hive-mind_init` and
never exposed via `hive-mind_status`. Before tonight it gated only `join`/`leave`/
`vote` (#3291). **Correction from round-1 review**: this session's initial assessment
that `hive-mind_init`'s lack of a gate was "an already-considered, already-decided
boundary" was wrong — #3291's disclosed scope note only covered *whether* to solve
bootstrap trust at all, not a considered decision that leaving it fully open was safe
once a whole gate matrix was being built around the token it issues. `hive-mind_init`
now requires its own `bootstrapSecret` (`getOrCreateBootstrapSecret()`), a lazily
created, 0600, same-machine-only file — the identical trust boundary
`getHiveTokenForCli()` already relied on — for both first-time bootstrap and re-init,
and no longer returns `hiveToken` in its response at all. `.harness/mcp-policy.json`'s
`allowShell`/`allowNetwork`/`allowFileWrite: false` fields are, by the policy's own
rationale comment, scoped to the native-Claude-Code-tool layer, not this MCP server's
tool surface — independently confirmed real by two research roles tonight
(`terminal_execute` calls raw `execSync` with no policy enforcement, a second strong
candidate, see Recommended Next Steps).

## Competitor Comparison

| Framework | Tool-authority enforcement | Agent identity/auth | MCP security posture | Grade |
|---|---|---|---|---|
| LangGraph | No built-in least-privilege gate; 3 CVEs disclosed 2026-03-27 | No signed per-agent identity | Inherits upstream MCP risk | B |
| Microsoft Agent Framework (AutoGen successor) | Delegated to Entra Agent ID (OAuth2/FIC) — real, but platform-layer not framework-native | Real signed tokens exist, not framework-enforced for shared state | Case-study only | B/C |
| CrewAI | Explicitly permissive-by-default (open issue #5888, unresolved) | No capability-token concept | None found | A (no built-in enforcement, primary) |
| OpenAI Agents SDK | Per-tool-call guardrails exist; handoffs bypass them (single-source) | No portable signed identity between agents | N/A | C |
| MCP protocol itself | N/A framework-wide; real CVEs (MCPoison, CurXecute, mcp-remote CVSS 9.6) | 2026-07-28 spec requires OAuth 2.1 + audience-bound tokens | Improving, reactive | A |

Synthesis: none of the four mainstream frameworks ship Ruflo's specific combination —
signed capability tokens bound into shared multi-agent coordination state — as a native
feature. The closest analog is the A2A protocol's own in-discussion Ed25519
capability-token proposal, confirming this is a recognized industry gap, not one Ruflo
invented alone, and that Ruflo's `hiveToken` mechanism from #3291 is ahead of what any
shipped competitor does — the gap tonight closes is that the mechanism wasn't applied
consistently to every tool that needed it.

## Hypothesis

> Given the hive-mind MCP tools, where `hive-mind_join`/`leave`/`vote` already require
> a `hiveToken` minted by `hive-mind_init` (#3291) to prevent Sybil-vote manipulation,
> when `hive-mind_spawn`, `hive-mind_consensus`'s `propose` action, `hive-mind_broadcast`,
> `hive-mind_shutdown`, `hive-mind_memory`'s `set`/`delete` actions, and
> `hive-mind_optimize-memory` are given the same `requireHiveToken` gate, AND
> `hive-mind_init` itself is gated behind a same-machine `bootstrapSecret` for both
> first-time bootstrap and re-init, then an unauthenticated caller (one with no
> filesystem access to the project directory, the same "unauthenticated" boundary
> `getHiveTokenForCli()` already relies on) should no longer be able to mint voting
> workers via spawn, inject unauthenticated consensus proposals, inject spoofed
> broadcast messages, terminate a running hive, tamper with/erase shared-memory
> entries, or bootstrap/hijack a hive's credential-issuance point at all — relative to
> today's baseline where all eight accept any caller with no proof of standing —
> subject to: (1) the CLI's own hive-mind init/spawn/broadcast/shutdown/memory/
> optimize-memory subcommands pass the token/secret via the existing
> `getHiveTokenForCli()`/new `getHiveBootstrapSecretForCli()` same-machine helpers so
> legitimate local usage is unaffected; (2) existing hive-mind test suites remain
> green, extended with fresh-child-process CLI-command-level tests (not only direct
> handler calls); (3) zero added LLM/API cost, fully deterministic coverage.

Frozen before round-1 evaluation began; extended after round-1 human review (not
after this session's own evaluation) to add the `bootstrapSecret` clause and the
`hive-mind_optimize-memory` gate — both real, disclosed scope corrections in response
to a REJECT, not a post-hoc relaxation to fit a result. The `hive-mind_memory`
set/delete clause was likewise added mid-round-1 after an independent adversarial
critique found it as a missed-scope gap.

## Benchmarks

No benchmark corpus applies — this is a deterministic authentication-gate fix, not a
retrieval/ranking/routing candidate. Evidence is a discriminating Vitest regression
suite plus stash-isolated baseline/candidate comparison, the same evidence shape every
accepted security-surface candidate has used since 2026-08-18.

## Evaluation

**evaluated: accepted (round 2, post-REJECT).** Real evaluator: Vitest 4.1.8,
deterministic, zero LLM calls, $0 cost. Test file `hive-mind-spawn-broadcast-shutdown-
auth.test.ts` grew from 12 to 28 tests across round 1→2 (spawn/propose/broadcast/
shutdown/memory-set/memory-delete gates, `hive-mind_optimize-memory`'s gate, a
dedicated `bootstrapSecret` block covering fresh-bootstrap denial, forged-secret
denial, non-leakage of the real secret on denial, and re-init denial/acceptance, plus
two real child-process tests that spawn `node bin/cli.js hive-mind init`/`spawn` end
to end — not direct handler calls). 3 pre-existing `propose` calls in
`hive-mind-consensus-sybil-vote.test.ts`, plus one pre-existing `hive-mind_init` call
in `mcp-tools-deep.test.ts`, updated to pass the new required fields (diffed — no
assertion changed, purely additive).

Stash-isolated baseline (source reverted, tests kept): the discriminating subset of
tests fails exactly for each of the seven newly-gated tools plus every
`bootstrapSecret` scenario; "succeeds with correct token/secret" tests pass on both
sides, as expected — old behavior always let the call through. Candidate: all 28 new
+ 6 existing hive-mind-consensus + 3 mcp-tools-deep hive-mind tests pass (37 total).

Two sibling packages (`@claude-flow/swarm`, `@claude-flow/neural`) were unbuilt in
this session's checkout — building them (a one-time environment fix, not a candidate
change, same class documented by multiple prior nights) let `tsc --noEmit` run fully
clean (0 errors, down from 22 pre-existing/unrelated in round 1) and let real
`bin/cli.js` child-process tests run at all. Full `@claude-flow/cli` suite (251 files,
~3432 tests once unbuilt-sibling-gated tests could run): 18 failures remain, all in
`@claude-flow/mcp`-package-resolution/http-server-startup-timing/unrelated areas,
zero referencing hive-mind — confirmed via the same controlled-comparison discipline
(failing-test-name sets, not raw counts, given this suite's documented run-to-run
timing flake).

## Darwin Results

Skipped — confirmed via `npx ruvector harness darwin --help`: the real interface
evolves continuous/categorical genome parameters (routing/topology/prompt/memory/
tool/tier/context/coordination) against an LLM-scored bench corpus. A binary
authentication gate (token present-and-valid, or not) has no fitness gradient for
Darwin to search over — same skip class as nearly every accepted night since 2026-08-18.

## SOTA Proof & Witness

No signed `@metaharness/flywheel` bundle — the schema targets LLM-task-corpus-evaluated
retrieval-policy candidates; this is a deterministic code-correctness/authentication
fix, consistent with every accepted candidate since 2026-08-18. Evidence retained as:
28 new tests + 4 adjusted tests + issue + this gist + PR #3339's round-1 human review
(REJECT, correctly identifying the credential-issuance gap and the missed
`hive-mind_optimize-memory` sibling) + a round-1 independent adversarial critique
(found and this session closed the `hive-mind_memory` gap the first patch missed).

**Round-1 witness was not independently reproducible** — round-1 review correctly
flagged that the receipt witness must reproduce from a preserved canonical preimage,
not an ephemeral scratch file. Verified directly: recomputing round 1's documented
procedure against the committed round-1 file did *not* reproduce the recorded round-1
witness (the SHA-256 had been computed against a `/tmp` scratch copy that no longer
exists byte-for-byte anywhere in the repository). The table below is regenerated from
this exact final file, with reproducibility verified before commit — see the script
below the table, run against this file itself, not a copy.

Witness table:

| Field | Value |
|---|---|
| Session commit | `a65bdf683a73dcc1f20d455658daab1cca07306b` |
| Gist SHA-256 (pre-witness content) | `9c69e5fab39d81b71e652e80c47dccfe72c709d8a1c030df1744332505418439` |
| Witness stamp | `4c373db1631c56626dd77caedaeb1e0ed5ca9903fb31ad0c1c1eced59d9fb872` |

Verifier procedure (self-contained, no external state): take this exact file as
committed, replace the three `` `...` `` values in the table above with the literal
text `PENDING` (keeping every other byte, including this paragraph and everything
below it, unchanged), SHA-256 the result → must equal the Gist SHA-256 above;
concatenate that hash with the Session commit value and SHA-256 again → must equal
the Witness stamp above. This was verified by actually running that substitution
against this committed file (not a draft) before the values below were filled in.

## Recommended Next Steps

1. **`terminal_execute` shells out via raw `execSync` with zero policy enforcement**
   (`terminal-tools.ts:192`), contradicting `.harness/mcp-policy.json`'s own claim that
   shell/network/file-write are "not in this server's tool surface." Independently
   found by two research roles tonight (deep researcher + architecture reviewer) as
   the second-highest-scored candidate — RCE-relevant, small patch, deferred only
   because tonight's finding was a more direct, more severe continuation of last
   night's own accepted work. Recommend as tomorrow's security-surface candidate if
   the rotation returns here, or sooner.
2. **Consensus "strategy-discard" bug**: `raft.ts:232-234` and `byzantine.ts:248-250`
   silently drop a vote arriving after a proposal leaves `'pending'` (return before
   recording, no error) — `gossip.ts` behaves differently (records then ignores).
   Timing-inducible one-sided vote suppression; not implemented tonight (swarm scan,
   secondary surface).
3. **Unvalidated embedding/verdict feeding EWC Fisher consolidation**
   (`intelligence.ts:1041`, `ewc-consolidation.ts:211-233`): any MCP caller can
   self-report `success: true` with crafted trajectory content to skew which patterns
   EWC protects from forgetting — no independent verification of the caller-supplied
   verdict. Intelligence scan finding, security-adjacent, out of scope for the
   hive-mind-specific fix tonight; a real memory/benchmark-poisoning-shaped gap for a
   future `intelligence` or `security` night.
4. **`bootstrapSecret`'s file-based mechanism is a same-machine trust boundary, not a
   cross-transport-safe credential** — adequate for the stdio/local-CLI threat model
   this fix targets (matching `getHiveTokenForCli()`'s existing precedent), but a
   future night wiring hive-mind auth through the separate HTTP/SSE MCP transport
   (`startHttpServer()`, `@claude-flow/mcp`) or through ADR-377's Ed25519
   caller-identity tokens should reconsider whether a filesystem-cookie bootstrap is
   still the right primitive once the caller isn't guaranteed to share a filesystem
   with the operator.
