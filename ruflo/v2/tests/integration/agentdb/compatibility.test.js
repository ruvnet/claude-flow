/**
 * AgentDB Integration Tests
 * Comprehensive integration test suite
 * Coverage: MCP tools, hooks system, swarm coordination, session persistence
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';

const execAsync = promisify(exec);

describe('AgentDB Integration Tests', () => {
  let testDbPath;

  beforeAll(async () => {
    testDbPath = path.join('/tmp', `integration-agentdb-${Date.now()}.db`);
  });

  afterAll(async () => {
    await fs.unlink(testDbPath).catch(() => {});
  });

  // ========================================
  // MCP TOOLS INTEGRATION TESTS (10 tests)
  // ========================================

  describe('MCP Tools Integration', () => {
    test('should work with memory_usage MCP tool', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Simulate MCP memory_usage call
      await adapter.store('mcp-test', { data: 'value' });
      const result = await adapter.retrieve('mcp-test');

      expect(result).toBeDefined();
      expect(result.data).toBe('value');

      await adapter.close();
    });

    test('should work with memory_search MCP tool', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.store('searchable-1', { content: 'test data' });
      await adapter.store('searchable-2', { content: 'test content' });

      const results = await adapter.search('test');
      expect(results.length).toBeGreaterThan(0);

      await adapter.close();
    });

    test('should support swarm_status integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Store swarm status
      await adapter.store('swarm/status', {
        topology: 'mesh',
        agentCount: 5,
        activeAgents: ['agent1', 'agent2', 'agent3']
      }, { namespace: 'coordination' });

      const status = await adapter.retrieve('swarm/status', { namespace: 'coordination' });
      expect(status.topology).toBe('mesh');

      await adapter.close();
    });

    test('should support agent_list integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Register agents
      await adapter.registerAgent('agent1', { type: 'coder', capabilities: ['coding'] });
      await adapter.registerAgent('agent2', { type: 'tester', capabilities: ['testing'] });

      const agents = await adapter.getActiveAgents();
      expect(agents.length).toBeGreaterThanOrEqual(2);

      await adapter.close();
    });

    test('should support task_orchestrate integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Track task
      await adapter.trackWorkflow('task-1', {
        name: 'Test Task',
        steps: ['analyze', 'implement', 'test'],
        status: 'running'
      });

      const task = await adapter.getWorkflowStatus('task-1');
      expect(task.status).toBe('running');

      await adapter.close();
    });

    test('should support neural_patterns integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath, mode: 'agentdb' });
      await adapter.initialize();

      if (adapter.vectorSearch) {
        // Store neural pattern
        const embedding = new Array(384).fill(0).map(() => Math.random());
        await adapter.storeWithEmbedding('pattern-1',
          { type: 'coordination', success: true },
          embedding
        );

        const patterns = await adapter.vectorSearch('coordination', { limit: 5 });
        expect(Array.isArray(patterns)).toBe(true);
      }

      await adapter.close();
    });

    test('should support performance_report integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Record performance metrics
      await adapter.trackPerformance('vector_search', 0.05, true);
      await adapter.trackPerformance('vector_search', 0.08, true);
      await adapter.trackPerformance('vector_search', 0.06, true);

      const stats = await adapter.getPerformanceStats('vector_search');
      expect(stats.count).toBe(3);
      expect(stats.avgDuration).toBeLessThan(0.1);

      await adapter.close();
    });

    test('should support cache_manage integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Cache coordination data
      await adapter.cacheCoordination('task-assignment', {
        taskId: 'task-1',
        assignedAgent: 'agent1'
      });

      const cached = await adapter.getCachedCoordination('task-assignment');
      expect(cached.assignedAgent).toBe('agent1');

      await adapter.close();
    });

    test('should support workflow_status integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.trackWorkflow('workflow-1', {
        name: 'Integration Test Workflow',
        steps: ['init', 'execute', 'validate'],
        status: 'running',
        progress: 50
      });

      const workflow = await adapter.getWorkflowStatus('workflow-1');
      expect(workflow.progress).toBe(50);

      await adapter.close();
    });

    test('should support state_snapshot integration', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Create snapshot
      const snapshotId = `snapshot-${Date.now()}`;
      await adapter.store(`snapshot:${snapshotId}`, {
        timestamp: Date.now(),
        agents: ['agent1', 'agent2'],
        tasks: ['task1', 'task2']
      }, { namespace: 'snapshots' });

      const snapshot = await adapter.retrieve(`snapshot:${snapshotId}`, {
        namespace: 'snapshots'
      });
      expect(snapshot.agents).toHaveLength(2);

      await adapter.close();
    });
  });

  // ========================================
  // HOOKS SYSTEM INTEGRATION TESTS (10 tests)
  // ========================================

  describe('Hooks System Integration', () => {
    test('should integrate with pre-task hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Simulate pre-task hook
      await adapter.store('hooks/pre-task/test-task', {
        taskDescription: 'Integration test',
        timestamp: Date.now(),
        agent: 'tester'
      }, { namespace: 'hooks' });

      const hookData = await adapter.retrieve('hooks/pre-task/test-task', {
        namespace: 'hooks'
      });
      expect(hookData.agent).toBe('tester');

      await adapter.close();
    });

    test('should integrate with post-edit hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Simulate post-edit hook
      await adapter.store('hooks/post-edit/test-file.js', {
        file: 'test-file.js',
        changes: '+10/-5',
        timestamp: Date.now()
      }, { namespace: 'hooks' });

      const editData = await adapter.retrieve('hooks/post-edit/test-file.js', {
        namespace: 'hooks'
      });
      expect(editData.file).toBe('test-file.js');

      await adapter.close();
    });

    test('should integrate with session-restore hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Save session state
      await adapter.saveSessionState('session-123', {
        userId: 'test-user',
        projectPath: '/test/path',
        activeBranch: 'feature/agentdb',
        state: 'active'
      });

      // Restore session
      const session = await adapter.resumeSession('session-123');
      expect(session.activeBranch).toBe('feature/agentdb');

      await adapter.close();
    });

    test('should integrate with session-end hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.saveSessionState('session-end', {
        userId: 'test',
        state: 'ending'
      });

      // Update to ended
      const session = await adapter.resumeSession('session-end');
      session.state = 'ended';
      session.endTime = Date.now();
      await adapter.saveSessionState('session-end', session);

      const ended = await adapter.resumeSession('session-end');
      expect(ended.state).toBe('ended');

      await adapter.close();
    });

    test('should integrate with notify hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Store notification
      await adapter.store(`notification:${Date.now()}`, {
        message: 'Test complete',
        level: 'info',
        timestamp: Date.now()
      }, { namespace: 'notifications' });

      const notifications = await adapter.list({ namespace: 'notifications' });
      expect(notifications.length).toBeGreaterThan(0);

      await adapter.close();
    });

    test('should support auto-format hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.store('hooks/format/result', {
        file: 'test.js',
        formatted: true,
        changes: 5
      }, { namespace: 'hooks' });

      const result = await adapter.retrieve('hooks/format/result', { namespace: 'hooks' });
      expect(result.formatted).toBe(true);

      await adapter.close();
    });

    test('should support neural training hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath, mode: 'agentdb' });
      await adapter.initialize();

      if (adapter.recordLearning) {
        await adapter.recordLearning('agent1', {
          type: 'pattern',
          input: 'test input',
          output: 'test output',
          feedback: 0.95,
          improvement: 0.15
        });

        const learnings = await adapter.getLearnings('agent1');
        expect(learnings.length).toBeGreaterThan(0);
      }

      await adapter.close();
    });

    test('should support performance tracking hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.trackPerformance('hook_execution', 25, true, {
        hook: 'post-task'
      });

      const stats = await adapter.getPerformanceStats('hook_execution');
      expect(stats.count).toBeGreaterThan(0);

      await adapter.close();
    });

    test('should support token usage hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.recordMetric('token_usage', 1500, {
        operation: 'test_execution',
        model: 'claude-sonnet'
      });

      const metrics = await adapter.getMetrics('token_usage');
      expect(metrics.length).toBeGreaterThan(0);

      await adapter.close();
    });

    test('should support cache optimization hook', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Cache frequently accessed data
      await adapter.cacheCoordination('frequently_accessed', {
        data: 'cached_value'
      }, 300);

      const cached = await adapter.getCachedCoordination('frequently_accessed');
      expect(cached.data).toBe('cached_value');

      await adapter.close();
    });
  });

  // ========================================
  // SWARM COORDINATION TESTS (5 tests)
  // ========================================

  describe('Swarm Coordination', () => {
    test('should coordinate multiple agents', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Register multiple agents
      const agents = ['coder', 'tester', 'reviewer'];
      for (const agentType of agents) {
        await adapter.registerAgent(`${agentType}-1`, {
          type: agentType,
          capabilities: [agentType]
        });
      }

      const activeAgents = await adapter.getActiveAgents();
      expect(activeAgents.length).toBeGreaterThanOrEqual(3);

      await adapter.close();
    });

    test('should share knowledge between agents', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Agent 1 stores knowledge
      await adapter.storeKnowledge('testing', 'tdd-approach', {
        description: 'Write tests first',
        success: true
      });

      // Agent 2 retrieves knowledge
      const knowledge = await adapter.retrieveKnowledge('testing', 'tdd-approach');
      expect(knowledge.success).toBe(true);

      await adapter.close();
    });

    test('should coordinate task assignment', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Store task assignment
      await adapter.store('task/assignment/task-1', {
        taskId: 'task-1',
        assignedTo: 'coder-1',
        status: 'assigned'
      }, { namespace: 'coordination' });

      const assignment = await adapter.retrieve('task/assignment/task-1', {
        namespace: 'coordination'
      });
      expect(assignment.assignedTo).toBe('coder-1');

      await adapter.close();
    });

    test('should support agent heartbeats', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.registerAgent('heartbeat-agent', { type: 'coder' });

      // Update heartbeat
      await adapter.updateAgentStatus('heartbeat-agent', 'active');

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));

      // Update again
      await adapter.updateAgentStatus('heartbeat-agent', 'active');

      const activeAgents = await adapter.getActiveAgents();
      expect(activeAgents.find(a => a.agentId === 'heartbeat-agent')).toBeDefined();

      await adapter.close();
    });

    test('should handle agent failure and recovery', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.registerAgent('failing-agent', { type: 'coder' });

      // Simulate failure
      await adapter.updateAgentStatus('failing-agent', 'failed');

      // Recovery
      await adapter.updateAgentStatus('failing-agent', 'active');

      const agent = await adapter.retrieve('agent:failing-agent', { namespace: 'agents' });
      expect(agent.status).toBe('active');

      await adapter.close();
    });
  });

  // ========================================
  // SESSION PERSISTENCE TESTS (5 tests)
  // ========================================

  describe('Session Persistence', () => {
    test('should persist session across restarts', async () => {
      let adapter = new (await import('../../../src/memory/agentdb-adapter.js')).AgentDBMemoryAdapter({
        dbPath: testDbPath
      });
      await adapter.initialize();

      await adapter.saveSessionState('persist-session', {
        userId: 'test',
        projectPath: '/test',
        state: 'active'
      });

      await adapter.close();

      // Restart
      adapter = new (await import('../../../src/memory/agentdb-adapter.js')).AgentDBMemoryAdapter({
        dbPath: testDbPath
      });
      await adapter.initialize();

      const session = await adapter.resumeSession('persist-session');
      expect(session.userId).toBe('test');

      await adapter.close();
    });

    test('should maintain active sessions list', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.saveSessionState('session-1', { state: 'active' });
      await adapter.saveSessionState('session-2', { state: 'active' });
      await adapter.saveSessionState('session-3', { state: 'inactive' });

      const active = await adapter.getActiveSessions();
      expect(active.length).toBe(2);

      await adapter.close();
    });

    test('should track session history', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      const sessionId = 'history-session';
      await adapter.saveSessionState(sessionId, {
        state: 'active',
        timestamp: Date.now()
      });

      // Update multiple times
      for (let i = 0; i < 5; i++) {
        const session = await adapter.resumeSession(sessionId);
        session.updates = (session.updates || 0) + 1;
        await adapter.saveSessionState(sessionId, session);
      }

      const session = await adapter.resumeSession(sessionId);
      expect(session.updates).toBe(5);

      await adapter.close();
    });

    test('should cleanup old sessions', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      // Create old session
      await adapter.store('session:old-session', {
        sessionId: 'old-session',
        state: 'inactive',
        lastActivity: Date.now() - (7 * 24 * 60 * 60 * 1000) // 7 days ago
      }, { namespace: 'sessions', ttl: 1 });

      await new Promise(resolve => setTimeout(resolve, 1100));
      await adapter.cleanupExpired();

      const oldSession = await adapter.retrieve('session:old-session', {
        namespace: 'sessions'
      });
      expect(oldSession).toBeNull();

      await adapter.close();
    });

    test('should export/import session data', async () => {
      const { AgentDBMemoryAdapter } = await import('../../../src/memory/agentdb-adapter.js');
      const adapter = new AgentDBMemoryAdapter({ dbPath: testDbPath });
      await adapter.initialize();

      await adapter.saveSessionState('export-session', {
        userId: 'test',
        data: 'important'
      });

      const exported = await adapter.exportData('sessions');
      expect(exported.sessions).toBeDefined();
      expect(exported.sessions.length).toBeGreaterThan(0);

      await adapter.close();
    });
  });
});
