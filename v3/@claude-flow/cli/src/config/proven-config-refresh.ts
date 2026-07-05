/**
 * Proven-configuration propagation to existing installs (ADR-177).
 *
 * A SIBLING of the helper auto-refresh (ADR-174), deliberately independent so it
 * never touches the hook-code channel that older CLIs verify:
 *   - its own stamp file (`.proven-config-version`, the adopted champion id),
 *   - its own trust root (RUFLO_CONFIG_PUBKEY),
 *   - additive-only: a project with no shipped manifest is a no-op.
 *
 * On a CLI command, if the package ships a signed champion newer than the
 * project's stamp, it is adopted ONLY when both gates pass (ADR-177):
 * authenticity (Ed25519) AND suitability (host/platform/compatibility/layer).
 * A signed-but-unsuitable champion is a SAFE skip (not an error), which is also
 * the backwards-compatibility version gate. Zero deps on the decision path.
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { getInstalledCliVersion } from '../init/helper-refresh.js';
import { evaluateForAdoption, type InstallEnv, type SignedProvenConfig } from './proven-config.js';
import { unpackProvenConfigRvfa } from './proven-config-rvfa.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROVEN_CONFIG_STAMP = '.proven-config-version';
/** The signed champion manifest shipped in the package (metadata; the RVFA payload rides alongside). */
export const PROVEN_CONFIG_FILE = 'proven-config.signed.json';
/** The RVFA-packaged champion (ADR-177 final phase). Preferred when present. */
export const PROVEN_CONFIG_RVFA_FILE = 'proven-config.signed.rvf';
/** Where an adopted champion is recorded in the project (consumed by the feedback applier, ADR-176 phase 9). */
export const ADOPTED_CONFIG_FILE = 'proven-config.json';

/**
 * Locate the package's shipped signed champion, if any. Null when none ships.
 * The RVFA package is preferred over the raw JSON when both are present.
 */
function findPackageProvenConfig(): string | null {
  const dirs: string[] = [];
  try {
    const esmRequire = createRequire(import.meta.url);
    const pkgRoot = path.dirname(esmRequire.resolve('@claude-flow/cli/package.json'));
    dirs.push(path.join(pkgRoot, '.claude'));
  } catch { /* not resolvable */ }
  dirs.push(path.resolve(__dirname, '..', '..', '..', '.claude'));
  // RVFA form first (ruvnet-native envelope), then the raw signed JSON fallback.
  for (const d of dirs) {
    const rvf = path.join(d, PROVEN_CONFIG_RVFA_FILE);
    if (fs.existsSync(rvf)) return rvf;
    const json = path.join(d, PROVEN_CONFIG_FILE);
    if (fs.existsSync(json)) return json;
  }
  return null;
}

/**
 * Read a shipped champion from either packaging. `.rvf` → unpack the RVFA
 * envelope (integrity-checked); anything else → parse as signed JSON. Returns
 * null (never throws) on any failure. The Ed25519 signature is still verified
 * downstream by adoptSignedConfig — this only decodes the transport.
 */
export function loadShippedChampion(srcPath: string): SignedProvenConfig | null {
  try {
    if (srcPath.endsWith('.rvf')) {
      return unpackProvenConfigRvfa(fs.readFileSync(srcPath));
    }
    return JSON.parse(fs.readFileSync(srcPath, 'utf-8')) as SignedProvenConfig;
  } catch {
    return null;
  }
}

/** Build the local environment the champion's constraints are checked against. */
export function currentInstallEnv(cwd: string = process.cwd()): InstallEnv {
  const env: InstallEnv = {
    platform: process.platform,
    versions: { ruflo: getInstalledCliVersion() },
  };
  // Layer, if the project declares one (ADR-176 hierarchy). Optional.
  try {
    const layerFile = path.join(cwd, '.claude', '.harness-layer');
    if (fs.existsSync(layerFile)) env.layer = fs.readFileSync(layerFile, 'utf-8').trim();
  } catch { /* none */ }
  return env;
}

export interface AdoptResult { adopted: boolean; from?: string; to?: string; reason?: string; skipped?: string }

/**
 * The testable adoption core: given a signed champion and the local env, adopt
 * it into `cwd/.claude` iff it is newer than the stamp AND passes both gates.
 * Fail-closed; never throws. `pubkeyPem` is injectable for tests.
 */
export function adoptSignedConfig(
  cwd: string,
  signed: SignedProvenConfig,
  env: InstallEnv,
  opts: { pubkeyPem?: string } = {},
): AdoptResult {
  try {
    const claudeDir = path.join(cwd, '.claude');
    if (!fs.existsSync(claudeDir)) return { adopted: false }; // not a ruflo project
    const championId = signed.manifest?.policy?.ref;
    if (!championId) return { adopted: false, skipped: 'manifest missing policy.ref' };

    let stamped = '';
    try { stamped = fs.readFileSync(path.join(claudeDir, PROVEN_CONFIG_STAMP), 'utf-8').trim(); } catch { /* unstamped */ }
    if (stamped === championId) return { adopted: false }; // already current — fast path

    const decision = evaluateForAdoption(signed, env, opts.pubkeyPem);
    if (!decision.adopt) {
      // A safe skip (unsuitable) or a refusal (bad signature). Do NOT advance the stamp.
      return { adopted: false, skipped: decision.reason };
    }

    // Adopt: record the champion for the feedback applier + retain the previous (rollback pointer).
    const record = {
      adoptedAt: Date.now(),
      championId,
      manifest: decision.manifest,
      previous: signed.manifest.rollback?.previousManifest ?? stamped ?? null,
    };
    try { fs.writeFileSync(path.join(claudeDir, ADOPTED_CONFIG_FILE), JSON.stringify(record, null, 2), 'utf-8'); } catch { /* */ }
    try { fs.writeFileSync(path.join(claudeDir, PROVEN_CONFIG_STAMP), championId, 'utf-8'); } catch { /* */ }
    return { adopted: true, from: stamped || '(none)', to: championId };
  } catch {
    return { adopted: false };
  }
}

/**
 * On CLI startup: if the package ships a signed champion newer than the
 * project's stamp, adopt it when authentic + suitable. Best-effort, never
 * throws. No-op when no manifest ships or the project isn't initialized.
 */
export async function autoAdoptProvenConfigIfStale(cwd: string = process.cwd()): Promise<AdoptResult> {
  try {
    if (!fs.existsSync(path.join(cwd, '.claude'))) return { adopted: false };
    const src = findPackageProvenConfig();
    if (!src) return { adopted: false }; // no champion ships → no-op (additive)
    const signed = loadShippedChampion(src);
    if (!signed) return { adopted: false, skipped: 'unreadable manifest' };
    return adoptSignedConfig(cwd, signed, currentInstallEnv(cwd));
  } catch {
    return { adopted: false };
  }
}
