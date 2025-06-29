/// <reference types="jest" />

/**
 * Integration tests for swarm operation validation framework
 * Tests swarm coordination, agent communication, and system integrity
 */

import {
  describe,
  it,
  beforeEach,
  afterEach,
  assertEquals,
  assertExists,
  waitFor,
  createDeferred
} from '../test.utils.js';
import { SwarmCoordinator } from '../../src/coordination/swarm-coordinator.js';
import { StateManager } from '../../src/state/manager.js';
import { MemoryManager } from '../../src/memory/manager.js';
import { EventBus } from '../../src/core/event-bus.js';
import { Logger } from '../../src/core/logger.js';
import { MessageBus } from '../../src/communication/message-bus.js';
import { AgentOrchestrator } from '../../src/core/agent-orchestrator.js';
import { cleanupTestEnv, setupTestEnv, TEST_CONFIG } from '../test.config.js';

describe('Swarm Validation Framework', () => {
  let swarmCoordinator: SwarmCoordinator;
  let stateManager: StateManager;
  let memoryManager: MemoryManager;
  let messageBus: MessageBus;
  let agentOrchestrator: AgentOrchestrator;
  let eventBus: EventBus;
  let logger: Logger;

  beforeEach(async () => {
    setupTestEnv();

    logger = new Logger({
      level: 'debug',
      format: 'text',
      destination: 'console',
    });

    eventBus = new EventBus();
    
    stateManager = new StateManager({
      maxConcurrentOperations: 64,
      stateTimeout: 30000,
      enableConcurrencyControl: true
    });

    memoryManager = new MemoryManager({
      backend: 'memory',
      maxEntries: 10000,
      enableConcurrency: true,
      enableValidation: true
    });

    messageBus = new MessageBus({
      maxSubscribers: 100,
      messageTimeout: 15000,
      enableRetry: true,
      retryAttempts: 3
    });

    agentOrchestrator = new AgentOrchestrator({
      maxAgents: 64,
      enableHealthChecks: true,
      healthCheckInterval: 2000,
      agentTimeout: 30000
    });

    swarmCoordinator = new SwarmCoordinator({
      maxAgents: 64,
      maxConcurrentTasks: 48,
      taskTimeout: 45000,
      enableMonitoring: true,
      enableWorkStealing: true,
      enableLoadBalancing: true,
      maxRetries: 3
    });

    await Promise.all([
      stateManager.initialize(),
      memoryManager.initialize(),
      messageBus.initialize(),
      agentOrchestrator.initialize(),
      swarmCoordinator.start()
    ]);
  });

  afterEach(async () => {
    await Promise.all([
      swarmCoordinator.shutdown(),
      agentOrchestrator.shutdown(),
      messageBus.shutdown(),
      memoryManager.cleanup(),
      stateManager.cleanup()
    ]);
    await cleanupTestEnv();
  });

  describe('Large-Scale Swarm Coordination', () => {
    it('should coordinate 50+ agents in complex hierarchical structure', async () => {
      const totalAgents = 56;
      const hierarchyLevels = 4;
      const agentsPerLevel = Math.ceil(totalAgents / hierarchyLevels);
      
      const hierarchy: Array<{
        level: number;
        agents: any[];
        coordinator?: any;
      }> = [];
      
      // Create hierarchical agent structure
      for (let level = 0; level < hierarchyLevels; level++) {
        const levelAgents = [];
        const agentCount = level === 0 ? 1 : Math.min(agentsPerLevel, totalAgents - level * agentsPerLevel);
        
        for (let i = 0; i < agentCount; i++) {
          const agentId = `L${level}-agent-${i}`;
          const agent = swarmCoordinator.createAgent({
            id: agentId,
            name: `Level ${level} Agent ${i}`,
            type: level === 0 ? 'coordinator' : level === 1 ? 'manager' : level === 2 ? 'supervisor' : 'worker',
            capabilities: [
              'communication',
              level <= 1 ? 'coordination' : null,
              level <= 2 ? 'task-management' : null,
              level >= 2 ? 'execution' : null
            ].filter(Boolean),
            level,
            parentId: level > 0 ? hierarchy[level - 1]?.coordinator?.id : null
          });
          
          levelAgents.push(agent);
        }
        
        hierarchy.push({
          level,
          agents: levelAgents,
          coordinator: levelAgents[0] // First agent is coordinator for this level
        });
      }
      
      // Create complex objective requiring all levels
      const complexObjective = swarmCoordinator.createObjective({
        description: 'Execute hierarchical swarm coordination test',
        strategy: 'hierarchical',
        requiredAgents: totalAgents,
        maxDuration: 60000
      });
      
      // Create tasks for each level
      const allTasks = [];
      
      // Level 0 (Coordinator) tasks
      const coordinatorTasks = [
        swarmCoordinator.createTask({
          type: 'orchestration',
          description: 'Initialize swarm coordination',
          priority: 10,
          requiredCapabilities: ['coordination'],
          assignToLevel: 0
        }),
        swarmCoordinator.createTask({
          type: 'monitoring',
          description: 'Monitor swarm health and progress',
          priority: 9,
          requiredCapabilities: ['coordination', 'communication'],
          assignToLevel: 0
        })
      ];
      
      // Level 1 (Manager) tasks
      const managerTasks = hierarchy[1]?.agents.map((agent, i) => 
        swarmCoordinator.createTask({
          type: 'management',
          description: `Manage subsection ${i}`,
          priority: 8,
          requiredCapabilities: ['task-management', 'communication'],
          assignToLevel: 1,
          dependencies: coordinatorTasks.map(t => t.id)
        })
      ) || [];
      
      // Level 2 (Supervisor) tasks
      const supervisorTasks = hierarchy[2]?.agents.map((agent, i) => 
        swarmCoordinator.createTask({
          type: 'supervision',
          description: `Supervise work group ${i}`,
          priority: 7,
          requiredCapabilities: ['task-management', 'execution'],
          assignToLevel: 2,
          dependencies: managerTasks.slice(i * 2, (i + 1) * 2).map(t => t?.id).filter(Boolean)
        })
      ) || [];
      
      // Level 3 (Worker) tasks
      const workerTasks = hierarchy[3]?.agents.map((agent, i) => 
        swarmCoordinator.createTask({
          type: 'execution',
          description: `Execute work unit ${i}`,
          priority: 6,
          requiredCapabilities: ['execution'],
          assignToLevel: 3,
          dependencies: supervisorTasks.slice(Math.floor(i / 4), Math.floor(i / 4) + 1).map(t => t?.id).filter(Boolean)
        })
      ) || [];
      
      allTasks.push(...coordinatorTasks, ...managerTasks, ...supervisorTasks, ...workerTasks);
      complexObjective.tasks = allTasks;
      
      // Execute swarm coordination
      const startTime = Date.now();
      const coordinationResults = [];
      
      // Monitor coordination progress
      const progressMonitor = setInterval(async () => {
        try {
          const swarmStatus = await swarmCoordinator.getSwarmStatus();
          const levelStatus = hierarchy.map(level => ({
            level: level.level,
            activeAgents: level.agents.filter(a => a.status === 'busy').length,
            totalAgents: level.agents.length
          }));
          
          coordinationResults.push({
            timestamp: Date.now(),
            swarmStatus,
            levelStatus,
            totalTasks: allTasks.length,
            completedTasks: allTasks.filter(t => t.status === 'completed').length
          });
        } catch (error) {
          console.warn('Progress monitoring error:', error.message);
        }
      }, 1000);
      
      try {
        await swarmCoordinator.executeObjective(complexObjective.id);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        clearInterval(progressMonitor);
        
        // Validate hierarchical coordination
        const finalStatus = await swarmCoordinator.getSwarmStatus();
        const completedTasks = allTasks.filter(t => t.status === 'completed');
        const failedTasks = allTasks.filter(t => t.status === 'failed');
        
        // Verify completion rate
        const completionRate = completedTasks.length / allTasks.length;
        expect(completionRate).toBeGreaterThan(0.85); // 85% completion rate
        
        // Verify hierarchy was respected (dependencies)
        for (const task of completedTasks) {
          if (task.dependencies.length > 0) {
            const dependencies = allTasks.filter(t => task.dependencies.includes(t.id));
            const dependenciesCompleted = dependencies.every(dep => 
              dep.status === 'completed' && dep.completedAt! <= task.completedAt!
            );
            expect(dependenciesCompleted).toBe(true);
          }
        }
        
        // Verify level coordination efficiency
        const levelMetrics = hierarchy.map(level => {
          const levelTasks = allTasks.filter(t => t.assignToLevel === level.level);
          const levelCompleted = levelTasks.filter(t => t.status === 'completed');
          return {
            level: level.level,
            agentCount: level.agents.length,
            taskCount: levelTasks.length,
            completedCount: levelCompleted.length,
            efficiency: levelCompleted.length / levelTasks.length
          };
        });
        
        levelMetrics.forEach(metrics => {
          expect(metrics.efficiency).toBeGreaterThan(0.7); // 70% efficiency per level
        });
        
        console.log(`Hierarchical swarm coordination: ${totalAgents} agents, ${completedTasks.length}/${allTasks.length} tasks completed in ${duration}ms`);
        console.log(`Level efficiencies:`, levelMetrics.map(m => `L${m.level}: ${(m.efficiency * 100).toFixed(1)}%`).join(', '));
        
      } finally {
        clearInterval(progressMonitor);
      }
    });

    it('should handle dynamic agent scaling and load rebalancing', async () => {
      const initialAgents = 20;
      const maxAgents = 40;
      const taskWaves = 5;
      const tasksPerWave = 15;
      
      // Create initial agent pool
      const agentPool = Array.from({ length: initialAgents }, (_, i) => 
        swarmCoordinator.createAgent({
          id: `scalable-agent-${i}`,
          name: `Scalable Agent ${i}`,
          type: 'adaptive-worker',
          capabilities: ['dynamic-scaling', 'load-balancing', 'task-execution'],
          scalingGroup: 'primary'
        })
      );
      
      const scaleMetrics = [];
      const loadBalanceMetrics = [];
      
      // Execute task waves with dynamic scaling
      for (let wave = 0; wave < taskWaves; wave++) {
        const waveStartTime = Date.now();
        const waveTasks = [];
        
        // Create wave tasks with varying complexity
        for (let t = 0; t < tasksPerWave; t++) {
          const complexity = Math.floor(Math.random() * 3) + 1; // 1-3
          const task = swarmCoordinator.createTask({
            type: 'adaptive-work',
            description: `Wave ${wave} Task ${t} (complexity ${complexity})`,
            priority: Math.floor(Math.random() * 5) + 1,
            complexity,
            estimatedDuration: complexity * 200 + Math.random() * 300,
            requiredCapabilities: ['task-execution']
          });
          waveTasks.push(task);
        }
        
        // Check if scaling is needed
        const currentLoad = await swarmCoordinator.getLoadMetrics();
        const availableAgents = agentPool.filter(a => a.status === 'idle').length;
        const queuedTasks = waveTasks.length;
        
        if (queuedTasks > availableAgents * 1.5 && agentPool.length < maxAgents) {
          // Scale up agents
          const agentsToAdd = Math.min(
            Math.ceil(queuedTasks / 2) - availableAgents,
            maxAgents - agentPool.length
          );
          
          for (let a = 0; a < agentsToAdd; a++) {
            const newAgent = swarmCoordinator.createAgent({
              id: `scaled-agent-${agentPool.length + a}`,
              name: `Scaled Agent ${agentPool.length + a}`,
              type: 'scaled-worker',
              capabilities: ['dynamic-scaling', 'load-balancing', 'task-execution'],
              scalingGroup: 'scaled'
            });
            agentPool.push(newAgent);
          }
          
          scaleMetrics.push({
            wave,
            action: 'scale-up',
            agentsAdded: agentsToAdd,
            totalAgents: agentPool.length,
            queuedTasks,
            availableAgents
          });
        }
        
        // Execute wave tasks
        const wavePromises = waveTasks.map(task => 
          swarmCoordinator.executeTask(task.id)
            .then(result => ({ task, result, success: true }))
            .catch(error => ({ task, error, success: false }))
        );
        
        const waveResults = await Promise.all(wavePromises);
        const waveEndTime = Date.now();
        const waveDuration = waveEndTime - waveStartTime;
        
        // Analyze load balancing
        const agentWorkload = agentPool.map(agent => ({
          agentId: agent.id,
          tasksAssigned: waveResults.filter(r => r.task.assignedTo === agent.id).length,
          scalingGroup: agent.scalingGroup
        }));
        
        const workloadVariance = this.calculateVariance(
          agentWorkload.map(w => w.tasksAssigned)
        );
        
        loadBalanceMetrics.push({
          wave,
          agentCount: agentPool.length,
          tasksCompleted: waveResults.filter(r => r.success).length,
          tasksFailed: waveResults.filter(r => !r.success).length,
          workloadVariance,
          duration: waveDuration
        });
        
        // Scale down if overprovisioned
        if (wave > 1 && availableAgents > queuedTasks * 2 && agentPool.length > initialAgents) {
          const agentsToRemove = Math.min(
            Math.floor((availableAgents - queuedTasks) / 2),
            agentPool.length - initialAgents
          );
          
          const removedAgents = agentPool
            .filter(a => a.status === 'idle' && a.scalingGroup === 'scaled')
            .slice(0, agentsToRemove);
          
          for (const agent of removedAgents) {
            swarmCoordinator.removeAgent(agent.id);
            const index = agentPool.indexOf(agent);
            if (index > -1) agentPool.splice(index, 1);
          }
          
          if (removedAgents.length > 0) {
            scaleMetrics.push({
              wave,
              action: 'scale-down',
              agentsRemoved: removedAgents.length,
              totalAgents: agentPool.length,
              availableAgents: agentPool.filter(a => a.status === 'idle').length
            });
          }
        }
        
        // Brief pause between waves
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Validate scaling and load balancing effectiveness
      const totalScaleOps = scaleMetrics.length;
      const avgWorkloadVariance = loadBalanceMetrics.reduce((sum, m) => sum + m.workloadVariance, 0) / loadBalanceMetrics.length;
      const totalTasksCompleted = loadBalanceMetrics.reduce((sum, m) => sum + m.tasksCompleted, 0);
      const totalTasksFailed = loadBalanceMetrics.reduce((sum, m) => sum + m.tasksFailed, 0);
      const overallSuccessRate = totalTasksCompleted / (totalTasksCompleted + totalTasksFailed);
      
      // Validate scaling responsiveness
      expect(totalScaleOps).toBeGreaterThan(0); // Should have triggered scaling
      expect(agentPool.length).toBeGreaterThanOrEqual(initialAgents); // Should maintain minimum
      expect(agentPool.length).toBeLessThanOrEqual(maxAgents); // Should respect maximum
      
      // Validate load balancing efficiency
      expect(avgWorkloadVariance).toBeLessThan(2.0); // Good load distribution
      expect(overallSuccessRate).toBeGreaterThan(0.9); // 90% success rate
      
      console.log(`Dynamic scaling test: ${totalScaleOps} scaling operations, final agent count: ${agentPool.length}`);
      console.log(`Load balancing: avg variance ${avgWorkloadVariance.toFixed(2)}, success rate ${(overallSuccessRate * 100).toFixed(2)}%`);
      console.log(`Scaling events:`, scaleMetrics);
    });
    
    // Helper method for variance calculation
    calculateVariance(values: number[]): number {
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
      return squaredDiffs.reduce((sum, diff) => sum + diff, 0) / values.length;
    }
  });

  describe('Agent Communication and Message Passing', () => {
    it('should handle high-volume inter-agent communication', async () => {
      const communicatingAgents = 30;
      const messagesPerAgent = 20;
      const messageTypes = ['request', 'response', 'notification', 'status', 'data'];
      
      // Create communicating agents
      const agents = Array.from({ length: communicatingAgents }, (_, i) => 
        swarmCoordinator.createAgent({
          id: `comm-agent-${i}`,
          name: `Communication Agent ${i}`,
          type: 'communicator',
          capabilities: ['messaging', 'data-exchange', 'coordination'],
          messageBuffer: 50
        })
      );
      
      const messageLog: Array<{
        from: string;
        to: string;
        type: string;
        timestamp: number;
        delivered: boolean;
        processingTime?: number;
      }> = [];
      
      // Set up message handlers for each agent
      const messageHandlers = new Map();
      for (const agent of agents) {
        const handler = async (message: any) => {
          const processingStart = Date.now();
          
          // Simulate message processing
          await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
          
          const processingTime = Date.now() - processingStart;
          
          messageLog.push({
            from: message.from,
            to: agent.id,
            type: message.type,
            timestamp: message.timestamp,
            delivered: true,
            processingTime
          });
          
          // Send response for requests
          if (message.type === 'request') {
            await messageBus.publish(`agent:${message.from}`, {
              type: 'response',
              from: agent.id,
              to: message.from,
              originalMessage: message.id,
              response: `Response from ${agent.id}`,
              timestamp: Date.now()
            });
          }
        };
        
        await messageBus.subscribe(`agent:${agent.id}`, handler);
        messageHandlers.set(agent.id, handler);
      }
      
      // Generate high-volume inter-agent communication
      const communicationPromises = agents.map(async (sender, senderIndex) => {
        const sentMessages = [];
        
        for (let m = 0; m < messagesPerAgent; m++) {
          const messageType = messageTypes[Math.floor(Math.random() * messageTypes.length)];
          const receiverIndex = (senderIndex + Math.floor(Math.random() * (communicatingAgents - 1)) + 1) % communicatingAgents;
          const receiver = agents[receiverIndex];
          
          const message = {
            id: `msg-${sender.id}-${m}`,
            type: messageType,
            from: sender.id,
            to: receiver.id,
            content: `Message ${m} from ${sender.id} to ${receiver.id}`,
            timestamp: Date.now(),
            priority: Math.floor(Math.random() * 5) + 1
          };
          
          try {
            await messageBus.publish(`agent:${receiver.id}`, message);
            sentMessages.push(message);
            
            // Add small delay to prevent overwhelming
            await new Promise(resolve => setTimeout(resolve, Math.random() * 20 + 5));
          } catch (error) {
            messageLog.push({
              from: sender.id,
              to: receiver.id,
              type: messageType,
              timestamp: Date.now(),
              delivered: false
            });
          }
        }
        
        return { agentId: sender.id, sentMessages };
      });
      
      const communicationResults = await Promise.all(communicationPromises);
      
      // Wait for message processing to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Analyze communication effectiveness
      const totalMessagesSent = communicationResults.reduce((sum, result) => sum + result.sentMessages.length, 0);
      const totalMessagesDelivered = messageLog.filter(m => m.delivered).length;
      const deliveryRate = totalMessagesDelivered / totalMessagesSent;
      
      const avgProcessingTime = messageLog
        .filter(m => m.delivered && m.processingTime)
        .reduce((sum, m) => sum + m.processingTime!, 0) / messageLog.filter(m => m.delivered && m.processingTime).length;
      
      // Verify communication performance
      expect(deliveryRate).toBeGreaterThan(0.95); // 95% delivery rate
      expect(avgProcessingTime).toBeLessThan(100); // Under 100ms average processing
      
      // Verify message distribution
      const messagesByType = messageTypes.map(type => ({
        type,
        count: messageLog.filter(m => m.type === type).length
      }));
      
      // Should have relatively even distribution
      messagesByType.forEach(typeStats => {
        expect(typeStats.count).toBeGreaterThan(totalMessagesDelivered / messageTypes.length * 0.5);
      });
      
      // Verify request-response patterns
      const requests = messageLog.filter(m => m.type === 'request');
      const responses = messageLog.filter(m => m.type === 'response');
      const responseRate = responses.length / requests.length;
      
      expect(responseRate).toBeGreaterThan(0.8); // 80% of requests should get responses
      
      console.log(`Inter-agent communication: ${totalMessagesSent} sent, ${totalMessagesDelivered} delivered (${(deliveryRate * 100).toFixed(2)}%)`);
      console.log(`Average processing time: ${avgProcessingTime.toFixed(2)}ms`);
      console.log(`Request-response rate: ${(responseRate * 100).toFixed(2)}%`);
    });

    it('should maintain message ordering and consistency under load', async () => {
      const orderedAgents = 15;
      const sequenceLength = 30;
      const concurrentSequences = 5;
      
      // Create agents for ordered communication
      const agents = Array.from({ length: orderedAgents }, (_, i) => 
        swarmCoordinator.createAgent({
          id: `ordered-agent-${i}`,
          name: `Ordered Agent ${i}`,
          type: 'sequence-processor',
          capabilities: ['ordered-processing', 'sequence-validation'],
          sequenceState: new Map()
        })
      );
      
      const sequenceResults: Array<{
        sequenceId: string;
        expectedOrder: number[];
        receivedOrder: number[];
        completedCorrectly: boolean;
        totalMessages: number;
        processingTime: number;
      }> = [];
      
      // Set up ordered message processing
      for (const agent of agents) {
        await messageBus.subscribe(`ordered:${agent.id}`, async (message: any) => {
          const { sequenceId, sequenceNumber, totalInSequence } = message;
          
          if (!agent.sequenceState.has(sequenceId)) {
            agent.sequenceState.set(sequenceId, {
              received: [],
              expectedTotal: totalInSequence,
              startTime: Date.now()
            });
          }
          
          const sequence = agent.sequenceState.get(sequenceId);
          sequence.received.push(sequenceNumber);
          
          // Check if sequence is complete
          if (sequence.received.length === sequence.expectedTotal) {
            const endTime = Date.now();
            const processingTime = endTime - sequence.startTime;
            
            const expectedOrder = Array.from({ length: sequence.expectedTotal }, (_, i) => i);
            const receivedOrder = sequence.received.sort((a, b) => a - b);
            const completedCorrectly = JSON.stringify(expectedOrder) === JSON.stringify(receivedOrder);
            
            sequenceResults.push({
              sequenceId,
              expectedOrder,
              receivedOrder,
              completedCorrectly,
              totalMessages: sequence.received.length,
              processingTime
            });
          }
        });
      }
      
      // Generate ordered message sequences concurrently
      const sequencePromises = Array.from({ length: concurrentSequences }, async (_, seqIndex) => {
        const sequenceId = `sequence-${seqIndex}`;
        const targetAgent = agents[seqIndex % orderedAgents];
        
        const sequencePromises = Array.from({ length: sequenceLength }, async (_, msgIndex) => {
          // Add random delay to test ordering
          await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
          
          return messageBus.publish(`ordered:${targetAgent.id}`, {
            sequenceId,
            sequenceNumber: msgIndex,
            totalInSequence: sequenceLength,
            content: `Message ${msgIndex} in sequence ${sequenceId}`,
            timestamp: Date.now()
          });
        });
        
        await Promise.all(sequencePromises);
        return sequenceId;
      });
      
      await Promise.all(sequencePromises);
      
      // Wait for all sequences to complete processing
      await waitFor(
        () => sequenceResults.length === concurrentSequences,
        { timeout: 10000, interval: 100 }
      );
      
      // Validate message ordering and consistency
      const correctSequences = sequenceResults.filter(r => r.completedCorrectly);
      const orderingAccuracy = correctSequences.length / sequenceResults.length;
      
      expect(orderingAccuracy).toBeGreaterThan(0.9); // 90% ordering accuracy
      
      // Verify all messages were received
      sequenceResults.forEach(result => {
        expect(result.totalMessages).toBe(sequenceLength);
        expect(result.receivedOrder.length).toBe(sequenceLength);
      });
      
      // Verify processing performance
      const avgProcessingTime = sequenceResults.reduce((sum, r) => sum + r.processingTime, 0) / sequenceResults.length;
      expect(avgProcessingTime).toBeLessThan(5000); // Under 5 seconds per sequence
      
      console.log(`Message ordering test: ${correctSequences.length}/${sequenceResults.length} sequences completed correctly`);
      console.log(`Ordering accuracy: ${(orderingAccuracy * 100).toFixed(2)}%`);
      console.log(`Average sequence processing time: ${avgProcessingTime.toFixed(2)}ms`);
    });
  });

  describe('System Integrity and Recovery', () => {
    it('should maintain system integrity during partial failures', async () => {
      const totalAgents = 40;
      const failureRate = 0.25; // 25% of agents will fail
      const recoveryAgents = Math.floor(totalAgents * failureRate);
      
      // Create mixed agent pool
      const agents = Array.from({ length: totalAgents }, (_, i) => {
        const willFail = i < totalAgents * failureRate;
        return swarmCoordinator.createAgent({
          id: `integrity-agent-${i}`,
          name: `Integrity Agent ${i}`,
          type: willFail ? 'failure-prone' : 'reliable',
          capabilities: ['integrity-testing', 'failure-recovery'],
          failureProne: willFail,
          recoveryTarget: willFail
        });
      });
      
      // Create system integrity monitoring
      const integrityMetrics = {
        agentFailures: 0,
        taskFailures: 0,
        recoveryAttempts: 0,
        successfulRecoveries: 0,
        systemDowntime: 0
      };
      
      const monitoringInterval = setInterval(async () => {
        try {
          const systemHealth = await swarmCoordinator.getSystemHealth();
          if (!systemHealth.healthy) {
            integrityMetrics.systemDowntime += 500; // 500ms monitoring interval
          }
        } catch (error) {
          integrityMetrics.systemDowntime += 500;
        }
      }, 500);
      
      // Create integrity validation tasks
      const integrityTasks = Array.from({ length: 60 }, (_, i) => 
        swarmCoordinator.createTask({
          type: 'integrity-validation',
          description: `Integrity validation task ${i}`,
          priority: Math.floor(Math.random() * 5) + 1,
          requiredCapabilities: ['integrity-testing'],
          criticalTask: i % 10 === 0, // Every 10th task is critical
          retryOnFailure: true
        })
      );
      
      // Execute tasks with simulated failures
      const taskPromises = integrityTasks.map(async (task, index) => {
        try {
          const assignedAgent = agents[index % totalAgents];
          
          // Simulate agent failure
          if (assignedAgent.failureProne && Math.random() < 0.6) {
            integrityMetrics.agentFailures++;
            
            // Trigger recovery
            integrityMetrics.recoveryAttempts++;
            
            try {
              // Attempt agent recovery
              swarmCoordinator.updateAgentStatus(assignedAgent.id, 'failed');
              await new Promise(resolve => setTimeout(resolve, 200)); // Recovery time
              swarmCoordinator.updateAgentStatus(assignedAgent.id, 'idle');
              
              integrityMetrics.successfulRecoveries++;
              
              // Retry task on recovered agent
              const result = await swarmCoordinator.executeTask(task.id);
              return { task, result, recovered: true, success: true };
            } catch (recoveryError) {
              // Recovery failed, reassign task
              const backupAgent = agents.find(a => !a.failureProne && a.status === 'idle');
              if (backupAgent) {
                const result = await swarmCoordinator.executeTask(task.id);
                return { task, result, reassigned: true, success: true };
              } else {
                integrityMetrics.taskFailures++;
                return { task, success: false, reason: 'no-backup-available' };
              }
            }
          } else {
            // Normal execution
            const result = await swarmCoordinator.executeTask(task.id);
            return { task, result, success: true };
          }
        } catch (error) {
          integrityMetrics.taskFailures++;
          return { task, success: false, error: error.message };
        }
      });
      
      const taskResults = await Promise.allSettled(taskPromises);
      clearInterval(monitoringInterval);
      
      // Analyze system integrity
      const successfulTasks = taskResults.filter(r => 
        r.status === 'fulfilled' && r.value.success
      ).length;
      const failedTasks = taskResults.length - successfulTasks;
      const taskSuccessRate = successfulTasks / taskResults.length;
      
      const recoverySuccessRate = integrityMetrics.recoveryAttempts > 0 
        ? integrityMetrics.successfulRecoveries / integrityMetrics.recoveryAttempts 
        : 1;
      
      // Verify system integrity metrics
      expect(taskSuccessRate).toBeGreaterThan(0.75); // 75% task success despite failures
      expect(recoverySuccessRate).toBeGreaterThan(0.6); // 60% recovery success rate
      expect(integrityMetrics.systemDowntime).toBeLessThan(5000); // Less than 5 seconds downtime
      
      // Verify critical task handling
      const criticalTasks = integrityTasks.filter(t => t.criticalTask);
      const successfulCriticalTasks = taskResults
        .filter(r => r.status === 'fulfilled' && r.value.success && r.value.task.criticalTask)
        .length;
      const criticalTaskSuccessRate = successfulCriticalTasks / criticalTasks.length;
      
      expect(criticalTaskSuccessRate).toBeGreaterThan(0.85); // Higher success rate for critical tasks
      
      console.log(`System integrity test: ${successfulTasks}/${taskResults.length} tasks successful (${(taskSuccessRate * 100).toFixed(2)}%)`);
      console.log(`Agent failures: ${integrityMetrics.agentFailures}, Recovery rate: ${(recoverySuccessRate * 100).toFixed(2)}%`);
      console.log(`Critical task success rate: ${(criticalTaskSuccessRate * 100).toFixed(2)}%`);
      console.log(`System downtime: ${integrityMetrics.systemDowntime}ms`);
    });

    it('should validate data consistency across swarm operations', async () => {
      const dataValidationAgents = 25;
      const dataOperations = 100;
      const sharedDataSets = 5;
      
      // Create data validation agents
      const validationAgents = Array.from({ length: dataValidationAgents }, (_, i) => 
        swarmCoordinator.createAgent({
          id: `validator-${i}`,
          name: `Data Validator ${i}`,
          type: 'data-validator',
          capabilities: ['data-validation', 'consistency-checking', 'integrity-verification'],
          validationGroup: Math.floor(i / 5) // 5 agents per validation group
        })
      );
      
      // Initialize shared data sets
      const sharedData = Array.from({ length: sharedDataSets }, (_, i) => ({
        id: `dataset-${i}`,
        data: new Map(),
        version: 0,
        checksum: '',
        lastModified: Date.now()
      }));
      
      // Store initial data in memory
      for (const dataset of sharedData) {
        await memoryManager.storeEntry({
          id: dataset.id,
          agentId: 'system',
          sessionId: 'data-validation-session',
          type: 'shared-dataset',
          content: JSON.stringify({
            data: Array.from(dataset.data.entries()),
            version: dataset.version,
            checksum: dataset.checksum
          }),
          context: {
            datasetId: dataset.id,
            version: dataset.version,
            isSharedData: true
          },
          timestamp: new Date(),
          tags: ['shared-data', 'validation'],
          version: 1
        });
      }
      
      const validationResults: Array<{
        operation: string;
        datasetId: string;
        agentId: string;
        success: boolean;
        consistencyValid: boolean;
        timestamp: number;
      }> = [];
      
      // Execute concurrent data operations with validation
      const operationPromises = Array.from({ length: dataOperations }, async (_, opIndex) => {
        const agent = validationAgents[opIndex % dataValidationAgents];
        const dataset = sharedData[opIndex % sharedDataSets];
        const operation = ['read', 'write', 'update', 'validate'][Math.floor(Math.random() * 4)];
        
        try {
          let consistencyValid = true;
          
          switch (operation) {
            case 'read':
              // Read and validate data consistency
              const readEntry = await memoryManager.getEntry(dataset.id);
              if (readEntry) {
                const storedData = JSON.parse(readEntry.content);
                consistencyValid = storedData.version >= dataset.version;
              }
              break;
              
            case 'write':
              // Write new data with consistency check
              const writeKey = `op-${opIndex}-${Date.now()}`;
              const writeValue = `data-${opIndex}-${agent.id}`;
              
              // Lock dataset for writing
              const lockKey = `lock:${dataset.id}`;
              const lockAcquired = await stateManager.setState(lockKey, {
                lockedBy: agent.id,
                lockTime: Date.now(),
                operation: 'write'
              });
              
              if (lockAcquired) {
                try {
                  dataset.data.set(writeKey, writeValue);
                  dataset.version++;
                  dataset.lastModified = Date.now();
                  
                  await memoryManager.updateEntry(dataset.id, {
                    id: dataset.id,
                    agentId: agent.id,
                    sessionId: 'data-validation-session',
                    type: 'shared-dataset',
                    content: JSON.stringify({
                      data: Array.from(dataset.data.entries()),
                      version: dataset.version,
                      checksum: this.calculateChecksum(dataset.data)
                    }),
                    context: {
                      datasetId: dataset.id,
                      version: dataset.version,
                      lastModifiedBy: agent.id,
                      operation: 'write'
                    },
                    timestamp: new Date(),
                    tags: ['shared-data', 'validation'],
                    version: dataset.version
                  });
                } finally {
                  await stateManager.deleteState(lockKey);
                }
              } else {
                consistencyValid = false;
              }
              break;
              
            case 'update':
              // Update existing data with version check
              const updateEntry = await memoryManager.getEntry(dataset.id);
              if (updateEntry) {
                const currentData = JSON.parse(updateEntry.content);
                if (currentData.version === dataset.version) {
                  const updateKey = `update-${opIndex}`;
                  dataset.data.set(updateKey, `updated-by-${agent.id}`);
                  dataset.version++;
                  
                  await memoryManager.updateEntry(dataset.id, {
                    ...updateEntry,
                    content: JSON.stringify({
                      data: Array.from(dataset.data.entries()),
                      version: dataset.version,
                      checksum: this.calculateChecksum(dataset.data)
                    }),
                    context: {
                      ...updateEntry.context,
                      version: dataset.version,
                      lastModifiedBy: agent.id,
                      operation: 'update'
                    },
                    version: dataset.version
                  });
                } else {
                  consistencyValid = false;
                }
              }
              break;
              
            case 'validate':
              // Validate data integrity
              const validationEntry = await memoryManager.getEntry(dataset.id);
              if (validationEntry) {
                const validationData = JSON.parse(validationEntry.content);
                const expectedChecksum = this.calculateChecksum(new Map(validationData.data));
                consistencyValid = validationData.checksum === expectedChecksum;
              }
              break;
          }
          
          validationResults.push({
            operation,
            datasetId: dataset.id,
            agentId: agent.id,
            success: true,
            consistencyValid,
            timestamp: Date.now()
          });
          
          return { operation, dataset: dataset.id, agent: agent.id, success: true };
        } catch (error) {
          validationResults.push({
            operation,
            datasetId: dataset.id,
            agentId: agent.id,
            success: false,
            consistencyValid: false,
            timestamp: Date.now()
          });
          
          return { operation, dataset: dataset.id, agent: agent.id, success: false, error: error.message };
        }
      });
      
      const operationResults = await Promise.all(operationPromises);
      
      // Analyze data consistency
      const successfulOperations = validationResults.filter(r => r.success);
      const consistentOperations = validationResults.filter(r => r.consistencyValid);
      
      const operationSuccessRate = successfulOperations.length / validationResults.length;
      const consistencyRate = consistentOperations.length / validationResults.length;
      
      // Verify final data consistency
      const finalConsistencyChecks = [];
      for (const dataset of sharedData) {
        const finalEntry = await memoryManager.getEntry(dataset.id);
        if (finalEntry) {
          const finalData = JSON.parse(finalEntry.content);
          const calculatedChecksum = this.calculateChecksum(new Map(finalData.data));
          const isConsistent = finalData.checksum === calculatedChecksum;
          
          finalConsistencyChecks.push({
            datasetId: dataset.id,
            isConsistent,
            version: finalData.version,
            dataSize: finalData.data.length
          });
        }
      }
      
      const finalConsistencyRate = finalConsistencyChecks.filter(c => c.isConsistent).length / finalConsistencyChecks.length;
      
      // Validate data consistency requirements
      expect(operationSuccessRate).toBeGreaterThan(0.85); // 85% operation success
      expect(consistencyRate).toBeGreaterThan(0.80); // 80% consistency maintenance
      expect(finalConsistencyRate).toBeGreaterThan(0.90); // 90% final consistency
      
      console.log(`Data consistency test: ${successfulOperations.length}/${validationResults.length} operations successful`);
      console.log(`Consistency rate: ${(consistencyRate * 100).toFixed(2)}%`);
      console.log(`Final consistency: ${(finalConsistencyRate * 100).toFixed(2)}%`);
      console.log(`Data integrity maintained across ${dataValidationAgents} agents and ${sharedDataSets} datasets`);
    });
    
    // Helper method for checksum calculation
    calculateChecksum(dataMap: Map<string, string>): string {
      const sortedEntries = Array.from(dataMap.entries()).sort();
      const dataString = JSON.stringify(sortedEntries);
      // Simple checksum - in real implementation, use crypto.createHash
      return dataString.split('').reduce((hash, char) => {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        return hash & hash; // Convert to 32-bit integer
      }, 0).toString(16);
    }
  });
});
