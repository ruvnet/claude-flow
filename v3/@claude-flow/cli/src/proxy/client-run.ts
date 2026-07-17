/**
 * Launch Claude-compatible clients through the locally managed Meta-Proxy.
 *
 * This mirrors the v0.4.0 MetaHarness integration. The policy is a signed,
 * short-lived capability: a proxy token is never passed directly to the
 * client, and no filesystem path or repository name is disclosed upstream.
 */

import { spawnSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import * as fs from 'node:fs';
import { proxyConfigPath, proxyTokenPath } from './paths.js';
import { getProxyStatus, startBackground, ProxyAlreadyRunningError, type ProxyStatus } from './lifecycle.js';

export type ProxyWorktreePolicy = 'critical' | 'standard' | 'economy';

const POLICIES: ReadonlySet<string> = new Set(['critical', 'standard', 'economy']);
const DEFAULT_BIND = '127.0.0.1:11435';

export interface ProxyClientEnvironment {
  ANTHROPIC_BASE_URL: string;
  ANTHROPIC_AUTH_TOKEN: string;
}

export interface ProxyRunResult {
  success: boolean;
  exitCode: number;
  message?: string;
  started: boolean;
  policy: ProxyWorktreePolicy;
}

/**
 * Resolve the local endpoint which receives the bearer token. This must be a
 * literal loopback address; a hostname or non-loopback bind could disclose
 * the local token through a user-controlled config file.
 */
export function proxyClientEndpoint(): string {
  let bind = DEFAULT_BIND;
  try {
    const raw = fs.readFileSync(proxyConfigPath(), 'utf8');
    const match = raw.match(/^bind\s*=\s*"([^"]+)"\s*$/m);
    if (match?.[1]) bind = match[1];
  } catch {
    // Meta-Proxy uses the documented default when the config is absent.
  }

  const match = bind.match(/^(127\.0\.0\.1|\[::1\]):([1-9]\d{0,4})$/);
  const port = match ? Number.parseInt(match[2]!, 10) : 0;
  if (!match || port > 65_535) {
    throw new Error(`Refusing to route a client through non-loopback Meta-Proxy bind "${bind}".`);
  }
  return `http://${bind}`;
}

/** Environment passed only to the launched client, never written to disk. */
export function proxyClientEnvironment(): ProxyClientEnvironment {
  let token = '';
  try {
    token = fs.readFileSync(proxyTokenPath(), 'utf8').trim();
  } catch {
    // The explicit error below gives the operator an actionable recovery.
  }
  if (!token) {
    throw new Error('Meta-Proxy token is unavailable. Start Meta-Proxy once to create its local token.');
  }
  return { ANTHROPIC_BASE_URL: proxyClientEndpoint(), ANTHROPIC_AUTH_TOKEN: token };
}

/** Stable correlation value; never expose a worktree path, prompt, or repo name. */
export function proxyWorktreeFingerprint(cwd = process.cwd()): string {
  return createHash('sha256').update(cwd).digest('hex').slice(0, 32);
}

/** Mint the Meta-Proxy v0.4.0+ policy capability using the local bearer secret. */
export function createProxyPolicyToken(
  proxyToken: string,
  policy: ProxyWorktreePolicy,
  worktree = proxyWorktreeFingerprint(),
  now = Date.now(),
): string {
  if (!POLICIES.has(policy)) throw new Error(`Unknown worktree policy "${policy}".`);
  const payload = Buffer.from(JSON.stringify({ policy, worktree, exp: Math.floor(now / 1_000) + 8 * 60 * 60 }))
    .toString('base64url');
  const signed = `mh1.${payload}`;
  return `${signed}.${createHmac('sha256', proxyToken).update(signed).digest('base64url')}`;
}

/** Keep policy-token construction separately testable from process launch. */
export function proxyClientEnvironmentForPolicy(
  policy: ProxyWorktreePolicy,
  cwd = process.cwd(),
  clientEnv = proxyClientEnvironment(),
): ProxyClientEnvironment {
  return {
    ...clientEnv,
    ANTHROPIC_AUTH_TOKEN: createProxyPolicyToken(clientEnv.ANTHROPIC_AUTH_TOKEN, policy, proxyWorktreeFingerprint(cwd)),
  };
}

async function waitForProxy(endpoint: string, token: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1_000);
      try {
        const response = await fetch(`${endpoint}/status`, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        if (response.ok) return true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // The detached supervisor can take a moment to bind its loopback port.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** The binary creates its local token on first launch, so wait for it once. */
async function waitForProxyClientEnvironment(timeoutMs = 5_000): Promise<ProxyClientEnvironment | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return proxyClientEnvironment();
    } catch {
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
  }
  return null;
}

async function ensureProxyRunning(): Promise<{ status: ProxyStatus; started: boolean }> {
  const status = getProxyStatus();
  if (status.running) return { status, started: false };
  try {
    await startBackground();
    return { status: getProxyStatus(), started: true };
  } catch (error) {
    // A second `proxy run` can win the start lock after our status check.
    if (error instanceof ProxyAlreadyRunningError) return { status: getProxyStatus(), started: false };
    throw error;
  }
}

/**
 * Start the managed proxy if necessary, authenticate its health endpoint,
 * and run a Claude-compatible client with scoped environment variables.
 */
export async function runProxyClient(
  args: string[],
  policy: ProxyWorktreePolicy,
  cwd = process.cwd(),
): Promise<ProxyRunResult> {
  if (!POLICIES.has(policy)) {
    return { success: false, exitCode: 2, message: '--policy must be one of: critical, standard, economy.', started: false, policy };
  }

  let started = false;
  try {
    ({ started } = await ensureProxyRunning());
    const localEnv = await waitForProxyClientEnvironment();
    if (!localEnv) {
      return {
        success: false,
        exitCode: 1,
        message: 'Meta-Proxy did not create its local token within 5 seconds. Run `ruflo proxy status` and inspect `ruflo proxy logs`.',
        started,
        policy,
      };
    }
    if (!await waitForProxy(localEnv.ANTHROPIC_BASE_URL, localEnv.ANTHROPIC_AUTH_TOKEN)) {
      return {
        success: false,
        exitCode: 1,
        message: 'Meta-Proxy did not become ready within 5 seconds. Run `ruflo proxy status` and inspect `ruflo proxy logs`.',
        started,
        policy,
      };
    }

    const commandArgs = args[0] === '--' ? args.slice(1) : args;
    const command = commandArgs[0] || 'claude';
    const result = spawnSync(command, commandArgs.slice(1), {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...proxyClientEnvironmentForPolicy(policy, cwd, localEnv) },
      windowsHide: true,
    });
    if (result.error) {
      return { success: false, exitCode: 1, message: `Could not start ${command}: ${result.error.message}`, started, policy };
    }
    return { success: result.status === 0, exitCode: result.status ?? 1, started, policy };
  } catch (error) {
    return {
      success: false,
      exitCode: 1,
      message: error instanceof Error ? error.message : String(error),
      started,
      policy,
    };
  }
}
