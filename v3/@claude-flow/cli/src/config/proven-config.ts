/**
 * Proven Configuration Manifest (ADR-176 proof #3 + ADR-177 core).
 *
 * The signed, constraint-carrying artifact that the self-optimizing harness loop
 * (ADR-176) emits and the propagation channel (ADR-177) ships to installs. Two
 * independent gates decide adoption, and BOTH must pass (fail-closed):
 *
 *   1. Authenticity  — Ed25519 signature over the canonical manifest bytes,
 *                      verified against a baked public key. Proves it came from
 *                      ruflo, unmodified. (native node:crypto, zero deps —
 *                      same primitive as helper-signing.ts / rvfa-signing.ts.)
 *   2. Suitability   — the constraint contract (host/platform/compatibility/
 *                      layer) checked against THIS install. A perfectly-signed
 *                      manifest that doesn't fit the local environment is a safe
 *                      NON-adoption, not an error. "signed != suitable."
 *
 * This is a DISTINCT Ed25519 trust root from helper-signing (ADR-177): the
 * config channel gets its own key so rotating it never touches the hook-code
 * channel that older CLIs verify.
 */
import { createHash, verify as edVerify, sign as edSign } from 'crypto';

/** Ruflo config-signing PUBLIC key (safe to commit). Private half in GCP Secret Manager (ruflo-config-signing-key). */
export const RUFLO_CONFIG_PUBKEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA3zr3BLCFKyrjvjZg9BXxchXIuGYwYwq21FYCjTpQO6A=
-----END PUBLIC KEY-----`;

/** The receipt bundle (ADR-176) — reproducible proof-of-work summary. */
export interface ProvenConfigReceipt {
  heldOutDelta?: number;
  redblue?: 'PASS' | 'FAIL' | 'SKIPPED';
  drift?: number;
  canary?: { rollbackRate?: number; latencyP95?: number; costPerTask?: number };
  receiptCoverage?: number; // 0..1
}

/** The constraint contract (ADR-177 §signed != suitable) + policy reference + receipt. */
export interface ProvenConfigManifest {
  schema: string;                        // 'ruflo.proven-config/v1'
  policy: {
    ref: string;                         // content hash of the verified execution policy (RVFA payload)
    value?: Record<string, unknown>;     // the policy payload itself (config the applier makes active). Optional + additive: older CLIs verify the signature and ignore this field.
  };
  host?: Record<string, string>;         // host name -> semver range (e.g. { 'claude-code': '>=1.9' })
  platform?: string[];                   // e.g. ['linux', 'macOS']
  compatibility?: Record<string, string>;// package -> semver range (e.g. { ruflo: '>=3.24.0' })
  benchmark?: { corpus: string; corpusHash: string };
  layer?: string;                        // ADR-176 hierarchy, e.g. 'framework/node-cli'
  receipt?: ProvenConfigReceipt;
  rollback?: { previousManifest?: string };
}

export interface SignedProvenConfig {
  manifest: ProvenConfigManifest;
  signature: string; // base64 Ed25519 over canonicalManifestBytes(manifest)
  algorithm: 'ed25519';
}

/** The local environment a manifest's constraints are checked against. */
export interface InstallEnv {
  platform: string;                      // node process.platform ('darwin'|'linux'|'win32') or a normalized name
  hosts?: Record<string, string>;        // installed host -> version (e.g. { 'claude-code': '1.9.3' })
  versions?: Record<string, string>;     // package -> installed version (e.g. { ruflo: '3.24.0' })
  layer?: string;                        // the layer this install claims (ADR-176 hierarchy)
}

export function sha256Hex(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Deterministic canonical bytes — recursively sorted object keys so signer and
 * verifier agree byte-for-byte regardless of insertion order.
 */
export function canonicalManifestBytes(m: ProvenConfigManifest): Buffer {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = canon((v as Record<string, unknown>)[k]);
      return out;
    }
    return v;
  };
  return Buffer.from(JSON.stringify(canon(m)), 'utf-8');
}

/** Sign a manifest (publish-time; key from GCP via scripts). */
export function signProvenConfig(manifest: ProvenConfigManifest, privateKeyPem: string): SignedProvenConfig {
  const signature = edSign(null, canonicalManifestBytes(manifest), privateKeyPem).toString('base64');
  return { manifest, signature, algorithm: 'ed25519' };
}

/**
 * Verify a signed manifest against ruflo's config public key. Returns the
 * manifest on success, or null on ANY failure (bad signature, malformed JSON,
 * wrong algorithm, missing fields). Fail-closed.
 */
export function verifyProvenConfig(
  signedJson: string | SignedProvenConfig,
  pubkeyPem: string = RUFLO_CONFIG_PUBKEY,
): ProvenConfigManifest | null {
  try {
    const signed: SignedProvenConfig = typeof signedJson === 'string' ? JSON.parse(signedJson) : signedJson;
    if (!signed || signed.algorithm !== 'ed25519' || !signed.signature || !signed.manifest) return null;
    if (!signed.manifest.schema || !signed.manifest.policy?.ref) return null;
    const ok = edVerify(null, canonicalManifestBytes(signed.manifest), pubkeyPem, Buffer.from(signed.signature, 'base64'));
    return ok ? signed.manifest : null;
  } catch {
    return null;
  }
}

// ── Suitability gate ────────────────────────────────────────────────────────

/** Normalize platform aliases so process.platform matches manifest names. */
function platformMatches(installed: string, allowed: string[]): boolean {
  const norm = (p: string): string => {
    const l = p.toLowerCase();
    if (l === 'darwin' || l === 'macos' || l === 'mac') return 'macos';
    if (l === 'win32' || l === 'windows') return 'windows';
    return l; // linux, etc.
  };
  const want = norm(installed);
  return allowed.some(a => norm(a) === want);
}

function parseVer(v: string): [number, number, number] {
  // Tolerant: accepts X, X.Y, or X.Y.Z (a range like '>=1.9' has no patch).
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) return [0, 0, 0];
  return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
}

function cmpVer(a: string, b: string): number {
  const [a1, a2, a3] = parseVer(a);
  const [b1, b2, b3] = parseVer(b);
  return a1 - b1 || a2 - b2 || a3 - b3;
}

/**
 * Minimal semver-range satisfier for the compat contract. Supports `>=X`, `>X`,
 * `<=X`, `<X`, `=X`, and a bare version `X` (treated as `>=X`). Deliberately
 * small — the manifest contract only uses min-version bounds.
 */
export function satisfiesRange(installed: string, range: string): boolean {
  const r = range.trim();
  const m = /^(>=|<=|>|<|=)?\s*(.+)$/.exec(r);
  if (!m) return false;
  const op = m[1] ?? '>=';
  const target = m[2].trim();
  const c = cmpVer(installed, target);
  switch (op) {
    case '>=': return c >= 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '<': return c < 0;
    case '=': return c === 0;
    default: return false;
  }
}

export interface SuitabilityResult { suitable: boolean; reason?: string }

/**
 * Check a manifest's constraint contract against the local environment.
 * Fail-closed: a missing/unsatisfiable constraint => not suitable (safe skip).
 * A constraint the manifest doesn't declare is not required.
 */
export function isSuitable(manifest: ProvenConfigManifest, env: InstallEnv): SuitabilityResult {
  // platform
  if (manifest.platform && manifest.platform.length > 0) {
    if (!platformMatches(env.platform, manifest.platform)) {
      return { suitable: false, reason: `platform ${env.platform} not in [${manifest.platform.join(', ')}]` };
    }
  }
  // host presence + version
  if (manifest.host) {
    for (const [name, range] of Object.entries(manifest.host)) {
      const installed = env.hosts?.[name];
      if (!installed) return { suitable: false, reason: `required host '${name}' not present` };
      if (!satisfiesRange(installed, range)) {
        return { suitable: false, reason: `host '${name}' ${installed} does not satisfy ${range}` };
      }
    }
  }
  // package compatibility ranges (ruflo, metaharness, …)
  if (manifest.compatibility) {
    for (const [pkg, range] of Object.entries(manifest.compatibility)) {
      const installed = env.versions?.[pkg];
      if (!installed) return { suitable: false, reason: `required package '${pkg}' version unknown` };
      if (!satisfiesRange(installed, range)) {
        return { suitable: false, reason: `${pkg} ${installed} does not satisfy ${range}` };
      }
    }
  }
  // hierarchy layer — an install only adopts a manifest for its own (or an ancestor) layer
  if (manifest.layer && env.layer && manifest.layer !== env.layer) {
    // allow ancestor layers: manifest 'framework/node-cli' is adoptable by env layer that startsWith it or vice-versa
    const a = manifest.layer, b = env.layer;
    if (!(b.startsWith(a) || a.startsWith(b))) {
      return { suitable: false, reason: `layer '${a}' not applicable to install layer '${b}'` };
    }
  }
  return { suitable: true };
}

/**
 * The combined adoption decision (ADR-177): a manifest is adoptable iff it is
 * both authentic (signature verifies) AND suitable (constraints satisfied).
 */
export function evaluateForAdoption(
  signedJson: string | SignedProvenConfig,
  env: InstallEnv,
  pubkeyPem: string = RUFLO_CONFIG_PUBKEY,
): { adopt: boolean; manifest?: ProvenConfigManifest; reason: string } {
  const manifest = verifyProvenConfig(signedJson, pubkeyPem);
  if (!manifest) return { adopt: false, reason: 'signature invalid — refusing (authenticity gate)' };
  const suit = isSuitable(manifest, env);
  if (!suit.suitable) return { adopt: false, manifest, reason: `not suitable — ${suit.reason} (safe skip)` };
  return { adopt: true, manifest, reason: 'authentic + suitable' };
}
