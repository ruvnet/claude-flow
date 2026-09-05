# ADR-332: Hermetic Release Verification and Supported Runtime Baseline

**Status:** Accepted and implemented
**Date:** 2026-07-29
**Issues:** #2729, #2732, #2744, #2847
**Related:** ADR-102, ADR-103, ADR-104, ADR-166

## Context

Release-security checks must produce useful evidence in both a built workspace
and a clean source checkout. The standalone ADR-103 witness verifier previously
required `@noble/ed25519` to be installed before it could authenticate a
manifest. Its full-tree mode also required generated `dist/` files. A scheduled
source-only check could therefore report an environmental precondition instead
of checking the source markers it actually had.

The two MCP bridge images also used Node 20 after that release line reached end
of life. A green source test did not prevent the deployed image from retaining
an unsupported runtime.

Two related tracker reports describe release markers and transport exports that
have since been implemented on `main`. An open issue is not, by itself,
evidence that the defect is still present; remediation must be based on current
source and executable checks.

## Decision

### 1. Verify witness signatures with the platform runtime

`plugins/ruflo-core/scripts/witness/verify.mjs` uses Node's built-in
`node:crypto` Ed25519 implementation. RFC 8410 PKCS#8 and SPKI wrappers convert
the existing raw seed and public-key bytes without changing the signed witness
format. Existing manifests produced with `@noble/ed25519` remain verifiable
byte-for-byte.

Verification checks three independent statements:

1. the manifest body hashes to `integrity.manifestHash`;
2. the deterministic key derived from the manifest commit reproduces
   `integrity.publicKey`; and
3. the Ed25519 signature authenticates the declared manifest hash.

Malformed keys and signatures fail closed as verification errors. Verification
does not download packages, inspect a global install, or silently substitute a
different algorithm.

### 2. Make source-only scope explicit

`--source-only` authenticates the complete signed manifest, then checks every
non-`dist/` marker available in a source checkout. Generated entries are not
treated as verified: the JSON and human-readable results identify the
`source-only` scope and report `skippedGenerated`.

A source marker that is missing or regressed exits 1. An invalid signature
exits 1. A manifest with no source entries exits 2 rather than succeeding
vacuously.

The existing no-flag behavior remains full-tree verification. If only generated
artifacts are unavailable, it retains the `dist-not-built` precondition and
exit 2. This preserves compatibility for release jobs that require evidence
over shipped build output while giving source-only automation a real security
check.

### 3. Pin deployed MCP bridges to a supported LTS line

Both MCP bridge Dockerfiles use `node:24-slim`. The ADR-166 static security
lock checks both files and fails if either leaves the Node 24 LTS line. Updating
the runtime when its support window approaches expiry is an explicit reviewed
change, not an incidental base-image drift.

This decision does not raise the repository-wide `engines.node` minimum.
Libraries may retain their existing compatibility contract; the stricter rule
applies to production images owned by this repository.

### 4. Resolve tracker state from current executable evidence

- #2729 is a confirmed defect and is remediated by hermetic signature
  verification plus explicit source-only scope.
- #2847 is a confirmed defect and is remediated by the supported Docker
  runtime plus the static lock.
- #2732 is stale on current `main`: the `@claude-flow/cli-core` and
  `@ruvector/rvf-wasm` markers are present in the package metadata and signed
  manifests, and the marker-drift smoke passes.
- #2744 is stale on current `main`: federation owns a guarded transport loader
  with a local WebSocket fallback, and CI forbids an unguarded phantom
  `agentic-flow/transport/loader` dependency.

Tracker updates should attach the commit and command output that support these
classifications. This ADR does not authorize automated issue closure.

## Security invariants

1. Source-only mode never claims generated artifacts were checked.
2. A valid source marker cannot compensate for an invalid signature.
3. A signature cannot compensate for a missing or regressed selected marker.
4. Full-tree verification semantics and historical witness bytes remain
   backward compatible.
5. Both deployable bridge variants use the same supported runtime baseline.
6. Network access and package installation are not prerequisites for witness
   authentication.

## Acceptance tests

1. In an isolated directory with no `node_modules`, a genuine manifest and all
   referenced source files pass `verify.mjs --source-only`.
2. A one-byte signature mutation exits 1.
3. Removing a selected source marker exits 1 and reports a regression.
4. Full-tree verification in the same unbuilt checkout exits 2 with
   `dist-not-built`.
5. JSON output names the verification scope, built-in verifier, and number of
   skipped generated entries.
6. The ADR-166 source lock passes for both Node 24 bridge images and fails for
   an unsupported base line.
7. Witness marker-drift and federation transport smoke tests pass on current
   `main`.

## Consequences

Source verification becomes useful in clean clones, scheduled audits, and
downstream repositories without weakening release verification. Operators can
distinguish authenticated source evidence from complete built-artifact
evidence. The package dependency remains available to witness generation and
other consumers, but verification no longer depends on its installation
layout.

The Docker runtime assertion is intentionally time-sensitive. Before Node 24
reaches end of life, a reviewed ADR amendment or successor must update both
images and their regression lock.
