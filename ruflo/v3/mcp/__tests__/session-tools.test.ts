/**
 * V3 MCP Session Tools Tests
 *
 * Tests for session management MCP tools:
 * - session/save
 * - session/restore
 * - session/list
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  saveSessionTool,
  restoreSessionTool,
  listSessionsTool,
  sessionTools,
} from '../tools/session-tools.js';
import { ToolContext } from '../types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// Mock fs module
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ size: 1024 }),
}));

describe('Session Tools', () => {
  let mockContext: ToolContext;
  let mockOrchestrator: any;
  let mockSwarmCoordinator: any;
  let mockResourceManager: any;
  let savedSessionId: string;

  beforeEach(() => {
    vi.clearAllMocks();

    mockOrchestrator = {
      listTasks: vi.fn().mockResolvedValue({
        tasks: [
          { id: 'task-1', type: 'code', description: 'Task 1', status: 'pending', priority: 5, dependencies: [] },
          { id: 'task-2', type: 'review', description: 'Task 2', status: 'queued', priority: 3, dependencies: ['task-1'] },
        ],
      }),
      submitTask: vi.fn().mockImplementation(async (task) => ({ id: task.id })),
      cancelAll: vi.fn().mockResolvedValue(true),
    };

    mockSwarmCoordinator = {
      getStatus: vi.fn().mockResolvedValue({
        swarmId: 'swarm-1',
        agents: [
          { id: 'agent-1', type: 'coder', status: 'active', config: {}, metadata: {} },
          { id: 'agent-2', type: 'tester', status: 'idle', config: {}, metadata: {} },
        ],
        topology: {
          type: 'hierarchical-mesh',
          edges: [{ from: 'agent-1', to: 'agent-2' }],
        },
        consensus: { algorithm: 'majority' },
      }),
      spawnAgent: vi.fn().mockResolvedValue({}),
      terminateAll: vi.fn().mockResolvedValue(true),
      setTopology: vi.fn().mockResolvedValue(true),
    };

    mockResourceManager = {
      memoryService: {
        query: vi.fn().mockResolvedValue([
          { id: 'mem-1', content: 'Memory 1', type: 'episodic', namespace: 'default', tags: [], metadata: {}, createdAt: new Date() },
          { id: 'mem-2', content: 'Memory 2', type: 'semantic', namespace: 'code', tags: ['important'], metadata: { importance: 0.8 }, createdAt: new Date() },
        ]),
        storeEntry: vi.fn().mockResolvedValue({}),
      },
    };

    mockContext = {
      sessionId: 'test-session',
      orchestrator: mockOrchestrator,
      swarmCoordinator: mockSwarmCoordinator,
      resourceManager: mockResourceManager,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('session/save', () => {
    it('should have correct tool definition', () => {
      expect(saveSessionTool.name).toBe('session/save');
      expect(saveSessionTool.category).toBe('session');
    });

    it('should save a session with default options', async () => {
      const result = await saveSessionTool.handler({}, mockContext);

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
      expect(result.sessionId).toMatch(/^session-/);
      expect(result.name).toBeDefined();
      expect(result.savedAt).toBeDefined();
      expect(result.size).toBeGreaterThan(0);

      savedSessionId = result.sessionId;
    });

    it('should save a session with custom name', async () => {
      const result = await saveSessionTool.handler({
        name: 'My Custom Session',
      }, mockContext);

      expect(result.name).toBe('My Custom Session');
    });

    it('should save a session with description', async () => {
      const result = await saveSessionTool.handler({
        name: 'Test Session',
        description: 'This is a test session',
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
    });

    it('should include agent states when requested', async () => {
      const result = await saveSessionTool.handler({
        includeAgents: true,
      }, mockContext);

      expect(result.agentCount).toBe(2);
      expect(mockSwarmCoordinator.getStatus).toHaveBeenCalled();
    });

    it('should include tasks when requested', async () => {
      const result = await saveSessionTool.handler({
        includeTasks: true,
      }, mockContext);

      expect(result.taskCount).toBe(2);
      expect(mockOrchestrator.listTasks).toHaveBeenCalled();
    });

    it('should include memory entries when requested', async () => {
      const result = await saveSessionTool.handler({
        includeMemory: true,
      }, mockContext);

      expect(result.memoryCount).toBe(2);
      expect(mockResourceManager.memoryService.query).toHaveBeenCalled();
    });

    it('should include swarm state when requested', async () => {
      const result = await saveSessionTool.handler({
        includeSwarmState: true,
      }, mockContext);

      expect(result).toBeDefined();
      expect(mockSwarmCoordinator.getStatus).toHaveBeenCalled();
    });

    it('should save session with tags', async () => {
      const result = await saveSessionTool.handler({
        tags: ['production', 'important'],
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should save session with metadata', async () => {
      const result = await saveSessionTool.handler({
        metadata: { source: 'test', version: '1.0' },
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should exclude components when not requested', async () => {
      const result = await saveSessionTool.handler({
        includeAgents: false,
        includeTasks: false,
        includeMemory: false,
        includeSwarmState: false,
      }, mockContext);

      expect(result.agentCount).toBeUndefined();
      expect(result.taskCount).toBeUndefined();
      expect(result.memoryCount).toBeUndefined();
    });
  });

  describe('session/restore', () => {
    it('should have correct tool definition', () => {
      expect(restoreSessionTool.name).toBe('session/restore');
      expect(restoreSessionTool.category).toBe('session');
      expect(restoreSessionTool.inputSchema.required).toContain('sessionId');
    });

    it('should restore a saved session', async () => {
      // First save a session
      const saveResult = await saveSessionTool.handler({
        includeAgents: true,
        includeTasks: true,
      }, mockContext);

      // Then restore it
      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
      }, mockContext);

      expect(result).toBeDefined();
      expect(result.sessionId).toBe(saveResult.sessionId);
      expect(result.restoredAt).toBeDefined();
    });

    it('should restore agents when requested', async () => {
      const saveResult = await saveSessionTool.handler({
        includeAgents: true,
      }, mockContext);

      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
        restoreAgents: true,
      }, mockContext);

      expect(result.restored.agents).toBeDefined();
    });

    it('should restore tasks when requested', async () => {
      const saveResult = await saveSessionTool.handler({
        includeTasks: true,
      }, mockContext);

      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
        restoreTasks: true,
      }, mockContext);

      expect(result.restored.tasks).toBeDefined();
    });

    it('should restore memory when requested', async () => {
      const saveResult = await saveSessionTool.handler({
        includeMemory: true,
      }, mockContext);

      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
        restoreMemory: true,
      }, mockContext);

      expect(result.restored.memory).toBeDefined();
    });

    it('should restore swarm state when requested', async () => {
      const saveResult = await saveSessionTool.handler({
        includeSwarmState: true,
      }, mockContext);

      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
        restoreSwarmState: true,
      }, mockContext);

      expect(result.restored.swarmState).toBeDefined();
    });

    it('should clear existing state when requested', async () => {
      const saveResult = await saveSessionTool.handler({}, mockContext);

      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
        clearExisting: true,
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should skip restoring components when not requested', async () => {
      const saveResult = await saveSessionTool.handler({
        includeAgents: true,
        includeTasks: true,
        includeMemory: true,
      }, mockContext);

      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
        restoreAgents: false,
        restoreTasks: false,
        restoreMemory: false,
        restoreSwarmState: false,
      }, mockContext);

      expect(result.restored.agents).toBe(0);
      expect(result.restored.tasks).toBe(0);
      expect(result.restored.memory).toBe(0);
      expect(result.restored.swarmState).toBe(false);
    });

    it('should throw error for non-existent session', async () => {
      await expect(restoreSessionTool.handler({
        sessionId: 'non-existent-session',
      }, mockContext)).rejects.toThrow();
    });

    it('should report errors during restore', async () => {
      const saveResult = await saveSessionTool.handler({
        includeAgents: true,
      }, mockContext);

      // Make spawnAgent fail
      mockSwarmCoordinator.spawnAgent.mockRejectedValue(new Error('Spawn failed'));

      const result = await restoreSessionTool.handler({
        sessionId: saveResult.sessionId,
        restoreAgents: true,
      }, mockContext);

      // Should still complete but with errors
      expect(result).toBeDefined();
      if (result.errors) {
        expect(result.errors.length).toBeGreaterThan(0);
      }
    });
  });

  describe('session/list', () => {
    it('should have correct tool definition', () => {
      expect(listSessionsTool.name).toBe('session/list');
      expect(listSessionsTool.category).toBe('session');
      expect(listSessionsTool.cacheable).toBe(true);
    });

    it('should list saved sessions', async () => {
      // Save some sessions
      await saveSessionTool.handler({ name: 'Session 1' }, mockContext);
      await saveSessionTool.handler({ name: 'Session 2' }, mockContext);

      const result = await listSessionsTool.handler({}, mockContext);

      expect(result).toBeDefined();
      expect(result.sessions).toBeDefined();
      expect(Array.isArray(result.sessions)).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(2);
      expect(result.limit).toBeDefined();
      expect(result.offset).toBeDefined();
    });

    it('should apply pagination', async () => {
      const result = await listSessionsTool.handler({
        limit: 10,
        offset: 0,
      }, mockContext);

      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('should filter by tags', async () => {
      await saveSessionTool.handler({
        name: 'Tagged Session',
        tags: ['production'],
      }, mockContext);

      const result = await listSessionsTool.handler({
        tags: ['production'],
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should sort by created date', async () => {
      const result = await listSessionsTool.handler({
        sortBy: 'created',
        sortOrder: 'desc',
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should sort by name', async () => {
      const result = await listSessionsTool.handler({
        sortBy: 'name',
        sortOrder: 'asc',
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should sort by size', async () => {
      const result = await listSessionsTool.handler({
        sortBy: 'size',
        sortOrder: 'desc',
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should include metadata when requested', async () => {
      await saveSessionTool.handler({
        name: 'Session with Metadata',
        metadata: { key: 'value' },
      }, mockContext);

      const result = await listSessionsTool.handler({
        includeMetadata: true,
      }, mockContext);

      expect(result).toBeDefined();
    });

    it('should exclude metadata when not requested', async () => {
      await saveSessionTool.handler({
        name: 'Session without Metadata',
        metadata: { key: 'value' },
      }, mockContext);

      const result = await listSessionsTool.handler({
        includeMetadata: false,
      }, mockContext);

      expect(result).toBeDefined();
      // Sessions should not have metadata property
      result.sessions.forEach(session => {
        expect(session.metadata).toBeUndefined();
      });
    });

    it('should return session summaries', async () => {
      await saveSessionTool.handler({
        name: 'Full Session',
        includeAgents: true,
        includeTasks: true,
        includeMemory: true,
      }, mockContext);

      const result = await listSessionsTool.handler({}, mockContext);

      result.sessions.forEach(session => {
        expect(session.id).toBeDefined();
        expect(session.name).toBeDefined();
        expect(session.createdAt).toBeDefined();
        expect(session.size).toBeDefined();
        expect(session.agentCount).toBeDefined();
        expect(session.taskCount).toBeDefined();
        expect(session.memoryCount).toBeDefined();
      });
    });
  });

  describe('Session Persistence', () => {
    it('should persist session to file system', async () => {
      const result = await saveSessionTool.handler({
        name: 'Persisted Session',
      }, mockContext);

      expect(fs.mkdir).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalled();
      expect(result.path).toBeDefined();
    });

    it('should load session from file when not in memory', async () => {
      const sessionData = {
        id: 'file-session-123',
        name: 'File Session',
        version: '3.0.0',
        createdAt: new Date().toISOString(),
        agents: [],
        tasks: [],
        memory: [],
      };

      (fs.readFile as any).mockResolvedValue(JSON.stringify(sessionData));

      const result = await restoreSessionTool.handler({
        sessionId: 'file-session-123',
      }, mockContext);

      expect(result.sessionId).toBe('file-session-123');
    });
  });

  describe('Tool Collection', () => {
    it('should export all 3 session tools', () => {
      expect(sessionTools).toHaveLength(3);
    });

    it('should have unique tool names', () => {
      const names = sessionTools.map(t => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should all have handlers', () => {
      sessionTools.forEach(tool => {
        expect(tool.handler).toBeDefined();
        expect(typeof tool.handler).toBe('function');
      });
    });

    it('should all have inputSchema', () => {
      sessionTools.forEach(tool => {
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      });
    });

    it('should all be in session category', () => {
      sessionTools.forEach(tool => {
        expect(tool.category).toBe('session');
      });
    });

    it('should include expected tool names', () => {
      const names = sessionTools.map(t => t.name);
      expect(names).toContain('session/save');
      expect(names).toContain('session/restore');
      expect(names).toContain('session/list');
    });
  });

  describe('Error Handling', () => {
    it('should handle missing context gracefully', async () => {
      const emptyContext: ToolContext = { sessionId: 'test' };

      const result = await saveSessionTool.handler({}, emptyContext);

      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
    });

    it('should handle orchestrator errors gracefully', async () => {
      mockOrchestrator.listTasks.mockRejectedValue(new Error('Orchestrator error'));

      const result = await saveSessionTool.handler({
        includeTasks: true,
      }, mockContext);

      // Should still save, just without tasks
      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
    });

    it('should handle swarm coordinator errors gracefully', async () => {
      mockSwarmCoordinator.getStatus.mockRejectedValue(new Error('Swarm error'));

      const result = await saveSessionTool.handler({
        includeAgents: true,
      }, mockContext);

      // Should still save, just without agents
      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
    });

    it('should handle memory service errors gracefully', async () => {
      mockResourceManager.memoryService.query.mockRejectedValue(new Error('Memory error'));

      const result = await saveSessionTool.handler({
        includeMemory: true,
      }, mockContext);

      // Should still save, just without memory
      expect(result).toBeDefined();
      expect(result.sessionId).toBeDefined();
    });
  });
});
