# ADR-320 — Pre-Publish Plugin Scanner and Runtime Permission Manifest Enforcement

**Status**: Proposed
**Date**: 2026-07-15
**Issue**: [ruvnet/ruflo#2630](https://github.com/ruvnet/ruflo/issues/2630)
**Related**: ADR-145 (Plugin Supply-Chain Integrity — install layer), ADR-144 (Agent Authorization Propagation — cross-agent action layer), ADR-004 (Plugin Architecture), ADR-015 (Unified Plugin System)

## Context

ADR-145 closed the **install-time** trust question for plugins: `PluginIntegrityVerifier` checks a signature and runs a semantic-intent scan against the description/README text when a plugin is fetched from the IPFS registry. That is necessarily a client-side, per-install check — it runs once, on the machine that is about to load the code, and it screens natural-language fields rather than the plugin's actual code and dependency graph. Four Grade A papers published in 2026 (the dream-cycle nightly research run that opened issue #2630) show this leaves two gaps ADR-145 does not claim to close:

1. **Payload-less skill attacks** (arXiv:2605.14460, Grade A): the SCH benchmark cited in ADR-145 reports **77.67% confidentiality breach, 67.33% RCE success, and a 0.00% detection rate** against existing scanners. ADR-145's Stage-2 semantic scan targets exactly this paper's attack family, but only at install time and only against natural-language fields — it does not analyze the plugin's executable code, its declared hooks, or credential/exfiltration call sites in the AST.
2. **Ecosystem-scale vulnerability prevalence** (arXiv:2601.10338, Grade A): a survey of 31,132 real-world skills found **26.1% contain at least one vulnerability**, and skills that ship executable scripts are **2.12× more likely** to be vulnerable than manifest-only skills. This is a base-rate argument for scanning *before* a plugin ever reaches the registry, not only when a user chooses to install it.
3. **Dependency-chain risk** (arXiv:2607.01136, Grade A): single-skill inspection misses transitive risk — a clean plugin that depends on a compromised or over-privileged package is invisible to a scanner that only looks at the plugin's own files. The paper argues for graph-level analysis across the full dependency chain.
4. **Neuro-symbolic static scanning at scale** (arXiv:2603.27204, Grade A): a combined AST + symbolic-rule scanner reaches **93% F1 across 150,108 real skills from 7 registries**, demonstrating that static analysis (not just semantic/LLM classification) is tractable at registry scale and catches a materially different attack surface than ADR-145's Stage 2.

Separately, **SafeClawArena** (arXiv:2606.30755, Grade A) measured malicious plugins reaching **100% attack success rate (ASR)** against agents with no plugin permission model, and showed that **SeClaw**, a declarative permission-manifest layer checked at load time, cuts ASR from 70% to 22%. This is a *runtime* control, not a scan-time one: even a plugin that passes every static check can still misbehave once loaded if nothing constrains what it's allowed to do. `v3/@claude-flow/cli/src/plugins/manager.ts` currently loads and executes plugins with no permission model — a plugin has the same ambient authority as the host process.

### Why this is a distinct architectural layer from ADR-145

| Layer | ADR | Question it answers | When it runs |
|---|---|---|---|
| Publish gate (new, Part A below) | **this ADR** | "Does this plugin's code, hooks, and dependency graph contain attack patterns, before it ever reaches the registry?" | `plugins publish` (registry-side, once per version) |
| Install verification | ADR-145 Part A | "Is this specific signature valid and does the description contain semantic-hijack language?" | `plugins install` (client-side, per install) |
| Runtime permission enforcement (new, Part B below) | **this ADR** | "Given this plugin loaded successfully, what is it actually allowed to do right now?" | plugin load / every capability invocation |
| Cross-agent action authority | ADR-144 | "Is the *agent* calling this tool authorized to, across a delegation chain?" | every tool call |

None of these subsume each other. A plugin can pass ADR-145's signature+semantic check and still contain SCH-style code-level attacks that only an AST/dependency scan catches (Part A). A plugin that passes every static and install-time check can still need runtime containment, because static analysis has a false-negative rate against novel attacks (Part B, independent of how the plugin got installed). ADR-144 constrains what the *calling agent* may do; Part B constrains what the *loaded plugin* may do — orthogonal principals.

## Decision

Add two new components, both scoped to the plugin pipeline, extending rather than replacing ADR-145.

### Part A — Pre-publish static/behavioral scanner (`PluginPublishScanner`)

**File**: `v3/@claude-flow/security/src/plugins/publish-scanner.ts` (new)

A registry-side gate that runs on every `npx ruflo plugins publish`, before a manifest is accepted into the IPFS registry (`v3/@claude-flow/cli/src/plugins/store/discovery.ts` publish path). Distinct from ADR-145's install-time verifier: this scans **code**, not description text, and runs **once per published version** rather than once per install.

```typescript
interface PublishScanResult {
  verdict: 'pass' | 'warn' | 'block';
  findings: ScanFinding[];   // category, file, line, confidence
  dependencyRisk: DependencyGraphReport;
}

interface ScanFinding {
  category: 'credential-extraction' | 'exfiltration-call' | 'undeclared-hook-injection' | 'rce-pattern';
  file: string;
  confidence: number;       // 0-1, from the neuro-symbolic scorer
}

class PluginPublishScanner {
  scan(pluginDir: string): Promise<PublishScanResult>;
}
```

Two analysis stages, mirroring the 93% F1 approach of arXiv:2603.27204:

1. **AST-level symbolic rule pass** — parses every executable file in the plugin (JS/TS/shell) into an AST and matches against a rule set covering the four `ScanFinding` categories: credential extraction (env/secret access patterns), exfiltration calls (outbound network calls not declared in the manifest), undeclared hook injection (plugin registers a hook not listed in its manifest's `hooks` field), and RCE patterns (`eval`, dynamic `require`/`import`, shell-out with unsanitized input). This is the symbolic half of the neuro-symbolic pair and is what makes the scanner deterministic and auditable — no model call required for the baseline pass.
2. **Dependency-graph traversal** — walks the plugin's full `package.json` dependency tree (not just declared direct deps) and flags: unpinned versions, known-vulnerable packages (cross-referenced against an OSV feed), and any transitive dependency that itself requests filesystem/network capabilities beyond what the plugin's own manifest declares. This directly targets arXiv:2607.01136's finding that single-skill inspection misses dependency-chain risk, and covers the executable-script risk multiplier from arXiv:2601.10338 (2.12×).

`verdict: 'block'` fails `plugins publish` outright when `CLAUDE_FLOW_STRICT_PUBLISH=true` (default: warn-only for the first two releases, matching ADR-145's rollout pattern). Every scan result — pass, warn, or block — is written to the registry index alongside the manifest so `plugins install` can display it (ADR-145's Stage 2 remains the client-side complement; a plugin failing Part A but still reaching a legacy registry mirror is still caught at install).

**Implementation targets**:
- `v3/@claude-flow/security/src/plugins/publish-scanner.ts` (new)
- `v3/@claude-flow/cli/src/plugins/store/discovery.ts` — scan hook on the publish path
- Rule corpus seeded from arXiv:2605.14460 Table 3 (same SCH family ADR-145 Stage 2 targets, but at the code level instead of the description-text level)

### Part B — Plugin behavioral manifest + runtime permission enforcement

**File**: `v3/@claude-flow/cli/src/plugins/manifest/permission-manifest.ts` (new), enforcement wired into `v3/@claude-flow/cli/src/plugins/manager.ts`

Every plugin declares a capability manifest (extends the existing plugin manifest format with a required `permissions` block):

```typescript
interface PluginPermissionManifest {
  filesystem: { read: string[]; write: string[] };   // glob patterns, default: []
  network: { allowedHosts: string[] };                // default: []
  hooks: string[];                                    // hook names this plugin may register
  memoryNamespaces: string[];                          // namespaces this plugin may touch (aligns with ADR-145 Part B)
  subprocess: boolean;                                 // may it shell out at all — default false
}
```

`manager.ts` enforces this manifest at two points:

1. **Load time** — a plugin whose manifest requests capabilities beyond a configurable ceiling (`CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS`) is refused load with a logged reason, mirroring SeClaw's declarative gate.
2. **Invocation time** — every filesystem, network, hook-registration, or subprocess call the plugin makes is checked against its own manifest before executing, not just checked once at load. This is what SeClaw's benchmark (arXiv:2606.30755) shows is load-bearing: least-privilege must be enforced **per capability use**, the same principle ADR-144 established for cross-agent tool calls, applied here to the plugin-vs-host boundary instead of the agent-vs-agent boundary.

A plugin that omits the `permissions` block entirely is treated as requesting the legacy maximal grant (filesystem read/write anywhere, no network restriction) so existing plugins keep working until the strict flag flips — same backwards-compatibility shape as ADR-145 and ADR-144.

**Implementation targets**:
- `v3/@claude-flow/cli/src/plugins/manifest/permission-manifest.ts` (new — schema + validation)
- `v3/@claude-flow/cli/src/plugins/manager.ts` — load-time gate + per-call enforcement wrapper around plugin capability invocations
- `v3/@claude-flow/cli/src/plugins/store/discovery.ts` — manifest surfaced in `plugins info` output alongside the Part A scan verdict

### Integration plan (phased — P1 is the first PR)

| Phase | Scope | Where |
|---|---|---|
| **P1** | `PluginPublishScanner` skeleton + AST rule pass (Stage 1); wired into `plugins publish` in warn-only mode | `@claude-flow/security/src/plugins/`, `@claude-flow/cli/src/plugins/store/discovery.ts` |
| P2 | Dependency-graph traversal (Stage 2) + OSV cross-reference | same files |
| P3 | `PluginPermissionManifest` schema + manifest validation on plugin load | `@claude-flow/cli/src/plugins/manifest/` |
| P4 | Per-capability runtime enforcement in `manager.ts` (filesystem, network, hooks, subprocess) | `@claude-flow/cli/src/plugins/manager.ts` |
| P5 | `CLAUDE_FLOW_STRICT_PUBLISH` and `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` flip to strict-by-default in v4.0 | release docs + breaking-change ADR |

### Backwards compatibility

- Publish scanning defaults to **warn-only** (`CLAUDE_FLOW_STRICT_PUBLISH=false`); existing published plugins are not retroactively scanned but new versions are scanned on next publish.
- Plugins without a `permissions` block get the legacy maximal grant until `CLAUDE_FLOW_PLUGIN_MAX_PERMISSIONS` is set to a strict ceiling.
- Both env vars are documented escape hatches and MUST be registered in `audit-env-var-precedence.mjs` with rationale (same requirement ADR-144/145 impose on their flags).
- Both strict modes become default in v4.0.0, consistent with the phased rollout ADR-144 and ADR-145 already committed to.

## Alternatives considered

**Fold Part A into ADR-145's Stage 2 semantic scan.** Rejected: ADR-145 Stage 2 explicitly scans natural-language fields (description, README, "compliance rules") with an LLM classifier or pattern fallback. Part A scans executable code via AST and a dependency graph — different input, different technique (symbolic/deterministic vs semantic/probabilistic), different pipeline stage (publish vs install). Conflating them would make ADR-145 responsible for a scanner architecture it was never designed around.

**Runtime sandboxing (process isolation) instead of a permission manifest.** Considered and explicitly deferred by ADR-145 itself ("sandboxing addresses the blast-radius question... belongs on the roadmap"). A permission manifest is cheaper to ship first and directly matches the SeClaw benchmark's measured 70%→22% ASR reduction; sandboxing remains a complementary future defense-in-depth layer, not a substitute.

**Rely solely on ADR-144's authorization propagation for plugin containment.** ADR-144 governs what the *calling agent* may do across delegation hops. A malicious plugin loaded by a fully-authorized agent is a different threat: the agent's authorization is legitimate, but the plugin's own code is not trustworthy. The two controls are orthogonal and both necessary.

## Consequences

**Positive**:
- Closes the **0.00% detection rate** SCH gap (arXiv:2605.14460) at the code level, complementing ADR-145's text-level Stage 2.
- Targets the measured **93% F1** neuro-symbolic scanning result (arXiv:2603.27204) as the concrete bar for Part A's precision/recall.
- Directly addresses the dependency-chain blind spot from arXiv:2607.01136 and the 2.12× executable-script risk multiplier from arXiv:2601.10338.
- Targets the SeClaw **70%→22% ASR reduction** (arXiv:2606.30755) via runtime permission enforcement in `manager.ts`.
- Publish-time gating protects every future installer, not just the one user who happens to have strict install-time checks enabled.

**Negative / trade-offs**:
- AST + dependency-graph scanning adds latency to `plugins publish` (expected seconds, not milliseconds — acceptable, since publish is a low-frequency, developer-initiated action, unlike ADR-145's install-time budget).
- Per-capability runtime enforcement in `manager.ts` adds a wrapper layer around every plugin capability call; needs a benchmark to confirm it stays within the CLI's existing performance targets (see `v3/CLAUDE.md` performance table).
- Existing plugins without a `permissions` block get the legacy maximal grant, so Part B provides no protection for the installed base until publishers update manifests — mitigated by the same phased strict-mode flip pattern already established in ADR-144/145.
- OSV feed dependency introduces an external data-freshness dependency for Stage 2; must degrade gracefully (warn, don't block) if the feed is unreachable.

**Deferred**:
- Full process-level sandboxing of plugin execution (blast-radius containment beyond permission checks) — separate future ADR.
- LLM-based (non-symbolic) scoring for Part A's AST pass — the P1/P2 scope is deliberately the deterministic symbolic half of arXiv:2603.27204's neuro-symbolic pair; adding the neural half is a future enhancement once the symbolic baseline has a measured false-positive rate to compare against.

## Validation

P1 lands with:
- Unit tests for the AST rule pass against a synthetic corpus covering all four `ScanFinding` categories, plus the arXiv:2605.14460 Table 3 SCH examples (shared corpus with ADR-145 Stage 2, since both target the same paper).
- Smoke test: `plugins publish ./malicious-fixture` warns by default, blocks under `CLAUDE_FLOW_STRICT_PUBLISH=true`.
- Integration test: a plugin manifest declaring `subprocess: false` is denied when its code attempts a shell-out, verified through `manager.ts`'s per-call enforcement wrapper.
- Benchmark: publish-time scan duration recorded and reported (no fixed SLA — publish is not latency-sensitive — but a regression baseline must exist before P2 ships).

## References

- arXiv:2605.14460 — *Exploiting LLM Agent Supply Chains via Payload-less Skills* (SCH; same paper ADR-145 Stage 2 targets, different layer)
- arXiv:2601.10338 — ecosystem-scale skill vulnerability survey (31,132 skills, 26.1% vulnerable, 2.12× executable-script risk)
- arXiv:2606.30755 — SafeClawArena / SeClaw (100% ASR with no permission model, 70%→22% with manifest enforcement)
- arXiv:2603.27204 — neuro-symbolic static scanner, 93% F1 across 150,108 skills / 7 registries
- arXiv:2607.01136 — dependency-chain / graph-level risk analysis, single-skill inspection insufficiency
- OWASP GenAI Security Project, 2025 Top 10 for LLM Applications — Supply Chain (LLM03) and Insecure Plugin Design (LLM07)
