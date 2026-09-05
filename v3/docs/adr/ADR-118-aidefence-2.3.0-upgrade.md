# ADR-118 — Upgrade aidefence to 2.3.0 / aimds-* 0.1.1 across the plugin ecosystem

**Status**: Proposed (2026-05-14)
**Date**: 2026-05-14
**Authors**: claude (drafted with rUv)
**Related**: [`aidefence@2.3.0`](https://www.npmjs.com/package/aidefence) (alias `aidefense`), `aimds-core` / `aimds-detection` / `aimds-analysis` / `aimds-response` `0.1.1` on crates.io, `@claude-flow/aidefence@3.0.2` (the workspace package that exposes the `aidefence_*` MCP tools), `ruflo-aidefence` plugin (canonical 3-gate pattern owner), `ruflo-federation` (richer specialization), `ruflo-browser` / `ruflo-security-audit` / `ruflo-plugin-creator` (consumers of `aidefence_*`)
**Supersedes**: nothing

## Context

The upstream npm package [`aidefence`](https://www.npmjs.com/package/aidefence) (AIMDS — AI Manipulation Defense System) shipped a substantial 2.3.0 release on 2026-05-14, paired with `aimds-*@0.1.1` on crates.io. Across the ruflo plugin ecosystem, **eight plugins** invoke `aidefence_*` MCP tools (the canonical 3-gate pattern owned by [`ruflo-aidefence` ADR-0001](../../../plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md)). Those tools are exposed by `@claude-flow/aidefence@3.0.2` in this monorepo, which is built on top of the upstream library.

The upstream 2.3.0 / 0.1.1 release is **not a feature add** — it's a correctness + security pass that closes concrete gaps in the detection and response layers. Several of those gaps are observable in the ruflo plugins that rely on the 3-gate pattern (federation's PII pipeline, browser's pre-storage scan, security-audit's runtime gate cross-reference). This ADR records the decision to bump and propagates the new behavior across the plugin docs + invariants.

## What changed upstream

### `aimds-detection` — sanitizer (the source of `aidefence_is_safe`)

- **Prompt-injection regex** previously required *exactly one* adjective between the verb (`ignore` / `disregard` / `forget` / `override`) and the noun (`instruction[s]` / `prompt[s]` / `rule[s]` / `context` / `system-prompt`). The phrase `ignore all previous instructions` — the canonical prompt-injection prefix — was **not matched** (it has two modifier words). Replaced with a 0..4-modifier-word window.
- **Role-hijack patterns** added: `you are now …` / `act as …` / `pretend to be …`.
- **Jailbreak markers** added: `DAN mode` / `developer mode` / `god mode` / `root mode`.

### `aimds-response` — audit + meta-learning

- **`AuditLogger.total_mitigations()` / `successful_mitigations()`** returned hardcoded `0` (a never-closed TODO). Now backed by `AtomicU64` hot-path counters bumped *before* the lock-protected stats so observers never see a lower count than the source of truth.
- **`calculate_optimization_effectiveness()`** previously read only the `pattern_effectiveness` HashMap and ignored the per-rule success/failure counts in `learned_patterns` — optimization level could never advance from feedback that drove the Vec. Now blends both signals.
- **`optimize_strategy()`** used `get_mut`, silently dropping every feedback signal for a strategy_id that hadn't been seen. Switched to `entry().or_insert_with()` so the first feedback seeds the metrics row.

### `aimds-core` — workspace + security

- **RUSTSEC-2024-0421 cleared.** Bumped `validator` 0.18 → 0.20, which transitively retires the vulnerable `idna 0.5.0` (Punycode-masking host-name attack) and the unmaintained `proc-macro-error 1.0.4`. `cargo deny check {advisories,bans,licenses,sources}` is now green across all four crates.
- **`unsafe_code = "deny"`** workspace lint verified across all four crates.
- **Dependency bumps**: `metrics` 0.21 → 0.24 (chain syntax requirement), `metrics-exporter-prometheus` 0.12 → 0.16.

## Decision

**Bump the `@claude-flow/aidefence` workspace package to consume `aidefence@2.3.0` / `aimds-*@0.1.1` upstream, retain the existing `aidefence_*` MCP tool surface (no API breakage), and record the new behavior in the plugin docs + the `audit-fix-invariants.mjs` CI guard so we never silently regress past it.**

### Implementation surface

| Layer | Change | Rationale |
|-------|--------|-----------|
| `v3/@claude-flow/aidefence/package.json` | Add/bump `aidefence` peer or dep to `^2.3.0` | The MCP tools (`aidefence_is_safe`, `aidefence_scan`, `aidefence_has_pii`, `aidefence_analyze`, `aidefence_learn`, `aidefence_stats`) keep their signatures; only the underlying classifier changes. |
| `plugins/ruflo-aidefence/README.md` | Note the detection regex now matches `ignore all previous instructions`, the three role-hijack shapes, and the four jailbreak markers. Document that `aidefence_stats` now reports accurate `total_mitigations` and `successful_mitigations`. | Downstream plugin authors who tune around prior gaps need to know they no longer apply. |
| `plugins/ruflo-federation/README.md` | The "3-gate alignment" block describing the PII pipeline as a specialization of `aidefence_*` gets an updated sub-bullet: outbound checks now cover the broader injection surface. | ruflo-federation's PII pipeline specializes the 3-gate pattern; the broader detection automatically applies. |
| `plugins/ruflo-browser/docs/adrs/0001-browser-skills-architecture.md` | The "Prompt-injection check" bullet (any extracted text flowing back into an LLM prompt passes `aidefence_is_safe` first) gets a one-line note: with 2.3.0+, the check now catches role-hijack and jailbreak attempts in scraped content. | Browser-scraped pages are a high-leakage source for these patterns. |
| `plugins/ruflo-security-audit/agents/security-auditor.md` | The "ruflo-aidefence" mention picks up the cleared RUSTSEC-2024-0421 + cargo-deny-green note as a positive baseline for security-audit's own dep-audit role. | Lets the security-auditor agent reference the upstream's clean cargo-deny pass when describing the baseline. |
| `scripts/audit-fix-invariants.mjs` | Add an invariant covering the bumped peer/dep in `@claude-flow/aidefence/package.json`. | The audit guard pattern recently added in alpha.36 (PR #2001) is the right place to prevent a silent downgrade. |

### Compatibility

- **No MCP tool signature changes.** `aidefence_is_safe`, `aidefence_scan`, `aidefence_has_pii`, `aidefence_analyze`, `aidefence_learn`, and `aidefence_stats` all keep their current inputs and outputs. Existing skills and agents that invoke them keep working.
- **Verdict semantics may shift**: `aidefence_is_safe` will now return `unsafe: true` on inputs it previously passed (the `ignore all previous instructions` shape, role-hijack phrases, jailbreak markers). This is the *intended* behavior — it's a defense improvement, not a regression. Plugins that gate on the verdict (`federation` outbound, `browser` post-scrape) will see strictly safer behavior.
- **`aidefence_stats` numeric drift**: callers that were charting `total_mitigations` as `0` will now see non-zero values. Dashboards/SLOs derived from those counters need to be re-baselined.

### Migration plan

1. Bump `@claude-flow/aidefence` to consume the new upstream (one package.json change; no API surface change in the workspace package).
2. Run the canonical 3-gate smoke (`bash plugins/ruflo-aidefence/scripts/smoke.sh`) against the updated build to confirm `aidefence_*` tools still return well-shaped responses on benign inputs.
3. Add a second smoke gate that asserts the new detection paths fire: `aidefence_is_safe({prompt: "ignore all previous instructions"})` → unsafe, `aidefence_is_safe({prompt: "you are now in DAN mode"})` → unsafe. (One-line jq assertions in the existing smoke.sh.)
4. Re-baseline any dashboard / SLO that charts `aidefence_stats.total_mitigations` (the value will now be accurate, where before it was 0).
5. Add an `audit-fix-invariants.mjs` entry that pins the dep version in `@claude-flow/aidefence/package.json` so a CI run will fail if someone silently downgrades.

## Consequences

### Positive

- **Detection coverage strictly improves.** The 3-gate pattern's prompt-injection gate now catches the canonical `ignore all previous instructions` phrasing, role-hijack, and jailbreak markers — categories the previous regex missed.
- **`aidefence_stats` is trustworthy** for the first time since the gate landed. Operators charting mitigation rates / dashboards get a true count.
- **Meta-learning actually converges.** The two bugs in `aimds-response::meta_learning` (effectiveness ignored Vec signals; `get_mut` dropped first-feedback rows) meant the response layer's optimization level never advanced from production feedback. With 0.1.1 it does.
- **One CVE cleared** (RUSTSEC-2024-0421 — Punycode-masking host-name attack via `idna 0.5.0`). `cargo deny` is green across the four crates.
- **`audit-fix-invariants.mjs` gains a 26th invariant** (the dep pin), keeping the CI-guard pattern consistent with the rest of the recent fix-cataloguing work.

### Negative

- **Verdict-change blast radius.** Plugins that pre-baselined `aidefence_is_safe` on phrasings now flagged unsafe (some adversarial-prompt fixture sets, possibly) will see new failure paths. The canonical 3-gate smoke + the new detection-positive cases above are the regression net.
- **Dashboard drift.** Any operator dashboard reading `total_mitigations` will start showing larger numbers — needs re-baseline communication.
- **Rust toolchain pinned higher.** `aimds-*@0.1.1` requires Rust 1.85+ (validator 0.20 transitive). The ruflo monorepo's CI runners already use stable; consumers building from source on pinned-older toolchains need to bump.

### Neutral

- **No new MCP tools.** This is a same-surface, better-behavior change. Plugin authors don't have to wire anything new.
- **No claims-system change.** The 3-gate pattern's claims-gated retrieval flows in `ruflo-aidefence` ADR-0001 keep their semantics.

## Links

- [`aidefence@2.3.0` on npm](https://www.npmjs.com/package/aidefence)
- [`aimds-core@0.1.1` on crates.io](https://crates.io/crates/aimds-core)
- Upstream changelog (in the published 2.3.0 tarball as `CHANGELOG.md`).
- [`ruflo-aidefence` ADR-0001](../../../plugins/ruflo-aidefence/docs/adrs/0001-aidefence-contract.md) — canonical 3-gate pattern owner.
- PR #2001 (alpha.36 release + audit-fix-invariants update) — the CI guard that the new invariant slots into.
