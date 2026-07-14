# ADR-320: Windows console-flash residual mitigation strategy (hook trim + native statusLine)

- **Status**: Proposed
- **Date**: 2026-07-14
- **Deciders**: ruv
- **Related**: [ADR-321](ADR-321-cross-event-foreground-window-snapshot-cache.md) (cross-event snapshot cache — biggest remaining architectural item, spun out separately), [ADR-322](ADR-322-daemon-based-state-probing-consolidation.md) (moves per-event polling into the daemon, depends on ADR-321's cache schema), commit `c89a98a4f` (v3.29.0 — the grandchild-spawn `windowsHide` fixes this ADR builds on, already shipped)

## Context

Tracking issue [#2669](https://github.com/ruvnet/ruflo/issues/2669): on Windows, `cmd.exe`/`bash.exe`/`conhost.exe` console windows flash briefly on every hook fire and every statusline refresh. The upstream root cause is **[anthropics/claude-code#70200](https://github.com/anthropics/claude-code/issues/70200)** — `claude.exe` spawns hook/statusline child processes without the Win32 `CREATE_NO_WINDOW` flag (or Node's `windowsHide: true`). When the parent is a console-less process (Claude Desktop, or Windows Terminal's default-terminal delegation), every spawn creates a visible `conhost.exe` window that closes on exit.

**Ruflo cannot fix the upstream spawn.** `claude.exe`'s direct spawn of our hook wrapper / statusline command is entirely upstream-controlled — no flag ruflo sets on its own subprocess calls reaches that spawn. What ruflo *can* control is (a) how many times that spawn happens per session, and (b) whether any of *our* subprocess grandchildren (things our hook wrapper or statusline script itself spawns) add their own flashes on top.

Commit `c89a98a4f` (v3.29.0, closing several items from #2669's "what ruflo has done" table) already shipped the grandchild-level fixes:
- `windowsHide: true` on `statusline.cjs`'s `execSync` (CLI JSON delegation) and `safeExec` helper (sqlite/git subshells)
- `windowsHide: true` on `hook-handler.cjs`'s detached `spawn` (background funnel/context refresh)
- Statusline cache TTL bumped 60s → 300s (5x fewer statusline-triggered outer-wrapper fires)

Those are done and out of scope here. This ADR covers the two remaining *low-design-surface* follow-ups from #2669's open-items list — reducing the frequency and shell-depth of ruflo's own spawn-adjacent surface — as a single coherent decision, since neither needs its own invalidation/IPC design the way the cache (ADR-321) or daemon consolidation (ADR-322) do.

## Decision

### 1. Hook count audit + trim (`.claude/settings.json`)

Every registered hook command is one more `claude.exe → hook wrapper` spawn per triggering event — one more flash we cannot silence, only avoid triggering. `v3/@claude-flow/cli/src/init/settings-generator.ts`'s `generateHooksConfig()` (the generator that produces the default `.claude/settings.json` shipped by `ruflo init`) currently registers, when every optional category is enabled:

| Event | Hook commands | Notes |
|---|---|---|
| `PreToolUse` | 2 (`pre-bash` on `Bash`, `pre-edit` on `Write\|Edit\|MultiEdit`) | Distinct matchers — not mergeable without losing the per-tool-type validation split |
| `PostToolUse` | 2 (`post-edit`, `post-bash`) | Same as above |
| `UserPromptSubmit` | 1 (`route`) | — |
| `SessionStart` | 2 (`session-restore`, auto-memory `import`) | Candidate for merge — see below |
| `SessionEnd` | 1 (`session-end`) | — |
| `Stop` | 1 (auto-memory `sync`) | — |
| `PreCompact` | **4** (2 matchers × 2 hooks: `compact-manual`+`session-end`, `compact-auto`+`session-end`) | Worst offender per #2669 |
| `SubagentStart` | 1 (`status`) | — |
| `SubagentStop` | 1 (`post-task`) | — |
| `Notification` | 1 (`notify`) | — |

The issue's baseline audit counted 27 across all installed variants (this repo's dogfooded `.claude/settings.json` has a different, non-default subset — 12 entries — because some categories are pre-trimmed already). Regardless of the exact starting count, the audit criterion is the same for every hook, applied per-event:

- **Keep as-is** if it does real work no other registered hook does (e.g. `route` on `UserPromptSubmit` — nothing else touches routing).
- **Merge** if two hooks on the same event do sequential, always-co-occurring work with no independent trigger condition — e.g. `PreCompact`'s `compact-manual`/`compact-auto` handlers both unconditionally chain into `session-end` right after. A single `hook-handler.cjs compact-manual` (or `-auto`) invocation that internally calls the same session-end persistence logic before returning removes one spawn per `PreCompact` fire without changing what gets persisted or when.
- **Delete** only if a hook is a genuine no-op on the triggering platform or has been superseded by daemon-side state (this is where ADR-322 feeds back into future trims of this table — a hook that only re-derives state the daemon now maintains becomes deletable once ADR-322 ships).

No hook is removed in this ADR merely to hit a lower number — the constraint from #2669 is explicit: **every deletion must be justified** (redundant, no-op on Windows, or superseded), never "fewer flashes at the cost of dropped behavior." The `PreCompact` merge above is the one change with a clear, safe justification available today; it is called out as the first concrete trim to implement, with the rest of the table re-evaluated by ADR-322 as daemon consolidation removes more per-event work over time.

### 2. Windows-native `statusLine` command (no shell hop)

`generateStatusLineConfig()` in `v3/@claude-flow/cli/src/init/settings-generator.ts` already special-cases `win32`: it emits a `node -e "<inline JS>"` one-liner that resolves `$CLAUDE_PROJECT_DIR` (with a `$HOME` fallback) *inside* Node rather than via shell substitution, and `require()`s the resolved script directly — this was the #1948/#1973 fix and already avoids the `sh -c 'exec node "$D/…"'` shell hop on Windows for **fresh inits**.

Two residual shell-hop paths remain, both still in scope for this ADR:

- The **POSIX branch** of the same function still emits `sh -c 'D="…"; […]; exec node "$D/${script}"'` (line ~273). This is correct behavior on POSIX (no flash concern there), but is worth tightening for consistency: `exec` replaces the shell process image rather than forking a grandchild, so on POSIX this is already a single-process handoff, not an extra spawn — no change needed here, noted only so a future reader doesn't assume it needs the same Windows treatment.
- **`executor.ts`'s migration constant `NEW_STATUSLINE_CMD`** (used to *repair* pre-#2337 installs whose `settings.json` still has the runaway `npx @claude-flow/cli@latest hooks statusline …` form) is itself a `node -e` one-liner, but its inline JS shells out via `child_process.execSync('git rev-parse --show-toplevel', …)` to resolve the project root — an extra spawn on *every* statusline fire, on every platform, Windows included. This is the concrete target for this ADR: replace the runtime `git rev-parse` spawn with a value resolved once, at migration/init time, and written into the command string (or a sibling config field) rather than re-derived on every fire.

  Sketch (pseudocode, no code change made by this ADR):
  ```
  // At init/migration time (executor.ts), not at statusline-fire time:
  const projectRoot = resolveProjectRootOnce();   // one git rev-parse, done once
  const NEW_STATUSLINE_CMD =
    `node -e "process.chdir(${JSON.stringify(projectRoot)});
              require(${JSON.stringify(join(projectRoot, '.claude/helpers/statusline.cjs'))})"`;
  ```
  If the project directory can move (repo relocated, worktree checked out elsewhere) this baked-in path goes stale — the existing `CLAUDE_PROJECT_DIR`-first / `$HOME`-fallback resolution order used by the `win32` branch of `generateStatusLineConfig()` is the safer general pattern and should be reused here instead of a hardcoded path: resolve `CLAUDE_PROJECT_DIR` from the environment (which Claude Code sets on every hook/statusline invocation) as the primary path, falling back to the migration-time-baked path only if the env var is absent. Either way, the `execSync('git rev-parse …')` spawn is removed from the hot path.

This ADR explicitly does **not** attempt to change how `claude.exe` itself spawns the statusline command — only what ruflo's own command string does once invoked.

## Consequences

### Positive
- Fewer spawns per triggering event without dropping observable hook behavior — directly reduces flash *frequency*, the only lever available to ruflo per the upstream constraint.
- Removes a real per-fire subprocess spawn (`git rev-parse` via `execSync`) from the statusline hot path, independent of the Windows flash issue — a latency and correctness win on every platform (no `git` dependency needed at statusline-fire time).
- Establishes a documented audit criterion (keep / merge / delete, always justified) other contributors can apply to future hook additions, preventing the hook count from silently growing back to 27+.

### Negative
- The `PreCompact` merge changes hook internals (`hook-handler.cjs compact-manual`/`compact-auto` gain an internal call to the session-end path) — needs test coverage to confirm persisted state is byte-identical to today's two-hook sequence before it ships.
- Baking a resolved project root into a migration-time constant (rather than always resolving fresh) reintroduces a staleness risk for relocated/moved repos; mitigated by preferring `CLAUDE_PROJECT_DIR` env-var resolution first, per the design above.

### Neutral
- Does not change anything about the upstream `claude.exe → hook wrapper` spawn — that remains entirely gated on #70200 landing upstream.
- Documentation of the Windows Console Host workaround and the verification rig are tracked as a parallel deliverable (`docs/install/windows.md`, `docs/reviews/windows-4688-audit-rig.md`), not part of this ADR's decision surface.

## Alternatives Considered

- **Do nothing until #70200 lands upstream.** Rejected: #2669's own acceptance criteria treat "ruflo hook count audited + trimmed" and "statusLine command changed to no-shell-wrapper form" as independent, shippable-now items regardless of upstream timeline — reducing spawn *frequency* is a real mitigation even though it can't reach zero.
- **Collapse all hook events into a single dispatcher hook** (one registration, internal event-name branching). Rejected for this ADR: while it would technically minimize registered-hook count further, it changes matcher semantics (Claude Code's per-tool `matcher` filtering happens before the hook fires; collapsing would move that filtering into ruflo's own process, meaning the spawn still happens for non-matching tool calls) — net negative for the goal (spawn triggers on filtered-out events too, not fewer). Left as a non-goal.

## References

- [Issue #2669](https://github.com/ruvnet/ruflo/issues/2669) — tracking issue, "What ruflo could still do" items 1 and 4
- [anthropics/claude-code#70200](https://github.com/anthropics/claude-code/issues/70200) — upstream root cause
- Commit `c89a98a4f` (v3.29.0) — prior-art grandchild-spawn fixes this ADR builds on
- `v3/@claude-flow/cli/src/init/settings-generator.ts` — `generateHooksConfig()`, `generateStatusLineConfig()`
- `v3/@claude-flow/cli/src/init/executor.ts` — `NEW_STATUSLINE_CMD` migration constant
- `docs/install/windows.md`, `docs/reviews/windows-4688-audit-rig.md` — parallel documentation deliverable (ruflo-docs:docs-writer)
