# MetaHarness on the mod plugins (2026-10-04)

ADR-150 keeps MetaHarness optional and removable. This run points its static
tools at the mod plugins (ADR-404, 444, 445, 446) and checks that nothing in
the console or the plugin fleet needs it.

Tool: `plugins/ruflo-metaharness/scripts/{score,genome,mcp-scan,threat-model}.mjs
--path <dir>` (the scripts behind `ruflo metaharness <verb>`), run from branch
`loop/metaharness-mods` at `cd010ee76`. `mcp-scan` ran with `--fail-on high`.
Every one of the 28 invocations exited 0.

## Numbers

Score is harnessFit / compileConfidence / taskCoverage / toolSafety /
memoryUsefulness. Genome is repo_type, risk_score, mcp_surface, verdict.

| target | score | hard | genome | mcp-scan (worst, findings) | threat-model |
|---|---|---|---|---|---|
| repo root | 82 / 100 / 100 / 95 / 53, scaffoldReady | 6/6 | rust_node_mcp_ci_polyglot, 0.23, remote, ready | medium, 3 | medium, `clean`, 25 allowed / 3 denied |
| ruflo-mods | 56 / 22 / 74 / 95 / 29 | 5/6 | unknown_ci, 0.46, local_default_deny, needs-work | info, 1 | info, `clean` |
| ruflo-console | 35 / 12 / 0 / 95 / 2 | 5/6 | unknown, 0.62, local_default_deny, needs-work | info, 1 | info, `clean` |
| ruflo-agentdb | 56 / 22 / 74 / 95 / 31 | 5/6 | unknown_ci, 0.46, local_default_deny, needs-work | info, 1 | info, `clean` |
| ruflo-security-audit | 58 / 12 / 66 / 82 / 31 | 5/6 | unknown_mcp, 0.755, remote, blocked | info, 1 | info, `clean` |
| ruflo-aidefence | 42 / 12 / 66 / 95 / 31 | 5/6 | unknown, 0.62, local_default_deny, needs-work | info, 1 | info, `clean` |
| ruflo-docs | 58 / 12 / 66 / 82 / 31 | 5/6 | unknown_mcp, 0.755, remote, blocked | info, 1 | info, `clean` |

Nothing reached `high`. The `--fail-on high` gate did not trigger anywhere.

## Triage

**Real, not changed here**

- Root `mcp-scan`, medium x2: `.claude/settings.json` allows `Bash(node .claude/*)`
  and `Bash(node:*)`. The second lets any node script run unprompted. This is
  the repository's shared developer permission set, not a mod surface, and
  every agent worktree leans on it. Narrowing it is a separate decision for
  the owner of that file.
- Root `mcp-scan`, low: 12 unpinned dependency ranges. Out of scope (no
  dependency pin changes in this item).

**Noise, explained**

- `mcp-disabled` ("No MCP surface", info) on every plugin: accurate. The scanner
  reads `.mcp/servers.json` and `.harness/claims.json`; mods register function
  hooks and tools through the host, not an MCP server, so there is nothing to
  scan. Adding empty claim files to satisfy it would be a new declaration that
  says nothing, so none was added.
- `5/6` hard constraints, low compileConfidence and `scaffoldReady: false` on the
  plugin directories: a plugin has no `package.json` or build command, because
  Claude Code loads its `.ts` hook module directly. The scorer reads that as
  "not buildable". Not a defect.
- `mcp_surface: remote` and `blocked` on ruflo-docs and ruflo-security-audit: the
  archetype classifier matched them as an "MCP server harness" from their text.
  Removing the `mcp` keyword from `plugin.json` did not change it (tested on a
  scratch copy), so it is the prose, and `mcp-scan` / `threat-model` on the same
  directories report no MCP surface.
- `taskCoverage 0` and `memoryUsefulness 2` on ruflo-console: heuristics over
  declared commands and memory files; the console declares neither.

## One real gap fixed: the console named a missing MetaHarness as "no JSON"

With `@metaharness/*` absent, every skill prints
`{"degraded": true, "reason": "metaharness-not-available", ...}` and exits 0
(ADR-150 rule 3). The console's probe runner only treats a value as good when
the probe's parser returns one; a degraded answer has no scores, so the parser
returns `null`, and `probeError` reported `no JSON in the CLI output`, which is
wrong (there was JSON) and hid the reason.

`plugins/ruflo-console/hooks/data/cli.ts` `probeError` now reads a degraded
answer and returns `unavailable: <reason>`. The MetaHarness view shows
`MetaHarness: unavailable: metaharness-not-available — optional (ADR-150), the
console works without it`. Other `exit 0` non-JSON output is unchanged.
Test: `tests/setup.spec.ts` (degraded with a reason, degraded without one,
`degraded: false`, and `scoreProbe.parse` still returns `null`).

## Absence proof (steps of `.github/workflows/no-metaharness-smoke.yml`, run locally)

- Static check: no `metaharness` or `@metaharness/*` in `dependencies` in 8
  manifests (root, `ruflo/`, CLI, plugins): OK.
- `node scripts/smoke-all-plugins.mjs --timeout 300`: 46/46 plugins, 732/732
  steps, 74.1 s.
- Absence drill (unreachable registry, `RUFLO_METAHARNESS_SKIP_LOCAL=1`, empty
  cache root): score, genome, mcp-scan, threat-model, oia-audit and mint exit 0
  with `degraded: true`, `reason: metaharness-not-available`;
  drift-from-history exits 3 (its documented "cannot run" code) with the same
  payload. Run against `plugins/ruflo-mods` as well: exit 0, degraded.

## Not covered

- The console drive could not show the degraded line end to end. The console's
  CLI runs in a scratch directory, where `metaharness score` fails with its own
  exit 2 on an empty directory whether or not MetaHarness is present; the view
  still rendered the Flywheel section and the "optional (ADR-150)" note. The
  degraded-text path is covered by the unit test above.
- Only 3 of the 39 ADR-446 mod plugins were scanned (security-audit,
  aidefence, docs); they share one structure and one result.
