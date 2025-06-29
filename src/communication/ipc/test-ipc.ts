#!/usr/bin/env node
/**
 * Quick test script for IPC implementation
 */

import { IPCFactory } from './index.js';

async function testBasicIPC() {
  console.log('Testing Claude-Flow IPC Layer...\n');
  
  try {
    // Create server
    console.log('1. Creating IPC server...');
    const server = IPCFactory.createServer();
    
    // Register test handler
    server.registerHandler('test', async (payload) => {
      console.log('   Server received:', payload);
      return { 
        echo: payload,
        timestamp: new Date().toISOString(),
        pid: process.pid
      };
    });
    
    // Start server
    await server.start();
    console.log('   ✓ Server started successfully\n');
    
    // Create client
    console.log('2. Creating IPC client...');
    const client = IPCFactory.createClient();
    
    // Connect
    await client.connect();
    console.log('   ✓ Client connected successfully\n');
    
    // Send test message
    console.log('3. Sending test message...');
    const response = await client.request('test', { 
      message: 'Hello from IPC test!',
      testId: Math.random()
    });
    console.log('   ✓ Response received:', response, '\n');
    
    // Test broadcast
    console.log('4. Testing broadcast...');
    await server.broadcast({
      id: crypto.randomUUID(),
      type: 'test-broadcast' as any,
      timestamp: new Date(),
      payload: { announcement: 'This is a broadcast message' }
    });
    console.log('   ✓ Broadcast sent\n');
    
    // Cleanup
    console.log('5. Cleaning up...');
    await client.disconnect();
    await server.stop();
    console.log('   ✓ Cleanup complete\n');
    
    console.log('✅ IPC test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ IPC test failed:', error);
    process.exit(1);
  }
}

// Import crypto for UUID
import * as crypto from 'crypto';

// Run test
testBasicIPC();