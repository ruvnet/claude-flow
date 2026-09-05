/**
 * meta-proxy release resolution + download (ADR-307).
 *
 * Two download paths, deliberately not conflated:
 * - **Production** (`downloadReleaseAsset`): public, signed assets from
 *   cognitum-one/meta-proxy-dist. Source remains private; normal users need
 *   neither GitHub authentication nor access to the source repository.
 * - **Dev-only** (`downloadViaGhCli`): shells out to `gh release download`,
 *   gated behind `RUFLO_DEV_PROXY_INSTALL=1` so it is never reachable by
 *   accident, and always logs loudly that it is a developer path.
 *
 * @module proxy/release
 */

export const TARGET_TRIPLES = [
  'aarch64-apple-darwin',
  'x86_64-apple-darwin',
  'x86_64-unknown-linux-gnu',
  'aarch64-unknown-linux-gnu',
  'x86_64-pc-windows-msvc',
] as const;
export type TargetTriple = (typeof TARGET_TRIPLES)[number];

export class UnsupportedPlatformError extends Error {
  constructor(platform: string, arch: string) {
    super(`meta-proxy has no published release for ${platform}/${arch}`);
    this.name = 'UnsupportedPlatformError';
  }
}

/** Maps the running Node process's platform/arch onto one of meta-proxy's 5 published triples. */
export function detectTargetTriple(platform: string = process.platform, arch: string = process.arch): TargetTriple {
  if (platform === 'darwin') return arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  if (platform === 'linux') return arch === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu';
  if (platform === 'win32') {
    if (arch !== 'x64') throw new UnsupportedPlatformError(platform, arch);
    return 'x86_64-pc-windows-msvc';
  }
  throw new UnsupportedPlatformError(platform, arch);
}

export function releaseArchiveExtension(triple: TargetTriple): 'zip' | 'tar.gz' {
  return triple.endsWith('windows-msvc') ? 'zip' : 'tar.gz';
}

export function releaseAssetFilename(version: string, triple: TargetTriple): string {
  return `meta-proxy-${version}-${triple}.${releaseArchiveExtension(triple)}`;
}

export interface ReleaseAssets {
  archiveBytes: Buffer;
  archiveFilename: string;
  sumsBytes: Buffer;
  sigBase64: string;
}

const DEV_INSTALL_ENV = 'RUFLO_DEV_PROXY_INSTALL';
const RELEASE_SOURCE_ENV = 'RUFLO_PROXY_RELEASE_SOURCE';
const GH_REPO = 'cognitum-one/meta-proxy';
const PUBLIC_DIST_BASE = 'https://github.com/cognitum-one/meta-proxy-dist/releases/download';
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

async function downloadPublicAsset(url: string, maxBytes: number): Promise<Buffer> {
  const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`release download failed: HTTP ${response.status} for ${url}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new Error(`release asset exceeds ${maxBytes} byte limit`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`release asset exceeds ${maxBytes} byte limit`);
  return bytes;
}

async function ghExecutor() {
  // Dynamic import, not a static one: @claude-flow/security is only an
  // optionalDependency of this package (see auth/security-bridge.ts for the
  // same reasoning) — a static top-level import would crash module load for
  // any consumer that doesn't have it installed, even ones that never touch
  // this dev-only download path.
  const { SafeExecutor } = await import('@claude-flow/security');
  return new SafeExecutor({ allowedCommands: ['gh'], timeout: 120_000 });
}

/**
 * Dev-only fallback: `gh release download` via SafeExecutor into `destDir`.
 * Requires the caller's environment to already have `gh` authenticated
 * against a GitHub account with access to the private meta-proxy repo — this
 * is NOT something a normal ruflo end user has, which is exactly why this
 * path is gated and logged, not the default.
 */
export async function downloadViaGhCli(
  destDir: string,
  version: string,
  triple: TargetTriple,
  log: (line: string) => void = () => {},
): Promise<ReleaseAssets> {
  const archiveFilename = releaseAssetFilename(version, triple);
  log(
    `[dev-only] Downloading meta-proxy ${version} (${triple}) via \`gh release download\` — ` +
      'this path is NOT how production installs work; it exists for local development only ' +
      `(gated behind ${DEV_INSTALL_ENV}=1).`,
  );

  const exec = await ghExecutor();
  const result = await exec.execute('gh', [
    'release',
    'download',
    `v${version}`,
    '--repo',
    GH_REPO,
    '--dir',
    destDir,
    '--pattern',
    archiveFilename,
    '--pattern',
    'SHA256SUMS',
    '--pattern',
    'SHA256SUMS.sig',
    '--clobber',
  ]);
  if (result.exitCode !== 0) {
    throw new Error(`gh release download failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  }

  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const [archiveBytes, sumsBytes, sigRaw] = await Promise.all([
    readFile(join(destDir, archiveFilename)),
    readFile(join(destDir, 'SHA256SUMS')),
    readFile(join(destDir, 'SHA256SUMS.sig'), 'utf-8'),
  ]);
  return { archiveBytes, archiveFilename, sumsBytes, sigBase64: sigRaw.trim() };
}

/**
 * Production download path — a Cognitum-owned, auth-mediated release-proxy
 * endpoint. Not implemented: no such endpoint exists in the confirmed
 * OpenAPI contract today. Throws a clear, specific error rather than
 * silently falling back to the dev path, so a real user hitting this isn't
 * left guessing whether it's their environment or a genuine gap.
 */
export async function downloadReleaseAsset(
  version: string,
  triple: TargetTriple,
  _destDir: string,
): Promise<ReleaseAssets> {
  const archiveFilename = releaseAssetFilename(version, triple);
  const base = (process.env[RELEASE_SOURCE_ENV] || PUBLIC_DIST_BASE).replace(/\/$/, '');
  const release = `${base}/v${encodeURIComponent(version)}`;
  const [archiveBytes, sumsBytes, sigBytes] = await Promise.all([
    downloadPublicAsset(`${release}/${archiveFilename}`, MAX_ARCHIVE_BYTES),
    downloadPublicAsset(`${release}/SHA256SUMS`, 128 * 1024),
    downloadPublicAsset(`${release}/SHA256SUMS.sig`, 16 * 1024),
  ]);
  return { archiveBytes, archiveFilename, sumsBytes, sigBase64: sigBytes.toString('utf8').trim() };
}

/** Entry point install.ts calls — routes to the dev path when explicitly enabled, else fails clearly. */
export async function fetchReleaseAssets(
  version: string,
  triple: TargetTriple,
  destDir: string,
  log?: (line: string) => void,
): Promise<ReleaseAssets> {
  if (process.env[DEV_INSTALL_ENV] === '1') {
    return downloadViaGhCli(destDir, version, triple, log);
  }
  return downloadReleaseAsset(version, triple, destDir);
}
