# ADR-378 — npm Trusted Publishing for CI/CD Release Automation

- **Status**: Proposed
- **Date**: 2026-07-30
- **Related**: root `CLAUDE.md` → "Publishing to npm" (existing manual runbook), 2026-07-14 helpers-signing-key leak incident (same section), Cognitum Platform deployment table (existing WIF precedent for `meta-llm`'s CD)
- **Supersedes**: nothing — this repo has no existing publish/release GitHub Actions workflow (`.github/workflows/` has 24 workflows; none named `*publish*` or `*release*`). This is net-new automation, not a migration.

## Context

### Current state (fully manual)

All three published packages — `@claude-flow/cli` (`v3/@claude-flow/cli/`), `claude-flow`
(repo root), `ruflo` (`ruflo/`) — are version-locked (currently `3.32.24` across all three)
and published **by hand, from an operator's local machine**, per the runbook in root
`CLAUDE.md`:

1. `npm version <x.y.z> --no-git-tag-version` in each of the three package directories, in order
2. `npm publish` per package (default `latest` tag)
3. `npm dist-tag add <pkg>@<version> alpha` and `... v3alpha` per package (9 dist-tag calls total)
4. Manual verification loop confirming `latest === alpha === v3alpha` across all three
5. `git tag v<version> main && git push origin v<version> && gh release create ...`

`@claude-flow/cli`'s `prepublishOnly` runs `scripts/prepare-publish.mjs`, which:
- builds `@claude-flow/swarm` then the CLI itself via `tsc`
- copies the root `README.md` into the package
- bundles the `plugins/ruflo-metaharness` plugin into the tarball
- runs `generate-catalog-manifest.mjs`, **`sign-helpers.mjs`**, `verify-helpers.mjs` in sequence

`sign-helpers.mjs` needs a private Ed25519 key to sign `.claude/helpers/helpers.manifest.json`.
That key lives in GCP Secret Manager, project **`ruv-dev`**, secret `ruflo-helpers-signing-key`
— a **separate trust boundary from npm auth itself**, and one this repo has already been burned
by: on 2026-07-14, `gcloud secrets versions access latest --secret=ruflo-helpers-signing-key`
was run in a way that printed the PEM to stdout, which landed in a Claude Code tool-call
transcript. GCP secret v1 was destroyed and v2 rotated in (commit `0052b1b06` / PR #2673).
CLAUDE.md now mandates the secret only ever be redirected straight to a file, never allowed
to reach tool output.

### The trigger for this ADR

The user attempted to create an npm access token on npmjs.com for CI/CD use and hit npm's
own warning against it:

> "There are security risks with this option. For automation or CI/CD uses, please use
> Trusted Publishing instead."

npm's **Trusted Publishing** (general availability with npm CLI ≥ 11.5.1, OIDC-based, modeled
on PyPI's Trusted Publishers) lets a CI job authenticate to the npm registry with a
short-lived token minted by exchanging the CI provider's OIDC identity token — no `NPM_TOKEN`
secret stored anywhere, nothing to leak, nothing to rotate. Currently supported: GitHub Actions
(GA); GitLab CI (beta).

This is the same shape of fix this repo already applied elsewhere: `meta-llm`'s Cloud Run
deploy uses Workload Identity Federation (`GCP_WIF_PROVIDER` + `GCP_DEPLOY_SA`, no static
service-account JSON key) instead of a long-lived credential. Trusted Publishing is the npm
-registry equivalent of that same pattern.

## Decision

Adopt npm Trusted Publishing via GitHub Actions OIDC for all three packages, and fetch the
helpers-signing secret in CI via GCP Workload Identity Federation rather than a static
service-account key — so **no long-lived secret of either kind (npm or GCP) is stored in
GitHub Actions secrets** for this workflow.

### 1. npmjs.com configuration (one-time, per package)

For each of `@claude-flow/cli`, `claude-flow`, `ruflo`: package Settings → **Trusted
Publisher** → add GitHub Actions publisher scoped to:
- Organization/repo: `ruvnet/ruflo`
- Workflow filename: `.github/workflows/npm-publish.yml`
- Environment: `npm-publish` (see below — required reviewers preserve the "a human approves
  this" property the manual process has today)

### 2. GCP Workload Identity Federation (one-time)

Create a dedicated WIF pool + provider trusting GitHub's OIDC issuer, scoped to this repo,
and an IAM binding granting **only** `roles/secretmanager.secretAccessor` on
`projects/ruv-dev/secrets/ruflo-helpers-signing-key` — not project-wide, not org-wide. This
is a new, narrower principal; do not reuse `meta-llm`'s `GCP_DEPLOY_SA` binding (different
blast radius, different purpose).

### 3. New workflow: `.github/workflows/npm-publish.yml`

- **Trigger**: `workflow_dispatch` only (inputs: `version`, `bump` type). Not on tag-push,
  not on merge-to-main — the semver bump is a judgment call per CLAUDE.md's PATCH/MINOR/MAJOR
  discipline, so a human still decides *when* and *what* to publish; this workflow only
  automates the *mechanics* once that decision is made.
- **Permissions**: `id-token: write` (OIDC for both npm and GCP WIF), `contents: write`
  (tag + release).
- **Environment**: `npm-publish`, with required reviewers configured in repo settings —
  this is the workflow-level equivalent of "an operator is at the keyboard."
- **Steps** (single job, `ubuntu-latest`):
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` — pin `node-version: 20`, `registry-url: https://registry.npmjs.org`;
     confirm npm ≥ 11.5.1 (`npm install -g npm@latest` if the bundled version is older —
     Trusted Publishing silently falls back to failing auth on older npm, so pin explicitly,
     don't assume)
  3. `google-github-actions/auth@v2` with `workload_identity_provider` + the dedicated
     service account — exports credentials for the next step without ever materializing a
     JSON key file
  4. Fetch the signing secret via the authenticated client library / `gcloud` **with output
     redirected straight into env**, never through a step that could echo it:
     `RUFLO_HELPERS_SIGNING_SECRET=ruflo-helpers-signing-key RUFLO_HELPERS_SIGNING_PROJECT=ruv-dev`
     — reuses the existing env-var contract `sign-helpers.mjs` already supports; no code
     change needed in `prepare-publish.mjs` or `sign-helpers.mjs`.
  5. Bump version in all three `package.json`s (`npm version <input> --no-git-tag-version`),
     in the mandated order: `@claude-flow/cli` → `claude-flow` (root) → `ruflo`.
  6. `npm publish --provenance` for `@claude-flow/cli` — Trusted Publishing activates
     automatically once npm detects the OIDC context and a matching registered publisher;
     no `NODE_AUTH_TOKEN` anywhere in the workflow. `--provenance` is free once CI is doing
     the publish and produces a public Sigstore-signed build attestation — a supply-chain
     improvement beyond what this ADR was originally asked to solve.
  7. Repeat step 6 for `claude-flow` (root) and `ruflo`.
  8. `npm dist-tag add` × 9 (3 packages × `latest`/`alpha`/`v3alpha`) — script this as a small
     loop rather than 9 literal lines.
  9. Verification: `npm view <pkg>@latest version` for all three, assert equality with the
     input version and with each other — same check the manual runbook already performs,
     now enforced as a CI gate instead of an eyeballed step.
  10. `git tag v<version> main`, `git push origin v<version>`, `gh release create` — using
      the workflow's default `GITHUB_TOKEN` (already scoped by `contents: write`), no new
      secret needed.

### 4. Manual fallback retained

The existing local/manual runbook in CLAUDE.md stays documented as a fallback for at least
one full release cycle after this workflow is proven, and permanently as a break-glass path
for whenever the workflow itself is broken (e.g., mid-migration on a workflow-filename
rename — see Consequences).

## Alternatives Considered

- **Keep manual publishing, just rotate npm tokens more often.** Rejected — doesn't remove
  the standing secret, doesn't remove the operator-workstation risk, and doesn't touch the
  actual failure class that already bit this repo (a secret transiting somewhere it can be
  captured — see the 2026-07-14 incident, which was a GCP secret, not npm, but the exact same
  shape of mistake).
- **Classic "Automation" npm access token as a `NPM_TOKEN` GitHub secret.** Rejected — this is
  precisely the option npm's own UI is warning against for CI/CD use; it's long-lived, must be
  manually rotated in two places (npmjs.com and GitHub) on any suspected compromise, and has
  no expiry unless one is manually set.
- **Fine-grained/granular npm tokens with an expiry date.** Better than an automation token,
  but still a standing secret with a live blast radius until it expires. Trusted Publishing has
  zero standing secret on the npm-auth leg — nothing to steal between publishes.
- **Auto-publish on every merge to `main`.** Rejected — this repo's release cadence is
  deliberate (semver-bump judgment call, hand-written GitHub release notes, sometimes a linked
  gist). Automatic-on-merge would remove a decision point this repo currently wants to keep.
  `workflow_dispatch` preserves it.
- **Static GCP service-account JSON key for the signing-secret fetch, stored as a GitHub
  secret.** Rejected for the same reason as the npm automation token — it's the exact class of
  standing credential this ADR exists to eliminate, and this repo already has WIF precedent
  (`meta-llm`'s CD) to reuse the pattern instead.

## Consequences

### Positive

- Eliminates the standing `NPM_TOKEN` secret class entirely for CI — a short-lived, per-run
  token is minted via OIDC exchange and never stored.
- `--provenance` becomes essentially free to add once CI does the publish, improving the
  supply-chain trust signal for all three packages beyond what this ADR set out to fix.
- Publish becomes auditable via the Actions run log instead of depending on a specific
  operator's local shell state — no more dependency on the `~/.ruflo/helpers-signing.key`
  local-file workaround documented for the 2026-07-14 incident.
- Removes the Windows `prepublishOnly` shell-quirk risk class for CI-driven publishes, since
  the runner is always `ubuntu-latest` — the documented Git-Bash-manual-steps fallback stops
  being relevant for this path (it remains relevant only for someone still publishing locally
  from Windows, which is now explicitly the fallback path, not the primary one).

### Negative / risks

- **New coupling between the workflow file and npmjs.com's config.** If `.github/workflows/npm-publish.yml`
  is ever renamed, moved, or the repo is renamed/transferred, npmjs.com's Trusted Publisher
  entries must be updated in lockstep for all three packages or every publish starts failing
  auth — an easy step to forget during an unrelated refactor. Document this explicitly in
  CLAUDE.md alongside the workflow.
- **New GCP infrastructure to maintain.** The WIF pool/provider + scoped IAM binding is new,
  one-time setup that didn't exist before; if mis-scoped (e.g., granted at project level
  instead of on the single secret), it *widens* CI's blast radius relative to today's
  fully-manual, single-operator flow. Least-privilege scoping (Decision §2) is load-bearing,
  not optional.
- **The `npm-publish` environment's required-reviewers setting is the only thing standing in**
  for "a person is running this by hand." If that protection rule is ever weakened or removed,
  a compromised or malicious workflow-file change could self-approve a publish. Mitigate with
  branch protection on changes to `.github/workflows/npm-publish.yml` itself, in addition to
  the environment gate.
- Does not address GitHub Actions runner supply-chain trust — an accepted risk shared with
  every other GH-Actions-based CD path already in this repo (e.g., `meta-llm`'s existing CD).

## Security Notes

- npm's Trusted Publisher config is inherently scoped to (org, repo, workflow file, optional
  environment) — using the `npm-publish` environment with required reviewers is what makes
  this **at least as strong as** today's "an operator runs this by hand" gate, not weaker.
- The GCP WIF principal must be scoped to `roles/secretmanager.secretAccessor` on exactly
  `projects/ruv-dev/secrets/ruflo-helpers-signing-key` — verify this at implementation time
  rather than copying whatever scope `GCP_DEPLOY_SA` currently has for `meta-llm`, which is a
  different principal for a different purpose.
- Never let the fetched secret value reach a logged command or `stdout`. `sign-helpers.mjs`
  already consumes it via env vars, not by reading a printed value, so no code change is
  needed there — but the CI step that populates those env vars must not itself echo, `cat`,
  or otherwise surface the value. This is exactly the mistake that caused the 2026-07-14 leak
  (`gcloud secrets versions access` writing to stdout, captured into a tool-call transcript);
  an authenticated-client-library or `--out-file`-style fetch avoids that failure mode by
  construction.

## Implementation Plan (phased)

- **Phase 0 — Registration.** Register the Trusted Publisher on npmjs.com for all three
  packages, pointing at the not-yet-created workflow path. Confirm/pin npm ≥ 11.5.1 on the
  runner image.
- **Phase 1 — GCP WIF plumbing.** Create the pool/provider + scoped IAM binding. Validate with
  a dry-run workflow that only authenticates and fetches the secret (no publish step yet).
- **Phase 2 — Workflow authoring.** Write `.github/workflows/npm-publish.yml` per Decision §3.
  Gate on `workflow_dispatch` + the `npm-publish` environment with required reviewers.
- **Phase 3 — Dry run.** Exercise `npm publish --dry-run` in CI to validate the full
  build → sign → pack pipeline without touching the registry. Do **not** publish a real
  prerelease version to test — CLAUDE.md explicitly forbids pre-release tags (`-alpha.N` etc.)
  outside an explicit user request, and `--dry-run` covers everything except the actual
  registry write.
- **Phase 4 — First supervised live run.** Execute against a real, small patch bump under
  direct supervision; verify the full runbook (dist-tags, `npm view`, GitHub release) matches
  what the manual process would have produced.
- **Phase 5 — Promote to primary.** After one full clean release cycle, update the
  "Publishing to npm" section of root `CLAUDE.md` to point at this workflow as the primary
  path, keeping the manual steps as documented fallback rather than deleting them.

## Open Questions

- Should a tag-push (`v*`) trigger be added alongside `workflow_dispatch` once the flow is
  trusted, or should it stay manual-trigger-only indefinitely? (Leaning: stay manual — the
  semver-bump decision in CLAUDE.md is explicitly a judgment call, not a mechanical one.)
- Should the GCP WIF principal for this workflow be shared with any future CI needs for the
  same secret, or does every consumer get its own dedicated, narrowly-scoped principal?
  (Leaning: dedicated per consumer, least-privilege, consistent with why this ADR rejects a
  shared static key in the first place.)
- GitLab CI Trusted Publishing is in beta and irrelevant today (this repo is GitHub-hosted),
  but worth a one-line note here in case that ever changes.

## References

- npm CLI Trusted Publishing (GA with npm ≥ 11.5.1, OIDC-based; GitHub Actions supported,
  GitLab CI in beta)
- Root `CLAUDE.md` → "Publishing to npm" (existing manual runbook, dist-tag matrix, signing-key
  handling, Windows `prepublishOnly` caveat)
- Root `CLAUDE.md` → Cognitum Platform deployment table — existing WIF precedent
  (`meta-llm`'s `GCP_WIF_PROVIDER` + `GCP_DEPLOY_SA`)
- Root `CLAUDE.md` → 2026-07-14 helpers-signing-key leak incident and its "never let a secret
  reach tool output" rule — the direct motivating precedent for the GCP-fetch design in this
  ADR
- `v3/@claude-flow/cli/scripts/prepare-publish.mjs`, `scripts/sign-helpers.mjs` — existing
  `prepublishOnly` chain this ADR's CI workflow must reproduce unchanged
