/**
 * CASA decision receipt logger (ADR-380 §3).
 *
 * MetaHarness (companion ADR-240 §4) compiles a user's objective into a
 * bounded authority envelope (`allow`/`deny` resource lists, a budget, an
 * expiry timestamp). RuFlo is where that envelope is *enforced* — a
 * deterministic, non-LLM gate in front of every MCP tool call and every
 * `Agent`/`Task` dispatch. ADR-380 §3 requires "RuFlo logs every decision
 * into signed receipts", extending this repo's existing witness/receipt
 * precedent (ADR-103's fix-attestation model, the ADR-126 Phase 4/6
 * signed-artifact family in `plugins/ruflo-neural-trader/src/signed-*.ts`)
 * to per-invocation CASA authorization decisions.
 *
 * This module intentionally does NOT implement CASA enforcement itself
 * (the `allow`/`deny`/`expires_at` check against the compiled envelope) —
 * only the append-only signed audit trail of decisions already made
 * elsewhere. It mirrors the ADR-150 Phase 2 `router-parallel-recorder.ts`
 * pattern of one JSON-line per decision appended to a `.swarm/*.jsonl`
 * file, but for CASA decisions specifically and with the receipt line
 * Ed25519-signed (the router-parallel recorder is unsigned telemetry;
 * a CASA authorization decision is a security-relevant record and needs
 * tamper evidence).
 *
 * Signing scheme:
 *   - Uses `@noble/ed25519` (already a hard dependency — see root
 *     `package.json`), not `node:crypto`, matching the signing library
 *     this repo's ADR-126 signed-artifact family
 *     (`plugins/ruflo-neural-trader/src/signed-artifact.ts`,
 *     `signed-attribution.ts`) already uses.
 *   - Canonical bytes = `JSON.stringify(body)` over the receipt body
 *     WITHOUT the `schema`/`publicKey`/`signature` fields — plain, no
 *     whitespace, no key sorting — identical convention to the
 *     ADR-126 signed-artifact family (CWE-347 pattern, #1922).
 *   - Keypair generation/loading mirrors
 *     `v3/@claude-flow/plugin-agent-federation/src/plugin.ts`'s exact
 *     pattern: a JSON key file under `.claude-flow/<namespace>/`
 *     (hex-encoded `privateKey`/`publicKey` fields, dir mode 0o700, file
 *     mode 0o600), generated with `ed.utils.randomPrivateKey()` on first
 *     use and persisted so the signing identity survives restarts; falls
 *     back to an ephemeral in-memory key if persistence fails (still real
 *     crypto, just not durable). `@noble/ed25519` v2's synchronous API
 *     needs `sha512Sync` wired explicitly via `node:crypto` — same one-line
 *     wiring the federation plugin uses.
 *   - Verification pins to a caller-supplied trusted public key when one
 *     is given (never trust the receipt's self-asserted `publicKey` field
 *     alone in production — same CWE-347 caution the signed-artifact
 *     family documents), falling back to the embedded key only when no
 *     trusted key is supplied (e.g. local inspection / tests).
 *
 * @see v3/docs/adr/ADR-380-agntcy-outshift-runtime-integration.md §3
 * @see v3/@claude-flow/plugin-agent-federation/src/plugin.ts — key handling pattern
 * @see plugins/ruflo-neural-trader/src/signed-artifact.ts — signing/canonicalization pattern
 * @see v3/@claude-flow/cli/src/ruvector/router-parallel-recorder.ts — the JSONL append-log precedent (ADR-150 Phase 2)
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  appendFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// @noble/ed25519 v2 needs a sync sha512 wired explicitly. Identical wiring
// to v3/@claude-flow/plugin-agent-federation/src/plugin.ts — kept local
// (rather than imported) so this module has no dependency on the
// federation plugin package.
let _ed: typeof import('@noble/ed25519') | null = null;
async function loadEd(): Promise<typeof import('@noble/ed25519')> {
  if (_ed) return _ed;
  const ed = await import('@noble/ed25519');
  ed.etc.sha512Sync = (...m: Uint8Array[]): Uint8Array => {
    const h = createHash('sha512');
    for (const x of m) h.update(x);
    return h.digest();
  };
  _ed = ed;
  return ed;
}

/* ---------------------------------------------------------------------- */
/* Public types                                                           */
/* ---------------------------------------------------------------------- */

/** A CASA authorization decision, prior to signing. */
export interface CasaReceiptInput {
  /** The full request envelope that was evaluated (opaque to this module). */
  envelope: unknown;
  /** The resource/action string that was checked, e.g. `git.push`. */
  requestedAction: string;
  /** The enforcement outcome. */
  decision: {
    allowed: boolean;
    reason: string;
  };
  /** ISO-8601 timestamp of the decision. */
  timestampIso: string;
}

/** The signed, on-disk JSONL receipt record. */
export interface SignedCasaReceipt extends CasaReceiptInput {
  schema: 'ruflo-agntcy-casa-receipt/v1';
  /** `ed25519:<hex>` — self-asserted signer key (see caution in module doc). */
  publicKey: string;
  /** hex-encoded Ed25519 signature over the canonical receipt body. */
  signature: string;
}

/** Body that gets signed — everything except schema + signature fields. */
export type SignedCasaReceiptBody = CasaReceiptInput;

/** An Ed25519 keypair used to sign CASA receipts. */
export interface CasaSigningKeypair {
  privateKey: Uint8Array;
  /** hex-encoded, no `ed25519:` prefix. */
  publicKeyHex: string;
}

/* ---------------------------------------------------------------------- */
/* Defaults                                                               */
/* ---------------------------------------------------------------------- */

/** Default append-only receipt log path, mirroring `.swarm/router-parallel.jsonl`. */
export const DEFAULT_CASA_RECEIPT_PATH = join('.swarm', 'casa-receipts.jsonl');

/** Default directory + file the CASA signing keypair is persisted to. */
const DEFAULT_KEY_DIR = join('.claude-flow', 'agntcy');
const DEFAULT_KEY_PATH = join(DEFAULT_KEY_DIR, 'casa-receipt-key.json');

interface StoredCasaKeypair {
  privateKey: string;
  publicKey: string;
  createdAt: string;
}

/* ---------------------------------------------------------------------- */
/* Key handling — mirrors plugin-agent-federation/src/plugin.ts           */
/* ---------------------------------------------------------------------- */

/**
 * Load the persisted CASA signing keypair from `keyPath`, generating and
 * persisting a fresh one on first use. Falls back to an ephemeral
 * (non-persisted) keypair if the filesystem is unavailable/unwritable —
 * signing still happens with real Ed25519 keys, they just won't survive
 * a restart.
 */
export async function loadOrCreateCasaSigningKeypair(
  keyPath: string = DEFAULT_KEY_PATH,
): Promise<CasaSigningKeypair> {
  const ed = await loadEd();
  try {
    if (existsSync(keyPath)) {
      const stored = JSON.parse(readFileSync(keyPath, 'utf-8')) as StoredCasaKeypair;
      return {
        privateKey: hexToBytes(stored.privateKey),
        publicKeyHex: stored.publicKey,
      };
    }
    const privateKey = ed.utils.randomPrivateKey();
    const publicKeyHex = bytesToHex(ed.getPublicKey(privateKey));
    const keyDir = dirname(keyPath);
    if (!existsSync(keyDir)) mkdirSync(keyDir, { recursive: true, mode: 0o700 });
    const record: StoredCasaKeypair = {
      privateKey: bytesToHex(privateKey),
      publicKey: publicKeyHex,
      createdAt: new Date().toISOString(),
    };
    writeFileSync(keyPath, JSON.stringify(record, null, 2), { mode: 0o600 });
    return { privateKey, publicKeyHex };
  } catch {
    // Persistence failed (read-only fs, permissions, ...) — fall back to
    // an ephemeral key. Still real Ed25519 crypto, just not durable.
    const privateKey = ed.utils.randomPrivateKey();
    return { privateKey, publicKeyHex: bytesToHex(ed.getPublicKey(privateKey)) };
  }
}

/* ---------------------------------------------------------------------- */
/* Signing + verification                                                 */
/* ---------------------------------------------------------------------- */

function canonicalBytes(body: SignedCasaReceiptBody): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

/**
 * Sign a CASA decision and return the fully-formed `SignedCasaReceipt`.
 * The signature covers the receipt body WITHOUT `schema`, `publicKey`, or
 * `signature` (CWE-347 pattern — same convention as the ADR-126
 * signed-artifact family).
 */
export async function signCasaReceipt(
  input: CasaReceiptInput,
  keypair: CasaSigningKeypair,
): Promise<SignedCasaReceipt> {
  const ed = await loadEd();
  const canonical = canonicalBytes(input);
  const signatureBytes = ed.sign(canonical, keypair.privateKey);
  return {
    schema: 'ruflo-agntcy-casa-receipt/v1',
    ...input,
    publicKey: `ed25519:${keypair.publicKeyHex}`,
    signature: bytesToHex(signatureBytes),
  };
}

/**
 * Verify a signed CASA receipt. When `trustedPublicKey` is supplied,
 * verification pins to it (the receipt's self-asserted `publicKey` field
 * is untrusted input an attacker controls). When omitted, falls back to
 * the receipt's own embedded key — only safe for local inspection/tests,
 * never for production trust decisions.
 */
export async function verifyCasaReceipt(
  receipt: SignedCasaReceipt,
  trustedPublicKey?: string,
): Promise<boolean> {
  if (!receipt || !receipt.signature) return false;
  const ed = await loadEd();

  const body: SignedCasaReceiptBody = {
    envelope: receipt.envelope,
    requestedAction: receipt.requestedAction,
    decision: receipt.decision,
    timestampIso: receipt.timestampIso,
  };
  const canonical = canonicalBytes(body);

  try {
    const keySource = trustedPublicKey ?? receipt.publicKey;
    const pubKeyHex = keySource.replace(/^ed25519:/, '');
    const pubKey = hexToBytes(pubKeyHex);
    if (pubKey.length !== 32) return false;
    const sig = hexToBytes(receipt.signature);
    if (sig.length !== 64) return false;
    return ed.verify(sig, canonical, pubKey);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------------- */
/* Append-only JSONL log                                                  */
/* ---------------------------------------------------------------------- */

/**
 * Ed25519-sign a CASA authorization decision and append it as one JSON
 * line to `filePath` (default `.swarm/casa-receipts.jsonl`), creating the
 * parent directory if needed. Mirrors the append-only paired-decision-row
 * pattern in `router-parallel-recorder.ts` (ADR-150 Phase 2), but for CASA
 * decisions specifically and with a real signature on every row instead
 * of unsigned telemetry.
 *
 * Unlike the router-parallel recorder, this never silently swallows a
 * write failure — a CASA receipt is a security-relevant audit record, so
 * a failed append surfaces as a thrown error rather than being logged and
 * dropped.
 */
export async function appendCasaReceipt(
  receipt: CasaReceiptInput,
  filePath: string = DEFAULT_CASA_RECEIPT_PATH,
): Promise<void> {
  const keypair = await loadOrCreateCasaSigningKeypair();
  const signed = await signCasaReceipt(receipt, keypair);

  const dir = dirname(filePath);
  if (dir && dir !== '.' && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(filePath, JSON.stringify(signed) + '\n', { encoding: 'utf-8' });
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/, '');
  if (clean.length % 2 !== 0) {
    throw new Error('hexToBytes: odd-length hex string');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}
