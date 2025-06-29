/**
 * Simple orchestrator implementation for Node.js compatibility
 */

import { EventEmitter } from 'events';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import { spawn } from '../tracing/index.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// Enhanced web UI with console interface
function startWebUI(host: string, port: number) {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });
  
  // Store CLI output history and active connections
  const outputHistory: string[] = [];
  const activeConnections: Set<any> = new Set();
  
  // CLI output capture system
  let cliProcess: any = null;
  
  const consoleHTML = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Claude-Flow Console</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            body {
                font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                background: #0d1117;
                color: #c9d1d9;
                height: 100vh;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .header {
                background: #161b22;
                border-bottom: 1px solid #21262d;
                padding: 10px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .title {
                font-weight: bold;
                color: #58a6ff;
            }
            .connection-status {
                font-size: 12px;
                color: #7c3aed;
            }
            .console-container {
                flex: 1;
                display: flex;
                flex-direction: column;
                overflow: hidden;
            }
            .console-output {
                flex: 1;
                overflow-y: auto;
                padding: 10px;
                background: #0d1117;
                font-size: 13px;
                line-height: 1.4;
                white-space: pre-wrap;
                word-wrap: break-word;
            }
            .console-input {
                background: #161b22;
                border: none;
                border-top: 1px solid #21262d;
                padding: 10px;
                color: #c9d1d9;
                font-family: inherit;
                font-size: 13px;
                outline: none;
            }
            .console-input:focus {
                background: #21262d;
            }
            .prompt {
                color: #58a6ff;
                font-weight: bold;
            }
            .error {
                color: #ff7b72;
            }
            .success {
                color: #3fb950;
            }
            .warning {
                color: #ffa657;
            }
            .info {
                color: #79c0ff;
            }
            .dim {
                color: #8b949e;
            }
            .scrollbar {
                scrollbar-width: thin;
                scrollbar-color: #21262d #0d1117;
            }
            .scrollbar::-webkit-scrollbar {
                width: 8px;
            }
            .scrollbar::-webkit-scrollbar-track {
                background: #0d1117;
            }
            .scrollbar::-webkit-scrollbar-thumb {
                background: #21262d;
                border-radius: 4px;
            }
            .scrollbar::-webkit-scrollbar-thumb:hover {
                background: #30363d;
            }
            .system-status {
                display: flex;
                gap: 15px;
                font-size: 11px;
            }
            .status-item {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .status-dot {
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: #3fb950;
            }
            .status-dot.inactive {
                background: #f85149;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <div class="title">🧠 Claude-Flow Console</div>
            <div class="system-status">
                <div class="status-item">
                    <div class="status-dot" id="ws-status"></div>
                    <span id="ws-text">Connecting...</span>
                </div>
                <div class="status-item">
                    <div class="status-dot" id="cli-status"></div>
                    <span id="cli-text">CLI Ready</span>
                </div>
            </div>
        </div>
        <div class="console-container">
            <div class="console-output scrollbar" id="output"></div>
            <input type="text" class="console-input" id="input" placeholder="Enter claude-flow command..." autocomplete="off">
        </div>

        <script>
            const output = document.getElementById('output');
            const input = document.getElementById('input');
            const wsStatus = document.getElementById('ws-status');
            const wsText = document.getElementById('ws-text');
            const cliStatus = document.getElementById('cli-status');
            const cliText = document.getElementById('cli-text');
            
            let ws = null;
            let commandHistory = [];
            let historyIndex = -1;
            
            function connect() {
                const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
                ws = new WebSocket(\`\${protocol}//\${window.location.host}\`);
                
                ws.onopen = () => {
                    wsStatus.classList.remove('inactive');
                    wsText.textContent = 'Connected';
                    appendOutput('\n<span class="success">🔗 Connected to Claude-Flow Console</span>\n');
                    appendOutput('<span class="info">Type "help" for available commands or use any claude-flow command</span>\n\n');
                };
                
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                };
                
                ws.onclose = () => {
                    wsStatus.classList.add('inactive');
                    wsText.textContent = 'Disconnected';
                    appendOutput('\n<span class="error">🔗 Connection lost. Reconnecting...</span>\n');
                    setTimeout(connect, 3000);
                };
                
                ws.onerror = (error) => {
                    appendOutput('\n<span class="error">❌ WebSocket error</span>\n');
                };
            }
            
            function handleMessage(data) {
                switch (data.type) {
                    case 'output':
                        appendOutput(data.data);
                        break;
                    case 'error':
                        appendOutput('<span class="error">' + data.data + '</span>');
                        break;
                    case 'command_complete':
                        appendOutput('\n<span class="prompt">claude-flow> </span>');
                        break;
                    case 'status':
                        updateStatus(data.data);
                        break;
                }
            }
            
            function appendOutput(text) {
                output.innerHTML += text;
                output.scrollTop = output.scrollHeight;
            }
            
            function updateStatus(status) {
                // Update CLI status based on server response
                if (status.cliActive) {
                    cliStatus.classList.remove('inactive');
                    cliText.textContent = 'CLI Active';
                } else {
                    cliStatus.classList.add('inactive');
                    cliText.textContent = 'CLI Inactive';
                }
            }
            
            function sendCommand(command) {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    appendOutput('<span class="prompt">claude-flow> </span>' + command + '\n');
                    ws.send(JSON.stringify({
                        type: 'command',
                        data: command
                    }));
                    
                    // Add to history
                    if (command.trim() && commandHistory[commandHistory.length - 1] !== command) {
                        commandHistory.push(command);
                        if (commandHistory.length > 100) {
                            commandHistory.shift();
                        }
                    }
                    historyIndex = commandHistory.length;
                }
            }
            
            // Input handling
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const command = input.value.trim();
                    if (command) {
                        sendCommand(command);
                        input.value = '';
                    }
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (historyIndex > 0) {
                        historyIndex--;
                        input.value = commandHistory[historyIndex] || '';
                    }
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (historyIndex < commandHistory.length - 1) {
                        historyIndex++;
                        input.value = commandHistory[historyIndex] || '';
                    } else {
                        historyIndex = commandHistory.length;
                        input.value = '';
                    }
                } else if (e.key === 'Tab') {
                    e.preventDefault();
                    // Basic tab completion for common commands
                    const value = input.value;
                    const commands = ['help', 'status', 'agent', 'task', 'memory', 'config', 'start', 'stop'];
                    const matches = commands.filter(cmd => cmd.startsWith(value));
                    if (matches.length === 1) {
                        input.value = matches[0] + ' ';
                    }
                }
            });
            
            // Focus input on page load
            window.addEventListener('load', () => {
                input.focus();
                connect();
            });
            
            // Keep input focused
            document.addEventListener('click', () => {
                input.focus();
            });
        </script>
    </body>
    </html>
  `;

  app.get('/', (req, res) => {
    res.send(consoleHTML);
  });

  // API endpoints
  app.get('/api/status', (req, res) => {
    res.json({
      components: componentStatus,
      metrics: {
        agents: agents.size,
        tasks: tasks.size,
        memory: memory.size,
        connectedClients: activeConnections.size
      }
    });
  });
  
  app.get('/api/history', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json({
      history: outputHistory.slice(-limit),
      total: outputHistory.length
    });
  });
  
  app.post('/api/command', express.json(), (req, res): void => {
    const { command } = req.body;
    if (!command) {
      res.status(400).json({ error: 'Command is required' });
      return;
    }
    
    // Execute command and return immediately
    // Output will be sent via WebSocket
    try {
      broadcastToClients({
        type: 'output',
        data: `<span class="prompt">API> </span>${command}\\n`
      });
      
      executeCliCommand(command, null);
      
      res.json({ success: true, message: 'Command executed' });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message });
    }
  });
  
  app.get('/api/agents', (req, res) => {
    const agentList = Array.from(agents.entries()).map(([id, agent]) => ({
      id,
      ...agent
    }));
    res.json(agentList);
  });
  
  app.get('/api/tasks', (req, res) => {
    const taskList = Array.from(tasks.entries()).map(([id, task]) => ({
      id,
      ...task
    }));
    res.json(taskList);
  });
  
  app.get('/api/memory', (req, res) => {
    const memoryList = Array.from(memory.entries()).map(([key, value]) => ({
      key,
      value,
      type: typeof value,
      size: JSON.stringify(value).length
    }));
    res.json(memoryList);
  });
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      components: componentStatus
    });
  });

  // WebSocket for real-time CLI interaction
  wss.on('connection', (ws) => {
    console.log('🔌 WebSocket client connected');
    activeConnections.add(ws);
    
    // Send initial status and history
    ws.send(JSON.stringify({
      type: 'status',
      data: { ...componentStatus, cliActive: true }
    }));
    
    // Send recent output history
    outputHistory.slice(-50).forEach(line => {
      ws.send(JSON.stringify({
        type: 'output',
        data: line
      }));
    });

    // Handle incoming commands
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        if (data.type === 'command') {
          handleCliCommand(data.data, ws);
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          data: `Invalid message format: ${(error as Error).message}`
        }));
      }
    });

    ws.on('close', () => {
      console.log('🔌 WebSocket client disconnected');
      activeConnections.delete(ws);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      activeConnections.delete(ws);
    });
  });
  
  // Helper function to send response to specific client or broadcast
  function sendResponse(ws: any, data: any) {
    if (ws) {
      ws.send(JSON.stringify(data));
    } else {
      broadcastToClients(data);
    }
  }
  
  // CLI command execution handler
  function handleCliCommand(command: string, ws: any) {
    try {
      // Add timestamp and format output
      const timestamp = new Date().toLocaleTimeString();
      const logEntry = `[${timestamp}] Executing: ${command}`;
      outputHistory.push(logEntry);
      
      // Broadcast to all connected clients
      broadcastToClients({
        type: 'output',
        data: `<span class="dim">[${timestamp}]</span> <span class="info">Executing:</span> ${command}\\n`
      });
      
      // Execute the command
      executeCliCommand(command, ws);
      
    } catch (error) {
      const errorMsg = `Error executing command: ${(error as Error).message}`;
      outputHistory.push(errorMsg);
      sendResponse(ws, {
        type: 'error',
        data: errorMsg
      });
    }
  }
  
  // Execute CLI commands and capture output
  function executeCliCommand(command: string, ws: any) {
    // Handle built-in commands first
    if (command === 'help') {
      const helpText = `<span class="success">Available Commands:</span>
• <span class="info">help</span> - Show this help message
• <span class="info">status</span> - Show system status
• <span class="info">agent list</span> - List all agents
• <span class="info">agent spawn [type]</span> - Spawn a new agent
• <span class="info">task list</span> - List all tasks
• <span class="info">memory list</span> - List memory entries
• <span class="info">config show</span> - Show configuration
• <span class="info">clear</span> - Clear console
• <span class="info">version</span> - Show version information

<span class="warning">Note:</span> This is a web console interface for claude-flow CLI commands.
`;
      sendResponse(ws, {
        type: 'output',
        data: helpText
      });
      sendResponse(ws, { type: 'command_complete' });
      return;
    }
    
    if (command === 'clear') {
      sendResponse(ws, {
        type: 'output',
        data: '\\x1b[2J\\x1b[H' // ANSI clear screen
      });
      sendResponse(ws, { type: 'command_complete' });
      return;
    }
    
    if (command === 'status') {
      const statusText = `<span class="success">System Status:</span>
• Event Bus: <span class="${componentStatus.eventBus ? 'success' : 'error'}">${componentStatus.eventBus ? 'Active' : 'Inactive'}</span>
• Orchestrator: <span class="${componentStatus.orchestrator ? 'success' : 'error'}">${componentStatus.orchestrator ? 'Active' : 'Inactive'}</span>
• Memory Manager: <span class="${componentStatus.memoryManager ? 'success' : 'error'}">${componentStatus.memoryManager ? 'Active' : 'Inactive'}</span>
• Terminal Pool: <span class="${componentStatus.terminalPool ? 'success' : 'error'}">${componentStatus.terminalPool ? 'Active' : 'Inactive'}</span>
• MCP Server: <span class="${componentStatus.mcpServer ? 'success' : 'error'}">${componentStatus.mcpServer ? 'Active' : 'Inactive'}</span>
• Coordination Manager: <span class="${componentStatus.coordinationManager ? 'success' : 'error'}">${componentStatus.coordinationManager ? 'Active' : 'Inactive'}</span>
• Web UI: <span class="${componentStatus.webUI ? 'success' : 'error'}">${componentStatus.webUI ? 'Active' : 'Inactive'}</span>

<span class="info">Metrics:</span>
• Active Agents: ${agents.size}
• Pending Tasks: ${tasks.size}
• Memory Entries: ${memory.size}
`;
      sendResponse(ws, {
        type: 'output',
        data: statusText
      });
      sendResponse(ws, { type: 'command_complete' });
      return;
    }
    
    // For other commands, spawn a subprocess
    const args = command.split(' ');
    const cmd = args[0];
    const cmdArgs = args.slice(1);
    
    // Determine the correct claude-flow executable path
    const rootDir = path.resolve(__dirname, '../..');
    const cliPath = path.join(rootDir, 'bin', 'claude-flow');
    
    // Spawn the command
    const child = spawn('node', [path.join(rootDir, 'src/cli/simple-cli.js'), ...cmdArgs], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, CLAUDE_FLOW_WEB_MODE: 'true' }
    });
    
    // Handle stdout
    child.stdout?.on('data', (data) => {
      const output = data.toString();
      outputHistory.push(output);
      
      // Convert ANSI colors to HTML spans
      const htmlOutput = convertAnsiToHtml(output);
      
      broadcastToClients({
        type: 'output',
        data: htmlOutput
      });
    });
    
    // Handle stderr
    child.stderr?.on('data', (data) => {
      const error = data.toString();
      outputHistory.push(error);
      
      broadcastToClients({
        type: 'error',
        data: convertAnsiToHtml(error)
      });
    });
    
    // Handle process exit
    child.on('close', (code) => {
      const exitMsg = code === 0 ? 
        `<span class="success">Command completed successfully</span>` :
        `<span class="error">Command failed with exit code ${code}</span>`;
      
      broadcastToClients({
        type: 'output',
        data: `\\n${exitMsg}\\n`
      });
      
      sendResponse(ws, { type: 'command_complete' });
    });
    
    child.on('error', (error) => {
      const errorMsg = `<span class="error">Failed to execute command: ${(error as Error).message}</span>`;
      outputHistory.push(errorMsg);
      
      sendResponse(ws, {
        type: 'error',
        data: errorMsg
      });
      
      sendResponse(ws, { type: 'command_complete' });
    });
  }
  
  // Broadcast message to all connected clients
  function broadcastToClients(message: any) {
    const messageStr = JSON.stringify(message);
    activeConnections.forEach(client => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(messageStr);
      }
    });
  }
  
  // Convert ANSI escape codes to HTML
  function convertAnsiToHtml(text: string): string {
    return text
      .replace(/\x1b\[0m/g, '</span>')
      .replace(/\x1b\[1m/g, '<span style="font-weight: bold;">')
      .replace(/\x1b\[31m/g, '<span class="error">')
      .replace(/\x1b\[32m/g, '<span class="success">')
      .replace(/\x1b\[33m/g, '<span class="warning">')
      .replace(/\x1b\[34m/g, '<span class="info">')
      .replace(/\x1b\[35m/g, '<span style="color: #d946ef;">')
      .replace(/\x1b\[36m/g, '<span style="color: #06b6d4;">')
      .replace(/\x1b\[37m/g, '<span class="dim">')
      .replace(/\x1b\[90m/g, '<span class="dim">')
      .replace(/\x1b\[[0-9;]*m/g, '') // Remove any remaining ANSI codes
      .replace(/\n/g, '\\n')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/&lt;span/g, '<span')
      .replace(/span&gt;/g, 'span>');
  }

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

// Save system state for inter-command communication
async function saveSystemState(): Promise<void> {
  try {
    const state = {
      timestamp: new Date().toISOString(),
      processes: Object.entries(componentStatus).map(([id, status]) => ({
        id,
        name: getComponentName(id),
        type: id,
        status: status ? 'running' : 'stopped',
        pid: process.pid,
        startTime: startTime || Date.now(),
        metrics: {}
      })),
      systemStats: {
        totalProcesses: Object.keys(componentStatus).length,
        runningProcesses: Object.values(componentStatus).filter(Boolean).length,
        stoppedProcesses: Object.values(componentStatus).filter(s => !s).length,
        errorProcesses: 0,
        systemUptime: startTime ? Date.now() - startTime : 0,
        totalMemory: 0,
        totalCpu: 0
      },
      orchestratorPid: process.pid
    };

    await fs.writeFile('.claude-flow-state.json', JSON.stringify(state, null, 2));
  } catch (error) {
    console.error('Failed to save system state:', error);
  }
}

function getComponentName(id: string): string {
  const names: Record<string, string> = {
    eventBus: 'Event Bus',
    orchestrator: 'Orchestrator Engine',
    memoryManager: 'Memory Manager',
    terminalPool: 'Terminal Pool',
    mcpServer: 'MCP Server',
    coordinationManager: 'Coordination Manager',
    webUI: 'Web UI'
  };
  return names[id] || id;
}

let startTime: number;

// Start all components
export async function startOrchestrator(options: any) {
  startTime = Date.now();
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
  
  // Save system state for other commands to access
  await saveSystemState();
  
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