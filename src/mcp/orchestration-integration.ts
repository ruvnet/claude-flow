/**
 * MCP Integration with Claude-Flow Orchestration System
 * Provides seamless integration between MCP servers and the broader orchestration components
 */

import { EventEmitter } from 'node:events';
import { ILogger } from '../core/logger.js';
import { MCPConfig, MCPSession, MCPTool, SystemEvents } from '../utils/types.js';
import { MCPError } from '../utils/errors.js';
import { MCPServer, IMCPServer } from './server.js';
import { MCPLifecycleManager, LifecycleState } from './lifecycle-manager.js';
import { MCPPerformanceMonitor } from './performance-monitor.js';
import { MCPProtocolManager } from './protocol-manager.js';

export interface OrchestrationComponents {
  orchestrator?: any;
  swarmCoordinator?: any;
  agentManager?: any;
  resourceManager?: any;
  memoryManager?: any;
  messageBus?: any;
  monitor?: any;
  eventBus?: any;
  terminalManager?: any;
}

export interface MCPOrchestrationConfig {
  enabledIntegrations: {
    orchestrator: boolean;
    swarm: boolean;
    agents: boolean;
    resources: boolean;
    memory: boolean;
    monitoring: boolean;
    terminals: boolean;
  };
  autoStart: boolean;
  healthCheckInterval: number;
  reconnectAttempts: number;
  reconnectDelay: number;
  enableMetrics: boolean;
  enableAlerts: boolean;
}

export interface IntegrationStatus {
  component: string;
  enabled: boolean;
  connected: boolean;
  healthy: boolean;
  lastCheck: Date;
  error?: string;
  metrics?: Record<string, number>;
}

/**
 * MCP Orchestration Integration Manager
 * Manages the integration between MCP servers and orchestration components
 */
export class MCPOrchestrationIntegration extends EventEmitter {
  private server?: IMCPServer;
  private lifecycleManager?: MCPLifecycleManager;
  private performanceMonitor?: MCPPerformanceMonitor;
  private protocolManager?: MCPProtocolManager;
  
  private integrationStatus = new Map<string, IntegrationStatus>();
  private healthCheckTimer?: NodeJS.Timeout;
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  
  private readonly defaultConfig: MCPOrchestrationConfig = {
    enabledIntegrations: {
      orchestrator: true,
      swarm: true,
      agents: true,
      resources: true,
      memory: true,
      monitoring: true,
      terminals: true,
    },
    autoStart: true,
    healthCheckInterval: 30000, // 30 seconds
    reconnectAttempts: 3,
    reconnectDelay: 5000, // 5 seconds
    enableMetrics: true,
    enableAlerts: true,
  };

  constructor(
    private mcpConfig: MCPConfig,
    private orchestrationConfig: MCPOrchestrationConfig,
    private components: OrchestrationComponents,
    private logger: ILogger,
  ) {
    super();
    
    this.orchestrationConfig = { ...this.defaultConfig, ...orchestrationConfig };
    this.initializeIntegration();
  }

  /**
   * Start the MCP orchestration integration
   */
  async start(): Promise<void> {
    this.logger.info('Starting MCP orchestration integration');

    try {
      // Initialize protocol manager
      this.protocolManager = new MCPProtocolManager(this.logger);

      // Initialize performance monitor
      if (this.orchestrationConfig.enableMetrics) {
        this.performanceMonitor = new MCPPerformanceMonitor(this.logger);
        this.setupPerformanceMonitoring();
      }

      // Create MCP server
      this.server = new MCPServer(
        this.mcpConfig,
        this.components.eventBus || new EventEmitter(),
        this.logger,
        this.components.orchestrator,
        this.components.swarmCoordinator,
        this.components.agentManager,
        this.components.resourceManager,
        this.components.messageBus,
        this.components.monitor,
      );

      // Initialize lifecycle manager
      this.lifecycleManager = new MCPLifecycleManager(
        this.mcpConfig,
        this.logger,
        () => this.server!,
      );

      // Setup lifecycle event handlers
      this.setupLifecycleHandlers();

      // Register orchestration tools
      this.registerOrchestrationTools();

      // Start the server
      if (this.orchestrationConfig.autoStart) {
        await this.lifecycleManager.start();
      }

      // Start health monitoring
      this.startHealthMonitoring();

      // Setup component integrations
      await this.setupComponentIntegrations();

      this.logger.info('MCP orchestration integration started successfully');
      this.emit('integrationStarted');
    } catch (error) {
      this.logger.error('Failed to start MCP orchestration integration', error);
      throw error;
    }
  }

  /**
   * Stop the MCP orchestration integration
   */
  async stop(): Promise<void> {
    this.logger.info('Stopping MCP orchestration integration');

    try {
      // Stop health monitoring
      this.stopHealthMonitoring();

      // Stop lifecycle manager
      if (this.lifecycleManager) {
        await this.lifecycleManager.stop();
      }

      // Stop performance monitor
      if (this.performanceMonitor) {
        this.performanceMonitor.stop();
      }

      // Clear reconnect timers
      for (const timer of this.reconnectTimers.values()) {
        clearTimeout(timer);
      }
      this.reconnectTimers.clear();

      this.logger.info('MCP orchestration integration stopped');
      this.emit('integrationStopped');
    } catch (error) {
      this.logger.error('Error stopping MCP orchestration integration', error);
      throw error;
    }
  }

  /**
   * Get integration status for all components
   */
  getIntegrationStatus(): IntegrationStatus[] {
    return Array.from(this.integrationStatus.values());
  }

  /**
   * Get status for a specific component
   */
  getComponentStatus(component: string): IntegrationStatus | undefined {
    return this.integrationStatus.get(component);
  }

  /**
   * Get MCP server instance
   */
  getServer(): IMCPServer | undefined {
    return this.server;
  }

  /**
   * Get lifecycle manager
   */
  getLifecycleManager(): MCPLifecycleManager | undefined {
    return this.lifecycleManager;
  }

  /**
   * Get performance monitor
   */
  getPerformanceMonitor(): MCPPerformanceMonitor | undefined {
    return this.performanceMonitor;
  }

  /**
   * Get protocol manager
   */
  getProtocolManager(): MCPProtocolManager | undefined {
    return this.protocolManager;
  }

  /**
   * Force reconnection to a component
   */
  async reconnectComponent(component: string): Promise<void> {
    const status = this.integrationStatus.get(component);
    if (!status || !status.enabled) {
      throw new MCPError(`Component ${component} is not enabled`);
    }

    this.logger.info('Reconnecting to component', { component });

    try {
      await this.connectComponent(component);
      this.logger.info('Successfully reconnected to component', { component });
    } catch (error) {
      this.logger.error('Failed to reconnect to component', { component, error });
      throw error;
    }
  }

  /**
   * Enable/disable component integration
   */
  async setComponentEnabled(component: string, enabled: boolean): Promise<void> {
    const status = this.integrationStatus.get(component);
    if (!status) {
      throw new MCPError(`Unknown component: ${component}`);
    }

    status.enabled = enabled;
    
    if (enabled) {
      await this.connectComponent(component);
    } else {
      await this.disconnectComponent(component);
    }

    this.logger.info('Component integration updated', { component, enabled });
    this.emit('componentToggled', { component, enabled });
  }

  private initializeIntegration(): void {
    const components = [
      'orchestrator',
      'swarm',
      'agents',
      'resources',
      'memory',
      'monitoring',
      'terminals',
    ];

    for (const component of components) {
      this.integrationStatus.set(component, {
        component,
        enabled: this.orchestrationConfig.enabledIntegrations[component as keyof typeof this.orchestrationConfig.enabledIntegrations],
        connected: false,
        healthy: false,
        lastCheck: new Date(),
      });
    }
  }

  private setupLifecycleHandlers(): void {
    if (!this.lifecycleManager) return;

    this.lifecycleManager.on('stateChange', (event) => {
      this.logger.info('MCP server state changed', {
        from: event.previousState,
        to: event.state,
        error: event.error?.message,
      });

      // Emit to orchestration event bus
      if (this.components.eventBus) {
        this.components.eventBus.emit(SystemEvents.SYSTEM_HEALTHCHECK, {
          status: event.state === LifecycleState.RUNNING ? 'healthy' : 'unhealthy',
          component: 'mcp-server',
          timestamp: event.timestamp,
        });
      }

      this.emit('lifecycleStateChanged', event);
    });
  }

  private setupPerformanceMonitoring(): void {
    if (!this.performanceMonitor) return;

    this.performanceMonitor.on('metricsCollected', (metrics) => {
      // Forward metrics to orchestration monitor
      if (this.components.monitor && typeof this.components.monitor.recordMetrics === 'function') {
        this.components.monitor.recordMetrics('mcp', metrics);
      }

      this.emit('metricsCollected', metrics);
    });

    this.performanceMonitor.on('alertTriggered', (alert) => {
      this.logger.warn('MCP performance alert triggered', {
        alertId: alert.id,
        ruleName: alert.ruleName,
        severity: alert.severity,
        message: alert.message,
      });

      // Forward to orchestration alert system
      if (this.orchestrationConfig.enableAlerts && this.components.monitor) {
        if (typeof this.components.monitor.sendAlert === 'function') {
          this.components.monitor.sendAlert({
            source: 'mcp',
            severity: alert.severity,
            message: alert.message,
            metadata: alert,
          });
        }
      }

      this.emit('performanceAlert', alert);
    });

    this.performanceMonitor.on('optimizationSuggestion', (suggestion) => {
      this.logger.info('MCP optimization suggestion', {
        type: suggestion.type,
        priority: suggestion.priority,
        title: suggestion.title,
      });

      this.emit('optimizationSuggestion', suggestion);
    });
  }

  private registerOrchestrationTools(): void {
    if (!this.server) return;

    // Register orchestrator tools
    if (this.orchestrationConfig.enabledIntegrations.orchestrator && this.components.orchestrator) {
      this.registerOrchestratorTools();
    }

    // Register swarm tools
    if (this.orchestrationConfig.enabledIntegrations.swarm && this.components.swarmCoordinator) {
      this.registerSwarmTools();
    }

    // Register agent tools
    if (this.orchestrationConfig.enabledIntegrations.agents && this.components.agentManager) {
      this.registerAgentTools();
    }

    // Register resource tools
    if (this.orchestrationConfig.enabledIntegrations.resources && this.components.resourceManager) {
      this.registerResourceTools();
    }

    // Register memory tools
    if (this.orchestrationConfig.enabledIntegrations.memory && this.components.memoryManager) {
      this.registerMemoryTools();
    }

    // Register monitoring tools
    if (this.orchestrationConfig.enabledIntegrations.monitoring && this.components.monitor) {
      this.registerMonitoringTools();
    }

    // Register terminal tools
    if (this.orchestrationConfig.enabledIntegrations.terminals && this.components.terminalManager) {
      this.registerTerminalTools();
    }
  }

  private registerOrchestratorTools(): void {
    const tools: MCPTool[] = [
      {
        name: 'orchestrator/status',
        description: 'Get orchestrator status and metrics',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.orchestrator?.getStatus === 'function') {
            return await this.components.orchestrator.getStatus();
          }
          throw new MCPError('Orchestrator status not available');
        },
      },
      {
        name: 'orchestrator/tasks',
        description: 'List all tasks in the orchestrator',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'running', 'completed', 'failed'] },
            limit: { type: 'number', minimum: 1, maximum: 100 },
          },
        },
        handler: async (input: any) => {
          if (typeof this.components.orchestrator?.listTasks === 'function') {
            return await this.components.orchestrator.listTasks(input);
          }
          throw new MCPError('Orchestrator task listing not available');
        },
      },
    ];

    for (const tool of tools) {
      this.server!.registerTool(tool);
    }
  }

  private registerSwarmTools(): void {
    const tools: MCPTool[] = [
      {
        name: 'swarm/status',
        description: 'Get swarm coordinator status',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.swarmCoordinator?.getStatus === 'function') {
            return await this.components.swarmCoordinator.getStatus();
          }
          throw new MCPError('Swarm coordinator status not available');
        },
      },
      {
        name: 'swarm/agents',
        description: 'List active swarm agents',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.swarmCoordinator?.listAgents === 'function') {
            return await this.components.swarmCoordinator.listAgents();
          }
          throw new MCPError('Swarm agent listing not available');
        },
      },
    ];

    for (const tool of tools) {
      this.server!.registerTool(tool);
    }
  }

  private registerAgentTools(): void {
    const tools: MCPTool[] = [
      {
        name: 'agents/list',
        description: 'List all managed agents',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.agentManager?.listAgents === 'function') {
            return await this.components.agentManager.listAgents();
          }
          throw new MCPError('Agent listing not available');
        },
      },
      {
        name: 'agents/spawn',
        description: 'Spawn a new agent',
        inputSchema: {
          type: 'object',
          properties: {
            profile: { type: 'object' },
            config: { type: 'object' },
          },
          required: ['profile'],
        },
        handler: async (input: any) => {
          if (typeof this.components.agentManager?.spawnAgent === 'function') {
            return await this.components.agentManager.spawnAgent(input.profile, input.config);
          }
          throw new MCPError('Agent spawning not available');
        },
      },
    ];

    for (const tool of tools) {
      this.server!.registerTool(tool);
    }
  }

  private registerResourceTools(): void {
    const tools: MCPTool[] = [
      {
        name: 'resources/list',
        description: 'List available resources',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.resourceManager?.listResources === 'function') {
            return await this.components.resourceManager.listResources();
          }
          throw new MCPError('Resource listing not available');
        },
      },
      {
        name: 'resources/status',
        description: 'Get resource manager status',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.resourceManager?.getStatus === 'function') {
            return await this.components.resourceManager.getStatus();
          }
          throw new MCPError('Resource manager status not available');
        },
      },
    ];

    for (const tool of tools) {
      this.server!.registerTool(tool);
    }
  }

  private registerMemoryTools(): void {
    const tools: MCPTool[] = [
      {
        name: 'memory/query',
        description: 'Query memory bank',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            namespace: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
        handler: async (input: any) => {
          if (typeof this.components.memoryManager?.query === 'function') {
            return await this.components.memoryManager.query(input);
          }
          throw new MCPError('Memory query not available');
        },
      },
      {
        name: 'memory/store',
        description: 'Store data in memory bank',
        inputSchema: {
          type: 'object',
          properties: {
            data: { type: 'object' },
            namespace: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['data'],
        },
        handler: async (input: any) => {
          if (typeof this.components.memoryManager?.store === 'function') {
            return await this.components.memoryManager.store(input);
          }
          throw new MCPError('Memory storage not available');
        },
      },
    ];

    for (const tool of tools) {
      this.server!.registerTool(tool);
    }
  }

  private registerMonitoringTools(): void {
    const tools: MCPTool[] = [
      {
        name: 'monitoring/metrics',
        description: 'Get system monitoring metrics',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.monitor?.getMetrics === 'function') {
            return await this.components.monitor.getMetrics();
          }
          throw new MCPError('Monitoring metrics not available');
        },
      },
      {
        name: 'monitoring/alerts',
        description: 'List active alerts',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.monitor?.getAlerts === 'function') {
            return await this.components.monitor.getAlerts();
          }
          throw new MCPError('Alert listing not available');
        },
      },
    ];

    for (const tool of tools) {
      this.server!.registerTool(tool);
    }
  }

  private registerTerminalTools(): void {
    const tools: MCPTool[] = [
      {
        name: 'terminals/list',
        description: 'List active terminal sessions',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => {
          if (typeof this.components.terminalManager?.listSessions === 'function') {
            return await this.components.terminalManager.listSessions();
          }
          throw new MCPError('Terminal session listing not available');
        },
      },
      {
        name: 'terminals/execute',
        description: 'Execute command in terminal',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            sessionId: { type: 'string' },
          },
          required: ['command'],
        },
        handler: async (input: any) => {
          if (typeof this.components.terminalManager?.execute === 'function') {
            return await this.components.terminalManager.execute(input.command, input.sessionId);
          }
          throw new MCPError('Terminal execution not available');
        },
      },
    ];

    for (const tool of tools) {
      this.server!.registerTool(tool);
    }
  }

  private async setupComponentIntegrations(): Promise<void> {
    const promises = [];

    for (const [component, status] of this.integrationStatus.entries()) {
      if (status.enabled) {
        promises.push(this.connectComponent(component));
      }
    }

    await Promise.allSettled(promises);
  }

  private async connectComponent(component: string): Promise<void> {
    const status = this.integrationStatus.get(component);
    if (!status) return;

    try {
      // Component-specific connection logic
      switch (component) {
        case 'orchestrator':
          await this.connectOrchestrator();
          break;
        case 'swarm':
          await this.connectSwarmCoordinator();
          break;
        case 'agents':
          await this.connectAgentManager();
          break;
        case 'resources':
          await this.connectResourceManager();
          break;
        case 'memory':
          await this.connectMemoryManager();
          break;
        case 'monitoring':
          await this.connectMonitor();
          break;
        case 'terminals':
          await this.connectTerminalManager();
          break;
      }

      status.connected = true;
      status.healthy = true;
      status.lastCheck = new Date();
      status.error = undefined;

      this.logger.info('Component connected', { component });
      this.emit('componentConnected', { component });
    } catch (error) {
      status.connected = false;
      status.healthy = false;
      status.error = error instanceof Error ? error.message : 'Unknown error';
      
      this.logger.error('Failed to connect component', { component, error });
      this.scheduleReconnect(component);
    }
  }

  private async disconnectComponent(component: string): Promise<void> {
    const status = this.integrationStatus.get(component);
    if (!status) return;

    status.connected = false;
    status.healthy = false;
    status.lastCheck = new Date();

    // Clear any reconnect timers
    const timer = this.reconnectTimers.get(component);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(component);
    }

    this.logger.info('Component disconnected', { component });
    this.emit('componentDisconnected', { component });
  }

  private scheduleReconnect(component: string): void {
    const timer = this.reconnectTimers.get(component);
    if (timer) return; // Already scheduled

    const reconnectTimer = setTimeout(async () => {
      this.reconnectTimers.delete(component);
      try {
        await this.connectComponent(component);
      } catch (error) {
        // Will be handled by connectComponent
      }
    }, this.orchestrationConfig.reconnectDelay);

    this.reconnectTimers.set(component, reconnectTimer);
  }

  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.orchestrationConfig.healthCheckInterval);
  }

  private stopHealthMonitoring(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private async performHealthChecks(): Promise<void> {
    for (const [component, status] of this.integrationStatus.entries()) {
      if (!status.enabled || !status.connected) continue;

      try {
        const healthy = await this.checkComponentHealth(component);
        status.healthy = healthy;
        status.lastCheck = new Date();
        status.error = undefined;
      } catch (error) {
        status.healthy = false;
        status.error = error instanceof Error ? error.message : 'Health check failed';
        this.logger.warn('Component health check failed', { component, error });
      }
    }
  }

  private async checkComponentHealth(component: string): Promise<boolean> {
    const componentInstance = this.getComponentInstance(component);
    if (!componentInstance) return false;

    // Check if component has health check method
    if (typeof componentInstance.healthCheck === 'function') {
      const result = await componentInstance.healthCheck();
      return result === true || (typeof result === 'object' && result.healthy === true);
    }

    // Basic check - component exists and is not null
    return true;
  }

  private getComponentInstance(component: string): any {
    switch (component) {
      case 'orchestrator': return this.components.orchestrator;
      case 'swarm': return this.components.swarmCoordinator;
      case 'agents': return this.components.agentManager;
      case 'resources': return this.components.resourceManager;
      case 'memory': return this.components.memoryManager;
      case 'monitoring': return this.components.monitor;
      case 'terminals': return this.components.terminalManager;
      default: return null;
    }
  }

  // Component-specific connection methods
  private async connectOrchestrator(): Promise<void> {
    if (!this.components.orchestrator) {
      throw new MCPError('Orchestrator component not available');
    }
    // Add orchestrator-specific connection logic here
  }

  private async connectSwarmCoordinator(): Promise<void> {
    if (!this.components.swarmCoordinator) {
      throw new MCPError('Swarm coordinator component not available');
    }
    // Add swarm coordinator-specific connection logic here
  }

  private async connectAgentManager(): Promise<void> {
    if (!this.components.agentManager) {
      throw new MCPError('Agent manager component not available');
    }
    // Add agent manager-specific connection logic here
  }

  private async connectResourceManager(): Promise<void> {
    if (!this.components.resourceManager) {
      throw new MCPError('Resource manager component not available');
    }
    // Add resource manager-specific connection logic here
  }

  private async connectMemoryManager(): Promise<void> {
    if (!this.components.memoryManager) {
      throw new MCPError('Memory manager component not available');
    }
    // Add memory manager-specific connection logic here
  }

  private async connectMonitor(): Promise<void> {
    if (!this.components.monitor) {
      throw new MCPError('Monitor component not available');
    }
    // Add monitor-specific connection logic here
  }

  private async connectTerminalManager(): Promise<void> {
    if (!this.components.terminalManager) {
      throw new MCPError('Terminal manager component not available');
    }
    // Add terminal manager-specific connection logic here
  }
}