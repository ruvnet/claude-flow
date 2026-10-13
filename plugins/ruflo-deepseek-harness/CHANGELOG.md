# Changelog: ruflo-deepseek-harness

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.2.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.2.4 — 2026-10-11
- docs: deepseek-chat and deepseek-reason state that the prompt and system text are sent to api.deepseek.com and that the key stays in the shell environment

## 0.2.3 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.2.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.2.1 — 2026-10-04
- fix: live-check guard defects in 8 plugins (adr, ddd, federation, deepseek, browser, bbs, chatgpt, pods)

## 0.2.0 — 2026-10-04
- feat: function-hook mod (secret guard, /deepseek-harness-mod, status file)

## 0.1.0 — 2026-09-10
- fix: address #3045 #3064 #3065 + new ruflo-deepseek-harness plugin (3.38.13)
- chore: surface v3.40.0 cross-host federation + claims
