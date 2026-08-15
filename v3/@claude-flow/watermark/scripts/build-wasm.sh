#!/usr/bin/env bash
# Regenerate the WASM bindings in ./wasm from the ruflo-watermark Rust crate.
#
# Requires: rustup + wasm32-unknown-unknown target + wasm-pack.
#   rustup target add wasm32-unknown-unknown
#   cargo install wasm-pack
#
# RUSTFLAGS is cleared for the wasm target because a machine-global
# `-C link-arg=-fuse-ld=mold` (if present) is rejected by wasm's rust-lld.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crate="$here/../../crates/ruflo-watermark"

CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS="" RUSTFLAGS="" \
  wasm-pack build --release --target nodejs \
    --out-dir "$crate/pkg-nodejs" --out-name ruflo_watermark \
    "$crate" -- --features wasm

cp "$crate/pkg-nodejs/ruflo_watermark.js" \
   "$crate/pkg-nodejs/ruflo_watermark_bg.wasm" \
   "$crate/pkg-nodejs/ruflo_watermark.d.ts" \
   "$crate/pkg-nodejs/ruflo_watermark_bg.wasm.d.ts" \
   "$here/wasm/"

echo "Rebuilt wasm/ from $crate"
