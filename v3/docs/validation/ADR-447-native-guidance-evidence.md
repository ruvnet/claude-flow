# ADR-447 verification evidence

Date: 2026-10-04
Issue: https://github.com/ruvnet/ruflo/issues/3701
Implementation revision: 1b620111832e26bc9b0dd19784cd641d434c9f0e
Initial implementation compatibility checks: 745503c3e57514e260cc50236ada4f7d8437401e
Baseline: 8ce24908c51c26aa859308bdb2e7e819e4f9fc88

## Execution and coordination

Codex owned the implementation. Three independent read only reviews covered
guidance contracts, mod security and end to end design. Ruflo coordinated through
a project scoped ledger using @claude-flow/cli 3.25.6, with the bridge disabled,
and a private Ruflo AI Team publication run. Ruflo coordination records do not
establish command execution.

ruOS executed the checks on an isolated checkout. Successful executor responses
reported completionVersion=1, completionVerified=true, status=ok and exitCode=0.
Those structured fields were checked alongside test assertions. No provider
inference, cloud model task or learning quality benchmark was run.

Versions: Node 20.20.2, TypeScript 5.9.3, Vitest 4.1.0, Claude Code 2.1.283.
Git on the follow-up ruOS executor: 2.43.0. Source checks require full or ordinary
shallow checkouts and refuse partial-clone/promisor configuration before object
reads. Controlled GIT_ALLOW_PROTOCOL prohibits every transport independently of
repository protocol overrides. SHA1 and SHA256 source fixtures both passed.
Claude Code 2.1.287 was installed separately for a compatibility check; it reported
that the function hooks rollout switch was off during the initial implementation.

## Measured results

| Check | Result | Scope |
|---|---|---|
| Native plugin validation | Passed | Real Claude Code module scanner, one handler per event, unchanged host capabilities |
| Configured native guidance smoke | 3 passed, 0 failed | Production hooks in a disposable explicitly configured fixture; not the complete native suite |
| Static security smoke | 11 passed, 0 failed | No hook process, network, model or MCP calls; tighten only guard; no automatic training or promotion |
| CLI adapter strict typecheck | Passed | mod-projection.ts and mod-sources.ts with strict, noEmit, NodeNext and the actual workspace safeGitArgv source |
| Source mod regression suites | 189 passed, 0 failed across 10 files | Includes 47 guidance contract, immutable source and filesystem cases; two built CLI tests excluded |
| CI ratchet regression tests | 8 passed, 0 failed | Existing ratchet report contracts with the Vitest runner |
| Dedicated GitHub guidance job | Passed | Locked root dependencies with lifecycle scripts disabled; adapter types, static security and all 189 source mod tests |
| Prior standard native suite on 2.1.283 baseline | 17 passed, 5 failed | At the initial baseline; existing cost, research and trust tests fail with this older kit |
| Prior standard native suite on 2.1.283 candidate | 19 passed, 7 failed | At 745503c; the five existing failures remain and two enabled guidance tests are affected by ignored per-test options |
| Prior standard native suite on 2.1.287 | Blocked by rollout gate | No passing result claimed; not rerun for the follow-up |
| Full repository build and native plugin typecheck | Not verified | Full build dependencies and generated native declarations were not present |
| Live model task quality or routing latency | Not measured | No improvement percentage or routing benchmark claimed |

The configured fixture changes only registration options and selects the three
enabled guidance tests. It preserves all production hook implementations.
scripts/native-guidance-smoke.sh reproduces this setup and cleans up its copy.
The standard suite separately covers disabled defaults; the source suite verifies
both enabled and disabled registration paths.

The two built CLI tests initially failed because dist/src/index.js was missing.
They were excluded from the source regression command, not counted as passing.

The dedicated check passed on the exact implementation revision:
https://github.com/ruvnet/ruflo/actions/runs/37233313563/job/111527374997
Its logs report 47 guidance cases, 189 tests and 10 files passed. This workflow
runs for every PR to main and every main push. Creating a passing job does not
change repository branch protection or establish the remaining native/build gate.
The new Claude Code native kit guidance file stays outside root Vitest and the
source E2E suite uses the dedicated CLI configuration; no failure baseline grew.

## Reproduction

From a checkout with the listed test tools installed:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin validate plugins/ruflo-mods
bash plugins/ruflo-mods/scripts/native-guidance-smoke.sh
bash plugins/ruflo-mods/scripts/smoke.sh
cd v3/@claude-flow/cli
tsc -p tsconfig.mod-guidance.json
vitest run __tests__/mods/ --exclude '**/mods-cli-bin.test.ts'
cd ../../..
vitest run scripts/__tests__/ci-test-ratchet.test.mjs
```

Before moving the PR out of draft, run the standard native suite and plugin
typecheck with a compatible enabled runtime, plus the normal CLI build and built
CLI tests in the repository's fully provisioned environment.

## Acceptance observations

The real filesystem lifecycle commits actual root and local guidance to a Git
fixture, then runs the actual guidance compile command with its full immutable
commit and the workspace compiler. It exports source digests and a projection,
attaches versioned advisory context,
records permission and failed execution counters, flushes once, then invokes the
actual mod-candidates command. The report stays pending independent verification.
Canonical source and the accepted guidance ledger stay untouched.

Additional cases cover all nine permission combinations, original rule and reason
preservation, corrupt advisory and enforced data, aborted and interrupted turns,
tool and turn replay, storage retry, corrupt queue recovery, concurrent flushes,
version changes, hidden guidance attribution, classic ownership, bounded retention,
credential shaped IDs and forged verification claims.

Follow-up acceptance adds dirty root/local bytes, missing and untracked explicit
overlays, foreign repositories, symlink files and ancestors, oversize input and
raw line-ending drift. Every failed export preserves a previous projection and
creates no replacement file. Empty committed overlays work; SHA256 repositories
reject 40 character abbreviations. Inherited Git overrides, replacement refs,
literal wildcard/option-like paths and invalid committed UTF8 are covered.
Deleted source blob fixtures with promisor and filter-only configuration fail
before invoking an allowed ext transport sentinel. Large valid projections write
compact serialized bytes within the native reader's limit; oversize replacements
are refused. Native projection and observation validators accept only full 40 or
64 character revision forms.

Review tests compare 1 error / 2 executions with 2 errors / 100 executions, retain
null for zero denominators, report aborted/interrupted turns, count unique global
observations across several displayed rules, and order version ties consistently.
Both global report and candidate groups remain unverified and learning ineligible.

An observation with a successful tool and the answer done still has verified=false
and learningEligible=false. Candidate review does not authorize trusted learning
or promotion. Independent task bound acceptance and held out evidence remain
required under existing governance.
