// monitor.js - System monitoring commands with real metrics
import { printSuccess, printError, printWarning } from '../utils.js';
import os from 'os';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';

export async function monitorCommand(subArgs, flags) {
  const interval = getFlag(subArgs, '--interval') || flags.interval || 5000;
  const format = getFlag(subArgs, '--format') || flags.format || 'pretty';
  const continuous = subArgs.includes('--watch') || flags.watch;

  if (continuous) {
    await runContinuousMonitoring(interval, format);
  } else {
    await showCurrentMetrics(format);
  }
}

async function showCurrentMetrics(format) {
  const metrics = await collectMetrics();

  if (format === 'json') {
    console.log(JSON.stringify(metrics, null, 2));
  } else {
    displayMetrics(metrics);
  }
}

async function runContinuousMonitoring(interval, format) {
  printSuccess(`Starting continuous monitoring (interval: ${interval}ms)`);
  console.log('Press Ctrl+C to stop monitoring\n');

  // Set up signal handler for graceful shutdown
  let monitorInterval;
  const cleanup = () => {
    if (monitorInterval) {
      clearInterval(monitorInterval);
    }
    console.log('\n👋 Monitoring stopped');
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Initial display
  const initialMetrics = await collectMetrics();
  console.clear();
  console.log(`🔄 Monitoring Claude-Flow System`);
  console.log(`⏰ ${new Date().toLocaleTimeString()}\n`);

  if (format === 'json') {
    console.log(JSON.stringify(initialMetrics, null, 2));
  } else {
    displayMetrics(initialMetrics);
  }

  console.log(`\n🔄 Next update in ${interval}ms...`);

  // Start continuous monitoring
  monitorInterval = setInterval(async () => {
    console.clear();
    console.log(`🔄 Monitoring Claude-Flow System`);
    console.log(`⏰ ${new Date().toLocaleTimeString()}\n`);

    const metrics = await collectMetrics();

    if (format === 'json') {
      console.log(JSON.stringify(metrics, null, 2));
    } else {
      displayMetrics(metrics);
    }

    console.log(`\n🔄 Next update in ${interval}ms...`);
  }, interval);
}

async function collectMetrics() {
  const timestamp = Date.now();

  // Collect real system metrics
  const cpuUsage = await getCPUUsage();
  const memoryInfo = getMemoryInfo();
  const diskUsage = await getDiskUsage();
  const systemUptime = os.uptime();

  // Try to get orchestrator metrics from file or socket
  const orchestratorMetrics = await getOrchestratorMetrics();

  // Collect performance metrics
  const performanceMetrics = getPerformanceMetrics();

  // Collect resource utilization
  const resourceMetrics = await getResourceMetrics();

  return {
    timestamp,
    system: {
      uptime: systemUptime,
      cpu_usage: cpuUsage,
      memory_usage: memoryInfo.usedMB,
      memory_total: memoryInfo.totalMB,
      memory_percentage: memoryInfo.percentage,
      disk_usage: diskUsage.percentage,
      disk_used: diskUsage.usedGB,
      disk_total: diskUsage.totalGB,
      load_average: os.loadavg(),
      cpu_count: os.cpus().length,
      platform: os.platform(),
      node_version: process.version,
    },
    orchestrator: orchestratorMetrics,
    performance: performanceMetrics,
    resources: resourceMetrics,
  };
}

// Get real CPU usage
async function getCPUUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  const idle = totalIdle / cpus.length;
  const total = totalTick / cpus.length;
  const usage = 100 - ~~((100 * idle) / total);

  return Math.max(0, Math.min(100, usage));
}

// Get real memory information
function getMemoryInfo() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  return {
    totalMB: Math.round(totalMem / 1024 / 1024),
    freeMB: Math.round(freeMem / 1024 / 1024),
    usedMB: Math.round(usedMem / 1024 / 1024),
    percentage: Math.round((usedMem / totalMem) * 100),
  };
}

// Get real disk usage (simplified - checks current working directory)
async function getDiskUsage() {
  try {
    const stats = await fs.statfs(process.cwd());
    const totalBytes = stats.blocks * stats.bsize;
    const freeBytes = stats.bavail * stats.bsize;
    const usedBytes = totalBytes - freeBytes;

    return {
      totalGB: Math.round((totalBytes / 1024 / 1024 / 1024) * 10) / 10,
      usedGB: Math.round((usedBytes / 1024 / 1024 / 1024) * 10) / 10,
      freeGB: Math.round((freeBytes / 1024 / 1024 / 1024) * 10) / 10,
      percentage: Math.round((usedBytes / totalBytes) * 100),
    };
  } catch (error) {
    // Fallback for older Node.js versions or unsupported platforms
    return {
      totalGB: 0,
      usedGB: 0,
      freeGB: 0,
      percentage: 0,
    };
  }
}

// Get orchestrator metrics from running instance
async function getOrchestratorMetrics() {
  try {
    // Try to read from metrics file if orchestrator is running
    const metricsPath = path.join(process.cwd(), '.claude-flow', 'metrics.json');
    const metricsData = await fs.readFile(metricsPath, 'utf8');
    const metrics = JSON.parse(metricsData);

    return {
      status: 'running',
      active_agents: metrics.activeAgents || 0,
      queued_tasks: metrics.queuedTasks || 0,
      completed_tasks: metrics.completedTasks || 0,
      failed_tasks: metrics.failedTasks || 0,
      errors: metrics.errors || 0,
      uptime: metrics.uptime || 0,
    };
  } catch (error) {
    // Check if orchestrator process is running
    const isRunning = await checkOrchestratorRunning();

    return {
      status: isRunning ? 'running' : 'stopped',
      active_agents: 0,
      queued_tasks: 0,
      completed_tasks: 0,
      failed_tasks: 0,
      errors: 0,
      uptime: 0,
    };
  }
}

// Check if orchestrator is running
async function checkOrchestratorRunning() {
  try {
    const pidPath = path.join(process.cwd(), '.claude-flow', 'orchestrator.pid');
    const pidData = await fs.readFile(pidPath, 'utf8');
    const pid = parseInt(pidData.trim());

    // Check if process is running
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Get performance metrics
function getPerformanceMetrics() {
  const memUsage = process.memoryUsage();
  const cpuUsage = process.cpuUsage();

  return {
    avg_task_duration: 0, // Would need to track actual tasks
    throughput: 0, // Would need to track actual throughput
    success_rate: 100, // Default to 100% if no errors
    memory_heap_used: Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100,
    memory_heap_total: Math.round((memUsage.heapTotal / 1024 / 1024) * 100) / 100,
    memory_external: Math.round((memUsage.external / 1024 / 1024) * 100) / 100,
    cpu_user: Math.round(cpuUsage.user / 1000), // Convert to milliseconds
    cpu_system: Math.round(cpuUsage.system / 1000),
  };
}

// Get resource metrics
async function getResourceMetrics() {
  try {
    // Count memory entries from memory database if available
    const memoryDbPath = path.join(process.cwd(), '.claude-flow', 'memory.db');
    const memoryExists = await fs
      .access(memoryDbPath)
      .then(() => true)
      .catch(() => false);

    // Count terminal sessions
    const terminalSessions = await countTerminalSessions();

    // Count MCP connections
    const mcpConnections = await countMCPConnections();

    return {
      memory_entries: memoryExists ? 'Available' : 0,
      terminal_sessions: terminalSessions,
      mcp_connections: mcpConnections,
      open_files: process._getActiveHandles ? process._getActiveHandles().length : 0,
      open_requests: process._getActiveRequests ? process._getActiveRequests().length : 0,
    };
  } catch (error) {
    return {
      memory_entries: 0,
      terminal_sessions: 0,
      mcp_connections: 0,
      open_files: 0,
      open_requests: 0,
    };
  }
}

// Count active terminal sessions
async function countTerminalSessions() {
  try {
    const sessionsPath = path.join(process.cwd(), '.claude-flow', 'sessions');
    const files = await fs.readdir(sessionsPath);
    return files.filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

// Count MCP connections
async function countMCPConnections() {
  try {
    const mcpPath = path.join(process.cwd(), '.claude-flow', 'mcp-connections.json');
    const data = await fs.readFile(mcpPath, 'utf8');
    const connections = JSON.parse(data);
    return Array.isArray(connections) ? connections.length : 0;
  } catch {
    return 0;
  }
}

function displayMetrics(metrics) {
  const timestamp = new Date(metrics.timestamp).toLocaleTimeString();

  console.log('📊 System Metrics');
  console.log('================');

  // System metrics
  console.log('\n🖥️  System Resources:');
  console.log(`   Platform: ${metrics.system.platform} (${metrics.system.cpu_count} CPUs)`);
  console.log(`   Node Version: ${metrics.system.node_version}`);
  console.log(`   CPU Usage: ${metrics.system.cpu_usage.toFixed(1)}%`);
  console.log(
    `   Memory: ${metrics.system.memory_usage.toFixed(1)} MB / ${metrics.system.memory_total.toFixed(1)} MB (${metrics.system.memory_percentage}%)`,
  );
  console.log(
    `   Disk Usage: ${metrics.system.disk_used} GB / ${metrics.system.disk_total} GB (${metrics.system.disk_usage}%)`,
  );
  console.log(
    `   Load Average: ${metrics.system.load_average.map((l) => l.toFixed(2)).join(', ')}`,
  );
  console.log(`   Uptime: ${formatUptime(metrics.system.uptime)}`);

  // Orchestrator metrics
  console.log('\n🎭 Orchestrator:');
  console.log(
    `   Status: ${getStatusIcon(metrics.orchestrator.status)} ${metrics.orchestrator.status}`,
  );
  if (metrics.orchestrator.status === 'running') {
    console.log(`   Active Agents: ${metrics.orchestrator.active_agents}`);
    console.log(`   Queued Tasks: ${metrics.orchestrator.queued_tasks}`);
    console.log(`   Completed: ${metrics.orchestrator.completed_tasks}`);
    console.log(`   Failed: ${metrics.orchestrator.failed_tasks}`);
    console.log(`   Errors: ${metrics.orchestrator.errors}`);
    if (metrics.orchestrator.uptime > 0) {
      console.log(
        `   Orchestrator Uptime: ${formatUptime(Math.floor(metrics.orchestrator.uptime / 1000))}`,
      );
    }
  }

  // Performance metrics
  console.log('\n⚡ Performance:');
  console.log(
    `   Process Memory (Heap): ${metrics.performance.memory_heap_used.toFixed(1)} MB / ${metrics.performance.memory_heap_total.toFixed(1)} MB`,
  );
  console.log(`   External Memory: ${metrics.performance.memory_external.toFixed(1)} MB`);
  console.log(`   CPU Time (User): ${metrics.performance.cpu_user}ms`);
  console.log(`   CPU Time (System): ${metrics.performance.cpu_system}ms`);
  if (metrics.performance.avg_task_duration > 0) {
    console.log(`   Avg Task Duration: ${metrics.performance.avg_task_duration.toFixed(0)}ms`);
    console.log(`   Throughput: ${metrics.performance.throughput.toFixed(1)} tasks/min`);
    console.log(`   Success Rate: ${metrics.performance.success_rate.toFixed(1)}%`);
  }

  // Resource utilization
  console.log('\n📦 Resources:');
  console.log(`   Memory Entries: ${metrics.resources.memory_entries}`);
  console.log(`   Terminal Sessions: ${metrics.resources.terminal_sessions}`);
  console.log(`   MCP Connections: ${metrics.resources.mcp_connections}`);
  console.log(`   Open File Handles: ${metrics.resources.open_files}`);
  console.log(`   Active Requests: ${metrics.resources.open_requests}`);

  console.log(`\n⏰ Last Updated: ${timestamp}`);
}

function getStatusIcon(status) {
  switch (status) {
    case 'running':
      return '🟢';
    case 'stopped':
      return '🔴';
    case 'starting':
      return '🟡';
    case 'error':
      return '❌';
    default:
      return '⚪';
  }
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}

function getFlag(args, flagName) {
  const index = args.indexOf(flagName);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : null;
}

export function showMonitorHelp() {
  console.log('Monitor commands:');
  console.log('  monitor [options]                Show current system metrics');
  console.log('  monitor --watch                  Continuous monitoring mode');
  console.log();
  console.log('Options:');
  console.log('  --interval <ms>                  Update interval in milliseconds (default: 5000)');
  console.log('  --format <type>                  Output format: pretty, json (default: pretty)');
  console.log('  --watch                          Continuous monitoring mode');
  console.log();
  console.log('Examples:');
  console.log('  claude-flow monitor              # Show current metrics');
  console.log('  claude-flow monitor --watch      # Continuous monitoring');
  console.log('  claude-flow monitor --interval 1000 --watch  # Fast updates');
  console.log('  claude-flow monitor --format json            # JSON output');
}
