# ADR-323: Single Source of Truth for `RUFLO_HELPERS_PUBKEY`

- **Status**: Proposed
- **Date**: 2026-07-15
- **Deciders**: ruflo core
- **Issue**: [#2675](https://github.com/ruvnet/ruflo/issues/2675)
- **Related**: [ADR-322](ADR-322-sign-helpers-secret-capture-hardening.md) (sibling `sign-helpers.mjs` hardening ADR from the same rotation incident — that ADR fixes secret-*capture* at signing time; this ADR fixes pubkey *duplication* at verification time. Distinct problems, same script family, deliberately not re-litigated here), [ADR-174](ADR-174-memory-distillation-self-optimization.md) (the Ed25519 helper-signing/auto-refresh mechanism both scripts serve)

> **Numbering note**: a local scan of `v3/docs/adr/` on this branch (freshly cut from `main`) reports **319** as the highest number in use. That check alone is insufficient — ADR-322 itself documents renumbering from 320→322 after colliding with PR #2687, and at the time of this draft the collision is still live: PR #2687 (`v3/docs/adr/ADR-320-*.md`, `ADR-321-*.md`) and PR #2678 (`ADR-320-*.md`, `ADR-321-*.md`, `ADR-322-*.md`, all three with *different* content than #2687's or this repo's ADR-322) are both open simultaneously, plus six independent "dream cycle" bot PRs all separately claim `ADR-179` for unrelated topics. I checked open PRs via `gh pr list --state open --limit 100` (twice, covering ~130 PRs total) and inspected `gh pr diff --name-only` for every PR whose title referenced an ADR number, to confirm no open PR currently claims `ADR-323` or higher — none did, and a text search (`gh search prs "ADR-323"` through `"ADR-330"`) found no matches either. Given the density of collisions already observed at 320–322, this is a best-effort check, not a guarantee: another agent could claim 323 in a PR opened after this scan. Whoever accepts this ADR should re-run the same check immediately before merge.

## Context

`RUFLO_HELPERS_PUBKEY` — the Ed25519 public key that authenticates the signed helpers manifest (ADR-174) — is declared as an identical string constant in two places:

- `v3/@claude-flow/cli/src/init/helper-signing.ts` — the runtime verifier, used by the CLI's auto-refresh path (`autoRefreshHelpersIfStale`) to validate helpers before writing them into a user's project.
- `v3/@claude-flow/cli/scripts/verify-helpers.mjs` — the `prepublishOnly` verifier, run at publish time (after `sign-helpers.mjs`) to fail the release closed if the on-disk manifest doesn't match what's shipping.

Both copies carry a `// KEEP IN SYNC` comment and must be updated together on every key rotation. During the 2026-07-14 rotation (v3.29.0, PR #2673, prompted by the private key leak documented in ADR-322's Context) updating both copies correctly was a manual, easy-to-miss step — the issue reports it "almost" went out of sync. Missing one copy produces a silent split: the on-disk manifest verifies against the runtime pubkey but fails the prepublish check (or vice versa), which either blocks a legitimate publish or — worse — ships a manifest that the *runtime* verifier can't validate, causing `autoRefreshHelpersIfStale` to fail-closed with a tamper warning for every user who installs that version (the exact failure shape of issue #2593 / ADR-174's original regression, for an unrelated root cause).

**A relevant fact this ADR does not act on but must record**: an unreviewed, unmerged PR (#2684, `loop/T1-consolidate-pubkey`) already exists implementing the issue's literal suggestion — importing `RUFLO_HELPERS_PUBKEY` from `../dist/src/init/helper-signing.js` in `verify-helpers.mjs`. It was produced by an autonomous local-LLM loop ("maker=local-coder, verifier=local-verify"), is not merged, and — notably — its diff also silently drops `'statusline.cjs'` from `verify-helpers.mjs`'s `CRITICAL` array (four entries on `main` today, three in that PR), an unrelated regression introduced incidentally while making the "obvious" fix. That PR is evidence *for* doing this consolidation (the fix is small and mechanical enough that an autonomous loop reached for it unprompted) and *against* merging it as-is without the scrutiny this ADR provides.

## Decision

Extract `RUFLO_HELPERS_PUBKEY` to a **plain `.js` file**, not a compiled-TypeScript re-export. Concretely: create `v3/@claude-flow/cli/src/init/helpers-pubkey.js` (plain ES module, no TypeScript syntax) holding the constant, then:

- `src/init/helper-signing.ts` imports it: `import { RUFLO_HELPERS_PUBKEY } from './helpers-pubkey.js';` and re-exports it (keeping `helper-signing.ts`'s existing public export surface unchanged for any other consumer already importing `RUFLO_HELPERS_PUBKEY` from there).
- `scripts/verify-helpers.mjs` imports the same file directly: `import { RUFLO_HELPERS_PUBKEY } from '../src/init/helpers-pubkey.js';` — no `dist/` in the path at all.
- `scripts/sign-helpers.mjs` does not need the pubkey (it only ever handles the private key), so it is unaffected.

This makes `helpers-pubkey.js` the single source of truth; both consumers point at the same bytes on disk, with no compilation step between "the source of truth" and "what `verify-helpers.mjs` reads."

### Why this over the issue's proposed dist-import (Alternative 1)

The issue's own suggestion — `import { RUFLO_HELPERS_PUBKEY } from '../dist/src/init/helper-signing.js';` — is **technically sound as far as path resolution goes**, and I verified this rather than taking it on faith:

- `tsconfig.json` sets `outDir: "./dist"`, `rootDir: "."`. Compiling `src/init/helper-signing.ts` produces `dist/src/init/helper-signing.js`. From `scripts/`, `../dist/src/init/helper-signing.js` resolves to exactly that file. The path in the issue is correct.
- No script in this package currently imports from `dist/` internally (confirmed by grep across `scripts/`), but `package.json`'s `exports` map already publishes `"./dist/*": "./dist/*"` as a public subpath contract — so dist-relative imports aren't a wholly novel pattern for this package, just a new one for its own build scripts.
- `prepublishOnly` does run `sign-helpers.mjs` then `verify-helpers.mjs` in that order today (confirmed by reading `package.json` directly), so *within* `prepublishOnly`, `sign-helpers.mjs` having already run doesn't help — what matters is whether `dist/` exists and is current when `prepublishOnly` fires at all. That is **not** an npm-lifecycle guarantee: this package has no `prepare` script, so nothing forces `npm run build` before `npm publish`. It is a *documented human/CI convention* only (`CLAUDE.md`'s publish playbook runs `npm run build` immediately before `npm publish`). If someone runs `npm publish` directly against an unbuilt or stale tree, the dist-import either throws `ERR_MODULE_NOT_FOUND` (missing `dist/`) or silently reads a stale pubkey (present but outdated `dist/`, e.g. mid-rotation). I traced both failure modes: both are fail-closed in effect (a missing-dist crash aborts `prepublishOnly`; a stale pubkey causes the Ed25519 check to fail against a signature made with the current private key), just with a worse error message than the script's own clean `die()` calls in the missing-`dist` case.
- The decisive finding, though, is `verify-helpers.mjs`'s own documented standalone usage: its header comment says "Optional arg: path to a helpers dir (e.g. an extracted `npm pack` tarball)" — i.e. this script is meant to be runnable on its own, outside a full `prepublishOnly` chain, against an arbitrary checkout (CI verification job, manual audit of a published tarball, etc.). In a fresh clone or a CI job that hasn't run `npm run build`, a `dist/`-relative import breaks that standalone use case outright; a plain-`.js`-file import does not, because it never depends on `tsc` having run. This is a real, load-bearing use case the dist-import approach would silently regress, not a hypothetical.
- Separately: `helpers-manifest-guard.yml` (the CI guard for this script family) only does static `package.json`/string checks today — it does not actually execute `verify-helpers.mjs` against a built or unbuilt tree, so a `dist`-import regression of the kind above would not be caught by existing CI as it stands.

Given both approaches are equally correct on the happy path, and the plain-`.js`-file approach has no failure mode the dist-import approach has, dist-import buys nothing here — it's an unforced dependency on build ordering, in a script whose own documentation promises it doesn't need one.

**Feasibility of the plain-`.js` approach in TypeScript**: this package's `tsconfig.base.json` sets `moduleResolution: "bundler"`, and `src/init/*.ts` already imports sibling `.ts` files via `.js`-suffixed relative paths as its established convention (e.g. `executor.ts` imports `from './settings-generator.js'`, `from './helper-refresh.js'`, etc., all of which are `.ts` source files resolved through their compiled-`.js` name). Importing an actual plain `.js` file the same way (`from './helpers-pubkey.js'`) is consistent with that existing pattern, not a new one.

## Alternatives considered

- **Import from `dist/` (the issue's original proposal).** Rejected — see above: no functional advantage over the plain-`.js` file, and it silently breaks `verify-helpers.mjs`'s documented standalone/tarball-verification usage in any environment where `dist/` isn't freshly built (CI job, ad hoc audit, fresh clone), a real regression risk with no compensating benefit.
- **Leave both copies as-is, rely on the `// KEEP IN SYNC` comment.** Rejected — this is the status quo the issue reports as an actual near-miss during the 2026-07-14 rotation; comments are not enforced.
- **Add a CI check that diffs the two hardcoded constants for byte-equality, without removing the duplication.** Rejected as insufficient on its own — it would catch drift after the fact but doesn't remove the two-places-to-remember burden this issue is about; could be a *complementary* CI hardening (see Validation) but not a substitute for a single source.
- **Merge PR #2684 as-is.** Rejected for this ADR — that PR implements the dist-import path this ADR argues against, and separately drops `'statusline.cjs'` from `CRITICAL` (an unrelated regression), so it should not be merged without revision regardless of which pubkey-consolidation approach is accepted.

## Consequences

**Positive**:
- One file (`helpers-pubkey.js`) is the only place `RUFLO_HELPERS_PUBKEY` bytes live; a key rotation touches exactly one file plus the manifest re-sign, removing the class of near-miss the issue reports.
- No new build-order dependency: `verify-helpers.mjs` can run standalone against any checkout, built or not, preserving its documented tarball-verification use case.
- `helper-signing.ts`'s existing export surface (`export const RUFLO_HELPERS_PUBKEY`) is unchanged for any other consumer, since it re-exports rather than requiring callers to switch import paths.
- Behavioral parity is exact — the imported constant is byte-identical to what's hardcoded today; no signature-verification behavior changes.

**Negative / trade-offs**:
- Introduces one plain-`.js` file inside an otherwise all-TypeScript `src/init/` directory — a minor stylistic inconsistency, mitigated by keeping the file to a single exported constant with no logic.
- `PR #2684` (already open, unreviewed) implements the rejected dist-import alternative; landing this ADR's approach means that PR needs to be closed or substantially revised rather than merged as-is — a small amount of coordination overhead this ADR creates.
- Does not, by itself, add CI enforcement that the single source stays byte-identical to whatever gets signed — that risk is structurally reduced (one file, not two) but not mechanically verified. Deferred to Validation/implementation, not blocking this decision.

## Validation

1. **Byte-identity**: after extraction, `diff <(node -e "console.log(require('./src/init/helpers-pubkey.js').RUFLO_HELPERS_PUBKEY)") <(node -e "console.log(require('./dist/src/init/helper-signing.js').RUFLO_HELPERS_PUBKEY)")` (or the TS-source equivalent pre-build) confirms `helper-signing.ts`'s re-export matches the extracted constant exactly.
2. **Runtime verifier unaffected**: existing `helper-signing.ts` unit tests (manifest verify/reject cases) pass unchanged, proving the re-export preserves current behavior.
3. **Standalone invocation**: `node scripts/verify-helpers.mjs <path-to-extracted-tarball>` succeeds in a checkout where `npm run build` has *not* been run — the regression case the dist-import alternative would fail, and the specific scenario this ADR's approach is chosen to preserve.
4. **`prepublishOnly` end-to-end**: unchanged — `sign-helpers.mjs` then `verify-helpers.mjs` still both run and pass on a real rotation/publish rehearsal.
5. **(Optional hardening, not required for acceptance)**: extend `helpers-manifest-guard.yml` to actually execute `verify-helpers.mjs` (currently it only does static `package.json` checks), which would catch both this class of drift and any future accidental reintroduction of a duplicated constant.

## References

- Issue [#2675](https://github.com/ruvnet/ruflo/issues/2675) — this consolidation request.
- PR [#2673](https://github.com/ruvnet/ruflo/pull/2673) — the 2026-07-14 key rotation that surfaced the duplication risk.
- PR [#2684](https://github.com/ruvnet/ruflo/pull/2684) (open, unreviewed) — autonomous-loop implementation of the rejected dist-import alternative; also drops `statusline.cjs` from `CRITICAL` incidentally.
- [ADR-322](ADR-322-sign-helpers-secret-capture-hardening.md) — sibling hardening ADR from the same incident family (secret *capture*, not pubkey *duplication*).
- [ADR-174](ADR-174-memory-distillation-self-optimization.md) — the Ed25519 helper-signing/auto-refresh mechanism this constant authenticates.
- `v3/@claude-flow/cli/src/init/helper-signing.ts`, `v3/@claude-flow/cli/scripts/verify-helpers.mjs`, `v3/@claude-flow/cli/scripts/sign-helpers.mjs` — the three files in this script family.
- `.github/workflows/helpers-manifest-guard.yml` — existing static CI guard for this script family (issue #2593); does not currently execute either script.
