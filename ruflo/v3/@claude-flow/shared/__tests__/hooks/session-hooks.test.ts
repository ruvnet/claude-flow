/**
 * V3 Session Hooks Tests
 *
 * Tests for session-end and session-restore hook functionality.
 *
 * @module v3/shared/hooks/__tests__/session-hooks.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createHookRegistry,
  createSessionHooksManager,
  SessionHooksManager,
  HookRegistry,
  HookEvent,
  InMemorySessionStorage,
} from '../../src/hooks/index.js';

describe('SessionHooksManager', () => {
  let registry: HookRegistry;
  let sessionManager: SessionHooksManager;
  let storage: InMemorySessionStorage;

  beforeEach(() => {
    registry = createHookRegistry();
    storage = new InMemorySessionStorage();
    sessionManager = createSessionHooksManager(registry, storage);
  });

  describe('session lifecycle hooks', () => {
    it('should register session hooks on creation', () => {
      const startHooks = registry.getHandlers(HookEvent.SessionStart);
      const endHooks = registry.getHandlers(HookEvent.SessionEnd);
      const resumeHooks = registry.getHandlers(HookEvent.SessionResume);

      expect(startHooks.some(h => h.name === 'session-hooks:start')).toBe(true);
      expect(endHooks.some(h => h.name === 'session-hooks:end')).toBe(true);
      expect(resumeHooks.some(h => h.name === 'session-hooks:resume')).toBe(true);
    });
  });

  describe('session-end hook', () => {
    it('should end session and return summary', async () => {
      // Simulate session start by triggering tracking
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'test-session', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);

      // Wait a moment to ensure duration > 0
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await sessionManager.executeSessionEnd();

      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.summary).toBeDefined();
      expect(result.summary!.tasksExecuted).toBe(0);
      expect(result.summary!.commandsExecuted).toBe(0);
    });

    it('should persist session state', async () => {
      // Start session
      const startContext = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'persist-session', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](startContext);

      const result = await sessionManager.executeSessionEnd();

      expect(result.persistedState).toBeDefined();
      expect(result.statePath).toBeDefined();

      // Verify state was saved
      const sessions = await storage.list();
      expect(sessions.length).toBeGreaterThan(0);
    });

    it('should handle ending session without active session', async () => {
      const result = await sessionManager.executeSessionEnd();
      expect(result.success).toBe(true);
    });

    it('should reset activity tracking after session end', async () => {
      // Start session
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'reset-session', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);

      await sessionManager.executeSessionEnd();

      expect(sessionManager.getCurrentSessionId()).toBeNull();
    });
  });

  describe('session-restore hook', () => {
    it('should restore a previous session', async () => {
      // Create and end a session first
      const startContext = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'restore-test', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](startContext);
      await sessionManager.executeSessionEnd();

      // Restore the session
      const result = await sessionManager.executeSessionRestore('restore-test');

      expect(result.success).toBe(true);
      expect(result.restoredState).toBeDefined();
      expect(result.restoredState!.sessionId).toBe('restore-test');
    });

    it('should restore latest session when no ID specified', async () => {
      // Create and end multiple sessions
      for (const id of ['session-1', 'session-2', 'session-3']) {
        const context = {
          event: HookEvent.SessionStart,
          timestamp: new Date(),
          session: { id, startTime: new Date() },
        };
        await sessionManager['handleSessionStart'](context);
        await sessionManager.executeSessionEnd();
        await new Promise(resolve => setTimeout(resolve, 5));
      }

      const result = await sessionManager.executeSessionRestore();

      expect(result.success).toBe(true);
      expect(result.restoredState).toBeDefined();
    });

    it('should fail gracefully when session not found', async () => {
      const result = await sessionManager.executeSessionRestore('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should return warnings for old sessions', async () => {
      // Create a session with an old timestamp
      const oldSession = {
        sessionId: 'old-session',
        startTime: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
        endTime: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      };
      await storage.save('old-session', oldSession);

      const result = await sessionManager.executeSessionRestore('old-session');

      expect(result.success).toBe(true);
      expect(result.warnings).toBeDefined();
      expect(result.warnings!.some(w => w.includes('days old'))).toBe(true);
    });

    it('should start a new session after restoration', async () => {
      // Create and end a session
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'new-after-restore', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);
      await sessionManager.executeSessionEnd();

      await sessionManager.executeSessionRestore('new-after-restore');

      expect(sessionManager.getCurrentSessionId()).toBeDefined();
      expect(sessionManager.getCurrentSessionId()).toContain('restored');
    });

    it('should count restored items', async () => {
      // Create a session with tasks and agents
      const sessionState = {
        sessionId: 'count-test',
        startTime: new Date(),
        endTime: new Date(),
        activeTasks: [
          { id: 'task-1', description: 'Task 1', status: 'completed' as const },
          { id: 'task-2', description: 'Task 2', status: 'in_progress' as const },
        ],
        spawnedAgents: [
          { id: 'agent-1', type: 'coder', status: 'active' as const },
        ],
        memoryEntries: [
          { key: 'key-1', namespace: 'default', type: 'string' },
        ],
      };
      await storage.save('count-test', sessionState);

      const result = await sessionManager.executeSessionRestore('count-test');

      expect(result.tasksRestored).toBe(2);
      expect(result.agentsRestored).toBe(1);
      expect(result.memoryRestored).toBe(1);
    });
  });

  describe('activity tracking', () => {
    it('should track task executions', async () => {
      // Start session
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'track-tasks', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);

      // Track a successful task
      await sessionManager['trackTaskExecution']({
        event: HookEvent.PostTaskExecute,
        timestamp: new Date(),
        metadata: { success: true },
      });

      // Track a failed task
      await sessionManager['trackTaskExecution']({
        event: HookEvent.PostTaskExecute,
        timestamp: new Date(),
        metadata: { success: false },
      });

      const activity = sessionManager.getCurrentActivity();
      expect(activity.tasksExecuted).toBe(2);
      expect(activity.tasksSucceeded).toBe(1);
      expect(activity.tasksFailed).toBe(1);
    });

    it('should track command executions', async () => {
      // Start session
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'track-commands', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);

      // Track commands
      await sessionManager['trackCommandExecution']({
        event: HookEvent.PostCommand,
        timestamp: new Date(),
      });
      await sessionManager['trackCommandExecution']({
        event: HookEvent.PostCommand,
        timestamp: new Date(),
      });

      const activity = sessionManager.getCurrentActivity();
      expect(activity.commandsExecuted).toBe(2);
    });

    it('should track file modifications', async () => {
      // Start session
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'track-files', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);

      // Track file modifications
      await sessionManager['trackFileModification']({
        event: HookEvent.PostEdit,
        timestamp: new Date(),
        file: { path: '/src/file1.ts', operation: 'edit' },
      });
      await sessionManager['trackFileModification']({
        event: HookEvent.PostEdit,
        timestamp: new Date(),
        file: { path: '/src/file2.ts', operation: 'edit' },
      });
      // Same file again
      await sessionManager['trackFileModification']({
        event: HookEvent.PostEdit,
        timestamp: new Date(),
        file: { path: '/src/file1.ts', operation: 'edit' },
      });

      const activity = sessionManager.getCurrentActivity();
      expect(activity.filesModified.size).toBe(2);
    });

    it('should track agent spawns', async () => {
      // Start session
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'track-agents', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);

      // Track agent spawns
      await sessionManager['trackAgentSpawn']({
        event: HookEvent.PostAgentSpawn,
        timestamp: new Date(),
        agent: { id: 'agent-1', type: 'coder' },
      });
      await sessionManager['trackAgentSpawn']({
        event: HookEvent.PostAgentSpawn,
        timestamp: new Date(),
        agent: { id: 'agent-2', type: 'tester' },
      });

      const activity = sessionManager.getCurrentActivity();
      expect(activity.agentsSpawned.size).toBe(2);
    });
  });

  describe('session management', () => {
    it('should list available sessions', async () => {
      // Create multiple sessions
      for (const id of ['list-1', 'list-2', 'list-3']) {
        const context = {
          event: HookEvent.SessionStart,
          timestamp: new Date(),
          session: { id, startTime: new Date() },
        };
        await sessionManager['handleSessionStart'](context);
        await sessionManager.executeSessionEnd();
      }

      const sessions = await sessionManager.listSessions();
      expect(sessions.length).toBe(3);
    });

    it('should delete a session', async () => {
      // Create a session
      const context = {
        event: HookEvent.SessionStart,
        timestamp: new Date(),
        session: { id: 'delete-me', startTime: new Date() },
      };
      await sessionManager['handleSessionStart'](context);
      await sessionManager.executeSessionEnd();

      const deleted = await sessionManager.deleteSession('delete-me');
      expect(deleted).toBe(true);

      const sessions = await sessionManager.listSessions();
      expect(sessions.find(s => s.id === 'delete-me')).toBeUndefined();
    });

    it('should return false when deleting non-existent session', async () => {
      const deleted = await sessionManager.deleteSession('non-existent');
      expect(deleted).toBe(false);
    });
  });
});
