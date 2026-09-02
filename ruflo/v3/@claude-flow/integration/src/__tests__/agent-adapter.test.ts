/**
 * AgentAdapter Test Suite
 *
 * Tests for ADR-001 agent adapter and delegation patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentAdapter, createAgentAdapter } from '../agent-adapter.js';
import { AgenticFlowAgent } from '../agentic-flow-agent.js';

describe('AgentAdapter', () => {
  let adapter: AgentAdapter;

  beforeEach(async () => {
    adapter = new AgentAdapter({
      enableSync: true,
      autoConvert: true,
      fallbackOnError: true,
      debug: false,
    });

    await adapter.initialize();
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      const freshAdapter = new AgentAdapter();
      await freshAdapter.initialize();

      expect(freshAdapter).toBeDefined();

      await freshAdapter.shutdown();
    });

    it('should be idempotent on multiple initialize calls', async () => {
      await adapter.initialize();
      await adapter.initialize();

      expect(adapter).toBeDefined();
    });
  });

  describe('Agent Creation with Delegation', () => {
    it('should create an agent with delegation support', async () => {
      const agent = await adapter.createWithDelegation({
        id: 'delegated-agent-1',
        name: 'Delegated Agent',
        type: 'coder',
        capabilities: ['code-generation'],
        maxConcurrentTasks: 3,
        priority: 5,
      });

      expect(agent).toBeInstanceOf(AgenticFlowAgent);
      expect(agent.id).toBe('delegated-agent-1');
      expect(agent.status).toBe('idle'); // Should be initialized
    });

    it('should track created agents', async () => {
      const agent1 = await adapter.createWithDelegation({
        id: 'agent-1',
        name: 'Agent 1',
        type: 'coder',
        capabilities: [],
        maxConcurrentTasks: 1,
        priority: 1,
      });

      const agent2 = await adapter.createWithDelegation({
        id: 'agent-2',
        name: 'Agent 2',
        type: 'tester',
        capabilities: [],
        maxConcurrentTasks: 1,
        priority: 1,
      });

      const allAgents = adapter.getAllAgents();
      expect(allAgents).toHaveLength(2);
      expect(allAgents).toContain(agent1);
      expect(allAgents).toContain(agent2);
    });
  });

  describe('Agent Retrieval', () => {
    let testAgent: AgenticFlowAgent;

    beforeEach(async () => {
      testAgent = await adapter.createWithDelegation({
        id: 'retrieval-agent',
        name: 'Retrieval Test Agent',
        type: 'researcher',
        capabilities: ['research'],
        maxConcurrentTasks: 2,
        priority: 3,
      });
    });

    it('should retrieve agent by ID', () => {
      const retrieved = adapter.getAgent('retrieval-agent');

      expect(retrieved).toBe(testAgent);
    });

    it('should return undefined for non-existent agent', () => {
      const retrieved = adapter.getAgent('non-existent-agent');

      expect(retrieved).toBeUndefined();
    });

    it('should get all agents', () => {
      const allAgents = adapter.getAllAgents();

      expect(allAgents).toHaveLength(1);
      expect(allAgents[0]).toBe(testAgent);
    });
  });

  describe('Agent Removal', () => {
    it('should remove an agent', async () => {
      const agent = await adapter.createWithDelegation({
        id: 'removal-agent',
        name: 'Removal Test',
        type: 'coder',
        capabilities: [],
        maxConcurrentTasks: 1,
        priority: 1,
      });

      expect(adapter.getAgent('removal-agent')).toBe(agent);

      const removed = await adapter.removeAgent('removal-agent');

      expect(removed).toBe(true);
      expect(adapter.getAgent('removal-agent')).toBeUndefined();
    });

    it('should return false when removing non-existent agent', async () => {
      const removed = await adapter.removeAgent('non-existent');

      expect(removed).toBe(false);
    });
  });

  describe('Agent Conversion from agentic-flow', () => {
    it('should convert agentic-flow agent format', () => {
      const mockAgenticFlowAgent = {
        id: 'mock-agent-1',
        name: 'Mock Agent',
        type: 'coder',
        status: 'ready',
        config: {
          capabilities: ['code-generation', 'refactoring'],
          maxConcurrentTasks: 3,
          priority: 5,
        },
      };

      const result = adapter.fromAgenticFlow(mockAgenticFlowAgent);

      expect(result.success).toBe(true);
      expect(result.agent).toBeInstanceOf(AgenticFlowAgent);
      expect(result.agent.id).toBe('mock-agent-1');
      expect(result.agent.name).toBe('Mock Agent');
      expect(result.warnings).toHaveLength(0);
    });

    it('should handle conversion warnings for unknown agent types', () => {
      const mockAgenticFlowAgent = {
        id: 'mock-agent-2',
        name: 'Mock Agent',
        type: 'unknown-type',
        status: 'ready',
        config: {
          capabilities: [],
        },
      };

      const result = adapter.fromAgenticFlow(mockAgenticFlowAgent);

      expect(result.success).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('unknown-type');
    });
  });

  describe('Agent Conversion to agentic-flow', () => {
    it('should convert Claude Flow agent to agentic-flow format', async () => {
      const agent = await adapter.createWithDelegation({
        id: 'convert-agent',
        name: 'Convert Test',
        type: 'coder',
        capabilities: ['code-generation'],
        maxConcurrentTasks: 2,
        priority: 4,
      });

      const agenticFlowFormat = adapter.toAgenticFlow(agent);

      expect(agenticFlowFormat.id).toBe('convert-agent');
      expect(agenticFlowFormat.name).toBe('Convert Test');
      expect(agenticFlowFormat.type).toBe('coder');
      expect(agenticFlowFormat.config).toBeDefined();
    });
  });

  describe('Delegation Status', () => {
    it('should track delegation status', async () => {
      const agent = await adapter.createWithDelegation({
        id: 'delegation-check-agent',
        name: 'Delegation Check',
        type: 'coder',
        capabilities: [],
        maxConcurrentTasks: 1,
        priority: 1,
      });

      // Note: isDelegated will be false unless agentic-flow is actually available
      const isDelegated = adapter.isDelegated('delegation-check-agent');

      expect(typeof isDelegated).toBe('boolean');
    });
  });

  describe('Shutdown', () => {
    it('should shutdown all managed agents', async () => {
      await adapter.createWithDelegation({
        id: 'shutdown-agent-1',
        name: 'Shutdown Test 1',
        type: 'coder',
        capabilities: [],
        maxConcurrentTasks: 1,
        priority: 1,
      });

      await adapter.createWithDelegation({
        id: 'shutdown-agent-2',
        name: 'Shutdown Test 2',
        type: 'tester',
        capabilities: [],
        maxConcurrentTasks: 1,
        priority: 1,
      });

      expect(adapter.getAllAgents()).toHaveLength(2);

      await adapter.shutdown();

      expect(adapter.getAllAgents()).toHaveLength(0);
    });
  });
});

describe('createAgentAdapter', () => {
  it('should create and initialize an adapter', async () => {
    const adapter = await createAgentAdapter({
      enableSync: true,
      debug: false,
    });

    expect(adapter).toBeInstanceOf(AgentAdapter);

    await adapter.shutdown();
  });
});
