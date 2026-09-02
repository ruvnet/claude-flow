#!/usr/bin/env node

/**
 * Swarm Load Testing for Claude Flow v2.0.0
 */

import { spawn } from 'child_process';
import chalk from 'chalk';
import { SystemIntegration } from '../dist/integration/system-integration.js';
import { SwarmCoordinator } from '../dist/coordination/swarm-coordinator.js';
import { AgentManager } from '../dist/agents/agent-manager.js';
import { TaskEngine } from '../dist/task/engine.js';

// Load test configuration
const LOAD_CONFIGS = {
  light: {
    swarms: 5,
    agentsPerSwarm: 8,
    tasksPerSwarm: 10,
    duration: 300000, // 5 minutes
    description: 'Light load test'
  },
  medium: {
    swarms: 15,
    agentsPerSwarm: 12,
    tasksPerSwarm: 20,
    duration: 600000, // 10 minutes
    description: 'Medium load test'
  },
  heavy: {
    swarms: 30,
    agentsPerSwarm: 20,
    tasksPerSwarm: 40,
    duration: 1200000, // 20 minutes
    description: 'Heavy load test'
  },
  extreme: {
    swarms: 50,
    agentsPerSwarm: 30,
    tasksPerSwarm: 60,
    duration: 1800000, // 30 minutes
    description: 'Extreme load test'
  }
};

class SwarmLoadTester {
  constructor(config) {
    this.config = config;
    this.systemIntegration = null;
    this.swarmCoordinator = null;
    this.agentManager = null;
    this.taskEngine = null;
    this.metrics = {
      startTime: 0,
      endTime: 0,
      swarmsCreated: 0,
      agentsSpawned: 0,
      tasksCreated: 0,
      errors: [],
      responseTimes: [],
      throughput: 0
    };
    this.activeSwarms = new Set();
    this.isRunning = false;
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}]`;
    
    switch (level) {
      case 'success':
        console.log(chalk.green(`${prefix} ✅ ${message}`));
        break;
      case 'error':
        console.log(chalk.red(`${prefix} ❌ ${message}`));
        break;
      case 'warning':
        console.log(chalk.yellow(`${prefix} ⚠️  ${message}`));
        break;
      case 'info':
      default:
        console.log(chalk.blue(`${prefix} ℹ️  ${message}`));
        break;
    }
  }

  async initialize() {
    this.log('Initializing system for load testing');
    
    try {
      this.systemIntegration = SystemIntegration.getInstance();
      await this.systemIntegration.initialize({
        logLevel: 'warn', // Reduce logging for performance
        environment: 'testing',
        monitoring: {
          enabled: false, // Disable monitoring during load test
          metrics: false,
          realTime: false
        }
      });

      this.swarmCoordinator = this.systemIntegration.getComponent('swarmCoordinator');
      this.agentManager = this.systemIntegration.getComponent('agentManager');
      this.taskEngine = this.systemIntegration.getComponent('taskEngine');

      this.log('System initialized successfully', 'success');
      
    } catch (error) {
      this.log(`Failed to initialize system: ${error.message}`, 'error');
      throw error;
    }
  }

  async runLoadTest() {
    this.log(`Starting ${this.config.description}`);
    this.log(`Configuration: ${this.config.swarms} swarms, ${this.config.agentsPerSwarm} agents/swarm, ${this.config.tasksPerSwarm} tasks/swarm`);
    
    this.metrics.startTime = Date.now();
    this.isRunning = true;

    try {
      // Phase 1: Create swarms
      await this.createSwarms();
      
      // Phase 2: Spawn agents
      await this.spawnAgents();
      
      // Phase 3: Create tasks
      await this.createTasks();
      
      // Phase 4: Run for duration
      await this.runForDuration();
      
      // Phase 5: Cleanup
      await this.cleanup();
      
      this.metrics.endTime = Date.now();
      this.generateReport();
      
    } catch (error) {
      this.log(`Load test failed: ${error.message}`, 'error');
      this.metrics.errors.push({
        message: error.message,
        timestamp: Date.now(),
        phase: 'main'
      });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async createSwarms() {
    this.log(`Phase 1: Creating ${this.config.swarms} swarms`);
    
    const startTime = Date.now();
    
    try {
      const swarmPromises = Array.from({ length: this.config.swarms }, (_, i) =>
        this.createSwarm(i)
      );
      
      const swarmIds = await Promise.all(swarmPromises);
      swarmIds.forEach(id => this.activeSwarms.add(id));
      
      this.metrics.swarmsCreated = swarmIds.length;
      const duration = Date.now() - startTime;
      
      this.log(`Created ${swarmIds.length} swarms in ${duration}ms`, 'success');
      
    } catch (error) {
      this.log(`Failed to create swarms: ${error.message}`, 'error');
      throw error;
    }
  }

  async createSwarm(index) {
    const swarmStartTime = Date.now();
    
    try {
      const swarmId = await this.swarmCoordinator.createSwarm({
        objective: `Load test swarm ${index}`,
        strategy: 'auto',
        topology: 'mesh',
        maxAgents: this.config.agentsPerSwarm
      });
      
      const duration = Date.now() - swarmStartTime;
      this.metrics.responseTimes.push(duration);
      
      return swarmId;
      
    } catch (error) {
      this.metrics.errors.push({
        message: error.message,
        timestamp: Date.now(),
        phase: 'swarm_creation',
        index
      });
      throw error;
    }
  }

  async spawnAgents() {
    this.log(`Phase 2: Spawning ${this.config.agentsPerSwarm} agents per swarm`);
    
    const startTime = Date.now();
    const swarmIds = Array.from(this.activeSwarms);
    
    try {
      const agentPromises = swarmIds.flatMap(swarmId =>
        Array.from({ length: this.config.agentsPerSwarm }, (_, i) =>
          this.spawnAgent(swarmId, i)
        )
      );
      
      const agents = await Promise.all(agentPromises);
      this.metrics.agentsSpawned = agents.length;
      
      const duration = Date.now() - startTime;
      this.log(`Spawned ${agents.length} agents in ${duration}ms`, 'success');
      
    } catch (error) {
      this.log(`Failed to spawn agents: ${error.message}`, 'error');
      throw error;
    }
  }

  async spawnAgent(swarmId, index) {
    const agentTypes = ['researcher', 'coder', 'analyst', 'tester', 'coordinator'];
    const agentType = agentTypes[index % agentTypes.length];
    
    const agentStartTime = Date.now();
    
    try {
      const agentId = await this.swarmCoordinator.spawnAgentInSwarm(swarmId, {
        type: agentType,
        name: `LoadAgent-${index}`,
        capabilities: ['general', 'load-testing']
      });
      
      const duration = Date.now() - agentStartTime;
      this.metrics.responseTimes.push(duration);
      
      return agentId;
      
    } catch (error) {
      this.metrics.errors.push({
        message: error.message,
        timestamp: Date.now(),
        phase: 'agent_spawning',
        swarmId,
        index
      });
      throw error;
    }
  }

  async createTasks() {
    this.log(`Phase 3: Creating ${this.config.tasksPerSwarm} tasks per swarm`);
    
    const startTime = Date.now();
    const swarmIds = Array.from(this.activeSwarms);
    
    try {
      const taskPromises = swarmIds.flatMap(swarmId =>
        Array.from({ length: this.config.tasksPerSwarm }, (_, i) =>
          this.createTask(swarmId, i)
        )
      );
      
      const tasks = await Promise.all(taskPromises);
      this.metrics.tasksCreated = tasks.length;
      
      const duration = Date.now() - startTime;
      this.log(`Created ${tasks.length} tasks in ${duration}ms`, 'success');
      
    } catch (error) {
      this.log(`Failed to create tasks: ${error.message}`, 'error');
      throw error;
    }
  }

  async createTask(swarmId, index) {
    const taskStartTime = Date.now();
    
    try {
      const taskId = await this.taskEngine.createTask({
        swarmId,
        type: 'development',
        objective: `Load test task ${index}`,
        priority: index % 3 === 0 ? 'high' : 'medium'
      });
      
      const duration = Date.now() - taskStartTime;
      this.metrics.responseTimes.push(duration);
      
      return taskId;
      
    } catch (error) {
      this.metrics.errors.push({
        message: error.message,
        timestamp: Date.now(),
        phase: 'task_creation',
        swarmId,
        index
      });
      throw error;
    }
  }

  async runForDuration() {
    this.log(`Phase 4: Running load test for ${this.config.duration / 1000}s`);
    
    const endTime = Date.now() + this.config.duration;
    const checkInterval = 10000; // Check every 10 seconds
    
    while (Date.now() < endTime && this.isRunning) {
      try {
        // Perform periodic operations to maintain load
        await this.performPeriodicOperations();
        
        // Report progress
        const elapsed = Date.now() - this.metrics.startTime;
        const remaining = endTime - Date.now();
        
        if (elapsed % 60000 < checkInterval) { // Report every minute
          this.log(`Load test progress: ${Math.floor(elapsed / 1000)}s elapsed, ${Math.floor(remaining / 1000)}s remaining`);
          await this.reportCurrentMetrics();
        }
        
        await new Promise(resolve => setTimeout(resolve, checkInterval));
        
      } catch (error) {
        this.log(`Error during load test execution: ${error.message}`, 'warning');
        this.metrics.errors.push({
          message: error.message,
          timestamp: Date.now(),
          phase: 'execution'
        });
      }
    }
    
    this.log('Load test duration completed', 'success');
  }

  async performPeriodicOperations() {
    // Perform random operations to maintain load
    const operations = [
      () => this.checkSwarmStatuses(),
      () => this.checkAgentStatuses(),
      () => this.checkTaskStatuses(),
      () => this.performHealthChecks()
    ];
    
    const randomOperation = operations[Math.floor(Math.random() * operations.length)];
    await randomOperation();
  }

  async checkSwarmStatuses() {
    const swarmIds = Array.from(this.activeSwarms);
    const randomSwarmId = swarmIds[Math.floor(Math.random() * swarmIds.length)];
    
    if (randomSwarmId) {
      const startTime = Date.now();
      await this.swarmCoordinator.getSwarmStatus(randomSwarmId);
      const duration = Date.now() - startTime;
      this.metrics.responseTimes.push(duration);
    }
  }

  async checkAgentStatuses() {
    const startTime = Date.now();
    await this.agentManager.listAgents();
    const duration = Date.now() - startTime;
    this.metrics.responseTimes.push(duration);
  }

  async checkTaskStatuses() {
    const swarmIds = Array.from(this.activeSwarms);
    const randomSwarmId = swarmIds[Math.floor(Math.random() * swarmIds.length)];
    
    if (randomSwarmId) {
      const startTime = Date.now();
      await this.taskEngine.getActiveTasks(randomSwarmId);
      const duration = Date.now() - startTime;
      this.metrics.responseTimes.push(duration);
    }
  }

  async performHealthChecks() {
    const startTime = Date.now();
    await this.systemIntegration.getSystemHealth();
    const duration = Date.now() - startTime;
    this.metrics.responseTimes.push(duration);
  }

  async reportCurrentMetrics() {
    try {
      const health = await this.systemIntegration.getSystemHealth();
      const avgResponseTime = this.metrics.responseTimes.length > 0
        ? this.metrics.responseTimes.reduce((sum, time) => sum + time, 0) / this.metrics.responseTimes.length
        : 0;
      
      this.log(`Current metrics: ${health.metrics.healthyComponents}/${health.metrics.totalComponents} components healthy, avg response: ${avgResponseTime.toFixed(2)}ms`);
      
    } catch (error) {
      this.log(`Failed to get current metrics: ${error.message}`, 'warning');
    }
  }

  async cleanup() {
    this.log('Phase 5: Cleaning up resources');
    
    try {
      // Shutdown system gracefully
      await this.systemIntegration.shutdown();
      this.log('Cleanup completed successfully', 'success');
      
    } catch (error) {
      this.log(`Cleanup failed: ${error.message}`, 'warning');
    }
  }

  generateReport() {
    const totalDuration = this.metrics.endTime - this.metrics.startTime;
    const avgResponseTime = this.metrics.responseTimes.length > 0
      ? this.metrics.responseTimes.reduce((sum, time) => sum + time, 0) / this.metrics.responseTimes.length
      : 0;
    const maxResponseTime = this.metrics.responseTimes.length > 0
      ? Math.max(...this.metrics.responseTimes)
      : 0;
    const minResponseTime = this.metrics.responseTimes.length > 0
      ? Math.min(...this.metrics.responseTimes)
      : 0;
    const totalOperations = this.metrics.swarmsCreated + this.metrics.agentsSpawned + this.metrics.tasksCreated;
    const throughput = totalOperations / (totalDuration / 1000);
    
    console.log('\n' + '='.repeat(80));
    console.log(chalk.bold.blue('🔥 SWARM LOAD TEST REPORT'));
    console.log('='.repeat(80));
    
    console.log(`\n📊 Test Configuration:`);
    console.log(`   Description: ${this.config.description}`);
    console.log(`   Swarms: ${this.config.swarms}`);
    console.log(`   Agents per Swarm: ${this.config.agentsPerSwarm}`);
    console.log(`   Tasks per Swarm: ${this.config.tasksPerSwarm}`);
    console.log(`   Duration: ${this.config.duration / 1000}s`);
    
    console.log(`\n⏱️  Execution Metrics:`);
    console.log(`   Total Duration: ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(`   Swarms Created: ${chalk.green(this.metrics.swarmsCreated)}`);
    console.log(`   Agents Spawned: ${chalk.green(this.metrics.agentsSpawned)}`);
    console.log(`   Tasks Created: ${chalk.green(this.metrics.tasksCreated)}`);
    console.log(`   Total Operations: ${chalk.cyan(totalOperations)}`);
    console.log(`   Throughput: ${chalk.yellow(throughput.toFixed(2))} ops/sec`);
    
    console.log(`\n🚀 Performance Metrics:`);
    console.log(`   Average Response Time: ${chalk.cyan(avgResponseTime.toFixed(2))}ms`);
    console.log(`   Min Response Time: ${chalk.green(minResponseTime.toFixed(2))}ms`);
    console.log(`   Max Response Time: ${chalk.yellow(maxResponseTime.toFixed(2))}ms`);
    console.log(`   Total Requests: ${chalk.blue(this.metrics.responseTimes.length)}`);
    
    if (this.metrics.errors.length > 0) {
      console.log(`\n❌ Errors (${this.metrics.errors.length}):`);
      const errorsByPhase = this.metrics.errors.reduce((acc, error) => {
        acc[error.phase] = (acc[error.phase] || 0) + 1;
        return acc;
      }, {});
      
      Object.entries(errorsByPhase).forEach(([phase, count]) => {
        console.log(`   ${phase}: ${chalk.red(count)} errors`);
      });
      
      const errorRate = (this.metrics.errors.length / totalOperations) * 100;
      console.log(`   Error Rate: ${chalk.red(errorRate.toFixed(2))}%`);
    } else {
      console.log(`\n✅ No errors detected!`);
    }
    
    // Performance assessment
    console.log(`\n📈 Performance Assessment:`);
    if (avgResponseTime < 100) {
      console.log(`   Response Time: ${chalk.green('EXCELLENT')} (< 100ms)`);
    } else if (avgResponseTime < 500) {
      console.log(`   Response Time: ${chalk.yellow('GOOD')} (100-500ms)`);
    } else if (avgResponseTime < 1000) {
      console.log(`   Response Time: ${chalk.yellow('ACCEPTABLE')} (500-1000ms)`);
    } else {
      console.log(`   Response Time: ${chalk.red('POOR')} (> 1000ms)`);
    }
    
    if (throughput > 50) {
      console.log(`   Throughput: ${chalk.green('EXCELLENT')} (> 50 ops/sec)`);
    } else if (throughput > 20) {
      console.log(`   Throughput: ${chalk.yellow('GOOD')} (20-50 ops/sec)`);
    } else if (throughput > 10) {
      console.log(`   Throughput: ${chalk.yellow('ACCEPTABLE')} (10-20 ops/sec)`);
    } else {
      console.log(`   Throughput: ${chalk.red('POOR')} (< 10 ops/sec)`);
    }
    
    const errorRate = (this.metrics.errors.length / totalOperations) * 100;
    if (errorRate === 0) {
      console.log(`   Reliability: ${chalk.green('EXCELLENT')} (0% errors)`);
    } else if (errorRate < 1) {
      console.log(`   Reliability: ${chalk.yellow('GOOD')} (< 1% errors)`);
    } else if (errorRate < 5) {
      console.log(`   Reliability: ${chalk.yellow('ACCEPTABLE')} (1-5% errors)`);
    } else {
      console.log(`   Reliability: ${chalk.red('POOR')} (> 5% errors)`);
    }
    
    console.log('\n' + '='.repeat(80));
    
    // Save detailed report to file
    const reportData = {
      config: this.config,
      metrics: this.metrics,
      summary: {
        totalDuration,
        avgResponseTime,
        maxResponseTime,
        minResponseTime,
        totalOperations,
        throughput,
        errorRate
      },
      timestamp: new Date().toISOString()
    };
    
    return reportData;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const configName = args[0] || 'light';
  
  if (!LOAD_CONFIGS[configName]) {
    console.error(chalk.red(`Unknown load config: ${configName}`));
    console.log(chalk.blue('Available configs:'));
    Object.entries(LOAD_CONFIGS).forEach(([name, config]) => {
      console.log(`  ${name}: ${config.description}`);
    });
    process.exit(1);
  }
  
  const config = LOAD_CONFIGS[configName];
  const tester = new SwarmLoadTester(config);
  
  try {
    await tester.initialize();
    await tester.runLoadTest();
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('Load test failed:'), error.message);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log(chalk.yellow('\nReceived SIGINT, shutting down gracefully...'));
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(chalk.yellow('\nReceived SIGTERM, shutting down gracefully...'));
  process.exit(0);
});

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}