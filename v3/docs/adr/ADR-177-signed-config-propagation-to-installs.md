# ADR-177 — Propagating Proven Configuration Manifests to Existing Installs

- **Status:** Accepted (implemented — PR #2572)
- **Date:** 2026-07-04
- **Deciders:** ruflo core
- **Related:** [ADR-174](ADR-174-memory-distillation-self-optimization.md) (the version-stamped, Ed25519-signed helper auto-refresh channel this generalizes), [ADR-176](ADR-176-proven-self-benchmarking-harness-loop.md) (produces the signed champion this ships), [ADR-171](ADR-171-provenance-tiered-evaluation-oracle.md) (provenance tiers), [ADR-150](ADR-150-metaharness-integration-surfaces.md) (optional-dependency + removability)

## Context

ADR-176 produces a **proven configuration manifest** (a champion optimized policy that cleared qualification, held-out benchmarking, adversarial verification, canary, and the full `accept()` conjunction, then Ed25519-signed). We need it to reach users who **already installed** ruflo — the same problem the ADR-174 helper auto-refresh solved for hook code.

That channel is directly reusable. It is verified generic:

- On every CLI command (`src/index.ts:142`, awaited, silent-unless-blocked), `autoRefreshHelpersIfStale()` compares a version stamp; on mismatch it re-copies signed artifacts into the project, fail-closed.
- `HelpersManifest = { version, files: Record<name, sha256> }` and `verifyHelpersManifest()` (Ed25519 against the baked `RUFLO_HELPERS_PUBKEY`) are **not hook-code-specific**. A parallel manifest for config artifacts, its own stamp file, and a sibling call at the same site would propagate a proven manifest to every already-`ruflo init`'d project on their next command — zero re-init, same fail-closed guarantee.

## Container format: RVFA (stay in the ruvnet ecosystem)

The propagated artifact is packaged as a **signed RVFA appliance** (`.rvf`), not a bespoke JSON blob — reusing ruvnet's own container rather than inventing a parallel one. RVFA is a general self-contained binary appliance (`rvfa-builder.ts`), signed with an Ed25519 footer (`rvfa-signing.ts`), and already carries the distribution/update primitives this ADR would otherwise reinvent: `RvfaPublisher` (IPFS/Pinata, **CID content-addressing**) and `RvfaPatcher` (**RVFP binary delta-patches**). Critically, its envelope parses + verifies with **pure Node** (`parseRvfaBinary()` = Buffer + native crypto) — the optional `@ruvector`/agenticow native module is needed only for *vector operations on the payload*, never to read the metadata section or check the signature. So the every-command adoption gate stays lightweight and dependency-free.

Section mapping:

| RVFA section | Contents | Read cost |
|---|---|---|
| **metadata** | the OCI-style constraint contract below (host/platform/compatibility/benchmark/`layer`/rollback) + receipt summary | zero-dep (pure Node parse) |
| **payload** | the verified execution policy + the **replayable proof-trajectory as native ruvector data** (strengthens ADR-176's "replayable from receipts" — the proof is now a first-class container, not out-of-band JSON) | vector ops need the optional module; the *decision to adopt* does not |
| **footer** | Ed25519 signature (`rvfa-signing`) | zero-dep (native crypto) |

**Distribution is layered — keep the network off the critical path:**
- **Default: ship-in-package + verify locally** on the every-command auto-refresh path (preserves the fail-closed, no-runtime-network posture of ADR-174). The version stamp becomes an immutable **champion CID**.
- **Opt-in: IPFS/CID pull + RVFP delta-patches** as an out-of-band update (e.g. a daemon worker fetches the latest champion CID) — Pinata/network stays *off* the every-command path.

Trade-offs recorded: (a) the suitability metadata MUST live in a zero-dep-readable RVFA section so adoption never requires the optional vector module; (b) `rvfa-signing` is a distinct Ed25519 root from `helper-signing` — purpose-fit for RVF appliances; we either accept two roots (hook code vs. config appliances) or share one key. The `verifyHelpersManifest` canonical-JSON pattern still governs the *hook-code* channel; RVFA governs the *config* channel.

## The core security concern: signed ≠ suitable

A signature proves **authenticity** (this came from ruflo, unmodified). It does **not** prove **suitability** (this is safe/correct to apply *here*). A perfectly-signed configuration can still be wrong for a given install — different host version, platform, benchmark lineage, or an incompatible metaharness version. Propagating a signed-but-unsuitable manifest is a real failure mode.

Therefore the propagated artifact is **not a signed blob** — it is a **constraint-carrying manifest, modeled on OCI image metadata**: authenticity *and* an explicit compatibility contract the receiver must satisfy before adoption.

## Decision

Generalize the ADR-174 signed auto-refresh channel from shipping **hook code** to shipping **signed proven-configuration manifests**, and make adoption conditional on **both** signature verification **and** constraint satisfaction.

### The manifest (OCI-metadata-style, not a bare blob)

```yaml
# The RVFA metadata section (zero-dep readable) — the constraint contract that
# gates adoption. The policy + replayable proof-trajectory ride the RVFA payload;
# the Ed25519 signature is the RVFA footer.
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

- **A bespoke signed JSON blob (helper-signing style).** Rejected in favor of RVFA — a bespoke blob would reinvent distribution (CID), incremental updates (delta-patch), and container signing that RVFA already ships, and would sit *outside* the ruvnet ecosystem. The `helper-signing` canonical-JSON pattern still governs the hook-code channel; RVFA governs the config channel.
- **RVFA fetched from IPFS on every command.** Rejected as the default — puts Pinata/network + credentials on the critical path. Ship-in-package + local verify is the default; IPFS/CID pull is opt-in, out-of-band.
- **Ship a bare signed appliance (authenticity only, no constraints).** Rejected — the core concern: signed ≠ suitable. The constraint contract in the RVFA metadata section is load-bearing.
- **A new fetch/update daemon.** Rejected — reuse the proven, awaited, fail-closed `index.ts:142` channel for the local path; the opt-in IPFS pull can ride an existing daemon worker.
- **One shared Ed25519 root for hooks + configs.** Open — `rvfa-signing` is purpose-fit for RVF appliances; sharing one key across channels is a simplification we may or may not take. Recorded, not decided.

## Backwards compatibility (with the ADR-174 updating system + older v3)

The config channel must not regress any existing install. Three invariants guarantee it:

1. **Additive-only.** A *new* RVFA config manifest + a *new* stamp (champion CID) + a *new* CLI code path. It never modifies the helper-code channel — `helpers.manifest.json`, `.helpers-version`, or `verifyHelpersManifest` are untouched. A 3.22.0–3.23.x install keeps its signed helper auto-refresh working unchanged; the config channel activates *alongside* it only when the CLI is upgraded to a version that ships this code.
2. **`compatibility` constraint = the version gate.** Every manifest declares `compatibility: { ruflo: ">=X", metaharness: ">=Y" }` and a `platform`/`host` contract. An install that doesn't satisfy it **safely does not adopt** (fail-closed suitability is a graceful skip, not an error). So a new champion may *require* a newer CLI without ever breaking an older one — the constraint contract does the compat work per manifest.
3. **Optional-dependency degradation (ADR-150).** The RVFA envelope (metadata + signature) is read with pure Node, so any CLI carrying this code can evaluate suitability + authenticity even without `@ruvector`/agenticow; an install lacking the native module simply does not hydrate the vector payload. No hard break.

**Population behavior:**

| Install / CLI | Behavior |
|---|---|
| pre-3.22.0 (no auto-refresh) | no propagation until the CLI is upgraded; then gets both channels (unstamped → refresh, existing tested path) |
| 3.22.0–3.23.x CLI, not upgraded | helper channel works unchanged; ignores config manifests entirely (no regression, no new capability) |
| CLI with ADR-177, install below a manifest's `compatibility` | signature + suitability evaluated; unsuitable → safe skip, keeps current config |
| CLI with ADR-177, suitable install | adopts the signed champion on next command, zero action |

**The one hazard:** do NOT rotate the *existing* `helper-signing` key — 3.22.0–3.23.x CLIs have its public key baked in and would fail-closed on a re-signed helper manifest. The `rvfa-signing` config key is a fresh root that only ships with new CLI versions, so it introduces no rotation on the existing channel. Baked public keys are version-pinned by design; new keys ride new CLIs.

**Fundamental limit (not a regression):** a new capability reaches an install only once that install runs a CLI containing it. Old CLIs and old installs *no-op safely* rather than break.

## Rollback

Every manifest carries `rollback.previous_manifest`. Reverting = re-adopt the pointed-to manifest (still local + signed) and advance the stamp back. A suitability failure or signature failure is itself a safe non-adoption — the install simply keeps what it has. Absent the optional metaharness stack, no config manifest ships and the channel is a hook-code-only no-op.

## Acceptance test

1. **Authenticity fail-closed:** a manifest with a flipped byte (bad signature) is refused and the install's config is unchanged (mirrors the helper-signing tamper test).
2. **Suitability fail-closed:** a validly-signed manifest whose `host`/`platform`/`compatibility`/`layer` constraints the local environment does not satisfy is **not adopted**, and the skip reason is recorded — no error, no partial apply.
3. **Reversibility:** after adopting manifest N, following `rollback.previous_manifest` restores manifest N-1 exactly (byte-identical policy), and the stamp reflects it.
4. **Zero-action reach:** an already-installed project with an older stamp adopts a suitable, signed manifest on the next `ruflo` command with no user action (mirrors the ADR-174 helper auto-refresh E2E).
