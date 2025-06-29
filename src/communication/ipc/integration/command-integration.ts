/**
 * Command Integration for IPC
 * Demonstrates how to integrate IPC with Claude-Flow commands
 */

import { 
  IPCFactory,
  IPCServer,
  IPCClient,
  MessageType,
  IPCMessage,
  IPCConnection,
  createOrchestratorServer,
  createOrchestratorClient,
  IPCPaths
} from '../index.js';
import { MessageHandler } from '../server.js';

/**
 * Command IPC integration class
 */
export class CommandIPCIntegration {
  private server?: IPCServer;
  private client?: IPCClient;
  
  /**
   * Start IPC server for a command
   */
  async startCommandServer(commandName: string): Promise<void> {
    const path = this.getCommandPath(commandName);
    
    this.server = IPCFactory.createServer({
      path,
      security: {
        enableAuthentication: true,
        authToken: process.env.CLAUDE_FLOW_IPC_TOKEN || 'default-token'
      }
    });
    
    // Register command handlers
    this.registerCommandHandlers();
    
    await this.server.start();
    console.log(`IPC server started for command: ${commandName} at ${path}`);
  }
  
  /**
   * Connect to orchestrator as a command client
   */
  async connectToOrchestrator(): Promise<void> {
    this.client = createOrchestratorClient();
    
    this.client.on('connected', () => {
      console.log('Connected to orchestrator');
      this.registerWithOrchestrator();
    });
    
    this.client.on('message', (message) => {
      console.log('Received message from orchestrator:', message);
    });
    
    await this.client.connect();
  }
  
  /**
   * Register command handlers
   */
  private registerCommandHandlers(): void {
    if (!this.server) return;
    
    // Handler for executing command
    this.server.registerHandler('execute', this.handleExecute.bind(this));
    
    // Handler for getting command status
    this.server.registerHandler('status', this.handleStatus.bind(this));
    
    // Handler for canceling command
    this.server.registerHandler('cancel', this.handleCancel.bind(this));
  }
  
  /**
   * Register this command with the orchestrator
   */
  private async registerWithOrchestrator(): Promise<void> {
    if (!this.client) return;
    
    await this.client.send({
      id: crypto.randomUUID(),
      type: MessageType.PROCESS_REGISTER,
      timestamp: new Date(),
      payload: {
        processType: 'command',
        commandName: this.getCommandName(),
        capabilities: ['execute', 'status', 'cancel'],
        pid: process.pid
      }
    });
  }
  
  /**
   * Handler for execute command
   */
  private async handleExecute(payload: any): Promise<any> {
    const { args, options } = payload;
    
    try {
      // Execute the actual command logic here
      const result = await this.executeCommand(args, options);
      
      return {
        success: true,
        result
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  
  /**
   * Handler for status command
   */
  private async handleStatus(): Promise<any> {
    return {
      status: 'running',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      pid: process.pid
    };
  }
  
  /**
   * Handler for cancel command
   */
  private async handleCancel(payload: any): Promise<any> {
    const { taskId } = payload;
    
    // Implement cancellation logic
    console.log(`Canceling task: ${taskId}`);
    
    return {
      success: true,
      message: `Task ${taskId} cancelled`
    };
  }
  
  /**
   * Execute command logic (to be overridden by specific commands)
   */
  protected async executeCommand(args: any, options: any): Promise<any> {
    throw new Error('executeCommand must be implemented by subclass');
  }
  
  /**
   * Get command name (to be overridden)
   */
  protected getCommandName(): string {
    return 'base-command';
  }
  
  /**
   * Get command IPC path
   */
  private getCommandPath(commandName: string): string {
    if (process.platform === 'win32') {
      return `claude-flow-cmd-${commandName}`;
    }
    const tmpDir = process.platform === 'darwin' ? '/tmp' : '/var/run';
    return `/tmp/claude-flow/commands/${commandName}.sock`;
  }
  
  /**
   * Cleanup IPC resources
   */
  async cleanup(): Promise<void> {
    if (this.client) {
      await this.client.disconnect();
    }
    
    if (this.server) {
      await this.server.stop();
    }
  }
}

/**
 * Example: Swarm command with IPC integration
 */
export class SwarmCommandIPC extends CommandIPCIntegration {
  private activeSwarms: Map<string, any> = new Map();
  
  protected override getCommandName(): string {
    return 'swarm';
  }
  
  protected override async executeCommand(args: any, options: any): Promise<any> {
    const { objective, strategy, mode } = args;
    const swarmId = crypto.randomUUID();
    
    // Create swarm configuration
    const swarmConfig = {
      id: swarmId,
      objective,
      strategy: strategy || 'auto',
      mode: mode || 'distributed',
      startTime: new Date()
    };
    
    this.activeSwarms.set(swarmId, swarmConfig);
    
    // Notify orchestrator about new swarm
    if (this.client) {
      await this.client.send({
        id: crypto.randomUUID(),
        type: MessageType.COMMAND_EVENT,
        command: 'swarm-started',
        timestamp: new Date(),
        payload: swarmConfig
      });
    }
    
    return {
      swarmId,
      message: `Swarm ${swarmId} started with objective: ${objective}`
    };
  }
}

/**
 * Example: Agent command with IPC integration
 */
export class AgentCommandIPC extends CommandIPCIntegration {
  private agents: Map<string, any> = new Map();
  
  protected override getCommandName(): string {
    return 'agent';
  }
  
  protected override async executeCommand(args: any, options: any): Promise<any> {
    const { action, type, name } = args;
    
    switch (action) {
      case 'spawn':
        return this.spawnAgent(type, name);
      case 'list':
        return this.listAgents();
      case 'terminate':
        return this.terminateAgent(name);
      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }
  
  private async spawnAgent(type: string, name?: string): Promise<any> {
    const agentId = crypto.randomUUID();
    const agentName = name || `${type}-${agentId.substring(0, 8)}`;
    
    const agent = {
      id: agentId,
      name: agentName,
      type,
      status: 'running',
      startTime: new Date()
    };
    
    this.agents.set(agentId, agent);
    
    // Create IPC server for the agent
    const agentServer = IPCFactory.createServer({
      path: IPCPaths.getAgentPath(agentId)
    });
    
    await agentServer.start();
    
    return {
      agentId,
      name: agentName,
      message: `Agent ${agentName} (${type}) spawned successfully`
    };
  }
  
  private listAgents(): any {
    return {
      agents: Array.from(this.agents.values())
    };
  }
  
  private async terminateAgent(name: string): Promise<any> {
    const agent = Array.from(this.agents.values()).find(a => a.name === name);
    
    if (!agent) {
      throw new Error(`Agent ${name} not found`);
    }
    
    this.agents.delete(agent.id);
    
    return {
      message: `Agent ${name} terminated`
    };
  }
}

/**
 * Process Registry Integration
 */
export class ProcessRegistryIPC {
  private server: IPCServer;
  private processes: Map<string, any> = new Map();
  
  constructor() {
    this.server = createOrchestratorServer({
      enableAuthentication: true,
      authToken: process.env.CLAUDE_FLOW_IPC_TOKEN || 'default-token'
    });
  }
  
  /**
   * Start the process registry
   */
  async start(): Promise<void> {
    // Register handlers for process management
    this.server.registerHandler('register', this.handleRegister.bind(this));
    this.server.registerHandler('unregister', this.handleUnregister.bind(this));
    this.server.registerHandler('query', this.handleQuery.bind(this));
    this.server.registerHandler('heartbeat', this.handleHeartbeat.bind(this));
    
    // Handle process messages
    this.server.on('process-message', (connection: IPCConnection, message: IPCMessage) => {
      this.handleProcessMessage(connection, message);
    });
    
    await this.server.start();
    console.log('Process registry started');
  }
  
  private async handleRegister(payload: any): Promise<any> {
    const processInfo = {
      ...payload,
      id: crypto.randomUUID(),
      registeredAt: new Date(),
      lastHeartbeat: new Date()
    };
    
    this.processes.set(processInfo.id, processInfo);
    
    return {
      processId: processInfo.id,
      message: 'Process registered successfully'
    };
  }
  
  private async handleUnregister(payload: any): Promise<any> {
    const { processId } = payload;
    
    if (this.processes.delete(processId)) {
      return { message: 'Process unregistered successfully' };
    }
    
    throw new Error('Process not found');
  }
  
  private async handleQuery(payload: any): Promise<any> {
    const { filter } = payload;
    const allProcesses = Array.from(this.processes.values());
    
    if (!filter) {
      return { processes: allProcesses };
    }
    
    // Apply filters
    const filtered = allProcesses.filter(p => {
      if (filter.type && p.processType !== filter.type) return false;
      if (filter.status && p.status !== filter.status) return false;
      return true;
    });
    
    return { processes: filtered };
  }
  
  private async handleHeartbeat(payload: any): Promise<any> {
    const { processId } = payload;
    const process = this.processes.get(processId);
    
    if (!process) {
      throw new Error('Process not found');
    }
    
    process.lastHeartbeat = new Date();
    return { message: 'Heartbeat received' };
  }
  
  private handleProcessMessage(connection: IPCConnection, message: IPCMessage): void {
    console.log('Process message received:', message);
    // Handle process-specific messages
  }
}

// Helper to import crypto
import * as crypto from 'crypto';