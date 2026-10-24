// process-ui-enhanced.js - Enhanced process management UI with multiple views - v2.0.0-alpha.83
import { printSuccess, printError, printWarning, printInfo } from '../utils.js';
import { compat } from '../runtime-detector.js';
import SwarmWebUIIntegration from './swarm-webui-integration.js';

// Simple color utilities
const colors = {
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  gray: (text) => `\x1b[90m${text}\x1b[0m`,
  white: (text) => `\x1b[37m${text}\x1b[0m`,
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  green: (text) => `\x1b[32m${text}\x1b[0m`,
  red: (text) => `\x1b[31m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  magenta: (text) => `\x1b[35m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  dim: (text) => `\x1b[2m${text}\x1b[0m`,
};

const PROCESSES = [
  { id: 'event-bus', name: 'Event Bus', description: 'Central event distribution system' },
  { id: 'orchestrator', name: 'Orchestrator', description: 'Main coordination engine' },
  { id: 'memory-manager', name: 'Memory Manager', description: 'Persistent memory system' },
  { id: 'terminal-pool', name: 'Terminal Pool', description: 'Terminal session management' },
  { id: 'mcp-server', name: 'MCP Server', description: 'Model Context Protocol server' },
  { id: 'coordinator', name: 'Coordinator', description: 'Task coordination service' },
];

// View modes
const VIEWS = {
  PROCESSES: 'processes',
  STATUS: 'status',
  ORCHESTRATION: 'orchestration',
  MEMORY: 'memory',
  LOGS: 'logs',
  HELP: 'help',
};

export class EnhancedProcessUI {
  constructor() {
    this.processes = new Map();
    this.running = true;
    this.selectedIndex = 0;
    this.currentView = VIEWS.PROCESSES;
    this.agents = [];
    this.tasks = [];
    this.memoryStats = {
      totalEntries: 0,
      totalSize: 0,
      namespaces: [],
    };
    this.logs = [];
    this.systemStats = {
      uptime: 0,
      totalTasks: 0,
      completedTasks: 0,
      activeAgents: 0,
      memoryUsage: 0,
      cpuUsage: 0,
    };

    // Initialize swarm integration
    this.swarmIntegration = new SwarmWebUIIntegration(this);

    // Initialize process states
    PROCESSES.forEach((p) => {
      this.processes.set(p.id, {
        ...p,
        status: 'stopped',
        pid: null,
        uptime: 0,
        cpu: Math.random() * 5,
        memory: Math.random() * 100,
      });
    });

    // Start system uptime counter
    setInterval(() => {
      this.systemStats.uptime++;
    }, 1000);

    // Initialize swarm (this will create mock data)
    this.initializeSwarm();
  }

  async initializeSwarm() {
    // Initialize swarm with mock data
    await this.swarmIntegration.initializeSwarm('hierarchical', 8);

    // Mock memory namespaces
    this.memoryStats = {
      totalEntries: 42,
      totalSize: '156.3 KB',
      namespaces: [
        { name: 'sparc', entries: 15, size: '45.2 KB' },
        { name: 'agents', entries: 12, size: '38.7 KB' },
        { name: 'tasks', entries: 8, size: '24.1 KB' },
        { name: 'system', entries: 7, size: '48.3 KB' },
      ],
    };

    // Initial logs
    this.logs = [
      { time: new Date(), level: 'info', message: 'System initialized' },
      { time: new Date(), level: 'success', message: 'All processes ready' },
      { time: new Date(), level: 'success', message: 'Swarm orchestration active' },
    ];
  }

  async start() {
    // Clear screen
    console.clear();

    // Show welcome
    printSuccess('🧠 Claude-Flow Process Management UI v2.0.0-alpha.80');
    console.log('─'.repeat(80));
    console.log();

    // Initial render
    this.render();

    // Main UI loop
    while (this.running) {
      await this.handleInput();
      if (this.running) {
        this.render();
      }
    }
  }

  render() {
    // Clear screen and move cursor to top
    console.log('\x1b[2J\x1b[H');

    // Header with navigation
    this.renderHeader();

    // Main content based on current view
    switch (this.currentView) {
      case VIEWS.PROCESSES:
        this.renderProcessView();
        break;
      case VIEWS.STATUS:
        this.renderStatusView();
        break;
      case VIEWS.ORCHESTRATION:
        this.renderOrchestrationView();
        break;
      case VIEWS.MEMORY:
        this.renderMemoryView();
        break;
      case VIEWS.LOGS:
        this.renderLogsView();
        break;
      case VIEWS.HELP:
        this.renderHelpView();
        break;
    }

    // Footer with controls
    this.renderFooter();
  }

  renderHeader() {
    console.log(colors.cyan(colors.bold('🧠 Claude-Flow Process Manager')));
    console.log(colors.gray('─'.repeat(80)));

    // Navigation tabs
    const tabs = [
      { key: '1', view: VIEWS.PROCESSES, label: 'Processes' },
      { key: '2', view: VIEWS.STATUS, label: 'Status' },
      { key: '3', view: VIEWS.ORCHESTRATION, label: 'Orchestration' },
      { key: '4', view: VIEWS.MEMORY, label: 'Memory' },
      { key: '5', view: VIEWS.LOGS, label: 'Logs' },
      { key: '6', view: VIEWS.HELP, label: 'Help' },
    ];

    let tabLine = '';
    tabs.forEach((tab) => {
      const isActive = this.currentView === tab.view;
      const label = isActive ? colors.yellow(`[${tab.label}]`) : colors.gray(`${tab.label}`);
      tabLine += `  ${colors.bold(tab.key)}:${label}`;
    });

    console.log(tabLine);
    console.log(colors.gray('─'.repeat(80)));
    console.log();
  }

  renderProcessView() {
    console.log(colors.white(colors.bold('Process Management')));
    console.log();

    let index = 0;
    for (const [id, process] of this.processes) {
      const selected = index === this.selectedIndex;
      const prefix = selected ? colors.yellow('▶ ') : '  ';
      const status = this.getStatusIcon(process.status);
      const name = selected ? colors.yellow(process.name) : colors.white(process.name);

      console.log(`${prefix}${status} ${name}`);
      console.log(`     ${colors.gray(process.description)}`);

      if (process.status === 'running') {
        const stats = colors.dim(
          `PID: ${process.pid} | Uptime: ${this.formatUptime(process.uptime)} | CPU: ${process.cpu.toFixed(1)}% | Mem: ${process.memory.toFixed(0)}MB`,
        );
        console.log(`     ${stats}`);
      }
      console.log();

      index++;
    }

    // Quick stats
    const running = Array.from(this.processes.values()).filter(
      (p) => p.status === 'running',
    ).length;
    console.log(colors.gray('─'.repeat(80)));
    console.log(
      colors.white(
        `Total: ${this.processes.size} | Running: ${colors.green(running)} | Stopped: ${colors.gray(this.processes.size - running)}`,
      ),
    );
  }

  renderStatusView() {
    console.log(colors.white(colors.bold('System Status')));
    console.log();

    // System overview
    console.log(colors.cyan('📊 System Overview'));
    console.log(`  Uptime: ${colors.green(this.formatUptime(this.systemStats.uptime))}`);
    console.log(`  Process Health: ${this.getHealthBar()}`);
    console.log();

    // Resource usage
    console.log(colors.cyan('💻 Resource Usage'));
    console.log(
      `  CPU Usage: ${this.getUsageBar(this.systemStats.cpuUsage, 100)} ${this.systemStats.cpuUsage}%`,
    );
    console.log(
      `  Memory: ${this.getUsageBar(this.systemStats.memoryUsage, 100)} ${this.systemStats.memoryUsage}%`,
    );
    console.log();

    // Activity metrics
    console.log(colors.cyan('📈 Activity Metrics'));
    console.log(
      `  Active Agents: ${colors.yellow(this.agents.filter((a) => a.status === 'working').length)}/${this.agents.length}`,
    );
    console.log(`  Total Tasks: ${this.tasks.length}`);
    console.log(
      `  Completed: ${colors.green(this.tasks.filter((t) => t.status === 'completed').length)}`,
    );
    console.log(
      `  In Progress: ${colors.yellow(this.tasks.filter((t) => t.status === 'in_progress').length)}`,
    );
    console.log(
      `  Pending: ${colors.gray(this.tasks.filter((t) => t.status === 'pending').length)}`,
    );
    console.log();

    // Recent events
    console.log(colors.cyan('🔔 Recent Events'));
    this.logs.slice(-3).forEach((log) => {
      const time = log.time.toLocaleTimeString();
      const icon = log.level === 'success' ? '✓' : log.level === 'warning' ? '⚠' : 'ℹ';
      const color =
        log.level === 'success'
          ? colors.green
          : log.level === 'warning'
            ? colors.yellow
            : colors.blue;
      console.log(`  ${colors.gray(time)} ${color(icon)} ${log.message}`);
    });
  }

  renderOrchestrationView() {
    console.log(colors.white(colors.bold('Swarm Orchestration Management')));
    console.log();

    // Swarm metrics
    const metrics = this.swarmIntegration.getSwarmMetrics();
    if (metrics) {
      console.log(colors.cyan('🐝 Swarm Status'));
      console.log(`  Swarm ID: ${colors.yellow(metrics.swarmId)}`);
      console.log(
        `  Agents: ${colors.green(metrics.agents.active)}/${metrics.agents.total} active`,
      );
      console.log(
        `  Tasks: ${colors.yellow(metrics.tasks.inProgress)} in progress, ${colors.green(metrics.tasks.completed)} completed`,
      );
      console.log(`  Efficiency: ${metrics.efficiency}%`);
      console.log();
    }

    // Agents section
    console.log(colors.cyan('🤖 Active Agents'));
    console.log();
    this.agents.forEach((agent, index) => {
      const selected = this.currentView === VIEWS.ORCHESTRATION && index === this.selectedIndex;
      const prefix = selected ? colors.yellow('▶ ') : '  ';
      const statusIcon = agent.status === 'working' ? colors.green('●') : colors.gray('○');
      const name = selected ? colors.yellow(agent.name) : colors.white(agent.name);

      console.log(`${prefix}${statusIcon} ${name} (${agent.type})`);
      console.log(`     ID: ${agent.id} | Tasks: ${agent.tasks} | Status: ${agent.status}`);
      if (agent.capabilities && agent.capabilities.length > 0) {
        console.log(`     Capabilities: ${colors.dim(agent.capabilities.join(', '))}`);
      }
      console.log();
    });

    console.log(colors.gray('─'.repeat(40)));

    // Tasks section
    console.log(colors.cyan('📋 Task Queue'));
    console.log();
    this.tasks.slice(0, 5).forEach((task) => {
      const statusColor =
        task.status === 'completed'
          ? colors.green
          : task.status === 'in_progress'
            ? colors.yellow
            : colors.gray;
      const status = statusColor(`[${task.status}]`);
      const priority =
        task.priority === 'high'
          ? colors.red(`[${task.priority}]`)
          : task.priority === 'medium'
            ? colors.yellow(`[${task.priority}]`)
            : colors.gray(`[${task.priority}]`);
      console.log(`  ${status} ${priority} ${task.description}`);
      if (task.assignedTo) {
        const agent = this.agents.find((a) => a.id === task.assignedTo);
        console.log(`       Assigned to: ${agent ? agent.name : task.assignedTo}`);
      }
    });

    if (this.tasks.length > 5) {
      console.log(colors.gray(`  ... and ${this.tasks.length - 5} more tasks`));
    }
  }

  renderMemoryView() {
    console.log(colors.white(colors.bold('Memory Bank Management')));
    console.log();

    // Overview
    console.log(colors.cyan('💾 Memory Overview'));
    console.log(`  Total Entries: ${colors.yellow(this.memoryStats.totalEntries)}`);
    console.log(`  Total Size: ${colors.yellow(this.memoryStats.totalSize)}`);
    console.log();

    // Namespaces
    console.log(colors.cyan('📁 Namespaces'));
    console.log();
    this.memoryStats.namespaces.forEach((ns, index) => {
      const selected = this.currentView === VIEWS.MEMORY && index === this.selectedIndex;
      const prefix = selected ? colors.yellow('▶ ') : '  ';
      const name = selected ? colors.yellow(ns.name) : colors.white(ns.name);

      console.log(`${prefix}${name}`);
      console.log(`     Entries: ${ns.entries} | Size: ${ns.size}`);
      console.log();
    });

    // Recent operations
    console.log(colors.gray('─'.repeat(40)));
    console.log(colors.cyan('🔄 Recent Operations'));
    console.log(`  ${colors.green('✓')} Stored: config.api.key`);
    console.log(`  ${colors.blue('↓')} Retrieved: sparc.modes`);
    console.log(`  ${colors.yellow('✎')} Updated: agent.status`);
  }

  renderLogsView() {
    console.log(colors.white(colors.bold('System Logs')));
    console.log();

    // Log filters
    console.log(colors.cyan('🔍 Filters: ') + colors.gray('[A]ll [I]nfo [W]arning [E]rror'));
    console.log(colors.gray('─'.repeat(80)));
    console.log();

    // Display logs
    const displayLogs = this.logs.slice(-15);
    displayLogs.forEach((log) => {
      const time = log.time.toLocaleTimeString();
      let icon, color;

      switch (log.level) {
        case 'success':
          icon = '✓';
          color = colors.green;
          break;
        case 'warning':
          icon = '⚠';
          color = colors.yellow;
          break;
        case 'error':
          icon = '✗';
          color = colors.red;
          break;
        default:
          icon = 'ℹ';
          color = colors.blue;
      }

      console.log(`${colors.gray(time)} ${color(icon)} ${log.message}`);
    });

    if (this.logs.length > 15) {
      console.log();
      console.log(colors.gray(`Showing last 15 of ${this.logs.length} logs`));
    }
  }

  renderHelpView() {
    console.log(colors.white(colors.bold('Help & Documentation')));
    console.log();

    console.log(colors.cyan('🎯 Navigation'));
    console.log(`  ${colors.yellow('1-6')}     Switch between views`);
    console.log(`  ${colors.yellow('Tab')}     Cycle through views`);
    console.log(`  ${colors.yellow('↑/↓')}     Navigate items (when available)`);
    console.log();

    console.log(colors.cyan('⚡ Process Controls'));
    console.log(`  ${colors.yellow('Space')}   Toggle selected process`);
    console.log(`  ${colors.yellow('A')}       Start all processes`);
    console.log(`  ${colors.yellow('Z')}       Stop all processes`);
    console.log(`  ${colors.yellow('R')}       Restart all processes`);
    console.log();

    console.log(colors.cyan('🤖 Swarm Orchestration'));
    console.log(`  ${colors.yellow('N')}       Spawn new agent`);
    console.log(`  ${colors.yellow('T')}       Create new task`);
    console.log(`  ${colors.yellow('D')}       Complete task`);
    console.log(`  ${colors.yellow('S')}       Show swarm metrics`);
    console.log();

    console.log(colors.cyan('💾 Memory Operations'));
    console.log(`  ${colors.yellow('S')}       Store new entry`);
    console.log(`  ${colors.yellow('G')}       Get/search entries`);
    console.log(`  ${colors.yellow('C')}       Clear namespace`);
    console.log();

    console.log(colors.cyan('🔧 Other'));
    console.log(`  ${colors.yellow('L')}       Clear logs`);
    console.log(`  ${colors.yellow('H/?')}     Show this help`);
    console.log(`  ${colors.yellow('Q')}       Quit`);
  }

  renderFooter() {
    console.log();
    console.log(colors.gray('─'.repeat(80)));

    // Context-sensitive controls
    let controls = '';
    switch (this.currentView) {
      case VIEWS.PROCESSES:
        controls = `${colors.yellow('Space')} Toggle | ${colors.yellow('A')} Start All | ${colors.yellow('Z')} Stop All | ${colors.yellow('R')} Restart`;
        break;
      case VIEWS.ORCHESTRATION:
        controls = `${colors.yellow('N')} New Agent | ${colors.yellow('T')} New Task | ${colors.yellow('D')} Complete | ${colors.yellow('S')} Metrics`;
        break;
      case VIEWS.MEMORY:
        controls = `${colors.yellow('S')} Store | ${colors.yellow('G')} Get | ${colors.yellow('C')} Clear`;
        break;
      case VIEWS.LOGS:
        controls = `${colors.yellow('L')} Clear | ${colors.yellow('F')} Filter`;
        break;
      default:
        controls = `${colors.yellow('Tab')} Next View | ${colors.yellow('?')} Help`;
    }

    console.log(`${controls} | ${colors.yellow('Q')} Quit`);
    console.log(colors.gray('─'.repeat(80)));
  }

  getStatusIcon(status) {
    switch (status) {
      case 'running':
        return colors.green('●');
      case 'stopped':
        return colors.gray('○');
      case 'error':
        return colors.red('✗');
      case 'starting':
        return colors.yellow('◐');
      default:
        return colors.gray('?');
    }
  }

  getHealthBar() {
    const running = Array.from(this.processes.values()).filter(
      (p) => p.status === 'running',
    ).length;
    const total = this.processes.size;
    const percentage = (running / total) * 100;
    const filled = Math.round(percentage / 10);
    const bar = '█'.repeat(filled) + '░'.repeat(10 - filled);
    const color = percentage >= 80 ? colors.green : percentage >= 50 ? colors.yellow : colors.red;
    return color(bar) + ` ${percentage.toFixed(0)}%`;
  }

  getUsageBar(value, max) {
    const percentage = (value / max) * 100;
    const filled = Math.round(percentage / 10);
    const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
    const color = percentage >= 80 ? colors.red : percentage >= 50 ? colors.yellow : colors.green;
    return color(bar);
  }

  formatUptime(seconds) {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  async handleInput() {
    const terminal = compat.terminal;

    await terminal.write('\nCommand: ');

    const buf = new Uint8Array(1024);
    const n = await terminal.read(buf);
    if (n === null) return;

    const rawInput = terminal.decoder.decode(buf.subarray(0, n)).trim();
    const input = rawInput.split('\n')[0].toLowerCase();

    // Global commands
    switch (input) {
      case 'q':
      case 'quit':
        this.running = false;
        console.clear();
        printSuccess('Goodbye!');
        compat.terminal.exit(0);
        break;

      case '1':
        this.currentView = VIEWS.PROCESSES;
        this.selectedIndex = 0;
        break;

      case '2':
        this.currentView = VIEWS.STATUS;
        this.selectedIndex = 0;
        break;

      case '3':
        this.currentView = VIEWS.ORCHESTRATION;
        this.selectedIndex = 0;
        break;

      case '4':
        this.currentView = VIEWS.MEMORY;
        this.selectedIndex = 0;
        break;

      case '5':
        this.currentView = VIEWS.LOGS;
        this.selectedIndex = 0;
        break;

      case '6':
      case '?':
      case 'h':
      case 'help':
        this.currentView = VIEWS.HELP;
        break;

      case 'tab':
      case '\t':
        // Cycle through views
        const viewKeys = Object.values(VIEWS);
        const currentIndex = viewKeys.indexOf(this.currentView);
        this.currentView = viewKeys[(currentIndex + 1) % viewKeys.length];
        this.selectedIndex = 0;
        break;

      default:
        // View-specific commands
        await this.handleViewSpecificInput(input);
    }

    // Update system stats
    this.updateSystemStats();
  }

  async handleViewSpecificInput(input) {
    switch (this.currentView) {
      case VIEWS.PROCESSES:
        await this.handleProcessInput(input);
        break;
      case VIEWS.ORCHESTRATION:
        await this.handleOrchestrationInput(input);
        break;
      case VIEWS.MEMORY:
        await this.handleMemoryInput(input);
        break;
      case VIEWS.LOGS:
        await this.handleLogsInput(input);
        break;
    }
  }

  async handleProcessInput(input) {
    switch (input) {
      case 'a':
        await this.startAll();
        break;

      case 'z':
        await this.stopAll();
        break;

      case 'r':
        await this.restartAll();
        break;

      case ' ':
      case 'space':
      case 'enter':
      case '':
        await this.toggleSelected();
        break;

      case 'up':
      case 'k':
        this.selectedIndex = Math.max(0, this.selectedIndex - 1);
        break;

      case 'down':
      case 'j':
        this.selectedIndex = Math.min(this.processes.size - 1, this.selectedIndex + 1);
        break;
    }
  }

  async handleOrchestrationInput(input) {
    switch (input) {
      case 'n':
        // Spawn new agent
        const agentTypes = ['researcher', 'coder', 'analyst', 'coordinator', 'tester'];
        const randomType = agentTypes[Math.floor(Math.random() * agentTypes.length)];
        await this.swarmIntegration.spawnAgent(randomType);
        break;

      case 't':
        // Create new task
        const sampleTasks = [
          'Implement new feature',
          'Fix critical bug',
          'Optimize performance',
          'Update documentation',
          'Review code quality',
        ];
        const randomTask = sampleTasks[Math.floor(Math.random() * sampleTasks.length)];
        await this.swarmIntegration.createTask(randomTask, 'medium');
        break;

      case 'd':
        // Complete selected task (simulate)
        if (this.tasks.length > 0) {
          const pendingTasks = this.tasks.filter((t) => t.status === 'in_progress');
          if (pendingTasks.length > 0) {
            const taskToComplete = pendingTasks[0];
            await this.swarmIntegration.completeTask(taskToComplete.id);
          } else {
            this.addLog('info', 'No in-progress tasks to complete');
          }
        }
        break;

      case 's':
        // Show swarm metrics
        const metrics = this.swarmIntegration.getSwarmMetrics();
        if (metrics) {
          this.addLog(
            'info',
            `Swarm efficiency: ${metrics.efficiency}% (${metrics.tasks.completed}/${metrics.tasks.total} tasks completed)`,
          );
        }
        break;
    }
  }

  async handleMemoryInput(input) {
    switch (input) {
      case 's':
        this.addLog('info', 'Memory storage not yet implemented');
        break;

      case 'g':
        this.addLog('info', 'Memory retrieval not yet implemented');
        break;

      case 'c':
        this.addLog('warning', 'Memory clearing not yet implemented');
        break;
    }
  }

  async handleLogsInput(input) {
    switch (input) {
      case 'l':
        this.logs = [];
        this.addLog('info', 'Logs cleared');
        break;

      case 'f':
        this.addLog('info', 'Log filtering not yet implemented');
        break;
    }
  }

  addLog(level, message) {
    this.logs.push({
      time: new Date(),
      level,
      message,
    });
  }

  updateSystemStats() {
    // Update random stats for demo
    this.systemStats.cpuUsage = Math.min(
      100,
      Math.max(0, this.systemStats.cpuUsage + (Math.random() - 0.5) * 10),
    );
    this.systemStats.memoryUsage = Math.min(
      100,
      Math.max(0, this.systemStats.memoryUsage + (Math.random() - 0.5) * 5),
    );

    // Update process stats
    for (const [id, process] of this.processes) {
      if (process.status === 'running') {
        process.uptime++;
        process.cpu = Math.min(100, Math.max(0, process.cpu + (Math.random() - 0.5) * 2));
        process.memory = Math.min(200, Math.max(10, process.memory + (Math.random() - 0.5) * 5));
      }
    }
  }

  async toggleSelected() {
    const process = Array.from(this.processes.values())[this.selectedIndex];
    if (process.status === 'stopped') {
      await this.startProcess(process.id);
    } else {
      await this.stopProcess(process.id);
    }
  }

  async startProcess(id) {
    const process = this.processes.get(id);
    if (!process) return;

    this.addLog('info', `Starting ${process.name}...`);
    process.status = 'starting';

    await new Promise((resolve) => setTimeout(resolve, 500));

    process.status = 'running';
    process.pid = Math.floor(Math.random() * 10000) + 1000;
    process.uptime = 0;

    this.addLog('success', `${process.name} started successfully`);
  }

  async stopProcess(id) {
    const process = this.processes.get(id);
    if (!process) return;

    this.addLog('info', `Stopping ${process.name}...`);
    process.status = 'stopped';
    process.pid = null;
    process.uptime = 0;

    await new Promise((resolve) => setTimeout(resolve, 300));
    this.addLog('success', `${process.name} stopped`);
  }

  async startAll() {
    this.addLog('info', 'Starting all processes...');
    for (const [id, process] of this.processes) {
      if (process.status === 'stopped') {
        await this.startProcess(id);
      }
    }
    this.addLog('success', 'All processes started');
  }

  async stopAll() {
    this.addLog('info', 'Stopping all processes...');
    for (const [id, process] of this.processes) {
      if (process.status === 'running') {
        await this.stopProcess(id);
      }
    }
    this.addLog('success', 'All processes stopped');
  }

  async restartAll() {
    await this.stopAll();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await this.startAll();
  }
}

export async function launchEnhancedUI() {
  const ui = new EnhancedProcessUI();
  await ui.start();
}
