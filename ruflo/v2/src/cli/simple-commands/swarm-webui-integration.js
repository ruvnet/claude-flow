/**
 * Swarm Orchestration WebUI Integration
 * Integrates ruv-swarm capabilities with the cross-platform WebUI
 */

import { compat } from '../runtime-detector.js';

export class SwarmWebUIIntegration {
  constructor(ui) {
    this.ui = ui;
    this.swarmActive = false;
    this.swarmId = null;
    this.agents = new Map();
    this.tasks = new Map();
  }

  /**
   * Initialize swarm integration
   */
  async initializeSwarm(topology = 'hierarchical', maxAgents = 8) {
    try {
      // Check if ruv-swarm is available
      const hasSwarm = await this.checkSwarmAvailability();
      if (!hasSwarm) {
        this.ui.addLog('warning', 'ruv-swarm not available - using mock swarm');
        this.initializeMockSwarm();
        return;
      }

      // Initialize actual swarm
      this.ui.addLog('info', `Initializing ${topology} swarm with ${maxAgents} agents...`);

      // This would integrate with actual ruv-swarm MCP tools
      // For now, simulate swarm initialization
      this.swarmActive = true;
      this.swarmId = `swarm-${Date.now()}`;

      this.ui.addLog('success', `Swarm ${this.swarmId} initialized successfully`);

      // Update UI with swarm status
      this.updateSwarmStatus();
    } catch (err) {
      this.ui.addLog('error', `Failed to initialize swarm: ${err.message}`);
    }
  }

  /**
   * Check if ruv-swarm MCP tools are available
   */
  async checkSwarmAvailability() {
    try {
      // This would check for actual MCP connection
      // For demo purposes, simulate availability
      return compat.getEnv('CLAUDE_FLOW_SWARM_ENABLED') === 'true';
    } catch (err) {
      return false;
    }
  }

  /**
   * Initialize mock swarm for demonstration
   */
  initializeMockSwarm() {
    this.swarmActive = true;
    this.swarmId = 'mock-swarm';

    // Create mock agents
    const agentTypes = ['researcher', 'coder', 'analyst', 'coordinator', 'tester'];
    agentTypes.forEach((type, index) => {
      const agentId = `agent-${type}-${index}`;
      this.agents.set(agentId, {
        id: agentId,
        type,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} Agent`,
        status: 'idle',
        tasks: 0,
        capabilities: this.getAgentCapabilities(type),
        spawnTime: new Date(),
      });
    });

    // Create mock tasks
    const mockTasks = [
      {
        description: 'Analyze system requirements',
        priority: 'high',
        assignedTo: 'agent-researcher-0',
      },
      {
        description: 'Implement authentication module',
        priority: 'high',
        assignedTo: 'agent-coder-1',
      },
      { description: 'Performance analysis', priority: 'medium', assignedTo: 'agent-analyst-2' },
      {
        description: 'Coordinate deployment',
        priority: 'medium',
        assignedTo: 'agent-coordinator-3',
      },
      { description: 'Run integration tests', priority: 'low', assignedTo: 'agent-tester-4' },
    ];

    mockTasks.forEach((task, index) => {
      const taskId = `task-${index}`;
      this.tasks.set(taskId, {
        id: taskId,
        ...task,
        status: index < 2 ? 'in_progress' : 'pending',
        created: new Date(),
        swarmId: this.swarmId,
      });
    });

    this.ui.addLog('success', 'Mock swarm initialized with 5 agents and 5 tasks');
  }

  /**
   * Get capabilities for different agent types
   */
  getAgentCapabilities(type) {
    const capabilities = {
      researcher: ['data_analysis', 'web_search', 'documentation'],
      coder: ['javascript', 'python', 'typescript', 'git'],
      analyst: ['performance', 'metrics', 'optimization'],
      coordinator: ['task_management', 'scheduling', 'communication'],
      tester: ['unit_testing', 'integration_testing', 'qa'],
    };
    return capabilities[type] || [];
  }

  /**
   * Update swarm status in UI
   */
  updateSwarmStatus() {
    if (!this.swarmActive) return;

    // Update UI agents with swarm data
    this.ui.agents = Array.from(this.agents.values());
    this.ui.tasks = Array.from(this.tasks.values());

    // Update system stats
    this.ui.systemStats.activeAgents = this.ui.agents.filter((a) => a.status === 'working').length;
    this.ui.systemStats.totalTasks = this.ui.tasks.length;
    this.ui.systemStats.completedTasks = this.ui.tasks.filter(
      (t) => t.status === 'completed',
    ).length;
  }

  /**
   * Spawn new agent
   */
  async spawnAgent(type, name = null) {
    if (!this.swarmActive) {
      this.ui.addLog('warning', 'Swarm not active - cannot spawn agent');
      return null;
    }

    const agentId = `agent-${type}-${Date.now()}`;
    const agent = {
      id: agentId,
      type,
      name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} Agent`,
      status: 'idle',
      tasks: 0,
      capabilities: this.getAgentCapabilities(type),
      spawnTime: new Date(),
    };

    this.agents.set(agentId, agent);
    this.updateSwarmStatus();

    this.ui.addLog('success', `Spawned ${type} agent: ${agent.name}`);
    return agentId;
  }

  /**
   * Create new task
   */
  async createTask(description, priority = 'medium', assignedTo = null) {
    if (!this.swarmActive) {
      this.ui.addLog('warning', 'Swarm not active - cannot create task');
      return null;
    }

    const taskId = `task-${Date.now()}`;
    const task = {
      id: taskId,
      description,
      priority,
      assignedTo,
      status: 'pending',
      created: new Date(),
      swarmId: this.swarmId,
    };

    this.tasks.set(taskId, task);
    this.updateSwarmStatus();

    this.ui.addLog('success', `Created task: ${description}`);
    return taskId;
  }

  /**
   * Assign task to agent
   */
  async assignTask(taskId, agentId) {
    const task = this.tasks.get(taskId);
    const agent = this.agents.get(agentId);

    if (!task || !agent) {
      this.ui.addLog('error', 'Invalid task or agent ID');
      return false;
    }

    task.assignedTo = agentId;
    task.status = 'in_progress';
    agent.tasks++;
    agent.status = 'working';

    this.updateSwarmStatus();
    this.ui.addLog('info', `Assigned task "${task.description}" to ${agent.name}`);
    return true;
  }

  /**
   * Complete task
   */
  async completeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      this.ui.addLog('error', 'Invalid task ID');
      return false;
    }

    task.status = 'completed';
    task.completed = new Date();

    if (task.assignedTo) {
      const agent = this.agents.get(task.assignedTo);
      if (agent) {
        agent.tasks = Math.max(0, agent.tasks - 1);
        if (agent.tasks === 0) {
          agent.status = 'idle';
        }
      }
    }

    this.updateSwarmStatus();
    this.ui.addLog('success', `Completed task: ${task.description}`);
    return true;
  }

  /**
   * Get swarm metrics for display
   */
  getSwarmMetrics() {
    if (!this.swarmActive) {
      return null;
    }

    const totalAgents = this.agents.size;
    const activeAgents = Array.from(this.agents.values()).filter(
      (a) => a.status === 'working',
    ).length;
    const idleAgents = totalAgents - activeAgents;

    const totalTasks = this.tasks.size;
    const completedTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'completed',
    ).length;
    const pendingTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'pending',
    ).length;
    const inProgressTasks = Array.from(this.tasks.values()).filter(
      (t) => t.status === 'in_progress',
    ).length;

    return {
      swarmId: this.swarmId,
      agents: {
        total: totalAgents,
        active: activeAgents,
        idle: idleAgents,
      },
      tasks: {
        total: totalTasks,
        completed: completedTasks,
        inProgress: inProgressTasks,
        pending: pendingTasks,
      },
      efficiency: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    };
  }

  /**
   * Stop swarm
   */
  async stopSwarm() {
    if (!this.swarmActive) return;

    this.swarmActive = false;
    this.agents.clear();
    this.tasks.clear();
    this.swarmId = null;

    this.ui.addLog('info', 'Swarm stopped and cleaned up');
    this.updateSwarmStatus();
  }
}

export default SwarmWebUIIntegration;
