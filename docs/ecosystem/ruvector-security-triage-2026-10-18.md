# RuVector read-only security triage — 2026-10-18

Source: `46d816ddc4c2a8a06cd3613534a79b1d557d858b`; root Cargo.lock SHA256 `4fdc7bc1b6ab62d1247a74e91fcd3516d10cd0572306994744a53e8846cdefde` (1,390 packages). Applicable root CLAUDE.md, full CONTRIBUTING.md, SECURITY.md, deny.toml and .cargo/audit.toml read. No applicable nested AGENTS/CLAUDE files for the inspected crates. No source edits, exploit execution, credentials, native build, package publication or advisory suppression.

## Fresh CI evidence

Guidance-only PR head `c9bbc7df42bfdaa33f834bbfe67ada052c15eb79`: https://github.com/ruvnet/RuVector/actions/runs/39106465039 . Cargo audit job 117613264868 used cargo-audit 0.22.2 and fetched 1,338 RustSec records at 2026-10-18 07:07:29Z; its crates.io index refresh warned, but advisory scan completed and failed on 13 vulnerability instances (seven unique IDs). Cargo deny job 117613264854 used cargo-deny 0.20.2 and reported 10 vulnerability instances; bans/licenses/sources passed. The difference is optional Hailo/candle0.8 zip1.1.4 appearing in the all-lock audit but not deny's resolved graph. npm audit passed only its configured production/critical threshold, not a clean-all-severities assurance. Lockfile integrity passed. Neither local Cargo nor local cargo-audit is available; this is source triage of hosted results, not a fresh native rescan.

## Advisory applicability

Rustls0.23.45 is version-affected by RUSTSEC-2026-0346/0347/0348/0349, published October14. All specify >=0.23.46 as patched. Source core defaults include api-embeddings, enabling reqwest0.12.28/rustls-tls; ruvector-node and ruvector-graph-node directly enable those core defaults. Actual core ApiEmbedding constructs reqwest::blocking::Client and posts to its endpoint. GNN-node disables GNN defaults, and GNN disables core defaults; its apparent rustls path in the lock graph is not an independently built GNN feature-path proof. Multi-root builds can unify features. None of this reproduces current published npm binaries.

- 0346 requires custom ClientSessionStore Debug logging. No custom ClientSessionStore or session-value types found in tracked Rust sources; ordinary built-in cache Debug is unaffected per advisory. Version signal confirmed, application exploit not demonstrated.
- 0347 requires explicit EchMode::Enable plus pre-handshake application writes. No EchMode source usage found; ApiEmbedding uses a default reqwest client. No demonstrated relevant configuration.
- 0348 requires nondefault rustls brotli. Locked rustls dependencies contain ring/log/once_cell/pki/webpki/subtle/zeroize, no Brotli dependency. Current locked graph does not show the required feature; do not claim universal absence for other builds.
- 0349 impacts post-quantum key-share prediction when a hybrid group is configured. This lock records ring and no aws-lc-rs dependency for rustls; reviewed code has no custom crypto provider. Hybrid-group configuration is not demonstrated. This is not an authentication bypass per advisory.

Zip1.1.4/2.4.2/7.2.0 are version-affected by RUSTSEC-2026-0367 (high7.3), 0368 (unscored), 0369 (critical9.1), issued October17. These affect extraction to filesystem (permission/symlink handling), not merely reading members. Patched requirement is >=9.0.0.

Exact parents: zip1.1.4 <- candle-core0.8.4 <- optional ruvector-hailo cpu-fallback; zip2.4.2 <- ndarray-npy0.9.1 <- ruvector-cli; zip7.2.0 <- candle-core0.9.2 <- ruvllm(default candle), ruvector-typesafe-train(exact0.9.2), timesfm/ruvector-timesfm(optional candle). No zip path exists in the root lock dependency graph from ruvector-node, graph-node or gnn-node. This is a source graph claim, not a universal ecosystem safety claim.

Tracked RuVector Rust source search found no zip:: / ZipArchive / ZipStreamReader usage. CLI only calls ReadNpyExt for Array2<f32> .npy reads; format switch is json/csv/npy. Upstream ndarray-npy0.9.1 npz.rs uses member reads, not extraction. Candle0.9.2 source commit 3b39794c14b1de8ba4c2d10d49354d557a415547 (from published .cargo_vcs_info.json): pickle.rs and npy.rs use by_name/by_index member reads, no filesystem extract call. Candle0.8.4 source was not retrieved within bounded attempts; residual transitive reachability remains unverified. No exploitable extraction path established, but no blanket false-positive waiver is warranted.

## Bounded remediation order

1. On existing Cargo-capable runner: `cargo update -p rustls@0.23.45 --precise 0.23.46`; inspect minimal lock diff, run `cargo metadata --locked --format-version 1`, default native core/node/graph/GNN checks, applicable TLS tests, unchanged `cargo audit` and `cargo deny check`. No hand-edited lockfile or ignore entries. Even a successful rustls upgrade would leave zip gates failing.
2. Separate CLI feature-pruning candidate: ndarray-npy `{ version = "0.9", default-features = false }` (or explicitly preserve any needed numeric feature). Current CLI float32 NPY-only usage needs neither NPZ nor complex arrays. Cargo must verify removal of zip2.4.2; add NPY import round-trip plus malformed-input regression and preserve JSON/CSV. This is a suggested candidate, NOT an implemented/validated fix.
3. Candle requires a compatible parent release/migration using zip9, or a reviewed minimal upstream backport. Existing candle0.9.2 zip7 requirement and ndarray-npy0.9.1 zip2 requirement exclude zip9; a blanket cargo update cannot cross them. Do not remove supported inference/Hailo capability merely to silence CI. Exact-pinned trainer dependency also needs explicit review.

## Reproducible static check and sources

`python3 docs/ecosystem/proposals/ruvector-lock-triage.py <RuVector-source-checkout>` passed (read-only lock graph only; no feature resolution). Source checkout remained clean.

- https://rustsec.org/advisories/RUSTSEC-2026-0346.html
- https://rustsec.org/advisories/RUSTSEC-2026-0347.html
- https://rustsec.org/advisories/RUSTSEC-2026-0348.html
- https://rustsec.org/advisories/RUSTSEC-2026-0349.html
- https://rustsec.org/advisories/RUSTSEC-2026-0367.html
- https://rustsec.org/advisories/RUSTSEC-2026-0368.html
- https://rustsec.org/advisories/RUSTSEC-2026-0369.html
- https://github.com/jturner314/ndarray-npy/blob/v0.9.1/Cargo.toml
- https://github.com/jturner314/ndarray-npy/blob/v0.9.1/src/npz.rs
- https://docs.rs/crate/candle-core/0.9.2/source/.cargo_vcs_info.json
- https://docs.rs/crate/candle-core/0.9.2/source/Cargo.toml
- https://github.com/huggingface/candle/blob/3b39794c14b1de8ba4c2d10d49354d557a415547/candle-core/src/pickle.rs
- https://github.com/huggingface/candle/blob/3b39794c14b1de8ba4c2d10d49354d557a415547/candle-core/src/npy.rs

Release remains blocked: no remediation or successful rescan claimed, and unresolved transitive configuration/release-artifact proof remains. Existing public dependency advisories may be summarized; repository policy requires private disclosure for any newly discovered unpublished application vulnerability.
