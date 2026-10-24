# Independent SASS integration review — 2026-10-24

**Scope and disposition:** independent, read-only review of the SASS wrapper, ADR, package and public development evidence at repository commit `93c53d8c1616bf3219965670fadecba1a7fadf82`, including changes since `051937ba`. No new blocking inconsistency remains in this scope. This is an integration review, not SOTA validation, merge authorization, a release audit, or proof of semantic equivalence. No held-out source or oracle contents were inspected. No source files were changed by this reviewer.

## Exact bindings

| Artifact | SHA-256 |
| --- | --- |
| `v3/@claude-flow/cli/src/mcp-tools/rure-tools.ts` | `4b33a84f8fe466998b839debf160f65b01d9018e03d65ee34b0f13f0fafda539` |
| `plugins/ruflo-rure/docs/adrs/0010-executable-sass-text-recovery.md` | `ac38c4b0c52d43c61f544dc8ed99753dfb1b3fc781fef6b1e10906e5ab8c9791` |
| Public standalone `candidate.mjs` | `d85b93f70711d17c5c44f97a93d4a04ac08549cc253c70c88ab84294757287c3` |
| Packed and installed `dist/src/rure/sass-recover.js` | `be1981275d519361b11b853d539d34eae95c77025945ed0b72477285c69a080a` |
| Public CPU replay receipt | `6925dd2e90cfb2ffff2f8ae664235aecce0fc9963436e6c0aeb5eef0f547313a` |
| Public translation receipt | `00547be710e2f176157c577243e7712b4f333f0f5e025d00ac53f9fcf5992b99` |

The wrapper retains bounded regular-file reads, absolute input paths, strict tool schema and complete recovery-object withholding after presentation modification. The reviewed skill selects `rure_recover_sass` with matching authorized SASS and ELF-text paths; inspection does not itself authorize compilation or execution. Text exports are not authenticated binary decoding. Explicit `desc[...]` operands remain unsupported. Missing optional AIDefence is reported as `screened:false`.

## Package and evidence checks

The unpublished `@claude-flow/cli@3.60.1` tarball is 3,519,137 bytes. Independently calculated integrity agrees with the receipt:

```text
sha512-Ar/KWgfjFvpd1OuaG2M4DJa3o6+kf6RPLsw0HoHMJFTZVYq2+R1UYVwMR9QmPKzEnTovlONpKiGElVcDpYy8Gw==
```

Archive inspection found the SASS module, MCP wrapper, CLI entry point and package metadata, with no absolute or parent-traversal paths. Packed and installed module hashes agree. The temporary install lock has **734 entries: 733 dependency entries plus the root**, including **195 nonoptional, nondevelopment dependency entries**. The separate **191** figure is npm's reported number of packages added. These are different measurements, now labelled accordingly. Existing dependency findings and temporary lock-resolution differences remain documented; this is not a clean security audit. No repository dependency, lockfile, workflow, AGENTS or policy change was found in the reviewed diff. The new evidence `package.json` is a receipt, not a dependency manifest change.

The public CPU receipt binds the exact translation receipt and reports four development programs, 28 cases and 780 comparisons. The compiled constant-mutation control fails execution as intended. This is bounded CPU evidence, not GPU/SIMT equivalence. Recorded suite logs report 278 passing feature tests with seven skips, 151 integration tests, six evaluator controls and 33 comparison-gate controls; the build log records successful compilation. Those suite counts were checked against retained logs, not independently rerun in this final review. All linked local evidence exists, and all eight test/build/install logs are tracked at the reviewed commit.

## Parity and provenance

Independent development-only parity checks compared the standalone candidate and compiled package outputs for the four retained **SM86** exports and found identical complete result objects. The separate Node 20.20.2/24.19.0 receipts use **SM89/CUDA 13.0.88** exports. All eight SM89 SASS/ELF files match the retained development archive byte-for-byte; rerunning the recorded parity script reproduced its result hashes. The Node receipts agree with each other. Different architecture/input digests explain differences from the SM86 result hashes; they are not a failed package-parity comparison. The result hash is SHA-256 of UTF-8 `JSON.stringify(result)` with no newline.

Observed checks used `git diff --name-only 051937ba..HEAD`, `git ls-files --error-unmatch` for each retained log, Python `hashlib`/`tarfile`/JSON inspection, module imports for the four public development inputs, and the retained `node-parity-runner.mjs`. The public README provides the bound CPU replay commands. No upstream CuLifter implementation was found vendored in the self-authored adapter bundle; its unresolved upstream licensing and LLVM-version deviation remain explicit.

## Remaining limits

At this review boundary, new exact-cubin GPU confirmation and the six-kernel equal-input CuLifter comparison are **pending**. Prior CPU replay and earlier GPU attempts cannot stand in for those results. The four development programs, or the six synthetic confirmation programs alone, cannot satisfy the frozen 100-kernel SOTA gate. No superiority, production readiness, package publication, merge or deployment is established. Before updating the draft PR, preserve the reviewed hashes and verify the exact remote tree contains the linked evidence; rerun or independently review any changed bytes.
