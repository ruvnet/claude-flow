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

/**
 * Extracts the archive via the OS's own tools — `tar` for `.tar.gz`
 * (present on macOS/Linux/Windows 10+), PowerShell `Expand-Archive`
 * specifically for `.zip` on Windows (not tar's bsdtar zip support — not
 * reliable enough to lean on). Zero new archive-parsing dependency, matching
 * this repo's existing taste for shelling out over adding a parser dep.
 */
async function extractArchive(archivePath: string, extractDir: string, ext: 'zip' | 'tar.gz'): Promise<void> {
  const { SafeExecutor } = await import('@claude-flow/security');
  fs.mkdirSync(extractDir, { recursive: true });

  if (ext === 'tar.gz') {
    const exec = new SafeExecutor({ allowedCommands: ['tar'], timeout: 60_000 });
    const result = await exec.execute('tar', ['xzf', archivePath, '-C', extractDir]);
    if (result.exitCode !== 0) {
      throw new ExtractionError(`tar extraction failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    return;
  }

  // .zip — PowerShell Expand-Archive, single-quoted literal paths (doubling
  // any embedded single quote per PowerShell string-literal escaping) passed
  // as ONE argv element to -Command. shell:false means no OS shell ever
  // tokenizes this string — only powershell.exe's own parser does.
  const escape = (p: string) => p.replace(/'/g, "''");
  const command = `Expand-Archive -LiteralPath '${escape(archivePath)}' -DestinationPath '${escape(extractDir)}' -Force`;
  const exec = new SafeExecutor({ allowedCommands: ['powershell', 'powershell.exe'], timeout: 60_000 });
  const result = await exec.execute('powershell', ['-NoProfile', '-NonInteractive', '-Command', command]);
  if (result.exitCode !== 0) {
    throw new ExtractionError(`Expand-Archive failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
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
