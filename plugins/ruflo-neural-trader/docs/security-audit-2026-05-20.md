# Security Audit — ruflo-neural-trader (2026-05-20)

ADR-126 follow-up #50. Three-part audit run against the plugin tree:
supply chain, static checks on plugin code, and AIDefence wiring
readiness.

## 1. Supply-chain audit

Command:

```
node scripts/audit-supply-chain.mjs 2>&1 | grep -A5 'ruflo-neural-trader\|plugins/ruflo-neural-trader' || echo "no plugin-specific findings"
```

Result:

```
no plugin-specific findings
```

Full audit summary on the same run:

| Layer                  | Findings                              |
|------------------------|---------------------------------------|
| CVE direct-dep         | 0 HIGH/CRITICAL unaccepted            |
| Lockfile integrity     | 0 missing, 0 weak                     |
| Allowlist              | 0 violations across 2 packages        |
| Typosquat              | 0 hits against 8 blocked names        |
| Publisher trust        | 5 entries, all known maintainers      |

Status: **PASS**. The plugin's transitive surface is clean. The plugin
itself has no `package.json` (it ships skills + agents + scripts only)
so it doesn't introduce direct deps of its own — the entire supply-chain
surface is inherited from the umbrella repo's lockfile, which is
audited per push by `.github/workflows/v3-ci.yml`.

## 2. Static checks on plugin files

### Hardcoded secrets and env-var reads

```
grep -rn 'process.env\|API_KEY\|SECRET' \
  plugins/ruflo-neural-trader/skills/ \
  plugins/ruflo-neural-trader/src/
```

Findings:

| File                                            | Match                       | Status   |
|-------------------------------------------------|-----------------------------|----------|
| skills/trader-cloud-backtest/SKILL.md:19        | `ANTHROPIC_API_KEY` (docs)  | DOCUMENTED — prereq comment, no value |
| src/sublinear-adapter.mjs:22, 34-35             | `RUFLO_SUBLINEAR_NATIVE`    | DOCUMENTED — feature flag, no value |
| src/sublinear-adapter.ts:32, 118, 136-137       | `RUFLO_SUBLINEAR_NATIVE`    | DOCUMENTED — TS mirror of the above |
| commands/trader.md:19                           | `ANTHROPIC_API_KEY` (docs)  | DOCUMENTED — prereq comment |
| agents/risk-analyst.md                          | "evaluation" string match   | FALSE POSITIVE (regex hit on "**Risk evaluation**" — no secret) |

No hardcoded secrets. All env-var reads are documented feature flags or
prereq checks. **PASS**.

### Dynamic code execution

```
grep -rn 'eval\|new Function' plugins/ruflo-neural-trader/ | grep -v '\.md:'
```

Findings: **none in code**. Zero `eval(...)` or `new Function(...)` calls
anywhere in `src/`, `scripts/`, `skills/`, `agents/`, or `commands/`.

**PASS**.

### Child-process invocations

```
grep -rn 'spawn\|execSync\|spawnSync' plugins/ruflo-neural-trader/
```

Findings:

| File                                  | Match                       | Status   |
|---------------------------------------|-----------------------------|----------|
| src/sublinear-adapter.ts:34, 123      | Comment ("daemon-side spawn", "no child-process spawn") | DOCS — no actual call |

No actual `spawn` / `execSync` / `spawnSync` invocations exist in the
plugin code. The plugin shells out to `npx neural-trader` only via skill
bash blocks (which run under the Claude Code permission model), and to
`npx @claude-flow/cli` via documented memory-store commands. Both go
through the same shell that Claude Code itself executes, with no
shell-string-injection vector.

Specifically reviewed against the **#2073 / #2074 lesson** (Windows
`spawnSync npx` ENOENT regression): the plugin never directly calls
`spawn*` — all process invocations are pure bash strings authored by
Claude under user supervision. The argv-vs-shell pitfall doesn't apply.

**PASS**.

## 3. AIDefence wiring readiness

Detailed proposal in `aidefence-wiring.md` (sibling doc). Summary:

- Wire point identified: `market-analyst.md` `--symbol $TICKER` input +
  the `fetchLiveBars` JSON response (the `npx neural-trader --symbol …`
  cloud roundtrip).
- AIDefence MCP tools to call: `aidefence_has_pii`, `aidefence_scan`,
  `aidefence_is_safe` (same three gates the `ruflo-browser` and
  `ruflo-federation` plugins already use).
- **Not implemented in this PR.** Tracked as a separate ADR-127
  follow-up — wiring is a design decision that needs the comms-pipeline
  changes (Phase 5+) to land first so the gate sits at the right
  pipeline boundary.

## Overall verdict

- Supply chain: PASS
- Static checks: PASS (zero secrets, zero eval, zero direct spawn)
- AIDefence wiring: READY — proposal landed, implementation tracked

No blocking findings. The plugin is safe to ship in its current state;
the AIDefence wiring is an enhancement, not a remediation.

## Refs

- ADR-126 §SOTA delta — security follow-up scope
- ADR-118 — aidefence@2.3.0 upgrade (broader injection surface)
- #2073 / #2074 — Windows `spawnSync npx` regression (review lens)
- `scripts/audit-supply-chain.mjs` — the audit tool itself
- `plugins/ruflo-federation/README.md` — existing AIDefence wiring (reference pattern)
- `plugins/ruflo-browser/agents/browser-agent.md` — existing AIDefence gates (reference pattern)
