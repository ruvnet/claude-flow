// status.js - System status and monitoring commands
import { printSuccess, printError, printWarning } from '../utils.js';
import { promises as fs } from 'fs';
// Removed Deno import from '../node-compat.js';
import { MetricsReader } from '../../utils/metrics-reader.js';

export async function statusCommand(subArgs, flags) {
  const verbose = subArgs.includes('--verbose') || subArgs.includes('-v') || flags.verbose;
  const json = subArgs.includes('--json') || flags.json;

  const status = await getSystemStatus(verbose);

  if (json) {
    console.log(JSON.stringify(status, null, 2));
  } else {
    displayStatus(status, verbose);
  }
}

async function getSystemStatus(verbose = false) {
  const reader = new MetricsReader();
  
  // Get real metrics from files
  const [systemMetrics, perfMetrics, agents, recentTasks, overallHealth, mcpStatus, taskQueue] = await Promise.all([
    reader.getSystemMetrics(),
    reader.getPerformanceMetrics(),
    reader.getActiveAgents(),
    reader.getRecentTasks(5),
    reader.getOverallHealth(),
    reader.getMCPServerStatus(),
    reader.getTaskQueue()
  ]);
  
  // Count active agents
  const activeAgentCount = agents.filter(a => a.status === 'active' || a.status === 'busy').length;
  
  // Build status object with real data
  const status = {
    timestamp: Date.now(),
    version: '2.7.0',
    orchestrator: {
      running: perfMetrics && perfMetrics.totalTasks > 0,
      uptime: systemMetrics ? systemMetrics.uptime : 0,
      status: perfMetrics && perfMetrics.totalTasks > 0 ? 'Running' : 'Not Running',
    },
    agents: {
      active: activeAgentCount,
      total: agents.length,
      types: agents.reduce((acc, agent) => {
        acc[agent.type] = (acc[agent.type] || 0) + 1;
        return acc;
      }, {}),
    },
    tasks: {
      queued: taskQueue.filter(t => t.status === 'queued').length,
      running: taskQueue.filter(t => t.status === 'running').length + agents.filter(a => a.status === 'busy').length,
      completed: perfMetrics ? perfMetrics.successfulTasks : 0,
      failed: perfMetrics ? perfMetrics.failedTasks : 0,
    },
    memory: {
      status: systemMetrics && systemMetrics.memoryUsagePercent < 80 ? 'Ready' : 'Warning',
      entries: await getMemoryStats(),
      size: systemMetrics ? `${(systemMetrics.memoryUsed / (1024 * 1024)).toFixed(2)} MB` : '0 KB',
    },
    terminal: {
      status: 'Ready',
      poolSize: 10,
      active: perfMetrics ? perfMetrics.activeAgents : 0,
    },
    mcp: {
      status: mcpStatus && mcpStatus.running ? 'Running' : 'Stopped',
      port: mcpStatus ? mcpStatus.port : null,
      connections: mcpStatus ? mcpStatus.connections : 0,
    },
    resources: verbose ? await getResourceUsage() : null,
  };

  return status;
}

async function getMemoryStats() {
  try {
    const memoryStore = './memory/memory-store.json';
    const content = await fs.readFile(memoryStore, 'utf8');
    const data = JSON.parse(content);

    let totalEntries = 0;
    for (const entries of Object.values(data)) {
      totalEntries += entries.length;
    }

    return totalEntries;
  } catch {
    return 0;
  }
}

async function getResourceUsage() {
  // Get system resource information
  try {
    // Dynamic import for cross-platform compatibility
    let os;
    try {
      os = await import('node:os');
    } catch {
      try {
        os = await import('os');
      } catch {
        // Fallback for environments without os module
        return {
          memory: { usage: 'N/A (os module unavailable)' },
          cpu: { cores: 'Unknown', load: 'Unknown' },
          platform: { type: 'Unknown', error: 'os module not available' },
        };
      }
    }

    // Node.js doesn't have systemMemoryInfo, use os module instead
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const memInfo = {
      total: totalMem,
      free: freeMem,
      available: freeMem,
      buffers: 0,
      cached: 0,
      swapTotal: 0,
      swapFree: 0,
    };

    // Get CPU info
    let cpuCores = os.cpus().length;
    let loadAvg = 'N/A';

    try {
      const loadAvgData = os.loadavg();
      loadAvg = `${loadAvgData[0].toFixed(2)}, ${loadAvgData[1].toFixed(2)}, ${loadAvgData[2].toFixed(2)}`;
    } catch (e) {
      // Load average not available on all platforms
    }

    return {
      memory: {
        total: formatBytes(memInfo.total),
        free: formatBytes(memInfo.free),
        available: formatBytes(memInfo.available),
        usage: `${Math.round(((memInfo.total - memInfo.available) / memInfo.total) * 100)}%`,
      },
      cpu: {
        cores: cpuCores,
        load: loadAvg,
        model: os.cpus()[0]?.model || 'Unknown',
      },
      platform: {
        type: os.type(),
        release: os.release(),
        arch: os.arch(),
        uptime: formatUptime(os.uptime() * 1000),
      },
    };
  } catch (error) {
    return {
      memory: { usage: 'Unknown' },
      cpu: { cores: 'Unknown', load: 'Unknown' },
      platform: { type: 'Unknown', error: error.message },
    };
  }
}

function displayStatus(status, verbose) {
  printSuccess('Claude-Flow System Status:');

  // Overall status
  const overallStatus = status.orchestrator.running ? '🟢 Running' : '🟡 Not Running';
  console.log(
    `${overallStatus} (orchestrator ${status.orchestrator.running ? 'active' : 'not started'})`,
  );

  // Core components
  console.log(`🤖 Agents: ${status.agents.active} active`);
  console.log(`📋 Tasks: ${status.tasks.queued} in queue`);
  console.log(`💾 Memory: ${status.memory.status} (${status.memory.entries} entries)`);
  console.log(`🖥️  Terminal Pool: ${status.terminal.status}`);
  console.log(`🌐 MCP Server: ${status.mcp.status}`);

  if (verbose) {
    console.log('\n📊 Detailed Information:');

    // Orchestrator details
    console.log('\n🎭 Orchestrator:');
    console.log(`   Status: ${status.orchestrator.status}`);
    console.log(`   Uptime: ${formatUptime(status.orchestrator.uptime)}`);

    // Agent details
    console.log('\n🤖 Agent Details:');
    console.log(`   Total Registered: ${status.agents.total}`);
    console.log(`   Currently Active: ${status.agents.active}`);
    if (Object.keys(status.agents.types).length > 0) {
      console.log('   Types:');
      for (const [type, count] of Object.entries(status.agents.types)) {
        console.log(`     ${type}: ${count}`);
      }
    } else {
      console.log('   No agents currently registered');
    }

    // Task details
    console.log('\n📋 Task Queue:');
    console.log(`   Queued: ${status.tasks.queued}`);
    console.log(`   Running: ${status.tasks.running}`);
    console.log(`   Completed: ${status.tasks.completed}`);
    console.log(`   Failed: ${status.tasks.failed}`);

    // Memory details
    console.log('\n💾 Memory System:');
    console.log(`   Total Entries: ${status.memory.entries}`);
    console.log(`   Database Size: ${status.memory.size}`);
    console.log(`   Status: ${status.memory.status}`);

    // Terminal details
    console.log('\n🖥️  Terminal Pool:');
    console.log(`   Pool Size: ${status.terminal.poolSize}`);
    console.log(`   Active Sessions: ${status.terminal.active}`);
    console.log(`   Status: ${status.terminal.status}`);

    // MCP details
    console.log('\n🌐 MCP Server:');
    console.log(`   Status: ${status.mcp.status}`);
    console.log(`   Port: ${status.mcp.port || 'Not configured'}`);
    console.log(`   Active Connections: ${status.mcp.connections}`);

    // Resource usage
    if (status.resources) {
      console.log('\n📈 Resource Usage:');
      console.log(
        `   Memory: ${status.resources.memory.usage} of ${status.resources.memory.total}`,
      );
      console.log(`   Available: ${status.resources.memory.available}`);
      console.log(`   CPU Cores: ${status.resources.cpu.cores}`);
      console.log(`   CPU Load: ${status.resources.cpu.load}`);
      if (status.resources.cpu.model) {
        console.log(`   CPU Model: ${status.resources.cpu.model}`);
      }

      if (status.resources.platform) {
        console.log('\n💻 Platform:');
        console.log(
          `   OS: ${status.resources.platform.type} ${status.resources.platform.release}`,
        );
        console.log(`   Architecture: ${status.resources.platform.arch}`);
        console.log(`   System Uptime: ${status.resources.platform.uptime}`);
      }
    }

    console.log('\n🕐 Status captured at:', new Date(status.timestamp).toLocaleString());
  }

  // Recommendations
  console.log('\n💡 Quick Actions:');
  if (!status.orchestrator.running) {
    console.log('   Run "claude-flow start" to begin orchestration');
  }
  if (status.agents.active === 0) {
    console.log('   Run "claude-flow agent spawn researcher" to create an agent');
  }
  if (status.memory.entries === 0) {
    console.log('   Run "claude-flow memory store key value" to test memory');
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function formatUptime(milliseconds) {
  if (milliseconds === 0) return '0s';

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

// Allow direct execution for testing
if (import.meta.main) {
  const args = [];
  const flags = {};

  // Parse arguments and flags from Deno.args if available
  if (typeof Deno !== 'undefined' && Deno.args) {
    for (let i = 0; i < Deno.args.length; i++) {
      const arg = Deno.args[i];
      if (arg.startsWith('--')) {
        const flagName = arg.substring(2);
        const nextArg = Deno.args[i + 1];

        if (nextArg && !nextArg.startsWith('--')) {
          flags[flagName] = nextArg;
          i++; // Skip the next argument
        } else {
          flags[flagName] = true;
        }
      } else {
        args.push(arg);
      }
    }
  }

  await statusCommand(args, flags);
}
