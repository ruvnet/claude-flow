import { getDatabase } from '../database';
import { Agent, Task, SwarmMemoryEntry, Objective } from '../models';
import type { CommunicationPatternRow as CommunicationEdgeRow, AgentNodeRow as CommunicationNodeRow } from '../types/row-types.js';

// Type definitions for database query results
interface AgentWorkloadRow {
  agent_id: string;
  agent_name: string;
  agent_type: string;
  active_task_count: number;
  pending_task_count: number;
  completed_today: number;
  average_completion_time: number | null;
  current_load: number | null;
}

interface TaskDependencyRow {
  task_id: string;
  task_type: string;
  status: string;
  dependencies: string;
  dependents: string;
}

interface MemoryUsageRow {
  date: string;
  hour: number;
  entry_count: number;
  unique_agents: number;
  avg_priority: number;
  top_types: string;
}

interface ObjectiveProgressRow {
  objective_id: string;
  description: string;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  progress_percentage: number;
  blocked_tasks: string;
}

interface ResourceUsageRow {
  timestamp: string;
  resource_type: string;
  usage_value: number;
  resource_limit: number | null;
}

interface CollaborationMetricsRow {
  agent1_id: string;
  agent1_name: string;
  agent1_type: string;
  agent2_id: string;
  agent2_name: string;
  agent2_type: string;
  collaboration_count: number;
}

interface TaskPerformanceRow {
  task_type: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  avg_duration: number;
  min_duration: number;
  max_duration: number;
  success_rate: number;
}

/**
 * Complex query utilities for advanced operations
 */
export class ComplexQueries {
  /**
   * Get agent workload distribution
   */
  static async getAgentWorkloadDistribution(): Promise<Array<{
    agentId: string;
    agentName: string;
    agentType: string;
    activeTaskCount: number;
    pendingTaskCount: number;
    completedToday: number;
    averageCompletionTime: number;
    currentLoad: number;
  }>> {
    const sql = `
      SELECT 
        a.id as agent_id,
        a.name as agent_name,
        a.type as agent_type,
        COUNT(CASE WHEN t.status = 'in_progress' THEN 1 END) as active_task_count,
        COUNT(CASE WHEN t.status IN ('assigned', 'pending') THEN 1 END) as pending_task_count,
        COUNT(CASE 
          WHEN t.status = 'completed' 
          AND DATE(t.completed_at) = DATE('now') 
          THEN 1 
        END) as completed_today,
        AVG(CASE 
          WHEN t.status = 'completed' AND t.completed_at IS NOT NULL AND t.started_at IS NOT NULL
          THEN (julianday(t.completed_at) - julianday(t.started_at)) * 86400
          ELSE NULL
        END) as average_completion_time,
        CAST(COUNT(CASE WHEN t.status IN ('assigned', 'in_progress') THEN 1 END) AS REAL) / 
          NULLIF(a.max_concurrent_tasks, 0) * 100 as current_load
      FROM agents a
      LEFT JOIN tasks t ON a.id = t.assigned_agent
      GROUP BY a.id, a.name, a.type, a.max_concurrent_tasks
      ORDER BY current_load DESC
    `;

    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      const rows = stmt.all() as AgentWorkloadRow[];
      return rows.map((row) => ({
        agentId: row.agent_id,
        agentName: row.agent_name,
        agentType: row.agent_type,
        activeTaskCount: row.active_task_count,
        pendingTaskCount: row.pending_task_count,
        completedToday: row.completed_today,
        averageCompletionTime: row.average_completion_time || 0,
        currentLoad: row.current_load || 0
      }));
    });
  }

  /**
   * Get task dependency graph
   */
  static async getTaskDependencyGraph(rootTaskId?: string): Promise<Array<{
    taskId: string;
    taskType: string;
    status: string;
    dependencies: string[];
    dependents: string[];
    criticalPath: boolean;
  }>> {
    let sql: string;
    let params: any[] = [];

    if (rootTaskId) {
      // Get dependency tree for specific task
      sql = `
        WITH RECURSIVE task_tree AS (
          -- Anchor: start with the root task
          SELECT id, type, status, dependencies, 0 as level
          FROM tasks
          WHERE id = ?
          
          UNION ALL
          
          -- Recursive: get all dependencies
          SELECT t.id, t.type, t.status, t.dependencies, tt.level + 1
          FROM tasks t
          JOIN json_each(tt.dependencies) d ON t.id = d.value
          JOIN task_tree tt ON 1=1
        )
        SELECT DISTINCT
          t.id as task_id,
          t.type as task_type,
          t.status,
          t.dependencies,
          (
            SELECT json_group_array(t2.id)
            FROM tasks t2
            WHERE json_extract(t2.dependencies, '$') LIKE '%"' || t.id || '"%'
          ) as dependents
        FROM task_tree t
      `;
      params = [rootTaskId];
    } else {
      // Get all tasks with dependencies
      sql = `
        SELECT 
          t.id as task_id,
          t.type as task_type,
          t.status,
          t.dependencies,
          (
            SELECT json_group_array(t2.id)
            FROM tasks t2
            WHERE json_extract(t2.dependencies, '$') LIKE '%"' || t.id || '"%'
          ) as dependents
        FROM tasks t
        WHERE json_array_length(t.dependencies) > 0
           OR EXISTS (
             SELECT 1 FROM tasks t2
             WHERE json_extract(t2.dependencies, '$') LIKE '%"' || t.id || '"%'
           )
      `;
    }

    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      const rows = stmt.all(...params) as TaskDependencyRow[];
      return rows.map((row) => ({
        taskId: row.task_id,
        taskType: row.task_type,
        status: row.status,
        dependencies: JSON.parse(row.dependencies || '[]'),
        dependents: JSON.parse(row.dependents || '[]'),
        criticalPath: false // TODO: Calculate critical path
      }));
    });
  }

  /**
   * Get memory usage patterns
   */
  static async getMemoryUsagePatterns(days: number = 7): Promise<Array<{
    date: string;
    hour: number;
    entryCount: number;
    uniqueAgents: number;
    avgPriority: number;
    topTypes: Array<{ type: string; count: number }>;
  }>> {
    const sql = `
      SELECT 
        DATE(timestamp) as date,
        CAST(strftime('%H', timestamp) AS INTEGER) as hour,
        COUNT(*) as entry_count,
        COUNT(DISTINCT agent_id) as unique_agents,
        AVG(priority) as avg_priority,
        json_group_array(
          json_object(
            'type', type,
            'count', type_count
          )
        ) as top_types
      FROM (
        SELECT 
          m.*,
          COUNT(*) OVER (PARTITION BY DATE(timestamp), strftime('%H', timestamp), type) as type_count
        FROM swarm_memory_entries m
        WHERE timestamp > datetime('now', '-' || ? || ' days')
      )
      GROUP BY date, hour
      ORDER BY date DESC, hour DESC
    `;

    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      const results = stmt.all(days) as MemoryUsageRow[];
      
      return results.map((row: MemoryUsageRow) => {
        const types = JSON.parse(row.top_types || '[]');
        const uniqueTypes = new Map<string, number>();
        
        types.forEach((t: any) => {
          if (!uniqueTypes.has(t.type) || uniqueTypes.get(t.type)! < t.count) {
            uniqueTypes.set(t.type, t.count);
          }
        });

        return {
          date: row.date,
          hour: row.hour,
          entryCount: row.entry_count,
          uniqueAgents: row.unique_agents,
          avgPriority: row.avg_priority,
          topTypes: Array.from(uniqueTypes.entries())
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 3)
        };
      });
    });
  }

  /**
   * Get objective progress summary
   */
  static async getObjectiveProgressSummary(): Promise<Array<{
    objectiveId: string;
    description: string;
    status: string;
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    progressPercentage: number;
    estimatedCompletion: Date | null;
    blockedTasks: Array<{ taskId: string; blockedBy: string[] }>;
  }>> {
    const sql = `
      SELECT 
        o.id as objective_id,
        o.description,
        o.status,
        COUNT(ot.task_id) as total_tasks,
        COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as completed_tasks,
        COUNT(CASE WHEN t.status = 'failed' THEN 1 END) as failed_tasks,
        CASE 
          WHEN COUNT(ot.task_id) > 0 
          THEN CAST(COUNT(CASE WHEN t.status = 'completed' THEN 1 END) AS REAL) / COUNT(ot.task_id) * 100
          ELSE 0
        END as progress_percentage,
        json_group_array(
          CASE 
            WHEN t.status = 'pending' AND json_array_length(t.dependencies) > 0
            THEN json_object(
              'taskId', t.id,
              'blockedBy', (
                SELECT json_group_array(d.value)
                FROM json_each(t.dependencies) d
                JOIN tasks dep ON dep.id = d.value
                WHERE dep.status != 'completed'
              )
            )
            ELSE NULL
          END
        ) as blocked_tasks
      FROM objectives o
      LEFT JOIN objective_tasks ot ON o.id = ot.objective_id
      LEFT JOIN tasks t ON ot.task_id = t.id
      WHERE o.status IN ('planning', 'executing')
      GROUP BY o.id, o.description, o.status
      ORDER BY progress_percentage DESC
    `;

    const db = getDatabase();
    return db.withConnection(conn => {
      const stmt = conn.prepare(sql);
      const rows = stmt.all() as ObjectiveProgressRow[];
      return rows.map((row) => {
        const blockedTasks = JSON.parse(row.blocked_tasks || '[]')
          .filter((t: any) => t !== null)
          .map((t: any) => ({
            taskId: t.taskId,
            blockedBy: t.blockedBy || []
          }));

        // Simple estimated completion calculation
        let estimatedCompletion = null;
        if (row.completed_tasks > 0 && row.total_tasks > row.completed_tasks) {
          // This is a very simple estimation - could be improved
          const remainingTasks = row.total_tasks - row.completed_tasks;
          const avgCompletionRate = row.completed_tasks / 7; // Assume data from last 7 days
          if (avgCompletionRate > 0) {
            const daysToComplete = remainingTasks / avgCompletionRate;
            estimatedCompletion = new Date();
            estimatedCompletion.setDate(estimatedCompletion.getDate() + Math.ceil(daysToComplete));
          }
        }

        return {
          objectiveId: row.objective_id,
          description: row.description,
          status: row.status,
          totalTasks: row.total_tasks,
          completedTasks: row.completed_tasks,
          failedTasks: row.failed_tasks,
          progressPercentage: row.progress_percentage,
          estimatedCompletion,
          blockedTasks
        };
      });
    });
  }

  /**
   * Get communication patterns between agents
   */
  static async getCommunicationPatterns(days: number = 7): Promise<{
    nodes: Array<{ id: string; label: string; type: string; messageCount: number }>;
    edges: Array<{ from: string; to: string; weight: number; messageTypes: string[] }>;
  }> {
    const sql = `
      WITH agent_messages AS (
        SELECT 
          m.sender_id,
          json_each.value as receiver_id,
          m.type,
          COUNT(*) as message_count
        FROM messages m
        JOIN json_each(m.receivers)
        WHERE m.created_at > datetime('now', '-' || ? || ' days')
        GROUP BY m.sender_id, json_each.value, m.type
      )
      SELECT 
        sender_id,
        receiver_id,
        json_group_array(DISTINCT type) as message_types,
        SUM(message_count) as total_messages
      FROM agent_messages
      GROUP BY sender_id, receiver_id
    `;

    const nodesSql = `
      SELECT DISTINCT
        a.id,
        a.name as label,
        a.type,
        COUNT(m.id) as message_count
      FROM agents a
      LEFT JOIN messages m ON a.id = m.sender_id
      WHERE m.created_at > datetime('now', '-' || ? || ' days')
         OR a.status = 'active'
      GROUP BY a.id, a.name, a.type
    `;

    const db = getDatabase();
    return db.withConnection(conn => {
      const edgeStmt = conn.prepare(sql);
      const edges = (edgeStmt.all(days) as CommunicationEdgeRow[]).map((row) => ({
        from: row.sender_id,
        to: row.receiver_id,
        weight: row.total_messages,
        messageTypes: JSON.parse(row.message_types)
      }));

      const nodeStmt = conn.prepare(nodesSql);
      const nodes = (nodeStmt.all(days) as CommunicationNodeRow[]).map((row) => ({
        id: row.id,
        label: row.label,
        type: row.type,
        messageCount: row.message_count
      }));

      return { nodes, edges };
    });
  }

  /**
   * Get performance anomalies
   */
  static async getPerformanceAnomalies(): Promise<Array<{
    type: 'agent' | 'task' | 'memory' | 'message';
    entityId: string;
    anomaly: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    details: Record<string, any>;
    recommendation: string;
  }>> {
    const anomalies: Array<any> = [];
    const db = getDatabase();

    await db.withConnection(async conn => {
      // Check for underperforming agents
      const underperformingAgentsStmt = conn.prepare(`
        SELECT 
          a.id,
          a.name,
          a.type,
          m.tasks_completed,
          m.tasks_failed,
          CAST(m.tasks_failed AS REAL) / NULLIF(m.tasks_completed + m.tasks_failed, 0) * 100 as failure_rate,
          m.total_duration_ms / NULLIF(m.tasks_completed, 0) as avg_task_duration
        FROM agents a
        JOIN agent_metrics m ON a.id = m.agent_id
        WHERE m.tasks_completed + m.tasks_failed > 10
          AND (
            CAST(m.tasks_failed AS REAL) / (m.tasks_completed + m.tasks_failed) > 0.3
            OR m.total_duration_ms / NULLIF(m.tasks_completed, 0) > (
              SELECT AVG(total_duration_ms / NULLIF(tasks_completed, 0)) * 2
              FROM agent_metrics
              WHERE tasks_completed > 0
            )
          )
      `);

      interface UnderperformingAgentRow {
        id: string;
        name: string;
        type: string;
        tasks_completed: number;
        tasks_failed: number;
        failure_rate: number;
        avg_task_duration: number;
      }
      
      const underperformingAgents = underperformingAgentsStmt.all() as UnderperformingAgentRow[];
      for (const agent of underperformingAgents) {
        anomalies.push({
          type: 'agent',
          entityId: agent.id,
          anomaly: agent.failure_rate > 30 ? 'High failure rate' : 'Slow task completion',
          severity: agent.failure_rate > 50 ? 'critical' : agent.failure_rate > 30 ? 'high' : 'medium',
          details: {
            agentName: agent.name,
            agentType: agent.type,
            failureRate: agent.failure_rate,
            avgTaskDuration: agent.avg_task_duration,
            tasksCompleted: agent.tasks_completed,
            tasksFailed: agent.tasks_failed
          },
          recommendation: agent.failure_rate > 30 
            ? 'Review agent configuration and recent failures' 
            : 'Consider optimizing agent workload or resources'
        });
      }

      // Check for stuck tasks
      interface StuckTaskRow {
        id: string;
        type: string;
        assigned_agent: string;
        status: string;
        started_at: string;
        seconds_in_progress: number;
      }
      
      const stuckTasksStmt = conn.prepare(`
        SELECT 
          id,
          type,
          assigned_agent,
          status,
          started_at,
          (julianday('now') - julianday(started_at)) * 86400 as seconds_in_progress
        FROM tasks
        WHERE status = 'in_progress'
          AND started_at < datetime('now', '-1 hour')
      `);

      const stuckTasks = stuckTasksStmt.all() as Array<{
        id: string;
        type: string;
        assigned_agent: string;
        seconds_in_progress: number;
      }>;
      for (const task of stuckTasks) {
        anomalies.push({
          type: 'task',
          entityId: task.id,
          anomaly: 'Task stuck in progress',
          severity: task.seconds_in_progress > 7200 ? 'high' : 'medium',
          details: {
            taskType: task.type,
            assignedAgent: task.assigned_agent,
            timeInProgress: Math.round(task.seconds_in_progress / 60) + ' minutes'
          },
          recommendation: 'Check agent status and consider reassigning or failing the task'
        });
      }

      // Check for memory growth
      const memoryGrowthStmt = conn.prepare(`
        SELECT 
          COUNT(*) as entry_count,
          SUM(LENGTH(content)) as total_size
        FROM swarm_memory_entries
        WHERE timestamp > datetime('now', '-1 day')
      `);

      const memoryStats = memoryGrowthStmt.get() as any;
      if (memoryStats.entry_count > 10000 || memoryStats.total_size > 100000000) {
        anomalies.push({
          type: 'memory',
          entityId: 'system',
          anomaly: 'Excessive memory growth',
          severity: memoryStats.total_size > 100000000 ? 'high' : 'medium',
          details: {
            entriesLast24h: memoryStats.entry_count,
            totalSizeBytes: memoryStats.total_size
          },
          recommendation: 'Consider archiving old entries or implementing memory cleanup'
        });
      }

      // Check for message delivery issues
      const deliveryIssuesStmt = conn.prepare(`
        SELECT 
          m.id,
          m.type,
          m.sender_id,
          json_array_length(m.receivers) as total_receivers,
          COUNT(a.agent_id) as acknowledged_count,
          m.created_at
        FROM messages m
        LEFT JOIN message_acknowledgments a ON m.id = a.message_id
        WHERE m.created_at < datetime('now', '-30 minutes')
          AND m.reliability != 'best-effort'
        GROUP BY m.id
        HAVING acknowledged_count < total_receivers * 0.8
      `);

      const deliveryIssues = deliveryIssuesStmt.all() as Array<{
        id: string;
        type: string;
        sender_id: string;
        acknowledged_count: number;
        total_receivers: number;
      }>;
      for (const message of deliveryIssues) {
        const deliveryRate = (message.acknowledged_count / message.total_receivers) * 100;
        anomalies.push({
          type: 'message',
          entityId: message.id,
          anomaly: 'Low message delivery rate',
          severity: deliveryRate < 50 ? 'high' : 'medium',
          details: {
            messageType: message.type,
            senderId: message.sender_id,
            deliveryRate: deliveryRate.toFixed(1) + '%',
            acknowledged: message.acknowledged_count,
            totalReceivers: message.total_receivers
          },
          recommendation: 'Check receiver agent status and network connectivity'
        });
      }
    });

    return anomalies;
  }

  /**
   * Get system resource utilization
   */
  static async getResourceUtilization(): Promise<{
    database: {
      sizeBytes: number;
      sizeFormatted: string;
      tableCount: number;
      indexCount: number;
      cacheHitRate: number;
    };
    connectionPool: {
      total: number;
      inUse: number;
      available: number;
      utilization: number;
    };
    performance: {
      averageQueryTime: number;
      slowQueries: number;
      totalQueries: number;
    };
  }> {
    const db = getDatabase();
    
    // Get pool stats
    const poolStats = db.getPoolStats();
    const performanceMetrics = db.getMetrics();

    // Get database stats
    const dbStats = await db.withConnection(conn => {
      const sizeStmt = conn.prepare(
        'SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()'
      );
      const size = sizeStmt.get() as any;

      const tableCountStmt = conn.prepare(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'table'"
      );
      const tableCount = tableCountStmt.get() as any;

      const indexCountStmt = conn.prepare(
        "SELECT COUNT(*) as count FROM sqlite_master WHERE type = 'index'"
      );
      const indexCount = indexCountStmt.get() as any;

      // Simple cache hit rate calculation (would need more sophisticated tracking)
      const cacheStmt = conn.prepare('PRAGMA cache_size');
      const cacheSize = cacheStmt.get() as any;

      return {
        sizeBytes: size.size,
        tableCount: tableCount.count,
        indexCount: indexCount.count,
        cacheSize: Math.abs(cacheSize.cache_size)
      };
    });

    // Format size
    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
      if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
      return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
    };

    return {
      database: {
        sizeBytes: dbStats.sizeBytes,
        sizeFormatted: formatBytes(dbStats.sizeBytes),
        tableCount: dbStats.tableCount,
        indexCount: dbStats.indexCount,
        cacheHitRate: 95 // Placeholder - would need actual tracking
      },
      connectionPool: poolStats,
      performance: {
        averageQueryTime: performanceMetrics.totalQueries > 0 
          ? performanceMetrics.totalDuration / performanceMetrics.totalQueries 
          : 0,
        slowQueries: performanceMetrics.slowQueries.length,
        totalQueries: performanceMetrics.totalQueries
      }
    };
  }
}

export default ComplexQueries;