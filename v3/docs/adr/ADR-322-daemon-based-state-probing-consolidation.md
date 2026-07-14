# ADR-322: Daemon-based state-probing consolidation for hook events

- **Status**: Proposed
- **Date**: 2026-07-14
- **Deciders**: ruv
- **Related**: [ADR-320](ADR-320-windows-console-flash-residual-mitigation.md) (umbrella decision this ADR was split out of), [ADR-321](ADR-321-cross-event-foreground-window-snapshot-cache.md) (the cache schema/file this ADR becomes the authoritative writer for — depends-on), pattern reference: clawd-on-desk#672

## Context

Tracking issue [#2669](https://github.com/ruvnet/ruflo/issues/2669), item 3 of "what ruflo could still do": move per-event polling into the daemon rather than re-probing state inside every short-lived hook subprocess. Upstream root cause remains [anthropics/claude-code#70200](https://github.com/anthropics/claude-code/issues/70200) — `claude.exe` spawns hook/statusline children without `CREATE_NO_WINDOW`/`windowsHide`, and ruflo cannot reach that spawn. What ruflo controls is what happens *inside* the hook wrapper once spawned, and — per this ADR — whether the wrapper needs to spawn anything further at all.

ADR-321 defined a per-session, file-based cache (`.claude-flow/session/<id>/foreground-snapshot.json`) that lets high-frequency hooks (`PreToolUse`, `PostToolUse`, `SubagentStop`) become cache-only readers. It deliberately left open *who populates the cache*: interim option (a) was "the hook itself repopulates on a stale read" — still a spawn, just a shared and less-frequent one. This ADR is option (b): the `claude-flow` daemon (`npx claude-flow@v3alpha daemon start`, `WorkerDaemon` in `v3/@claude-flow/cli/src/services/worker-daemon.ts`) — already a long-lived background process with its own worker scheduling, TTL self-shutdown, and workspace scoping — becomes the sole prober, writing the same ADR-321 schema out-of-band on its own interval. Hooks then read a cache that is *never* their own responsibility to populate: true zero-spawn on every fire, not just on a cache hit.

This is the same "delete the mechanism, not just the symptom" reasoning cited in clawd-on-desk#672: rather than making the per-event spawn cheaper or less frequent (ADR-320, ADR-321's interim mode), remove the *reason* a hook would ever need to spawn a probe — the probing already happened, continuously, in a process that was never going to create a console window in the first place (a long-lived Node daemon has no more reason to flash than the daemon does today).

## Decision

### (a) Which per-event probes migrate

Everything ADR-321's snapshot schema covers, sourced from the daemon instead of from hook-side spawns:

| Probe | Today (hook-side) | Moves to (daemon-side) |
|---|---|---|
| Foreground window / process-tree sample | Ad hoc per triggering hook, per clawd-on-desk#627's original problem | Daemon's own interval-driven sampler, writing into ADR-321's `foreground-snapshot.json` |
| `git status` summary (uncommitted count, branch) | Re-run inline by any hook/statusline path that needs it (`safeExec` git subshells in `statusline.cjs`, per commit `c89a98a4f`) | Daemon polls once per interval, all consumers read the cached summary |
| PID / process-tree liveness | Per-hook liveness checks | Daemon already tracks its own workspace-scoped PID bookkeeping (`killStaleDaemons`, ADR-014 scope) — extend that bookkeeping to also stamp the shared snapshot |

Anything **not** already covered by ADR-321's schema (i.e., any daemon worker's own domain state — security scan results, swarm status, etc.) is out of scope here; those already have their own persistence (`~/.ruflo/*.json` state files per ADR-316's convention) and are not being re-architected by this ADR.

### (b) IPC / shared-file contract between hooks and daemon

**Decision: extend ADR-321's file, not a socket.** Considered a Unix-domain-socket / Windows-named-pipe request-response channel (hook asks daemon "give me fresh state," daemon replies) instead of a polling file. Rejected in favor of the file for three reasons specific to this codebase's constraints:

1. **No existing IPC primitive to build on.** A grep of the CLI source turns up no existing socket/named-pipe abstraction; every existing daemon-adjacent interaction (`daemon status`, `daemon trigger`) works by reading/writing files or by directly invoking `WorkerDaemon` APIs in-process, never by a wire protocol. Introducing sockets here would mean building and testing a new cross-platform IPC layer (Unix socket on POSIX, named pipe on Windows) whose only consumer is this feature — a large surface increase for a $0-cost problem the existing file convention already solves.
2. **A request-response channel reintroduces a wait.** A hook that has to open a socket and wait for a daemon reply is not meaningfully faster or safer than a spawn from the "will this add latency/flash risk" perspective if the daemon is slow to respond or the socket doesn't exist (daemon not running) — the hook still needs a graceful degrade path, and that path ends up looking identical to "read the cache file, and if it's missing, treat as no data" — so the file-read path has to exist regardless of whether a socket also exists.
3. **The file already has an owner and a schema.** ADR-321 already specified the file, its schema, its locking (write-to-temp-then-rename, `wx`-flag claim lock), and its per-session lifecycle. This ADR only needs to change *who holds the pen* — the daemon becomes the writer that ADR-321 left unspecified — not invent a new contract.

Concretely: the daemon, once a `foreground`/`state-probe` capability is enabled (opt-in, off by default — see Consequences), runs its sampler on a fixed interval (proposed default: same 2000ms as ADR-321's TTL, so a hook reading the cache almost never observes a stale-by-daemon read) and writes `.claude-flow/session/<id>/foreground-snapshot.json` using the exact write-to-temp-then-rename + `sampledBy: "daemon"` convention ADR-321 already defines. The daemon needs to know which session id(s) are currently active to know which per-session directories to write into — it discovers this the same way `killStaleDaemons` already discovers workspace-scoped daemons: by scanning `.claude-flow/session/*/` for directories with a live `SessionStart`-written marker, not by a new registration RPC.

### (c) Fallback when the daemon isn't running

This is not a degraded mode that needs special-casing — it is exactly ADR-321's existing "stale/missing cache" path. If the daemon is not running (never started, crashed, or terminated by its own TTL self-shutdown), no snapshot file exists or an existing one ages past its TTL with no new writes. Hooks fall back to ADR-321's interim behavior transparently: a hook that needs fresh data and finds the cache stale falls back to spawning its own probe (today's behavior), gated by the same claim-lock so concurrent hooks don't all spawn redundantly. **Nothing about hook correctness depends on the daemon being up** — the daemon is purely a latency/spawn-frequency optimization layered on top of a cache that already degrades safely to "spawn like today" on its own. This is the same posture the daemon already takes toward its other workers (`map`, `audit`, `optimize`, etc.): useful when running, never a hard dependency.

### (d) Windows-specific reachability caveats

The file-based contract sidesteps most cross-platform IPC concerns (a JSON file on disk works identically on Windows/macOS/Linux), but one open question is **not** resolved by this ADR and is called out explicitly as required follow-up before this ships as anything but opt-in/experimental on Windows:

- **Does the daemon actually start and stay running under Claude Desktop on Windows?** The daemon is normally started by the user via `npx claude-flow@v3alpha daemon start` from a terminal, independent of whether Claude Code/Desktop is running. On Windows specifically, if the daemon itself is started via a code path that goes through a shell wrapper without `windowsHide`, starting the daemon could itself produce one console flash (a one-time cost at daemon-start, categorically different from ADR-320/#2669's per-event flash problem, but still worth confirming is `windowsHide: true` end-to-end). More importantly: if a user's workflow only ever runs Claude Desktop without ever manually starting the daemon (a very plausible default), this entire ADR delivers zero benefit for that user until daemon auto-start (or a clearer prompt to start it) exists. **This is flagged as an open follow-up, not solved here** — a candidate future ADR would cover "should `ruflo init` or `SessionStart` offer to auto-start the daemon on Windows," which is a product-policy decision (background-process-on-every-session has its own cost/consent tradeoffs) out of scope for a pure state-probing-consolidation ADR.
- Named pipes were considered and rejected under (b) above for the IPC question generally; they are not revisited here as a Windows-only special case, since the file-based contract works uniformly and doesn't need a Windows-specific code path.

### (e) Composition with ADR-321

No schema or reader-side change. ADR-321 defined the snapshot format, its staleness rules, and its locking; this ADR only changes the writer from "whichever hook happened to need fresh data" to "the daemon, continuously, on its own schedule." The `sampledBy` field in ADR-321's schema (already present for exactly this reason) flips from `"hook:pre-tool-use"`-style values to `"daemon"` once this ships, making it possible to audit — via the snapshot file itself — whether a given session actually got daemon-backed zero-spawn reads or fell back to hook-side population.

## Consequences

### Positive
- The only architecture that reaches **true zero-spawn on every high-frequency hook fire**, not just "zero-spawn on a cache hit" — closes the loop ADR-321 opened.
- Reuses the daemon's existing lifecycle machinery (TTL self-shutdown, workspace scoping, `killStaleDaemons`) rather than inventing new process-management code.
- No new IPC surface to build, test, and cross-platform-harden — the file contract from ADR-321 is reused as-is.

### Negative
- Only benefits users who actually run the daemon. Given the daemon is opt-in and manually started today, this ADR's real-world impact is gated on daemon adoption — worth tracking as a metric before investing further here.
- Adds a new daemon capability (continuous state sampling) that itself consumes a small, constant amount of CPU/IO for as long as the daemon runs, for sessions that may not exist yet or may never trigger a high-frequency hook — mitigated by scoping the sampler to only run when at least one live session marker exists in `.claude-flow/session/*/`, and stopping cleanly when none do.
- The Windows daemon-reachability question in (d) is explicitly unresolved by this ADR; shipping this as anything beyond an opt-in experimental flag on Windows before that's answered risks users on Windows Desktop-only workflows getting no benefit while still paying the (small) daemon-sampler cost if they happen to have a daemon running for other reasons (workers, etc.).

### Neutral
- Does not change anything about the upstream `claude.exe → hook wrapper` spawn — unaffected by daemon state entirely, same posture as ADR-320/ADR-321.
- The daemon capability should be off by default and explicitly enabled (e.g. `daemon start -w foreground-probe` alongside the existing `map,audit,optimize,consolidate,testgaps` worker list), consistent with the existing consent-gated pattern for daemon workers with any continuous cost (`--headless` for AI workers is the precedent).

## Alternatives Considered

- **Unix socket / named pipe request-response IPC.** Rejected — see (b) above. Real cost (new cross-platform abstraction) for no correctness or latency win over the file-based contract, given hooks must have a no-daemon fallback regardless.
- **Daemon pushes updates via a filesystem watch (`fs.watch`) instead of hooks polling a TTL.** Rejected: hooks are short-lived processes that start, do one thing, and exit within milliseconds — there is no window in a hook's lifetime long enough to usefully register a watch callback. A one-shot synchronous read-with-TTL-check (ADR-321's existing design) is the only shape that fits a process that may not exist a moment later.
- **Daemon writes directly into hook-handler.cjs's in-memory state via a shared library import.** Rejected: hooks run as separate `node` subprocess invocations per event (per `hookHandlerCmd()` in `settings-generator.ts`), not as long-lived imports of a shared module instance — there is no shared heap to write into across process boundaries. A file is the only sharing mechanism available.

## References

- [Issue #2669](https://github.com/ruvnet/ruflo/issues/2669) — tracking issue, "what ruflo could still do" item 3
- [anthropics/claude-code#70200](https://github.com/anthropics/claude-code/issues/70200) — upstream root cause
- clawd-on-desk#672 — "delete the mechanism, not just the symptom" reasoning this ADR follows
- [ADR-320](ADR-320-windows-console-flash-residual-mitigation.md) — umbrella decision this ADR was split out of
- [ADR-321](ADR-321-cross-event-foreground-window-snapshot-cache.md) — snapshot schema, locking, and per-session lifecycle this ADR reuses as-is, becoming the authoritative writer
- `v3/@claude-flow/cli/src/services/worker-daemon.ts` — `WorkerDaemon`, existing TTL/workspace-scoping machinery this ADR extends
- `v3/@claude-flow/cli/src/commands/daemon.ts` — daemon CLI surface, `--headless`/worker-list precedent for opt-in continuous-cost workers
- Commit `c89a98a4f` (v3.29.0) — prior-art `windowsHide` fixes on the git-subshell probes this ADR's git-status migration references
