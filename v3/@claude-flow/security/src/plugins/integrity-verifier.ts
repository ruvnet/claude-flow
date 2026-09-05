/**
 * PluginIntegrityVerifier — install-layer security for plugin supply chain.
 *
 * Implements P1 of ADR-145 (ruvnet/ruflo#2254): Stage-1 Ed25519 signature
 * verification at `plugins install`. Stage-2 (semantic-intent scan against
 * SCH attacks) lands in P2; per-namespace write ACLs land in P3-P4.
 *
 * Threat model
 * ------------
 * Ruflo's plugin install path fetches manifests from IPFS via Pinata with
 * NO signature verification and NO intent analysis. Two attacks land today:
 *
 *   - DDIPE (arXiv:2604.03081): malicious logic embedded in plugin docs and
 *     config templates. 11.6-33.5% bypass rate across 4 frameworks/5 models;
 *     2.5% evade both detection and alignment. Stage-1 signing blocks the
 *     static-payload variants.
 *
 *   - SCH (arXiv:2605.14460): malicious intent wrapped as natural-language
 *     "compliance rules" in plugin descriptions. The agent generates the
 *     harmful code at runtime — no static payload exists. 77.67% breach
 *     success, 0.00% scanner detection. Stage-2 (P2) catches this; Stage-1
 *     does not.
 *
 * Scope (P1)
 * ----------
 * - Ed25519 signature verification of a detached signature over the manifest.
 * - Trust-anchor allowlist: the publisher's signing key fingerprint must be
 *   in `trust-anchors.json`, gated on CODEOWNERS review.
 * - Backwards compatible: default mode is warn-only. `CLAUDE_FLOW_STRICT_PLUGINS=true`
 *   makes verification a hard gate.
 *
 * Non-goals (P1)
 * --------------
 * - Semantic intent scan (SCH defence). Lands in P2 with a pattern-rule
 *   fallback for environments without LLM credentials.
 * - Sandboxing the plugin runtime. Orthogonal blast-radius concern.
 *
 * Reference: ADR-145, arXiv:2605.14460 (SCH), arXiv:2604.03081 (DDIPE),
 * arXiv:2604.16548 (Mnemonic Sovereignty survey).
 */

import { createHash } from 'node:crypto';
import * as nodeCrypto from 'node:crypto';

export interface PluginManifest {
  readonly id: string;
  readonly version: string;
  /** Anything else; only `id` + `version` matter for the integrity hash. */
  readonly [extra: string]: unknown;
}

export interface SignedPluginManifest {
  readonly manifest: PluginManifest;
  /** Hex-encoded SHA-256 of the canonical JSON serialisation of manifest. */
  readonly manifestHash: string;
  /** Hex-encoded detached Ed25519 signature over `manifestHash` bytes. */
  readonly signature: string;
  /** Hex-encoded Ed25519 public key of the signer. */
  readonly publicKey: string;
}

export interface TrustAnchor {
  /** Hex-encoded Ed25519 public key the publisher signs with. */
  readonly publicKey: string;
  /** Human-readable owner — for audit, not for trust decisions. */
  readonly owner: string;
  /** Optional ISO 8601 date after which this anchor is no longer trusted. */
  readonly expiresAt?: string;
  /** Optional plugin id glob this anchor is authoritative for (e.g. `@claude-flow/*`). */
  readonly scope?: string;
}

export interface TrustAnchors {
  readonly version: 1;
  readonly anchors: ReadonlyArray<TrustAnchor>;
}

export type VerificationStatus =
  | 'pass'
  | 'signature-missing'
  | 'signature-invalid'
  | 'manifest-hash-mismatch'
  | 'unknown-signer'
  | 'signer-expired'
  | 'signer-out-of-scope';

export interface VerificationResult {
  readonly status: VerificationStatus;
  readonly pluginId: string;
  readonly signerFingerprint?: string;
  /** Verification timestamp — useful for telemetry correlation. */
  readonly ts: number;
  /** Operator-facing detail; do not parse — log only. */
  readonly detail?: string;
}

export interface VerifierConfig {
  readonly trustAnchors: TrustAnchors;
  /**
   * When true, `verify` returns the actual failure status. When false (legacy
   * mode), `verify` returns the failure status BUT callers may choose to
   * proceed with a warning — the strictness gate lives at the caller, not
   * here, so the verifier itself is always pure.
   */
  readonly strict?: boolean;
  /** Optional now-provider for tests. */
  readonly now?: () => number;
}

/**
 * Canonical JSON serialisation for hashing. Deterministic key ordering at
 * every nesting level. Pure; identical input → identical output bytes.
 */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

/** Hex-encoded SHA-256 of the canonical-JSON manifest. */
export function hashManifest(manifest: PluginManifest): string {
  return createHash('sha256').update(canonicalize(manifest)).digest('hex');
}

/** Short fingerprint for telemetry — first 16 hex chars of the key. */
export function fingerprint(publicKey: string): string {
  return publicKey.slice(0, 16);
}

/**
 * Find the trust anchor that vouches for a manifest. Returns the matched
 * anchor (with anchor.publicKey === signer.publicKey) or null.
 *
 * Scope-matching uses a minimal glob: `*` at the end of the scope string
 * matches any suffix. Empty/missing scope matches every plugin id.
 */
export function findAnchor(
  anchors: ReadonlyArray<TrustAnchor>,
  pluginId: string,
  signerPublicKey: string,
  now: number,
): TrustAnchor | null {
  for (const a of anchors) {
    if (a.publicKey !== signerPublicKey) continue;
    if (a.expiresAt && new Date(a.expiresAt).getTime() <= now) continue;
    if (!a.scope || a.scope === '*' || a.scope === pluginId) return a;
    if (a.scope.endsWith('*') && pluginId.startsWith(a.scope.slice(0, -1))) return a;
  }
  return null;
}

/**
 * `PluginIntegrityVerifier` — Stage-1 verifier (signature + trust anchor).
 *
 * Pure-ish: holds the trust-anchor list and clock, no other state. Safe to
 * construct per-invocation or share.
 */
export class PluginIntegrityVerifier {
  constructor(private readonly config: VerifierConfig) {}

  /**
   * Verify a signed manifest. Returns the verification status; the caller
   * decides what to do with `signature-missing` / `manifest-hash-mismatch`
   * etc. based on its strict-mode policy.
   */
  async verify(signed: SignedPluginManifest): Promise<VerificationResult> {
    const now = (this.config.now ?? Date.now)();
    const pluginId = signed.manifest?.id ?? '<unknown>';

    if (!signed.signature || !signed.publicKey) {
      return { status: 'signature-missing', pluginId, ts: now };
    }

    // Re-hash the manifest and compare to the signed hash.
    const recomputed = hashManifest(signed.manifest);
    if (recomputed !== signed.manifestHash) {
      return {
        status: 'manifest-hash-mismatch',
        pluginId,
        signerFingerprint: fingerprint(signed.publicKey),
        ts: now,
        detail: `expected ${signed.manifestHash}, got ${recomputed}`,
      };
    }

    // Find a trust anchor that vouches for this signer + plugin.
    const anchor = findAnchor(this.config.trustAnchors.anchors, pluginId, signed.publicKey, now);
    if (!anchor) {
      return {
        status: 'unknown-signer',
        pluginId,
        signerFingerprint: fingerprint(signed.publicKey),
        ts: now,
      };
    }

    // Ed25519 verify. Probe @noble/ed25519 (already a workspace dep); fall
    // back to the failure status if it isn't resolvable in this environment
    // (mirrors verify.mjs's #1880 precondition pattern).
    const ed = await loadEd25519();
    if (!ed) {
      return {
        status: 'signature-invalid',
        pluginId,
        signerFingerprint: fingerprint(signed.publicKey),
        ts: now,
        detail: '@noble/ed25519 not available — cannot verify',
      };
    }

    // Required by @noble/ed25519 v2 for sync sha512.
    if (!ed.etc.sha512Sync) {
      ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => {
        const h = nodeCrypto.createHash('sha512');
        for (const x of m) h.update(x);
        return h.digest();
      };
    }

    let ok = false;
    try {
      const sigBytes = hexToBytes(signed.signature);
      const msgBytes = hexToBytes(signed.manifestHash);
      const pubBytes = hexToBytes(signed.publicKey);
      ok = await ed.verify(sigBytes, msgBytes, pubBytes);
    } catch {
      ok = false;
    }

    if (!ok) {
      return {
        status: 'signature-invalid',
        pluginId,
        signerFingerprint: fingerprint(signed.publicKey),
        ts: now,
      };
    }

    return { status: 'pass', pluginId, signerFingerprint: fingerprint(signed.publicKey), ts: now };
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

interface NobleEd25519 {
  verify(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): Promise<boolean>;
  etc: { sha512Sync?: (...m: Uint8Array[]) => Uint8Array };
}

async function loadEd25519(): Promise<NobleEd25519 | null> {
  try {
    const mod = await import('@noble/ed25519');
    return mod as unknown as NobleEd25519;
  } catch {
    return null;
  }
}
