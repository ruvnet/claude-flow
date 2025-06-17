/**
 * Comprehensive Agent management commands - Simplified version
 */

import { AgentManager } from '../../agents/agent-manager.js';
import { AgentRegistry } from '../../agents/agent-registry.js';
import { DistributedMemorySystem } from '../../memory/distributed-memory.js';
import { EventBus } from '../../core/event-bus.js';
import { Logger } from '../../core/logger.js';

// Global instances
let agentManager: AgentManager | null = null;
let agentRegistry: AgentRegistry | null = null;

// Initialize agent management system
async function initializeAgentSystem(): Promise<{ manager: AgentManager; registry: AgentRegistry }> {
  if (agentManager && agentRegistry) {
    return { manager: agentManager, registry: agentRegistry };
  }
  
  try {
    const logger = new Logger({ 
      level: 'info',
      format: 'text',
      destination: 'console'
    });
    
    const eventBus = EventBus.getInstance();
    
    const memorySystem = new DistributedMemorySystem({
      backend: 'markdown',
      path: './memory'
    });
    
    await memorySystem.initialize();
    
    agentRegistry = new AgentRegistry(memorySystem, 'agents');
    await agentRegistry.initialize();
    
    agentManager = new AgentManager(
      {
        maxAgents: 50,
        defaultTimeout: 60000,
        heartbeatInterval: 15000,
        healthCheckInterval: 30000,
        autoRestart: true,
        resourceLimits: {
          memory: 1024 * 1024 * 1024, // 1GB
          cpu: 2.0,
          disk: 2 * 1024 * 1024 * 1024 // 2GB
        }
      },
      logger,
      eventBus,
      memorySystem
    );
    
    await agentManager.initialize();
    
    return { manager: agentManager, registry: agentRegistry };
  } catch (error) {
    throw new Error(`Failed to initialize agent system: ${error.message}`);
  }
}

// Agent Management Commands
export const agentCommands = {
  async spawn(args: string[], options: Record<string, any> = {}): Promise<void> {
    try {
      const { manager } = await initializeAgentSystem();
      
      const templateName = args[0] || 'researcher';
      const name = options.name || `${templateName}-${Date.now().toString(36)}`;
      
      console.log(`🚀 Creating agent with template: ${templateName}`);
      
      const agentId = await manager.createAgent(templateName, {
        name,
        config: {
          autonomyLevel: options.autonomy || 0.7,
          maxConcurrentTasks: options.maxTasks || 5,
          timeoutThreshold: options.timeout || 300000
        }
      });
      
      if (options.start !== false) {
        console.log('⚡ Starting agent...');
        await manager.startAgent(agentId);
      }
      
      console.log('✅ Agent created successfully!');
      console.log(`   ID: ${agentId}`);
      console.log(`   Name: ${name}`);
      console.log(`   Template: ${templateName}`);
      
    } catch (error) {
      console.error('❌ Error creating agent:', error.message);
    }
  },

  async list(args: string[], options: Record<string, any> = {}): Promise<void> {
    try {
      const { manager } = await initializeAgentSystem();
      
      let agents = manager.getAllAgents();
      
      // Apply filters
      if (options.type) {
        agents = agents.filter(agent => agent.type === options.type);
      }
      
      if (options.status) {
        agents = agents.filter(agent => agent.status === options.status);
      }
      
      if (options.unhealthy) {
        agents = agents.filter(agent => agent.health < 0.7);
      }
      
      if (agents.length === 0) {
        console.log('📋 No agents found matching the criteria');
        return;
      }
      
      console.log(`🤖 Agent List (${agents.length} agents)`);
      console.log('=' .repeat(60));
      
      for (const agent of agents) {
        const healthEmoji = agent.health > 0.8 ? '🟢' : agent.health > 0.5 ? '🟡' : '🔴';
        const statusEmoji = agent.status === 'idle' ? '⭕' : 
                          agent.status === 'busy' ? '🔵' : 
                          agent.status === 'error' ? '🔴' : '⚪';
        
        console.log(`${healthEmoji} ${agent.name}`);
        console.log(`   ID: ${agent.id.id.slice(-8)}`);
        console.log(`   Type: ${agent.type}`);
        console.log(`   Status: ${statusEmoji} ${agent.status.toUpperCase()}`);
        console.log(`   Health: ${Math.round(agent.health * 100)}%`);
        console.log(`   Workload: ${agent.workload} tasks`);
        
        if (options.detailed) {
          console.log(`   Tasks Completed: ${agent.metrics.tasksCompleted}`);
          console.log(`   Success Rate: ${Math.round(agent.metrics.successRate * 100)}%`);
          console.log(`   Memory: ${Math.round(agent.metrics.memoryUsage / 1024 / 1024)}MB`);
        }
        
        console.log('');
      }
      
      // System stats
      const stats = manager.getSystemStats();
      console.log('📊 System Overview:');
      console.log(`   Total: ${stats.totalAgents} | Active: ${stats.activeAgents} | Healthy: ${stats.healthyAgents}`);
      console.log(`   Average Health: ${Math.round(stats.averageHealth * 100)}%`);
      
    } catch (error) {
      console.error('❌ Error listing agents:', error.message);
    }
  },

  async info(args: string[], options: Record<string, any> = {}): Promise<void> {
    try {
      const { manager } = await initializeAgentSystem();
      
      const agentId = args[0];
      if (!agentId) {
        console.error('❌ Agent ID is required');
        console.log('Usage: agent info <agent-id>');
        return;
      }
      
      const agent = manager.getAgent(agentId);
      if (!agent) {
        console.error(`❌ Agent '${agentId}' not found`);
        
        // Suggest similar agents
        const allAgents = manager.getAllAgents();
        const similar = allAgents.filter(a => 
          a.id.id.includes(agentId) || 
          a.name.toLowerCase().includes(agentId.toLowerCase())
        );
        
        if (similar.length > 0) {
          console.log('\\nDid you mean one of these agents?');
          similar.forEach(a => console.log(`  ${a.id.id} - ${a.name}`));
        }
        return;
      }
      
      console.log(`🤖 Agent Information: ${agent.name}`);
      console.log('=' .repeat(50));
      
      // Basic info
      console.log(`ID: ${agent.id.id}`);
      console.log(`Name: ${agent.name}`);
      console.log(`Type: ${agent.type}`);
      console.log(`Status: ${agent.status.toUpperCase()}`);
      console.log(`Health: ${Math.round(agent.health * 100)}%`);
      console.log(`Workload: ${agent.workload} active tasks`);
      
      // Configuration
      console.log('\\n⚙️ Configuration:');
      console.log(`  Autonomy Level: ${agent.config.autonomyLevel}`);
      console.log(`  Max Concurrent Tasks: ${agent.config.maxConcurrentTasks}`);
      console.log(`  Timeout Threshold: ${agent.config.timeoutThreshold}ms`);
      console.log(`  Runtime: ${agent.environment.runtime}`);
      
      // Metrics
      console.log('\\n📊 Performance Metrics:');
      console.log(`  Tasks Completed: ${agent.metrics.tasksCompleted}`);
      console.log(`  Tasks Failed: ${agent.metrics.tasksFailed}`);
      console.log(`  Success Rate: ${Math.round(agent.metrics.successRate * 100)}%`);
      console.log(`  Average Execution Time: ${agent.metrics.averageExecutionTime}ms`);
      console.log(`  Memory Usage: ${Math.round(agent.metrics.memoryUsage / 1024 / 1024)}MB`);
      console.log(`  CPU Usage: ${Math.round(agent.metrics.cpuUsage * 100)}%`);
      
      // Health details
      const health = manager.getAgentHealth(agentId);
      if (health) {
        console.log('\\n🏥 Health Details:');
        console.log(`  Responsiveness: ${Math.round(health.components.responsiveness * 100)}%`);
        console.log(`  Performance: ${Math.round(health.components.performance * 100)}%`);
        console.log(`  Reliability: ${Math.round(health.components.reliability * 100)}%`);
        console.log(`  Resource Usage: ${Math.round(health.components.resourceUsage * 100)}%`);
        
        if (health.issues.length > 0) {
          console.log('\\n⚠️ Active Issues:');
          health.issues.forEach((issue, index) => {
            console.log(`  ${index + 1}. [${issue.severity.toUpperCase()}] ${issue.message}`);
          });
        }
      }
      
      // Capabilities
      console.log('\\n🛠️ Capabilities:');
      console.log(`  Code Generation: ${agent.capabilities.codeGeneration ? '✅' : '❌'}`);
      console.log(`  Code Review: ${agent.capabilities.codeReview ? '✅' : '❌'}`);
      console.log(`  Testing: ${agent.capabilities.testing ? '✅' : '❌'}`);
      console.log(`  Research: ${agent.capabilities.research ? '✅' : '❌'}`);
      console.log(`  Web Search: ${agent.capabilities.webSearch ? '✅' : '❌'}`);
      
      if (agent.capabilities.languages.length > 0) {
        console.log(`  Languages: ${agent.capabilities.languages.join(', ')}`);
      }
      
      if (agent.capabilities.frameworks.length > 0) {
        console.log(`  Frameworks: ${agent.capabilities.frameworks.join(', ')}`);
      }
      
    } catch (error) {
      console.error('❌ Error getting agent info:', error.message);
    }
  },

  async terminate(args: string[], options: Record<string, any> = {}): Promise<void> {
    try {
      const { manager } = await initializeAgentSystem();
      
      const agentId = args[0];
      if (!agentId) {
        console.error('❌ Agent ID is required');
        console.log('Usage: agent terminate <agent-id>');
        return;
      }
      
      const agent = manager.getAgent(agentId);
      if (!agent) {
        console.error(`❌ Agent '${agentId}' not found`);
        return;
      }
      
      console.log(`🛑 Terminating agent: ${agent.name} (${agentId})`);
      
      const reason = options.reason || 'user_request';
      
      // Graceful or force termination
      if (options.force) {
        console.log('⚡ Force terminating agent...');
      } else {
        console.log('🔄 Gracefully shutting down agent...');
      }
      
      await manager.stopAgent(agentId, reason);
      
      if (options.cleanup) {
        console.log('🧹 Cleaning up agent data...');
        await manager.removeAgent(agentId);
      }
      
      console.log('✅ Agent terminated successfully');
      
      // Show final stats
      if (agent.metrics) {
        console.log('\\n📈 Final Statistics:');
        console.log(`  Tasks Completed: ${agent.metrics.tasksCompleted}`);
        console.log(`  Success Rate: ${Math.round(agent.metrics.successRate * 100)}%`);
        console.log(`  Total Uptime: ${Math.round(agent.metrics.totalUptime / 1000)}s`);
      }
      
    } catch (error) {
      console.error('❌ Error terminating agent:', error.message);
    }
  },

  async start(args: string[], options: Record<string, any> = {}): Promise<void> {
    try {
      const { manager } = await initializeAgentSystem();
      
      const agentId = args[0];
      if (!agentId) {
        console.error('❌ Agent ID is required');
        console.log('Usage: agent start <agent-id>');
        return;
      }
      
      console.log(`🚀 Starting agent ${agentId}...`);
      await manager.startAgent(agentId);
      console.log('✅ Agent started successfully');
      
    } catch (error) {
      console.error('❌ Error starting agent:', error.message);
    }
  },

  async restart(args: string[], options: Record<string, any> = {}): Promise<void> {
    try {
      const { manager } = await initializeAgentSystem();
      
      const agentId = args[0];
      if (!agentId) {
        console.error('❌ Agent ID is required');
        console.log('Usage: agent restart <agent-id>');
        return;
      }
      
      console.log(`🔄 Restarting agent ${agentId}...`);
      const reason = options.reason || 'manual_restart';
      await manager.restartAgent(agentId, reason);
      console.log('✅ Agent restarted successfully');
      
    } catch (error) {
      console.error('❌ Error restarting agent:', error.message);
    }
  },

  async health(args: string[], options: Record<string, any> = {}): Promise<void> {
    try {
      const { manager } = await initializeAgentSystem();
      
      const agents = manager.getAllAgents();
      const stats = manager.getSystemStats();
      const threshold = options.threshold || 0.7;
      
      console.log('🏥 Agent Health Dashboard');
      console.log('=' .repeat(50));
      console.log(`Time: ${new Date().toLocaleString()}`);
      console.log(`Total Agents: ${stats.totalAgents} | Active: ${stats.activeAgents} | Healthy: ${stats.healthyAgents}`);
      console.log(`Average Health: ${Math.round(stats.averageHealth * 100)}%`);
      
      const unhealthyAgents = agents.filter(a => a.health < threshold);
      if (unhealthyAgents.length > 0) {
        console.log(`\\n⚠️ ${unhealthyAgents.length} agents below health threshold (${Math.round(threshold * 100)}%):`);
        unhealthyAgents.forEach(agent => {
          const healthPercent = Math.round(agent.health * 100);
          console.log(`  🔴 ${agent.name}: ${healthPercent}% (${agent.status})`);
        });
      } else {
        console.log('\\n✅ All agents are healthy!');
      }
      
      // Resource utilization
      console.log('\\n💻 Resource Utilization:');
      console.log(`  CPU: ${Math.round(stats.resourceUtilization.cpu * 100)}%`);
      console.log(`  Memory: ${Math.round(stats.resourceUtilization.memory / 1024 / 1024)}MB`);
      console.log(`  Disk: ${Math.round(stats.resourceUtilization.disk / 1024 / 1024)}MB`);
      
    } catch (error) {
      console.error('❌ Error getting health status:', error.message);
    }
  },

  async help(): Promise<void> {
    console.log('🤖 Agent Management Commands:');
    console.log('');
    console.log('Available commands:');
    console.log('  spawn <template>     - Create and start new agents');
    console.log('  list                 - Display all agents with status');
    console.log('  info <agent-id>      - Get detailed agent information');
    console.log('  terminate <agent-id> - Safely terminate agents');
    console.log('  start <agent-id>     - Start a created agent');
    console.log('  restart <agent-id>   - Restart an agent');
    console.log('  health               - Monitor agent health');
    console.log('');
    console.log('Common options:');
    console.log('  --type <type>        - Filter by agent type');
    console.log('  --status <status>    - Filter by agent status');
    console.log('  --detailed           - Show detailed information');
    console.log('  --force              - Force operation');
    console.log('  --cleanup            - Clean up data after operation');
    console.log('');
    console.log('Examples:');
    console.log('  agent spawn researcher --name "research-bot"');
    console.log('  agent list --type researcher --detailed');
    console.log('  agent info agent-123');
    console.log('  agent terminate agent-123 --cleanup');
    console.log('  agent health --threshold 0.8');
  }
};

// Export individual command functions for use in CLI
export const {
  spawn: spawnAgent,
  list: listAgents,
  info: agentInfo,
  terminate: terminateAgent,
  start: startAgent,
  restart: restartAgent,
  health: agentHealth
} = agentCommands;