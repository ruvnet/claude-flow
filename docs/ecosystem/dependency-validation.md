# Dependency integration validation

Validated on October 18, 2026 against candidate source `751c3e3c5c70d1c3dcdea233223c118259df0cad`. This records source and fixture checks, not an npm release.

| Check | Result |
| --- | --- |
| Public registry inventory | 401 of 401 package manifests captured; 1,178 total edges, 470 internal edges, 231 required internal edges |
| Graph planning | Blocked by the `strange-loops` / `sublinear-time-solver` package name declaration cycle; ranges target different majors, so this is not a demonstrated resolved installation cycle |
| Focused Node contracts | 28 passed, zero skipped on Node 20.20.2 with TypeScript 5.9.3 and Node 24 with built-in type stripping |
| Existing doctor and Weight EFT suites | 27 passed after building the workspace CLI core dependency |
| Required installed Weight EFT test | 1 passed, zero skipped against actual `@metaharness/weight-eft@0.1.2` |
| Root installation | `npm ci --ignore-scripts --omit=optional --no-audit --no-fund` passed, 606 packages |
| Workspace installation | pnpm 8.15.0 frozen lockfile install with lifecycle scripts disabled passed |
| Builds | Security, shared, swarm, CLI core and CLI passed; security OAuth verifier checked 10 exports |
| Release preparation | Builds and stages internal runtime packages and console; stops at the required helper signing step because the signing key is unavailable |
| Version and dependency audits | Three umbrella packages remain at 3.57.0; exact wrapper pin and optional/peer overlap audit pass |

The async vector fixture fails against the previous adapter because it observes zero vectors before insertion finishes. The candidate awaits insert and delete, propagates backend errors and retains the missing-package fallback. This is deterministic adapter coverage, not native binary compatibility or speed evidence.

The previous Weight EFT loader fails two new contract checks by accepting an incomplete API or choosing it over a complete default export. The candidate checks all five functions. The installed-package test actually produces SFT and DPO rows, excludes a held-out record, creates both training plans and evaluates controlled outcomes. The evaluation values are synthetic fixtures, not measured model improvements.

CI runs the focused contracts on Node 22 and 24. A separate required integration step installs the exact Weight EFT package without lifecycle scripts. Missing dependencies fail that step instead of silently passing.

## Reproduce

```bash
node --test scripts/tests/ecosystem-dependency-graph.test.mjs \
  scripts/tests/ecosystem-runtime-contract.test.mjs \
  scripts/tests/keychain-optional-binding.test.mjs \
  scripts/tests/root-publish-capability-parity.test.mjs \
  scripts/tests/ruvector-native-adapter.test.mjs \
  scripts/tests/weight-eft-api-contract.test.mjs \
  scripts/__tests__/stage-internal-runtime-bundles.test.mjs
RUFLO_WEIGHT_EFT_REQUIRED=1 node --test scripts/tests/weight-eft-installed.test.mjs
node scripts/audit-umbrella-version-lockstep.mjs
node scripts/audit-package-dep-overlap.mjs
```

Node 20 requires the installed TypeScript development dependency for source fixtures. Node 22 and 24 use built-in type stripping. The installed integration requires Weight EFT to resolve from the checkout, or an explicit `RUFLO_WEIGHT_EFT_RESOLVE_FROM` absolute path to an isolated installation's `package.json`.

## Remaining release gates

The ruOS vault reports an `NPM_TOKEN` entry, but neither checked executor has an injected token or authenticated npm session. The existing helper signer is also unavailable. No secret values were displayed and no packages or dist tags were changed.

Before release: select an unused version and bump all three umbrella packages plus the exact wrapper pin; refresh locks; review the source; run canonical preparation with the existing signing identity; build and inspect all three archives; verify independent consumer installs with optional dependencies present and absent; then publish the scoped CLI, `claude-flow` and `ruflo` in that order and verify all registry artifacts and tags. A preparation receipt must never be manufactured to bypass signing.
