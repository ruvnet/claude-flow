---
name: ruflo-metaharness
description: MetaHarness integration — score, genome, mint, mcp-scan, threat-model — via subprocess invocations honoring ADR-150 architectural constraint
---

MetaHarness integration commands. All shell out to the PINNED
`metaharness`/`harness` binaries (`metaharness@~0.3.0` — resolved from a local
install or a one-time `~/.ruflo/metaharness-cache-<pin>` install, never
`@latest`) via the `_harness.mjs` shared helper; no library imports on
ruflo's boot path.

**`harness score [--path .] [--alert-on-fit-below N] [--format table|json]`** -- 5-dimension readiness scorecard (harnessFit / compileConfidence / taskCoverage / toolSafety / memoryUsefulness + estCostPerRunUsd + scaffoldReady).
1. Run `node plugins/ruflo-metaharness/scripts/score.mjs --path <dir>`
2. Output JSON (default) with all dimensions + recommended template + archetype
3. `--alert-on-fit-below N` exits 1 when harnessFit < N — CI regression gate
4. Subprocess + 60s hard timeout; graceful degradation when metaharness unavailable

**`harness genome [--path .] [--alert-on-risk-above 0.5] [--format table|json]`** -- 7-section repo readiness report (repo_type / agent_topology / risk_score / mcp_surface / test_confidence / publish_readiness).
1. Run `node plugins/ruflo-metaharness/scripts/genome.mjs --path <dir>`
2. Pairs with harness-score for full readiness view — score is numeric, genome is categorical
3. `--alert-on-risk-above N` exits 1 when risk_score > N
4. Useful for drift detection: snapshot genome over time, diff to spot agent_topology drift

**`harness mcp-scan [--path .] [--fail-on low|medium|high] [--format table|json]`** -- Static security scan of `.mcp/servers.json` + `.harness/claims.json`. Reads only; no dispatch.
1. Run `node plugins/ruflo-metaharness/scripts/mcp-scan.mjs --path <dir>`
2. Severity-ranked findings (low/medium/high); default fail-on `high`
3. CI integration: `mcp-scan --fail-on high` fails the build on any HIGH finding
4. Pairs with harness-threat-model for enterprise-review-grade categorization

**`harness threat-model [--path .] [--fail-on clean|low|medium|high] [--format table|json]`** -- Enterprise-review threat model. Returns `worst` severity + categorized `findings[]`.
1. Run `node plugins/ruflo-metaharness/scripts/threat-model.mjs --path <dir>`
2. Default fail-on `high`; tightenable to `medium` for stricter gates
3. Output suitable for sharing with security/infosec team
4. Will be auto-fired by the Phase-2 oia-audit background worker on a schedule

**`harness oia-audit [--path .] [--dry-run] [--alert-on-worst clean|low|medium|high] [--format table|json]`** -- Phase-2 composite worker (ADR-150). Bundles oia-manifest + threat-model + mcp-scan into one timestamped audit record, stores in `metaharness-audit` memory namespace.
1. Run `node plugins/ruflo-metaharness/scripts/oia-audit.mjs`
2. Composite worst-severity = max(threatModel.worst, mcpScan.findings.severity)
3. `--alert-on-worst high` exits 1 when composite ≥ high — CI weekly drift gate
4. `--dry-run` skips memory persistence — useful for local checks
5. Designed for cron schedule: weekly snapshot enables audit drift tracking via memory diff

**`harness mint --name <id> --template <vertical:coding|minimal|…> [--host claude-code|codex|…] [--target /abs/path] [--confirm] [--format table|json]`** -- Scaffold a custom AI agent harness. DRY-RUN by default; --confirm required to write.
1. Run `node plugins/ruflo-metaharness/scripts/mint.mjs --name <id> --template <id> --host <id>`
2. **Safety**: refuses to write to the calling repo root or any path inside it; defaults to `/tmp/ruflo-mint-<ts>-<name>/`
3. Without `--confirm`: prints dry-run plan, exits 0 without touching disk
4. With `--confirm`: shells `npx metaharness new ... --yes`
5. Templates: minimal + 19 verticals (coding, devops, support, legal, …). Hosts: claude-code, codex, pi-dev, opencode, github-actions, +4 more.
