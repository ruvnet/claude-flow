import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface SystemMetrics {
  timestamp: number;
  memoryTotal: number;
  memoryUsed: number;
  memoryFree: number;
  memoryUsagePercent: number;
  memoryEfficiency: number;
  cpuCount: number;
  cpuLoad: number;
  platform: string;
  uptime: number;
}

interface TaskMetric {
  id: string;
  type: string;
  success: boolean;
  duration: number;
  timestamp: number;
  metadata: Record<string, any>;
}

interface PerformanceMetrics {
  startTime: number;
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  totalAgents: number;
  activeAgents: number;
  neuralEvents: number;
}

interface Agent {
  id: string;
  name: string;
  type: string;
  status: 'active' | 'idle' | 'busy';
  activeTasks: number;
  lastActivity?: number;
}

interface SessionData {
  id: string;
  startTime: number;
  endTime?: number;
  agents: Agent[];
  tasks: any[];
  status: 'active' | 'completed' | 'paused';
}

interface MCPServerStatus {
  running: boolean;
  processCount: number;
  orchestratorRunning: boolean;
  port: number | null;
  connections: number;
}

export class MetricsReader {
  private metricsDir = '.claude-flow/metrics';
  private sessionsDir = '.claude-flow/sessions';

  async getSystemMetrics(): Promise<SystemMetrics | null> {
    try {
      const filePath = path.join(this.metricsDir, 'system-metrics.json');
      const content = await fs.readFile(filePath, 'utf8');
      const metrics: SystemMetrics[] = JSON.parse(content);
      
      // Return the most recent metric
      return metrics.length > 0 ? metrics[metrics.length - 1] : null;
    } catch (error) {
      return null;
    }
  }

  async getTaskMetrics(): Promise<TaskMetric[]> {
    try {
      const filePath = path.join(this.metricsDir, 'task-metrics.json');
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return [];
    }
  }

  async getPerformanceMetrics(): Promise<PerformanceMetrics | null> {
    try {
      const filePath = path.join(this.metricsDir, 'performance.json');
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  async getActiveAgents(): Promise<Agent[]> {
    try {
      // First check performance metrics for agent count
      const perfMetrics = await this.getPerformanceMetrics();
      
      // Also check session files for more detailed agent info
      const sessionFiles = await this.getSessionFiles();
      const agents: Agent[] = [];
      
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
      
      // If no agents found in sessions, create mock agents based on performance metrics
      if (agents.length === 0 && perfMetrics) {
        const activeCount = perfMetrics.activeAgents || 0;
        const totalCount = perfMetrics.totalAgents || 0;
        
        for (let i = 0; i < totalCount; i++) {
          agents.push({
            id: `agent-${i + 1}`,
            name: `Agent ${i + 1}`,
            type: i === 0 ? 'orchestrator' : 'worker',
            status: i < activeCount ? 'active' : 'idle',
            activeTasks: i < activeCount ? 1 : 0,
            lastActivity: Date.now() - (i * 1000)
          });
        }
      }
      
      return agents;
    } catch (error) {
      return [];
    }
  }

  async getSessionStatus(): Promise<SessionData | null> {
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

  async getRecentTasks(limit: number = 10): Promise<any[]> {
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

  async getOverallHealth(): Promise<'healthy' | 'warning' | 'error'> {
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

  private async getSessionFiles(): Promise<string[]> {
    try {
      const files = await fs.readdir(path.join(this.sessionsDir, 'pair'));
      return files.filter(f => f.endsWith('.json')).sort();
    } catch (error) {
      return [];
    }
  }

  async getMCPServerStatus(): Promise<MCPServerStatus> {
    try {
      // Check if MCP server process is running
      const { stdout } = await execAsync('ps aux | grep -E "mcp-server\\.js|claude-flow mcp start" | grep -v grep | wc -l');
      const processCount = parseInt(stdout.trim(), 10);
      
      // Check for orchestrator running
      const { stdout: orchestratorOut } = await execAsync('ps aux | grep -E "claude-flow start" | grep -v grep | wc -l');
      const orchestratorRunning = parseInt(orchestratorOut.trim(), 10) > 0;
      
      // Determine status
      const isRunning = processCount > 0;
      
      // Try to get port from process (default is 3000)
      let port: number | null = 3000;
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