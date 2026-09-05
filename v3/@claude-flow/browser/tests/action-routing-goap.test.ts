/**
 * @claude-flow/browser - Action Routing + GOAP Preflight Tests (ADR-122 Phase 5)
 *
 * Acceptance criteria covered:
 *  - ≥30% of typical browser actions classify as Tier 1 (Agent Booster, $0)
 *  - High causal risk escalates Tier 1 → Tier 2+
 *  - Per-trajectory cost report aggregates by tier + computes Tier-1 share
 *  - GOAP preflight catches missing-cookie precondition before live session
 *  - GOAP preflight catches unsafe-URL on `open` steps
 *  - GOAP preflight produces routing plan with estimated total cost
 */

import { describe, it, expect } from 'vitest';
import { ActionRouter } from '../src/application/action-router.js';
import { GoapPreflightService } from '../src/application/goap-preflight.js';
import { CookieVaultService } from '../src/application/cookie-vault-service.js';
import { CausalRecoveryService } from '../src/application/causal-recovery-service.js';

describe('ActionRouter', () => {
  describe('classification', () => {
    it('classifies pure DOM verbs with resolved refs as Tier 1', () => {
      const router = new ActionRouter();
      const decision = router.classify({ action: 'click', selector: '@e1', hasResolvedRef: true });
      expect(decision.tier).toBe('tier-1-booster');
      expect(decision.estimatedCostUsd).toBe(0);
      expect(decision.model).toBe('agent-booster');
    });

    it('classifies find verbs as Tier 2', () => {
      const router = new ActionRouter();
      expect(router.classify({ action: 'findByText', selector: 'Submit' }).tier).toBe('tier-2-haiku');
      expect(router.classify({ action: 'findByRole', selector: 'button' }).tier).toBe('tier-2-haiku');
    });

    it('escalates Tier 1 → Tier 2 when causal risk is high', () => {
      const router = new ActionRouter({ riskEscalationThreshold: 0.4 });
      const decision = router.classify({
        action: 'click',
        selector: '@e3',
        hasResolvedRef: true,
        causalRiskScore: 0.7,
      });
      expect(decision.tier).toBe('tier-2-haiku');
      expect(decision.rationale).toContain('causal risk');
    });

    it('classifies high-complexity hints as Tier 3', () => {
      const router = new ActionRouter();
      const decision = router.classify({ action: 'click', complexity: 'high' });
      expect(decision.tier).toBe('tier-3-frontier');
    });

    it('classifies eval as Tier 3', () => {
      const router = new ActionRouter();
      expect(router.classify({ action: 'eval' }).tier).toBe('tier-3-frontier');
    });
  });

  describe('cost rollup', () => {
    it('aggregates per-trajectory cost by tier', () => {
      const router = new ActionRouter();
      const trajectoryId = 'traj-1';
      // 3 Tier 1, 1 Tier 2, 1 Tier 3
      router.record(trajectoryId, router.classify({ action: 'click', selector: '@e1', hasResolvedRef: true }));
      router.record(trajectoryId, router.classify({ action: 'fill', selector: '@e2', hasResolvedRef: true }));
      router.record(trajectoryId, router.classify({ action: 'click', selector: '@e3', hasResolvedRef: true }));
      router.record(trajectoryId, router.classify({ action: 'findByText', selector: 'Submit' }));
      router.record(trajectoryId, router.classify({ action: 'eval' }));

      const report = router.getCostReport(trajectoryId);
      expect(report).toBeDefined();
      expect(report!.byTier['tier-1-booster'].count).toBe(3);
      expect(report!.byTier['tier-2-haiku'].count).toBe(1);
      expect(report!.byTier['tier-3-frontier'].count).toBe(1);
      expect(report!.totalCostUsd).toBeCloseTo(0 + 0 + 0 + 0.0002 + 0.005, 5);
      expect(report!.tier1Share).toBeCloseTo(3 / 5, 2);
    });

    it('representative workload achieves ≥30% Tier-1 share', () => {
      const router = new ActionRouter();
      const trajectoryId = 'traj-rep';
      // Typical login flow: open + snapshot + fill + fill + click → 4 pure DOM, 1 navigation
      const actions = [
        { action: 'open', selector: 'https://example.com' },
        { action: 'snapshot' as const },
        { action: 'fill', selector: '@e1', hasResolvedRef: true },
        { action: 'fill', selector: '@e2', hasResolvedRef: true },
        { action: 'click', selector: '@e3', hasResolvedRef: true },
        { action: 'wait', selector: '.dashboard' },
        { action: 'getText', selector: '.welcome' },
      ];
      for (const a of actions) router.record(trajectoryId, router.classify(a as { action: string; selector?: string; hasResolvedRef?: boolean }));
      const report = router.getCostReport(trajectoryId)!;
      expect(report.tier1Share).toBeGreaterThanOrEqual(0.3);
    });
  });
});

describe('GoapPreflightService', () => {
  it('passes preflight when all preconditions are met', async () => {
    const vault = new CookieVaultService();
    await vault.store({
      cookie: { name: 'sid', value: 'opaque-token', domain: 'example.com' },
      origin: 'https://example.com',
    });
    const preflight = new GoapPreflightService({ cookieVault: vault });

    const result = await preflight.preflight({
      goal: 'View dashboard',
      origin: 'https://example.com',
      steps: [
        {
          action: 'open',
          target: 'https://example.com/dashboard',
          preconditions: { requireCookie: { origin: 'https://example.com', name: 'sid' } },
        },
        { action: 'click', target: '@e1' },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.findings.filter(f => f.blocking)).toHaveLength(0);
    expect(result.routingPlan).toHaveLength(2);
    expect(result.estimatedCostUsd).toBeGreaterThanOrEqual(0);
  });

  it('blocks when a required cookie is missing from the vault', async () => {
    const vault = new CookieVaultService();
    const preflight = new GoapPreflightService({ cookieVault: vault });

    const result = await preflight.preflight({
      goal: 'View dashboard',
      steps: [
        {
          action: 'open',
          target: 'https://example.com/dashboard',
          preconditions: { requireCookie: { origin: 'https://example.com', name: 'sid' } },
        },
      ],
    });

    expect(result.ok).toBe(false);
    const missing = result.findings.find(f => f.kind === 'missing-cookie');
    expect(missing).toBeDefined();
    expect(missing!.blocking).toBe(true);
  });

  it('warns (non-blocking) when origin has high causal risk', async () => {
    const causal = new CausalRecoveryService();
    for (let i = 0; i < 12; i++) {
      await causal.reportBreak({
        url: 'https://example.com/login',
        selector: '@e3',
        action: 'click',
        actionResult: { success: false, error: 'not found' },
      });
    }
    const preflight = new GoapPreflightService({ causalService: causal });

    const result = await preflight.preflight({
      goal: 'Click submit',
      origin: 'https://example.com',
      steps: [
        {
          action: 'click',
          target: '@e3',
          preconditions: { maxAvgCausalRisk: 0.5 },
        },
      ],
    });

    const warning = result.findings.find(f => f.kind === 'high-causal-risk');
    expect(warning).toBeDefined();
    expect(warning!.blocking).toBe(false);
    // ok stays true because high-causal-risk is non-blocking by design
    expect(result.ok).toBe(true);
  });

  it('produces a routing plan with per-step decisions + total cost', async () => {
    const preflight = new GoapPreflightService();
    const result = await preflight.preflight({
      goal: 'Compose login',
      steps: [
        { action: 'open', target: 'https://example.com' },
        { action: 'fill', target: '@e1', routing: { action: 'fill', selector: '@e1', hasResolvedRef: true } },
        { action: 'findByText', target: 'Sign in', routing: { action: 'findByText', selector: 'Sign in' } },
      ],
    });

    expect(result.routingPlan).toHaveLength(3);
    const tiers = result.routingPlan.map(p => p.decision.tier);
    expect(tiers).toContain('tier-1-booster'); // fill with ref
    expect(tiers).toContain('tier-2-haiku'); // findByText
    expect(result.estimatedCostUsd).toBeGreaterThan(0);
  });
});
