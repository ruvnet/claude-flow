# Changelog: ruflo-mods

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-mods`.

## 0.5.1 — 2026-10-10
- fix: the attention row says STALE when the console's summary is older than 15 minutes (three missed 5-minute heartbeats) or carries no believable time, so a closed console or a turned-off session workspace no longer shows its last counts as current (#3981)

## 0.5.0 — 2026-10-09
- feat: option `grounding` (default off): `/ruflo-mods` shows whether the optional third-party ruvnet-brain plugin is on, not installed, installed but disabled, or unknown; detect-only, no event hooked, nothing blocked or written (ADR-487)

## 0.4.0 — 2026-10-09
- feat: sessionAttention option (default off): one attention row in /ruflo-mods with the console's four counts (to approve, questions, failed, finished unread). Counts only; no gating behaviour changed (ADR-486).

## 0.3.16 — 2026-10-07
- feat: shared toast system with levels, dedupe, persistence and Settings (ADR-477)
- fix: a toast needs no engine.create (bind at session.start too), a throwing clock falls back to the wall clock; update the cost ladder expectati…

## 0.3.15 — 2026-10-07
- fix: decode $'...' escapes as bash does; adversarial and benign tables for the root-delete guard
- fix: trust gate judges a glob or a negation by what it selects
- fix: trust gate treats process.spawn, mcp.call/connect, session.send, config.set, prompt.submit and agent.spawn as risky; names a reload that ga…
- fix: capabilityProbe counts session.measure, agent.spawn and plugin.register only where the options hook them
- fix: stand down for legacy CLI `hooks route|post-edit` settings and check the %USERPROFILE% helper
- fix: keep main's Google-key and JWT matches when glued to a dash; no ^ at mid-line window starts
- fix: screen three readings so stripping or folding never glues a phrase to the word before it
- fix: screens stay linear on blank lines and repeated token starts; whitespace padding cannot straddle a window
- chore: and 15 more changes (git log -- plugins/ruflo-mods)

## 0.3.14 — 2026-10-05
- feat: Project Anatole plugin, tests, corpus gate, bench, fleet registration

## 0.3.13 — 2026-10-05
- fix: trust gate counts prompt.submit and agent.spawn as risky; ranked context drops control and bidi characters (0.3.13)

## 0.3.12 — 2026-10-05
- fix: reject a legacy or unknown-mode policy projection as unreadable; report shows the mode (ADR-450 T10), 0.3.12
- fix: print the probe label once in the /ruflo-mods report (0.3.10)
- chore: README rows cite the live options run and the source of the 76% figure

## 0.3.11 — 2026-10-05
- feat: sessionRollup ledger, one bounded counters record per session (ADR-451 item 6), 0.3.8
- chore: complete the option table, one row per userConfig key, with a smoke guard (0.3.11)

## 0.3.9 — 2026-10-05
- feat: compactCarry option carries swarm and claims state through compaction (ADR-451 item 7, 0.3.9)

## 0.3.8 — 2026-10-05
- feat: sessionRollup ledger, one bounded counters record per session (ADR-451 item 6), 0.3.8
