/**
 * London-school (mockist) tests for ADR-322's secret-capture hardening of
 * scripts/sign-helpers.mjs. Every external boundary — the `gcloud` subprocess
 * (execFileSync), the filesystem (readFileSync), the home dir (homedir) and
 * process.exit — is mocked; the tests verify INTERACTIONS (which binary is
 * invoked, whether stdin is consulted, whether gcloud is called at all), never
 * real GCP or real key files.
 *
 * The script top-level-executes when run as `node scripts/sign-helpers.mjs`,
 * but guards that behind an import.meta.url === argv[1] check, so importing it
 * here exercises only the exported loadPrivateKey / scanCapturedOutputForLeak.
 *
 * Covers all four ADR-322 behaviors:
 *   1. win32 → `gcloud.cmd`, non-win32 → `gcloud`.
 *   2. `--stdin-key` reads the PEM from fd 0.
 *   3. TTY refusal gate on the GCP-secret branch (+ ALLOW_TTY override).
 *   4. Resolution order: GCP-secret path wins over `--stdin-key`.
 *   5. Output-scan safety net trips on a real leaked-key marker.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));
vi.mock('node:os', () => ({ homedir: vi.fn(() => '/home/testuser') }));

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { loadPrivateKey, scanCapturedOutputForLeak } from '../scripts/sign-helpers.mjs';

const execFileSyncMock = vi.mocked(execFileSync);
const readFileSyncMock = vi.mocked(readFileSync);

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_ISTTY = process.stdout.isTTY;
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_ENV = process.env;

let exitSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

/** Force process.platform, since loadPrivateKey branches on it at call time. */
function setPlatform(platform: NodeJS.Platform) {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  readFileSyncMock.mockReturnValue('DEFAULT_PEM');
  // Fresh env per test so leftover RUFLO_* vars can't cross-contaminate.
  process.env = { ...ORIGINAL_ENV };
  delete process.env.RUFLO_HELPERS_SIGNING_SECRET;
  delete process.env.RUFLO_HELPERS_SIGNING_PROJECT;
  delete process.env.RUFLO_HELPERS_SIGNING_KEY;
  delete process.env.RUFLO_HELPERS_ALLOW_TTY;
  process.argv = ['node', '/some/path/sign-helpers.mjs']; // no --stdin-key by default
  process.stdout.isTTY = false;
  setPlatform('linux');
  // process.exit must not really exit — throw so control flow stops like the real thing.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__EXIT__${code}`);
  }) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
  process.stdout.isTTY = ORIGINAL_ISTTY;
  process.argv = ORIGINAL_ARGV;
  process.env = ORIGINAL_ENV;
  exitSpy.mockRestore();
  errorSpy.mockRestore();
});

describe('ADR-322 §1 — Windows spawn fix: gcloud.cmd on win32, gcloud elsewhere', () => {
  it('invokes `gcloud.cmd` (not `gcloud`) on win32', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 'ruflo-helpers-signing-key';
    setPlatform('win32');
    execFileSyncMock.mockReturnValue('WIN_PEM');

    const pem = loadPrivateKey();

    expect(pem).toBe('WIN_PEM');
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    expect(execFileSyncMock.mock.calls[0][0]).toBe('gcloud.cmd');
    expect(execFileSyncMock.mock.calls[0][1]).toEqual(
      ['secrets', 'versions', 'access', 'latest', '--secret', 'ruflo-helpers-signing-key'],
    );
  });

  it('invokes `gcloud` (not `gcloud.cmd`) on non-win32', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 'ruflo-helpers-signing-key';
    setPlatform('linux');
    execFileSyncMock.mockReturnValue('LINUX_PEM');

    const pem = loadPrivateKey();

    expect(pem).toBe('LINUX_PEM');
    expect(execFileSyncMock.mock.calls[0][0]).toBe('gcloud');
  });

  it('appends --project when RUFLO_HELPERS_SIGNING_PROJECT is set', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 'ruflo-helpers-signing-key';
    process.env.RUFLO_HELPERS_SIGNING_PROJECT = 'ruv-dev';
    execFileSyncMock.mockReturnValue('PEM');

    loadPrivateKey();

    expect(execFileSyncMock.mock.calls[0][1]).toEqual(
      ['secrets', 'versions', 'access', 'latest', '--secret', 'ruflo-helpers-signing-key', '--project', 'ruv-dev'],
    );
  });

  it('captures both streams into JS (stdio pipe, never inherited)', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 's';
    execFileSyncMock.mockReturnValue('PEM');

    loadPrivateKey();

    expect(execFileSyncMock.mock.calls[0][2]).toMatchObject({
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  });

  it('exits 1 (does not throw the PEM) when gcloud fetch fails', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 's';
    execFileSyncMock.mockImplementation(() => { throw new Error('gcloud: command not found'); });

    expect(() => loadPrivateKey()).toThrow('__EXIT__1');
    // The error message must not echo any secret material.
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain("failed to read GCP secret");
    expect(logged).not.toMatch(/PRIVATE KEY/);
  });
});

describe('ADR-322 §2 — --stdin-key reads the PEM from fd 0', () => {
  it('reads stdin (fd 0) and does NOT invoke gcloud', () => {
    process.argv = ['node', 'sign-helpers.mjs', '--stdin-key'];
    readFileSyncMock.mockImplementation(((fd: unknown) =>
      fd === 0 ? 'STDIN_PEM' : 'WRONG_SOURCE') as never);

    const pem = loadPrivateKey();

    expect(pem).toBe('STDIN_PEM');
    expect(readFileSyncMock).toHaveBeenCalledWith(0, 'utf-8');
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });
});

describe('ADR-322 §3 — TTY refusal gate (GCP-secret branch only)', () => {
  it('refuses (exit 1) and does NOT call gcloud when secret set + TTY + no override', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 'ruflo-helpers-signing-key';
    process.stdout.isTTY = true;

    expect(() => loadPrivateKey()).toThrow('__EXIT__1');
    expect(execFileSyncMock).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().join(' ');
    expect(logged).toContain('refusing to fetch from GCP Secret Manager');
    expect(logged).toContain('--stdin-key'); // names the safe alternative
  });

  it('proceeds to fetch when RUFLO_HELPERS_ALLOW_TTY=1 overrides the gate', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 'ruflo-helpers-signing-key';
    process.env.RUFLO_HELPERS_ALLOW_TTY = '1';
    process.stdout.isTTY = true;
    execFileSyncMock.mockReturnValue('PEM_VIA_OVERRIDE');

    const pem = loadPrivateKey();

    expect(pem).toBe('PEM_VIA_OVERRIDE');
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('does NOT gate when stdout is not a TTY (e.g. CI/pipe)', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 'ruflo-helpers-signing-key';
    process.stdout.isTTY = false;
    execFileSyncMock.mockReturnValue('CI_PEM');

    expect(loadPrivateKey()).toBe('CI_PEM');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('ADR-322 — resolution order: GCP secret wins over --stdin-key', () => {
  it('consults gcloud, NOT stdin, when both the secret env var and --stdin-key are present', () => {
    process.env.RUFLO_HELPERS_SIGNING_SECRET = 'ruflo-helpers-signing-key';
    process.argv = ['node', 'sign-helpers.mjs', '--stdin-key'];
    execFileSyncMock.mockReturnValue('GCP_PEM');

    const pem = loadPrivateKey();

    expect(pem).toBe('GCP_PEM');
    expect(execFileSyncMock).toHaveBeenCalledTimes(1);
    // fd 0 (stdin) must never be read on the winning GCP path.
    expect(readFileSyncMock).not.toHaveBeenCalledWith(0, 'utf-8');
  });
});

describe('ADR-322 §4 — output-scan safety net trips on a leaked key', () => {
  const markers = [
    'BEGIN PRIVATE KEY',
    'BEGIN RSA PRIVATE KEY',
    'BEGIN EC PRIVATE KEY',
    'BEGIN OPENSSH PRIVATE KEY',
  ];

  for (const marker of markers) {
    it(`aborts (exit 1, FATAL) when captured output contains "${marker}"`, () => {
      const leaked = [
        '[sign-helpers] signed 4 helpers → …',
        `-----${marker}-----`,
        'MIIEvQIBADANBg…',
      ];

      expect(() => scanCapturedOutputForLeak(leaked)).toThrow('__EXIT__1');
      const logged = errorSpy.mock.calls.flat().join(' ');
      expect(logged).toContain('FATAL: private key material detected');
    });
  }

  it('does NOT trip on clean output (normal signing summary)', () => {
    const clean = [
      '[sign-helpers] signed 4 helpers → /pkg/.claude/helpers/helpers.manifest.json',
      '  hook-handler.cjs: a1b2c3d4e5f60718…',
      '  intelligence.cjs: 0f1e2d3c4b5a6978…',
    ];

    expect(() => scanCapturedOutputForLeak(clean)).not.toThrow();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('is load-bearing: proves the real scan block runs (not a re-implemented regex)', () => {
    // Simulate the ADR-322 §4 / Validation-4 regression: a debug console.log of
    // the PEM added inside the script. The exported scan is the SAME code the
    // top-level run calls, so this exercises the real trip-wire.
    const withDebugLog = ['console.log output', '-----BEGIN PRIVATE KEY-----\nMIIE…\n-----END PRIVATE KEY-----'];
    expect(() => scanCapturedOutputForLeak(withDebugLog)).toThrow('__EXIT__1');
  });
});
