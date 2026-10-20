/**
 * @claude-flow/browser - ReasoningBank Adapter Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReasoningBankAdapter, getReasoningBank } from '../src/infrastructure/reasoningbank-adapter.js';
import type { BrowserTrajectory } from '../src/domain/types.js';

describe('ReasoningBankAdapter', () => {
  let adapter: ReasoningBankAdapter;

  beforeEach(() => {
    adapter = new ReasoningBankAdapter();
  });

  describe('getReasoningBank singleton', () => {
    it('should return singleton instance', () => {
      const instance1 = getReasoningBank();
      const instance2 = getReasoningBank();
      expect(instance1).toBe(instance2);
    });
  });

  describe('trajectory storage', () => {
    const mockTrajectory: BrowserTrajectory = {
      id: 'traj-1',
      goal: 'Login to dashboard',
      startUrl: 'https://example.com/login',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      steps: [
        {
          action: 'open',
          input: { url: 'https://example.com/login' },
          result: { success: true, duration: 100 },
          timestamp: new Date().toISOString(),
        },
        {
          action: 'fill',
          input: { target: '@e1', value: 'user@example.com' },
          result: { success: true, duration: 50 },
          timestamp: new Date().toISOString(),
        },
        {
          action: 'fill',
          input: { target: '@e2', value: 'password' },
          result: { success: true, duration: 50 },
          timestamp: new Date().toISOString(),
        },
        {
          action: 'click',
          input: { target: '@e3' },
          result: { success: true, duration: 200 },
          timestamp: new Date().toISOString(),
        },
      ],
      success: true,
      verdict: 'Login successful',
    };

    it('should store successful trajectory and extract pattern', async () => {
      await adapter.storeTrajectory(mockTrajectory);

      const stats = adapter.getStats();
      expect(stats.totalPatterns).toBeGreaterThan(0);
    });

    it('should not create pattern from single-step trajectory', async () => {
      const singleStepTrajectory: BrowserTrajectory = {
        ...mockTrajectory,
        id: 'traj-single',
        steps: [mockTrajectory.steps[0]],
      };

      await adapter.storeTrajectory(singleStepTrajectory);

      // Pattern extraction requires at least 2 steps
      const patterns = adapter.exportPatterns();
      const singlePattern = patterns.find(p => p.goal === singleStepTrajectory.goal && p.steps.length === 1);
      expect(singlePattern).toBeUndefined();
    });

    it('should update existing pattern on repeated success', async () => {
      await adapter.storeTrajectory(mockTrajectory);
      await adapter.storeTrajectory(mockTrajectory);

      const patterns = adapter.exportPatterns();
      const pattern = patterns.find(p => p.goal === mockTrajectory.goal);

      expect(pattern).toBeDefined();
      expect(pattern?.usageCount).toBeGreaterThan(1);
    });

    it('merges repeated success even when the calls land in different milliseconds', async () => {
      const now = vi.spyOn(Date, 'now');
      try {
        now.mockReturnValue(1_000_000);
        await adapter.storeTrajectory(mockTrajectory);
        now.mockReturnValue(1_000_007);
        await adapter.storeTrajectory(mockTrajectory);
      } finally {
        now.mockRestore();
      }

      const patterns = adapter.exportPatterns().filter(p => p.goal === mockTrajectory.goal);
      expect(patterns).toHaveLength(1);
      expect(patterns[0].usageCount).toBe(2);
    });
  });

  describe('pattern matching', () => {
    const mockTrajectory: BrowserTrajectory = {
      id: 'traj-2',
      goal: 'Fill contact form',
      startUrl: 'https://example.com/contact',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      steps: [
        { action: 'fill', input: { target: '@e1', value: 'Name' }, result: { success: true, duration: 50 }, timestamp: new Date().toISOString() },
        { action: 'fill', input: { target: '@e2', value: 'email' }, result: { success: true, duration: 50 }, timestamp: new Date().toISOString() },
        { action: 'click', input: { target: '@e3' }, result: { success: true, duration: 100 }, timestamp: new Date().toISOString() },
      ],
      success: true,
    };

    it('should find similar patterns by goal', async () => {
      await adapter.storeTrajectory(mockTrajectory);

      const patterns = await adapter.findSimilarPatterns('contact form');

      expect(Array.isArray(patterns)).toBe(true);
    });

    it('should return empty array for no matches', async () => {
      const patterns = await adapter.findSimilarPatterns('completely unrelated xyz');

      expect(patterns).toEqual([]);
    });

    it('should get recommended steps for similar goal', async () => {
      await adapter.storeTrajectory(mockTrajectory);

      const steps = await adapter.getRecommendedSteps('Fill a form');

      expect(Array.isArray(steps)).toBe(true);
    });
  });

  describe('verdict recording', () => {
    it('should record verdict for trajectory', async () => {
      const mockTrajectory: BrowserTrajectory = {
        id: 'traj-3',
        goal: 'Test pattern',
        startUrl: 'https://example.com',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        steps: [
          { action: 'click', input: { target: '@e1' }, result: { success: true, duration: 100 }, timestamp: new Date().toISOString() },
          { action: 'click', input: { target: '@e2' }, result: { success: true, duration: 100 }, timestamp: new Date().toISOString() },
        ],
        success: true,
      };

      await adapter.storeTrajectory(mockTrajectory);
      await adapter.recordVerdict('traj-3', true, 'Works great');

      // Just verify it doesn't throw
      expect(true).toBe(true);
    });
  });

  describe('stats', () => {
    it('should return stats with correct structure', () => {
      const stats = adapter.getStats();

      expect(stats).toHaveProperty('totalPatterns');
      expect(stats).toHaveProperty('avgSuccessRate');
      expect(stats).toHaveProperty('bufferedTrajectories');
      expect(typeof stats.totalPatterns).toBe('number');
      expect(typeof stats.avgSuccessRate).toBe('number');
      expect(typeof stats.bufferedTrajectories).toBe('number');
    });

    it('should return zero patterns initially', () => {
      const stats = adapter.getStats();

      expect(stats.totalPatterns).toBe(0);
      expect(stats.avgSuccessRate).toBe(0);
    });
  });

  describe('pattern export/import', () => {
    it('should export patterns as array', async () => {
      const mockTrajectory: BrowserTrajectory = {
        id: 'traj-4',
        goal: 'Export test',
        startUrl: 'https://example.com',
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        steps: [
          { action: 'open', input: { url: 'https://example.com' }, result: { success: true, duration: 100 }, timestamp: new Date().toISOString() },
          { action: 'click', input: { target: '@e1' }, result: { success: true, duration: 50 }, timestamp: new Date().toISOString() },
        ],
        success: true,
      };

      await adapter.storeTrajectory(mockTrajectory);

      const patterns = adapter.exportPatterns();

      expect(Array.isArray(patterns)).toBe(true);
      expect(patterns.length).toBeGreaterThan(0);
    });

    it('should import patterns', () => {
      const patternsToImport = [
        {
          id: 'imported-1',
          type: 'navigation' as const,
          goal: 'Imported pattern',
          steps: [{ action: 'open' }],
          successRate: 0.9,
          avgDuration: 100,
          lastUsed: new Date().toISOString(),
          usageCount: 5,
        },
      ];

      adapter.importPatterns(patternsToImport);

      const stats = adapter.getStats();
      expect(stats.totalPatterns).toBe(1);
    });
  });
});
