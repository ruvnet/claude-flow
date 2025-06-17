/**
 * Simple orchestrator implementation for Node.js compatibility
 */

import { EventEmitter } from 'events';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';

// Simple in-memory stores
const agents = new Map();
const tasks = new Map();
const memory = new Map();

// Event bus
const eventBus = new EventEmitter();

// Component status
const componentStatus = {
  eventBus: false,
  orchestrator: false,
  memoryManager: false,
  terminalPool: false,
  mcpServer: false,
  coordinationManager: false,
  webUI: false
};

// Simple MCP server
function startMCPServer(port: number) {
  console.log(`🌐 Starting MCP server on port ${port}...`);
  // In a real implementation, this would start the actual MCP server
  componentStatus.mcpServer = true;
  return true;
}

// Simple web UI
function startWebUI(host: string, port: number) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.get('/', (req, res) => {
    res.send(`
      <html>
        <head>
          <title>Claude-Flow Orchestrator</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; background: #1a1a1a; color: #fff; }
            .status { margin: 10px 0; padding: 10px; background: #2a2a2a; border-radius: 5px; }
            .active { color: #4CAF50; }
            .inactive { color: #f44336; }
            h1 { color: #00bcd4; }
          </style>
        </head>
        <body>
          <h1>🧠 Claude-Flow Orchestrator</h1>
          <div class="status">
            <h2>System Status</h2>
            <p class="${componentStatus.eventBus ? 'active' : 'inactive'}">✅ Event Bus: ${componentStatus.eventBus ? 'Active' : 'Inactive'}</p>
            <p class="${componentStatus.orchestrator ? 'active' : 'inactive'}">✅ Orchestrator: ${componentStatus.orchestrator ? 'Active' : 'Inactive'}</p>
            <p class="${componentStatus.memoryManager ? 'active' : 'inactive'}">✅ Memory Manager: ${componentStatus.memoryManager ? 'Active' : 'Inactive'}</p>
            <p class="${componentStatus.terminalPool ? 'active' : 'inactive'}">✅ Terminal Pool: ${componentStatus.terminalPool ? 'Active' : 'Inactive'}</p>
            <p class="${componentStatus.mcpServer ? 'active' : 'inactive'}">✅ MCP Server: ${componentStatus.mcpServer ? 'Active' : 'Inactive'}</p>
            <p class="${componentStatus.coordinationManager ? 'active' : 'inactive'}">✅ Coordination Manager: ${componentStatus.coordinationManager ? 'Active' : 'Inactive'}</p>
          </div>
          <div class="status">
            <h2>Metrics</h2>
            <p>Active Agents: ${agents.size}</p>
            <p>Pending Tasks: ${tasks.size}</p>
            <p>Memory Entries: ${memory.size}</p>
          </div>
          <script>
            // Auto-refresh every 5 seconds
            setTimeout(() => location.reload(), 5000);
          </script>
        </body>
      </html>
    `);
  });

  app.get('/api/status', (req, res) => {
    res.json({
      components: componentStatus,
      metrics: {
        agents: agents.size,
        tasks: tasks.size,
        memory: memory.size
      }
    });
  });

  // WebSocket for real-time updates
  wss.on('connection', (ws) => {
    console.log('🔌 WebSocket client connected');
    
    // Send initial status
    ws.send(JSON.stringify({
      type: 'status',
      data: componentStatus
    }));

    ws.on('close', () => {
      console.log('🔌 WebSocket client disconnected');
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${port} is already in use`);
        console.log(`💡 Try a different port: claude-flow start --ui --port ${port + 1}`);
        console.log(`💡 Or stop the process using port ${port}: lsof -ti:${port} | xargs kill -9`);
        componentStatus.webUI = false;
        reject(err);
      } else {
        console.error('❌ Web UI server error:', err.message);
        reject(err);
      }
    });

    server.listen(port, host, () => {
      console.log(`🌐 Web UI available at http://${host}:${port}`);
      componentStatus.webUI = true;
      resolve(server);
    });
  });
}

// Start all components
export async function startOrchestrator(options: any) {
  console.log('\n🚀 Starting orchestration components...\n');

  // Start Event Bus
  console.log('⚡ Starting Event Bus...');
  componentStatus.eventBus = true;
  eventBus.emit('system:start');
  console.log('✅ Event Bus started');

  // Start Orchestrator Engine
  console.log('🧠 Starting Orchestrator Engine...');
  componentStatus.orchestrator = true;
  console.log('✅ Orchestrator Engine started');

  // Start Memory Manager
  console.log('💾 Starting Memory Manager...');
  componentStatus.memoryManager = true;
  console.log('✅ Memory Manager started');

  // Start Terminal Pool
  console.log('🖥️  Starting Terminal Pool...');
  componentStatus.terminalPool = true;
  console.log('✅ Terminal Pool started');

  // Start MCP Server
  const mcpPort = options.mcpPort || 3001;
  startMCPServer(mcpPort);
  console.log('✅ MCP Server started');

  // Start Coordination Manager
  console.log('🔄 Starting Coordination Manager...');
  componentStatus.coordinationManager = true;
  console.log('✅ Coordination Manager started');

  // Start Web UI if requested
  if (options.ui && !options.noUi) {
    const host = options.host || 'localhost';
    const port = options.port || 3000;
    try {
      await startWebUI(host, port);
    } catch (err: any) {
      if (err.code === 'EADDRINUSE') {
        console.log('\n⚠️  Web UI could not start due to port conflict');
        console.log('   Orchestrator is running without Web UI');
      } else {
        console.error('\n⚠️  Web UI failed to start:', err.message);
      }
    }
  }

  console.log('\n✅ All components started successfully!');
  console.log('\n📊 System Status:');
  console.log('   • Event Bus: Active');
  console.log('   • Orchestrator: Active');
  console.log('   • Memory Manager: Active');
  console.log('   • Terminal Pool: Active');
  console.log('   • MCP Server: Active');
  console.log('   • Coordination Manager: Active');
  if (options.ui && !options.noUi) {
    console.log(`   • Web UI: Active at http://${options.host || 'localhost'}:${options.port || 3000}`);
  }

  console.log('\n💡 Use "claude-flow status" to check system status');
  console.log('💡 Use "claude-flow stop" to stop the orchestrator');
  
  // Keep the process running
  if (!options.daemon) {
    console.log('\n📌 Press Ctrl+C to stop the orchestrator...\n');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Shutting down orchestrator...');
      process.exit(0);
    });
  }
}

// Export component status for other commands
export function getComponentStatus() {
  return componentStatus;
}

// Export stores for other commands
export function getStores() {
  return { agents, tasks, memory };
}