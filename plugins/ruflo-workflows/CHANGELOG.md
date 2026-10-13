# Changelog: ruflo-workflows

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; older versions: `git log -- plugins/ruflo-workflows`.

## 0.6.7 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.6.6 — 2026-10-11
- fix: skills gaia-submission and gaia-debugging named MCP tools that do not exist (`hooks_post_task`, `hooks_pre_task`, `agentdb_pattern_search`, `agentdb_pattern_store`); the real names use a hyphen, so the tools were never pre-approved
- fix: `gaia-bench run` has no `--dry-run` or `--task-id` (unknown flags are ignored, so the documented cost-estimate and 1-question check started a real, billed run); docs now say so and give a cost estimate path that does not spend, `--voting` corrected to `--voting-attempts`
- chore: smoke-gaia.sh expected version 0.4.0 and component arrays in plugin.json (both obsolete, 2 checks failing since 0.6.x); it now checks semver >= 0.4.0 and that no component arrays are declared
- fix: workflow-run asks for the user's opt-in before starting a native workflow and states how many agents it will start

## 0.6.5 — 2026-10-09
- chore: drop the unused `components` key from plugin.json (claude.ai plugin validator warns on it; nothing read it)

## 0.6.4 — 2026-10-07
- feat: workflow-create documents the two ADR steps (requires ADR, records ADR) that use the project's own ADRs through ruflo-console's ADRs page (ADR-480)

## 0.6.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.6.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.6.1 — 2026-10-04
- fix: live-check W5 — guards read key names and every field; trader gates the package's real order tools

## 0.6.0 — 2026-10-04
- feat: function-hook mod (guard, status file, local slash command)

## 0.5.1 — 2026-07-16
- fix: harden hooks, statusline, security, and plugin MCP integration

## 0.5.0 — 2026-07-03
- feat: pre-submission exploit audit + signed attestation (ADR-167)
- chore: darwin-plugins iter 1 — ruflo-workflows: add 'Use when' trigger to gaia-debugging skill (ADR-112)

## 0.4.0 — 2026-05-29
- fix: stale route cache + --explore false (3.10.8)

## 0.3.0 — 2026-05-27
- fix: #2156 iter 53a — narrow T2 extraction to fix iter 52b regression
- chore: bulk-update plugin contract ADR statuses (sweep)
