/**
 * Sync Integration Module
 * Connects VS Code sync service with TaskMaster core functionality
 */

import { EventEmitter } from 'node:events';
import { VSCodeSyncService } from './vscode-sync-service.ts';
import { TaskAdapter } from '../adapters/task-adapter.ts';
import { PRDService } from './prd-service.ts';
import { SmartTaskGenerator } from './smart-task-generator.ts';
import { StorageSync } from './storage-sync.ts';
import { 
  TaskMasterTask, 
  ClaudeFlowTask,
  SyncResult,
  Conflict,
  Resolution
} from '../types/task-types.ts';
import { logger } from '../../../core/logger.ts';

export interface SyncIntegrationConfig {
  enableAutoSync: boolean;
  enablePRDParsing: boolean;
  enableTaskGeneration: boolean;
  enableConflictResolution: boolean;
  syncInterval: number;
}

export class SyncIntegration extends EventEmitter {
  private syncService: VSCodeSyncService;
  private taskAdapter: TaskAdapter;
  private prdService: PRDService;
  private taskGenerator: SmartTaskGenerator;
  private storageSync: StorageSync;
  private config: SyncIntegrationConfig;
  private isInitialized: boolean = false;

  constructor(config: Partial<SyncIntegrationConfig> = {}) {
    super();
    
    this.config = {
      enableAutoSync: true,
      enablePRDParsing: true,
      enableTaskGeneration: true,
      enableConflictResolution: true,
      syncInterval: 5000,
      ...config
    };

    // Initialize services
    this.syncService = new VSCodeSyncService({
      syncInterval: this.config.syncInterval,
      conflictResolutionStrategy: 'manual' // We'll handle conflicts ourselves
    });

    this.taskAdapter = new TaskAdapter();
    this.prdService = new PRDService();
    this.taskGenerator = new SmartTaskGenerator();
    this.storageSync = new StorageSync(this.taskAdapter);
  }

  /**
   * Initialize and start the sync integration
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Sync integration already initialized');
      return;
    }

    try {
      // Set up event listeners
      this.setupSyncServiceListeners();
      this.setupStorageListeners();
      
      // Start sync service
      await this.syncService.start();
      
      // Enable auto-sync if configured
      if (this.config.enableAutoSync) {
        await this.enableAutoSync();
      }

      this.isInitialized = true;
      logger.info('Sync integration initialized successfully');
      this.emit('initialized');

    } catch (error) {
      logger.error('Failed to initialize sync integration', error);
      throw error;
    }
  }

  /**
   * Shutdown the sync integration
   */
  async shutdown(): Promise<void> {
    if (!this.isInitialized) {
      return;
    }

    try {
      await this.syncService.stop();
      this.storageSync.disableWatcher();
      
      this.isInitialized = false;
      logger.info('Sync integration shut down');
      this.emit('shutdown');

    } catch (error) {
      logger.error('Error during sync integration shutdown', error);
      throw error;
    }
  }

  /**
   * Get current integration status
   */
  getStatus(): any {
    return {
      initialized: this.isInitialized,
      syncService: this.syncService.getSyncStatus(),
      storageSync: this.storageSync.getSyncStatus(),
      config: this.config
    };
  }

  /**
   * Handle task creation from VS Code
   */
  async handleTaskCreation(task: TaskMasterTask): Promise<void> {
    try {
      // Convert to Claude-Flow task
      const claudeFlowTask = await this.taskAdapter.convertFromTaskMaster(task);
      
      // Store in Claude-Flow system
      await this.storageSync.storeTask(claudeFlowTask);
      
      // If task was AI-generated, enrich with additional metadata
      if (task.metadata?.ai_generated && this.config.enableTaskGeneration) {
        const enrichedTask = await this.taskGenerator.enrichTask(task);
        await this.syncService.notifyTaskUpdate(enrichedTask, 'update');
      }

      this.emit('task:created', { task, claudeFlowTask });
      
    } catch (error) {
      logger.error('Failed to handle task creation', error);
      this.emit('error', { operation: 'task:create', error });
    }
  }

  /**
   * Handle task update from VS Code
   */
  async handleTaskUpdate(task: TaskMasterTask): Promise<void> {
    try {
      // Convert and update
      const claudeFlowTask = await this.taskAdapter.convertFromTaskMaster(task);
      await this.storageSync.updateTask(claudeFlowTask);
      
      this.emit('task:updated', { task, claudeFlowTask });
      
    } catch (error) {
      logger.error('Failed to handle task update', error);
      this.emit('error', { operation: 'task:update', error });
    }
  }

  /**
   * Handle PRD parse request from VS Code
   */
  async handlePRDParseRequest(content: string, options: any): Promise<void> {
    if (!this.config.enablePRDParsing) {
      logger.warn('PRD parsing is disabled');
      return;
    }

    try {
      logger.info('Processing PRD parse request from VS Code');
      
      // Parse PRD
      const parsedPRD = await this.prdService.parsePRD(content, {
        model: { provider: 'anthropic', model: 'claude-3-haiku' },
        generateTasks: true,
        mapToSparc: true
      });

      // Generate tasks
      const taskTree = await this.prdService.generateTasks(parsedPRD, {
        model: { provider: 'anthropic', model: 'claude-3-haiku' },
        taskDepth: 2,
        sparcMapping: true,
        estimateHours: true,
        includeDependencies: true
      });

      // Send result back to VS Code
      await this.syncService.notifyPRDParseResult({
        success: true,
        prd: parsedPRD,
        taskTree,
        totalTasks: taskTree.totalTasks,
        estimatedHours: taskTree.estimatedHours,
        complexity: taskTree.complexity
      });

      this.emit('prd:parsed', { parsedPRD, taskTree });
      
    } catch (error) {
      logger.error('Failed to parse PRD', error);
      
      await this.syncService.notifyPRDParseResult({
        success: false,
        error: error.message
      });
      
      this.emit('error', { operation: 'prd:parse', error });
    }
  }

  /**
   * Handle conflict resolution
   */
  async handleConflict(conflict: Conflict): Promise<void> {
    if (!this.config.enableConflictResolution) {
      logger.warn('Conflict resolution is disabled');
      return;
    }

    try {
      // Get both versions
      const taskMasterTask = conflict.taskMasterValue as TaskMasterTask;
      const claudeFlowTask = conflict.claudeFlowValue as ClaudeFlowTask;
      
      // Apply intelligent conflict resolution
      const resolution = await this.resolveConflict(conflict, taskMasterTask, claudeFlowTask);
      
      // Apply resolution
      if (resolution.strategy !== 'manual') {
        await this.applyResolution(resolution);
      }

      this.emit('conflict:resolved', { conflict, resolution });
      
    } catch (error) {
      logger.error('Failed to handle conflict', error);
      this.emit('error', { operation: 'conflict:resolve', error });
    }
  }

  // Private methods

  private setupSyncServiceListeners(): void {
    // Task events
    this.syncService.on('task:created', (task) => {
      this.handleTaskCreation(task);
    });

    this.syncService.on('task:updated', (task) => {
      this.handleTaskUpdate(task);
    });

    this.syncService.on('task:deleted', (taskId) => {
      this.storageSync.deleteTask(taskId);
      this.emit('task:deleted', { taskId });
    });

    // PRD events
    this.syncService.on('prd:parse:requested', ({ client, content, options }) => {
      this.handlePRDParseRequest(content, options);
    });

    // Sync events
    this.syncService.on('sync:conflict', (conflict) => {
      this.handleConflict(conflict);
    });

    this.syncService.on('sync:started', () => {
      this.emit('sync:started');
    });

    this.syncService.on('sync:completed', (result) => {
      this.emit('sync:completed', result);
    });

    // Connection events
    this.syncService.on('client:connected', (data) => {
      this.emit('vscode:connected', data);
    });

    this.syncService.on('client:disconnected', (data) => {
      this.emit('vscode:disconnected', data);
    });
  }

  private setupStorageListeners(): void {
    // Listen for local task changes to sync to VS Code
    this.storageSync.on('task:created', async (claudeFlowTask: ClaudeFlowTask) => {
      try {
        const taskMasterTask = await this.taskAdapter.convertToTaskMaster(claudeFlowTask);
        await this.syncService.notifyTaskUpdate(taskMasterTask, 'create');
      } catch (error) {
        logger.error('Failed to sync task creation to VS Code', error);
      }
    });

    this.storageSync.on('task:updated', async (claudeFlowTask: ClaudeFlowTask) => {
      try {
        const taskMasterTask = await this.taskAdapter.convertToTaskMaster(claudeFlowTask);
        await this.syncService.notifyTaskUpdate(taskMasterTask, 'update');
      } catch (error) {
        logger.error('Failed to sync task update to VS Code', error);
      }
    });

    this.storageSync.on('task:deleted', async (taskId: string) => {
      try {
        await this.syncService.notifyTaskUpdate(
          { id: taskId } as TaskMasterTask, 
          'delete'
        );
      } catch (error) {
        logger.error('Failed to sync task deletion to VS Code', error);
      }
    });
  }

  private async enableAutoSync(): Promise<void> {
    // Set up periodic sync
    setInterval(async () => {
      if (this.syncService.getSyncStatus().isConnected) {
        try {
          const result = await this.syncService.requestSync();
          logger.debug('Auto-sync completed', result);
        } catch (error) {
          logger.error('Auto-sync failed', error);
        }
      }
    }, this.config.syncInterval);

    // Enable file watcher for real-time sync
    this.storageSync.enableWatcher('./tasks');
  }

  private async resolveConflict(
    conflict: Conflict, 
    taskMasterTask: TaskMasterTask, 
    claudeFlowTask: ClaudeFlowTask
  ): Promise<Resolution> {
    // Intelligent conflict resolution based on:
    // 1. Timestamp (newest wins)
    // 2. Source priority (configurable)
    // 3. Field-specific rules
    
    // For now, implement newest wins
    const tmDate = new Date(taskMasterTask.updatedAt).getTime();
    const cfDate = new Date(claudeFlowTask.updatedAt).getTime();
    
    if (tmDate > cfDate) {
      return {
        taskId: conflict.taskId,
        field: conflict.field,
        resolvedValue: taskMasterTask,
        strategy: 'taskmaster_wins'
      };
    } else {
      return {
        taskId: conflict.taskId,
        field: conflict.field,
        resolvedValue: claudeFlowTask,
        strategy: 'claudeflow_wins'
      };
    }
  }

  private async applyResolution(resolution: Resolution): Promise<void> {
    // Apply the resolution to both systems
    if (resolution.strategy === 'taskmaster_wins') {
      const task = resolution.resolvedValue as TaskMasterTask;
      const claudeFlowTask = await this.taskAdapter.convertFromTaskMaster(task);
      await this.storageSync.updateTask(claudeFlowTask);
    } else if (resolution.strategy === 'claudeflow_wins') {
      const task = resolution.resolvedValue as ClaudeFlowTask;
      const taskMasterTask = await this.taskAdapter.convertToTaskMaster(task);
      await this.syncService.notifyTaskUpdate(taskMasterTask, 'update');
    }
  }
}

// Singleton instance
let syncIntegration: SyncIntegration | null = null;

/**
 * Get or create sync integration instance
 */
export function getSyncIntegration(config?: Partial<SyncIntegrationConfig>): SyncIntegration {
  if (!syncIntegration) {
    syncIntegration = new SyncIntegration(config);
  }
  return syncIntegration;
}

export default SyncIntegration;