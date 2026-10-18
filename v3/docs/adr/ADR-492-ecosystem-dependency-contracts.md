# ADR-492: Evidence driven ecosystem dependency contracts

Status: proposed for release validation

## Outcome

Make existing package integrations work consistently through all three public entry packages, with dependency relationships that can be inspected and tested. A package appears in a download inventory because it was measured; that does not make it a required runtime dependency.

## Inputs and scope

The cohort comes from `data/npm-downloads.latest.json`, including packages explicitly missing download evidence. The registry collector captures all 401 package manifests without credentials, installation, lifecycle scripts or package execution. Source changes in this delivery are confined to the Ruflo repository and its existing public release train: `@claude-flow/cli`, `claude-flow`, then `ruflo`.

Each graph edge records the source package version, declared target range, relationship kind and whether the target is in the cohort. Optional dependencies override the same name in required dependencies, following npm semantics. Optional peers remain distinguishable from automatically installed extensions.

## Decision

1. Preserve a directed package architecture instead of adding dependencies merely to increase connectivity. Keep native and learning extensions optional, with existing absence behavior.
2. Declare direct ownership of packages used by CLI source, rather than relying on transitive hoisting. The CLI owns its RuVector core and SONA extensions; the root umbrella owns the runtime dependencies and extension contracts used by its embedded CLI.
3. Keep memory optional with one exact declaration. Do not add a required memory to neural edge: neural already requires memory.
4. Await native vector insert and delete completion. The caller must not observe successful completion before the dependency finishes or after it rejects.
5. Reuse one canonical scoped CLI preparation. After signing and verification, record current source and staged artifact hashes. Root preparation verifies that exact payload and existing helper signatures without receiving the signing key. Stage console, MetaHarness, helper and runtime capabilities into the root archive.
6. Capture dependency metadata, name based declaration cycles, leaf first graph ordering and reverse impact cascades. Graph planning is not permission to publish and is not proof of installation compatibility.

## Version ranges and cycles

The first live snapshot contains 470 internal relationships and 231 required internal declaration edges. The latest manifest name graph has a cycle between `strange-loops` and `sublinear-time-solver`. It must not be described as a proven resolved installation cycle: `strange-loops@1.0.3` declares solver `^1.4.3`, but solver `1.7.2` declares `strange-loops ^0.5.1`, and the published `strange-loops@0.5.1` has no solver dependency.

Do not change that pair automatically. A separate source and packed artifact review must establish whether the solver's old required edge is unused. Registry metadata alone cannot justify replacing a compatibility contract.

## Alternatives and tradeoffs

| Approach | Install cost | Compatibility risk | Decision |
| --- | --- | --- | --- |
| Make the 401 package cohort mutually dependent | Large, unnecessary transitive installs | Hard cycles, unrelated failures, synchronized releases | Rejected |
| Add only graph documentation | No runtime cost | Existing broken integration paths persist | Insufficient alone |
| Explicit contracts, optional capabilities and source bound package gates | Collector makes 401 bounded registry reads; runtime cost changes only for declared integrations | Scoped changes require package and absence regression coverage | Selected |

No performance improvement is inferred from a denser graph. Download events are not users, and adding dependencies is not product growth.

## Acceptance

* Graph fixture tests preserve optional overrides, missing metadata, version range skew, reverse impact and cycle behavior.
* Native adapter regression fails against the previous source and passes with awaited completion, including rejection paths and JavaScript fallback.
* Root and scoped manifest contracts declare the same direct optional extensions without required or peer duplication.
* The root release gate rejects changed tracked source, untracked source, staged runtime/plugin/catalog drift, missing preparation and invalid helper signatures.
* Before publication: install dependencies with reviewed lockfiles, run focused and existing regressions, build and inspect all three archives, then exercise independent consumer installs and optional absence behavior.
* Publish only from reviewed source using authenticated npm and the existing helper signer; verify registry integrity and `latest`, `alpha`, `v3alpha` for all three packages afterward.

## Rollback

Revert the consumer manifest and adapter changes together, restore the last verified dist tags if a published release fails acceptance, and retain the graph snapshot as historical evidence. Registry packages are immutable; do not overwrite versions or manufacture a success receipt.
