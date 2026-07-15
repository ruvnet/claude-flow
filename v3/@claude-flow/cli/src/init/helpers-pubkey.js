/**
 * Ruflo helper-signing PUBLIC key (safe to commit). The matching private key is
 * held out-of-repo and provided to scripts/sign-helpers.mjs at publish time via
 * $RUFLO_HELPERS_SIGNING_KEY. Rotating the key = replace this constant + re-sign.
 *
 * ROTATED 2026-07-14 (v3.29.0): the previous key was accidentally exposed in a
 * Claude Code session transcript. Old GCP secret version 1 was destroyed (not
 * disabled) so it cannot be re-enabled; new v2 generated here. Users on old
 * ruflo versions keep the old pubkey and verify old manifests successfully;
 * upgrading to v3.29.0+ atomically picks up this new pubkey along with the
 * new-key-signed manifest.
 *
 * Single source of truth (ADR-323): src/init/helper-signing.ts re-exports this
 * constant for TypeScript consumers; scripts/verify-helpers.mjs imports it
 * directly. Rotate the key here ONLY — do not reintroduce a second copy.
 */
export const RUFLO_HELPERS_PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAyLl9cG+V/C+ffKWaSwvOsHdXSWmB5e3x1z9NUNvq6Ys=
-----END PUBLIC KEY-----`;
