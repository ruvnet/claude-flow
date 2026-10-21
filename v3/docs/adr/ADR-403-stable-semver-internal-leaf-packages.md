# ADR 403: Stable Semver for Internal `@claude-flow/*` Leaf Packages

Status: Accepted — Implemented

Date: 2026 09 28

Related: #3530 (implementation and 3.48.0 release), #3414 (exact CLI pins), #3390 / #3335 (unpublished-leaf incidents), #3411 (leaked standalone `mcp` tarball), #3510 (superseded), #3531 (follow-up), ADR-100 (`cli-core`), ADR-378 (release automation)

## Context

The public train (`@claude-flow/cli`, `claude-flow`, `ruflo`) moved to stable semver at 3.7.0. The 18 internal leaf packages it depends on stayed on alpha pre-releases (`3.0.0-alpha.N`, `cli-core@3.7.0-alpha.N`, `plugin-*@1.0.0-alpha.N`). That split caused four concrete problems:

1. **`latest` was not a stable version.** Some leaves set `publishConfig.tag: "v3alpha"`, so a publish never moved `latest`. Direct consumers who ran `npm install @claude-flow/memory` got whatever `latest` last pointed at, which was an alpha.
2. **Tarballs leaked local state.** Seven leaves had no `files` allowlist, so npm packed the package directory as it was. Published alphas of `shared`, `plugins` and `mcp` contained `.claude-flow/` daemon logs and pids, `settings.json` and headless-worker logs. A scan found no credentials, only local paths.
3. **The workspace graph was not publishable.** `plugin-agent-federation` depended on `file:../security` and `plugin-iot-cognitum` on `workspace:*`. Neither resolves for a registry consumer.
4. **Unpublished leaves shipped silently.** The CLI does not bundle `cli-core`, `memory`, `neural` or `shared`, so a merged fix in one of them reaches users only if that leaf is published too (#3335, #3390). Exact pins (#3414) stopped a stale cached copy from satisfying the spec. But `memory@3.0.0-alpha.27` then sat unpublished behind a merged pin.

## Decision

1. **Leaves follow the train's semver policy.** Published 2026-09-28:

   | Version | Packages |
   |---|---|
   | 3.0.0 | browser, claims, deployment, guidance, hooks, mcp, memory, neural, performance, plugins, providers, security, shared, swarm, testing |
   | 3.7.0 | cli-core (continues its existing line) |
   | 1.0.0 | plugin-agent-federation, plugin-iot-cognitum |

   After this, bumps are PATCH, MINOR or MAJOR by the same rules as the train. `latest`, `alpha` and `v3alpha` all point at the stable version. No pre-release is published unless someone explicitly asks for one.

2. **`@claude-flow/embeddings` is excluded.** Its registry `latest` (`3.0.0-alpha.45`) was built from a branch that is not on `main`. Publishing from `main` would drop 139 exported names. It stays on alpha until that branch is reconciled.

3. **Every publishable leaf has a `files` allowlist** (`["dist", "README.md"]` at minimum) and **no `publishConfig.tag`**. `exports` may point only at shipped files. Entries for unshipped `examples/` and `benchmarks/`, and a `.d.js` typo, were removed.

4. **Intra-leaf dependencies use registry ranges** (`^<stable>`), never `file:` or `workspace:`.

5. **Publish order is topological, and leaves go before the train.** A release that changes a non-bundled leaf publishes the leaf first. Then it waits until `npm view <leaf>@<ver>` resolves (registry lag was about 6.5 minutes for 3.48.0), and only then pins it in the CLI. `scripts/audit-leaf-package-publish.mjs` fails if a pin does not cover the workspace version, or if changed leaf source comes without a version bump.

6. **The v3 pnpm workspace links every `@claude-flow/*` package** (`v3/.npmrc`: `prefer-workspace-packages=true`). Without that setting, pnpm replaced `link:../cli` with a newer registry `cli@3.47.1` and pulled its alpha dependencies into the lockfile. That registry cli was published from a branch not on `main`. As a result, `pnpm-lock.yaml` cannot show whether a leaf was published. Only `npm view` can.

7. **`main` must contain everything that was published.** 3.47.0 was published from a branch that never merged. A 3.48.0 cut from `main` would therefore have removed guarded federation registration for every `npx` user. 3.48.0 cherry-picked #3510 onto `main` so the release is a superset. Before any release, check `git cherry origin/main v<last-published>` and bring every unmerged commit onto `main` first.

## Enforcement

- `scripts/audit-leaf-package-publish.mjs`: pin-covers-source check and changed-source-needs-bump check (diff mode in PR CI). The `shared` waiver was removed.
- `scripts/audit-umbrella-version-lockstep.mjs`: the three train packages share one version.
- The `pnpm install --frozen-lockfile` gate in CI.
- The witness manifest (#1825) asserts that the CLI's `memory` dependency is a registry version (`"@claude-flow/memory": "3.`), not a `workspace:` leak.

## Alternatives considered

- **Keep leaves on alpha and pin exactly.** Rejected. Direct consumers still get an alpha from `latest`, and nothing makes a publish land on `latest`.
- **Bundle every leaf into the CLI tarball.** Rejected for now. It would remove the ship-the-leaf step, but it duplicates code for direct consumers and grows the CLI tarball. The four bundled packages (`security`, `codex`, `mcp`, `plugin-agent-federation`) remain the exception and are also published standalone.
- **Bump through `3.0.0-rc.N`.** Rejected. It adds a release cycle without adding verification the per-package tests and full CI matrix do not already provide.

## Consequences

- `npx ruflo@3.48.0` resolves exactly one copy of each `@claude-flow/*` dependency, all stable (checked with `npm ls` on a clean install).
- Leaf publishes are now semver-visible. A breaking change in a leaf requires a MAJOR bump, which the CLI's exact pins will surface.
- The three leaky alpha tarballs are deprecated (`shared@3.0.0-alpha.8`, `plugins@3.0.0-alpha.7`, `mcp@3.0.0-alpha.10`).
- Workspace CI now tests `guidance`, `hooks`, `neural`, `plugins` and `testing` against workspace `memory` source rather than a registry alpha. That is more faithful to what ships, but it means these packages need a full recursive build before their tests.
- Pre-existing, not introduced here: `ruvector@0.2.41` pins `@metaharness/router@0.3.2`, while the CLI's optional peer asks for `^0.4.0`. `npm ls` reports this as invalid on both 3.47.1 and 3.48.0.

## Verification (3.48.0)

- The full PR CI matrix passed: 125 checks, including macOS and Windows.
- `witness verify --strict` passes 117/117 on each OS.
- All 9 train dist-tags point at 3.48.0.
- Compared with 3.47.1 on a clean install: `doctor` has no failures, `hooks route` works, and memory store/search/retrieve behave identically on the native driver. The sql.js fallback behaves identically on both versions, and it is known not to persist between processes (#2968).
