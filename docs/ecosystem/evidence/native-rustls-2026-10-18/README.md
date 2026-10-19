# Scoped native advisory remediation

Draft [RuVector PR 1230](https://github.com/ruvnet/RuVector/pull/1230) changes only
the Cargo-resolved rustls version/checksum from 0.23.45 to 0.23.46. Base
`46d816ddc4c2a8a06cd3613534a79b1d557d858b`; candidate
`39f41d2474d7804fd73d933a3925883108473090`.

The actual native audit drops from 13 to 9 vulnerability instances. Four public
Rustls advisories disappear, while nine ZIP instances and existing warnings remain.
Both audit exits are 1. No suppression, downgrade or clean-release claim is made.
The same scoped command passes 297 tests on each side, with three existing live-API
tests ignored. Candidate core build passes. Full workspace, cross-platform, MSRV,
optional features, cargo-deny and independent release gates remain pending.

The receipt records exact toolchain/advisory sources, commands and hashes. Raw
Cargo audit JSON and test/build logs are included. Each checked-in audit JSON adds
one terminal newline to the original tool output; the verifier removes that
separator when checking original output hashes. Test/build logs are byte-identical.

Obtain each Cargo.lock from the exact respective RuVector commit, then run from
the Ruflo checkout:

```sh
node docs/ecosystem/evidence/native-rustls-2026-10-18/verify-native-remediation.mjs <candidate-Cargo.lock> <baseline-Cargo.lock>
```

This executes ten evidence assertions, including exact advisory removal, retained
warnings and lock/test hashes. It verifies captured evidence; repeat the receipt's
Cargo commands against both source checkouts for a new runtime validation.

The pinned supplementary Ruflo scan reported zero issues but did not supersede
Cargo failures. Its first npm-exec attempt failed on a cache lock; isolated install
succeeded without integrity bypass. Scanner startup changed four helper files;
the exact scanner-owned edits were reversed and the candidate tree restored.
Future pinned scans should use an isolated scanner working directory with an
explicit source target. No secrets, paid model calls, merge or npm publication.
