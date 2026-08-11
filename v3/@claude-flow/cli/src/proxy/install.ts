/**
 * `ruflo proxy install`/`update` orchestration (ADR-307): download -> verify
 * -> extract -> place -> record. The per-user bearer token
 * (`~/.ruflo/proxy-token`) is NOT generated here — confirmed empirically
 * (2026-07-16) that the meta-proxy binary itself creates it on first launch
 * (`load_or_create_token()`), so this module's job ends at a verified binary
 * on disk plus an install manifest doctor can check against.
 *
 * @module proxy/install
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fetchReleaseAssets, detectTargetTriple, releaseArchiveExtension, releaseAssetFilename, type TargetTriple } from './release.js';
import { verifyRelease, sha256Hex, PROXY_RELEASE_PUBKEY_PEM } from './verify.js';
import { proxyBinaryPath, proxyInstallManifestPath, type InstallManifest } from './paths.js';

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

function binaryNameInArchive(): string {
  return process.platform === 'win32' ? 'meta-proxy.exe' : 'meta-proxy';
}

/** `tar` handles `.tar.gz` everywhere, and `.zip` via bsdtar on Windows 10+. */
async function extractWithTar(archivePath: string, extractDir: string, flags: 'xzf' | 'xf'): Promise<void> {
  const { SafeExecutor } = await import('@claude-flow/security');
  const exec = new SafeExecutor({ allowedCommands: ['tar'], timeout: 60_000 });
  const result = await exec.execute('tar', [flags, archivePath, '-C', extractDir]);
  if (result.exitCode !== 0) {
    throw new ExtractionError(`tar extraction failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
}

/**
 * Single-quoted literal paths (doubling any embedded single quote per
 * PowerShell string-literal escaping) passed as ONE argv element to
 * `-Command`. shell:false means no OS shell ever tokenizes this string —
 * only powershell.exe's own parser does.
 */
async function extractWithPowerShell(archivePath: string, extractDir: string): Promise<void> {
  const { SafeExecutor } = await import('@claude-flow/security');
  const escape = (p: string) => p.replace(/'/g, "''");
  const command = `Expand-Archive -LiteralPath '${escape(archivePath)}' -DestinationPath '${escape(extractDir)}' -Force`;
  const exec = new SafeExecutor({ allowedCommands: ['powershell', 'powershell.exe'], timeout: 60_000 });
  const result = await exec.execute('powershell', ['-NoProfile', '-NonInteractive', '-Command', command]);
  if (result.exitCode !== 0) {
    throw new ExtractionError(`Expand-Archive failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }
}

/**
 * Extracts the archive via the OS's own tools — `tar` for `.tar.gz`
 * (present on macOS/Linux/Windows 10+), PowerShell `Expand-Archive`
 * specifically for `.zip` on Windows. Zero new archive-parsing dependency,
 * matching this repo's existing taste for shelling out over adding a parser dep.
 *
 * `Expand-Archive` stays the PRIMARY `.zip` path — bsdtar's zip support is
 * still not something to lean on by default. But `Microsoft.PowerShell.Archive`
 * is a *script* module resolved through PowerShell's module autoloading, so it
 * can fail for environment reasons entirely unrelated to the archive. Observed
 * in the wild on a healthy Windows 11 box, from ruflo's own `-NonInteractive`
 * child process:
 *
 *   Expand-Archive : The 'Expand-Archive' command was found in the module
 *   'Microsoft.PowerShell.Archive', but the module could not be loaded.
 *
 * The same command succeeded on the same machine minutes later, so this is
 * intermittent rather than a hard platform break. Previously that aborted the
 * install outright with nothing to fall back on, stranding an already
 * downloaded-and-verified archive. Retrying through bsdtar costs one extra
 * process on a path that was going to fail anyway.
 *
 * Exported for tests — extraction is the only platform-divergent step in the
 * install pipeline and had no direct coverage.
 */
export async function extractArchive(archivePath: string, extractDir: string, ext: 'zip' | 'tar.gz'): Promise<void> {
  fs.mkdirSync(extractDir, { recursive: true });

  if (ext === 'tar.gz') {
    await extractWithTar(archivePath, extractDir, 'xzf');
    return;
  }

  try {
    await extractWithPowerShell(archivePath, extractDir);
  } catch (primary) {
    const primaryMessage = primary instanceof Error ? primary.message : String(primary);
    try {
      // 'xf', not 'xzf' — a zip is not gzip-compressed; bsdtar sniffs the format.
      await extractWithTar(archivePath, extractDir, 'xf');
    } catch (fallback) {
      const fallbackMessage = fallback instanceof Error ? fallback.message : String(fallback);
      throw new ExtractionError(
        `zip extraction failed via both available extractors. Expand-Archive: ${primaryMessage} — tar fallback: ${fallbackMessage}`,
      );
    }
  }
}

export interface InstallOptions {
  version: string;
  log?: (line: string) => void;
}

export interface InstallResult {
  version: string;
  binaryPath: string;
  sha256: string;
}

/**
 * Full install pipeline. Refuses (throws) on any verification failure —
 * never writes a partially-verified binary into the live install path.
 */
export async function installProxy(opts: InstallOptions): Promise<InstallResult> {
  const log = opts.log ?? (() => {});
  const triple: TargetTriple = detectTargetTriple();
  const archiveFilename = releaseAssetFilename(opts.version, triple);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ruflo-proxy-install-'));
  try {
    log(`Fetching meta-proxy ${opts.version} (${triple})...`);
    const assets = await fetchReleaseAssets(opts.version, triple, workDir, log);

    log('Verifying release signature and checksum...');
    const { sha256 } = verifyRelease({
      sumsBytes: assets.sumsBytes,
      sigBase64: assets.sigBase64,
      assetBytes: assets.archiveBytes,
      assetFilename: assets.archiveFilename,
    });
    log(`Verified — sha256 ${sha256.slice(0, 16)}…`);

    // fetchReleaseAssets's dev (gh) path already wrote the archive to workDir
    // under archiveFilename; ensure it's there regardless of source so
    // extraction always has a real file to operate on.
    const archivePath = path.join(workDir, archiveFilename);
    if (!fs.existsSync(archivePath)) {
      fs.writeFileSync(archivePath, assets.archiveBytes);
    }

    const extractDir = path.join(workDir, 'extracted');
    await extractArchive(archivePath, extractDir, releaseArchiveExtension(triple));

    const extractedBinaryPath = path.join(extractDir, binaryNameInArchive());
    if (!fs.existsSync(extractedBinaryPath)) {
      throw new ExtractionError(`archive did not contain the expected binary at its root: ${binaryNameInArchive()}`);
    }

    // Defense in depth: confirm the extracted binary genuinely resolves
    // inside extractDir (catches a symlink swap or similar), even though
    // we only ever read one specific expected relative path, never an
    // archive-listed one (so "zip slip" via arbitrary archive paths isn't
    // reachable here in the first place).
    const { PathValidator } = await import('@claude-flow/security');
    const validator = new PathValidator({ allowedPrefixes: [extractDir] });
    const validation = await validator.validate(extractedBinaryPath);
    if (!validation.isValid) {
      throw new ExtractionError(`extracted binary path failed validation: ${validation.errors.join('; ') || 'unknown'}`);
    }

    const finalPath = proxyBinaryPath();
    fs.mkdirSync(path.dirname(finalPath), { recursive: true, mode: 0o700 });
    const tmp = `${finalPath}.tmp`;
    fs.copyFileSync(extractedBinaryPath, tmp);
    fs.chmodSync(tmp, 0o755);
    fs.renameSync(tmp, finalPath);

    const liveSha = sha256Hex(fs.readFileSync(finalPath));
    const manifest: InstallManifest = {
      version: opts.version,
      sha256: liveSha,
      verifiedAt: new Date().toISOString(),
      pubkeyFingerprint: sha256Hex(Buffer.from(PROXY_RELEASE_PUBKEY_PEM)).slice(0, 16),
    };
    fs.mkdirSync(path.dirname(proxyInstallManifestPath()), { recursive: true });
    fs.writeFileSync(proxyInstallManifestPath(), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    log(`meta-proxy ${opts.version} installed at ${finalPath}`);
    return { version: opts.version, binaryPath: finalPath, sha256: liveSha };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

export async function uninstallProxy(): Promise<boolean> {
  const binPath = proxyBinaryPath();
  const existed = fs.existsSync(binPath);
  if (existed) fs.unlinkSync(binPath);
  try {
    fs.unlinkSync(proxyInstallManifestPath());
  } catch {
    /* absent — fine */
  }
  return existed;
}
