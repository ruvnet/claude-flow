# Supply-chain hardening — `.github/supply-chain/`

This directory is the **maintained surface** for ruflo's supply-chain defence.

CI runs [`scripts/audit-supply-chain.mjs`](../../scripts/audit-supply-chain.mjs) on every PR and push that touches a `package.json`, a lockfile, this directory, or the audit script itself. Five layers of defence:

| # | Layer | Source of truth | Hard-fail? |
|---|---|---|---|
| 1 | CVE audit (HIGH/CRITICAL in DIRECT deps) | `npm audit` | ✅ unless accepted |
| 2 | Lockfile integrity (SHA-512 on every downloaded entry) | `package-lock.json` | ✅ unless accepted |
| 3 | Top-level allowlist | `allowed-deps.json` | ✅ |
| 4 | Typosquat reject | `allowed-deps.json` → `policies.rejectInRegistry` | ✅ |
| 5 | Publisher trust snapshot | live `npm view` | logged-only |

Plus, on PRs only, GitHub's [`actions/dependency-review-action@v4`](https://github.com/actions/dependency-review-action) flags newly-added vulnerable deps + denies the deny-list of compromised package versions.

## Files

### `allowed-deps.json`

Whitelist of direct deps per package. Adding a new direct dep to a covered package requires an explicit allowlist edit. Also lists `policies.rejectInRegistry` — names we always block regardless of whether they're real (typosquat defence) — and `publisherTrust.criticalUpstreamPackages` — upstream deps whose maintainer identity we snapshot in CI logs so unexpected handover is visible.

### `accepted-findings.json`

Triaged findings that the audit currently tolerates. Every entry **must** cite a tracking issue or ADR, and **should** have an `expiresAt` date so the audit re-fails after the triage window expires.

Editing this file requires CODEOWNER review per [`.github/CODEOWNERS`](../CODEOWNERS).

## Running locally

```bash
# Full audit
node scripts/audit-supply-chain.mjs

# JSON output (for tooling)
node scripts/audit-supply-chain.mjs --json

# Just one layer
node scripts/audit-supply-chain.mjs --scope cve
node scripts/audit-supply-chain.mjs --scope lockfile
node scripts/audit-supply-chain.mjs --scope allowlist
node scripts/audit-supply-chain.mjs --scope typosquat
node scripts/audit-supply-chain.mjs --scope publisher-trust
```

## Adding a new package to the audit

1. Add the package path to `PACKAGES_TO_AUDIT` in [`scripts/audit-supply-chain.mjs`](../../scripts/audit-supply-chain.mjs).
2. Add a `packages.<pkgName>` block to `allowed-deps.json` listing the expected `dependencies` / `devDependencies` / `peerDependencies`.
3. Add a dependabot stanza to [`.github/dependabot.yml`](../dependabot.yml).
4. Run `node scripts/audit-supply-chain.mjs` locally — fix any new findings before opening the PR.

## Triaging a new finding

If `audit-supply-chain.mjs` fails on your PR:

- **CVE in direct dep** — first try to upgrade the offending dep. If the upstream maintainer hasn't released a fix yet, add an entry to `accepted-findings.json.cve[]` with:
  - `package`, `depName`, `severity`, `via` — copy from the audit's failure output
  - `tracking` — short label (e.g. "ADR-121 Phase 4")
  - `trackingIssue` — link to the GitHub issue / ADR file
  - `expiresAt` — 90 days from today (audit will re-fail then so re-triage is forced)
  - `rationale` — why we can ship with this finding (e.g. "vulnerable code path not invoked from our usage")
- **Lockfile missing integrity** — check if it's a pnpm-store-shadow or workspace-link entry (those legitimately have no integrity). If so, add a `lockfile[]` entry with the path pattern.
- **Allowlist violation** — either the new dep is legitimate (add it to `allowed-deps.json`) or unintended (remove from package.json).
- **Typosquat hit** — never accept. Either fix the typo or remove the dep entirely.

## Why this matters

Three real supply-chain incidents on npm in the last 18 months involved:
- a maintainer takeover of a popular package (`colors@1.4.1`, `ua-parser-js`)
- a typosquat that pulled in `event-stream → flatmap-stream` and exfiltrated wallets
- a postinstall script in a transitively-pulled dep that ran during `npm install`

This audit doesn't make ruflo immune. It does make these patterns **visible** in CI before they reach production, with structured failures the maintainer can triage rather than silent installs.

Related: [ADR-123](../../v3/docs/adr/ADR-123-sublinear-integration.md) (introduced the new plugin under audit), [ADR-122](../../v3/docs/adr/ADR-122-browser-beyond-sota.md) (introduced the browser substrate under audit).
