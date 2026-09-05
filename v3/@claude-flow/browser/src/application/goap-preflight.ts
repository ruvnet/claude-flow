/**
 * @claude-flow/browser - GOAP Preflight (ADR-122 Phase 5)
 *
 * Dry-run a planned trajectory BEFORE launching a real browser session.
 * Checks preconditions against ambient ruflo state:
 *   - Required cookie attestation present in the vault?
 *   - Origin known to have high-risk selectors from causal recovery?
 *   - URL passes AIDefence threat scan?
 *
 * Returns a structured GoapPreflightResult that callers can gate the actual
 * session on. The whole point is to catch "this is going to fail" before
 * spending Tier 3 model time.
 */

import { CausalRecoveryService } from './causal-recovery-service.js';
import { CookieVaultService } from './cookie-vault-service.js';
import { ActionRouter } from './action-router.js';
import { getSecurityScanner, type BrowserSecurityScanner } from '../infrastructure/security-integration.js';
import type { ActionRoutingInput, RoutingDecision } from '../domain/action-routing.js';

export interface PlannedStep {
  /** Action verb. */
  action: string;
  /** Target URL (for `open`) or selector. */
  target?: string;
  /** Optional precondition descriptors. */
  preconditions?: {
    /** Origin requires an attested cookie handle present in the vault. */
    requireCookie?: { origin: string; name: string };
    /** This step should not run on an origin with average causal risk above X. */
    maxAvgCausalRisk?: number;
  };
  /** Cost-routing input used to estimate per-step cost. */
  routing?: ActionRoutingInput;
}

export interface GoapPreflightInput {
  goal: string;
  steps: PlannedStep[];
  /** Origin of the trajectory — used for causal-risk lookups. */
  origin?: string;
}

export interface GoapPreflightFinding {
  stepIndex: number;
  kind: 'missing-cookie' | 'high-causal-risk' | 'unsafe-url' | 'unknown-precondition';
  detail: string;
  /** True = preflight blocks the session, false = warning only. */
  blocking: boolean;
}

export interface GoapPreflightResult {
  goal: string;
  ok: boolean;
  findings: GoapPreflightFinding[];
  /** Per-step routing decisions + total estimated cost. */
  routingPlan: Array<{ step: number; decision: RoutingDecision }>;
  estimatedCostUsd: number;
}

export interface GoapPreflightServiceOptions {
  causalService?: CausalRecoveryService;
  cookieVault?: CookieVaultService;
  router?: ActionRouter;
  scanner?: BrowserSecurityScanner;
}

export class GoapPreflightService {
  private readonly causalService?: CausalRecoveryService;
  private readonly cookieVault?: CookieVaultService;
  private readonly router: ActionRouter;
  private readonly scanner: BrowserSecurityScanner;

  constructor(options: GoapPreflightServiceOptions = {}) {
    this.causalService = options.causalService;
    this.cookieVault = options.cookieVault;
    this.router = options.router ?? new ActionRouter();
    this.scanner = options.scanner ?? getSecurityScanner();
  }

  async preflight(input: GoapPreflightInput): Promise<GoapPreflightResult> {
    const findings: GoapPreflightFinding[] = [];
    const routingPlan: GoapPreflightResult['routingPlan'] = [];
    let estimatedCostUsd = 0;

    for (let i = 0; i < input.steps.length; i++) {
      const step = input.steps[i];

      // Cost routing
      const routing = step.routing
        ? this.router.classify(step.routing)
        : this.router.classify({ action: step.action, selector: step.target });
      routingPlan.push({ step: i, decision: routing });
      estimatedCostUsd += routing.estimatedCostUsd;

      // Preconditions
      if (step.preconditions?.requireCookie && this.cookieVault) {
        const target = step.preconditions.requireCookie;
        const entries = this.cookieVault.listEntries();
        const match = entries.find(e =>
          e.payload.cookie.name === target.name &&
          (e.payload.origin === target.origin || e.payload.cookie.domain?.includes(target.origin.replace(/^https?:\/\//, '')))
        );
        if (!match) {
          findings.push({
            stepIndex: i,
            kind: 'missing-cookie',
            detail: `step ${i} requires cookie "${target.name}" attested for ${target.origin} but no vault entry matches`,
            blocking: true,
          });
        }
      }

      if (step.preconditions?.maxAvgCausalRisk !== undefined && this.causalService && input.origin) {
        const breaks = await this.causalService.listBreaks(input.origin);
        const avgRisk = breaks.length === 0 ? 0 : Math.min(1, breaks.length / 10);
        if (avgRisk > step.preconditions.maxAvgCausalRisk) {
          findings.push({
            stepIndex: i,
            kind: 'high-causal-risk',
            detail: `origin ${input.origin} has ${breaks.length} known selector breaks (avg risk ${avgRisk.toFixed(2)} > threshold ${step.preconditions.maxAvgCausalRisk})`,
            blocking: false, // warning — caller may still want to proceed with self-healing
          });
        }
      }

      // For the FIRST `open` step, also scan the URL
      if (step.action === 'open' && step.target && /^https?:\/\//.test(step.target)) {
        const scan = await this.scanner.scanUrl(step.target);
        if (!scan.safe) {
          findings.push({
            stepIndex: i,
            kind: 'unsafe-url',
            detail: `URL fails AIDefence scan: ${scan.threats.map(t => t.type).join(', ')}`,
            blocking: true,
          });
        }
      }
    }

    const ok = findings.every(f => !f.blocking);
    return { goal: input.goal, ok, findings, routingPlan, estimatedCostUsd };
  }
}
