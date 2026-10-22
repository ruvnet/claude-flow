# Changelog: ruflo-browser

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.3.6 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.3.5 — 2026-10-11
- fix: browser-login and browser-auth-flow read `document.cookie` straight into the model's context before any AIDefence gate, and `document.cookie` cannot see HttpOnly cookies, Secure, SameSite or expiry. They now return only cookie names, lengths and entropy, and cookie-flag checks read Set-Cookie headers or are marked not-assessed
- fix: browser-auth-flow now requires authorization to test the target
- fix: the lifecycle tools (`browser_session_record`/`_end`/`_replay`, `browser_template_apply`, `browser_cookie_use`) were documented as planned or unimplemented; they ship in the CLI, with replay and template returning data for the caller to execute and cookie_use returning a handle record only
- fix: browser-scrape no longer claims removal in v0.3.0 (the plugin is past it); ruvector pin 0.2.25 -> 0.2.27 to match the CLI

## 0.3.4 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.3.3 — 2026-10-04
- feat: guard secret-bearing MCP tools named in ADR-450 T6
- chore: bump the six plugins whose version collided with main after merge

## 0.3.2 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.3.1 — 2026-10-04
- fix: live-check guard defects in 8 plugins (adr, ddd, federation, deepseek, browser, bbs, chatgpt, pods)

## 0.3.0 — 2026-10-04
- feat: bbs-federation, browser, business-pods, chatgpt-federation as mods (ADR-445 pattern)

## 0.2.1 — 2026-07-16
- feat: memory distillation self-learning loop (ADR-174) + page-agent browser intent (ADR-175)
- fix: harden hooks, statusline, security, and plugin MCP integration
- fix: #2015 round 2 — strip bogus --kind flag, ship alpha.42
- fix: #1880, #2019, #2015 — three precondition/contract fixes + CI guards
- chore: darwin-plugins iter 2 — ruflo-browser: fix stale tool count (18 interaction + 5 lifecycle, not 23+5)
- chore: #2041 link plugin to ADR-122 substrate
- chore: aidefence 2.3.0 surface in ruflo-aidefence/-browser/-federation READMEs

## 0.2.0 — 2026-05-04
- feat: v0.2.0 session-as-skill architecture + ADR-0001
- feat: add 10 new ruflo plugins, optimize all 32, add READMEs and user guide
- fix: rename plugin commands to avoid built-in conflicts; bump default Opus to 4.7

## 0.1.0 — 2026-04-27
- feat: add 19 Claude Code native plugins with 64 skills, 25 commands, 21 agents
