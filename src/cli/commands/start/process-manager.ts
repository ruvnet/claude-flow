/**
 * Process Manager - Handles lifecycle of system processes
 */

import { EventEmitter } from './event-emitter.js';
import { colors } from '../../../utils/cliffy-compat/colors.js';
import { 
  ProcessInfo, 
  ProcessType, 
  ProcessStatus, 
  ProcessMetrics,
  SystemStats 
} from './types.js';
import { Orchestrator } from '../../../core/orchestrator.js';
import { TerminalManager } from '../../../terminal/manager.js';
import { MemoryManager } from '../../../memory/manager.js';
import { CoordinationManager } from '../../../coordination/manager.js';
import { MCPServer } from '../../../mcp/server.js';
import { eventBus } from '../../../core/event-bus.js';
import { logger } from '../../../core/logger.js';
import { getProcessRegistry } from '../../../services/process-registry/registry.js';
import { configManager } from '../../../core/config.js';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';

export class ProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private orchestrator: Orchestrator | undefined;
  private terminalManager: TerminalManager | undefined;
  private memoryManager: MemoryManager | undefined;
  private coordinationManager: CoordinationManager | undefined;
  private mcpServer: MCPServer | undefined;
  private config: any;

  constructor() {
    super();
    this.initializeProcesses();
  }

  private initializeProcesses(): void {
    // Define all manageable processes
    const processDefinitions: ProcessInfo[] = [
      {
        id: 'event-bus',
        name: 'Event Bus',
        type: ProcessType.EVENT_BUS,
        status: ProcessStatus.STOPPED
      },
      {
        id: 'orchestrator',
        name: 'Orchestrator Engine',
        type: ProcessType.ORCHESTRATOR,
        status: ProcessStatus.STOPPED
      },
      {
        id: 'memory-manager',
        name: 'Memory Manager',
        type: ProcessType.MEMORY_MANAGER,
        status: ProcessStatus.STOPPED
      },
      {
        id: 'terminal-pool',
        name: 'Terminal Pool',
        type: ProcessType.TERMINAL_POOL,
        status: ProcessStatus.STOPPED
      },
      {
        id: 'mcp-server',
        name: 'MCP Server',
        type: ProcessType.MCP_SERVER,
        status: ProcessStatus.STOPPED
      },
      {
        id: 'coordinator',
        name: 'Coordination Manager',
        type: ProcessType.COORDINATOR,
        status: ProcessStatus.STOPPED
      }
    ];

    for (const process of processDefinitions) {
      this.processes.set(process.id, process);
    }
  }

  async initialize(configPath?: string): Promise<void> {
    try {
      this.config = await configManager.load(configPath);
      this.emit('initialized', { config: this.config });
    } catch (error) {
      this.emit('error', { component: 'ProcessManager', error });
      throw error;
    }
  }

  async startProcess(processId: string): Promise<void> {
    const process = this.processes.get(processId);
    if (!process) {
      throw new Error(`Unknown process: ${processId}`);
    }

    if (process.status === ProcessStatus.RUNNING) {
      throw new Error(`Process ${processId} is already running`);
    }

    this.updateProcessStatus(processId, ProcessStatus.STARTING);

    try {
      switch (process.type) {
        case ProcessType.EVENT_BUS:
          // Event bus is already initialized globally
          process.pid = globalThis.process?.pid || process.pid;
          break;

        case ProcessType.MEMORY_MANAGER:
          this.memoryManager = new MemoryManager(
            this.config.memory,
            eventBus,
            logger
          );
          await this.memoryManager.initialize();
          process.pid = globalThis.process?.pid || process.pid;
          break;

        case ProcessType.TERMINAL_POOL:
          this.terminalManager = new TerminalManager(
            this.config.terminal,
            eventBus,
            logger
          );
          await this.terminalManager.initialize();
          process.pid = globalThis.process?.pid || process.pid;
          break;

        case ProcessType.COORDINATOR:
          this.coordinationManager = new CoordinationManager(
            this.config.coordination,
            eventBus,
            logger
          );
          await this.coordinationManager.initialize();
          process.pid = globalThis.process?.pid || process.pid;
          break;

        case ProcessType.MCP_SERVER:
          this.mcpServer = new MCPServer(
            this.config.mcp,
            eventBus,
            logger
          );
          await this.mcpServer.start();
          process.pid = globalThis.process?.pid || process.pid;
          break;

        case ProcessType.ORCHESTRATOR:
          if (!this.terminalManager || !this.memoryManager || 
              !this.coordinationManager || !this.mcpServer) {
            throw new Error('Required components not initialized');
          }
          
          this.orchestrator = new Orchestrator(
            this.config,
            this.terminalManager,
            this.memoryManager,
            this.coordinationManager,
            this.mcpServer,
            eventBus,
            logger
          );
          await this.orchestrator.initialize();
          process.pid = globalThis.process?.pid || process.pid;
          break;
      }

      process.startTime = Date.now();
      this.updateProcessStatus(processId, ProcessStatus.RUNNING);
      
      // Register with process registry
      try {
        const registry = getProcessRegistry();
        await registry.initialize();
        
        const registryProcessInfo = {
          id: `${processId}-${Date.now()}`,
          name: process.name,
          type: process.type === ProcessType.ORCHESTRATOR ? 'service' as const : 
                process.type === ProcessType.MCP_SERVER ? 'service' as const : 
                process.type === ProcessType.MEMORY_MANAGER ? 'service' as const : 'task' as const,
          pid: process.pid || 0, // Fallback to 0 if pid is undefined
          startTime: new Date(process.startTime),
          status: 'running' as const,
          command: [processId],
          environment: {},
          resources: {
            memory: process.metrics?.memoryUsage?.heap || 0,
            cpu: process.metrics?.cpu || 0
          },
          healthCheck: {
            interval: 30000,
            timeout: 5000,
            retries: 3
          },
          metadata: {
            processType: process.type,
            processId: process.id
          }
        };
        
        const registryId = await registry.register(registryProcessInfo);
        process.registryId = registryId;
        logger.debug(`Process ${processId} registered with ID: ${registryId}`);
      } catch (error) {
        logger.warn(`Failed to register process ${processId} with registry:`, error);
      }
      
      this.emit('processStarted', { processId, process });

    } catch (error) {
      this.updateProcessStatus(processId, ProcessStatus.ERROR);
      process.metrics = {
        ...process.metrics,
        lastError: (error as Error).message
      };
      this.emit('processError', { processId, error });
      throw error;
    }
  }

  async stopProcess(processId: string): Promise<void> {
    const process = this.processes.get(processId);
    if (!process || process.status !== ProcessStatus.RUNNING) {
      throw new Error(`Process ${processId} is not running`);
    }

    this.updateProcessStatus(processId, ProcessStatus.STOPPING);

    try {
      switch (process.type) {
        case ProcessType.ORCHESTRATOR:
          if (this.orchestrator) {
            await this.orchestrator.shutdown();
            this.orchestrator = undefined;
          }
          break;

        case ProcessType.MCP_SERVER:
          if (this.mcpServer) {
            await this.mcpServer.stop();
            this.mcpServer = undefined;
          }
          break;

        case ProcessType.MEMORY_MANAGER:
          if (this.memoryManager) {
            await this.memoryManager.shutdown();
            this.memoryManager = undefined;
          }
          break;

        case ProcessType.TERMINAL_POOL:
          if (this.terminalManager) {
            await this.terminalManager.shutdown();
            this.terminalManager = undefined;
          }
          break;

        case ProcessType.COORDINATOR:
          if (this.coordinationManager) {
            await this.coordinationManager.shutdown();
            this.coordinationManager = undefined;
          }
          break;
      }

      this.updateProcessStatus(processId, ProcessStatus.STOPPED);
      
      // Unregister from process registry
      if (process.registryId) {
        try {
          const registry = getProcessRegistry();
          await registry.unregister(process.registryId);
          logger.debug(`Process ${processId} unregistered from registry`);
        } catch (error) {
          logger.warn(`Failed to unregister process ${processId} from registry:`, error);
        }
      }
      
      this.emit('processStopped', { processId });

    } catch (error) {
      this.updateProcessStatus(processId, ProcessStatus.ERROR);
      this.emit('processError', { processId, error });
      throw error;
    }
  }

  async restartProcess(processId: string): Promise<void> {
    await this.stopProcess(processId);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Brief delay
    await this.startProcess(processId);
  }

  async startAll(): Promise<void> {
    // Start in dependency order
    const startOrder = [
      'event-bus',
      'memory-manager',
      'terminal-pool',
      'coordinator',
      'mcp-server',
      'orchestrator'
    ];

    for (const processId of startOrder) {
      try {
        await this.startProcess(processId);
      } catch (error) {
        console.error(colors.red(`Failed to start ${processId}:`), (error as Error).message);
        // Continue with other processes
      }
    }
    
    // Save initial system state
    await this.saveSystemState();
  }

  async stopAll(): Promise<void> {
    // Stop in reverse dependency order
    const stopOrder = [
      'orchestrator',
      'mcp-server',
      'coordinator',
      'terminal-pool',
      'memory-manager',
      'event-bus'
    ];

    for (const processId of stopOrder) {
      const process = this.processes.get(processId);
      if (process && process.status === ProcessStatus.RUNNING) {
        try {
          await this.stopProcess(processId);
        } catch (error) {
          console.error(colors.red(`Failed to stop ${processId}:`), (error as Error).message);
        }
      }
    }
  }

  getProcess(processId: string): ProcessInfo | undefined {
    return this.processes.get(processId);
  }

  getAllProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values());
  }

  getSystemStats(): SystemStats {
    const processes = this.getAllProcesses();
    const runningProcesses = processes.filter(p => p.status === ProcessStatus.RUNNING);
    const stoppedProcesses = processes.filter(p => p.status === ProcessStatus.STOPPED);
    const errorProcesses = processes.filter(p => p.status === ProcessStatus.ERROR);

    return {
      totalProcesses: processes.length,
      runningProcesses: runningProcesses.length,
      stoppedProcesses: stoppedProcesses.length,
      errorProcesses: errorProcesses.length,
      systemUptime: this.getSystemUptime(),
      totalMemory: this.getTotalMemoryUsage(),
      totalCpu: this.getTotalCpuUsage()
    };
  }

  private updateProcessStatus(processId: string, status: ProcessStatus): void {
    const process = this.processes.get(processId);
    if (process) {
      process.status = status;
      this.emit('statusChanged', { processId, status });
      // Save state whenever status changes
      this.saveSystemState().catch(console.error);
    }
  }

  private getSystemUptime(): number {
    const orchestrator = this.processes.get('orchestrator');
    if (orchestrator && orchestrator.startTime) {
      return Date.now() - orchestrator.startTime;
    }
    return 0;
  }

  private getTotalMemoryUsage(): number {
    // Placeholder - would integrate with actual memory monitoring
    return 0;
  }

  private getTotalCpuUsage(): number {
    // Placeholder - would integrate with actual CPU monitoring
    return 0;
  }

  async getProcessLogs(processId: string, lines: number = 50): Promise<string[]> {
    // Placeholder - would integrate with actual logging system
    return [
      `[${new Date().toISOString()}] Process ${processId} started`,
      `[${new Date().toISOString()}] Process ${processId} is running normally`
    ];
  }

  // State persistence for inter-command communication
  async saveSystemState(): Promise<void> {
    try {
      const state = {
        timestamp: new Date().toISOString(),
        processes: Array.from(this.processes.entries()).map(([id, process]) => ({
          id,
          name: process.name,
          type: process.type,
          status: process.status,
          pid: process.pid,
          startTime: process.startTime,
          metrics: process.metrics
        })),
        systemStats: this.getSystemStats(),
        orchestratorPid: globalThis.process?.pid || 0
      };

      await fs.writeFile('.claude-flow-state.json', JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Failed to save system state:', error);
    }
  }
}