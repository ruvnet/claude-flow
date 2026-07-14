# ADR-321: Cross-event foreground-window / PID snapshot cache

- **Status**: Proposed
- **Date**: 2026-07-14
- **Deciders**: ruv
- **Related**: [ADR-320](ADR-320-windows-console-flash-residual-mitigation.md) (umbrella decision this ADR was split out of — real design surface: invalidation, races, disk layout), [ADR-322](ADR-322-daemon-based-state-probing-consolidation.md) (daemon becomes the cache *writer* instead of hooks, reusing this ADR's schema and file), pattern reference: clawd-on-desk#627/#630/#672

## Context

Tracking issue [#2669](https://github.com/ruvnet/ruflo/issues/2669), item 2 of "what ruflo could still do." High-frequency hook events — `PreToolUse`, `PostToolUse`, `SubagentStop` — fire many times per minute during normal tool use. Each fire is a `claude.exe → hook wrapper` spawn we cannot silence (upstream [anthropics/claude-code#70200](https://github.com/anthropics/claude-code/issues/70200)), but any *additional* work that wrapper does — including its own subprocess spawns for state-probing (foreground window, process tree, git status) — adds further spawns/flashes on top of the one we can't avoid.

The reference fix pattern is **clawd-on-desk#627** (PR #630, hardened in #672): rather than have every hook event re-spawn a probe (there, PowerShell) to sample foreground-window/process-tree state, that fix introduced a cross-process **PID-snapshot cache** — a per-session file, invalidated on session boundaries, that high-frequency hooks read instead of spawning. The residual flash was eliminated entirely once the *sampling* itself moved into a GUI-hosted process that never creates a console child (see ADR-322, which extends this cache with a non-spawning writer).

This ADR is the cache half of that pattern on its own: the data model, invalidation rules, and concurrency handling for a **read side** that any hook can consult for $0 (no spawn). It intentionally does not yet specify who *populates* the cache on a cold/stale read — that's answered two ways depending on maturity: (a) the hook that needs fresh data populates it itself (one spawn, same as today, but now shared across all subsequent readers until it goes stale — still a net reduction), or (b) ADR-322's daemon populates it out-of-band, so hooks are cache-only 100% of the time. This ADR ships (a) as the immediately achievable step; ADR-322 upgrades to (b).

## Decision

### Storage location

`.claude-flow/session/<session-id>/foreground-snapshot.json` — scoped per-session (not per-workspace, not global) so two concurrent Claude Code sessions in the same repo never share or corrupt each other's snapshot, and so a stale snapshot from a crashed session can't leak into a new one. `<session-id>` is the same session identifier already threaded through `SessionStart`/`SessionEnd` hook payloads (`hook-handler.cjs session-restore` / `session-end` already receive it). Directory created lazily on first write; never assumed to pre-exist.

### Schema

```json
{
  "_ts": 1752500000000,
  "_pid": 41272,
  "foregroundWindowTitle": "…",
  "foregroundProcessName": "claude.exe",
  "processTree": [ { "pid": 41272, "ppid": 8891, "name": "claude.exe" } ],
  "gitStatusSummary": { "uncommittedCount": 3, "branch": "main" },
  "sampledBy": "hook:pre-tool-use" 
}
```

`_ts` and `_pid` are load-bearing: `_ts` drives TTL-based staleness (see below); `_pid` records which OS process produced the sample so a reader can detect "the process that wrote this no longer exists" as a second, independent staleness signal (crash detection) distinct from simple TTL expiry. `sampledBy` is diagnostic only (which hook/component populated this snapshot last), useful when auditing whether ADR-322's daemon-side writer has actually taken over from hook-side writes.

### Invalidation rules

1. **`session-start`**: delete (not just ignore) any snapshot file for a session id that is starting fresh — a snapshot surviving from a *previous* session under the same id (should not happen given session ids are unique per launch, but defends against id reuse or manual testing) must never be read as current.
2. **`session-end`**: delete the snapshot file. A completed session's snapshot has no reader left; leaving it on disk only risks a future bug reading garbage state. `.claude-flow/session/<id>/` itself may remain (other session artifacts may live there) but `foreground-snapshot.json` specifically is removed.
3. **TTL within a live session**: a snapshot older than `FOREGROUND_SNAPSHOT_TTL_MS` (proposed default: 2000ms — short enough that foreground-window/process-tree state doesn't visibly lag behind reality, long enough that back-to-back `PreToolUse`→`PostToolUse` pairs on the same tool call share one sample) is stale. A stale read is treated as a cache miss, not an error — the reading hook either (a) repopulates it itself (interim state, this ADR) or (b) treats "stale + no daemon" as "no data available, degrade gracefully" (never blocks the tool call on a spawn it was trying to avoid).
4. **PID-mismatch invalidation**: if `_pid` no longer corresponds to a live process (checked via a $0 local liveness check, not a spawn — e.g. `process.kill(pid, 0)` semantics on POSIX, or the already-open handle table on Windows if available; never a `tasklist`/`ps` spawn just to check this), treat the snapshot as stale regardless of `_ts` — this is the crash-detection path: a hook wrapper that died mid-write, or a daemon that was killed, leaves a snapshot whose producer is gone.

### Concurrency / races between hooks firing "simultaneously"

Claude Code can fire multiple hook events in close succession (e.g. `PreToolUse` for a batch of tool calls queued back-to-back). Two hazards:

- **Read-during-write tear**: a reader seeing a partially-written JSON file. Mitigated by **write-to-temp-then-rename** — every writer (hook or, later, daemon) writes to `foreground-snapshot.json.tmp-<random>` and `fs.renameSync`s over the real path; POSIX and Windows both make rename atomic within the same filesystem, so no reader ever observes a half-written file. This is the same pattern the codebase already uses in `funnel/state.ts`'s `readStateJson`/`writeStateJson` helpers (reused here, not reinvented — see ADR-316 for the existing convention this follows).
- **Concurrent writers racing to repopulate a stale cache**: two hook events both see a stale snapshot at nearly the same instant and both decide to repopulate. Without coordination this means two redundant spawns — not incorrect, but it defeats half the point (still fewer than "every hook always spawns," but not the ideal "one spawn refreshes it for everyone"). Mitigated with a lightweight **claim file** (`foreground-snapshot.json.lock`, created with the OS-level exclusive-create flag — `wx` in Node's `fs` flags — which atomically fails if the file already exists): a hook that successfully creates the lock proceeds to spawn-and-repopulate; a hook that fails to create it (lock already held) falls back to reading the existing (stale-but-present) snapshot rather than spawning a second time, accepting slightly-stale data over a redundant spawn. The lock is removed after the write-then-rename completes, and is itself given a short dead-man TTL (checked via `_ts`-in-lock-file, same pattern) so a crashed holder can't wedge future refreshes forever.

### Consumers

`PreToolUse`, `PostToolUse`, `SubagentStop` handlers in `hook-handler.cjs` become **cache-only, zero-spawn on a hit**: read the snapshot, check `_ts`/`_pid` staleness per the rules above, use the data if fresh, or degrade to "no foreground/process-tree signal available this fire" if stale and no writer claims the refresh. Nothing in these handlers should block waiting for a fresh sample — staleness is an acceptable-degradation path, never a synchronous spawn-and-wait inserted into a latency-sensitive hook.

## Consequences

### Positive
- The three highest-frequency hook events become genuinely zero-spawn on a cache hit — the single biggest lever available against flash *frequency* short of the upstream fix.
- Write-to-temp-then-rename and the lock-file claim pattern reuse primitives already present in the codebase (`funnel/state.ts`), so this isn't a new persistence mechanism, just a new schema/TTL policy layered on an existing one.
- Sets up ADR-322 cleanly: the daemon can become the sole writer of this exact file/schema without any reader-side change, once it exists.

### Negative
- Introduces genuine cache-staleness UX: a hook consuming a 2-second-old foreground/process-tree sample is, by construction, sometimes wrong. Every consumer must treat this data as "recent-ish signal," never as ground truth for anything correctness-critical (a real risk if a future feature naively assumes freshness).
- Adds a new per-session directory (`.claude-flow/session/<id>/`) and cleanup responsibility (session-end deletion) — a leaked directory from a crashed session (no `session-end` fired) is a small but real disk-hygiene cost; acceptable given the existing `.claude-flow/` tree already accumulates similar per-session artifacts.
- The lock-file claim mechanism adds a small amount of complexity (dead-man TTL, `wx`-flag semantics differing subtly across platforms) for a benign failure mode (redundant spawn, not incorrect data) — worth it only because redundant spawns are exactly the flashes this ADR exists to reduce.

## Alternatives Considered

- **In-memory cache inside a long-lived process** instead of a JSON file. Rejected as the sole mechanism: hooks are short-lived subprocesses spawned fresh per event (no persistent process to hold memory) — that's precisely the shape of process that ADR-322's daemon *is*, so an in-memory cache is really "ADR-322, done early," not an alternative to this ADR's file-based cache. This ADR's file cache is what makes ADR-322 a drop-in upgrade rather than a rewrite.
- **No TTL, invalidate purely on explicit events** (session-start/end only). Rejected: foreground-window and process-tree state genuinely changes within a session (user alt-tabs, spawns other apps) — a cache with no time-based staleness would silently serve arbitrarily-old signal for an entire session, which is worse than the flash it's trying to avoid trading against.
- **Global (not per-session) snapshot file.** Rejected: two concurrent Claude Code sessions in the same repo (a common ruflo dev pattern per this repo's own CLAUDE.md — "concurrent-session helper corruption" caution) would stomp each other's snapshot; per-session scoping avoids that class of bug entirely at negligible extra cost (one small JSON file per session, cleaned up on `session-end`).

## References

- [Issue #2669](https://github.com/ruvnet/ruflo/issues/2669) — tracking issue, "what ruflo could still do" item 2
- [anthropics/claude-code#70200](https://github.com/anthropics/claude-code/issues/70200) — upstream root cause
- clawd-on-desk#627 / PR #630 / #672 — the cross-process PID-snapshot cache pattern this ADR adapts
- `v3/@claude-flow/cli/src/funnel/state.ts` — existing `readStateJson`/`writeStateJson` write-to-temp-then-rename convention, reused here
- [ADR-316](ADR-316-advisor-copilot-tip-insight-ticker.md) — prior art for the `~/.ruflo/*.json` / `readStateJson` state-file convention this ADR follows the spirit of (session-scoped variant)
- [ADR-322](ADR-322-daemon-based-state-probing-consolidation.md) — daemon-side writer that upgrades this cache from "shared, hook-populated" to "always fresh, zero hook spawns"
