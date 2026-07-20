/**
 * Control precedence resolver — ADR-305 (normative).
 *
 *   1. RUFLO_FUNNEL=0            (environment)
 *   2. Enterprise managed policy
 *   3. User config (funnel.enabled — user-level and project-level)
 *   4. Package default
 *   5. Remote signed policy      (only when the freshness feed is enabled)
 *
 * A lower-precedence source must never re-enable a higher-precedence
 * disable — implemented as a strict AND chain: every source can veto,
 * none can override a veto above it.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { FunnelEnabledDecision } from './types.js';
import { readStateJson } from './state.js';
import { getDisclosure } from './disclosure.js';

interface FunnelUserConfig {
  enabled?: boolean;
}

function envDisabled(env: NodeJS.ProcessEnv): boolean {
  const v = env.RUFLO_FUNNEL;
  return v !== undefined && /^(0|false|off|no)$/i.test(v.trim());
}

function enterprisePolicyDisabled(env: NodeJS.ProcessEnv): boolean {
  const candidates: string[] = [];
  if (env.RUFLO_ENTERPRISE_POLICY) candidates.push(env.RUFLO_ENTERPRISE_POLICY);
  if (process.platform === 'win32') {
    if (env.ProgramData) candidates.push(path.join(env.ProgramData, 'ruflo', 'policy.json'));
  } else {
    candidates.push('/etc/ruflo/policy.json');
  }
  for (const p of candidates) {
    try {
      const policy = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (policy?.funnel?.enabled === false) return true;
    } catch {
      // unreadable/absent policy is not a policy
    }
  }
  return false;
}

function userConfigDisabled(): boolean {
  const cfg = readStateJson<FunnelUserConfig>('funnel.json');
  return cfg?.enabled === false;
}

function projectConfigDisabled(cwd: string): boolean {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(cwd, 'claude-flow.config.json'), 'utf-8'));
    return cfg?.funnel?.enabled === false;
  } catch {
    return false;
  }
}

/**
 * Remote signed policy (ADR-305 freshness kill switch). The feed is opt-in
 * and OFF by default; when a validated policy has been stored locally it can
 * only disable — sitting at the bottom of the chain guarantees it can never
 * re-enable anything a higher source turned off.
 */
function remotePolicyDisabled(): boolean {
  const policy = readStateJson<{ funnelEnabled?: boolean }>('funnel-remote-policy.json');
  return policy?.funnelEnabled === false;
}

export function resolveFunnelEnabled(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): FunnelEnabledDecision {
  if (envDisabled(env)) return { enabled: false, decidedBy: 'env' };
  if (enterprisePolicyDisabled(env)) return { enabled: false, decidedBy: 'enterprise-policy' };
  if (userConfigDisabled()) return { enabled: false, decidedBy: 'user-config' };
  if (projectConfigDisabled(cwd)) return { enabled: false, decidedBy: 'project-config' };
  // Declining the disclosure disables all funnel surfaces (ADR-301 invariant).
  if (getDisclosure().state === 'disclosed_disabled') {
    return { enabled: false, decidedBy: 'disclosure-declined' };
  }
  if (remotePolicyDisabled()) return { enabled: false, decidedBy: 'remote-policy' };
  return { enabled: true, decidedBy: 'package-default' };
}
