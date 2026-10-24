/**
 * Real Performance Metrics Collection System
 * Tracks actual system performance, agent activity, and resource usage
 */

import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { performance } from 'perf_hooks';

// Metrics storage path
const METRICS_DIR = path.join(process.cwd(), '.claude-flow', 'metrics');
const PERFORMANCE_FILE = path.join(METRICS_DIR, 'performance.json');
const AGENT_METRICS_FILE = path.join(METRICS_DIR, 'agent-metrics.json');
const TASK_METRICS_FILE = path.join(METRICS_DIR, 'task-metrics.json');
const SYSTEM_METRICS_FILE = path.join(METRICS_DIR, 'system-metrics.json');

// In-memory metrics cache
let metricsCache = {
  tasks: [],
  agents: {},
  system: [],
  performance: {
    startTime: Date.now(),
    totalTasks: 0,
    successfulTasks: 0,
    failedTasks: 0,
    totalAgents: 0,
    activeAgents: 0,
    neuralEvents: 0
  }
};

// Store interval ID for cleanup
let systemMonitoringInterval = null;

// Initialize metrics system
export async function initializeMetrics(startMonitoring = true) {
  try {
    await fs.mkdir(METRICS_DIR, { recursive: true });
    
    // Load existing metrics if available
    await loadMetricsFromDisk();
    
    // Start system monitoring only if requested
    if (startMonitoring) {
      startSystemMonitoring();
    }
    
    return true;
  } catch (err) {
    console.error('Failed to initialize metrics:', err);
    return false;
  }
}

// Load metrics from disk
async function loadMetricsFromDisk() {
  try {
    // Load performance metrics
    if (await fileExists(PERFORMANCE_FILE)) {
      const data = await fs.readFile(PERFORMANCE_FILE, 'utf8');
      const saved = JSON.parse(data);
      metricsCache.performance = { ...metricsCache.performance, ...saved };
    }
    
    // Load task metrics
    if (await fileExists(TASK_METRICS_FILE)) {
      const data = await fs.readFile(TASK_METRICS_FILE, 'utf8');
      metricsCache.tasks = JSON.parse(data);
    }
    
    // Load agent metrics
    if (await fileExists(AGENT_METRICS_FILE)) {
      const data = await fs.readFile(AGENT_METRICS_FILE, 'utf8');
      metricsCache.agents = JSON.parse(data);
    }
  } catch (err) {
    // Ignore errors, start fresh
  }
}

// Save metrics to disk
async function saveMetricsToDisk() {
  try {
    await fs.writeFile(PERFORMANCE_FILE, JSON.stringify(metricsCache.performance, null, 2));
    await fs.writeFile(TASK_METRICS_FILE, JSON.stringify(metricsCache.tasks, null, 2));
    await fs.writeFile(AGENT_METRICS_FILE, JSON.stringify(metricsCache.agents, null, 2));
  } catch (err) {
    // Ignore save errors
  }
}

// Track task execution
export async function trackTaskExecution(taskId, taskType, success, duration, metadata = {}) {
  const task = {
    id: taskId,
    type: taskType,
    success,
    duration,
    timestamp: Date.now(),
    metadata
  };
  
  metricsCache.tasks.push(task);
  metricsCache.performance.totalTasks++;
  
  if (success) {
    metricsCache.performance.successfulTasks++;
  } else {
    metricsCache.performance.failedTasks++;
  }
  
  // Keep only last 1000 tasks
  if (metricsCache.tasks.length > 1000) {
    metricsCache.tasks = metricsCache.tasks.slice(-1000);
  }
  
  await saveMetricsToDisk();
}

// Track agent activity
export async function trackAgentActivity(agentId, agentType, action, duration, success = true) {
  if (!metricsCache.agents[agentType]) {
    metricsCache.agents[agentType] = {
      total: 0,
      successful: 0,
      failed: 0,
      totalDuration: 0,
      actions: []
    };
  }
  
  const agent = metricsCache.agents[agentType];
  agent.total++;
  agent.totalDuration += duration;
  
  if (success) {
    agent.successful++;
  } else {
    agent.failed++;
  }
  
  agent.actions.push({
    id: agentId,
    action,
    duration,
    success,
    timestamp: Date.now()
  });
  
  // Keep only last 100 actions per agent type
  if (agent.actions.length > 100) {
    agent.actions = agent.actions.slice(-100);
  }
  
  metricsCache.performance.totalAgents = Object.keys(metricsCache.agents).length;
  
  await saveMetricsToDisk();
}

// Track neural events
export async function trackNeuralEvent(eventType, metadata = {}) {
  metricsCache.performance.neuralEvents++;
  
  await saveMetricsToDisk();
}

// Get performance report data
export async function getPerformanceReport(timeframe = '24h') {
  const now = Date.now();
  const timeframeMs = parseTimeframe(timeframe);
  const cutoff = now - timeframeMs;
  
  // Filter tasks within timeframe
  const recentTasks = metricsCache.tasks.filter(task => task.timestamp >= cutoff);
  
  // Calculate metrics
  const totalTasks = recentTasks.length;
  const successfulTasks = recentTasks.filter(t => t.success).length;
  const successRate = totalTasks > 0 ? (successfulTasks / totalTasks) * 100 : 0;
  const avgDuration = totalTasks > 0 
    ? recentTasks.reduce((sum, t) => sum + t.duration, 0) / totalTasks 
    : 0;
  
  // Agent metrics
  const agentMetrics = {};
  Object.entries(metricsCache.agents).forEach(([type, data]) => {
    const recentActions = data.actions.filter(a => a.timestamp >= cutoff);
    if (recentActions.length > 0) {
      const successCount = recentActions.filter(a => a.success).length;
      const avgDur = recentActions.reduce((sum, a) => sum + a.duration, 0) / recentActions.length;
      
      agentMetrics[type] = {
        total: recentActions.length,
        successRate: (successCount / recentActions.length) * 100,
        avgDuration: avgDur
      };
    }
  });
  
  // System metrics
  const systemMetrics = await getSystemMetrics();
  
  // Calculate trends (compare to previous period)
  const prevCutoff = cutoff - timeframeMs;
  const prevTasks = metricsCache.tasks.filter(t => t.timestamp >= prevCutoff && t.timestamp < cutoff);
  const prevSuccessRate = prevTasks.length > 0 
    ? (prevTasks.filter(t => t.success).length / prevTasks.length) * 100 
    : 0;
  const prevAvgDuration = prevTasks.length > 0
    ? prevTasks.reduce((sum, t) => sum + t.duration, 0) / prevTasks.length
    : 0;
  
  const trends = {
    successRateChange: successRate - prevSuccessRate,
    durationChange: avgDuration - prevAvgDuration,
    taskVolumeChange: totalTasks - prevTasks.length
  };
  
  return {
    timeframe,
    summary: {
      totalTasks,
      successRate,
      avgDuration: avgDuration / 1000, // Convert to seconds
      agentsSpawned: Object.values(agentMetrics).reduce((sum, m) => sum + m.total, 0),
      memoryEfficiency: systemMetrics.memoryEfficiency,
      neuralEvents: metricsCache.performance.neuralEvents
    },
    agentMetrics,
    systemMetrics,
    trends,
    tasks: recentTasks.slice(-20) // Last 20 tasks
  };
}

// Get bottleneck analysis data
export async function getBottleneckAnalysis(scope = 'system', target = 'all') {
  const bottlenecks = [];
  const recommendations = [];
  
  // Analyze task performance
  if (scope === 'system' || scope === 'task') {
    const slowTasks = metricsCache.tasks
      .filter(t => t.duration > 10000) // Tasks taking more than 10s
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 5);
    
    if (slowTasks.length > 0) {
      bottlenecks.push({
        severity: 'warning',
        component: 'Task execution',
        metric: `${slowTasks.length} slow tasks (>10s)`,
        details: slowTasks.map(t => ({
          id: t.id,
          type: t.type,
          duration: t.duration / 1000
        }))
      });
      recommendations.push('Optimize slow task types or break them into smaller subtasks');
    }
  }
  
  // Analyze agent performance
  if (scope === 'system' || scope === 'agent') {
    Object.entries(metricsCache.agents).forEach(([type, data]) => {
      const successRate = data.total > 0 ? (data.successful / data.total) * 100 : 100;
      const avgDuration = data.total > 0 ? data.totalDuration / data.total : 0;
      
      if (successRate < 80) {
        bottlenecks.push({
          severity: 'critical',
          component: `${type} agents`,
          metric: `${successRate.toFixed(1)}% success rate`,
          target: type
        });
        recommendations.push(`Investigate ${type} agent failures and improve error handling`);
      }
      
      if (avgDuration > 15000) {
        bottlenecks.push({
          severity: 'warning',
          component: `${type} agents`,
          metric: `${(avgDuration / 1000).toFixed(1)}s avg duration`,
          target: type
        });
        recommendations.push(`Optimize ${type} agent performance or increase parallelization`);
      }
    });
  }
  
  // Analyze system resources
  if (scope === 'system' || scope === 'memory') {
    const systemMetrics = await getSystemMetrics();
    
    if (systemMetrics.memoryUsagePercent > 80) {
      bottlenecks.push({
        severity: 'critical',
        component: 'Memory usage',
        metric: `${systemMetrics.memoryUsagePercent}% utilization`
      });
      recommendations.push('Implement memory optimization or increase system resources');
    }
    
    if (systemMetrics.cpuLoad > 0.8) {
      bottlenecks.push({
        severity: 'warning',
        component: 'CPU usage',
        metric: `${(systemMetrics.cpuLoad * 100).toFixed(1)}% load`
      });
      recommendations.push('Consider horizontal scaling or CPU optimization');
    }
  }
  
  // Add positive indicators
  if (bottlenecks.length === 0) {
    bottlenecks.push({
      severity: 'good',
      component: 'Overall system',
      metric: 'No bottlenecks detected'
    });
  }
  
  return {
    scope,
    target,
    bottlenecks,
    recommendations,
    analysisDuration: performance.now(),
    confidenceScore: 0.85,
    issuesDetected: bottlenecks.filter(b => b.severity !== 'good').length
  };
}

// System monitoring
function startSystemMonitoring() {
  // Clear any existing interval
  if (systemMonitoringInterval) {
    clearInterval(systemMonitoringInterval);
  }
  
  // Collect system metrics every 30 seconds
  systemMonitoringInterval = setInterval(async () => {
    const metrics = await getSystemMetrics();
    
    // Store system metrics
    if (!metricsCache.system) {
      metricsCache.system = [];
    }
    
    metricsCache.system.push({
      timestamp: Date.now(),
      ...metrics
    });
    
    // Keep only last 24 hours of system metrics
    const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
    metricsCache.system = metricsCache.system.filter(m => m.timestamp > dayAgo);
    
    // Save to disk
    try {
      await fs.writeFile(SYSTEM_METRICS_FILE, JSON.stringify(metricsCache.system, null, 2));
    } catch (err) {
      // Ignore save errors
    }
  }, 30000);
  
  // Allow process to exit even with active interval
  systemMonitoringInterval.unref();
}

// Stop system monitoring
export function stopSystemMonitoring() {
  if (systemMonitoringInterval) {
    clearInterval(systemMonitoringInterval);
    systemMonitoringInterval = null;
  }
}

// Get current system metrics
async function getSystemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memoryUsagePercent = (usedMem / totalMem) * 100;
  
  const cpuLoad = os.loadavg()[0] / os.cpus().length; // 1-minute load average
  
  return {
    memoryTotal: totalMem,
    memoryUsed: usedMem,
    memoryFree: freeMem,
    memoryUsagePercent,
    memoryEfficiency: 100 - memoryUsagePercent,
    cpuCount: os.cpus().length,
    cpuLoad,
    platform: os.platform(),
    uptime: os.uptime()
  };
}

// Parse timeframe string to milliseconds
function parseTimeframe(timeframe) {
  const units = {
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };
  
  const match = timeframe.match(/^(\d+)([hd])$/);
  if (match) {
    const value = parseInt(match[1]);
    const unit = match[2];
    return value * units[unit];
  }
  
  // Default to 24 hours
  return 24 * 60 * 60 * 1000;
}

// Check if file exists
async function fileExists(filepath) {
  try {
    await fs.access(filepath);
    return true;
  } catch {
    return false;
  }
}

// Cleanup function for graceful shutdown
export function cleanup() {
  stopSystemMonitoring();
}

// Export metrics for reporting
export async function exportMetrics(format = 'json') {
  const timestamp = Date.now();
  const reportsDir = path.join(process.cwd(), 'analysis-reports');
  
  await fs.mkdir(reportsDir, { recursive: true });
  
  if (format === 'json') {
    const reportPath = path.join(reportsDir, `performance-${timestamp}.json`);
    const data = {
      timestamp: new Date().toISOString(),
      performance: metricsCache.performance,
      tasks: metricsCache.tasks.slice(-100), // Last 100 tasks
      agents: metricsCache.agents,
      system: metricsCache.system.slice(-50) // Last 50 system snapshots
    };
    
    await fs.writeFile(reportPath, JSON.stringify(data, null, 2));
    return reportPath;
  }
  
  if (format === 'csv') {
    const reportPath = path.join(reportsDir, `performance-${timestamp}.csv`);
    let csv = 'Timestamp,Type,Metric,Value\n';
    
    // Add performance metrics
    Object.entries(metricsCache.performance).forEach(([key, value]) => {
      csv += `${new Date().toISOString()},performance,${key},${value}\n`;
    });
    
    // Add agent metrics
    Object.entries(metricsCache.agents).forEach(([type, data]) => {
      csv += `${new Date().toISOString()},agent,${type}_total,${data.total}\n`;
      csv += `${new Date().toISOString()},agent,${type}_success_rate,${data.total > 0 ? (data.successful / data.total) * 100 : 0}\n`;
      csv += `${new Date().toISOString()},agent,${type}_avg_duration,${data.total > 0 ? data.totalDuration / data.total : 0}\n`;
    });
    
    await fs.writeFile(reportPath, csv);
    return reportPath;
  }
  
  if (format === 'html') {
    const reportPath = path.join(reportsDir, `performance-${timestamp}.html`);
    const report = await getPerformanceReport('24h');
    
    const html = generateHTMLReport(report);
    await fs.writeFile(reportPath, html);
    return reportPath;
  }
  
  throw new Error(`Unsupported format: ${format}`);
}

// Generate HTML report
function generateHTMLReport(report) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Claude Flow Performance Report - ${new Date().toISOString()}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1, h2 { color: #333; }
    .metric { display: inline-block; margin: 10px 20px 10px 0; }
    .metric-label { color: #666; font-size: 14px; }
    .metric-value { font-size: 24px; font-weight: bold; color: #2196F3; }
    .trend { font-size: 14px; margin-left: 10px; }
    .trend.positive { color: #4CAF50; }
    .trend.negative { color: #F44336; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; font-weight: bold; }
    .chart { margin: 20px 0; height: 300px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Claude Flow Performance Report</h1>
    <p>Generated: ${new Date().toISOString()} | Timeframe: ${report.timeframe}</p>
    
    <h2>Summary Metrics</h2>
    <div class="metrics">
      <div class="metric">
        <div class="metric-label">Total Tasks</div>
        <div class="metric-value">${report.summary.totalTasks}</div>
        ${report.trends.taskVolumeChange !== 0 ? `<span class="trend ${report.trends.taskVolumeChange > 0 ? 'positive' : 'negative'}">${report.trends.taskVolumeChange > 0 ? '+' : ''}${report.trends.taskVolumeChange}</span>` : ''}
      </div>
      <div class="metric">
        <div class="metric-label">Success Rate</div>
        <div class="metric-value">${report.summary.successRate.toFixed(1)}%</div>
        ${report.trends.successRateChange !== 0 ? `<span class="trend ${report.trends.successRateChange > 0 ? 'positive' : 'negative'}">${report.trends.successRateChange > 0 ? '+' : ''}${report.trends.successRateChange.toFixed(1)}%</span>` : ''}
      </div>
      <div class="metric">
        <div class="metric-label">Avg Duration</div>
        <div class="metric-value">${report.summary.avgDuration.toFixed(1)}s</div>
        ${report.trends.durationChange !== 0 ? `<span class="trend ${report.trends.durationChange < 0 ? 'positive' : 'negative'}">${report.trends.durationChange > 0 ? '+' : ''}${(report.trends.durationChange / 1000).toFixed(1)}s</span>` : ''}
      </div>
      <div class="metric">
        <div class="metric-label">Memory Efficiency</div>
        <div class="metric-value">${report.summary.memoryEfficiency.toFixed(0)}%</div>
      </div>
    </div>
    
    <h2>Agent Performance</h2>
    <table>
      <thead>
        <tr>
          <th>Agent Type</th>
          <th>Total Actions</th>
          <th>Success Rate</th>
          <th>Avg Duration</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(report.agentMetrics).map(([type, metrics]) => `
          <tr>
            <td>${type}</td>
            <td>${metrics.total}</td>
            <td>${metrics.successRate.toFixed(1)}%</td>
            <td>${(metrics.avgDuration / 1000).toFixed(1)}s</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    
    <h2>Performance Trends</h2>
    <div class="chart">
      <p>Interactive charts would be displayed here</p>
    </div>
    
    <h2>Recent Tasks</h2>
    <table>
      <thead>
        <tr>
          <th>Task ID</th>
          <th>Type</th>
          <th>Status</th>
          <th>Duration</th>
          <th>Timestamp</th>
        </tr>
      </thead>
      <tbody>
        ${report.tasks.slice(-10).reverse().map(task => `
          <tr>
            <td>${task.id}</td>
            <td>${task.type}</td>
            <td>${task.success ? '✅ Success' : '❌ Failed'}</td>
            <td>${(task.duration / 1000).toFixed(2)}s</td>
            <td>${new Date(task.timestamp).toLocaleString()}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
</body>
</html>`;
}