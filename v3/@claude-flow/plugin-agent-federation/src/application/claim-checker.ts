import type { FederationClaimType, PolicyEngineDeps } from './policy-engine.js';

export type FederationAuthorizationMode = 'legacy' | 'observe' | 'enforce';

const FEDERATION_CLAIMS = new Set<FederationClaimType>([
  'federation:discover',
  'federation:connect',
  'federation:read',
  'federation:write',
  'federation:admin',
  'federation:memory',
  'federation:spawn',
]);

export interface FederationClaimCheckerConfig {
  mode?: FederationAuthorizationMode;
  grantedClaims?: readonly string[];
  onObservation?: (claim: FederationClaimType, granted: boolean) => void;
}

export interface FederationClaimChecker {
  mode: FederationAuthorizationMode;
  grantedClaims: ReadonlySet<FederationClaimType>;
  checkClaim: PolicyEngineDeps['checkClaim'];
}

/**
 * Compatibility bridge for the legacy federation policy engine.
 *
 * This removes the anonymous `() => true` production stub and makes
 * compatibility behavior explicit:
 * - legacy: preserve pre-ADR-325 behavior;
 * - observe: calculate and report missing grants without blocking;
 * - enforce: default deny unless the exact claim is configured.
 *
 * ADR-324 policy adapters can supply the `grantedClaims` set after evaluating
 * the request; ownership-changing federation messages remain disabled in the
 * default message policy until the full ingress PEP is composed.
 */
export function createFederationClaimChecker(
  config: FederationClaimCheckerConfig = {},
): FederationClaimChecker {
  const mode = config.mode ?? 'legacy';
  if (mode !== 'legacy' && mode !== 'observe' && mode !== 'enforce') {
    throw new TypeError(`Unsupported federation authorization mode: ${String(mode)}`);
  }

  const grantedClaims = new Set<FederationClaimType>();
  for (const claim of config.grantedClaims ?? []) {
    if (!FEDERATION_CLAIMS.has(claim as FederationClaimType)) {
      throw new TypeError(`Unknown federation claim: ${claim}`);
    }
    grantedClaims.add(claim as FederationClaimType);
  }

  return {
    mode,
    grantedClaims,
    checkClaim: (claim) => {
      const granted = grantedClaims.has(claim);
      if (mode === 'observe') config.onObservation?.(claim, granted);
      return mode !== 'enforce' || granted;
    },
  };
}
