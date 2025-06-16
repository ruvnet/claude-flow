/**
 * Example VS Code Extension Client
 * Demonstrates how to connect and interact with the TaskMaster sync service
 */

import WebSocket from 'ws';
import { SyncMessage, SyncMessageType } from '../services/vscode-sync-service.ts';

export class VSCodeExtensionClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<SyncMessageType, (payload: any) => void> = new Map();
  private pendingRequests: Map<string, (response: any) => void> = new Map();
  private clientId: string | null = null;

  constructor(private url: string = 'ws://localhost:8765') {}

  /**
   * Connect to the sync service
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        console.log('Connected to TaskMaster sync service');
        
        // Send connect message
        this.sendMessage({
          type: SyncMessageType.CONNECT,
          payload: {
            version: '1.0.0',
            capabilities: ['prd-parsing', 'ai-generation', 'real-time-sync']
          }
        });
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString()) as SyncMessage;
          this.handleMessage(message);
          
          // Resolve connection promise on connect response
          if (message.type === SyncMessageType.CONNECT && !this.clientId) {
            this.clientId = message.payload.clientId;
            resolve();
          }
        } catch (error) {
          console.error('Error handling message:', error);
        }
      });

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        console.log('Disconnected from TaskMaster sync service');
        this.ws = null;
        this.clientId = null;
      });

      // Set up default handlers
      this.setupDefaultHandlers();
    });
  }

  /**
   * Disconnect from the sync service
   */
  disconnect(): void {
    if (this.ws) {
      this.sendMessage({
        type: SyncMessageType.DISCONNECT,
        payload: {}
      });
      this.ws.close();
    }
  }

  /**
   * Create a new task
   */
  async createTask(task: any): Promise<void> {
    this.sendMessage({
      type: SyncMessageType.TASK_CREATE,
      payload: { task }
    });
  }

  /**
   * Update an existing task
   */
  async updateTask(task: any): Promise<void> {
    this.sendMessage({
      type: SyncMessageType.TASK_UPDATE,
      payload: { task }
    });
  }

  /**
   * Delete a task
   */
  async deleteTask(taskId: string): Promise<void> {
    this.sendMessage({
      type: SyncMessageType.TASK_DELETE,
      payload: { taskId }
    });
  }

  /**
   * Request PRD parsing
   */
  async parsePRD(content: string, options: any = {}): Promise<any> {
    return new Promise((resolve) => {
      const messageId = this.generateMessageId();
      
      this.pendingRequests.set(messageId, resolve);
      
      this.sendMessage({
        id: messageId,
        type: SyncMessageType.PRD_PARSE,
        payload: { content, options }
      });
    });
  }

  /**
   * Request full sync
   */
  async requestSync(): Promise<any> {
    return new Promise((resolve) => {
      const messageId = this.generateMessageId();
      
      this.pendingRequests.set(messageId, resolve);
      
      this.sendMessage({
        id: messageId,
        type: SyncMessageType.SYNC_REQUEST,
        payload: {}
      });
    });
  }

  /**
   * Register a message handler
   */
  on(type: SyncMessageType, handler: (payload: any) => void): void {
    this.messageHandlers.set(type, handler);
  }

  // Private methods

  private sendMessage(message: Partial<SyncMessage>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not connected');
      return;
    }

    const fullMessage: SyncMessage = {
      id: message.id || this.generateMessageId(),
      type: message.type!,
      timestamp: Date.now(),
      payload: message.payload || {},
      source: 'vscode',
      version: '1.0.0'
    };

    this.ws.send(JSON.stringify(fullMessage));
  }

  private handleMessage(message: SyncMessage): void {
    // Check if this is a response to a pending request
    if (message.id && this.pendingRequests.has(message.id)) {
      const handler = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      handler(message.payload);
      return;
    }

    // Handle by type
    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      handler(message.payload);
    } else {
      console.log('Unhandled message type:', message.type, message.payload);
    }
  }

  private setupDefaultHandlers(): void {
    // Handle ping
    this.on(SyncMessageType.PING, () => {
      this.sendMessage({
        type: SyncMessageType.PONG,
        payload: {}
      });
    });

    // Log task changes
    this.on(SyncMessageType.TASK_CREATE, (payload) => {
      console.log('Task created:', payload.task);
    });

    this.on(SyncMessageType.TASK_UPDATE, (payload) => {
      console.log('Task updated:', payload.task);
    });

    this.on(SyncMessageType.TASK_DELETE, (payload) => {
      console.log('Task deleted:', payload.taskId);
    });

    // Handle conflicts
    this.on(SyncMessageType.SYNC_CONFLICT, (payload) => {
      console.log('Sync conflict:', payload.conflict);
      // In a real extension, you'd show UI for conflict resolution
    });

    // Handle errors
    this.on(SyncMessageType.EVENT_ERROR, (payload) => {
      console.error('Error from sync service:', payload.error);
    });
  }

  private generateMessageId(): string {
    return `vscode-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Example usage
async function demonstrateSync() {
  const client = new VSCodeExtensionClient();

  try {
    // Connect to sync service
    await client.connect();
    console.log('✓ Connected to TaskMaster sync service');

    // Create a task
    await client.createTask({
      id: 'task-123',
      title: 'Implement user authentication',
      description: 'Add JWT-based authentication to the API',
      status: 'todo',
      priority: 3,
      tags: ['backend', 'security'],
      estimate: 8,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        ai_generated: true,
        model_used: 'claude-3'
      }
    });
    console.log('✓ Task created');

    // Update task status
    await client.updateTask({
      id: 'task-123',
      status: 'in_progress',
      updatedAt: new Date().toISOString()
    });
    console.log('✓ Task updated');

    // Parse a PRD
    const prdContent = `
# Product Requirements Document

## Overview
Build a real-time chat application with user authentication.

## Requirements
1. User registration and login
2. Real-time messaging
3. Message history
4. User presence indicators
    `;

    console.log('📄 Parsing PRD...');
    const parseResult = await client.parsePRD(prdContent, {
      generateTasks: true,
      estimateComplexity: true,
      useAI: true
    });
    
    // Note: In real implementation, this would wait for PRD_PARSE_RESULT
    console.log('✓ PRD parse requested');

    // Request sync
    console.log('🔄 Requesting sync...');
    const syncResult = await client.requestSync();
    console.log('✓ Sync completed');

    // Keep connection alive for a bit to receive messages
    await new Promise(resolve => setTimeout(resolve, 5000));

  } catch (error) {
    console.error('Error:', error);
  } finally {
    client.disconnect();
  }
}

// Run demo if this file is executed directly
if (import.meta.main) {
  demonstrateSync().catch(console.error);
}

export default VSCodeExtensionClient;