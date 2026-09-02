/**
 * Web Server for Claude Code Console
 * Serves the web-based UI and provides WebSocket communication
 */

import { createServer } from 'http';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, existsSync } from 'fs';
import { WebSocketServer } from 'ws';
import { printSuccess, printError, printWarning, printInfo } from '../utils.js';
import { compat } from '../runtime-detector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ClaudeCodeWebServer {
  constructor(port = 3000) {
    this.port = port;
    this.server = null;
    this.wss = null;
    this.connections = new Set();
    this.uiPath = join(__dirname, '../../ui/console');
    this.isRunning = false;
  }

  async createAPIRoutes() {
    const express = await import('express');
    const router = express.Router();

    // Health check endpoint
    router.get('/health', (req, res) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });

    // System status endpoint
    router.get('/status', (req, res) => {
      res.json({
        connections: this.connections.size,
        isRunning: this.isRunning,
        port: this.port,
      });
    });

    return router;
  }

  /**
   * Start the web server
   */
  async start() {
    if (this.isRunning) {
      printWarning('Web server is already running');
      return;
    }

    try {
      // Create HTTP server with express
      const express = await import('express');
      const app = express.default();

      // Enable CORS
      app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        next();
      });

      // Serve static files
      app.use('/console', express.static(this.uiPath));
      app.use('/api', await this.createAPIRoutes());

      // Default route redirects to console
      app.get('/', (req, res) => {
        res.redirect('/console');
      });

      this.server = createServer(app);

      // Create WebSocket server
      this.wss = new WebSocketServer({
        server: this.server,
        path: '/ws',
      });

      this.setupWebSocketServer();

      // Start listening
      await new Promise((resolve, reject) => {
        this.server.listen(this.port, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      this.isRunning = true;
      printSuccess(`🌐 Claude Code Web UI started successfully`);
      console.log(`📍 Web Interface: http://localhost:${this.port}/console`);
      console.log(`🔗 WebSocket: ws://localhost:${this.port}/ws`);
      console.log(`📁 Serving UI from: ${this.uiPath}`);
      console.log();
    } catch (error) {
      printError(`Failed to start web server: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the web server
   */
  async stop() {
    if (!this.isRunning) return;

    // Close all WebSocket connections
    this.connections.forEach((ws) => {
      if (ws.readyState === ws.OPEN) {
        ws.close(1000, 'Server shutting down');
      }
    });

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    // Close HTTP server
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }

    this.isRunning = false;
    printInfo('Web server stopped');
  }

  /**
   * Handle HTTP requests
   */
  handleRequest(req, res) {
    const url = req.url;

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    // Route handling
    if (url === '/' || url === '/console' || url === '/console/') {
      this.serveConsoleHTML(res);
    } else if (url.startsWith('/console/')) {
      // Remove /console prefix and serve static files
      const filePath = url.substring('/console/'.length);
      this.serveStaticFile(res, filePath);
    } else if (url === '/health') {
      this.handleHealthCheck(res);
    } else if (url === '/api/status') {
      this.handleStatusAPI(res);
    } else if (url === '/favicon.ico') {
      this.handleFavicon(res);
    } else {
      this.handle404(res);
    }
  }

  /**
   * Serve the console HTML with corrected paths
   */
  serveConsoleHTML(res) {
    const filePath = join(this.uiPath, 'index.html');

    if (!existsSync(filePath)) {
      this.handle404(res);
      return;
    }

    try {
      let content = readFileSync(filePath, 'utf8');

      // Fix relative paths to be relative to /console/
      content = content.replace(/href="styles\//g, 'href="/console/styles/');
      content = content.replace(/src="js\//g, 'src="/console/js/');

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    } catch (error) {
      this.handle500(res, error);
    }
  }

  /**
   * Serve a specific file from the UI directory
   */
  serveFile(res, filename, contentType) {
    const filePath = join(this.uiPath, filename);

    if (!existsSync(filePath)) {
      this.handle404(res);
      return;
    }

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      this.handle500(res, error);
    }
  }

  /**
   * Serve static files (CSS, JS, etc.)
   */
  serveStaticFile(res, requestPath) {
    // Security: prevent directory traversal
    if (requestPath.includes('..') || requestPath.includes('\0')) {
      this.handle403(res);
      return;
    }

    const filePath = join(this.uiPath, requestPath);

    if (!existsSync(filePath)) {
      this.handle404(res);
      return;
    }

    // Determine content type
    const contentType = this.getContentType(requestPath);

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      this.handle500(res, error);
    }
  }

  /**
   * Get content type based on file extension
   */
  getContentType(filePath) {
    const ext = filePath.split('.').pop().toLowerCase();

    const contentTypes = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      eot: 'application/vnd.ms-fontobject',
    };

    return contentTypes[ext] || 'text/plain';
  }

  /**
   * Handle health check endpoint
   */
  handleHealthCheck(res) {
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      connections: this.connections.size,
      memory: process.memoryUsage(),
      platform: compat.platform,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(health, null, 2));
  }

  /**
   * Handle status API endpoint
   */
  handleStatusAPI(res) {
    const status = {
      server: {
        running: this.isRunning,
        port: this.port,
        connections: this.connections.size,
      },
      claudeFlow: {
        initialized: true,
        version: '1.0.72',
      },
      runtime: compat.runtime,
      platform: compat.platform,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }

  /**
   * Handle favicon request
   */
  handleFavicon(res) {
    // Simple SVG favicon
    const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
      <rect width="32" height="32" fill="#1f6feb"/>
      <text x="16" y="20" text-anchor="middle" fill="white" font-family="monospace" font-size="18">⚡</text>
    </svg>`;

    res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
    res.end(favicon);
  }

  /**
   * Handle 403 Forbidden
   */
  handle403(res) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
  }

  /**
   * Handle 404 Not Found
   */
  handle404(res) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }

  /**
   * Handle 500 Internal Server Error
   */
  handle500(res, error) {
    console.error('Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Server Error');
  }

  /**
   * Setup WebSocket server
   */
  setupWebSocketServer() {
    this.wss.on('connection', (ws, req) => {
      this.handleWebSocketConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  /**
   * Handle new WebSocket connection
   */
  handleWebSocketConnection(ws, req) {
    const clientIP = req.socket.remoteAddress;
    console.log(`🔗 New WebSocket connection from ${clientIP}`);

    this.connections.add(ws);

    // Send welcome message
    this.sendMessage(ws, {
      jsonrpc: '2.0',
      method: 'connection/established',
      params: {
        server: 'claude-flow-web-server',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
      },
    });

    // Handle messages
    ws.on('message', (data) => {
      this.handleWebSocketMessage(ws, data);
    });

    // Handle close
    ws.on('close', (code, reason) => {
      console.log(`❌ WebSocket connection closed: ${code} ${reason}`);
      this.connections.delete(ws);
    });

    // Handle error
    ws.on('error', (error) => {
      console.error('WebSocket connection error:', error);
      this.connections.delete(ws);
    });

    // Setup ping/pong for connection health
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleWebSocketMessage(ws, data) {
    try {
      const message = JSON.parse(data.toString());
      console.log('Received WebSocket message:', message.method, message.id);

      // Handle different message types
      switch (message.method) {
        case 'initialize':
          this.handleInitialize(ws, message);
          break;

        case 'ping':
          this.handlePing(ws, message);
          break;

        case 'tools/call':
          this.handleToolCall(ws, message);
          break;

        case 'tools/list':
          console.log('Handling tools/list request');
          this.handleToolsList(ws, message);
          break;

        default:
          console.log('Unknown method:', message.method);
          this.handleUnknownMethod(ws, message);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
      this.sendError(ws, null, 'Invalid JSON message');
    }
  }

  /**
   * Handle initialize request
   */
  handleInitialize(ws, message) {
    const response = {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: { major: 2024, minor: 11, patch: 5 },
        serverInfo: {
          name: 'claude-flow-web-server',
          version: '2.0.0',
        },
        capabilities: {
          logging: { level: 'info' },
          tools: { listChanged: true },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
      },
    };

    this.sendMessage(ws, response);
  }

  /**
   * Handle ping request
   */
  handlePing(ws, message) {
    this.sendMessage(ws, {
      jsonrpc: '2.0',
      method: 'pong',
      params: {
        timestamp: Date.now(),
        original: message.params,
      },
    });
  }

  /**
   * Handle tool call request
   */
  handleToolCall(ws, message) {
    const { name, arguments: args } = message.params;

    // Mock tool execution for demonstration
    const result = this.executeMockTool(name, args);

    const response = {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: result,
          },
        ],
      },
    };

    this.sendMessage(ws, response);
  }

  /**
   * Handle tools list request
   */
  handleToolsList(ws, message) {
    const tools = [
      {
        name: 'claude-flow/execute',
        description: 'Execute Claude Flow commands (start, stop, status, modes)',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Command to execute' },
            args: { type: 'object', description: 'Command arguments' },
          },
          required: ['command'],
        },
      },
      {
        name: 'swarm/orchestrate',
        description: 'Manage swarm orchestration (create, start, stop, status)',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Action to perform' },
            args: { type: 'array', description: 'Action arguments' },
          },
          required: ['action'],
        },
      },
      {
        name: 'system/health',
        description: 'Get comprehensive system health status',
        inputSchema: {
          type: 'object',
          properties: {
            detailed: { type: 'boolean', description: 'Include detailed metrics' },
          },
        },
      },
      {
        name: 'memory/manage',
        description: 'Manage persistent memory and storage',
        inputSchema: {
          type: 'object',
          properties: {
            operation: { type: 'string', description: 'Operation: store, retrieve, list, delete' },
            key: { type: 'string', description: 'Memory key' },
            value: { type: 'string', description: 'Value to store' },
          },
          required: ['operation'],
        },
      },
      {
        name: 'agents/manage',
        description: 'Manage AI agents and their coordination',
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'Action: list, create, start, stop, status' },
            agentType: { type: 'string', description: 'Agent type for creation' },
            agentId: { type: 'string', description: 'Agent ID for operations' },
          },
          required: ['action'],
        },
      },
      {
        name: 'sparc/execute',
        description: 'Execute SPARC mode operations',
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', description: 'SPARC mode: coder, architect, analyzer, etc.' },
            task: { type: 'string', description: 'Task description' },
            options: { type: 'object', description: 'Additional options' },
          },
          required: ['mode'],
        },
      },
      {
        name: 'benchmark/run',
        description: 'Run performance benchmarks',
        inputSchema: {
          type: 'object',
          properties: {
            suite: { type: 'string', description: 'Benchmark suite to run' },
            iterations: { type: 'number', description: 'Number of iterations' },
          },
        },
      },
    ];

    const response = {
      jsonrpc: '2.0',
      id: message.id,
      result: { tools },
    };

    this.sendMessage(ws, response);
  }

  /**
   * Handle unknown method
   */
  handleUnknownMethod(ws, message) {
    this.sendError(ws, message.id, `Unknown method: ${message.method}`);
  }

  /**
   * Execute mock tool for demonstration
   */
  executeMockTool(name, args) {
    switch (name) {
      case 'claude-flow/execute':
        return this.executeClaudeFlowCommand(args.command, args.args);

      case 'system/health':
        const healthData = {
          status: 'healthy',
          uptime: Math.floor(process.uptime()),
          memory: process.memoryUsage(),
          connections: this.connections.size,
          platform: compat.platform,
          timestamp: new Date().toISOString(),
        };

        if (args.detailed) {
          healthData.detailed = {
            nodeVersion: process.version,
            architecture: process.arch,
            pid: process.pid,
            cpuUsage: process.cpuUsage(),
            resourceUsage: process.resourceUsage ? process.resourceUsage() : 'N/A',
          };
        }

        return JSON.stringify(healthData, null, 2);

      case 'swarm/orchestrate':
        return this.executeSwarmCommand(args.action, args.args);

      case 'swarm/status':
        return this.executeSwarmCommand('status', args.args);

      case 'memory/manage':
        return this.executeMemoryCommand(args.operation, args.key, args.value);

      case 'agents/manage':
        return this.executeAgentsCommand(args.action, args.agentType, args.agentId);

      case 'sparc/execute':
        return this.executeSPARCCommand(args.mode, args.task, args.options);

      case 'benchmark/run':
        return this.executeBenchmarkCommand(args.suite, args.iterations);

      default:
        return `Tool '${name}' executed successfully with args: ${JSON.stringify(args)}`;
    }
  }

  /**
   * Execute Claude Flow command simulation
   */
  executeClaudeFlowCommand(command, args = {}) {
    switch (command) {
      case 'status':
        return `Claude Flow Status:
  Version: 2.0.0
  Mode: Web Console
  Active Processes: 3
  Memory Usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB
  Uptime: ${Math.floor(process.uptime())}s`;

      case 'init':
        return `Claude Flow initialization complete:
  ✅ Project structure created
  ✅ Configuration files generated
  ✅ Memory bank initialized
  ✅ Ready for development`;

      case 'agents':
        return `Active Agents:
  • Research Agent (idle) - 0 tasks
  • Code Developer (working) - 2 tasks  
  • Data Analyst (idle) - 0 tasks
  
  Total: 3 agents`;

      default:
        return `Claude Flow command '${command}' executed successfully`;
    }
  }

  /**
   * Execute swarm command simulation
   */
  executeSwarmCommand(action = 'status', args = []) {
    switch (action) {
      case 'status':
        return `Swarm Orchestration Status:
  🐝 Swarm: ACTIVE
  🏗️ Topology: hierarchical
  👥 Agents: 5/8 active
  📊 Tasks: 12 total (4 complete, 6 in-progress, 2 pending)
  ⚡ Mode: parallel execution
  🧠 Memory: 15 coordination points stored
  📈 Efficiency: 78%`;

      case 'init':
        return `Swarm initialization complete:
  ✅ Hierarchical topology established
  ✅ 5 agents spawned successfully
  ✅ Coordination protocols active
  ✅ Memory synchronization enabled`;

      case 'agents':
        return `Swarm Agent Status:
  🟢 architect: Designing system components...
  🟢 coder-1: Implementing user authentication...
  🟢 coder-2: Building API endpoints...
  🟡 analyst: Analyzing performance metrics...
  🔴 tester: Waiting for code completion...`;

      case 'test':
        return `Swarm Test Results:
  ✅ Agent communication: PASS
  ✅ Task distribution: PASS  
  ✅ Memory coordination: PASS
  ✅ Error handling: PASS
  📊 Overall health: 95%`;

      default:
        return `Swarm ${action} completed successfully`;
    }
  }

  /**
   * Execute memory command simulation
   */
  executeMemoryCommand(operation, key, value) {
    switch (operation) {
      case 'store':
        return `Memory stored successfully:\n  Key: ${key}\n  Value: ${value}\n  Timestamp: ${new Date().toISOString()}`;

      case 'retrieve':
        return `Memory retrieved:\n  Key: ${key}\n  Value: "example stored value"\n  Last Modified: ${new Date().toISOString()}`;

      case 'list':
        return `Memory Keys:\n  • project/settings\n  • swarm/topology\n  • agents/coordination\n  • session/state\n  • benchmark/results\n  \n  Total: 5 entries`;

      case 'delete':
        return `Memory deleted:\n  Key: ${key}\n  Status: Success`;

      default:
        return `Memory operation '${operation}' completed`;
    }
  }

  /**
   * Execute agents command simulation
   */
  executeAgentsCommand(action, agentType, agentId) {
    switch (action) {
      case 'list':
        return `Active Agents:\n  🟢 agent-001 (architect) - Designing system components\n  🟢 agent-002 (coder) - Implementing features\n  🟡 agent-003 (analyst) - Analyzing performance\n  🔴 agent-004 (tester) - Waiting for code\n  🟢 agent-005 (coordinator) - Managing workflow\n  \n  Total: 5 agents`;

      case 'create':
        return `Agent created successfully:\n  Type: ${agentType}\n  ID: agent-${Math.floor(
          Math.random() * 1000,
        )
          .toString()
          .padStart(3, '0')}\n  Status: Active\n  Capabilities: Full ${agentType} functionality`;

      case 'start':
        return `Agent started:\n  ID: ${agentId}\n  Status: Running\n  Tasks: Ready to accept work`;

      case 'stop':
        return `Agent stopped:\n  ID: ${agentId}\n  Status: Stopped\n  Tasks: Completed gracefully`;

      case 'status':
        return `Agent Status:\n  ID: ${agentId}\n  Status: Active\n  Type: researcher\n  Current Task: Data analysis\n  Uptime: 2h 15m\n  Tasks Completed: 12\n  Efficiency: 92%`;

      default:
        return `Agent ${action} completed for ${agentId || agentType}`;
    }
  }

  /**
   * Execute SPARC command simulation
   */
  executeSPARCCommand(mode, task, options = {}) {
    const modes = {
      coder: 'Code development and implementation',
      architect: 'System design and architecture',
      analyzer: 'Data analysis and insights',
      researcher: 'Research and information gathering',
      reviewer: 'Code review and quality assurance',
      tester: 'Testing and validation',
      debugger: 'Bug finding and resolution',
      documenter: 'Documentation and specifications',
      optimizer: 'Performance optimization',
      designer: 'UI/UX design and prototyping',
    };

    return `SPARC Mode Execution:\n  Mode: ${mode} (${modes[mode] || 'Unknown mode'})\n  Task: ${task || 'No task specified'}\n  Status: Initialized\n  Estimated Duration: 15-30 minutes\n  Resources Allocated: 2 agents\n  Options: ${JSON.stringify(options)}\n  \n  Ready to begin execution...`;
  }

  /**
   * Execute benchmark command simulation
   */
  executeBenchmarkCommand(suite = 'default', iterations = 10) {
    const suites = {
      default: 'General performance benchmark',
      memory: 'Memory usage and allocation',
      cpu: 'CPU intensive operations',
      network: 'Network communication speed',
      swarm: 'Swarm coordination efficiency',
    };

    return `Benchmark Results:\n  Suite: ${suite} (${suites[suite] || 'Custom suite'})\n  Iterations: ${iterations}\n  \n  📊 Results:\n  • Average Response Time: 245ms\n  • Memory Usage: 128MB\n  • CPU Utilization: 15%\n  • Success Rate: 98.5%\n  • Throughput: 420 ops/sec\n  \n  🏆 Performance Grade: A+\n  ⚡ Optimization Suggestions: Enable caching for 12% improvement`;
  }

  /**
   * Send message to WebSocket client
   */
  sendMessage(ws, message) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error response
   */
  sendError(ws, id, errorMessage) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32600,
        message: errorMessage,
      },
    };

    this.sendMessage(ws, response);
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message) {
    this.connections.forEach((ws) => {
      this.sendMessage(ws, message);
    });
  }

  /**
   * Start heartbeat to check connection health
   */
  startHeartbeat() {
    setInterval(() => {
      this.connections.forEach((ws) => {
        if (ws.isAlive === false) {
          ws.terminate();
          this.connections.delete(ws);
          return;
        }

        ws.isAlive = false;
        ws.ping();
      });
    }, 30000); // 30 seconds
  }

  /**
   * Get server status
   */
  getStatus() {
    return {
      running: this.isRunning,
      port: this.port,
      connections: this.connections.size,
      uiPath: this.uiPath,
    };
  }
}

/**
 * Start web server command
 */
export async function startWebServer(port = 3000) {
  const server = new ClaudeCodeWebServer(port);

  try {
    await server.start();

    // Setup graceful shutdown
    const shutdown = async () => {
      console.log('\n⏹️  Shutting down web server...');
      await server.stop();
      process.exit(0);
    };

    compat.terminal.onSignal('SIGINT', shutdown);
    compat.terminal.onSignal('SIGTERM', shutdown);

    // Keep server running
    return server;
  } catch (error) {
    printError(`Failed to start web server: ${error.message}`);
    process.exit(1);
  }
}

// Auto-run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = process.argv[2] ? parseInt(process.argv[2]) : 3000;
  await startWebServer(port);
}
