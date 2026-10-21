# Security SOTA Report — 2026-10-21

**TL;DR**: Tonight's rotation (`DEEP=security`, `SCAN=intelligence,swarm`, slot 1) follows last night's off-cycle security override (#4312/#4313, CWE-22 anchor fix), which disclosed a broader known limitation: a symlink *inside* the project root resolving *outside* it still escaped `hooks_codemod`'s containment check (CWE-59), since the check never realpath'd the candidate. Tonight closes that gap with `realCanonical()`, mirroring `@claude-flow/security`'s own `path-validator.ts` canonicalization. Independent adversarial review confirmed the fix, and surfaced one non-blocking caveat (a TOCTOU window) that deep research below shows is unsolved industry-wide, not Ruflo-specific.

## What's New in 2026

| Finding | Source | Confidence |
|---|---|---|
| Anthropic's own official Filesystem MCP server had a symlink containment bypass: it called `fs.realpath()` but flawed catch-block error handling let the check be skipped, letting an agent escape the allowed root via a symlink planted inside it. Fixed in 0.6.4 (2025.7.01). | [NVD CVE-2025-53109](https://nvd.nist.gov/vuln/detail/CVE-2025-53109), cross-checked [Wiz](https://www.wiz.io/vulnerability-database/cve/cve-2025-53109), [Tenable](https://www.tenable.com/cve/CVE-2025-53109) | A |
| Companion finding, same server: a naive directory-prefix string check (no boundary char) let a sibling dir pass containment — the exact CWE-22 shape fixed here last night. | [Cymulate write-up](https://cymulate.com/blog/cve-2025-53109-53110-escaperoute-anthropic/) | C |
| Chrome DevTools MCP's `validatePath()` used `path.resolve()` with no symlink resolution (0.24.0–1.0.x, fixed 1.1.0). | [SentinelOne CVE-2026-53766](https://www.sentinelone.com/vulnerability-database/cve-2026-53766/) | C |
| DesktopCommanderMCP's `isPathAllowed` never resolves symlinks (CVE-2025-11489, unpatched through 0.2.13) — vendor's own stated position is that the path restriction is an LLM guardrail, not a security boundary, and recommends container isolation instead. | [SentinelOne](https://www.sentinelone.com/vulnerability-database/cve-2025-11489/) | B |
| fast-filesystem-mcp 3.4.0: same no-symlink-resolution class of bug, CVSS 7.5 (CVE-2025-67364). | [ReleaseAlert](https://releasealert.dev/cve/CVE-2025-67364) | C |
| No mainstream MCP/agent filesystem tool (incl. Anthropic's own) has been found to implement `openat2`/`O_NOFOLLOW`/fd-pinning for TOCTOU-safety — every disclosed fix is realpath-based canonicalize-then-compare, the same class as tonight's fix, which still has the TOCTOU gap our own adversarial critic flagged. | Direct search across the 5 disclosures above | B |

Not a "None across the board" night — the most comparable system in existence (Anthropic's own reference filesystem MCP server) shipped and fixed this exact CWE-59 bug class within the last ~15 months, strong external validation this was a real, non-theoretical gap.

## Ruflo Current Capability

`hooks_codemod` (`v3/@claude-flow/cli/src/mcp-tools/hooks-tools.ts:5380`) is the Tier-1 ($0, no-LLM) codemod path (ADR-143) that CLAUDE.md tells every agent to call automatically on `[CODEMOD_AVAILABLE]`. After tonight: both the CWE-22 (2026-10-20) and CWE-59 (tonight) containment bugs are closed via two layered checks — an anchored lexical prefix check, then a realpath-based symlink-safe check (`realCanonical()`), applied symmetrically to candidate and root, for all three input forms (`file`, `files[]`, `glob`).

## Competitor Comparison

| System | Symlink-safe? | TOCTOU-safe? | Mechanism | Confidence |
|---|---|---|---|---|
| **MCP `server-filesystem`** (official reference server) | **Disputed — see below** | No | `isPathWithinAllowedDirectories()` read directly from `main` today: `path.resolve(path.normalize(p))` + string `startsWith()`, **no realpath on the candidate** — only the allowed-dir *roots* are realpath'd, at startup. | A (direct source read) |
| Chrome DevTools MCP | Fixed in 1.1.0 | No | realpath-based (post-fix), CVE-2026-53766 | C |
| DesktopCommanderMCP | No (unpatched through 0.2.13) | No | lexical string compare only; vendor's stated position is this is an LLM guardrail, not a security boundary — recommends container isolation instead of fixing | B |
| fast-filesystem-mcp | No (as of 3.4.0) | No | `path.resolve()` only, CVE-2025-67364 | C |
| LangChain file-search tooling | Fixed 1.3.9+ (was no) | No | GHSA-gr75-jv2w-4656: didn't check the glob match's resolved target; fix adds realpath + re-verify | B |
| AutoGen / CrewAI | N/A — delegated | N/A — delegated | Both push code execution into a Docker container (bind mounts / isolated container) rather than doing their own path-containment check | C (docs only) |
| gVisor (contrast: real sandbox) | Yes, architecturally | Yes | No userspace path-string check at all — the gofer (a trusted proxy outside the sandbox) or directfs `SCM_RIGHTS` fd-handoff with `pivot_root` means the untrusted process never resolves an arbitrary path against the real FS itself | A |
| runc/Docker (contrast: the real TOCTOU fix) | Yes | Yes | Kernel `openat2(RESOLVE_IN_ROOT / RESOLVE_NO_SYMLINKS)` (cites CVE-2019-5736) / Go `os.Root` (Docker's CVE-2026-42306 fix) — fd-based, race-free, kernel-enforced | A |
| **Ruflo `hooks_codemod` (tonight)** | **Yes** | No (disclosed, non-blocking) | `realCanonical()` realpath + ancestor-walk, symmetric candidate/root | A (this session's own repro + independent critic) |

**A genuine discrepancy surfaced between tonight's two research passes, disclosed rather than resolved by fiat**: the Deep Researcher found NVD CVE-2025-53109 (Anthropic's reference server's realpath-based check defeated by broken catch-block error handling, fixed in 0.6.4, grade A). The Competitor Analyst, reading the server's `main`-branch source directly today, found its live `isPathWithinAllowedDirectories()` does no realpath on the candidate at all. Both are well-sourced; they may describe different functions, a post-fix regression, or a mischaracterization. Flagged as a bounded follow-up, not asserted either way.

Both passes agree Ruflo's fix is at least at parity with, possibly ahead of, the most comparable reference implementation, and shares its unsolved TOCTOU limitation. The honest framing is narrower than "needs a sandbox": runc/Docker closed this exact race via a kernel-assisted fd-based primitive (`openat2`, Go's `os.Root`) that Node's `fs` doesn't expose — plain-JS check-then-reopen-by-path can't close the gap without a native addon exposing that, or a real sandbox layer.

## Hypothesis (frozen before evaluation)

> Given `hooks_codemod`'s `resolveTargets()` containment check, when a caller supplies a path (via `file`, `files[]`, or `glob`) that is lexically inside the project root but whose real (symlink-resolved) location is outside it, then the current anchored-but-non-realpath'd check incorrectly treats the target as contained and the tool reads/writes it outside the root — then adding a realpath-based canonicalization of both the candidate and the root (`realCanonical()`, mirroring `@claude-flow/security/path-validator.ts`'s `canonicalize()`), checked in addition to the existing lexical check, should reject such targets with "path escapes project root" and perform zero I/O, while every legitimate in-root path (including one reached through a symlink that itself resolves back inside the root) continues to work identically, subject to: (1) zero regression to the 2026-10-20 CWE-22 tests; (2) zero regression to codemod-engine/corpus/routing/validate-input/mcp-tools-deep suites; (3) deterministic, $0, zero-LLM Vitest evaluation.

## Benchmarks / Evaluation

Real evaluator: Vitest 4.1.8, `@claude-flow/cli` package, after `pnpm install && pnpm -r build` across the full `v3` workspace (all 24 packages' `dist/` were missing — a fresh checkout). New file `__tests__/hooks-codemod-symlink-containment.test.ts`, 5 tests: 3 discriminating (real temp-dir + real `symlinkSync` I/O, exercised via `file`/`files[]`/`glob`), 2 non-discriminating controls. Stash-isolated baseline: **3/3 escape tests fail** (`success: true`, file genuinely read+written outside root — live exploit, reproduced for real). Candidate: **9/9 pass** (5 new + 4 pre-existing CWE-22 tests, unmodified). Independently re-reproduced from scratch by an adversarial-critic subagent (own stash/pop cycle): same result.

Related suites (`codemod-corpus/engine/routing`, `validate-input-agent-spawn/env/path-2352`, `mcp-tools-deep`, both containment files): **234/234 both ways**, reproduced twice. `tsc --noEmit`: clean (0 errors) both ways — a fresh, fully-built workspace, not the usual pre-existing-error baseline.

## Darwin Results

Skipped — binary path-containment correctness fix (add a second, symlink-safe containment check), no continuous/categorical parameter for Darwin to search over. Same skip class as nearly every accepted security fix since 2026-08-18 (10-20, 10-16, 10-11, 09-21, etc.).

## Reward Hack Check

No standalone reward-hack CLI reachable this session for this candidate shape. Manual checklist, independently re-verified by the adversarial critic from a fresh context: no test weakened, no gold/benchmark data touched, no cherry-picking, no evaluator exploitation, $0 cost (`cost: 0, tier: 1`), no seed manipulation, real fs I/O throughout (no mocks in either test file).

## Security Review

This finding *is* the security fix. Independent adversarial critique (separate subagent, no authoring context): **CONFIRMED-WITH-CAVEATS, no blocking issues.** The critic reproduced the stash-isolated comparison from scratch, confirmed the diff is scoped to one file (~55 changed lines) plus one test file, and confirmed the glob-branch reordering is a pure perf optimization with no security-semantic change. It disclosed one **non-blocking** caveat: a TOCTOU window remains between the containment check and the later read/write calls (both reopen by path) — requires local symlink-swap race capability to exploit. Disclosed in-source as a KNOWN LIMITATION comment, matching this repo's convention. Research above shows this limitation is industry-wide and unsolved, not specific to this fix.

## Scan Findings: swarm

`v3/@claude-flow/swarm/src/consensus/byzantine.ts:281-306` and `gossip.ts:275-314` — both `awaitConsensus()` implementations busy-poll (`setInterval(..., 10)` / `setInterval(..., 50)`) even though both classes already emit `'consensus.achieved'` synchronously at the exact state transition. This is the identical busy-poll bug class already fixed three times on this surface (`UnifiedSwarmCoordinator` #3378, `MessageBus` #3563, `RaftConsensus` #4215 on 2026-10-15) — `raft.ts` sits in the same `consensus/` directory and shows the now-correct pattern (event listener + `setMaxListeners(0)`), but `byzantine.ts`/`gossip.ts` were not touched. Not dead scaffolding: both are real, reachable via `ConsensusEngine`'s `algorithm` config with real multi-host transport (ADR-095 G2), so this runs in production whenever either algorithm is selected. Left unimplemented tonight (security DEEP took priority) — concrete, ready-to-implement candidate for a future `swarm` night: mirror `raft.ts`'s exact fix in both files.

## Scan Findings: intelligence

`v3/@claude-flow/neural/src/reasoning-bank.ts:916-980` — the standalone `ReasoningBank`'s entire "AgentDB integration" (`storeInAgentDB()`/`searchWithAgentDB()`/`deleteFromAgentDB()`) is unconditionally dead against the real `agentdb` package: its installed public API (`AgentDB.d.ts`) exposes only `initialize()`/`getController(name)`/`close()`, no `.store()`/`.search()`/`.delete()`, and `getController()` only accepts `'memory'|'reflexion'|'skills'|'causal'|'causalGraph'` — `searchWithAgentDB()`'s `getController('hnsw')` call throws every time, silently swallowed. `retrieve()` still falls back to correct brute-force search, but `hnswRetrievalCount` can never increment (permanently misleading at 0) and `enableAgentDB` defaults to `true`, so every instance pays the cost of opening a real SQLite-backed AgentDB for zero functional benefit. Live, not orphaned (`createReasoningBank()`/`NeuralSystem`, consumed from `neural-package-bridge.ts`/`ruvector/index.ts`). Distinct from the `@claude-flow/hooks/src/reasoningbank/` implementation fixed in #4270/#4271 — two parallel `ReasoningBank`s exist, only one has gotten HNSW-correctness attention. Concrete candidate for a future `intelligence` night.

## Competitors Reviewed

Anthropic Filesystem MCP (reference server), Chrome DevTools MCP, DesktopCommanderMCP, fast-filesystem-mcp — see Competitor Comparison table above. (LangGraph/AutoGen/CrewAI/OpenAI Agents SDK were the prior night's comparison set for a performance-routing finding; tonight's finding is filesystem-tool-specific, so the more precisely comparable set is other MCP/agent filesystem servers, which is what was researched.)

## Gist

Gist publishing unavailable this session (no `gh` CLI binary — `GH_TOKEN` invalid — and no MCP gist-creation tool found; same standing environment gap first disclosed 2026-09-30 and recurring since). This file (`docs/dream-cycle/dream-gist-2026-10-21.md`) is the durable local copy; the full report is also embedded in tonight's issue body per that established fallback.

## Witness

```
Session commit:   a00b2855e5b8204aec61133d5fbc53060e1726b5
Report SHA-256:   a702ab8d5b6d293d0c839ea6c93bdd779ab7aac6a699ea204c5f66d71fc9432e
Witness stamp:    2b5bf72f4f89e8ed501a78af3d9155599eb61b868c9b3e6bdeea4487ffe8b257
```
Verifier: fetch this file from `dream/2026-10-21-security`, strip the Witness block back to the three `PENDING` placeholders above, SHA-256 the file, concatenate that hash with the session commit, SHA-256 again — must equal the witness stamp.

## Recommended Next Steps

1. **TOCTOU-harden `hooks_codemod`** (this session's own disclosed caveat): switch the later read/write loop to open-once-then-operate-on-the-fd, ideally via a native addon exposing Linux `openat2(RESOLVE_IN_ROOT | RESOLVE_NO_SYMLINKS)` (the same primitive runc/Docker use, per tonight's research — Node's `fs` doesn't expose it directly) instead of check-then-reopen-by-path. No comparable mainstream MCP/agent tool has shipped this yet — doing so would make Ruflo *ahead* of the field, not just at parity.
1a. **Reconcile the Anthropic reference-server discrepancy** found tonight (see Competitor Comparison): re-read `modelcontextprotocol/servers`' `path-validation.ts` against CVE-2025-53109's actual patch commit to determine whether the realpath check the CVE describes still exists, was regressed, or was in a different function than `isPathWithinAllowedDirectories()`.
2. **Mirror `RaftConsensus.awaitConsensus()`'s event-driven fix into `byzantine.ts` and `gossip.ts`** (tonight's swarm scan) — identical busy-poll bug class, third+fourth instance on this exact surface, concrete file:line targets given above.
3. **Audit and fix the identical lexical-containment pattern repeated in at least 5 other locations** across this codebase, found across two consecutive nights: `v3/@claude-flow/mcp/src/resource-registry.ts:513-523` and `v3/@claude-flow/shared/src/security/input-validation.ts:119-155` (flagged 2026-10-20, exploitability unconfirmed); `v3/@claude-flow/cli/src/ruvector/coverage-router.ts:559`, `v3/@claude-flow/cli/src/commands/daemon.ts:419`, and `v3/@claude-flow/cli/src/memory/memory-bridge.ts:181` (found tonight — all three use an unanchored, non-realpath'd `startsWith(cwd)`/`startsWith(root)` check; severity varies — `memory-bridge.ts` fails safe to a default path on bypass, `daemon.ts` has additional metacharacter checks, `coverage-router.ts` only reads well-known coverage filenames — but all share the same defect class and deserve a systematic pass rather than one-off fixes). Consider centralizing on `@claude-flow/security`'s `PathValidator`/`isWithinPrefix` rather than re-deriving containment logic per call site.
4. **Correction to the ledger's 2026-10-11 note**: direct NVD lookup (tonight) confirms `CVE-2026-25725` is a real, published record — but it documents an unrelated Claude Code bubblewrap-sandbox/hooks-persistence bug (GHSA-ff64-7w26-62rf), not a path-validation finding. The 2026-10-16 note's "does not resolve" was itself imprecise; "resolves to the wrong CVE" is the accurate correction. Do not re-cite this ID for path-validation work.
