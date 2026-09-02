import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class MetricsReader {
  constructor() {
    this.metricsDir = '.claude-flow/metrics';
    this.sessionsDir = '.claude-flow/sessions';
  }

  async getSystemMetrics() {
    try {
      const filePath = path.join(this.metricsDir, 'system-metrics.json');
      const content = await fs.readFile(filePath, 'utf8');
      const metrics = JSON.parse(content);
      
      // Return the most recent metric
      return metrics.length > 0 ? metrics[metrics.length - 1] : null;
    } catch (error) {
      return null;
    }
  }

  async getTaskQueue() {
    try {
      const queueFile = '.claude-flow/tasks/queue.json';
      const content = await fs.readFile(queueFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return [];
    }
  }

  async getTaskMetrics() {
    try {
      const filePath = path.join(this.metricsDir, 'task-metrics.json');
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return [];
    }
  }

  async getPerformanceMetrics() {
    try {
      const filePath = path.join(this.metricsDir, 'performance.json');
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async getActiveAgents() {
    try {
      const agents = [];
      
      // Check for agents in the .claude-flow/agents directory
      const agentsDir = '.claude-flow/agents';
      try {
        const agentFiles = await fs.readdir(agentsDir);
        for (const file of agentFiles) {
          if (file.endsWith('.json')) {
            try {
              const content = await fs.readFile(path.join(agentsDir, file), 'utf8');
              const agent = JSON.parse(content);
              agents.push(agent);
            } catch {
              // Skip invalid agent files
            }
          }
        }
      } catch {
        // Agents directory doesn't exist yet
      }
      
      // If no agents found in directory, check session files
      if (agents.length === 0) {
        const sessionFiles = await this.getSessionFiles();
        for (const file of sessionFiles) {
          try {
            const content = await fs.readFile(path.join(this.sessionsDir, 'pair', file), 'utf8');
            const sessionData = JSON.parse(content);
            
            if (sessionData.agents && Array.isArray(sessionData.agents)) {
              agents.push(...sessionData.agents);
            }
          } catch {
            // Skip invalid session files
          }
        }
      }
      
      return agents;
    } catch (error) {
      return [];
    }
  }

  async getSessionStatus() {
    try {
      const sessionFiles = await this.getSessionFiles();
      
      if (sessionFiles.length === 0) {
        return null;
      }
      
      // Get the most recent session
      const mostRecentFile = sessionFiles[sessionFiles.length - 1];
      const content = await fs.readFile(path.join(this.sessionsDir, 'pair', mostRecentFile), 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async getRecentTasks(limit = 10) {
    try {
      const taskMetrics = await this.getTaskMetrics();
      
      // Sort by timestamp descending and take the limit
      return taskMetrics
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit)
        .map(task => ({
          id: task.id,
          type: task.type,
          status: task.success ? 'completed' : 'failed',
          startTime: task.timestamp - task.duration,
          endTime: task.timestamp,
          duration: task.duration
        }));
    } catch (error) {
      return [];
    }
  }

  async getOverallHealth() {
    try {
      const systemMetrics = await this.getSystemMetrics();
      const perfMetrics = await this.getPerformanceMetrics();
      
      if (!systemMetrics && !perfMetrics) {
        return 'error';
      }
      
      // Check memory usage
      if (systemMetrics && systemMetrics.memoryUsagePercent > 90) {
        return 'error';
      }
      
      if (systemMetrics && systemMetrics.memoryUsagePercent > 75) {
        return 'warning';
      }
      
      // Check CPU load
      if (systemMetrics && systemMetrics.cpuLoad > 0.8) {
        return 'warning';
      }
      
      // Check task failure rate
      if (perfMetrics && perfMetrics.totalTasks > 0) {
        const failureRate = perfMetrics.failedTasks / perfMetrics.totalTasks;
        if (failureRate > 0.5) {
          return 'error';
        }
        if (failureRate > 0.2) {
          return 'warning';
        }
      }
      
      return 'healthy';
    } catch (error) {
      return 'error';
    }
  }

  async getSessionFiles() {
    try {
      const files = await fs.readdir(path.join(this.sessionsDir, 'pair'));
      return files.filter(f => f.endsWith('.json')).sort();
    } catch (error) {
      return [];
    }
  }

  async getMCPServerStatus() {
    try {
      // Check if MCP server process is running (including flow-nexus and other MCP variants)
      const { stdout } = await execAsync('ps aux | grep -E "mcp" | grep -v grep | wc -l');
      const processCount = parseInt(stdout.trim(), 10);
      
      // Check for orchestrator running
      const { stdout: orchestratorOut } = await execAsync('ps aux | grep -E "claude-flow start" | grep -v grep | wc -l');
      const orchestratorRunning = parseInt(orchestratorOut.trim(), 10) > 0;
      
      // Determine status
      const isRunning = processCount > 0;
      
      // Try to get port from process (default is 3000)
      let port = 3000;
      try {
        const { stdout: portOut } = await execAsync('lsof -i :3000 2>/dev/null | grep LISTEN | wc -l');
        if (parseInt(portOut.trim(), 10) === 0) {
          // If port 3000 not listening, check other common ports
          port = null;
        }
      } catch {
        // lsof might not be available or port not in use
      }
      
      return {
        running: isRunning,
        processCount,
        orchestratorRunning,
        port,
        connections: processCount > 0 ? Math.max(1, processCount - 1) : 0 // Estimate connections
      };
    } catch (error) {
      // Fallback if commands fail
      return {
        running: false,
        processCount: 0,
        orchestratorRunning: false,
        port: null,
        connections: 0
      };
    }
  }
}

export { MetricsReader };