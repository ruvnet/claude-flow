/**
 * @claude-flow/browser - Causal Recovery Tests (ADR-122 Phase 2)
 *
 * Acceptance criteria covered:
 *  - After N selector breaks on a domain, snapshot annotates the broken refs
 *    with non-zero `_causalRiskScore`
 *  - Cross-origin isolation: breaks on example.com don't pollute other.com
 *  - explain() returns prior break events + alternative locator suggestions
 *  - classifyBreak maps Playwright-style errors to our taxonomy
 *  - parseUrl normalises into (origin, path) for graph isolation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CausalRecoveryService } from '../src/application/causal-recovery-service.js';
import { InMemoryBreakStore, classifyBreak, parseUrl } from '../src/infrastructure/causal-recovery-store.js';
import type { Snapshot } from '../src/domain/types.js';

describe('CausalRecoveryService', () => {
  let service: CausalRecoveryService;
  let store: InMemoryBreakStore;

  beforeEach(() => {
    store = new InMemoryBreakStore();
    service = new CausalRecoveryService({ store });
  });

  describe('classifyBreak', () => {
    it('maps not-found errors', () => {
      expect(classifyBreak('Element not found: @e3')).toBe('element-not-found');
    });
    it('maps visibility errors', () => {
      expect(classifyBreak('Element is not visible')).toBe('element-not-visible');
    });
    it('maps timeout errors', () => {
      expect(classifyBreak('action timed out after 5000ms')).toBe('timeout');
    });
    it('maps detached errors', () => {
      expect(classifyBreak('stale element reference: element is detached')).toBe('element-detached');
    });
    it('maps navigation errors', () => {
      expect(classifyBreak('frame detached during navigation')).toBe('navigation-during-action');
    });
    it('defaults to unknown', () => {
      expect(classifyBreak('something weird happened')).toBe('unknown');
      expect(classifyBreak(undefined)).toBe('unknown');
    });
  });

  describe('parseUrl', () => {
    it('extracts origin + path', () => {
      const { origin, path } = parseUrl('https://example.com/login?next=/dash');
      expect(origin).toBe('https://example.com');
      expect(path).toBe('/login?next=/dash');
    });
    it('handles invalid URLs gracefully', () => {
      const { origin, path } = parseUrl('not-a-url');
      expect(origin).toBe('not-a-url');
      expect(path).toBe('/');
    });
  });

  describe('reportBreak', () => {
    it('records a break event with classified kind', async () => {
      const event = await service.reportBreak({
        url: 'https://example.com/login',
        selector: '@e3',
        action: 'click',
        actionResult: { success: false, error: 'Element not found: @e3' },
        sessionId: 's1',
      });
      expect(event.origin).toBe('https://example.com');
      expect(event.path).toBe('/login');
      expect(event.kind).toBe('element-not-found');
      expect(event.selector).toBe('@e3');
      expect(event.sessionId).toBe('s1');
    });

    it('preserves lastKnownRole/Name for future fuzzy matching', async () => {
      const event = await service.reportBreak({
        url: 'https://example.com/login',
        selector: '@e3',
        action: 'click',
        actionResult: { success: false, error: 'timeout' },
        lastKnownRole: 'button',
        lastKnownName: 'Submit',
      });
      expect(event.lastKnownRole).toBe('button');
      expect(event.lastKnownName).toBe('Submit');
    });
  });

  describe('risk scoring + snapshot annotation', () => {
    it('returns zero risk for never-seen selectors', async () => {
      const risk = await service.getRisk('https://example.com', '@e1');
      expect(risk.riskScore).toBe(0);
      expect(risk.breakCount).toBe(0);
    });

    it('accumulates risk with repeated breaks', async () => {
      for (let i = 0; i < 3; i++) {
        await service.reportBreak({
          url: 'https://example.com/login',
          selector: '@e3',
          action: 'click',
          actionResult: { success: false, error: 'not found' },
        });
      }
      const risk = await service.getRisk('https://example.com', '@e3');
      expect(risk.breakCount).toBe(3);
      expect(risk.riskScore).toBeGreaterThan(0);
      expect(risk.lastBreakKind).toBe('element-not-found');
    });

    it('annotates a snapshot with _causalRiskScore on broken refs', async () => {
      // Record one break on @e3
      await service.reportBreak({
        url: 'https://example.com/login',
        selector: '@e3',
        action: 'click',
        actionResult: { success: false, error: 'not found' },
      });

      const snapshot: Snapshot = {
        tree: { role: 'main', children: [{ role: 'button', ref: '@e3', name: 'Submit' }] },
        refs: { '@e1': { role: 'textbox' }, '@e2': { role: 'textbox' }, '@e3': { role: 'button' } },
        url: 'https://example.com/login',
        title: 'Login',
        timestamp: '2026-05-18T20:00:00Z',
      };
      const annotated = await service.annotateSnapshot(snapshot, 'https://example.com/login');
      expect(annotated._causal['@e3'].breakCount).toBe(1);
      expect(annotated._causal['@e3'].riskScore).toBeGreaterThan(0);
      // Un-broken refs should be zero
      expect(annotated._causal['@e1'].riskScore).toBe(0);
      expect(annotated._causal['@e2'].riskScore).toBe(0);
    });

    it('decorates the snapshot tree in-place with risk markers', async () => {
      await service.reportBreak({
        url: 'https://example.com/login',
        selector: '@e3',
        action: 'click',
        actionResult: { success: false, error: 'not found' },
      });
      const snapshot: Snapshot = {
        tree: { role: 'main', children: [{ role: 'button', ref: '@e3', name: 'Submit' }] },
        refs: { '@e3': { role: 'button' } },
        url: 'https://example.com/login',
        title: 'Login',
        timestamp: '2026-05-18T20:00:00Z',
      };
      const annotated = await service.decorateTree(snapshot, 'https://example.com/login');
      const btn = annotated.tree.children![0] as Record<string, unknown>;
      expect(btn._causalRiskScore).toBeGreaterThan(0);
      expect(btn._causalBreakCount).toBe(1);
    });
  });

  describe('cross-origin isolation', () => {
    it('breaks on example.com do not pollute other.com risk', async () => {
      // 5 breaks on example.com
      for (let i = 0; i < 5; i++) {
        await service.reportBreak({
          url: 'https://example.com/login',
          selector: '@e3',
          action: 'click',
          actionResult: { success: false, error: 'not found' },
        });
      }
      const other = await service.getRisk('https://other.com', '@e3');
      expect(other.breakCount).toBe(0);
      expect(other.riskScore).toBe(0);

      const same = await service.getRisk('https://example.com', '@e3');
      expect(same.breakCount).toBe(5);
    });
  });

  describe('explain()', () => {
    it('returns prior breaks + suggested locator strategies', async () => {
      // Record several breaks with role+name metadata
      for (let i = 0; i < 2; i++) {
        await service.reportBreak({
          url: 'https://example.com/login',
          selector: '@e3',
          action: 'click',
          actionResult: { success: false, error: 'not found' },
          lastKnownRole: 'button',
          lastKnownName: 'Submit',
        });
      }
      const explanation = await service.explain('https://example.com/login', '@e3', {
        lastKnownRole: 'button',
        lastKnownName: 'Submit',
      });
      expect(explanation.priorBreaks.length).toBeGreaterThanOrEqual(2);
      // Should suggest role-based locator first (highest stability)
      const roleSuggestion = explanation.suggestions.find(s => s.strategy === 'find-role');
      expect(roleSuggestion).toBeDefined();
      expect(roleSuggestion!.value).toContain('button');
      expect(roleSuggestion!.value).toContain('Submit');
      // testid is always suggested as the gold standard
      const testidSuggestion = explanation.suggestions.find(s => s.strategy === 'find-testid');
      expect(testidSuggestion).toBeDefined();
    });

    it('does not include unrelated origin breaks in explanation', async () => {
      await service.reportBreak({
        url: 'https://other.com/foo',
        selector: '@e3',
        action: 'click',
        actionResult: { success: false, error: 'not found' },
      });
      const explanation = await service.explain('https://example.com', '@e3');
      expect(explanation.priorBreaks).toHaveLength(0);
    });
  });

  describe('listBreaks', () => {
    it('returns all breaks for an origin', async () => {
      await service.reportBreak({
        url: 'https://example.com/a',
        selector: '@e1',
        action: 'click',
        actionResult: { success: false, error: 'not found' },
      });
      await service.reportBreak({
        url: 'https://example.com/b',
        selector: '@e2',
        action: 'fill',
        actionResult: { success: false, error: 'not found' },
      });
      const breaks = await service.listBreaks('https://example.com');
      expect(breaks).toHaveLength(2);
    });
  });
});
