# ruflo-jujutsu

Advanced git workflows with diff analysis, risk scoring, and reviewer recommendations.

## Install

```
/plugin marketplace add ruvnet/ruflo
/plugin install ruflo-jujutsu@ruflo
```

## Features

- **Diff analysis**: Comprehensive change analysis with risk scoring
- **Change classification**: Auto-categorize as feature, bugfix, refactor, etc.
- **Reviewer recommendations**: Suggest reviewers based on code ownership
- **File-level risk**: Per-file risk breakdown for targeted review

## Commands

- `/jujutsu` -- Analyze current diff with risk scoring

## Skills

- `diff-analyze` -- Analyze diffs for risk, reviewers, and classification
- `git-workflow` -- Advanced branch management and PR lifecycle

## MCP surface (6 tools)

All defined at `v3/@claude-flow/cli/src/mcp-tools/analyze-tools.ts`:

| Tool | Purpose |
|------|---------|
| `analyze_diff` | Full diff analysis (risk + classification + reviewers + stats) |
| `analyze_diff-risk` | Risk score for the staged/unstaged diff |
| `analyze_diff-classify` | Classify change as feature, bugfix, refactor, perf, security, docs, …|
| `analyze_diff-reviewers` | Recommend reviewers based on code ownership |
| `analyze_file-risk` | Per-file risk breakdown |
| `analyze_diff-stats` | Lines added/removed, files touched, complexity delta |

## Compatibility

- **CLI:** pinned to `@claude-flow/cli` v3.6 major+minor.
- **Verification:** `bash plugins/ruflo-jujutsu/scripts/smoke.sh` is the contract.

## ADR-compliance integration

This plugin's diff analysis is the substrate that [ruflo-adr ADR-0001](../ruflo-adr/docs/adrs/0001-adr-plugin-pattern.md)'s `/adr check` runs on. When ADR compliance is queried for a diff:

1. `/adr check` calls `analyze_diff` to get the structured diff
2. Then `analyze_diff-classify` to determine change type
3. Then cross-references the `adr-patterns` namespace for ADRs related to the touched files
4. Flags violations: code referencing deprecated/superseded ADRs, or code contradicting accepted ADRs

Without this plugin, `/adr check` falls back to plain `git diff` parsing — usable but no risk scoring or reviewer recommendations.

## Namespace coordination

This plugin owns the `git-patterns` AgentDB namespace (kebab-case, follows the convention from [ruflo-agentdb ADR-0001 §"Namespace convention"](../ruflo-agentdb/docs/adrs/0001-agentdb-optimization.md)). Reserved namespaces (`pattern`, `claude-memories`, `default`) MUST NOT be shadowed.

## Verification

```bash
bash plugins/ruflo-jujutsu/scripts/smoke.sh
# Expected: "10 passed, 0 failed"
```

## Architecture Decisions

- [`ADR-0001` — ruflo-jujutsu plugin contract (ADR-compliance integration, smoke as contract)](./docs/adrs/0001-jujutsu-contract.md)

## Related Plugins

- `ruflo-adr` — `/adr check` consumes this plugin's `analyze_diff` output
- `ruflo-agentdb` — namespace convention owner

## As a mod

This plugin ships a function-hook mod (ADR-445, `hooks/register.ts`). It makes no network call, spawns no process and makes no model call.

- **Guard** (tighten-only, on by default): Refuses `github_pr_manage` create/review whose title or body holds a key, token or password (PR text is public), and `merge`/`close` unless the call carries `confirm: true`. A refusal never echoes the secret.
- **`/jujutsu-mod`**: `status`, `recent`, `tools` (which of this plugin's tools are connected) and `scan <text>` (would the guard refuse it). Answered locally.
- **Status file**: `.claude-flow/jujutsu-mod/status.json` (`{version: 1, updatedMs, guard, calls, total, blocked, recent}`, counters only, never tool input), written at session start and after every call to this plugin's tools.

Options (`userConfig`): `guard` (on), `confirmPrActions` (on).

Test it: `claude plugin validate plugins/ruflo-jujutsu`, `claude plugin test plugins/ruflo-jujutsu`, `bash plugins/ruflo-jujutsu/scripts/smoke.sh`.
