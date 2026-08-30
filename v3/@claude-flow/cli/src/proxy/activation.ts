/** Transactional activation of the daemon that actually owns the proxy port. */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { installProxy, type InstallResult } from './install.js';
import {
  isLoopbackBind,
  proxyBinaryPath,
  proxyConfigPath,
  proxyInstallLockPath,
  proxyInstallManifestPath,
  proxyLogFilePath,
  proxyPidFilePath,
} from './paths.js';

export interface EffectiveProxy { version: string; pid: number; executable: string; }
type Wait = (milliseconds: number) => Promise<void>;
const waitNormally: Wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function effectiveEndpoint(): string {
  let bind = '127.0.0.1:11435';
  try {
    const match = fs.readFileSync(proxyConfigPath(), 'utf8').match(/^bind\s*=\s*"([^"]+)"\s*$/m);
    if (match?.[1]) bind = match[1];
  } catch { /* documented default */ }
  if (!isLoopbackBind(bind)) throw new Error(`Refusing to probe non-loopback Meta-Proxy bind "${bind}".`);
  return `http://${bind}`;
}

function executableFor(pid: number, platform: NodeJS.Platform): string | null {
  try {
    if (platform === 'linux') {
      const result = spawnSync('readlink', ['-f', `/proc/${pid}/exe`], { encoding: 'utf8', timeout: 2_000 });
      return result.status === 0 ? result.stdout.trim() || null : null;
    }
    if (platform === 'win32') {
      const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'; if ($null -ne $p) { [Console]::Out.Write($p.ExecutablePath) }`;
      const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', timeout: 2_000, windowsHide: true });
      return result.status === 0 ? result.stdout.trim() || null : null;
    }
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8', timeout: 2_000 });
    return result.status === 0 ? result.stdout.trim() || null : null;
  } catch { return null; }
}

function isSupportedOwner(executable: string, platform: NodeJS.Platform): boolean {
  const name = platform === 'win32' ? 'meta-proxy.exe' : 'meta-proxy';
  const normalize = (value: string) => platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  const allowed = [
    proxyBinaryPath(),
    path.join(homedir(), '.metaharness', 'meta-proxy', 'bin', name),
    path.join(homedir(), '.metaharness', 'bin', name),
    path.join(homedir(), '.cargo', 'bin', name),
  ].map(normalize);
  return allowed.includes(normalize(executable));
}

export async function probeEffectiveProxy(
  fetcher: typeof fetch = globalThis.fetch,
  platform: NodeJS.Platform = process.platform,
): Promise<EffectiveProxy | null> {
  const endpoint = effectiveEndpoint();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    let response: Response;
    try { response = await fetcher(`${endpoint}/version`, { signal: controller.signal }); }
    finally { clearTimeout(timer); }
    if (!response.ok) return null;
    const body = await response.json() as { version?: unknown; pid?: unknown };
    if (typeof body.version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(body.version)) return null;
    if (!Number.isSafeInteger(body.pid) || Number(body.pid) <= 0) return null;
    const executable = executableFor(Number(body.pid), platform);
    return executable ? { version: body.version, pid: Number(body.pid), executable } : null;
  } catch { return null; }
}

export async function acquireProxyInstallLease(wait: Wait = waitNormally): Promise<() => void> {
  const lock = proxyInstallLockPath();
  fs.mkdirSync(path.dirname(lock), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      fs.writeFileSync(path.join(lock, 'owner'), `${process.pid}\n`, { mode: 0o600 });
      return () => fs.rmSync(lock, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        const owner = Number.parseInt(fs.readFileSync(path.join(lock, 'owner'), 'utf8').trim(), 10);
        if (age > 120_000 && (!Number.isSafeInteger(owner) || owner <= 0 || !processExists(owner))) {
          fs.rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch { /* another installer may still be writing its owner */ }
      await wait(50);
    }
  }
  throw new Error('Another Ruflo/MetaHarness installer still owns the Meta-Proxy install lease.');
}

async function stopEffective(wait: Wait): Promise<EffectiveProxy | null> {
  const owner = await probeEffectiveProxy();
  if (!owner) return null;
  if (!isSupportedOwner(owner.executable, process.platform)) {
    throw new Error(`Meta-Proxy port owner pid ${owner.pid} is not a recognized Ruflo/MetaHarness binary; refusing to signal it.`);
  }
  process.kill(owner.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 40; attempt++) {
    await wait(50);
    const current = await probeEffectiveProxy();
    if (!current || current.pid !== owner.pid) return owner;
  }
  throw new Error(`Stale Meta-Proxy pid ${owner.pid} did not stop.`);
}

function launch(binary: string): number {
  fs.mkdirSync(path.dirname(proxyLogFilePath()), { recursive: true, mode: 0o700 });
  const log = fs.openSync(proxyLogFilePath(), 'a', 0o600);
  try {
    const child = spawn(binary, [], { detached: true, stdio: ['ignore', log, log], windowsHide: true });
    if (!child.pid) throw new Error('Meta-Proxy did not return a process id.');
    child.unref();
    fs.writeFileSync(proxyPidFilePath(), `${child.pid}\n`, { mode: 0o600 });
    return child.pid;
  } finally { fs.closeSync(log); }
}

async function launchAndVerify(binary: string, version: string, wait: Wait): Promise<EffectiveProxy> {
  const pid = launch(binary);
  for (let attempt = 0; attempt < 100; attempt++) {
    await wait(50);
    const current = await probeEffectiveProxy();
    if (current?.pid === pid && current.version === version && path.resolve(current.executable) === path.resolve(binary)) return current;
    if (current && current.pid !== pid) {
      try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
      throw new Error(`Competing Meta-Proxy pid ${current.pid} won the port with version ${current.version}.`);
    }
  }
  try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ }
  throw new Error(`Meta-Proxy v${version} did not become the effective daemon.`);
}

export async function installAndActivateProxy(version: string, log?: (line: string) => void): Promise<InstallResult & { pid: number }> {
  const wait = waitNormally;
  const binary = proxyBinaryPath();
  const manifest = proxyInstallManifestPath();
  const binaryBackup = `${binary}.rollback`;
  const manifestBackup = `${manifest}.rollback`;
  let release: (() => void) | null = null;
  let prior: EffectiveProxy | null = null;
  try {
    release = await acquireProxyInstallLease(wait);
    prior = await stopEffective(wait);
    fs.rmSync(binaryBackup, { force: true });
    fs.rmSync(manifestBackup, { force: true });
    if (fs.existsSync(binary)) fs.copyFileSync(binary, binaryBackup);
    if (fs.existsSync(manifest)) fs.copyFileSync(manifest, manifestBackup);
    const installed = await installProxy({ version, log });
    const effective = await launchAndVerify(installed.binaryPath, installed.version, wait);
    return { ...installed, pid: effective.pid };
  } catch (error) {
    const failure = error instanceof Error ? error.message : String(error);
    if (fs.existsSync(binaryBackup)) {
      try {
        await stopEffective(wait);
        fs.rmSync(binary, { force: true });
        fs.renameSync(binaryBackup, binary);
        fs.rmSync(manifest, { force: true });
        if (fs.existsSync(manifestBackup)) fs.renameSync(manifestBackup, manifest);
        if (prior) await launchAndVerify(prior.executable === binary ? binary : prior.executable, prior.version, wait);
      } catch (rollbackError) {
        throw new Error(`${failure} Rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      }
      throw new Error(`${failure} Previous Meta-Proxy ${prior ? 'was restored and verified' : 'binary was restored; it was not running before the upgrade'}.`);
    }
    throw error;
  } finally {
    fs.rmSync(binaryBackup, { force: true });
    fs.rmSync(manifestBackup, { force: true });
    release?.();
  }
}
