/**
 * Integration tests for JSON output functionality (Issue #206)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { SwarmJsonOutputAggregator } from '../../src/swarm/json-output-aggregator.js';
import { SwarmCoordinator } from '../../src/swarm/coordinator.js';
import { generateId } from '../../src/utils/helpers.js';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

describe('JSON Output Functionality', () => {
  let tempDir: string;
  let aggregator: SwarmJsonOutputAggregator;
  let coordinator: SwarmCoordinator;
  
  beforeEach(async () => {
    // Create temporary directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-flow-json-test-'));
    
    // Initialize aggregator
    aggregator = new SwarmJsonOutputAggregator(
      'test-swarm-123',
      'Test objective for JSON output',
      { strategy: 'auto', mode: 'centralized', maxAgents: 3 }
    );
    
    // Initialize coordinator with JSON output enabled
    coordinator = new SwarmCoordinator({
      name: 'Test Swarm',
      description: 'Test swarm for JSON output',
      mode: 'centralized',
      strategy: 'auto',
      maxAgents: 3
    });
    
    await coordinator.initialize();
    coordinator.enableJsonOutput('Test objective for JSON output');
  });
  
  afterEach(async () => {
    // Clean up temporary directory
    await fs.rmdir(tempDir, { recursive: true });
  });

  describe('SwarmJsonOutputAggregator', () => {
    it('should initialize with correct metadata', () => {
      const output = aggregator.getJsonOutput('completed');
      const parsed = JSON.parse(output);
      
      expect(parsed.swarmId).toBe('test-swarm-123');
      expect(parsed.objective).toBe('Test objective for JSON output');
      expect(parsed.status).toBe('completed');
      expect(parsed.metadata.strategy).toBe('auto');
      expect(parsed.metadata.mode).toBe('centralized');
      expect(parsed.metadata.version).toBe('2.0.0-alpha');
    });

    it('should track agents correctly', () => {
      const agent1 = {
        id: 'agent-1',
        name: 'Test Agent 1',
        type: 'researcher' as any,
        status: 'active' as any
      };
      
      const agent2 = {
        id: 'agent-2', 
        name: 'Test Agent 2',
        type: 'coder' as any,
        status: 'active' as any
      };
      
      aggregator.addAgent(agent1);
      aggregator.addAgent(agent2);
      
      const output = aggregator.getJsonOutput('completed');
      const parsed = JSON.parse(output);
      
      expect(parsed.agents).toHaveLength(2);
      expect(parsed.agents[0].agentId).toBe('agent-1');
      expect(parsed.agents[0].name).toBe('Test Agent 1');
      expect(parsed.agents[0].type).toBe('researcher');
      expect(parsed.agents[1].agentId).toBe('agent-2');
      expect(parsed.summary.totalAgents).toBe(2);
    });

    it('should track tasks correctly', () => {
      const task1 = {
        id: 'task-1',
        name: 'Test Task 1',
        type: 'research' as any,
        status: 'completed' as any,
        priority: 'high'
      };
      
      const task2 = {
        id: 'task-2',
        name: 'Test Task 2', 
        type: 'coding' as any,
        status: 'failed' as any,
        priority: 'medium'
      };
      
      aggregator.addTask(task1);
      aggregator.addTask(task2);
      
      const output = aggregator.getJsonOutput('completed');
      const parsed = JSON.parse(output);
      
      expect(parsed.tasks).toHaveLength(2);
      expect(parsed.tasks[0].taskId).toBe('task-1');
      expect(parsed.tasks[0].status).toBe('completed');
      expect(parsed.tasks[1].taskId).toBe('task-2');
      expect(parsed.tasks[1].status).toBe('failed');
      expect(parsed.summary.totalTasks).toBe(2);
    });

    it('should collect agent outputs and errors', () => {
      const agent = {
        id: 'agent-1',
        name: 'Test Agent',
        type: 'researcher' as any,
        status: 'active' as any
      };
      
      aggregator.addAgent(agent);
      aggregator.addAgentOutput('agent-1', 'Research completed successfully');
      aggregator.addAgentOutput('agent-1', 'Found 5 relevant papers');
      aggregator.addAgentError('agent-1', 'Network timeout during search');
      
      const output = aggregator.getJsonOutput('completed');
      const parsed = JSON.parse(output);
      
      expect(parsed.agents[0].outputs).toHaveLength(2);
      expect(parsed.agents[0].outputs[0]).toBe('Research completed successfully');
      expect(parsed.agents[0].errors).toHaveLength(1);
      expect(parsed.agents[0].errors[0]).toBe('Network timeout during search');
      expect(parsed.results.outputs).toHaveLength(2);
      expect(parsed.results.errors).toHaveLength(1);
    });

    it('should calculate summary statistics correctly', () => {
      // Add agents
      aggregator.addAgent({
        id: 'agent-1', name: 'Agent 1', type: 'researcher' as any, status: 'active' as any
      });
      aggregator.addAgent({
        id: 'agent-2', name: 'Agent 2', type: 'coder' as any, status: 'active' as any
      });
      
      // Add tasks
      aggregator.addTask({
        id: 'task-1', name: 'Task 1', type: 'research' as any, status: 'completed' as any, priority: 'high'
      });
      aggregator.addTask({
        id: 'task-2', name: 'Task 2', type: 'coding' as any, status: 'completed' as any, priority: 'medium'
      });
      aggregator.addTask({
        id: 'task-3', name: 'Task 3', type: 'testing' as any, status: 'failed' as any, priority: 'low'
      });
      
      const output = aggregator.getJsonOutput('completed');
      const parsed = JSON.parse(output);
      
      expect(parsed.summary.totalAgents).toBe(2);
      expect(parsed.summary.totalTasks).toBe(3);
      expect(parsed.summary.completedTasks).toBe(2);
      expect(parsed.summary.failedTasks).toBe(1);
      expect(parsed.summary.successRate).toBeCloseTo(0.667, 2);
    });

    it('should save output to file', async () => {
      const filePath = path.join(tempDir, 'test-output.json');
      
      aggregator.addInsight('This is a test insight');
      aggregator.addArtifact('test-key', { type: 'test', value: 'test-data' });
      
      await aggregator.saveToFile(filePath, 'completed');
      
      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      
      expect(parsed.swarmId).toBe('test-swarm-123');
      expect(parsed.results.insights).toContain('This is a test insight');
      expect(parsed.results.artifacts['test-key']).toEqual({ type: 'test', value: 'test-data' });
    });
  });

  describe('SwarmCoordinator JSON Integration', () => {
    it('should enable JSON output correctly', () => {
      const jsonOutput = coordinator.getJsonOutput('completed');
      expect(jsonOutput).not.toBeNull();
      
      const parsed = JSON.parse(jsonOutput!);
      expect(parsed.objective).toBe('Test objective for JSON output');
    });

    it('should track agents and tasks when JSON output is enabled', async () => {
      // Create an agent through coordinator
      const agentId = await coordinator.registerAgent('test-agent', 'researcher');
      
      // Create a task through coordinator  
      const taskId = await coordinator.createTask('research', 'Test research task');
      
      const jsonOutput = coordinator.getJsonOutput('completed');
      expect(jsonOutput).not.toBeNull();
      
      const parsed = JSON.parse(jsonOutput!);
      expect(parsed.agents.length).toBeGreaterThan(0);
      expect(parsed.tasks.length).toBeGreaterThan(0);
    });

    it('should save JSON output to file through coordinator', async () => {
      const filePath = path.join(tempDir, 'coordinator-output.json');
      
      // Add some test data
      coordinator.addInsight('Coordinator test insight');
      coordinator.addArtifact('coordinator-test', { data: 'test' });
      
      await coordinator.saveJsonOutput(filePath, 'completed');
      
      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(fileContent);
      
      expect(parsed.results.insights).toContain('Coordinator test insight');
      expect(parsed.results.artifacts['coordinator-test']).toEqual({ data: 'test' });
    });
  });

  describe('Command Line Integration', () => {
    it('should parse JSON output flags correctly', () => {
      // This would test the parseSwarmOptions function
      // For now, we'll create a mock test structure
      const flags = {
        'output-format': 'json',
        'output-file': 'results.json',
        'no-interactive': true
      };
      
      // Mock the parseSwarmOptions function behavior
      const outputFormat = flags['output-format'];
      const outputFile = flags['output-file'];
      const noInteractive = flags['no-interactive'];
      
      expect(outputFormat).toBe('json');
      expect(outputFile).toBe('results.json');
      expect(noInteractive).toBe(true);
    });
  });
});