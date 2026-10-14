# Changelog: ruflo-music

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

## 0.2.5 — 2026-10-12
- fix: the shared text screen now catches `.env` and e-mailed credentials, no longer flags a model's token talk (`--max-tokens`, `/oauth/token`, "token usage"), and no longer flags values that only name where a secret lives (`./service-account.json`, `--set-secrets=NAME=NAME:latest`); every rule stays linear (#4094, thanks @proffesor-for-testing)

## 0.2.4 — 2026-10-11

- Security: `music-generate` attached the account bearer token to whatever `audio_url` a tool result returned; it now only sends it to `https://music.cognitum.one/` and otherwise shows the URL. `music-connect` pins `cogmusic@0.1.1` instead of `@latest` and tells the user to run the registration themselves so the token never enters the transcript.

## 0.2.3 — 2026-10-05
- fix: a domain plugin's refusal of another plugin's memory_store no longer claims the write (variant B, review #8)

## 0.2.2 — 2026-10-05
- fix: shared textsOf reports truncation and every guard fails closed on it

## 0.2.1 — 2026-10-04
- feat: vendor the flag option parser from one origin with the screen sync and drift check (review #2)
- fix: one iterative textsOf in the shared screen — depth, sibling, size caps, object keys and the invisible-character set fixed at the root (ADR-…
- fix: secret screen — a 20+ char value under a secret-named key is a secret even all-letter or UUID-shaped, unless a clear reference (ADR-445)
- fix: secret screen judges values, not names — fewer false positives, vendor keys, URL credentials, env assignments, 200 KB scan (ADR-445)
- chore: one source for the secret screen — sync-mod-screen.mjs regenerates the shared region of 37 screen.ts copies, --check in all-plugins-smoke (…

## 0.2.0 — 2026-10-04
- feat: migrations, music, neural-trader, observability as mods (tighten-only guard, /<x>-mod, status file)

## 0.1.0 — 2026-08-27
- feat: add ruflo-music plugin for Cognitum Music (cogmusic MCP)
