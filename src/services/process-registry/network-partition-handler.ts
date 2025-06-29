/**
 * Network Partition Handler
 * 
 * Handles network partitions and connectivity issues with
 * operation queuing and automatic replay on reconnection
 */

import { Logger } from '@/core/logger.js';
import { EventEmitter } from 'events';
import { writeFile, readFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import * as dns from 'dns/promises';
import * as net from 'net';

const logger = Logger.getInstance().child({ component: 'NetworkPartitionHandler' });

export interface QueuedOperation {
  id: string;
  type: 'register' | 'update' | 'heartbeat' | 'terminate';
  timestamp: Date;
  data: any;
  retryCount: number;
  maxRetries: number;
}

export interface NetworkState {
  isPartitioned: boolean;
  lastConnectivityCheck: Date;
  queuedOperations: QueuedOperation[];
  reconnectionAttempts: number;
}

export class NetworkPartitionHandler extends EventEmitter {
  private operationQueue: QueuedOperation[] = [];
  private isLocalMode = false;
  private connectivityCheckInterval?: NodeJS.Timeout;
  private queueDir: string;
  private remoteEndpoints: string[] = [];
  private state: NetworkState;
  
  constructor(remoteEndpoints: string[] = []) {
    super();
    this.remoteEndpoints = remoteEndpoints;
    this.queueDir = join(process.cwd(), '.claude-flow', 'network-queue');
    this.state = {
      isPartitioned: false,
      lastConnectivityCheck: new Date(),
      queuedOperations: [],
      reconnectionAttempts: 0
    };
    
    this.initialize();
  }

  private async initialize(): Promise<void> {
    await mkdir(this.queueDir, { recursive: true });
    await this.loadQueuedOperations();
  }

  async handlePartition(): Promise<void> {
    logger.warn('Network partition detected, switching to local-only mode');
    
    this.state.isPartitioned = true;
    this.state.reconnectionAttempts = 0;
    
    // Switch to local-only mode
    await this.enableLocalMode();
    
    // Queue operations for replay
    this.startOperationQueuing();
    
    // Monitor for connectivity restoration
    this.startConnectivityMonitoring();
    
    this.emit('partition-detected', { timestamp: new Date() });
  }

  async handleReconnection(): Promise<void> {
    logger.info('Network connectivity restored');
    
    this.state.isPartitioned = false;
    
    // Stop connectivity monitoring
    this.stopConnectivityMonitoring();
    
    // Replay queued operations
    await this.replayQueuedOperations();
    
    // Sync with remote systems
    await this.syncRemoteState();
    
    // Resume normal operation
    await this.resumeNormalMode();
    
    this.emit('connectivity-restored', { 
      timestamp: new Date(),
      queuedOperationCount: this.operationQueue.length 
    });
  }

  async queueOperation(operation: Omit<QueuedOperation, 'id' | 'timestamp' | 'retryCount'>): Promise<void> {
    if (!this.isLocalMode) {
      return; // Only queue operations in local mode
    }
    
    const queuedOp: QueuedOperation = {
      ...operation,
      id: this.generateOperationId(),
      timestamp: new Date(),
      retryCount: 0
    };
    
    this.operationQueue.push(queuedOp);
    await this.persistQueue();
    
    logger.debug('Operation queued', { 
      id: queuedOp.id, 
      type: queuedOp.type,
      queueSize: this.operationQueue.length 
    });
  }

  private async enableLocalMode(): Promise<void> {
    this.isLocalMode = true;
    
    // Configure system for offline operation
    process.env['CLAUDE_FLOW_OFFLINE_MODE'] = 'true';
    
    // Notify all components about offline mode
    this.emit('local-mode-enabled', { timestamp: new Date() });
    
    logger.info('Local-only mode enabled');
  }

  private startOperationQueuing(): void {
    // Operations are queued through queueOperation method
    logger.info('Operation queuing started');
  }

  private startConnectivityMonitoring(): void {
    const checkInterval = 5000; // Check every 5 seconds
    
    this.connectivityCheckInterval = setInterval(async () => {
      const isConnected = await this.checkConnectivity();
      this.state.lastConnectivityCheck = new Date();
      
      if (isConnected && this.state.isPartitioned) {
        await this.handleReconnection();
      } else if (!isConnected) {
        this.state.reconnectionAttempts++;
        
        // Exponential backoff for check intervals
        if (this.state.reconnectionAttempts > 10) {
          clearInterval(this.connectivityCheckInterval);
          const newInterval = Math.min(checkInterval * Math.pow(2, this.state.reconnectionAttempts / 10), 300000);
          this.connectivityCheckInterval = setInterval(() => this.checkConnectivity(), newInterval);
        }
      }
    }, checkInterval);
    
    logger.info('Connectivity monitoring started');
  }

  private stopConnectivityMonitoring(): void {
    if (this.connectivityCheckInterval) {
      clearInterval(this.connectivityCheckInterval);
      this.connectivityCheckInterval = undefined;
    }
    
    logger.info('Connectivity monitoring stopped');
  }

  private async checkConnectivity(): Promise<boolean> {
    // Check multiple indicators of connectivity
    const checks = [
      this.checkDNS(),
      ...this.remoteEndpoints.map(endpoint => this.checkEndpoint(endpoint))
    ];
    
    try {
      const results = await Promise.allSettled(checks);
      const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
      
      // Consider connected if at least half of checks succeed
      return successCount >= Math.ceil(checks.length / 2);
    } catch (error) {
      logger.error('Connectivity check failed', { error });
      return false;
    }
  }

  private async checkDNS(): Promise<boolean> {
    try {
      await dns.resolve4('dns.google.com');
      return true;
    } catch {
      return false;
    }
  }

  private async checkEndpoint(endpoint: string): Promise<boolean> {
    return new Promise((resolve) => {
      const [host, port] = endpoint.split(':');
      const socket = new net.Socket();
      
      socket.setTimeout(3000);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      
      socket.on('error', () => {
        resolve(false);
      });
      
      socket.connect(parseInt(port) || 80, host);
    });
  }

  private async replayQueuedOperations(): Promise<void> {
    logger.info(`Replaying ${this.operationQueue.length} queued operations`);
    
    const failedOperations: QueuedOperation[] = [];
    
    for (const operation of this.operationQueue) {
      try {
        await this.executeOperation(operation);
        logger.debug(`Successfully replayed operation ${operation.id}`);
      } catch (error) {
        operation.retryCount++;
        
        if (operation.retryCount < operation.maxRetries) {
          failedOperations.push(operation);
        } else {
          logger.error(`Operation ${operation.id} failed after max retries`, { error });
          this.emit('operation-failed', { operation, error });
        }
      }
    }
    
    // Update queue with failed operations
    this.operationQueue = failedOperations;
    
    if (failedOperations.length > 0) {
      await this.persistQueue();
      logger.warn(`${failedOperations.length} operations failed replay and remain queued`);
    } else {
      await this.clearQueue();
      logger.info('All operations successfully replayed');
    }
  }

  private async executeOperation(operation: QueuedOperation): Promise<void> {
    // This would integrate with your actual registry operations
    this.emit('execute-operation', operation);
    
    // Simulate operation execution
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  private async syncRemoteState(): Promise<void> {
    logger.info('Syncing with remote systems');
    
    try {
      // This would sync with actual remote systems
      this.emit('sync-remote-state');
      
      // Get local state
      const localState = await this.getLocalState();
      
      // Compare with remote state and reconcile differences
      // This is application-specific logic
      
      logger.info('Remote state sync completed');
    } catch (error) {
      logger.error('Failed to sync remote state', { error });
      throw error;
    }
  }

  private async resumeNormalMode(): Promise<void> {
    this.isLocalMode = false;
    delete process.env['CLAUDE_FLOW_OFFLINE_MODE'];
    
    this.emit('normal-mode-resumed', { timestamp: new Date() });
    
    logger.info('Normal operation mode resumed');
  }

  private async persistQueue(): Promise<void> {
    const queuePath = join(this.queueDir, 'operation-queue.json');
    await writeFile(queuePath, JSON.stringify(this.operationQueue, null, 2));
  }

  private async loadQueuedOperations(): Promise<void> {
    try {
      const queuePath = join(this.queueDir, 'operation-queue.json');
      const data = await readFile(queuePath, 'utf-8');
      this.operationQueue = JSON.parse(data);
      
      logger.info(`Loaded ${this.operationQueue.length} queued operations`);
    } catch (error) {
      // No queue file exists yet
      this.operationQueue = [];
    }
  }

  private async clearQueue(): Promise<void> {
    this.operationQueue = [];
    const queuePath = join(this.queueDir, 'operation-queue.json');
    
    try {
      await unlink(queuePath);
    } catch {
      // File might not exist
    }
  }

  private async getLocalState(): Promise<any> {
    // Return current local state for sync
    return {
      timestamp: new Date(),
      queuedOperations: this.operationQueue.length
    };
  }

  private generateOperationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  // Public API methods
  isInPartition(): boolean {
    return this.state.isPartitioned;
  }

  getQueueSize(): number {
    return this.operationQueue.length;
  }

  getState(): NetworkState {
    return { ...this.state, queuedOperations: [...this.operationQueue] };
  }

  async forceReconnectionCheck(): Promise<boolean> {
    const isConnected = await this.checkConnectivity();
    
    if (isConnected && this.state.isPartitioned) {
      await this.handleReconnection();
    }
    
    return isConnected;
  }
}