# Changelog: ruflo-chatgpt-federation

Newest first. One `## <version> — <date>` heading per version, then `feat:`, `fix:`, `breaking:` and `chore:` bullets (ADR-478). Built from git history; this is the whole history.

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
- feat: bbs-federation, browser, business-pods, chatgpt-federation as mods (ADR-445 pattern)

## 0.1.0 — 2026-09-12
- feat: OAuth 2.1 resource server, and retract the Cloud Run header claim
- feat: give ChatGPT Federation its own key and its own relay connection
- fix: name the reason when an unbound access token is refused
- fix: pin the signing-key version and refuse an unexpected identity
