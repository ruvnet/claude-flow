# Router guidance evidence

Source: ruvnet/metaharness e0dfd44da72b7adfb7c57fdd42d124be58ed7086,
packages/router, @metaharness/router0.4.0. Distinct from Ruflo's existing0.3.2 pin.
No tracked source edits outside the three-file patch. Shared policy is byte-identical
to the earlier Weight EFT/harness guidance proposals. No existing package guidance
was present at this exact source.

## Commands

Tools installed into isolated router-guidance-cycle8-tools:

```
npm install --ignore-scripts --no-audit --no-fund --save-exact typescript@5.9.3 vitest@2.1.9 @types/node@20.19.43 @ruvector/tiny-dancer@0.1.21
```

Both isolated worktrees used that tool installation without changing tracked
dependency manifests. From each packages/router directory:

```
npm run build
npm run lint
npm test -- --maxWorkers=1 --minWorkers=1
npm pack --ignore-scripts --json --pack-destination <variant-pack>
```

Also ran the same four test files via root vitest with an explicit package path.
All four files/34 cases pass on each source. Native model training ran; one
peer-absent unit case returns early when native is available. Therefore fresh
consumer validation explicitly covers the missing-peer branch separately.

```
npm view @metaharness/router@0.4.0 name version repository dist gitHead --json
npm pack @metaharness/router@0.4.0 --ignore-scripts --json --pack-destination registry-pack
node docs/ecosystem/proposals/router-guidance-pack-compare.mjs --artifact-root <artifact-root> --source-root <candidate-source-root> --output-root <new-results-directory>
node docs/ecosystem/proposals/router-guidance-validation.mjs --artifact-root <artifact-root> --source-root <candidate-source-root> --output-root <new-results-directory>
```

Fresh-consumer first corrected evidence is under attempt2/. A second successful
validation of the portable scripts is under portable-rerun/consumer-*/. Each invocation
creates a unique disposable output directory with new consumers/caches. The pack
comparison refuses to overwrite an existing result. Each baseline and candidate
had its own empty npm cache, install scripts disabled, then separate explicit
tiny-dancer0.1.21 installation. JS training and native training were followed
by new-process restore/route checks. JS decisions, model and public exports
match exactly. Native model metrics are random-initialization outputs, not
quality-gain evidence. Both paths execute real package APIs, not mocks.

The first consumer attempt failed because the test confused the npm package
version0.1.21 with the internal engine version2.2.3. That assertion was fixed;
no package source was changed to accommodate it. Original failure is retained.

Source rollback was actually executed in a third clean worktree:

```
git apply --index guidance.patch
git write-tree
git apply --reverse --index guidance.patch
git write-tree
git rev-parse HEAD^{tree}
git status --porcelain=v1
```

The candidate tree matches validation.json; reverse restored the exact original
tree with empty status. This cannot undo any external effect. None was made.

Full repository release gates, including known failing Cargo security audits,
remain separate and unchanged. Pack verification means local unsigned contents
checked, not release provenance or npm publication.

Draft [MetaHarness PR 416](https://github.com/ruvnet/metaharness/pull/416), commit
`62cdc6984bec239a229dadff5737dc28b99b0b51`. Checked-in [raw evidence](../evidence/router-guidance-2026-10-18.txt)
retains the original failure, build/lint/unit outputs and successful fresh-consumer rerun.
Arrange the generated packs in `<artifact-root>/{baseline,candidate,registry}-pack/`
under their npm filenames before running the portable scripts. The source root is
the candidate MetaHarness checkout, not the Ruflo checkout. No packs are published.
