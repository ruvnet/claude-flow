/**
 * ADR-306 scope <-> ADR-302 consent-domain mapping.
 *
 * The 5 ADR-306 scopes map 1:1 onto 5 `ConsentDomain` values that already
 * exist in src/funnel/types.ts (pre-provisioned for exactly this purpose —
 * see that file's own comments). No new consent machinery is needed; this
 * module is just the lookup table ADR-306 describes but never names in code.
 */

import type { ConsentDomain } from '../funnel/index.js';

export const SCOPE_TO_DOMAIN: Record<string, ConsentDomain> = {
  'account.create': 'account',
  'proxy.use': 'proxy-install',
  'cloud.route': 'cloud-routing',
  'telemetry.write': 'telemetry',
  'hosted.memory.use': 'hosted-memory',
};

export function domainForScope(scope: string): ConsentDomain | undefined {
  return SCOPE_TO_DOMAIN[scope];
}

/** `login` always requests this scope only, on first run — ADR-306. */
export const INITIAL_SCOPE = 'account.create';
