# ADR-080: Auto-Detect OpenAI Codex CLI During `ruflo init`

## Status: ACCEPTED — implemented

## Date: 2026-07-14

## Authors: Claude Flow Team

## Context

ADR-027 added first-class Codex support to `ruflo init` — `AGENTS.md`, `.agents/config.toml`,
`.agents/skills/`, and MCP server registration via the separate `@claude-flow/codex` package.
But that whole path is **opt-in only**: it runs exclusively behind the explicit `--codex` or
`--dual` flags (`v3/@claude-flow/cli/src/commands/init.ts`, `initCodexAction`). A developer who
has the OpenAI Codex CLI installed alongside Claude Code, and runs a plain `ruflo init`, gets
nothing for Codex — no MCP server, no skills — unless they already know the flag exists.

Separately, `services/harness-hosts.ts` (ADR-176 phase 7, MetaHarness fan-out) already
maintains a small host-detection registry with a working `codex` adapter
(`detect: () => commandExists('codex')`), but nothing in the `init` path reused it — the
`@claude-flow/codex` package's own `registerMCPServer()` does its own ad hoc `which codex`
check instead.

Before writing new code against the real Codex CLI, its actual current MCP/skills surface was
verified against OpenAI's live docs (not assumed from training-data priors, which for a
fast-moving external CLI are unreliable):

- `developers.openai.com/codex/mcp` (→ `learn.chatgpt.com/docs/extend/mcp?surface=cli`):
  `codex mcp add <name> [--env K=V ...] -- <command> [args...]`, config stored under
  `[mcp_servers.<name>]` in `~/.codex/config.toml` (or a trusted project's `.codex/config.toml`),
  `codex mcp list` / `list --json` / `get <name>` / `remove <name>`.
- `developers.openai.com/codex/skills` (→ `learn.chatgpt.com/docs/build-skills`): Codex scans
  `.agents/skills` from cwd up through the repo root, then `$HOME/.agents/skills`, then
  `/etc/codex/skills` — a `SKILL.md` with `name` + `description` frontmatter per skill.

Both match what `@claude-flow/codex` already generates — the package's core mechanics were not
stale. The one real gap: `registerMCPServer()` checked "already registered" by substring
-matching `'ruflo'` against the human-readable `codex mcp list` table, which false-positives on
any unrelated server whose name/command happens to contain "ruflo" and silently breaks if the
table formatting changes. `codex mcp list --json` (confirmed current: an array of objects, each
with a `name` field) is the robust, intended way to check this.

## Decision

1. **Auto-detect during plain `ruflo init`.** `commands/init.ts`'s `initAction` now calls a new
   `maybeAutoDetectCodex()` after the normal Claude Code init succeeds (only when `--codex`/
   `--dual` weren't already explicitly used, since those already cover this). It:
   - Returns immediately, silently, if `codex` isn't on `PATH` (`commandExists('codex')`,
     imported from `services/harness-hosts.ts` — reusing the existing detection convention
     instead of duplicating it a third time).
   - If `codex` is present but `@claude-flow/codex` isn't resolvable, prints one informational
     line with the install hint — never an error, never a failed exit code.
   - If both are present, resolves `CodexInitializer` (the same three-strategy dynamic-import
     resolution `initCodexAction` already used — extracted into a shared
     `resolveCodexInitializer()` helper so both call sites stay in sync) and calls
     `initialize({ ..., dual: false })`. `dual: false` is deliberate: the Claude Code files were
     already written by the main init flow moments earlier, so this only adds the Codex-side
     artifacts (`AGENTS.md`, `.agents/config.toml`, `.agents/skills/`, MCP registration) without
     re-touching `CLAUDE.md`.
   - Wrapped in a top-level `try/catch` that swallows everything — this is a bonus, never a
     requirement, and must not affect `ruflo init`'s exit code or interrupt Claude Code setup.
   - Skipped under `--skip-claude` (runtime-only init) and `--format json` (scripted output
     stays pure), and can be turned off explicitly with `--no-codex-detect`.

2. **Revise `registerMCPServer()`** (`v3/@claude-flow/codex/src/initializer.ts`) to check
   `codex mcp list --json` first, matching on the `name` field, with the old plain-text
   substring check kept only as a fallback for an older Codex CLI that doesn't support `--json`
   or an unrecognized response shape.

## Consequences

### Positive
- Zero-flag Codex support: a machine with both `claude` and `codex` on `PATH` gets both
  configured by one `ruflo init`, matching how the rest of this session's work made previously
  -manual steps (statusline promo, AgentDB memory) the default.
- The "already registered" check no longer false-positives/silently-breaks on CLI output format
  drift.
- No new required dependency — `@claude-flow/codex` remains fully optional; its absence degrades
  to a one-line hint, matching the MetaHarness "removable augmentation" pattern this codebase
  already follows elsewhere (ADR-150 §"architectural constraint").

### Negative
- One more thing happening silently during `init` — a user who has `codex` installed for
  unrelated reasons (not intending to use it with this project) gets `.agents/` files created
  without being asked. Mitigated by `--no-codex-detect` and by `initialize()`'s own
  don't-overwrite-without-`--force` behavior on repeat runs.
- Adds one more `execFileSync('codex', ['--version'])` / `execSync('codex mcp list --json')`
  subprocess spawn to every `ruflo init` run on a machine with Codex installed (bounded by a
  3s timeout in `commandExists`).

### Mitigations
- Silent-by-default, best-effort, never fails the primary init.
- `--no-codex-detect` opt-out.
- Detection reuses the existing `harness-hosts.ts` registry rather than adding a fourth ad hoc
  `which codex` check.

## Implementation

- `v3/@claude-flow/cli/src/commands/init.ts` — `resolveCodexInitializer()` (extracted, shared),
  `maybeAutoDetectCodex()` (new), wired into `initAction` after the Claude Code summary output;
  `--no-codex-detect` flag registered.
- `v3/@claude-flow/codex/src/initializer.ts` — `registerMCPServer()` now checks
  `codex mcp list --json` first, text-substring fallback second.

## Success Metrics

- `ruflo init` on a machine with `codex` + `@claude-flow/codex` installed produces
  `.agents/config.toml`, `.agents/skills/`, `AGENTS.md`, and a `ruflo` entry in
  `codex mcp list --json` — without any `--codex`/`--dual` flag.
- `ruflo init` on a machine without `codex` on `PATH` behaves byte-for-byte identically to
  before this change (no new files, no new output).
- `ruflo init --no-codex-detect` on a machine with `codex` present produces no Codex-side
  artifacts.

## Related Decisions

- [ADR-027: Codex Integration](ADR-027-codex-integration.md) — the underlying `--codex`/`--dual`
  flags and `@claude-flow/codex` package this ADR auto-triggers.
- [ADR-176](.) — MetaHarness host fan-out, origin of `services/harness-hosts.ts`'s
  `commandExists`/`codex` detection convention reused here.
- ADR-034 (`Optional MCP Backends — Claude Code, Gemini, Codex`, chat-ui-mcp bridge repo) — a
  sibling decision in a different subsystem treating Codex as an opt-in backend; not the same
  code path but the same "Codex is optional, degrade gracefully" posture.
