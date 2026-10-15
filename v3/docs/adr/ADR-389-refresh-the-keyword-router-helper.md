# ADR-389 — Refresh the Keyword Router Helper on Upgrade

**Status**: Implemented (3.44.0)
**Date**: 2026-09-23
**Related**: ADR-174 (signed helpers manifest), ADR-390 (semantic router embedder), ADR-391 (router benchmark gate), #2257, #3401, PR #3402
**Surfaces**: `v3/@claude-flow/cli/src/init/helper-refresh.ts`, `v3/@claude-flow/cli/.claude/helpers/helpers.manifest.json`

## Context

Claude Code's prompt hook runs `~/.claude/helpers/hook-handler.cjs`, which loads
`router.js` from the same directory (`hook-handler.cjs:235`) to label each prompt
with a suggested agent. That router matched keywords as **substrings**:

- "sync and review la**test** issues" → `tester` at 0.8
- "are we **u**s**i**ng…" (typed as "uing") → `frontend-dev` via `ui`
- "**auth**or" → auth, "pre**fix**" → fix

The generator was fixed in #2257, and the remaining copies in PR #3402 (3.43.0).
**Installed copies never receive it.** The copy on the maintainer's own machine is
dated 2026-04-15, still matches substrings, and misrouted prompts throughout the
3.43.0 release session.

Why no install gets the fix: `helper-refresh.ts` only re-copies the helpers named
in `CRITICAL_HELPERS` (`auto-memory-hook.mjs`, `hook-handler.cjs`, `intelligence.cjs`,
`statusline.cjs`). `router.js` isn't on that list, and `init` skips files that
already exist. So once `router.js` is written, it's frozen.

The refresh already reaches the right place. It has a global pass for
`~/.claude/helpers/`, which the real CLI entry enables. The only gap is the list.

## Decision

1. Add `router.js` to `CRITICAL_HELPERS`.
2. Re-sign `helpers.manifest.json` in the same release. The refresh is fail-closed
   and refuses any helper without a signed hash (ADR-174), so the list change and
   the re-sign must ship together.
3. Leave `router.js`'s behaviour unchanged here. This ADR is only about delivery; the
   word-boundary logic already shipped in 3.43.0.

## Consequences

- Every existing install gets the word-boundary router on its next `ruflo` command,
  through the same signed, fail-closed path as the other four helpers.
- A user who hand-edited `router.js` will have it overwritten. The same is already
  true of `hook-handler.cjs`, and a hand-edited copy fails the hash check anyway.
- The release checklist gains nothing new. The re-sign already happens every
  release, because the manifest is pinned to the package version.
- **Risk:** the concurrent-session helper overwrite described in CLAUDE.md now
  covers one more file. Mitigation is unchanged: `git diff --stat` the helpers
  immediately before signing.

## Verification

- A unit test asserts `router.js` is in `CRITICAL_HELPERS` and in the signed manifest.
- Pack the CLI, install it into a directory that has a stale April `router.js`, run
  any `ruflo` command, and check that `router.js "sync and review latest issues"`
  no longer returns `tester`.
- `scripts/verify-helpers.mjs` reports 5 helpers.
