# ADR-364: Plugin Supply-Chain Scanner and Behavioral Manifest

**Status**: Proposed  
**Authors**: claude (dream-cycle agent, 2026-07-11)  
**Dream Cycle Issue**: #TBD (filed tonight)  
**Supersedes**: None  
**Related**: ADR-178 (IPI / VMG / RepE context-level injection), ADR-150 (MetaHarness integration)

> **ADR numbering note**: Three prior unmerged dream-cycle branches (dream/2026-07-09-swarm, dream/2026-07-10-performance, tonight) all claim ADR-364 because the formula reads from `main` where ADR-178 is the last merged entry. Human reviewer must resolve on merge — recommend renumbering tonight's as ADR-181 if both prior branches merge first.

---

## Context

The 2026 research literature documents a rapid escalation in agent skill/plugin supply-chain attacks:

- **arXiv:2605.14460** (Payload-less Skills): 77.67% confidentiality breach rate; manipulated skill files achieve **0.00% detection rate** by existing scanners — meaning the current ecosystem has no effective pre-install scanner.
- **arXiv:2601.10338** (Agent Skills in the Wild): 26.1% of 31,132 real-world skills contain ≥1 vulnerability; skills with executable scripts are 2.12× more likely to be vulnerable.
- **arXiv:2606.30755** (SafeClawArena): Malicious plugins succeed in **100%** of adversarial test cases; SeClaw reduces ASR from 70% to 22% by adding a permission layer.
- **arXiv:2603.15727** (ClawWorm): Self-propagating attack achieves 64.5% ASR across 40,000+ instances via shared memory poisoning — directly applicable to Ruflo's `collaboration` namespace.
- **arXiv:2603.27204** ("Elementary, My Dear Watson."): Neuro-symbolic scanner achieves **93% F1** on 150,108 skills from 7 public registries.
- **arXiv:2607.01136** (Skills Are Not Islands): Single-skill inspection is insufficient — dependency graphs hide malicious signals; 1.43M skills analyzed as "activation-ready but governance-poor."

Ruflo's plugin registry (`@claude-flow/plugins`) publishes 21 optional plugins via IPFS/Pinata. The publish path (`npx ruflo plugins publish`) pins a JSON manifest and plugin bundle to IPFS with no pre-flight security scan. The install path (`npx ruflo plugins install @name`) fetches the CID with no AST analysis, no dependency graph walk, and no runtime permission manifest.

The `@claude-flow/security` module (InputValidator, PathValidator, SafeExecutor) addresses system-boundary injection but has no plugin-scoped security surface. There is no published OWASP GenAI Top 10 mapping for Ruflo — a visible gap in the security documentation that no competitor has filled (first-mover opportunity).

---

## Decision

### Component A — PluginScanner (pre-publish static gate)

Add `PluginScanner` to `v3/@claude-flow/security/src/plugin-scanner.ts`, exported from `@claude-flow/security`.

**Trigger**: Called by `npx ruflo plugins publish` before Pinata pin; also callable standalone via `npx ruflo security scan --plugin <path>`.

**Analysis layers** (in order):

1. **AST credential extraction scan**: Flag `process.env` access to sensitive keys, `fs.readFile`/`fs.readFileSync` on paths matching `/(\.env|secrets?|credentials?|\.ssh|\.aws)/i`, and `eval`/`Function()` constructs.

2. **Network exfiltration scan**: Flag outbound `fetch`/`axios`/`got`/`http.request` calls to hosts not declared in the plugin's `allowedHosts` manifest field.

3. **Hook injection scan**: Flag registration of hooks (`pre-task`, `post-task`, `pre-edit`, `post-edit`, `session-start`, `session-end`) that are not declared in the plugin's `hooks` manifest field.

4. **Dependency graph walk** (arXiv:2607.01136 pattern): Recursively scan all transitive `require`/`import` dependencies up to depth 5. Flag any dep not in `node_modules` that matches the above patterns.

**Result**: `ScanResult { passed: boolean; findings: Finding[]; grade: 'A'|'B'|'C'|'FAIL' }`. Gate: `FAIL` blocks publish. `C` requires `--force-publish` flag and writes finding to IPFS pin metadata.

**Neuro-symbolic enhancement** (Phase 2, optional): Integrate the pattern from arXiv:2603.27204 — train a lightweight classifier on MalSkillBench (3,944 malicious skills) to supplement AST rules. Target: ≥90% F1 (reference: 93% in paper). Phase 2 is not blocked on ADR approval.

### Component B — Plugin Behavioral Manifest

Add declarative permission manifests to `v3/@claude-flow/cli/src/plugins/manager.ts`.

**Manifest schema** (added to existing `plugin.json` / IPFS bundle):

```json
{
  "permissions": {
    "env": ["ANTHROPIC_API_KEY"],
    "net": ["api.pinata.cloud"],
    "fs": ["./data/plugin-name/**"],
    "hooks": ["pre-task", "post-task"]
  }
}
```

**Runtime enforcement**: Wrap every plugin tool call in a `PermissionGuard` that checks the declared manifest. Violations:
- Emit `plugin:permission-violation` event (observable via `npx ruflo status --events`)
- Log to `~/.claude/security-events.jsonl` with timestamp, plugin ID, violation type
- Halt plugin execution (do not propagate the call)

**Memory integrity seal** (arXiv:2603.15727 / ClawWorm mitigation): In the `post-edit` hook, HMAC-sign values written to shared namespaces (`collaboration`, `patterns`) using a per-session key. On read, verify HMAC before passing to downstream agents. Prevents cross-agent memory poisoning via compromised plugins.

### Component C — OWASP GenAI Mapping Document

Produce `docs/security/owasp-genai-top10-mapping.md` mapping all 10 OWASP GenAI v2025 entries to Ruflo's `@claude-flow/security` module. Minimum per-entry: current status (Covered/Partial/Gap), relevant Ruflo component, and open remediation task.

ADR-364 deliverables map to:
- LLM05 (Supply Chain Vulnerabilities) → Component A (PluginScanner)
- LLM07 (Insecure Plugin Design) → Component B (Behavioral Manifest)
- LLM08 (Excessive Agency) → existing `SafeExecutor` (document as Covered)
- LLM01 (Prompt Injection) → ADR-178 (VMG/RepE, document as In Progress)

---

## Consequences

### Positive

- Closes the 0.00% detection rate gap for payload-less plugin attacks (arXiv:2605.14460)
- Memory integrity seal prevents ClawWorm-style multi-hop swarm poisoning (arXiv:2603.15727)
- OWASP GenAI mapping is a first-mover security compliance signal — no competitor publishes one
- `PluginScanner` is composable: usable standalone, in CI, and as a gating step in the plugin publish flow

### Negative

- `plugins publish` adds a scan step (~1–5s for typical plugin bundles); `--skip-scan` flag available for internal/known-safe plugins only with explicit override
- Behavioral manifest adds a new required field to plugin manifests — existing plugins need manifest updates before next publish (backwards-compatible: missing manifest = warn, not fail, until v4.0)
- Dependency graph walk at depth 5 may produce false positives on plugins that use popular crypto libraries — allowlist for `node_modules/` stdlib equivalents required

### Neutral

- Does not change plugin install user experience (scan is a publish-side gate, not install-side)
- Memory HMAC adds ~0.1ms overhead per namespace write (negligible vs. agent round-trip latency)

---

## Implementation Plan

| Phase | Deliverable | Target |
|-------|-------------|--------|
| 1 (sprint) | `PluginScanner` AST scan + `plugins publish` gate | v3.7.1 |
| 1 (sprint) | Plugin manifest schema + `PermissionGuard` runtime | v3.7.1 |
| 1 (sprint) | OWASP GenAI Top 10 mapping document | v3.7.1 |
| 2 (research) | Memory HMAC integrity seal for `collaboration` namespace | v3.8.0 |
| 2 (research) | Neuro-symbolic scanner Phase 2 (MalSkillBench training) | v3.8.0 |

---

*Generated by Ruflo Dream Cycle agent — 2026-07-11. Do not self-merge.*
