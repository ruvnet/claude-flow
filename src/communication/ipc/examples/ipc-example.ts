/**
 * IPC Usage Examples
 * Demonstrates practical usage of the Claude-Flow IPC layer
 */

import { 
  IPCFactory,
  IPCServer,
  IPCClient,
  MessageType,
  IPCMessage,
  createOrchestratorServer,
  createOrchestratorClient,
  createAgentServer,
  createAgentClient,
  IPCPaths,
  cleanupIPCResources
} from '../index.js';

/**
 * Example 1: Basic Server and Client
 */
export async function basicExample(): Promise<void> {
  console.log('=== Basic IPC Example ===');
  
  // Create server
  const server = IPCFactory.createServer({
    path: IPCPaths.getOrchestratorPath()
  });
  
  // Register a command handler
  server.registerHandler('greet', async (payload) => {
    const { name } = payload;
    return { message: `Hello, ${name}!` };
  });
  
  // Start server
  await server.start();
  console.log('Server started');
  
  // Create client
  const client = IPCFactory.createClient({
    path: IPCPaths.getOrchestratorPath()
  });
  
  // Connect client
  await client.connect();
  console.log('Client connected');
  
  // Send request
  const response = await client.request('greet', { name: 'Claude' });
  console.log('Response:', response);
  
  // Cleanup
  await client.disconnect();
  await server.stop();
}

/**
 * Example 2: Multi-Agent Communication
 */
export async function multiAgentExample(): Promise<void> {
  console.log('\n=== Multi-Agent Communication Example ===');
  
  // Create orchestrator
  const orchestrator = createOrchestratorServer();
  const agents: Map<string, { server: IPCServer; client: IPCClient }> = new Map();
  
  // Register orchestrator handlers
  orchestrator.registerHandler('register-agent', async (payload) => {
    console.log('Agent registered:', payload);
    return { success: true };
  });
  
  orchestrator.registerHandler('task-assignment', async (payload) => {
    const { agentId, task } = payload;
    console.log(`Assigning task to agent ${agentId}:`, task);
    
    // Broadcast to all agents
    await orchestrator.broadcast({
      id: crypto.randomUUID(),
      type: MessageType.COMMAND_EVENT,
      command: 'new-task',
      timestamp: new Date(),
      payload: { agentId, task }
    });
    
    return { assigned: true };
  });
  
  await orchestrator.start();
  console.log('Orchestrator started');
  
  // Create multiple agents
  for (let i = 0; i < 3; i++) {
    const agentId = `agent-${i}`;
    
    // Create agent server
    const agentServer = createAgentServer(agentId);
    agentServer.registerHandler('execute-task', async (payload) => {
      console.log(`Agent ${agentId} executing task:`, payload);
      return { result: `Task completed by ${agentId}` };
    });
    
    await agentServer.start();
    
    // Create agent client to orchestrator
    const agentClient = createOrchestratorClient();
    
    agentClient.on('message', (message) => {
      if (message.command === 'new-task' && message.payload.agentId === agentId) {
        console.log(`Agent ${agentId} received task assignment`);
      }
    });
    
    await agentClient.connect();
    
    // Register agent with orchestrator
    await agentClient.request('register-agent', {
      agentId,
      type: 'worker',
      capabilities: ['execute-task']
    });
    
    agents.set(agentId, { server: agentServer, client: agentClient });
  }
  
  // Simulate task assignment
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  const taskClient = createOrchestratorClient();
  await taskClient.connect();
  
  await taskClient.request('task-assignment', {
    agentId: 'agent-1',
    task: { type: 'compute', data: [1, 2, 3] }
  });
  
  // Cleanup
  await taskClient.disconnect();
  
  for (const [agentId, { server, client }] of agents) {
    await client.disconnect();
    await server.stop();
  }
  
  await orchestrator.stop();
}

/**
 * Example 3: Secure Communication
 */
export async function secureExample(): Promise<void> {
  console.log('\n=== Secure Communication Example ===');
  
  const authToken = 'my-secure-token-12345';
  
  // Create secure server
  const server = IPCFactory.createServer({
    security: {
      enableAuthentication: true,
      enableEncryption: true,
      authToken,
      allowedProcesses: ['claude-flow'],
      maxMessageSize: 1024 * 1024, // 1MB
      rateLimitPerSecond: 10
    }
  });
  
  server.registerHandler('secure-data', async (payload) => {
    return { 
      secret: 'This is encrypted data',
      timestamp: new Date()
    };
  });
  
  await server.start();
  console.log('Secure server started');
  
  // Create secure client
  const client = IPCFactory.createClient({
    security: {
      enableAuthentication: true,
      enableEncryption: true,
      authToken
    }
  });
  
  await client.connect();
  console.log('Secure client connected');
  
  // Send encrypted request
  const response = await client.request('secure-data');
  console.log('Secure response:', response);
  
  // Test rate limiting
  console.log('\nTesting rate limiting...');
  for (let i = 0; i < 15; i++) {
    try {
      await client.request('ping');
      console.log(`Request ${i + 1}: Success`);
    } catch (error: any) {
      console.log(`Request ${i + 1}: ${error.message}`);
    }
  }
  
  // Cleanup
  await client.disconnect();
  await server.stop();
}

/**
 * Example 4: Process Management
 */
export async function processManagementExample(): Promise<void> {
  console.log('\n=== Process Management Example ===');
  
  // Create process registry
  const registry = createOrchestratorServer();
  const processes: Map<string, any> = new Map();
  
  // Setup process management handlers
  registry.on('process-message', (connection, message) => {
    switch (message.type) {
      case MessageType.PROCESS_REGISTER:
        const processInfo = {
          ...message.payload,
          id: crypto.randomUUID(),
          connectionId: connection.id,
          registeredAt: new Date()
        };
        processes.set(processInfo.id, processInfo);
        console.log('Process registered:', processInfo);
        break;
        
      case MessageType.PROCESS_HEARTBEAT:
        const process = Array.from(processes.values())
          .find(p => p.connectionId === connection.id);
        if (process) {
          process.lastHeartbeat = new Date();
          console.log(`Heartbeat from ${process.processName}`);
        }
        break;
        
      case MessageType.PROCESS_STATUS:
        console.log('Process status update:', message.payload);
        break;
    }
  });
  
  await registry.start();
  console.log('Process registry started');
  
  // Simulate multiple processes
  const processClients: IPCClient[] = [];
  
  for (let i = 0; i < 3; i++) {
    const client = createOrchestratorClient();
    await client.connect();
    
    // Register process
    await client.send({
      id: crypto.randomUUID(),
      type: MessageType.PROCESS_REGISTER,
      timestamp: new Date(),
      payload: {
        processName: `worker-${i}`,
        processType: 'agent',
        pid: process.pid + i,
        capabilities: ['task-execution', 'data-processing']
      }
    });
    
    processClients.push(client);
  }
  
  // Send heartbeats
  console.log('\nSending heartbeats...');
  for (const client of processClients) {
    await client.send({
      id: crypto.randomUUID(),
      type: MessageType.PROCESS_HEARTBEAT,
      timestamp: new Date()
    });
  }
  
  // List registered processes
  console.log('\nRegistered processes:');
  processes.forEach((process, id) => {
    console.log(`- ${process.processName} (${id})`);
  });
  
  // Cleanup
  for (const client of processClients) {
    await client.disconnect();
  }
  await registry.stop();
}

/**
 * Example 5: Error Handling and Reconnection
 */
export async function errorHandlingExample(): Promise<void> {
  console.log('\n=== Error Handling Example ===');
  
  // Create client with reconnection enabled
  const client = IPCFactory.createClient({
    reconnectAttempts: 3,
    reconnectDelay: 1000,
    heartbeatInterval: 2000
  });
  
  client.on('error', (error) => {
    console.log('Client error:', error.message);
  });
  
  client.on('disconnected', () => {
    console.log('Client disconnected');
  });
  
  client.on('connected', () => {
    console.log('Client connected/reconnected');
  });
  
  try {
    // Try to connect (server not running)
    await client.connect();
  } catch (error: any) {
    console.log('Initial connection failed:', error.message);
  }
  
  // Start server after delay
  setTimeout(async () => {
    console.log('\nStarting server...');
    const server = IPCFactory.createServer();
    
    server.registerHandler('test', async () => {
      return { success: true };
    });
    
    await server.start();
    console.log('Server started - client should reconnect');
    
    // Wait for reconnection
    setTimeout(async () => {
      if (client.isConnected()) {
        const response = await client.request('test');
        console.log('Request after reconnection:', response);
      }
      
      await client.disconnect();
      await server.stop();
    }, 3000);
  }, 2000);
}

/**
 * Run all examples
 */
export async function runAllExamples(): Promise<void> {
  try {
    await basicExample();
    await multiAgentExample();
    await secureExample();
    await processManagementExample();
    await errorHandlingExample();
    
    // Cleanup IPC resources
    await cleanupIPCResources();
    console.log('\nAll examples completed successfully!');
  } catch (error) {
    console.error('Example error:', error);
  }
}

// Helper to import crypto
import * as crypto from 'crypto';

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllExamples();
}