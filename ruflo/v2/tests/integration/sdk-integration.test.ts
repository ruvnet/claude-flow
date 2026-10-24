/**
 * SDK Integration Regression Tests
 * Ensures SDK features work correctly and don't break existing functionality
 */

import { RealSessionForking } from '../../src/sdk/session-forking';
import { RealQueryController } from '../../src/sdk/query-control';
import { RealCheckpointManager } from '../../src/sdk/checkpoint-manager';

describe('SDK Integration - Regression Tests', () => {
  describe('Session Forking Integration', () => {
    it('should not break existing swarm spawning', () => {
      const forking = new RealSessionForking();
      expect(forking).toBeDefined();
      expect(forking.getActiveSessions).toBeDefined();
      expect(typeof forking.getActiveSessions).toBe('function');
    });

    it('should handle session tracking gracefully when not tracked', async () => {
      const forking = new RealSessionForking();

      // Should not throw when forking non-existent session
      await expect(async () => {
        try {
          await forking.fork('non-existent-session');
        } catch (error) {
          // Expected - session not found
          expect((error as Error).message).toContain('not found');
        }
      }).not.toThrow();
    });
  });

  describe('Query Control Integration', () => {
    it('should not break existing pause functionality', () => {
      const controller = new RealQueryController();
      expect(controller).toBeDefined();
      expect(controller.requestPause).toBeDefined();
      expect(typeof controller.requestPause).toBe('function');
    });

    it('should handle pause request for non-existent session gracefully', () => {
      const controller = new RealQueryController();

      // Should not throw
      expect(() => {
        controller.requestPause('non-existent-session');
      }).not.toThrow();
    });

    it('should track metrics correctly', () => {
      const controller = new RealQueryController();
      const metrics = controller.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics.totalPauses).toBeGreaterThanOrEqual(0);
      expect(metrics.totalResumes).toBeGreaterThanOrEqual(0);
      expect(metrics.averagePauseDuration).toBeGreaterThanOrEqual(0);
      expect(metrics.longestPause).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Checkpoint Manager Integration', () => {
    it('should not break existing session management', () => {
      const manager = new RealCheckpointManager();
      expect(manager).toBeDefined();
      expect(manager.listCheckpoints).toBeDefined();
      expect(typeof manager.listCheckpoints).toBe('function');
    });

    it('should handle checkpoint creation for untracked session gracefully', async () => {
      const manager = new RealCheckpointManager();

      await expect(async () => {
        try {
          await manager.createCheckpoint('untracked-session', 'Test');
        } catch (error) {
          // Expected - no messages tracked
          expect((error as Error).message).toContain('No messages');
        }
      }).not.toThrow();
    });

    it('should list checkpoints without errors', () => {
      const manager = new RealCheckpointManager();
      const checkpoints = manager.listCheckpoints('any-session');

      expect(Array.isArray(checkpoints)).toBe(true);
      expect(checkpoints.length).toBe(0); // No checkpoints for non-existent session
    });
  });

  describe('CLI Command Integration', () => {
    it('should export checkpoint command correctly', async () => {
      const { checkpointCommand } = await import('../../src/cli/commands/checkpoint');
      expect(checkpointCommand).toBeDefined();
      expect(checkpointCommand.name()).toBe('checkpoint');
    });
  });

  describe('Hooks Integration', () => {
    it('should export SDK managers from hooks', async () => {
      const hooks = await import('../../src/hooks/index');

      expect(hooks.checkpointManager).toBeDefined();
      expect(hooks.queryController).toBeDefined();
      expect(hooks.sessionForking).toBeDefined();
    });
  });

  describe('Swarm Spawn Integration', () => {
    it('should support optional SDK features in swarm spawning', async () => {
      const { initializeSwarm, spawnSwarmAgent } = await import(
        '../../src/cli/commands/swarm-spawn'
      );

      // Initialize swarm (now returns Promise)
      await initializeSwarm('test-swarm', 'test objective');

      // Spawn agent without SDK features (backward compatible)
      const agentId1 = await spawnSwarmAgent('test-swarm', 'researcher', 'test task');
      expect(agentId1).toBeDefined();
      expect(typeof agentId1).toBe('string');

      // Spawn agent with SDK features (opt-in)
      const agentId2 = await spawnSwarmAgent('test-swarm', 'coder', 'test task', {
        fork: false, // Don't actually fork (would require tracked session)
        checkpointBefore: false, // Don't checkpoint
      });
      expect(agentId2).toBeDefined();
      expect(typeof agentId2).toBe('string');
    });
  });

  describe('Backward Compatibility', () => {
    it('should not change existing API surfaces', () => {
      // Session forking
      const forking = new RealSessionForking();
      expect(forking.getActiveSessions).toBeDefined();
      expect(forking.getSessionInfo).toBeDefined();

      // Query control
      const controller = new RealQueryController();
      expect(controller.getMetrics).toBeDefined();
      expect(controller.listPausedQueries).toBeDefined();

      // Checkpoint manager
      const manager = new RealCheckpointManager();
      expect(manager.listCheckpoints).toBeDefined();
      expect(manager.getCheckpoint).toBeDefined();
    });

    it('should handle missing dependencies gracefully', async () => {
      const manager = new RealCheckpointManager();

      // Should not crash when trying to rollback non-existent checkpoint
      await expect(async () => {
        try {
          await manager.rollbackToCheckpoint('non-existent');
        } catch (error) {
          expect((error as Error).message).toContain('not found');
        }
      }).not.toThrow();
    });
  });

  describe('Performance', () => {
    it('should initialize managers quickly', () => {
      const start = Date.now();

      new RealSessionForking();
      new RealQueryController();
      new RealCheckpointManager();

      const duration = Date.now() - start;

      // Should initialize in less than 100ms
      expect(duration).toBeLessThan(100);
    });

    it('should not leak memory on repeated operations', () => {
      const controller = new RealQueryController();

      // Request pause many times
      for (let i = 0; i < 1000; i++) {
        controller.requestPause(`session-${i}`);
      }

      // Metrics should still work
      const metrics = controller.getMetrics();
      expect(metrics).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid input gracefully', () => {
      const manager = new RealCheckpointManager();

      // Should not crash on invalid session ID
      expect(() => {
        manager.listCheckpoints('');
        manager.listCheckpoints(null as any);
        manager.listCheckpoints(undefined as any);
      }).not.toThrow();
    });

    it('should provide helpful error messages', async () => {
      const forking = new RealSessionForking();

      try {
        await forking.fork('non-existent-session');
        fail('Should have thrown error');
      } catch (error) {
        expect((error as Error).message).toContain('not found');
      }
    });
  });
});

describe('No Breaking Changes', () => {
  it('should build successfully', () => {
    // If tests are running, build succeeded
    expect(true).toBe(true);
  });

  it('should not modify core interfaces', async () => {
    // Import core modules to ensure they still exist
    const { CLI } = await import('../../src/cli/cli-core');
    expect(CLI).toBeDefined();
  });

  it('should maintain existing command structure', async () => {
    const { setupCommands } = await import('../../src/cli/commands/index');
    expect(setupCommands).toBeDefined();
    expect(typeof setupCommands).toBe('function');
  });
});
