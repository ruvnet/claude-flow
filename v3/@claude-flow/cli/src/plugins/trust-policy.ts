/**
 * Plugin install trust policy (#3557).
 *
 * `plugins install --verify` used to be parsed and never read, and a plugin's
 * declared `trustLevel`/`permissions` were neither recorded nor enforced.
 * These pure helpers decide what an install may register.
 */

import { createHash } from 'crypto';
import { ExtendedPoint } from '@noble/ed25519';

/**
 * Permissions a plugin may declare and still have its hooks and commands
 * registered without `--trust`. Anything else (filesystem, network, shell,
 * secrets, config, privileged, …) needs an explicit `--trust`.
 */
export const DEFAULT_PLUGIN_PERMISSIONS: readonly string[] = Object.freeze(['memory:read']);

/** Trust levels that are withheld unless the user passes `--trust`. */
export const UNTRUSTED_TRUST_LEVELS: readonly string[] = Object.freeze(['untrusted', 'unverified']);

/** Registry trust levels that the registry itself vouches for. */
export const REGISTRY_VOUCHED_TRUST_LEVELS: readonly string[] = Object.freeze(['official', 'verified']);

export interface DeclaredTrust {
  trustLevel?: string;
  permissions: string[];
}

export interface TrustDecision {
  /** Hooks and commands may be registered. */
  allowed: boolean;
  /** Verification was skipped with `--no-verify`. */
  verificationSkipped: boolean;
  /** Why registration was withheld (empty when allowed). */
  reasons: string[];
  /** Declared permissions outside {@link DEFAULT_PLUGIN_PERMISSIONS}. */
  excessPermissions: string[];
}

export interface TrustOptions {
  /** `--verify` (default true). */
  verify: boolean;
  /** `--trust` (default false). */
  trust: boolean;
  /** Trust level from a registry entry, when the plugin was found there. */
  registryTrustLevel?: string;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
}

/**
 * Read the trust declaration from a plugin's package.json. The `claude-flow`
 * block wins; top-level fields are accepted as a fallback.
 */
export function readDeclaredTrust(pkg: Record<string, unknown>): DeclaredTrust {
  const block = (pkg['claude-flow'] && typeof pkg['claude-flow'] === 'object'
    ? pkg['claude-flow']
    : {}) as Record<string, unknown>;
  const trustLevel = typeof block.trustLevel === 'string'
    ? block.trustLevel
    : typeof pkg.trustLevel === 'string' ? pkg.trustLevel : undefined;
  const permissions = asStringList(block.permissions).length > 0
    ? asStringList(block.permissions)
    : asStringList(pkg.permissions);
  return { trustLevel, permissions };
}

/** Decide whether an install may register the plugin's hooks and commands. */
export function evaluatePluginTrust(declared: DeclaredTrust, opts: TrustOptions): TrustDecision {
  const excessPermissions = declared.permissions.filter((p) => !DEFAULT_PLUGIN_PERMISSIONS.includes(p));

  if (!opts.verify) {
    return { allowed: true, verificationSkipped: true, reasons: [], excessPermissions };
  }

  const reasons: string[] = [];
  const registryVouched = opts.registryTrustLevel !== undefined
    && REGISTRY_VOUCHED_TRUST_LEVELS.includes(opts.registryTrustLevel);

  if (!registryVouched) {
    if (declared.trustLevel && UNTRUSTED_TRUST_LEVELS.includes(declared.trustLevel)) {
      reasons.push(`declares trustLevel "${declared.trustLevel}"`);
    }
    if (excessPermissions.length > 0) {
      reasons.push(
        `declares permissions beyond the default set (${DEFAULT_PLUGIN_PERMISSIONS.join(', ')}): ${excessPermissions.join(', ')}`,
      );
    }
  }

  if (reasons.length > 0 && !opts.trust) {
    return { allowed: false, verificationSkipped: false, reasons, excessPermissions };
  }
  return { allowed: true, verificationSkipped: false, reasons: [], excessPermissions };
}

/**
 * Whether npm may run the package's lifecycle scripts (preinstall/install/
 * postinstall, and those of its dependencies). Scripts execute before the
 * package's own trust declaration can be read, so only an explicit `--trust`
 * or a registry-vouched entry allows them; everything else installs with
 * `--ignore-scripts`.
 */
export function shouldRunInstallScripts(opts: { trust?: boolean; registryTrustLevel?: string }): boolean {
  if (opts.trust === true) return true;
  return opts.registryTrustLevel !== undefined && REGISTRY_VOUCHED_TRUST_LEVELS.includes(opts.registryTrustLevel);
}

/** A registry checksum we can actually verify: `sha256:` + 64 hex chars. */
export function parseSha256Checksum(checksum: unknown): string | null {
  if (typeof checksum !== 'string') return null;
  const m = /^sha256:([0-9a-f]{64})$/i.exec(checksum.trim());
  return m ? m[1].toLowerCase() : null;
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Whether `CLAUDE_FLOW_STRICT_PLUGINS=true` (ADR-145): an unverified plugin
 * registry is then an error, not a warning.
 */
export function isStrictPluginMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.CLAUDE_FLOW_STRICT_PLUGINS ?? '').trim().toLowerCase() === 'true';
}

/**
 * A signing key that cannot vouch for anything: missing, not 32 bytes of hex,
 * not a curve point, or a small-order point — which includes the all-zero
 * placeholder in `trust/trust-anchors.json`. Signatures can be forged against
 * small-order keys under ZIP-215 verification, so such a key must never be
 * handed to a verifier.
 */
export function isPlaceholderSigningKey(key: unknown): boolean {
  if (typeof key !== 'string') return true;
  const hex = key.trim().replace(/^ed25519:/i, '');
  if (!/^[0-9a-f]{64}$/i.test(hex)) return true;
  try {
    // zip215=true decodes every encoding a lenient verifier would accept.
    return ExtendedPoint.fromHex(hex, true).isSmallOrder();
  } catch {
    return true;
  }
}
