# Ruflo v3.8.0+ Improvement Roadmap

This document surveys the highest-leverage improvements to the Ruflo platform beyond graph intelligence integration (ADR-130). It was assembled from open issues, codebase analysis, the SOTA comparator benchmark drive (PR #2124 / gist `298f8c668c8859b369f91734a0e9cbbe`), and audit of plugin health and deferred ADR backlog. Items are ranked by impact-per-effort.

---

## Summary

Ruflo wins on breadth and coordination sophistication, but three structural gaps reduce that advantage in practice: integration tests that cover known production bugs remain skipped (issue #1872), the hive-mind MCP surface was wired to a real ConsensusEngine only in 3.7.0-alpha.45 and has not been validated under production load, and the SOTA benchmark suite is missing the real-model and streaming dimensions that competitors will cite. On the ecosystem side, the `ruflo` branding in CLI output is still leaking `claude-flow` strings, and the skill synthesis loop (ADR-113/R-3) — arguably the highest-leverage capability gap vs. Hermes-class agents — has no implementation ADR. The ten items below address these gaps in priority order.

---

## Item 1 — Fix and re-enable the four skipped integration tests (#1872)

**Pitch**: Four CI-skipped tests in `v3/__tests__/integration/` cover real production bugs: `HybridBackend` persistence across reinit, `SwarmCoordinator` error propagation, `scaleAgents` direction, and workflow resume after interruption. These are not flaky tests — they are deterministic assertions against behavior users depend on. Every release shipped since they were skipped has carried these bugs silently.

**Effort**: M (each bug is independent; estimated 1–2 days per bug; SwarmCoordinator error handling is the most complex)

**Payoff dimension**: reliability / DX

**Specific files**:
- `v3/__tests__/integration/memory-integration.test.ts` — HybridBackend reopen
- `v3/__tests__/integration/swarm-integration.test.ts` — error propagation + scale-down direction
- `v3/__tests__/integration/workflow-integration.test.ts` — workflow resume after interrupt

---

## Item 2 — Witness manifest drift: fix `missing=95 drift=2` (#2047, severity:high)

**Pitch**: The scheduled verification run reports that 95 artifacts referenced in the signed witness manifest are absent from the working tree. The Ed25519 signature is valid — the manifest itself has not been tampered with — but downstream tooling and enterprise users who run `ruflo verify` in CI will see a failing check on every source-only checkout. This erodes the trust story that ADR-103 was meant to establish.

**Root cause** (from issue analysis): verification runs against a source-only checkout without `npm run build`. The witness manifest references dist-layer artifacts. The fix is either: (a) rebuild before verify in the scheduled check, or (b) add a `--source-mode` flag to `verify.mjs` that skips dist-artifact checks and only validates source-layer markers. Option (a) is lower risk.

**Effort**: S (the fix is a CI workflow change + one verify.mjs flag; the 2-drift entries need separate investigation)

**Payoff dimension**: security / trust / enterprise adoption

---

## Item 3 — Real-model validation for SOTA comparator (M5, issue #2125)

**Pitch**: The SOTA benchmark drive covers 9 of 10 milestones. M5 ("real-model integration quality") is blocked on a stale API key. Without M5, the comparator cannot measure response quality, hallucination rate, or tool-call accuracy against LangGraph/AutoGen/CrewAI in real-LLM mode — the dimension competitors will emphasize most. The PR #2124 results (ruflo wins 3 of 5 on coordination throughput, memory search latency, safety gate coverage, security posture, and plugin ecosystem breadth) are all structure-and-plumbing metrics. M5 is where a skeptical reader will look.

**What is needed**: a non-expiring test key in CI secrets, or a model-stub harness that records/replays Anthropic API responses for reproducible benchmark runs. The second approach (golden-response replay) is safer for CI and avoids per-run cost.

**Effort**: S (key rotation) to M (golden-response replay harness)

**Payoff dimension**: ecosystem reputation / benchmark credibility

---

## Item 4 — `CLAUDE_FLOW_DB_PATH` env var and `--path` flag on memory sub-commands (#2105)

**Pitch**: Memory sub-commands hard-code the SQLite DB path to `~/.swarm/memory.db` and ignore `memory init -p <path>`. On Windows, this forces the DB onto the system drive. On multi-project setups, all projects share one memory DB. The fix is a three-level path precedence: `--path` flag > `CLAUDE_FLOW_DB_PATH` env var > default. This is a contributor-ready issue with a clear spec and no architectural complexity.

**Effort**: S (flag plumbing in the memory command handlers; grep target: `~/.swarm/memory.db` hardcoded in `v3/@claude-flow/cli/src/commands/memory.ts`)

**Payoff dimension**: DX / Windows support / multi-project use cases

---

## Item 5 — Skill synthesis loop (ADR-113/R-3, highest-leverage capability gap)

**Pitch**: Ruflo's DISTILL step extracts key learnings from successful trajectories as internal SONA patterns, but never emits human-readable, shareable skill files. Hermes Agent (and the broader agentic ecosystem) builds shareable skills from successful trajectories as a first-class primitive. This is ADR-113's R-3 gap, rated P1. Implementing it closes the gap between "ruflo learns internally" and "ruflo produces reusable artifacts other agents and projects can consume." The DISTILL step already exists (`hooks_intelligence_trajectory-end`); the missing piece is a `skills/` file emitter that takes a distilled pattern and writes a SKILL.md with proper frontmatter.

**Effort**: M (DISTILL→artifact bridge is a new module; skill-format adapter over agentdb-stored patterns; estimated 3–5 days; no new ADR required if scoped to the emitter)

**Payoff dimension**: capability / ecosystem differentiation / ADR-113 R-3 closure

---

## Item 6 — `ruflo` branding cleanup: eliminate `claude-flow` strings from CLI output (#1861, #1858)

**Pitch**: `npx ruflo doctor --fix` and the MCP server registration display `claude-flow` branding. For users who installed via `npx ruflo`, this is confusing. For enterprise buyers evaluating the `ruflo` product separately from the open-source `claude-flow` project, it creates a support and positioning problem. This is a known-low-complexity issue with no architectural dependencies.

**Effort**: S (string replacement in CLI output templates, doctor command, and MCP server name; scope: `v3/@claude-flow/cli/src/commands/doctor.ts`, `bin/mcp-server.js`, and the branding strings emitted by `hooks statusline`)

**Payoff dimension**: DX / product positioning

---

## Item 7 — Windows daemon persistence (#1766)

**Pitch**: The background daemon (`ruflo daemon start`) dies when the parent `npx` process exits on Windows + Node 25, even after the `shell: true` → `fork()` fix in v3.6.13. The IPC channel keeps the child tied to the parent TTY. This is a real bug affecting Windows users who represent a meaningful fraction of the contributor and enterprise user base. The fix is to use `spawn` with `stdio: 'ignore'` and `detached: true` on Windows (the canonical pattern for a truly detached child process), replacing the current `fork()` approach which preserves the IPC channel.

**Effort**: S–M (platform-specific spawn path; needs Windows CI runner for validation; the fix is well-understood but testing requires infrastructure)

**Payoff dimension**: reliability / Windows / enterprise

---

## Item 8 — Hive-mind ConsensusEngine validation under load (#2030)

**Pitch**: Issue #2030 was marked "SHIPPED" in alpha.45 — `hive-mind_*` MCP tools are now wired through the real `ConsensusEngine` via a `hive-consensus-runtime` singleton. But the issue tracking it remains open, and no integration test exercises the consensus protocol under concurrent agent load (multiple `hive-mind_consensus` calls racing). The hive-mind surface has 49 MCP tool registrations. If the `hive-consensus-runtime` singleton has initialization races or lock contention, it will fail silently for the first caller and produce inconsistent state. This needs an integration test with at least 3 concurrent callers.

**Effort**: M (integration test scaffolding; may surface real bugs in the singleton lifecycle)

**Payoff dimension**: reliability / correctness for enterprise multi-agent deployments

---

## Item 9 — `@noble/ed25519` v2 → v3 upgrade (#2032)

**Pitch**: `@noble/ed25519` is pinned at `^2.1.0` across the monorepo. Upstream is at 3.1.0. The v3 release changed async-by-default behavior and renamed `ed.etc.sha512Sync` (which is used in `plugins/ruflo-core/scripts/witness/verify.mjs`). If left unaddressed, npm 11.x's arborist may resolve a transitive dep to v3 and break `ruflo verify` silently — the same class of breakage as the `optionalDependencies` + `peerDependencies` overlap that produced the `npx Invalid Version` pattern (#1147, #2018). The fix is an explicit API-compatibility audit and either a pin to `^2.x` with `overrides`, or a migration to the v3 API.

**Effort**: S (audit is a few hours; the code surface is small — two script files; migration likely requires replacing `sha512Sync` with `sha512`)

**Payoff dimension**: security / supply chain / reliability

---

## Item 10 — Plugin health audit: promote graph plugins to marketplace `official` tier

**Pitch**: `ruflo-graph-intelligence@0.1.0-alpha.1` is not in the marketplace's `official` array (`v3/@claude-flow/cli/src/plugins/store/discovery.ts`). `ruflo-knowledge-graph@v0.2.0` is listed but not `featured`. With ADR-130 landing in 3.9.0, these plugins become core infrastructure for the unified graph backend. They should be promoted to `official` / `featured` before 3.9.0 ships, and `ruflo-graph-intelligence` should bump to `0.2.0` (stable, not alpha) with the Phase 4 adapter changes. A broader plugin health audit should also flag: (a) `ruflo-iot-cognitum` — no visible test coverage, no ADR; (b) `ruflo-market-data` — depends on external data feeds not exercised in CI; (c) `plugins/ruflo-agent` — unclear if it is superseded by ADR-115/ADR-129's rvagent integration or still carries independent functionality.

**Effort**: S (marketplace entry updates) to M (full audit with health classifications for all 35 plugins)

**Payoff dimension**: ecosystem / DX / discoverability

---

## Prioritization summary

| Rank | Item | Effort | Payoff | Target |
|------|------|--------|--------|--------|
| 1 | Fix 4 skipped integration tests (#1872) | M | reliability | 3.8.x |
| 2 | Witness manifest drift fix (#2047) | S | security/trust | 3.8.x |
| 3 | Real-model validation M5 (#2125) | S–M | benchmark credibility | 3.8.x |
| 4 | `CLAUDE_FLOW_DB_PATH` env var (#2105) | S | DX | 3.8.x |
| 5 | Skill synthesis loop (ADR-113/R-3) | M | capability | 3.9.0 |
| 6 | Branding cleanup (#1861, #1858) | S | DX/positioning | 3.8.x |
| 7 | Windows daemon persistence (#1766) | S–M | reliability | 3.8.x |
| 8 | Hive-mind load testing (#2030) | M | reliability | 3.9.0 |
| 9 | `@noble/ed25519` v2→v3 audit (#2032) | S | security | 3.8.x |
| 10 | Plugin health audit + marketplace promotion | S–M | ecosystem | 3.9.0 |

Items 1–4, 6, 7, 9 are 3.8.x candidates (patch or hot-fix releases). Items 5, 8, 10 are 3.9.0 candidates alongside ADR-130 Phases 1–3.

---

## What was not surveyed

- **ADR-111 (WireGuard federation mesh)**: open enhancement, not blocking; architecture is sound but implementation scope is large (L effort).
- **ADR-113/R-2 (messaging gateway plugin — Telegram/Discord/Slack)**: P2 per the issue; no blocker, just capacity.
- **ADR-100 (CLI core split / lazy-load)**: tracked in issue #1760; correctness-first, then split.
- **Flash Attention (2.49x–7.47x target)**: marked "in progress" in STATUS.md; no specific blocker identified in this survey.
- **`ruflo-iot-cognitum` health**: insufficient test coverage visible; needs a dedicated audit pass before declaring production-ready.
