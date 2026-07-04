# ADR-177 — Propagating Proven Configuration Manifests to Existing Installs

- **Status:** Proposed
- **Date:** 2026-07-04
- **Deciders:** ruflo core
- **Related:** [ADR-174](ADR-174-memory-distillation-self-optimization.md) (the version-stamped, Ed25519-signed helper auto-refresh channel this generalizes), [ADR-176](ADR-176-proven-self-benchmarking-harness-loop.md) (produces the signed champion this ships), [ADR-171](ADR-171-provenance-tiered-evaluation-oracle.md) (provenance tiers), [ADR-150](ADR-150-metaharness-integration-surfaces.md) (optional-dependency + removability)

## Context

ADR-176 produces a **proven configuration manifest** (a champion optimized policy that cleared qualification, held-out benchmarking, adversarial verification, canary, and the full `accept()` conjunction, then Ed25519-signed). We need it to reach users who **already installed** ruflo — the same problem the ADR-174 helper auto-refresh solved for hook code.

That channel is directly reusable. It is verified generic:

- On every CLI command (`src/index.ts:142`, awaited, silent-unless-blocked), `autoRefreshHelpersIfStale()` compares a version stamp; on mismatch it re-copies signed artifacts into the project, fail-closed.
- `HelpersManifest = { version, files: Record<name, sha256> }` and `verifyHelpersManifest()` (Ed25519 against the baked `RUFLO_HELPERS_PUBKEY`) are **not hook-code-specific**. A parallel manifest for config artifacts, its own stamp file, and a sibling call at the same site would propagate a proven manifest to every already-`ruflo init`'d project on their next command — zero re-init, same fail-closed guarantee.

## The core security concern: signed ≠ suitable

A signature proves **authenticity** (this came from ruflo, unmodified). It does **not** prove **suitability** (this is safe/correct to apply *here*). A perfectly-signed configuration can still be wrong for a given install — different host version, platform, benchmark lineage, or an incompatible metaharness version. Propagating a signed-but-unsuitable manifest is a real failure mode.

Therefore the propagated artifact is **not a signed blob** — it is a **constraint-carrying manifest, modeled on OCI image metadata**: authenticity *and* an explicit compatibility contract the receiver must satisfy before adoption.

## Decision

Generalize the ADR-174 signed auto-refresh channel from shipping **hook code** to shipping **signed proven-configuration manifests**, and make adoption conditional on **both** signature verification **and** constraint satisfaction.

### The manifest (OCI-metadata-style, not a bare blob)

```yaml
# proven-config.manifest.json (signed; the receipt from ADR-176)
schema: ruflo.proven-config/v1
policy:                       # the verified execution policy (internal: "genome")
  ref: sha256:…               #   content-addressed; the actual policy blob
host:
  claude-code: ">=1.9"        # required host + minimum version
platform: [linux, macOS]      # supported platforms
compatibility:
  metaharness: ">=0.3.2"      # required upstream package range
  ruflo: ">=3.24.0"           # required CLI range
benchmark:
  corpus: LAB-v4              # which held-out corpus proved it
  corpus_hash: sha256:…       # exact corpus content
layer: framework/node-cli     # ADR-176 hierarchy level this manifest claims
receipt:                       # ADR-176 proof bundle (reproducible)
  held_out_delta: …
  redblue: PASS
  drift: 0.xx
  canary: { rollback_rate: …, latency_p95: …, cost_per_task: … }
  receipt_coverage: 1.0
rollback:
  previous_manifest: sha256:… # the manifest this supersedes (reversibility)
signature: <base64 ed25519>    # over the canonical manifest bytes
algorithm: ed25519
```

### Adoption is doubly-gated (fail-closed on either)

On the next CLI command, an installed project, before adopting a newer manifest:

1. **Authenticity** — verify the Ed25519 signature against the baked public key (reusing `helper-signing.ts`'s canonical-JSON verify). Fail → refuse, warn (as the helper channel does today).
2. **Suitability** — check the constraint contract against the *local* environment: host present at the required version, platform supported, `metaharness`/`ruflo` in the compatible range, and — for a hierarchical manifest — that this install belongs to the claimed `layer` (ADR-176). Any unsatisfied constraint → **do not adopt**, keep the current config, record why (a suitability skip is normal, not an error).

Only when **both** pass is the policy adopted, the stamp advanced, and the previous manifest retained per the `rollback.previous_manifest` pointer.

### Canary-gated at the source, staged at the edge

Only a manifest that cleared ADR-176's **canary** is eligible to propagate (nothing benchmark-only ships globally). Optionally, the edge can itself stage adoption (a fraction of installs first) using the same telemetry, giving a second, population-level canary before full rollout.

### Naming on the wire

External surfaces (the channel, CLI, docs) call these **proven configuration manifests** / **verified execution policies** — never "genomes." The evolutionary framing is internal to ADR-176; the propagated thing is defined by its constraints and receipts.

## Alternatives considered

- **Ship a bare signed blob (authenticity only).** Rejected — the core concern above: signed ≠ suitable.
- **A new fetch/update daemon.** Rejected — reuse the proven, awaited, fail-closed `index.ts:142` channel; it already runs on every command with the right cadence and safety posture.
- **A distinct signing key/trust root for configs.** Reuse `helper-signing.ts` (optionally a sibling key with the same mechanism); do not invent a new pattern. Four Ed25519 roots already exist.
- **Push/pull from a network endpoint at runtime.** Rejected as the default — the artifact ships *in* the installed package (npm-integrity-verified), copied locally; no runtime network trust beyond the standard install.

## Rollback

Every manifest carries `rollback.previous_manifest`. Reverting = re-adopt the pointed-to manifest (still local + signed) and advance the stamp back. A suitability failure or signature failure is itself a safe non-adoption — the install simply keeps what it has. Absent the optional metaharness stack, no config manifest ships and the channel is a hook-code-only no-op.

## Acceptance test

1. **Authenticity fail-closed:** a manifest with a flipped byte (bad signature) is refused and the install's config is unchanged (mirrors the helper-signing tamper test).
2. **Suitability fail-closed:** a validly-signed manifest whose `host`/`platform`/`compatibility`/`layer` constraints the local environment does not satisfy is **not adopted**, and the skip reason is recorded — no error, no partial apply.
3. **Reversibility:** after adopting manifest N, following `rollback.previous_manifest` restores manifest N-1 exactly (byte-identical policy), and the stamp reflects it.
4. **Zero-action reach:** an already-installed project with an older stamp adopts a suitable, signed manifest on the next `ruflo` command with no user action (mirrors the ADR-174 helper auto-refresh E2E).
