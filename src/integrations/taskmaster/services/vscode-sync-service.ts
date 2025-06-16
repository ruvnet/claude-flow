/**
 * VS Code Extension Sync Service for TaskMaster
 * Provides bidirectional synchronization between CLI and VS Code extension
 */

import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'npm:ws';
import { createServer, Server as HttpServer } from 'node:http';
import { 
  TaskMasterTask, 
  ClaudeFlowTask, 
  SyncResult, 
  Conflict,
  Resolution,
  TaskMasterStatus,
  ClaudeFlowStatus
} from '../types/task-types.ts';
import { logger } from '../../../core/logger.ts';

// Sync Protocol Messages
export interface SyncMessage {
  id: string;
  type: SyncMessageType;
  timestamp: number;
  payload: any;
  source: 'cli' | 'vscode';
  version: string;
}

export enum SyncMessageType {
  // Connection
  CONNECT = 'connect',
  DISCONNECT = 'disconnect',
  PING = 'ping',
  PONG = 'pong',
  
  // Task Operations
  TASK_CREATE = 'task:create',
  TASK_UPDATE = 'task:update',
  TASK_DELETE = 'task:delete',
  TASK_BATCH_UPDATE = 'task:batch_update',
  
  // PRD Operations
  PRD_PARSE = 'prd:parse',
  PRD_UPDATE = 'prd:update',
  PRD_PARSE_RESULT = 'prd:parse_result',
  
  // Sync Operations
  SYNC_REQUEST = 'sync:request',
  SYNC_RESPONSE = 'sync:response',
  SYNC_CONFLICT = 'sync:conflict',
  SYNC_RESOLUTION = 'sync:resolution',
  
  // Status Operations
  STATUS_UPDATE = 'status:update',
  STATUS_REQUEST = 'status:request',
  STATUS_RESPONSE = 'status:response',
  
  // Events
  EVENT_TASK_CHANGED = 'event:task_changed',
  EVENT_PRD_CHANGED = 'event:prd_changed',
  EVENT_SYNC_STARTED = 'event:sync_started',
  EVENT_SYNC_COMPLETED = 'event:sync_completed',
  EVENT_ERROR = 'event:error'
}

export interface SyncState {
  isConnected: boolean;
  lastSync: Date | null;
  pendingChanges: Map<string, PendingChange>;
  activeSync: boolean;
  conflicts: Map<string, Conflict>;
  syncVersion: number;
}

export interface PendingChange {
  taskId: string;
  operation: 'create' | 'update' | 'delete';
  task?: TaskMasterTask;
  timestamp: number;
  retryCount: number;
}

export interface SyncServiceConfig {
  port: number;
  host: string;
  enableWebSocket: boolean;
  enableHttp: boolean;
  syncInterval: number; // milliseconds
  maxRetries: number;
  conflictResolutionStrategy: 'cli_wins' | 'vscode_wins' | 'newest_wins' | 'manual';
  offlineQueueSize: number;
  authToken?: string;
}

export interface VSCodeClient {
  id: string;
  socket: WebSocket;
  connectedAt: Date;
  lastActivity: Date;
  version: string;
  capabilities: string[];
}

export class VSCodeSyncService extends EventEmitter {
  private config: SyncServiceConfig;
  private httpServer: HttpServer | null = null;
  private wsServer: WebSocketServer | null = null;
  private clients: Map<string, VSCodeClient> = new Map();
  private syncState: SyncState;
  private syncTimer: any;
  private taskCache: Map<string, TaskMasterTask> = new Map();
  private messageHandlers: Map<SyncMessageType, MessageHandler> = new Map();

  constructor(config: Partial<SyncServiceConfig> = {}) {
    super();
    
    this.config = {
      port: 8765,
      host: 'localhost',
      enableWebSocket: true,
      enableHttp: true,
      syncInterval: 5000,
      maxRetries: 3,
      conflictResolutionStrategy: 'newest_wins',
      offlineQueueSize: 1000,
      ...config
    };

    this.syncState = {
      isConnected: false,
      lastSync: null,
      pendingChanges: new Map(),
      activeSync: false,
      conflicts: new Map(),
      syncVersion: 0
    };

    this.setupMessageHandlers();
  }

  /**
   * Start the sync service
   */
  async start(): Promise<void> {
    try {
      if (this.config.enableHttp) {
        await this.startHttpServer();
      }

      if (this.config.enableWebSocket) {
        await this.startWebSocketServer();
      }

      this.startSyncTimer();
      
      logger.info('VS Code sync service started', {
        port: this.config.port,
        host: this.config.host,
        webSocket: this.config.enableWebSocket,
        http: this.config.enableHttp
      });

      this.emit('service:started');
    } catch (error) {
      logger.error('Failed to start VS Code sync service', error);
      throw error;
    }
  }

  /**
   * Stop the sync service
   */
  async stop(): Promise<void> {
    this.stopSyncTimer();

    // Close all client connections
    for (const client of this.clients.values()) {
      client.socket.close(1000, 'Service stopping');
    }
    this.clients.clear();

    if (this.wsServer) {
      await new Promise<void>((resolve) => {
        this.wsServer!.close(() => resolve());
      });
      this.wsServer = null;
    }

    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    logger.info('VS Code sync service stopped');
    this.emit('service:stopped');
  }

  /**
   * Send task update to all connected VS Code clients
   */
  async notifyTaskUpdate(task: TaskMasterTask, operation: 'create' | 'update' | 'delete'): Promise<void> {
    const message: SyncMessage = {
      id: this.generateMessageId(),
      type: operation === 'create' ? SyncMessageType.TASK_CREATE : 
            operation === 'update' ? SyncMessageType.TASK_UPDATE : 
            SyncMessageType.TASK_DELETE,
      timestamp: Date.now(),
      payload: { task },
      source: 'cli',
      version: '1.0.0'
    };

    await this.broadcast(message);
    
    // Update local cache
    if (operation === 'delete') {
      this.taskCache.delete(task.id);
    } else {
      this.taskCache.set(task.id, task);
    }
  }

  /**
   * Send PRD parse result to VS Code clients
   */
  async notifyPRDParseResult(result: any): Promise<void> {
    const message: SyncMessage = {
      id: this.generateMessageId(),
      type: SyncMessageType.PRD_PARSE_RESULT,
      timestamp: Date.now(),
      payload: result,
      source: 'cli',
      version: '1.0.0'
    };

    await this.broadcast(message);
  }

  /**
   * Request sync with all connected clients
   */
  async requestSync(): Promise<SyncResult> {
    if (this.syncState.activeSync) {
      logger.warn('Sync already in progress');
      return {
        success: false,
        syncedTasks: 0,
        conflicts: [],
        errors: ['Sync already in progress'],
        timestamp: new Date()
      };
    }

    this.syncState.activeSync = true;
    this.emit('sync:started');

    try {
      const message: SyncMessage = {
        id: this.generateMessageId(),
        type: SyncMessageType.SYNC_REQUEST,
        timestamp: Date.now(),
        payload: {
          syncVersion: this.syncState.syncVersion,
          taskCount: this.taskCache.size
        },
        source: 'cli',
        version: '1.0.0'
      };

      const responses = await this.broadcastAndWaitForResponses(message, 5000);
      
      // Process sync responses
      const result = await this.processSyncResponses(responses);
      
      this.syncState.lastSync = new Date();
      this.syncState.syncVersion++;
      
      this.emit('sync:completed', result);
      
      return result;
    } finally {
      this.syncState.activeSync = false;
    }
  }

  /**
   * Handle offline queue
   */
  async processPendingChanges(): Promise<void> {
    const pendingChanges = Array.from(this.syncState.pendingChanges.values());
    
    for (const change of pendingChanges) {
      if (change.retryCount >= this.config.maxRetries) {
        logger.error('Max retries exceeded for change', { taskId: change.taskId });
        this.syncState.pendingChanges.delete(change.taskId);
        continue;
      }

      try {
        await this.notifyTaskUpdate(change.task!, change.operation);
        this.syncState.pendingChanges.delete(change.taskId);
      } catch (error) {
        change.retryCount++;
        logger.warn('Failed to process pending change', { taskId: change.taskId, error });
      }
    }
  }

  /**
   * Get sync status
   */
  getSyncStatus(): SyncState & { clientCount: number } {
    return {
      ...this.syncState,
      clientCount: this.clients.size
    };
  }

  // Private methods

  private setupMessageHandlers(): void {
    // Connection handlers
    this.messageHandlers.set(SyncMessageType.CONNECT, this.handleConnect.bind(this));
    this.messageHandlers.set(SyncMessageType.DISCONNECT, this.handleDisconnect.bind(this));
    this.messageHandlers.set(SyncMessageType.PING, this.handlePing.bind(this));
    
    // Task handlers
    this.messageHandlers.set(SyncMessageType.TASK_CREATE, this.handleTaskCreate.bind(this));
    this.messageHandlers.set(SyncMessageType.TASK_UPDATE, this.handleTaskUpdate.bind(this));
    this.messageHandlers.set(SyncMessageType.TASK_DELETE, this.handleTaskDelete.bind(this));
    
    // PRD handlers
    this.messageHandlers.set(SyncMessageType.PRD_PARSE, this.handlePRDParse.bind(this));
    
    // Sync handlers
    this.messageHandlers.set(SyncMessageType.SYNC_RESPONSE, this.handleSyncResponse.bind(this));
    this.messageHandlers.set(SyncMessageType.SYNC_CONFLICT, this.handleSyncConflict.bind(this));
    
    // Status handlers
    this.messageHandlers.set(SyncMessageType.STATUS_UPDATE, this.handleStatusUpdate.bind(this));
  }

  private async startHttpServer(): Promise<void> {
    this.httpServer = createServer((req, res) => {
      // Handle HTTP API endpoints
      if (req.method === 'GET' && req.url === '/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.getSyncStatus()));
      } else if (req.method === 'POST' && req.url === '/sync') {
        this.handleHttpSync(req, res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    await new Promise<void>((resolve) => {
      this.httpServer!.listen(this.config.port, this.config.host, () => {
        logger.info(`HTTP server listening on ${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  private async startWebSocketServer(): Promise<void> {
    this.wsServer = new WebSocketServer({
      server: this.httpServer || undefined,
      port: this.httpServer ? undefined : this.config.port,
      host: this.config.host
    });

    this.wsServer.on('connection', (socket, request) => {
      const clientId = this.generateClientId();
      const client: VSCodeClient = {
        id: clientId,
        socket,
        connectedAt: new Date(),
        lastActivity: new Date(),
        version: '1.0.0',
        capabilities: []
      };

      this.clients.set(clientId, client);
      this.syncState.isConnected = true;

      logger.info('VS Code client connected', { clientId });

      socket.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString()) as SyncMessage;
          client.lastActivity = new Date();
          await this.handleMessage(client, message);
        } catch (error) {
          logger.error('Error handling message', error);
          this.sendError(client, 'Invalid message format');
        }
      });

      socket.on('close', () => {
        this.clients.delete(clientId);
        this.syncState.isConnected = this.clients.size > 0;
        logger.info('VS Code client disconnected', { clientId });
      });

      socket.on('error', (error) => {
        logger.error('WebSocket error', { clientId, error });
      });

      // Send initial connection acknowledgment
      this.sendMessage(client, {
        id: this.generateMessageId(),
        type: SyncMessageType.CONNECT,
        timestamp: Date.now(),
        payload: { 
          clientId,
          syncVersion: this.syncState.syncVersion,
          taskCount: this.taskCache.size
        },
        source: 'cli',
        version: '1.0.0'
      });
    });
  }

  private async handleMessage(client: VSCodeClient, message: SyncMessage): Promise<void> {
    const handler = this.messageHandlers.get(message.type);
    
    if (handler) {
      try {
        await handler(client, message);
      } catch (error) {
        logger.error('Error handling message', { type: message.type, error });
        this.sendError(client, `Failed to handle ${message.type}`);
      }
    } else {
      logger.warn('Unknown message type', { type: message.type });
    }
  }

  private async handleConnect(client: VSCodeClient, message: SyncMessage): Promise<void> {
    client.version = message.payload.version || '1.0.0';
    client.capabilities = message.payload.capabilities || [];
    
    this.emit('client:connected', { clientId: client.id });
  }

  private async handleDisconnect(client: VSCodeClient, message: SyncMessage): Promise<void> {
    client.socket.close();
  }

  private async handlePing(client: VSCodeClient, message: SyncMessage): Promise<void> {
    this.sendMessage(client, {
      id: message.id,
      type: SyncMessageType.PONG,
      timestamp: Date.now(),
      payload: {},
      source: 'cli',
      version: '1.0.0'
    });
  }

  private async handleTaskCreate(client: VSCodeClient, message: SyncMessage): Promise<void> {
    const task = message.payload.task as TaskMasterTask;
    
    // Validate task
    if (!task.id || !task.title) {
      this.sendError(client, 'Invalid task data');
      return;
    }

    // Check for conflicts
    if (this.taskCache.has(task.id)) {
      const conflict: Conflict = {
        taskId: task.id,
        field: 'task',
        taskMasterValue: task,
        claudeFlowValue: this.taskCache.get(task.id),
        source: 'taskmaster'
      };
      
      this.syncState.conflicts.set(task.id, conflict);
      
      this.sendMessage(client, {
        id: this.generateMessageId(),
        type: SyncMessageType.SYNC_CONFLICT,
        timestamp: Date.now(),
        payload: { conflict },
        source: 'cli',
        version: '1.0.0'
      });
      
      return;
    }

    // Add task to cache
    this.taskCache.set(task.id, task);
    
    // Emit event for CLI handlers
    this.emit('task:created', task);
    
    // Broadcast to other clients
    await this.broadcastExcept(client.id, message);
  }

  private async handleTaskUpdate(client: VSCodeClient, message: SyncMessage): Promise<void> {
    const task = message.payload.task as TaskMasterTask;
    
    // Update task in cache
    this.taskCache.set(task.id, task);
    
    // Emit event for CLI handlers
    this.emit('task:updated', task);
    
    // Broadcast to other clients
    await this.broadcastExcept(client.id, message);
  }

  private async handleTaskDelete(client: VSCodeClient, message: SyncMessage): Promise<void> {
    const taskId = message.payload.taskId;
    
    // Remove from cache
    this.taskCache.delete(taskId);
    
    // Emit event for CLI handlers
    this.emit('task:deleted', taskId);
    
    // Broadcast to other clients
    await this.broadcastExcept(client.id, message);
  }

  private async handlePRDParse(client: VSCodeClient, message: SyncMessage): Promise<void> {
    const { content, options } = message.payload;
    
    // Emit event for PRD parser to handle
    this.emit('prd:parse:requested', { client, content, options });
  }

  private async handleSyncResponse(client: VSCodeClient, message: SyncMessage): Promise<void> {
    // Handle sync response from client
    this.emit('sync:response', { client, response: message.payload });
  }

  private async handleSyncConflict(client: VSCodeClient, message: SyncMessage): Promise<void> {
    const conflict = message.payload.conflict as Conflict;
    this.syncState.conflicts.set(conflict.taskId, conflict);
    
    // Emit event for conflict resolution
    this.emit('sync:conflict', conflict);
  }

  private async handleStatusUpdate(client: VSCodeClient, message: SyncMessage): Promise<void> {
    const { taskId, status } = message.payload;
    
    const task = this.taskCache.get(taskId);
    if (task) {
      task.status = status;
      task.updatedAt = new Date();
      
      // Emit event for status change
      this.emit('task:status:changed', { taskId, status });
      
      // Broadcast to other clients
      await this.broadcastExcept(client.id, {
        ...message,
        source: 'cli'
      });
    }
  }

  private async handleHttpSync(req: any, res: any): Promise<void> {
    let body = '';
    
    req.on('data', (chunk: any) => {
      body += chunk.toString();
    });
    
    req.on('end', async () => {
      try {
        const data = JSON.parse(body);
        const result = await this.requestSync();
        
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid request' }));
      }
    });
  }

  private sendMessage(client: VSCodeClient, message: SyncMessage): void {
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(JSON.stringify(message));
    }
  }

  private sendError(client: VSCodeClient, error: string): void {
    this.sendMessage(client, {
      id: this.generateMessageId(),
      type: SyncMessageType.EVENT_ERROR,
      timestamp: Date.now(),
      payload: { error },
      source: 'cli',
      version: '1.0.0'
    });
  }

  private async broadcast(message: SyncMessage): Promise<void> {
    const promises = Array.from(this.clients.values()).map(client => {
      return new Promise<void>((resolve) => {
        if (client.socket.readyState === WebSocket.OPEN) {
          client.socket.send(JSON.stringify(message), (err) => {
            if (err) logger.error('Broadcast error', err);
            resolve();
          });
        } else {
          resolve();
        }
      });
    });

    await Promise.all(promises);
  }

  private async broadcastExcept(excludeClientId: string, message: SyncMessage): Promise<void> {
    const promises = Array.from(this.clients.values())
      .filter(client => client.id !== excludeClientId)
      .map(client => {
        return new Promise<void>((resolve) => {
          if (client.socket.readyState === WebSocket.OPEN) {
            client.socket.send(JSON.stringify(message), (err) => {
              if (err) logger.error('Broadcast error', err);
              resolve();
            });
          } else {
            resolve();
          }
        });
      });

    await Promise.all(promises);
  }

  private async broadcastAndWaitForResponses(
    message: SyncMessage, 
    timeout: number
  ): Promise<Map<string, any>> {
    const responses = new Map<string, any>();
    const responsePromises: Promise<void>[] = [];

    for (const client of this.clients.values()) {
      const promise = new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), timeout);
        
        const responseHandler = (msg: SyncMessage) => {
          if (msg.type === SyncMessageType.SYNC_RESPONSE) {
            responses.set(client.id, msg.payload);
            clearTimeout(timer);
            resolve();
          }
        };

        // Set up temporary response handler
        const originalOnMessage = client.socket.onmessage;
        client.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data.toString()) as SyncMessage;
            responseHandler(msg);
          } catch (error) {
            logger.error('Error parsing response', error);
          }
          
          // Restore original handler
          if (originalOnMessage) {
            originalOnMessage.call(client.socket, event);
          }
        };

        // Send message
        this.sendMessage(client, message);
      });

      responsePromises.push(promise);
    }

    await Promise.all(responsePromises);
    return responses;
  }

  private async processSyncResponses(responses: Map<string, any>): Promise<SyncResult> {
    let syncedTasks = 0;
    const conflicts: Conflict[] = [];
    const errors: string[] = [];

    for (const [clientId, response] of responses.entries()) {
      if (response.tasks) {
        for (const task of response.tasks) {
          const existingTask = this.taskCache.get(task.id);
          
          if (existingTask && existingTask.updatedAt !== task.updatedAt) {
            // Conflict detected
            const conflict: Conflict = {
              taskId: task.id,
              field: 'task',
              taskMasterValue: task,
              claudeFlowValue: existingTask,
              source: 'taskmaster'
            };
            
            conflicts.push(conflict);
          } else {
            // Update task
            this.taskCache.set(task.id, task);
            syncedTasks++;
          }
        }
      }

      if (response.error) {
        errors.push(`Client ${clientId}: ${response.error}`);
      }
    }

    // Resolve conflicts based on strategy
    if (conflicts.length > 0) {
      await this.resolveConflicts(conflicts);
    }

    return {
      success: errors.length === 0,
      syncedTasks,
      conflicts,
      errors,
      timestamp: new Date()
    };
  }

  private async resolveConflicts(conflicts: Conflict[]): Promise<void> {
    for (const conflict of conflicts) {
      let resolution: Resolution;
      
      switch (this.config.conflictResolutionStrategy) {
        case 'cli_wins':
          resolution = {
            taskId: conflict.taskId,
            field: conflict.field,
            resolvedValue: conflict.claudeFlowValue,
            strategy: 'claudeflow_wins'
          };
          break;
          
        case 'vscode_wins':
          resolution = {
            taskId: conflict.taskId,
            field: conflict.field,
            resolvedValue: conflict.taskMasterValue,
            strategy: 'taskmaster_wins'
          };
          break;
          
        case 'newest_wins':
          const cliTask = conflict.claudeFlowValue as TaskMasterTask;
          const vscodeTask = conflict.taskMasterValue as TaskMasterTask;
          
          resolution = {
            taskId: conflict.taskId,
            field: conflict.field,
            resolvedValue: cliTask.updatedAt > vscodeTask.updatedAt ? cliTask : vscodeTask,
            strategy: 'merge'
          };
          break;
          
        case 'manual':
        default:
          // Emit conflict for manual resolution
          this.emit('conflict:needs_resolution', conflict);
          continue;
      }

      // Apply resolution
      if (resolution.strategy !== 'manual') {
        this.taskCache.set(conflict.taskId, resolution.resolvedValue);
        
        // Notify all clients of resolution
        await this.broadcast({
          id: this.generateMessageId(),
          type: SyncMessageType.SYNC_RESOLUTION,
          timestamp: Date.now(),
          payload: { resolution },
          source: 'cli',
          version: '1.0.0'
        });
      }
    }
  }

  private startSyncTimer(): void {
    if (this.config.syncInterval > 0) {
      this.syncTimer = setInterval(async () => {
        if (this.clients.size > 0 && !this.syncState.activeSync) {
          await this.requestSync();
        }
        
        // Process any pending changes
        if (this.syncState.pendingChanges.size > 0) {
          await this.processPendingChanges();
        }
      }, this.config.syncInterval);
    }
  }

  private stopSyncTimer(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  private generateMessageId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateClientId(): string {
    return `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Message handler type
type MessageHandler = (client: VSCodeClient, message: SyncMessage) => Promise<void>;

// Export for use in CLI
export default VSCodeSyncService;